// @vitest-environment jsdom
// src/extension.vaultMarks.test.ts — stars and tags as `activate` wires them.
//
// The registry, the overlay and the message handlers each have their own tests;
// this owns the seams between them in the shipped `activate`: a star posted by
// one vault surface is persisted to globalState, and every resolved surface —
// the one that posted it included — is pushed a list that carries it.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000 });

beforeAll(async () => {
  await import("./extension");
}, 120_000);

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vault-marks-")));
// A private Claude config dir with one real transcript, so the vault has a row
// to mark. Worker-local env: the suite's shared HOME is never written.
const CLAUDE_DIR = path.join(TMP, "claude");
const savedClaudeDir = process.env.CLAUDE_CONFIG_DIR;
fs.cpSync(path.join(__dirname, "vault/__fixtures__/claude/projects"), path.join(CLAUDE_DIR, "projects"), {
  recursive: true,
});
process.env.CLAUDE_CONFIG_DIR = CLAUDE_DIR;
afterAll(() => {
  if (savedClaudeDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR;
  } else {
    process.env.CLAUDE_CONFIG_DIR = savedClaudeDir;
  }
  fs.rmSync(TMP, { recursive: true, force: true });
});

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
  posted: unknown[];
}

type ListPush = { type: "vaultSessionsResponse"; result: { entries: Array<{ id: string; starred?: boolean }> } };

function lastList(surface: Surface): ListPush | undefined {
  return surface.posted.filter((m): m is ListPush => (m as { type?: string }).type === "vaultSessionsResponse").at(-1);
}

async function activateWithViews(globalState: Map<string, unknown>) {
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

  const providers = new Map<string, { resolveWebviewView(view: unknown, ctx: unknown, token: unknown): unknown }>();
  vi.spyOn(vscode.window, "registerWebviewViewProvider").mockImplementation((viewType, provider) => {
    providers.set(viewType, provider as never);
    return { dispose: () => {} };
  });

  subscriptions = [];
  await activate({
    extensionUri: { fsPath: "/mock/extension" },
    subscriptions,
    globalState: {
      get: (k: string) => globalState.get(k),
      update: async (k: string, v: unknown) => {
        globalState.set(k, v);
      },
      keys: () => [...globalState.keys()],
    },
    workspaceState: { get: () => undefined, update: async () => {}, keys: () => [] },
    globalStorageUri: { fsPath: path.join(TMP, "storage") },
    storageUri: { fsPath: path.join(TMP, "workspace-storage") },
    extensionPath: "/mock/extension",
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
    const posted: unknown[] = [];
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
          postMessage: async (msg: unknown) => {
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
  return { sidebar: resolve("portaterm.sidebar"), panel: resolve("portaterm.panel") };
}

describe("vault stars as activate wires them", () => {
  it("persists a star and pushes the starred list to every surface", async () => {
    const globalState = new Map<string, unknown>();
    const { sidebar, panel } = await activateWithViews(globalState);
    sidebar.send({ type: "requestVaultSessions" });
    await vi.waitFor(() => expect(lastList(sidebar)?.result.entries.map((e) => e.id)).toContain("claude:sess-valid"), {
      timeout: 10_000,
    });

    sidebar.send({ type: "vaultSetStarred", entryId: "claude:sess-valid", starred: true });

    expect(globalState.get("portaterm.vaultMarks")).toEqual({ "claude:sess-valid": { starred: true } });
    for (const surface of [sidebar, panel]) {
      await vi.waitFor(() =>
        expect(lastList(surface)?.result.entries.find((e) => e.id === "claude:sess-valid")?.starred).toBe(true),
      );
    }
  });

  it("serves a star persisted by an earlier window", async () => {
    const globalState = new Map<string, unknown>([
      ["portaterm.vaultMarks", { "claude:sess-valid": { starred: true } }],
    ]);
    const { sidebar } = await activateWithViews(globalState);
    sidebar.send({ type: "requestVaultSessions" });
    await vi.waitFor(
      () => expect(lastList(sidebar)?.result.entries.find((e) => e.id === "claude:sess-valid")?.starred).toBe(true),
      { timeout: 10_000 },
    );
  });
});
