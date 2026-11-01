// src/providers/TerminalEditorProvider.outputVisibility.test.ts — a background
// editor tab holds its PTY output instead of streaming it into a webview nobody
// can see (performance review A3). Runs the REAL OutputBuffer, so the assertions
// are on what reaches the webview, not on which pause method was called.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAll, __setAppRoot, __setWorkspaceFolders } from "../test/__mocks__/vscode";
import { mockExtensionContext } from "../test/providerTestUtils";
import { mockPtySessions } from "../test/sessionMocks";

vi.mock("../pty/PtyManager", async () => (await import("../test/sessionMocks")).ptyManagerMock());
vi.mock("../pty/PtySession", async () => (await import("../test/sessionMocks")).ptySessionMock());

import { SessionManager } from "../session/SessionManager";
import type { PendingSnapshot } from "../session/SessionSnapshot";
import { TerminalEditorProvider } from "./TerminalEditorProvider";

type Posted = { type?: string; tabId?: string; data?: string };

interface MockPanel {
  visible: boolean;
  webview: { postMessage: (m: unknown) => Promise<boolean> };
  __messageHandlers: Array<(m: unknown) => void>;
  __viewStateHandlers: Array<(e: { webviewPanel: { visible: boolean } }) => void>;
  dispose: () => void;
}

/** Records every post; `failInit` makes each `init` delivery fail, retries included. */
function record(panel: MockPanel, opts: { failInit?: boolean } = {}): Posted[] {
  const posts: Posted[] = [];
  const orig = panel.webview.postMessage.bind(panel.webview);
  panel.webview.postMessage = (m: unknown) => {
    posts.push(m as Posted);
    if (opts.failInit && (m as Posted).type === "init") {
      return Promise.resolve(false);
    }
    return orig(m);
  };
  return posts;
}

/** A bare mock panel, as VS Code hands one to the serializer for `revive`. */
async function bareRevivedPanel(): Promise<MockPanel> {
  const vscode = await import("vscode");
  const createSpy = vi.spyOn(vscode.window, "createWebviewPanel");
  (
    vscode.window as unknown as {
      createWebviewPanel: (t: string, n: string, c: unknown, o: unknown) => unknown;
    }
  ).createWebviewPanel(TerminalEditorProvider.viewType, "Terminal", 1, {});
  return createSpy.mock.results[0].value as unknown as MockPanel;
}

function setVisible(panel: MockPanel, visible: boolean): void {
  panel.visible = visible;
  for (const h of panel.__viewStateHandlers) {
    h({ webviewPanel: { visible } });
  }
}

function sendReady(panel: MockPanel): void {
  for (const h of panel.__messageHandlers) {
    h({ type: "ready" });
  }
}

/** PTY bytes for the only session the test created. */
function emit(data: string): void {
  expect(mockPtySessions).toHaveLength(1);
  mockPtySessions[0].onData?.(data);
}

const outputs = (posts: Posted[]) => posts.filter((p) => p.type === "output").map((p) => p.data);

async function openPanel(sm: SessionManager): Promise<MockPanel> {
  const vscode = await import("vscode");
  const createSpy = vi.spyOn(vscode.window, "createWebviewPanel");
  TerminalEditorProvider.createPanel(mockExtensionContext({ fsPath: "/mock/extension" }), sm);
  return createSpy.mock.results[0].value as unknown as MockPanel;
}

function pendingSnap(sessionId: string, panelId: string): PendingSnapshot {
  return {
    metadata: {
      sessionId,
      panelId,
      viewLocation: "editor",
      terminalNumber: 1,
      customName: null,
      shell: "/bin/zsh",
      shellArgs: [],
      cwd: "/",
      currentCwd: null,
      cols: 80,
      rows: 24,
      bufferFile: `snapshots/${sessionId}.snapshot.ans`,
      bufferBytes: 4,
      isSplitPane: false,
      rootTabId: sessionId,
      snapshotAt: 1700000000000,
      shellExited: false,
      exitCode: null,
    },
    buffer: "DATA",
  };
}

beforeEach(() => {
  __resetAll();
  __setAppRoot("/mock/vscode/app");
  __setWorkspaceFolders([{ uri: { fsPath: "/mock/workspace" } }]);
  mockPtySessions.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("TerminalEditorProvider — output follows tab visibility", () => {
  it("holds output while the tab is in the background and flushes it, in order, when shown", async () => {
    const sm = new SessionManager();
    const panel = await openPanel(sm);
    const posts = record(panel);
    sendReady(panel);
    await vi.advanceTimersByTimeAsync(0);

    emit("live-1");
    await vi.advanceTimersByTimeAsync(50);
    expect(outputs(posts)).toEqual(["live-1"]);

    setVisible(panel, false);
    emit("hidden-1");
    emit("hidden-2");
    await vi.advanceTimersByTimeAsync(1000);
    expect(outputs(posts)).toEqual(["live-1"]);

    setVisible(panel, true);
    // Flushed on show itself, not on the next timer tick.
    expect(outputs(posts)).toEqual(["live-1", "hidden-1hidden-2"]);
    expect(posts.at(-1)?.type).toBe("viewShow");

    emit("live-2");
    await vi.advanceTimersByTimeAsync(50);
    expect(outputs(posts)).toEqual(["live-1", "hidden-1hidden-2", "live-2"]);

    panel.dispose();
    sm.dispose();
  });

  it("starts paused when the tab went to the background before the webview was ready", async () => {
    const sm = new SessionManager();
    const panel = await openPanel(sm);
    const posts = record(panel);
    setVisible(panel, false);
    sendReady(panel);
    await vi.advanceTimersByTimeAsync(0);

    emit("prompt$ ");
    await vi.advanceTimersByTimeAsync(1000);
    expect(outputs(posts)).toEqual([]);

    setVisible(panel, true);
    expect(outputs(posts)).toEqual(["prompt$ "]);

    panel.dispose();
    sm.dispose();
  });

  it("never lets a show during restore replay put live output ahead of the snapshot", async () => {
    const sm = new SessionManager();
    const panel = await bareRevivedPanel();
    const posts = record(panel);
    TerminalEditorProvider.revive(mockExtensionContext({ fsPath: "/mock/extension" }), sm, panel as never, "P1", [
      pendingSnap("S1", "P1"),
    ]);

    // onReady runs to its first await: the restored session exists, paused.
    // The tab is switched away and back before the init delivery settles.
    sendReady(panel);
    emit("fresh-prompt");
    setVisible(panel, false);
    setVisible(panel, true);
    expect(outputs(posts)).toEqual([]);

    await vi.advanceTimersByTimeAsync(0);
    const types = posts.map((p) => p.type);
    const replay = types.indexOf("restoreFromSnapshot");
    const firstOutput = types.indexOf("output");
    expect(replay).toBeGreaterThanOrEqual(0);
    expect(firstOutput).toBeGreaterThan(replay);
    expect(outputs(posts)).toEqual(["fresh-prompt"]);

    panel.dispose();
    sm.dispose();
  });

  it("keeps a restored tab that is hidden by the end of replay paused until it is shown", async () => {
    const sm = new SessionManager();
    const panel = await bareRevivedPanel();
    const posts = record(panel);
    TerminalEditorProvider.revive(mockExtensionContext({ fsPath: "/mock/extension" }), sm, panel as never, "P1", [
      pendingSnap("S1", "P1"),
    ]);

    sendReady(panel);
    setVisible(panel, false);
    emit("fresh-prompt");
    await vi.advanceTimersByTimeAsync(1000);
    expect(posts.map((p) => p.type)).toContain("restoreFromSnapshot");
    expect(outputs(posts)).toEqual([]);

    setVisible(panel, true);
    expect(outputs(posts)).toEqual(["fresh-prompt"]);

    panel.dispose();
    sm.dispose();
  });

  it("keeps a window-reload revive paused while hidden, then flushes on show", async () => {
    const sm = new SessionManager();
    // The session outlived the old webview; that panel's disposal paused it.
    const fakeWebview = { postMessage: vi.fn(async () => true) } as unknown as Parameters<typeof sm.createSession>[1];
    sm.createSession("editor-P1", fakeWebview, { shell: "/bin/zsh" });
    sm.pauseOutputForView("editor-P1");
    const panel = await bareRevivedPanel();
    const posts = record(panel);
    TerminalEditorProvider.revive(mockExtensionContext({ fsPath: "/mock/extension" }), sm, panel as never, "P1", []);

    panel.visible = false;
    sendReady(panel);
    emit("while-hidden");
    await vi.advanceTimersByTimeAsync(1000);
    expect(posts.map((p) => p.type)).toContain("init");
    expect(outputs(posts)).toEqual([]);

    setVisible(panel, true);
    expect(outputs(posts)).toEqual(["while-hidden"]);

    panel.dispose();
    sm.dispose();
  });

  it.each([
    ["window-reload revive", "existing"],
    ["cross-restart restore", "snapshot"],
  ] as const)("still releases output after a failed init delivery (%s)", async (_label, kind) => {
    const sm = new SessionManager();
    if (kind === "existing") {
      const fakeWebview = { postMessage: vi.fn(async () => true) } as unknown as Parameters<typeof sm.createSession>[1];
      sm.createSession("editor-P1", fakeWebview, { shell: "/bin/zsh" });
      sm.pauseOutputForView("editor-P1");
    }
    const panel = await bareRevivedPanel();
    const posts = record(panel, { failInit: true });
    TerminalEditorProvider.revive(
      mockExtensionContext({ fsPath: "/mock/extension" }),
      sm,
      panel as never,
      "P1",
      kind === "snapshot" ? [pendingSnap("S1", "P1")] : [],
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    panel.visible = false;
    sendReady(panel);
    emit("after-failed-init");
    await vi.advanceTimersByTimeAsync(5000);
    expect(posts.filter((p) => p.type === "init").length).toBeGreaterThan(1);
    expect(posts.map((p) => p.type)).not.toContain("restoreFromSnapshot");
    // Hidden at release: held, not dropped and not streamed.
    expect(outputs(posts)).toEqual([]);

    setVisible(panel, true);
    expect(outputs(posts)).toEqual(["after-failed-init"]);

    panel.dispose();
    sm.dispose();
  });
});
