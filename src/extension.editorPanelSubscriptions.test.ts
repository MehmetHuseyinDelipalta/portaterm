// @vitest-environment jsdom
// src/extension.editorPanelSubscriptions.test.ts — an editor terminal's panel
// leaves `context.subscriptions` when it closes.
//
// Each new or reopened editor terminal pushed its panel onto the extension's
// subscriptions and nothing took it off: the list grew for the life of the
// window, and at shutdown every closed panel was disposed again into a
// manager that was already torn down.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000 });

// Panes need sessions, and sessions need a pty: the shared stand-ins spawn nothing.
vi.mock("./pty/PtyManager", async () => (await import("./test/sessionMocks")).ptyManagerMock());
vi.mock("./pty/PtySession", async () => (await import("./test/sessionMocks")).ptySessionMock());

beforeAll(async () => {
  await import("./extension");
}, 120_000);

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "editor-subscriptions-")));
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

let subscriptions: Array<{ dispose(): unknown }> = [];
let teardown: (() => Promise<void> | void) | undefined;

afterEach(async () => {
  await teardown?.();
  teardown = undefined;
  for (const subscription of subscriptions.splice(0)) {
    subscription.dispose();
  }
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.resetModules();
});

interface Surface {
  send(msg: unknown): void;
  posted: Array<{ type?: string; [key: string]: unknown }>;
}

async function activateWithViews() {
  const { activate, deactivate } = await import("./extension");
  teardown = deactivate;
  const vscode = await import("./test/__mocks__/vscode");
  vscode.__resetAll();
  (vscode.extensions as { onDidChange?: unknown }).onDidChange = () => ({ dispose: () => {} });
  const win = vscode.window as Record<string, unknown>;
  win.state ??= { focused: true, active: true };
  win.onDidChangeWindowState ??= () => ({ dispose: () => {} });
  win.tabGroups ??= { all: [], onDidChangeTabs: () => ({ dispose: () => {} }) };
  // The store watchers are not under test; a quiet stand-in keeps the log readable.
  (vscode.workspace as Record<string, unknown>).createFileSystemWatcher = () => ({
    onDidCreate: () => ({ dispose: () => {} }),
    onDidChange: () => ({ dispose: () => {} }),
    onDidDelete: () => ({ dispose: () => {} }),
    dispose: () => {},
  });

  const commands = new Map<string, (...args: unknown[]) => unknown>();
  vi.spyOn(vscode.commands, "registerCommand").mockImplementation((command, callback) => {
    commands.set(command, callback);
    return { dispose: () => commands.delete(command) };
  });
  // Editor-area terminals: the shared mock panel, made the active editor and
  // recording what it is sent.
  const editors: Array<Surface & { panel: { active: boolean } }> = [];
  const createPanel = vscode.window.createWebviewPanel;
  vi.spyOn(vscode.window, "createWebviewPanel").mockImplementation(((...args: Parameters<typeof createPanel>) => {
    const panel = Object.assign(createPanel(...args), { active: true });
    const posted: Surface["posted"] = [];
    panel.webview.postMessage = async (msg: unknown) => {
      posted.push(msg as Surface["posted"][number]);
      return true;
    };
    editors.push({
      panel,
      posted,
      send: (msg) => {
        for (const h of panel.__messageHandlers) {
          h(msg);
        }
      },
    });
    return panel;
  }) as never);
  const providers = new Map<string, { resolveWebviewView(view: unknown, ctx: unknown, token: unknown): unknown }>();
  vi.spyOn(vscode.window, "registerWebviewViewProvider").mockImplementation((viewType, provider) => {
    providers.set(viewType, provider as never);
    return { dispose: () => {} };
  });

  subscriptions = [];
  await activate({
    // The repository root: spawning a pane copies its shell-integration scripts.
    extensionUri: { fsPath: path.resolve(__dirname, "..") },
    subscriptions,
    globalState: { get: () => undefined, update: async () => {}, keys: () => [] },
    workspaceState: { get: () => undefined, update: async () => {}, keys: () => [] },
    globalStorageUri: { fsPath: path.join(TMP, "storage") },
    storageUri: { fsPath: path.join(TMP, "workspace-storage") },
    extensionPath: path.resolve(__dirname, ".."),
    logUri: { fsPath: path.join(TMP, "log") },
    secrets: { get: async () => undefined, store: async () => {}, delete: async () => {} },
    environmentVariableCollection: { replace: () => {}, append: () => {}, prepend: () => {}, clear: () => {} },
  } as never);

  const resolve = (viewType: string): Surface => {
    const provider = providers.get(viewType);
    if (!provider) {
      throw new Error(`activate registered no ${viewType} provider`);
    }
    const handlers: Array<(msg: unknown) => void> = [];
    const posted: Surface["posted"] = [];
    provider.resolveWebviewView(
      {
        visible: true,
        viewType,
        webview: {
          html: "",
          options: {},
          cspSource: "https://mock.csp.source",
          asWebviewUri: (uri: { fsPath: string }) => uri.fsPath,
          onDidReceiveMessage: (h: (msg: unknown) => void) => {
            handlers.push(h);
            return { dispose: () => {} };
          },
          postMessage: async (msg: { type?: string }) => {
            posted.push(msg);
            return true;
          },
        },
        onDidChangeVisibility: () => ({ dispose: () => {} }),
        onDidDispose: () => ({ dispose: () => {} }),
      },
      {},
      {},
    );
    return {
      posted,
      send: (msg) => {
        for (const h of handlers) {
          h(msg);
        }
      },
    };
  };
  const run = async (command: string, ...args: unknown[]) => {
    const handler = commands.get(command);
    if (!handler) {
      throw new Error(`${command} is not registered`);
    }
    await handler(...args);
  };
  return { commands, run, editors, sidebar: resolve("portaterm.sidebar"), panel: resolve("portaterm.panel") };
}

const disposeOf = (panel: unknown) => (panel as { dispose(): void }).dispose();

/**
 * Track whether each mock panel was disposed. The mock fires `onDidDispose`
 * synchronously from `dispose()`, as VS Code does.
 */
function trackDisposal(panel: unknown): () => boolean {
  let disposed = false;
  (panel as { onDidDispose(h: () => void): unknown }).onDidDispose(() => {
    disposed = true;
  });
  return () => disposed;
}

describe("editor terminal panels and context.subscriptions", () => {
  it("does not grow the subscriptions with each panel opened and closed", async () => {
    const h = await activateWithViews();
    const baseline = subscriptions.length;

    for (let i = 0; i < 5; i++) {
      await h.run("portaterm.newTerminalInEditor");
    }
    for (const editor of h.editors) {
      disposeOf(editor.panel);
    }
    await h.run("portaterm.newTerminalInEditor");

    expect(subscriptions.length).toBe(baseline);
  });

  it("disposes every open panel when the subscriptions are disposed the way VS Code does — in place", async () => {
    // VS Code walks the LIVE array. A panel's onDidDispose that splices it out
    // shifted the next entry into its slot, and the walk skipped that entry.
    const h = await activateWithViews();
    for (let i = 0; i < 3; i++) {
      await h.run("portaterm.newTerminalInEditor");
    }
    const disposed = h.editors.map((e) => trackDisposal(e.panel));

    for (const subscription of subscriptions) {
      subscription.dispose();
    }

    expect(disposed.map((d) => d())).toEqual([true, true, true]);
  });

  it("does not dispose a panel again at shutdown once the user closed it", async () => {
    const h = await activateWithViews();
    await h.run("portaterm.newTerminalInEditor");
    await h.run("portaterm.newTerminalInEditor");
    const [closed, open] = h.editors;
    disposeOf(closed.panel);
    let closedAgain = 0;
    (closed.panel as unknown as { onDidDispose(h: () => void): unknown }).onDidDispose(() => {
      closedAgain += 1;
    });
    const openDisposed = trackDisposal(open.panel);

    for (const subscription of [...subscriptions]) {
      subscription.dispose();
    }

    expect(closedAgain).toBe(0);
    expect(openDisposed()).toBe(true);
  });

  it("holds a tab reopened from the closed-with-agents toast, and disposes it at shutdown", async () => {
    const h = await activateWithViews();
    await h.run("portaterm.newTerminalInEditor");
    const vscode = await import("./test/__mocks__/vscode");
    const { TerminalEditorProvider } = await import("./providers/TerminalEditorProvider");
    const id = ([...TerminalEditorProvider.getProviders()][0] as unknown as { _panelId: string })._panelId;
    disposeOf(h.editors[0].panel);
    vi.spyOn(vscode.window, "showWarningMessage").mockResolvedValue("Reopen Tab" as never);
    const notify = (TerminalEditorProvider as unknown as { _onDisposedWithAgents: (i: unknown) => void })
      ._onDisposedWithAgents;
    notify({ viewId: `editor-${id}`, panelId: id, running: [{ name: "Claude" }], graceMs: 30_000 });
    await vi.waitFor(() => expect(h.editors).toHaveLength(2));
    const reopenedDisposed = trackDisposal(h.editors[1].panel);

    for (const subscription of subscriptions) {
      subscription.dispose();
    }

    expect(reopenedDisposed()).toBe(true);
  });
});
