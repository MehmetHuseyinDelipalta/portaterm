// @vitest-environment jsdom
// src/extension.insertPath.test.ts — "Insert Path in Portaterm" as `activate` wires it.
//
// `src/utils/shellEscape.test.ts` owns the quoting (and proves it against real
// shells); this owns that the shipped command quotes EVERY path it is handed
// with it and types the result into the focused view's active pane — so a
// path such as `C#/notes.md` reaches the shell as itself, not as `C/notes.md`.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000 });

/** Every byte the extension wrote to a PTY, by session. */
const ptyWrites = vi.hoisted(() => [] as Array<{ id: string; data: string }>);

// Panes need sessions, and sessions need a pty: the shared stand-ins spawn
// nothing. The session stand-in additionally records what it is written.
vi.mock("./pty/PtyManager", async () => (await import("./test/sessionMocks")).ptyManagerMock());
vi.mock("./pty/PtySession", async () => {
  const { PtySession } = (await import("./test/sessionMocks")).ptySessionMock();
  class RecordingPtySession extends PtySession {
    constructor(id: string) {
      super(id);
      this.write = vi.fn((data: string) => {
        ptyWrites.push({ id, data });
      });
    }
  }
  return { PtySession: RecordingPtySession };
});

beforeAll(async () => {
  await import("./extension");
}, 120_000);

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "insert-path-")));
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
  ptyWrites.length = 0;
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

const uri = (fsPath: string) => ({ fsPath, scheme: "file" });
const writesTo = (id: string) => ptyWrites.filter((w) => w.id === id).map((w) => w.data);

describe("portaterm.insertPath as activate wires it", () => {
  it("types every selected path, quoted as itself, into the focused view's active pane", async () => {
    const h = await activateWithViews();
    const session = await firstSession(h.sidebar);

    const picked = ["/proj/C#/notes.md", "/proj/report$1.txt", String.raw`/proj/a\b`, "/proj/it's here"];
    await h.run("portaterm.insertPath", uri(picked[0]), picked.map(uri));

    expect(writesTo(session)).toEqual([
      String.raw`'/proj/C#/notes.md' '/proj/report$1.txt' '/proj/a\b' '/proj/it'\''s here' `,
    ]);
  });

  it("types a single right-clicked path when no multi-selection comes with it", async () => {
    const h = await activateWithViews();
    const session = await firstSession(h.sidebar);

    // The editor-tab menu passes a non-array second argument.
    await h.run("portaterm.insertPath", uri("/proj/$(whoami)/x;y.ts"), {});

    expect(writesTo(session)).toEqual(["'/proj/$(whoami)/x;y.ts' "]);
  });

  it("falls back to the active editor's file from the palette", async () => {
    const h = await activateWithViews();
    const session = await firstSession(h.sidebar);
    const vscode = await import("./test/__mocks__/vscode");
    (vscode.window as Record<string, unknown>).activeTextEditor = { document: { uri: uri("/proj/~draft#1.md") } };

    await h.run("portaterm.insertPath");

    expect(writesTo(session)).toEqual(["'/proj/~draft#1.md' "]);
  });

  it("quotes for the pane's shell: PowerShell doubles a quote instead of the POSIX '\\''", async () => {
    const h = await activateWithViews();
    const ptyManager = await import("./pty/PtyManager");
    vi.mocked(ptyManager.detectShell).mockReturnValue({ shell: "/opt/homebrew/bin/pwsh", args: [] });
    const session = await firstSession(h.sidebar);

    await h.run("portaterm.insertPath", uri("/proj/O'Brien/a b.txt"), {});

    expect(writesTo(session)).toEqual(["'/proj/O''Brien/a b.txt' "]);
  });

  it("quotes for cmd with double quotes, so a path with spaces stays one word", async () => {
    const h = await activateWithViews();
    const ptyManager = await import("./pty/PtyManager");
    vi.mocked(ptyManager.detectShell).mockReturnValue({ shell: "C:\\Windows\\System32\\cmd.exe", args: [] });
    const session = await firstSession(h.sidebar);

    await h.run("portaterm.insertPath", uri("C:\\Program Files\\a.txt"), {});

    expect(writesTo(session)).toEqual(['"C:\\Program Files\\a.txt" ']);
  });
});
