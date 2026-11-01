// @vitest-environment jsdom
// src/extension.vaultSessionRefresh.test.ts — how often activation's wiring
// reads the process table for the vault's pinned and open sets (C3, C4).
//
// The table, the presence deps and the vault publishers are wrapped, not
// replaced: each records what activation handed it and then does its real job.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000 });

vi.mock("./pty/PtyManager", async () => (await import("./test/sessionMocks")).ptyManagerMock());
vi.mock("./pty/PtySession", async () => (await import("./test/sessionMocks")).ptySessionMock());

const seen = vi.hoisted(() => ({
  tables: [] as unknown[],
  presenceTables: [] as unknown[],
  lookupTables: [] as unknown[],
  publishers: [] as Array<{ delayMs?: number; computed: number }>,
}));

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

vi.mock("./pty/processTableSnapshot", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./pty/processTableSnapshot")>();
  return {
    ...actual,
    createProcessTableSnapshot: (...args: Parameters<typeof actual.createProcessTableSnapshot>) => {
      const table = actual.createProcessTableSnapshot(...args);
      seen.tables.push(table);
      return table;
    },
  };
});

vi.mock("./worktree/presenceDeps", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./worktree/presenceDeps")>();
  return {
    ...actual,
    createPresenceProjectorDeps: (options: Parameters<typeof actual.createPresenceProjectorDeps>[0]) => {
      seen.presenceTables.push(options.table);
      return actual.createPresenceProjectorDeps(options);
    },
  };
});

vi.mock("./vault/pinnedVaultSessions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./vault/pinnedVaultSessions")>();
  return {
    ...actual,
    createClaudeProcessLookup: (deps: Parameters<typeof actual.createClaudeProcessLookup>[0]) => {
      seen.lookupTables.push(deps.table);
      return actual.createClaudeProcessLookup(deps);
    },
    createPinnedVaultPublisher: (deps: Parameters<typeof actual.createPinnedVaultPublisher>[0]) => {
      const record = { delayMs: deps.delayMs, computed: 0 };
      seen.publishers.push(record);
      return actual.createPinnedVaultPublisher({
        ...deps,
        compute: () => {
          record.computed++;
          return deps.compute();
        },
      });
    },
  };
});

beforeAll(async () => {
  await import("./extension");
}, 120_000);

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vault-session-refresh-")));
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
  return { ready, initPosted };
}

beforeEach(() => {
  seen.tables.length = 0;
  seen.presenceTables.length = 0;
  seen.lookupTables.length = 0;
  seen.publishers.length = 0;
});

describe("vault session refresh wiring", () => {
  it("reads one process table for presence and the vault's sets alike", async () => {
    await activateSidebar();
    expect(seen.tables).toHaveLength(1);
    expect(seen.presenceTables).toEqual([seen.tables[0]]);
    expect(seen.lookupTables).toEqual([seen.tables[0]]);
  });

  it("gathers the pinned and open sets' refreshes for 300 ms", async () => {
    const { VAULT_SESSION_REFRESH_DELAY_MS } = await import("./vault/pinnedVaultSessions");
    await activateSidebar();
    expect(seen.publishers.map((p) => p.delayMs)).toEqual([
      VAULT_SESSION_REFRESH_DELAY_MS,
      VAULT_SESSION_REFRESH_DELAY_MS,
    ]);
  });

  it("still recomputes the sets once a pane appears", async () => {
    const { ready, initPosted } = await activateSidebar();
    ready();
    await vi.waitFor(() => expect(initPosted()).toBe(true));
    await vi.waitFor(() => expect(seen.publishers.every((p) => p.computed > 0)).toBe(true), { timeout: 3000 });
  });
});
