// @vitest-environment jsdom
// src/extension.flowControlRebind.test.ts — a view re-created under a live
// session must not leave its PTY paused.
//
// `OutputBuffer.test.ts` owns the reset itself; this owns that the shipped
// `activate` reaches it: when the sidebar's webview is re-created (moved to
// another container, reloaded) the provider rebinds the surviving sessions,
// and a PTY paused on output the old page never acked is resumed.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockPtySessions } from "./test/sessionMocks";

vi.setConfig({ testTimeout: 30_000 });

/** Every flow-control call the extension made on a PTY, by session. */
const flow = vi.hoisted(() => [] as Array<{ id: string; call: "pause" | "resume" }>);

// Panes need sessions, and sessions need a pty: the shared stand-ins spawn
// nothing. The session stand-in additionally records pause/resume.
vi.mock("./pty/PtyManager", async () => (await import("./test/sessionMocks")).ptyManagerMock());
vi.mock("./pty/PtySession", async () => {
  const { PtySession } = (await import("./test/sessionMocks")).ptySessionMock();
  class RecordingPtySession extends PtySession {
    constructor(id: string) {
      super(id);
      this.pause = vi.fn(() => {
        flow.push({ id, call: "pause" });
      });
      this.resume = vi.fn(() => {
        flow.push({ id, call: "resume" });
      });
    }
  }
  return { PtySession: RecordingPtySession };
});

beforeAll(async () => {
  await import("./extension");
}, 120_000);

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "flow-rebind-")));
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
  flow.length = 0;
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
  return { commands, run, editors, resolve, sidebar: resolve("portaterm.sidebar"), panel: resolve("portaterm.panel") };
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

const callsFor = (id: string) => flow.filter((f) => f.id === id).map((f) => f.call);

describe("a re-created view under a live session", () => {
  it("resumes a PTY paused on output the old webview never acked", async () => {
    const h = await activateWithViews();
    const session = await firstSession(h.sidebar);
    const pty = mockPtySessions.find((p) => p.id === session);
    expect(pty?.onData).toBeTypeOf("function");

    // A burst the old page is handed and never acks (it goes away): past the
    // high watermark, so the PTY pauses.
    pty?.onData?.("x".repeat(101_000));
    expect(callsFor(session)).toEqual(["pause"]);

    // The view is re-created: VS Code resolves the provider again with a new
    // webview, whose page loads and says it is ready.
    const recreated = h.resolve("portaterm.sidebar");
    recreated.send({ type: "ready" });
    await vi.waitFor(() => expect(recreated.posted.some((m) => m.type === "init")).toBe(true), { timeout: 10_000 });

    expect(callsFor(session)).toEqual(["pause", "resume"]);
  });

  it("a re-created view does not pause again on what the new page acks", async () => {
    const h = await activateWithViews();
    const session = await firstSession(h.sidebar);
    const pty = mockPtySessions.find((p) => p.id === session);

    // Unacked in flight to the old page, well below the high watermark.
    pty?.onData?.("y".repeat(60_000));
    await vi.waitFor(() => expect(h.sidebar.posted.some((m) => m.type === "output")).toBe(true));

    const recreated = h.resolve("portaterm.sidebar");
    recreated.send({ type: "ready" });
    await vi.waitFor(() => expect(recreated.posted.some((m) => m.type === "init")).toBe(true), { timeout: 10_000 });

    // 60k carried over + 60k now would cross 100k and pause; counted afresh it does not.
    pty?.onData?.("z".repeat(60_000));
    await vi.waitFor(() => expect(recreated.posted.some((m) => m.type === "output")).toBe(true));
    expect(callsFor(session)).toEqual([]);
  });
});
