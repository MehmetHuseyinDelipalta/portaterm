// Sidebar/panel cross-restart restore path.
// See: asimov/changes/restore-terminal-sessions/specs/cross-restart-session-restore/spec.md

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAll, __setAppRoot, __setWorkspaceFolders } from "../test/__mocks__/vscode";
import { mockPtySessions } from "../test/sessionMocks";

vi.mock("../pty/PtyManager", async () => (await import("../test/sessionMocks")).ptyManagerMock());
vi.mock("../pty/PtySession", async () => (await import("../test/sessionMocks")).ptySessionMock());
vi.mock("../session/OutputBuffer", async () => (await import("../test/sessionMocks")).outputBufferMock());

import type * as vscode from "vscode";
import { SessionManager } from "../session/SessionManager";
import type { PendingSnapshot } from "../session/SessionSnapshot";
import { TerminalViewProvider } from "./TerminalViewProvider";

function pendingSnap(sessionId: string, location: "sidebar" | "panel"): PendingSnapshot {
  return {
    metadata: {
      sessionId,
      viewLocation: location,
      terminalNumber: 1,
      customName: null,
      shell: "/bin/zsh",
      shellArgs: [],
      cwd: "/home",
      currentCwd: null,
      cols: 100,
      rows: 30,
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

function createMockWebviewView() {
  const messageHandlers: Array<(msg: unknown) => void> = [];
  const postMessage = vi.fn((_msg: unknown) => Promise.resolve(true));
  const webviewView = {
    visible: true,
    viewType: "anywhereTerminal.sidebar",
    webview: {
      html: "",
      options: {},
      cspSource: "https://mock.csp.source",
      asWebviewUri: (uri: { fsPath: string }) => uri.fsPath,
      onDidReceiveMessage: (handler: (msg: unknown) => void) => {
        messageHandlers.push(handler);
        return { dispose: () => {} };
      },
      postMessage,
    },
    onDidChangeVisibility: () => ({ dispose: () => {} }),
    onDidDispose: () => ({ dispose: () => {} }),
  } as unknown as vscode.WebviewView;
  return { webviewView, messageHandlers, postMessage };
}

beforeEach(() => {
  __resetAll();
  __setAppRoot("/mock/vscode/app");
  __setWorkspaceFolders([{ uri: { fsPath: "/mock/workspace" } }]);
  vi.clearAllMocks();
  mockPtySessions.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TerminalViewProvider.onReady restore branch", () => {
  it("creates sessions from staged snapshots and posts init + restoreFromSnapshot", async () => {
    const sm = new SessionManager(undefined, { restoreEnabled: true });
    sm.__stagePendingSnapshot(pendingSnap("S1", "sidebar"));
    const provider = new TerminalViewProvider({ fsPath: "/mock/ext" } as vscode.Uri, sm, "sidebar");
    const { webviewView, messageHandlers, postMessage } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    for (const h of messageHandlers) {
      h({ type: "ready" });
    }
    // onReady is async now (round-2 [W4] fix awaits init before posting
    // restoreFromSnapshot). Let the microtasks flush so the for-loop posts
    // settle before assertions.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const calls = postMessage.mock.calls.map((c) => c[0] as unknown) as Array<{
      type?: string;
      tabId?: string;
      navigationBootstrap?: "live" | "cold";
      navigationHint?: { activeTabId: string | null; activePaneId: string | null };
    }>;
    const init = calls.find((m) => m?.type === "init");
    const restore = calls.find((m) => m?.type === "restoreFromSnapshot");
    expect(init).toMatchObject({ navigationBootstrap: "cold" });
    expect(restore).toBeDefined();
    expect(restore!.tabId).toBe("S1");
    // init must arrive BEFORE restoreFromSnapshot — the whole point of [W4].
    const initIdx = calls.findIndex((m) => m?.type === "init");
    const restoreIdx = calls.findIndex((m) => m?.type === "restoreFromSnapshot");
    expect(initIdx).toBeLessThan(restoreIdx);
    expect(sm.getTabsForView(provider.getViewId())).toHaveLength(1);
    sm.dispose();
  });

  it("does NOT take the restore branch when sessions already exist (existingTabs takes precedence)", () => {
    const sm = new SessionManager(undefined, { restoreEnabled: true });
    const provider = new TerminalViewProvider({ fsPath: "/mock/ext" } as vscode.Uri, sm, "sidebar");
    const { webviewView, messageHandlers, postMessage } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    // Pre-create one session so existingTabs.length > 0.
    sm.createSession(provider.getViewId(), webviewView.webview);

    const root = sm.getTabsForView(provider.getViewId())[0].id;
    for (const h of messageHandlers) {
      h({ type: "terminalNavigationCommitted", activeTabId: root, activePaneId: root });
    }

    // Stage snapshot but it should NOT be consumed.
    sm.__stagePendingSnapshot(pendingSnap("X", "sidebar"));
    for (const h of messageHandlers) {
      h({ type: "ready" });
    }

    const calls = postMessage.mock.calls.map((c) => c[0] as unknown) as Array<{
      type?: string;
      tabId?: string;
      navigationBootstrap?: "live" | "cold";
      navigationHint?: { activeTabId: string | null; activePaneId: string | null };
    }>;
    const init = calls.find((message) => message.type === "init");
    const restore = calls.find((m) => m?.type === "restoreFromSnapshot");
    expect(init).toMatchObject({
      navigationBootstrap: "live",
      navigationHint: { activeTabId: root, activePaneId: root },
    });
    expect(restore).toBeUndefined();
    // Snapshot still staged
    expect(sm.hasSnapshotsForLocation("sidebar")).toBe(true);
    sm.dispose();
  });
});
