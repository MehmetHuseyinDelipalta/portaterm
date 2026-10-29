// @vitest-environment jsdom
// src/extension.tabAppearance.test.ts — Change Tab Color… / Change Tab Icon… as `activate` wires them.
//
// `tabAppearanceCommands.test.ts` owns the QuickPick and what a choice writes;
// this owns that the shipped `activate` registers both doors, shows VS Code's
// QuickPick, and lands the choice on the right session — and that the webview
// holding it, and only that one, hears it, now and on its next init.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TAB_APPEARANCE_COMMAND_IDS } from "./commands/tabAppearanceCommands";

vi.setConfig({ testTimeout: 30_000 });

// Panes need sessions, and sessions need a pty: the shared stand-ins spawn nothing.
vi.mock("./pty/PtyManager", async () => (await import("./test/sessionMocks")).ptyManagerMock());
vi.mock("./pty/PtySession", async () => (await import("./test/sessionMocks")).ptySessionMock());

beforeAll(async () => {
  await import("./extension");
}, 120_000);

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tab-appearance-")));
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

const appearancePosts = (surface: Surface) => surface.posted.filter((m) => m.type === "tabAppearance");

type ShownItem = { label: string; value: unknown; iconPath: { id: string } };

/** Answer VS Code's QuickPick with the entry labelled `label`, recording what it showed. */
async function answerQuickPick(label: string | undefined) {
  const vscode = await import("./test/__mocks__/vscode");
  const shown: Array<{ items: ShownItem[]; options: unknown }> = [];
  vi.spyOn(vscode.window, "showQuickPick").mockImplementation((async (items: ShownItem[], options: unknown) => {
    shown.push({ items, options });
    return items.find((item) => item.label === label);
  }) as never);
  return { shown, ThemeIcon: vscode.ThemeIcon };
}

describe("tab color and icon as activate wires them", () => {
  it("registers both commands", async () => {
    const h = await activateWithViews();
    for (const id of TAB_APPEARANCE_COMMAND_IDS) {
      expect(h.commands.has(id)).toBe(true);
    }
  });

  it("a right-click's color lands on that tab, in the webview holding it only", async () => {
    const h = await activateWithViews();
    await firstSession(h.sidebar);
    const panelSession = await firstSession(h.panel);
    const pick = await answerQuickPick("Red");

    await h.run("portaterm.setTabColor", { tabId: panelSession });

    expect(pick.shown).toHaveLength(1);
    expect(pick.shown[0].options).toEqual({ placeHolder: "Select a color for the tab" });
    // A swatch file the package ships, not a colored ThemeIcon: Cursor drops the color.
    const red = pick.shown[0].items.find((item) => item.label === "Red")! as unknown as {
      iconPath: { fsPath: string };
    };
    expect(red.iconPath.fsPath).toBe(path.resolve(__dirname, "..", "media", "tab-colors", "red.svg"));
    expect(fs.existsSync(red.iconPath.fsPath)).toBe(true);
    expect(appearancePosts(h.panel)).toEqual([
      { type: "tabAppearance", tabId: panelSession, tabColor: "red", tabIcon: null },
    ]);
    expect(appearancePosts(h.sidebar)).toEqual([]);
  });

  it("an icon keeps the color, and the next init carries both", async () => {
    const h = await activateWithViews();
    const session = await firstSession(h.sidebar);
    await answerQuickPick("Cyan");
    await h.run("portaterm.setTabColor", { tabId: session });
    const pick = await answerQuickPick("Database");
    await h.run("portaterm.setTabIcon", { tabId: session });

    const database = pick.shown[0].items.find((item) => item.label === "Database")!;
    expect(database.iconPath).toBeInstanceOf(pick.ThemeIcon);
    expect(database.iconPath.id).toBe("database");
    expect(appearancePosts(h.sidebar).at(-1)).toEqual({
      type: "tabAppearance",
      tabId: session,
      tabColor: "cyan",
      tabIcon: "database",
    });

    // A reloaded webview asks again; its init must not lose what the tab wears.
    h.sidebar.posted.length = 0;
    h.sidebar.send({ type: "ready" });
    await vi.waitFor(() => {
      const init = h.sidebar.posted.find((m) => m.type === "init") as
        | { tabs: Array<{ id: string; tabColor?: string; tabIcon?: string }> }
        | undefined;
      expect(init?.tabs.find((tab) => tab.id === session)).toMatchObject({ tabColor: "cyan", tabIcon: "database" });
    });
  });

  it("No Color clears, and a dismissed pick posts nothing", async () => {
    const h = await activateWithViews();
    const session = await firstSession(h.sidebar);
    await answerQuickPick("Green");
    await h.run("portaterm.setTabColor", { tabId: session });
    await answerQuickPick("No Color");
    await h.run("portaterm.setTabColor", { tabId: session });
    await answerQuickPick(undefined);
    await h.run("portaterm.setTabIcon", { tabId: session });

    expect(appearancePosts(h.sidebar)).toEqual([
      { type: "tabAppearance", tabId: session, tabColor: "green", tabIcon: null },
      { type: "tabAppearance", tabId: session, tabColor: null, tabIcon: null },
    ]);
  });

  it("from the palette, reaches the active tab of the view focused last", async () => {
    const h = await activateWithViews();
    await firstSession(h.sidebar);
    const panelSession = await firstSession(h.panel);
    await answerQuickPick("Rocket");
    h.sidebar.send({ type: "focus" });
    h.panel.send({ type: "focus" });

    await h.run("portaterm.setTabIcon");

    expect(appearancePosts(h.panel)).toEqual([
      { type: "tabAppearance", tabId: panelSession, tabColor: null, tabIcon: "rocket" },
    ]);
    expect(appearancePosts(h.sidebar)).toEqual([]);
  });

  it("from the palette, prefers a focused editor-area terminal over the views", async () => {
    const h = await activateWithViews();
    await firstSession(h.sidebar);
    await h.run("portaterm.newTerminalInEditor");
    const editor = h.editors[0];
    if (!editor) {
      throw new Error("newTerminalInEditor opened no panel");
    }
    const editorSession = await firstSession(editor);
    await answerQuickPick("Yellow");

    await h.run("portaterm.setTabColor");

    expect(appearancePosts(editor)).toEqual([
      { type: "tabAppearance", tabId: editorSession, tabColor: "yellow", tabIcon: null },
    ]);
    expect(appearancePosts(h.sidebar)).toEqual([]);
  });

  it("shows no QuickPick for a split pane: color and icon belong to its tab", async () => {
    const h = await activateWithViews();
    const tabId = await firstSession(h.sidebar);
    h.sidebar.send({
      type: "requestSplitSession",
      requestId: "split-1",
      direction: "vertical",
      sourceTabId: tabId,
      sourcePaneId: tabId,
    });
    let paneId: string | undefined;
    await vi.waitFor(
      () => {
        const msg = h.sidebar.posted.find((m) => m.type === "splitPaneCreated") as
          | { newSessionId?: string }
          | undefined;
        paneId = msg?.newSessionId;
        expect(paneId).toBeTypeOf("string");
      },
      { timeout: 10_000 },
    );
    const pick = await answerQuickPick("Red");

    await h.run("portaterm.setTabColor", { tabId: paneId });

    expect(pick.shown).toEqual([]);
    expect(appearancePosts(h.sidebar)).toEqual([]);
  });

  it("shows no QuickPick for a tab that no longer exists", async () => {
    const h = await activateWithViews();
    await firstSession(h.sidebar);
    const pick = await answerQuickPick("Red");
    await h.run("portaterm.setTabColor", { tabId: "gone" });
    expect(pick.shown).toEqual([]);
    expect(appearancePosts(h.sidebar)).toEqual([]);
  });
});
