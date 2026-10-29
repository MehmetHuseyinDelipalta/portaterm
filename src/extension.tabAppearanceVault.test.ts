// @vitest-environment jsdom
// src/extension.tabAppearanceVault.test.ts — a tab's color and icon on the session it runs.
//
// The registry, SessionManager's resume lookup and the vault row each have their
// own tests; this owns the seams in the shipped `activate`: a color set on a tab
// running a vault session is remembered on that session and shown in the vault
// list, a plain shell tab remembers nothing, and a resume — in place or in a new
// tab — opens wearing what the session remembers.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Resumes need sessions, and sessions need a pty: the shared stand-ins spawn nothing.
vi.mock("./pty/PtyManager", async () => (await import("./test/sessionMocks")).ptyManagerMock());
vi.mock("./pty/PtySession", async () => (await import("./test/sessionMocks")).ptySessionMock());

vi.setConfig({ testTimeout: 30_000 });

beforeAll(async () => {
  await import("./extension");
}, 120_000);

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tab-appearance-vault-")));
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

  const commands = new Map<string, (...args: unknown[]) => unknown>();
  vi.spyOn(vscode.commands, "registerCommand").mockImplementation((command, callback) => {
    commands.set(command, callback);
    return { dispose: () => commands.delete(command) };
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
  const run = async (command: string, ...args: unknown[]) => {
    const handler = commands.get(command);
    if (!handler) {
      throw new Error(`${command} is not registered`);
    }
    await handler(...args);
  };
  return { run, sidebar: resolve("portaterm.sidebar"), panel: resolve("portaterm.panel") };
}

const ENTRY = "claude:sess-valid";
type Posted = { type?: string; [key: string]: unknown };
const posts = (surface: Surface, type: string) => (surface.posted as Posted[]).filter((m) => m.type === type);

/** Bring the sidebar up and return its first tab's session. */
async function firstTab(surface: Surface): Promise<string> {
  surface.send({ type: "ready" });
  let id: string | undefined;
  await vi.waitFor(
    () => {
      const init = posts(surface, "init")[0] as { tabs?: Array<{ id: string }> } | undefined;
      id = init?.tabs?.[0]?.id;
      expect(id).toBeTypeOf("string");
    },
    { timeout: 10_000 },
  );
  return id!;
}

async function answerQuickPick(label: string) {
  const vscode = await import("./test/__mocks__/vscode");
  vi.spyOn(vscode.window, "showQuickPick").mockImplementation((async (items: Array<{ label: string }>) =>
    items.find((item) => item.label === label)) as never);
}

describe("a tab's color and icon on the vault session it runs", () => {
  it("remembers them on the session a tab resumed, and the vault list shows them", async () => {
    const globalState = new Map<string, unknown>();
    const h = await activateWithViews(globalState);
    const tab = await firstTab(h.sidebar);
    // The idle first tab takes the resume over in place.
    h.sidebar.send({ type: "vaultResume", entryId: ENTRY });
    await vi.waitFor(() => expect(posts(h.sidebar, "worktreeActivatePane")).toHaveLength(1), { timeout: 10_000 });

    await answerQuickPick("Red");
    await h.run("portaterm.setTabColor", { tabId: tab });
    await answerQuickPick("Rocket");
    await h.run("portaterm.setTabIcon", { tabId: tab });

    expect(globalState.get("portaterm.vaultMarks")).toEqual({ [ENTRY]: { tabColor: "red", tabIcon: "rocket" } });
    h.sidebar.send({ type: "requestVaultSessions" });
    await vi.waitFor(
      () => {
        const list = posts(h.sidebar, "vaultSessionsResponse").at(-1) as
          | { result: { entries: Array<{ id: string; tabColor?: string; tabIcon?: string }> } }
          | undefined;
        expect(list?.result.entries.find((e) => e.id === ENTRY)).toMatchObject({ tabColor: "red", tabIcon: "rocket" });
      },
      { timeout: 10_000 },
    );

    // Clearing on the tab clears the session too.
    await answerQuickPick("No Color");
    await h.run("portaterm.setTabColor", { tabId: tab });
    expect(globalState.get("portaterm.vaultMarks")).toEqual({ [ENTRY]: { tabIcon: "rocket" } });
  });

  it("remembers nothing for a plain shell tab", async () => {
    const globalState = new Map<string, unknown>();
    const h = await activateWithViews(globalState);
    const tab = await firstTab(h.sidebar);
    await answerQuickPick("Green");
    await h.run("portaterm.setTabColor", { tabId: tab });
    expect(posts(h.sidebar, "tabAppearance")).toHaveLength(1);
    expect(globalState.get("portaterm.vaultMarks")).toBeUndefined();
  });

  it("a resume into the idle tab brings back what the session remembers", async () => {
    const globalState = new Map<string, unknown>([
      ["portaterm.vaultMarks", { [ENTRY]: { tabColor: "cyan", tabIcon: "bug" } }],
    ]);
    const h = await activateWithViews(globalState);
    const tab = await firstTab(h.sidebar);
    h.sidebar.send({ type: "vaultResume", entryId: ENTRY });
    await vi.waitFor(
      () =>
        expect(posts(h.sidebar, "tabAppearance")).toEqual([
          { type: "tabAppearance", tabId: tab, tabColor: "cyan", tabIcon: "bug" },
        ]),
      { timeout: 10_000 },
    );
  });

  it("a resume into a new tab opens it wearing what the session remembers", async () => {
    const globalState = new Map<string, unknown>([
      ["portaterm.vaultMarks", { [ENTRY]: { tabColor: "magenta", tabIcon: "server" } }],
    ]);
    const h = await activateWithViews(globalState);
    const tab = await firstTab(h.sidebar);
    // Typed into, the first tab is no longer the idle one a resume takes over.
    h.sidebar.send({ type: "input", tabId: tab, data: "ls" });
    h.sidebar.send({ type: "vaultResume", entryId: ENTRY });
    await vi.waitFor(
      () =>
        expect(posts(h.sidebar, "tabCreated")).toEqual([
          expect.objectContaining({ type: "tabCreated", tabColor: "magenta", tabIcon: "server" }),
        ]),
      { timeout: 10_000 },
    );
    const created = posts(h.sidebar, "tabCreated")[0] as { tabId: string };
    expect(created.tabId).not.toBe(tab);
  });
});
