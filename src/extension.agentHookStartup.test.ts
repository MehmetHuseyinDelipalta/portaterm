// @vitest-environment jsdom
// src/extension.agentHookStartup.test.ts — activation does not wait for the
// agent-hook runtime (C2), yet the first terminals still carry its environment.
//
// The controller is replaced by one whose `start()` the test settles, so the
// order of activation, hook startup and the first spawn is driven, not hoped for.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000 });

vi.mock("./pty/PtyManager", async () => (await import("./test/sessionMocks")).ptyManagerMock());
vi.mock("./pty/PtySession", async () => (await import("./test/sessionMocks")).ptySessionMock());

const hooks = vi.hoisted(() => ({
  start: (): Promise<void> => Promise.resolve(),
  options: undefined as undefined | { setContributor(c: unknown): void },
}));

vi.mock("./agentHooks/AgentHookController", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./agentHooks/AgentHookController")>();
  class ControlledAgentHookController {
    constructor(options: { setContributor(c: unknown): void }) {
      hooks.options = options;
    }
    start(): Promise<void> {
      return hooks.start();
    }
    setDesiredEnabled() {
      return Promise.resolve({ success: true });
    }
    dispose(): void {}
  }
  return { ...actual, AgentHookController: ControlledAgentHookController };
});

beforeAll(async () => {
  await import("./extension");
}, 120_000);

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agent-hook-startup-")));
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

function deferred() {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function activateSidebar() {
  const { activate, deactivate, AGENT_HOOK_SPAWN_WAIT_MS } = await import("./extension");
  teardown = deactivate;
  const vscode = await import("./test/__mocks__/vscode");
  vscode.__resetAll();
  (vscode.extensions as { onDidChange?: unknown }).onDidChange = () => ({ dispose: () => {} });
  const win = vscode.window as Record<string, unknown>;
  win.state ??= { focused: true, active: true };
  win.onDidChangeWindowState ??= () => ({ dispose: () => {} });
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
  return { ready, initPosted, AGENT_HOOK_SPAWN_WAIT_MS };
}

/** Let every queued microtask and a few macrotasks run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("agent hooks at activation", () => {
  it("registers the views without waiting for the hook runtime", async () => {
    hooks.start = () => new Promise<void>(() => {}); // never settles
    const view = await activateSidebar();
    expect(view.initPosted()).toBe(false); // activation returned, and the view exists
  });

  it("holds the first spawn until the hook runtime is up, and gives that shell its environment", async () => {
    const started = deferred();
    hooks.start = () => started.promise;
    const { ready, initPosted } = await activateSidebar();

    ready();
    await settle();
    expect(initPosted()).toBe(false);

    // The runtime reconciled and attached its contributor, then finished starting.
    const create = vi.fn(() => ({ PORTATERM_TEST_HOOK: "token" }));
    hooks.options?.setContributor({ create, release: vi.fn() });
    started.resolve();

    await vi.waitFor(() => expect(initPosted()).toBe(true));
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("spawns anyway once the wait runs out", async () => {
    hooks.start = () => new Promise<void>(() => {});
    const { ready, initPosted, AGENT_HOOK_SPAWN_WAIT_MS } = await activateSidebar();
    const before = Date.now();

    ready();
    await vi.waitFor(() => expect(initPosted()).toBe(true), { timeout: AGENT_HOOK_SPAWN_WAIT_MS + 3000 });
    expect(Date.now() - before).toBeGreaterThanOrEqual(AGENT_HOOK_SPAWN_WAIT_MS - 50);
  });

  it("does not fail activation, or hold the terminals, when hook startup fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const started = deferred();
    hooks.start = () => started.promise;
    const { ready, initPosted } = await activateSidebar();
    started.reject(new Error("lock timeout"));

    ready();
    await vi.waitFor(() => expect(initPosted()).toBe(true));
    expect(warn).toHaveBeenCalledWith(
      "[Portaterm] Agent hook startup failed — continuing without hook observability:",
      expect.any(Error),
    );
  });

  it("does not wait at all once the runtime is up", async () => {
    hooks.start = () => Promise.resolve();
    const { ready, initPosted } = await activateSidebar();
    await settle();

    ready();
    await settle();
    expect(initPosted()).toBe(true);
  });
});
