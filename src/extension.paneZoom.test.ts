// @vitest-environment jsdom
// src/extension.paneZoom.test.ts — the pane-zoom commands as `activate` wires them.
//
// `paneZoomCommands.test.ts` owns the resolution rules; this owns that the
// shipped `activate` registers every door, that each one lands on the webview
// holding the pane, and that the keybinding door names the focused surface's
// active pane — not its tab, and not an editor that is merely the active one.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PANE_ZOOM_COMMAND_IDS } from "./commands/paneZoomCommands";

vi.setConfig({ testTimeout: 30_000 });

// Panes need sessions, and sessions need a pty: the shared stand-ins spawn nothing.
vi.mock("./pty/PtyManager", async () => (await import("./test/sessionMocks")).ptyManagerMock());
vi.mock("./pty/PtySession", async () => (await import("./test/sessionMocks")).ptySessionMock());

beforeAll(async () => {
  await import("./extension");
}, 120_000);

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pane-zoom-")));
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

const zoomPosts = (surface: Surface) => surface.posted.filter((m) => m.type === "setPaneZoom");

/** Split `paneId` of `tabId` the way the webview asks, and return the new pane once created. */
async function splitPane(surface: Surface, tabId: string, paneId: string): Promise<string> {
  surface.send({
    type: "requestSplitSession",
    requestId: "split-1",
    direction: "vertical",
    sourceTabId: tabId,
    sourcePaneId: paneId,
  });
  let created: string | undefined;
  await vi.waitFor(
    () => {
      const msg = surface.posted.find((m) => m.type === "splitPaneCreated") as { newSessionId?: string } | undefined;
      created = msg?.newSessionId;
      expect(created).toBeTypeOf("string");
    },
    { timeout: 10_000 },
  );
  return created!;
}

describe("pane zoom as activate wires it", () => {
  it("registers every zoom command", async () => {
    const h = await activateWithViews();
    for (const id of PANE_ZOOM_COMMAND_IDS) {
      expect(h.commands.has(id)).toBe(true);
    }
  });

  it("posts a right-click's zoom and unzoom to the webview holding that pane only", async () => {
    const h = await activateWithViews();
    const sidebarSession = await firstSession(h.sidebar);
    const panelSession = await firstSession(h.panel);

    await h.run("portaterm.ctx.zoomPane", { paneSessionId: panelSession });
    await h.run("portaterm.ctx.unzoomPane", { paneSessionId: sidebarSession });

    expect(zoomPosts(h.panel)).toEqual([{ type: "setPaneZoom", sessionId: panelSession, zoomed: true }]);
    expect(zoomPosts(h.sidebar)).toEqual([{ type: "setPaneZoom", sessionId: sidebarSession, zoomed: false }]);
  });

  it("toggle names the focused surface's active pane, not its tab", async () => {
    const h = await activateWithViews();
    const tab = await firstSession(h.sidebar);
    const pane = await splitPane(h.sidebar, tab, tab);
    h.sidebar.send({ type: "terminalNavigationCommitted", activeTabId: tab, activePaneId: pane });
    h.sidebar.send({ type: "focus" });

    await h.run("portaterm.togglePaneZoom");
    expect(zoomPosts(h.sidebar)).toEqual([{ type: "setPaneZoom", sessionId: pane }]);
    expect(zoomPosts(h.panel)).toEqual([]);
  });

  it("toggle follows keyboard focus over an editor terminal that is merely the active editor", async () => {
    const h = await activateWithViews();
    const sidebarSession = await firstSession(h.sidebar);
    await h.run("portaterm.newTerminalInEditor");
    const editor = h.editors[0];
    if (!editor) {
      throw new Error("newTerminalInEditor opened no panel");
    }
    const editorSession = await firstSession(editor);

    // The editor is the active editor but the keys were pressed in the sidebar.
    h.sidebar.send({ type: "focus" });
    await h.run("portaterm.togglePaneZoom");
    expect(zoomPosts(h.sidebar)).toEqual([{ type: "setPaneZoom", sessionId: sidebarSession }]);
    expect(zoomPosts(editor)).toEqual([]);

    // Focus moves into the editor terminal: it wins over the view.
    h.sidebar.send({ type: "blur" });
    editor.send({ type: "focus" });
    await h.run("portaterm.togglePaneZoom");
    expect(zoomPosts(editor)).toEqual([{ type: "setPaneZoom", sessionId: editorSession }]);
    expect(zoomPosts(h.sidebar)).toHaveLength(1);

    // A view whose blur never arrived does not outrank a focused editor terminal.
    h.sidebar.send({ type: "focus" });
    editor.panel.active = false;
    await h.run("portaterm.togglePaneZoom");
    expect(zoomPosts(editor)).toHaveLength(2);
    expect(zoomPosts(h.sidebar)).toHaveLength(1);
  });

  it("toggle with nothing focused falls back to the active editor terminal, then the views", async () => {
    const h = await activateWithViews();
    const sidebarSession = await firstSession(h.sidebar);
    await h.run("portaterm.togglePaneZoom");
    expect(zoomPosts(h.sidebar)).toEqual([{ type: "setPaneZoom", sessionId: sidebarSession }]);

    await h.run("portaterm.newTerminalInEditor");
    const editor = h.editors[0];
    if (!editor) {
      throw new Error("newTerminalInEditor opened no panel");
    }
    const editorSession = await firstSession(editor);
    await h.run("portaterm.togglePaneZoom");
    expect(zoomPosts(editor)).toEqual([{ type: "setPaneZoom", sessionId: editorSession }]);
    expect(zoomPosts(h.sidebar)).toHaveLength(1);
  });

  it("a right-click on a pane that no longer exists posts nowhere", async () => {
    const h = await activateWithViews();
    await firstSession(h.sidebar);
    await h.run("portaterm.ctx.zoomPane", { paneSessionId: "gone" });
    expect(zoomPosts(h.sidebar)).toEqual([]);
    expect(zoomPosts(h.panel)).toEqual([]);
  });
});
