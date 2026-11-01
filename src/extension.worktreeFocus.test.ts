// @vitest-environment jsdom
// src/extension.worktreeFocus.test.ts — activation hands the worktree host this
// window's focus, so its external scan slows down while the window is not
// focused (perf C5). The host is wrapped, not replaced: it records the options
// activation gave it and then does its real job.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000 });

vi.mock("./pty/PtyManager", async () => (await import("./test/sessionMocks")).ptyManagerMock());
vi.mock("./pty/PtySession", async () => (await import("./test/sessionMocks")).ptySessionMock());

const seen = vi.hoisted(() => ({
  hostOptions: [] as Array<{ windowFocus?: { focused(): boolean; onDidChange(l: (f: boolean) => void): unknown } }>,
}));
const focusListeners: Array<(state: { focused: boolean }) => void> = [];

vi.mock("./agentHooks/AgentHookController", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./agentHooks/AgentHookController")>();
  class IdleAgentHookController {
    start(): Promise<void> {
      return Promise.resolve();
    }
    setDesiredEnabled() {
      return Promise.resolve({ success: true });
    }
    dispose(): void {}
  }
  return { ...actual, AgentHookController: IdleAgentHookController };
});

vi.mock("./providers/WorktreeHost", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./providers/WorktreeHost")>();
  return {
    ...actual,
    createWorktreeHost: (options: Parameters<typeof actual.createWorktreeHost>[0]) => {
      seen.hostOptions.push(options as never);
      return actual.createWorktreeHost(options);
    },
  };
});

beforeAll(async () => {
  await import("./extension");
}, 120_000);

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "worktree-focus-")));
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

let subscriptions: Array<{ dispose(): unknown }> = [];
let teardown: (() => Promise<void> | void) | undefined;

beforeEach(() => {
  vi.resetModules();
});

afterEach(async () => {
  await teardown?.();
  teardown = undefined;
  for (const subscription of subscriptions.splice(0)) {
    subscription.dispose();
  }
  vi.restoreAllMocks();
});

async function activateSidebar() {
  const { activate, deactivate } = await import("./extension");
  teardown = deactivate;
  const vscode = await import("./test/__mocks__/vscode");
  vscode.__resetAll();
  (vscode.extensions as { onDidChange?: unknown }).onDidChange = () => ({ dispose: () => {} });
  const win = vscode.window as Record<string, unknown>;
  win.state = { focused: true, active: true };
  win.onDidChangeWindowState = (listener: (state: { focused: boolean }) => void) => {
    focusListeners.push(listener);
    return { dispose: () => focusListeners.splice(focusListeners.indexOf(listener), 1) };
  };
  win.tabGroups ??= { all: [], onDidChangeTabs: () => ({ dispose: () => {} }) };
  (vscode.workspace as Record<string, unknown>).createFileSystemWatcher = () => ({
    onDidCreate: () => ({ dispose: () => {} }),
    onDidChange: () => ({ dispose: () => {} }),
    onDidDelete: () => ({ dispose: () => {} }),
    dispose: () => {},
  });
  const providers = new Map<string, { resolveWebviewView(view: unknown, ctx: unknown, token: unknown): unknown }>();
  vi.spyOn(vscode.window, "registerWebviewViewProvider").mockImplementation((viewType, provider) => {
    providers.set(viewType, provider as never);
    return { dispose: () => {} };
  });

  subscriptions = [];
  await activate({
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

  const provider = providers.get("portaterm.sidebar");
  if (!provider) {
    throw new Error("activate registered no sidebar provider");
  }
  const handlers: Array<(msg: unknown) => void> = [];
  const posted: Array<{ type?: string }> = [];
  provider.resolveWebviewView(
    {
      visible: true,
      viewType: "portaterm.sidebar",
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
  const ready = () => {
    for (const h of handlers) {
      h({ type: "ready" });
    }
  };
  const initPosted = () => posted.some((m) => m.type === "init");
  return { ready, initPosted };
}

beforeEach(() => {
  seen.hostOptions.length = 0;
  focusListeners.length = 0;
});

describe("worktree host focus wiring", () => {
  it("reads the window's focus from VS Code when it asks", async () => {
    await activateSidebar();
    const vscode = await import("./test/__mocks__/vscode");
    const focus = seen.hostOptions[0]?.windowFocus;
    expect(focus?.focused()).toBe(true);
    (vscode.window as Record<string, unknown>).state = { focused: false, active: true };
    expect(focus?.focused()).toBe(false);
  });

  it("passes VS Code's focus changes on as booleans", async () => {
    await activateSidebar();
    const heard: boolean[] = [];
    const before = focusListeners.length;
    const subscription = seen.hostOptions[0]?.windowFocus?.onDidChange((focused) => heard.push(focused)) as {
      dispose(): void;
    };
    expect(focusListeners.length).toBe(before + 1);
    for (const listener of [...focusListeners]) {
      listener({ focused: false });
    }
    expect(heard).toContain(false);
    subscription.dispose();
    expect(focusListeners.length).toBe(before);
  });
});
