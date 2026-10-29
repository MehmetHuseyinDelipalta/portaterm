// @vitest-environment jsdom
// src/extension.broadcastInput.test.ts — the broadcast-input commands as `activate` wires them.
//
// `broadcastCommands.test.ts` owns the resolution rules; this owns that the
// shipped `activate` registers every door and that each one lands on the
// webview holding the pane — not the focused one, not every one.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BROADCAST_COMMAND_IDS } from "./commands/broadcastCommands";

vi.setConfig({ testTimeout: 30_000 });

// Panes need sessions, and sessions need a pty: the shared stand-ins spawn nothing.
vi.mock("./pty/PtyManager", async () => (await import("./test/sessionMocks")).ptyManagerMock());
vi.mock("./pty/PtySession", async () => (await import("./test/sessionMocks")).ptySessionMock());

beforeAll(async () => {
  await import("./extension");
}, 120_000);

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "broadcast-input-")));
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

/** Bring a surface up and return the session its first terminal runs. */
async function firstSession(surface: Surface): Promise<string> {
  surface.send({ type: "ready" });
  let id: string | undefined;
  await vi.waitFor(
    () => {
      const init = surface.posted.find((m) => m.type === "init") as { tabs?: Array<{ id: string }> } | undefined;
      id = init?.tabs?.[0]?.id;
      expect(id).toBeTypeOf("string");
    },
    { timeout: 10_000 },
  );
  return id!;
}

const broadcastPosts = (surface: Surface) => surface.posted.filter((m) => m.type === "setBroadcastInput");

describe("broadcast input as activate wires it", () => {
  it("registers every broadcast command", async () => {
    const h = await activateWithViews();
    for (const id of BROADCAST_COMMAND_IDS) {
      expect(h.commands.has(id)).toBe(true);
    }
  });

  it("posts a right-click's start and stop to the webview holding that pane only", async () => {
    const h = await activateWithViews();
    const sidebarSession = await firstSession(h.sidebar);
    const panelSession = await firstSession(h.panel);

    await h.run("portaterm.ctx.startBroadcastInput", { paneSessionId: panelSession });
    await h.run("portaterm.ctx.stopBroadcastInput", { paneSessionId: sidebarSession });

    expect(broadcastPosts(h.panel)).toEqual([{ type: "setBroadcastInput", sessionId: panelSession, enabled: true }]);
    expect(broadcastPosts(h.sidebar)).toEqual([
      { type: "setBroadcastInput", sessionId: sidebarSession, enabled: false },
    ]);
  });

  it("palette toggle reaches the active tab of the view the user worked in last", async () => {
    const h = await activateWithViews();
    const sidebarSession = await firstSession(h.sidebar);
    await h.run("portaterm.toggleBroadcastInput");
    expect(broadcastPosts(h.sidebar)).toEqual([{ type: "setBroadcastInput", sessionId: sidebarSession }]);
    expect(broadcastPosts(h.panel)).toEqual([]);

    // Any message from the panel's webview is interaction with it.
    const panelSession = await firstSession(h.panel);
    await h.run("portaterm.toggleBroadcastInput");
    expect(broadcastPosts(h.panel)).toEqual([{ type: "setBroadcastInput", sessionId: panelSession }]);
    expect(broadcastPosts(h.sidebar)).toHaveLength(1);
  });

  it("palette toggle prefers a focused editor-area terminal over the views", async () => {
    const h = await activateWithViews();
    await firstSession(h.sidebar);
    await h.run("portaterm.newTerminalInEditor");
    const editor = h.editors[0];
    if (!editor) {
      throw new Error("newTerminalInEditor opened no panel");
    }
    const editorSession = await firstSession(editor);

    await h.run("portaterm.toggleBroadcastInput");
    expect(broadcastPosts(editor)).toEqual([{ type: "setBroadcastInput", sessionId: editorSession }]);
    expect(broadcastPosts(h.sidebar)).toEqual([]);

    // A right-click in the editor reaches the editor, not the focused view.
    editor.panel.active = false;
    await h.run("portaterm.ctx.stopBroadcastInput", { paneSessionId: editorSession });
    expect(broadcastPosts(editor).at(-1)).toEqual({
      type: "setBroadcastInput",
      sessionId: editorSession,
      enabled: false,
    });
    expect(broadcastPosts(h.sidebar)).toEqual([]);
  });

  it("a right-click on a pane that no longer exists posts nowhere", async () => {
    const h = await activateWithViews();
    await firstSession(h.sidebar);
    await h.run("portaterm.ctx.startBroadcastInput", { paneSessionId: "gone" });
    expect(broadcastPosts(h.sidebar)).toEqual([]);
    expect(broadcastPosts(h.panel)).toEqual([]);
  });
});
