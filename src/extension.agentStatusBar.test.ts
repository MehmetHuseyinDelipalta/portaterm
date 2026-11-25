// @vitest-environment jsdom
// src/extension.agentStatusBar.test.ts — the status bar entry as `activate` wires it.
//
// `agentStatusBar.test.ts` owns what the entry says and what a click decides;
// this owns that the shipped `activate` puts that in front of the user: the
// entry is there from the start, a click on it reaches a registered command,
// and that command lands on a real Portaterm view.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GO_TO_AGENT_COMMAND, LAST_OPENED_VIEW_KEY, OPEN_COMMAND } from "./session/agentStatusBar";

// Every test re-imports and re-activates the whole extension; under full-suite
// load that is slower than Vitest's 5s default.
vi.setConfig({ testTimeout: 30_000 });

beforeAll(async () => {
  await import("./extension");
}, 120_000);

// Real directories: `deactivate` flushes snapshots into workspace storage, and a
// path nothing can create turns every teardown into a logged ENOENT.
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agent-status-")));
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

interface StatusItem {
  id: string | undefined;
  name: string | undefined;
  text: string;
  tooltip: unknown;
  command: unknown;
  visible: boolean;
}

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

interface ActivateOptions {
  /** What global state holds when the window starts: what an earlier window left. */
  stored?: Record<string, unknown>;
  /** The user's `portaterm.*` settings. */
  settings?: Record<string, unknown>;
}

async function activateExtension(options: ActivateOptions = {}) {
  const { activate, deactivate } = await import("./extension");
  teardown = deactivate;
  const vscode = await import("./test/__mocks__/vscode");
  vscode.__resetAll();
  vscode.__setConfigValues(options.settings ?? {});
  const stored = new Map<string, unknown>(Object.entries(options.stored ?? {}));
  const globalUpdates: Array<[string, unknown]> = [];
  const globalState = {
    get: (key: string) => stored.get(key),
    update: async (key: string, value: unknown) => {
      globalUpdates.push([key, value]);
      stored.set(key, value);
    },
    keys: () => [...stored.keys()],
  };
  const viewProviders = new Map<string, { resolveWebviewView(view: unknown, ctx: unknown, token: unknown): unknown }>();
  vi.spyOn(vscode.window, "registerWebviewViewProvider").mockImplementation((viewType, provider) => {
    viewProviders.set(viewType, provider as never);
    return { dispose: () => {} };
  });
  (vscode.extensions as { onDidChange?: unknown }).onDidChange = () => ({ dispose: () => {} });
  const win = vscode.window as Record<string, unknown>;
  win.state ??= { focused: true, active: true };
  win.onDidChangeWindowState ??= () => ({ dispose: () => {} });
  win.tabGroups ??= { all: [], onDidChangeTabs: () => ({ dispose: () => {} }) };
  // The store watchers a resolved view starts are not under test; a quiet stand-in keeps the log readable.
  (vscode.workspace as Record<string, unknown>).createFileSystemWatcher = () => ({
    onDidCreate: () => ({ dispose: () => {} }),
    onDidChange: () => ({ dispose: () => {} }),
    onDidDelete: () => ({ dispose: () => {} }),
    dispose: () => {},
  });

  const items: StatusItem[] = [];
  vi.spyOn(vscode.window, "createStatusBarItem").mockImplementation((id?: string) => {
    const item: StatusItem & { show(): void; hide(): void; dispose(): void; backgroundColor: unknown } = {
      id,
      name: undefined,
      text: "",
      tooltip: undefined,
      command: undefined,
      backgroundColor: undefined,
      visible: false,
      show: () => {
        item.visible = true;
      },
      hide: () => {
        item.visible = false;
      },
      dispose: () => {},
    };
    items.push(item);
    return item;
  });
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  vi.spyOn(vscode.commands, "registerCommand").mockImplementation((command, callback) => {
    handlers.set(command, callback);
    return { dispose: () => handlers.delete(command) };
  });
  const executed: string[] = [];
  vi.spyOn(vscode.commands, "executeCommand").mockImplementation(async (command: string, ...args: unknown[]) => {
    executed.push(command);
    // Commands this extension registered run for real, as the editor would run them.
    await handlers.get(command)?.(...args);
  });
  const quickPick = vi.spyOn(vscode.window, "showQuickPick");

  subscriptions = [];
  await activate({
    extensionUri: { fsPath: "/mock/extension" },
    subscriptions,
    globalState,
    workspaceState: { get: () => undefined, update: async () => {}, keys: () => [] },
    globalStorageUri: { fsPath: path.join(TMP, "storage") },
    storageUri: { fsPath: path.join(TMP, "workspace-storage") },
    extensionPath: "/mock/extension",
    logUri: { fsPath: path.join(TMP, "log") },
    secrets: { get: async () => undefined, store: async () => {}, delete: async () => {} },
    environmentVariableCollection: { replace: () => {}, append: () => {}, prepend: () => {}, clear: () => {} },
  } as never);

  const entry = items.find((item) => item.id === "portaterm.agentStatus");
  if (entry === undefined) {
    throw new Error("activate did not create the agent status entry");
  }
  const run = async (command: string) => {
    const handler = handlers.get(command);
    if (handler === undefined) {
      throw new Error(`${command} is not registered`);
    }
    executed.length = 0;
    await handler();
  };
  // A view as the editor resolves it: hidden until shown, its webview able to
  // post focus and blur as the real one does.
  const resolveView = (viewType: string) => {
    const provider = viewProviders.get(viewType);
    if (provider === undefined) {
      throw new Error(`activate registered no ${viewType} provider`);
    }
    const messageHandlers: Array<(msg: unknown) => void> = [];
    const visibilityHandlers: Array<() => void> = [];
    const view = {
      visible: false,
      viewType,
      webview: {
        html: "",
        options: {},
        cspSource: "https://mock.csp.source",
        asWebviewUri: (uri: { fsPath: string }) => uri.fsPath,
        onDidReceiveMessage: (handler: (msg: unknown) => void) => {
          messageHandlers.push(handler);
          return { dispose: () => {} };
        },
        postMessage: async () => true,
      },
      onDidDispose: () => ({ dispose: () => {} }),
      onDidChangeVisibility: (handler: () => void) => {
        visibilityHandlers.push(handler);
        return { dispose: () => {} };
      },
      show: () => {},
    };
    provider.resolveWebviewView(view, {}, { isCancellationRequested: false, onCancellationRequested: () => {} });
    return {
      setVisible(visible: boolean) {
        view.visible = visible;
        for (const handler of visibilityHandlers) {
          handler();
        }
      },
      post(msg: unknown) {
        for (const handler of messageHandlers) {
          handler(msg);
        }
      },
    };
  };
  return { entry, executed, run, quickPick, resolveView, stored, globalUpdates };
}

describe("the agent status entry as activate wires it", () => {
  // The entry exists only once `activate` runs. A workspace that never opened a
  // Portaterm view or ran one of its commands would otherwise never activate it.
  it("activates on startup, so the entry is there before any view has opened", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")) as {
      activationEvents: string[];
    };
    expect(manifest.activationEvents).toContain("onStartupFinished");
  });

  it("is shown from the start as the bare name, and a click on it opens Portaterm", async () => {
    const h = await activateExtension();
    expect(h.entry).toMatchObject({ name: "Portaterm", text: "Portaterm", command: OPEN_COMMAND, visible: true });
  });

  it("opens the sidebar view until the user has worked in either one", async () => {
    const h = await activateExtension();
    await h.run(OPEN_COMMAND);
    expect(h.executed).toEqual(["portaterm.sidebar.focus"]);
  });

  it("opens Portaterm without a pick when Go to Agent finds no agent", async () => {
    const h = await activateExtension();
    await h.run(GO_TO_AGENT_COMMAND);
    expect(h.quickPick).not.toHaveBeenCalled();
    expect(h.executed).toEqual([OPEN_COMMAND, "portaterm.sidebar.focus"]);
  });
});

describe("where a click on the bare entry opens Portaterm", () => {
  it("goes back to the panel an earlier window last opened, not the sidebar", async () => {
    const h = await activateExtension({ stored: { [LAST_OPENED_VIEW_KEY]: "portaterm.panel" } });
    await h.run(OPEN_COMMAND);
    expect(h.executed).toEqual(["portaterm.panel.focus"]);
  });

  it("remembers the panel once its webview takes focus, and the sidebar once it is shown", async () => {
    const h = await activateExtension();
    const panel = h.resolveView("portaterm.panel");
    const sidebar = h.resolveView("portaterm.sidebar");

    panel.post({ type: "focus" });
    expect(h.stored.get(LAST_OPENED_VIEW_KEY)).toBe("portaterm.panel");
    await h.run(OPEN_COMMAND);
    expect(h.executed).toEqual(["portaterm.panel.focus"]);

    sidebar.setVisible(true);
    expect(h.stored.get(LAST_OPENED_VIEW_KEY)).toBe("portaterm.sidebar");
    await h.run(OPEN_COMMAND);
    expect(h.executed).toEqual(["portaterm.sidebar.focus"]);
  });

  it("remembers the panel once it is shown", async () => {
    const h = await activateExtension({ stored: { [LAST_OPENED_VIEW_KEY]: "portaterm.sidebar" } });
    h.resolveView("portaterm.panel").setVisible(true);
    expect(h.stored.get(LAST_OPENED_VIEW_KEY)).toBe("portaterm.panel");
  });

  it("does not rewrite global state when the view on record is opened again", async () => {
    const h = await activateExtension({ stored: { [LAST_OPENED_VIEW_KEY]: "portaterm.panel" } });
    const panel = h.resolveView("portaterm.panel");
    panel.post({ type: "focus" });
    panel.setVisible(true);
    expect(h.globalUpdates).toEqual([]);
  });

  it("opens the view the setting pins, whatever was opened last", async () => {
    const pinnedSidebar = await activateExtension({
      settings: { "portaterm.statusBar.openLocation": "sidebar" },
      stored: { [LAST_OPENED_VIEW_KEY]: "portaterm.panel" },
    });
    await pinnedSidebar.run(OPEN_COMMAND);
    expect(pinnedSidebar.executed).toEqual(["portaterm.sidebar.focus"]);
    await teardown?.();
    teardown = undefined;

    const pinnedPanel = await activateExtension({ settings: { "portaterm.statusBar.openLocation": "panel" } });
    await pinnedPanel.run(OPEN_COMMAND);
    expect(pinnedPanel.executed).toEqual(["portaterm.panel.focus"]);
  });
});
