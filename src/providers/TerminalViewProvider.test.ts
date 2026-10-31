// src/providers/TerminalViewProvider.test.ts — Unit tests for TerminalViewProvider
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAll, __setAppRoot, __setWorkspaceFolders } from "../test/__mocks__/vscode";
import { mockPtySessions } from "../test/sessionMocks";

vi.mock("../pty/PtyManager", async () => (await import("../test/sessionMocks")).ptyManagerMock());
vi.mock("../pty/PtySession", async () => (await import("../test/sessionMocks")).ptySessionMock());
vi.mock("../session/OutputBuffer", async () => (await import("../test/sessionMocks")).outputBufferMock());

vi.mock("./openFileLink", () => ({
  openFileLink: vi.fn(async () => {}),
}));

// The OS-drop path reads the pasteboard through osascript; only its wiring
// (which shell the provider hands it) is asserted here — osDropPaths.test.ts
// owns the rest.
vi.mock("./osDropPaths", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./osDropPaths")>()),
  handleInsertOsDropPaths: vi.fn(async () => true),
}));
vi.mock("./previewFileLink", () => ({
  previewFileLink: vi.fn(async () => ({
    type: "filePreviewResult",
    path: "test/path",
    requestId: "echo-req",
    status: "ok",
  })),
}));

import type * as vscode from "vscode";
import { PINNED_TAB_CLOSE_REFUSED } from "../session/closeGates";
import { createPaneEvidenceStore } from "../session/PaneEvidenceStore";
import { SessionManager } from "../session/SessionManager";
import {
  commands as vscodeMockCommands,
  env as vscodeMockEnv,
  window as vscodeMockWindow,
} from "../test/__mocks__/vscode";
import { VaultLaunchError } from "../vault/LaunchBuilder";
import type { VaultLauncher } from "../vault/VaultLauncher";
import type { VaultService } from "../vault/VaultService";
import { FileTreeHost } from "./fileTreeHost";
import { openFileLink } from "./openFileLink";
import { handleInsertOsDropPaths } from "./osDropPaths";
import { previewFileLink } from "./previewFileLink";
import { TerminalViewProvider } from "./TerminalViewProvider";
import type { VaultWatchCoordinator } from "./VaultWatchCoordinator";

// ─── Test Setup ─────────────────────────────────────────────────────

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

// ─── Helpers ────────────────────────────────────────────────────────

function createMockWebviewView(): {
  webviewView: vscode.WebviewView;
  messageHandlers: Array<(msg: unknown) => void>;
  disposeHandlers: Array<() => void>;
  visibilityHandlers: Array<() => void>;
  postMessageSpy: ReturnType<typeof vi.fn>;
  setVisible: (visible: boolean) => void;
} {
  const messageHandlers: Array<(msg: unknown) => void> = [];
  const disposeHandlers: Array<() => void> = [];
  const visibilityHandlers: Array<() => void> = [];
  const postMessageSpy = vi.fn(() => Promise.resolve(true));
  let _visible = true;

  const webviewView = {
    visible: true,
    viewType: "portaterm.sidebar",
    webview: {
      html: "",
      options: {},
      cspSource: "https://mock.csp.source",
      asWebviewUri: (uri: { fsPath: string }) => uri.fsPath,
      onDidReceiveMessage: (handler: (msg: unknown) => void) => {
        messageHandlers.push(handler);
        return { dispose: () => {} };
      },
      postMessage: postMessageSpy,
    },
    onDidChangeVisibility: (handler: () => void) => {
      visibilityHandlers.push(handler);
      return { dispose: () => {} };
    },
    onDidDispose: (handler: () => void) => {
      disposeHandlers.push(handler);
      return { dispose: () => {} };
    },
  } as unknown as vscode.WebviewView;

  const setVisible = (visible: boolean) => {
    _visible = visible;
    (webviewView as { visible: boolean }).visible = visible;
    for (const handler of visibilityHandlers) {
      handler();
    }
  };

  return { webviewView, messageHandlers, disposeHandlers, visibilityHandlers, postMessageSpy, setVisible };
}

// ─── setBadge ───────────────────────────────────────────────────────

describe("TerminalViewProvider: setBadge", () => {
  it("clears a live view's badge with a zero badge, not undefined", () => {
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "panel");
    const { webviewView } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);

    provider.setBadge({ value: 1, tooltip: "1 agent is waiting: Tab a" });
    expect(webviewView.badge).toEqual({ value: 1, tooltip: "1 agent is waiting: Tab a" });

    provider.setBadge(undefined);
    expect(webviewView.badge).toEqual({ value: 0, tooltip: "" });

    sm.dispose();
  });

  it("resolves a view with no badge after a clear that happened while it was gone", () => {
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "panel");
    provider.setBadge({ value: 1, tooltip: "1 agent is waiting: Tab a" });
    provider.setBadge(undefined);

    const { webviewView } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    expect(webviewView.badge).toBeUndefined();

    sm.dispose();
  });
});

// ─── getActiveSessionId ─────────────────────────────────────────────

describe("TerminalViewProvider: getActiveSessionId", () => {
  it("returns undefined when no sessions exist", () => {
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");

    expect(provider.getActiveSessionId()).toBeUndefined();

    sm.dispose();
  });

  it("returns the active session ID after resolveWebviewView + ready", () => {
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");

    const { webviewView, messageHandlers } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);

    // Simulate ready
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }

    const activeId = provider.getActiveSessionId();
    expect(activeId).toBeDefined();
    expect(typeof activeId).toBe("string");

    sm.dispose();
  });

  it("returns the most recently created session as active", () => {
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");

    const { webviewView, messageHandlers } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);

    // Simulate ready — creates first session
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }

    // Create a second session via createTab message
    for (const handler of messageHandlers) {
      handler({ type: "createTab" });
    }

    const tabs = sm.getTabsForView(provider.getViewId());
    expect(tabs).toHaveLength(2);

    // The second session should be active
    const activeId = provider.getActiveSessionId();
    expect(activeId).toBe(tabs[1].id);

    sm.dispose();
  });
});

// ─── openFile dispatch ─────────────────────────────────────────────

describe("TerminalViewProvider: openFile dispatch", () => {
  it("forwards an openFile message to openFileLink with the expected deps shape", () => {
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");

    const { webviewView, messageHandlers } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);

    // Initialize a session via ready
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }

    const openFileMsg = {
      type: "openFile" as const,
      path: "src/foo.ts",
      sessionId: "sess-XYZ",
      line: 42,
      col: 7,
    };

    for (const handler of messageHandlers) {
      handler(openFileMsg);
    }

    expect(openFileLink).toHaveBeenCalledTimes(1);
    const [msgArg, depsArg] = (openFileLink as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(msgArg).toEqual(openFileMsg);
    expect(depsArg).toEqual(
      expect.objectContaining({
        getInitialCwd: expect.any(Function),
        getCurrentCwd: expect.any(Function),
        getLiveCwd: expect.any(Function),
        stat: expect.any(Function),
        findFiles: expect.any(Function),
        showWarning: expect.any(Function),
        showTextDocument: expect.any(Function),
        showQuickPick: expect.any(Function),
      }),
    );

    sm.dispose();
  });

  it("ignores openFile messages with non-string path or sessionId", () => {
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");

    const { webviewView, messageHandlers } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }

    (openFileLink as unknown as ReturnType<typeof vi.fn>).mockClear();

    for (const handler of messageHandlers) {
      handler({ type: "openFile", path: 123 as unknown, sessionId: "x" });
      handler({ type: "openFile", path: "x", sessionId: 0 as unknown });
    }

    expect(openFileLink).not.toHaveBeenCalled();

    sm.dispose();
  });
});

// ─── file-tree action dispatch ─────────────────────────────────────

describe("TerminalViewProvider: file-tree action dispatch", () => {
  it("delegates all file-tree path action messages to FileTreeHost", () => {
    const spy = vi.spyOn(FileTreeHost.prototype, "handleMessage").mockReturnValue(true);
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");
    const { webviewView, messageHandlers } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);

    const messages = [
      { type: "file-tree-reveal-in-os", rootGeneration: 0, path: "/mock/workspace/a.ts" },
      { type: "file-tree-copy-path", rootGeneration: 0, path: "/mock/workspace/a.ts" },
      { type: "file-tree-copy-relative-path", rootGeneration: 0, path: "/mock/workspace/a.ts" },
      { type: "file-tree-delete", rootGeneration: 0, path: "/mock/workspace/a.ts" },
    ] as const;

    for (const msg of messages) {
      for (const handler of messageHandlers) {
        handler(msg);
      }
    }

    expect(spy).toHaveBeenCalledTimes(4);
    expect(spy.mock.calls.map(([msg]) => (msg as { type: string }).type)).toEqual(messages.map((msg) => msg.type));

    sm.dispose();
  });
});

// ─── requestFilePreview dispatch (task 2_3) ─────────────────────────

describe("TerminalViewProvider: requestFilePreview dispatch", () => {
  // Round-2 W3: handler rejects unknown sessionIds. These tests use the literal
  // "s1" placeholder; stub `sm.getSession` to accept any id so the supersession /
  // dispatch behaviors remain testable without spawning a real PTY session.
  function stubSession(sm: SessionManager): void {
    vi.spyOn(sm, "getSession").mockImplementation(() => ({}) as never);
  }

  it("cancels a prior in-flight token when a new request for the same session arrives", async () => {
    const sm = new SessionManager();
    stubSession(sm);
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");
    const { webviewView, messageHandlers } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }

    // Make previewFileLink hang indefinitely so we can observe cancellation.
    let cancellations = 0;
    (previewFileLink as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (_msg, _deps, token) => {
      const t = token as { onCancellationRequested?: (cb: () => void) => { dispose(): void } };
      await new Promise<void>((resolve) => {
        t.onCancellationRequested?.(() => {
          cancellations++;
          resolve();
        });
      });
      return null; // cancelled — no result posted.
    });

    for (const handler of messageHandlers) {
      handler({ type: "requestFilePreview", requestId: "r1", sessionId: "s1", path: "foo.ts" });
    }
    await Promise.resolve();
    for (const handler of messageHandlers) {
      handler({ type: "requestFilePreview", requestId: "r2", sessionId: "s1", path: "bar.ts" });
    }
    await new Promise((r) => setTimeout(r, 5));

    expect(cancellations).toBeGreaterThanOrEqual(1);

    sm.dispose();
  });

  it("posts the result back when previewFileLink resolves", async () => {
    const sm = new SessionManager();
    stubSession(sm);
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");
    const { webviewView, messageHandlers, postMessageSpy } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }
    postMessageSpy.mockClear();

    (previewFileLink as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      type: "filePreviewResult",
      path: "test/path",
      requestId: "r1",
      status: "ok",
      absPath: "/x/foo.ts",
    });

    for (const handler of messageHandlers) {
      handler({ type: "requestFilePreview", requestId: "r1", sessionId: "s1", path: "foo.ts" });
    }
    await new Promise((r) => setTimeout(r, 10));

    const previewPosts = postMessageSpy.mock.calls.filter(
      (args) => (args[0] as { type?: string }).type === "filePreviewResult",
    );
    expect(previewPosts).toHaveLength(1);
    expect(previewPosts[0][0]).toMatchObject({ requestId: "r1", status: "ok" });

    sm.dispose();
  });

  it("does NOT post a result when previewFileLink returns null (cancelled mid-flight)", async () => {
    const sm = new SessionManager();
    stubSession(sm);
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");
    const { webviewView, messageHandlers, postMessageSpy } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }
    postMessageSpy.mockClear();

    (previewFileLink as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    for (const handler of messageHandlers) {
      handler({ type: "requestFilePreview", requestId: "r-cancel", sessionId: "s1", path: "foo.ts" });
    }
    await new Promise((r) => setTimeout(r, 10));

    const previewPosts = postMessageSpy.mock.calls.filter(
      (args) => (args[0] as { type?: string }).type === "filePreviewResult",
    );
    expect(previewPosts).toHaveLength(0);

    sm.dispose();
  });

  it("supersession: a cancelled prior request that later resolves with non-null does NOT post a result", async () => {
    const sm = new SessionManager();
    stubSession(sm);
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");
    const { webviewView, messageHandlers, postMessageSpy } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }
    postMessageSpy.mockClear();

    // Pause the first request so we can supersede it before it resolves.
    let resolveFirst: (() => void) | undefined;
    const firstReady = new Promise<void>((r) => {
      resolveFirst = r;
    });
    (previewFileLink as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      await firstReady;
      return {
        type: "filePreviewResult",
        path: "test/path",
        requestId: "r1",
        status: "ok",
        absPath: "/x/foo.ts",
      };
    });
    (previewFileLink as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      type: "filePreviewResult",
      path: "test/path",
      requestId: "r2",
      status: "ok",
      absPath: "/x/bar.ts",
    });

    for (const handler of messageHandlers) {
      handler({ type: "requestFilePreview", requestId: "r1", sessionId: "s1", path: "foo.ts" });
    }
    await Promise.resolve();
    // Supersede before the first resolves.
    for (const handler of messageHandlers) {
      handler({ type: "requestFilePreview", requestId: "r2", sessionId: "s1", path: "bar.ts" });
    }
    await new Promise((r) => setTimeout(r, 5));
    // Now let the first one resolve (it's been cancelled by the supersession).
    resolveFirst?.();
    await new Promise((r) => setTimeout(r, 10));

    const previewPosts = postMessageSpy.mock.calls.filter(
      (args) => (args[0] as { type?: string }).type === "filePreviewResult",
    );
    // Only the second request's result should have been posted.
    expect(previewPosts).toHaveLength(1);
    expect(previewPosts[0][0]).toMatchObject({ requestId: "r2" });

    sm.dispose();
  });

  it("ignores requestFilePreview messages with non-string requestId / sessionId / path", () => {
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");
    const { webviewView, messageHandlers } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }

    (previewFileLink as unknown as ReturnType<typeof vi.fn>).mockClear();

    for (const handler of messageHandlers) {
      handler({ type: "requestFilePreview", requestId: 1 as unknown, sessionId: "s1", path: "foo.ts" });
      handler({ type: "requestFilePreview", requestId: "r1", sessionId: 0 as unknown, path: "foo.ts" });
      handler({ type: "requestFilePreview", requestId: "r1", sessionId: "s1", path: null as unknown });
    }
    expect(previewFileLink).not.toHaveBeenCalled();

    sm.dispose();
  });

  it("refuses closeTab on a pinned tab, telling the user to unpin it, and closes it once unpinned", async () => {
    const sm = new SessionManager();
    const destroy = vi.spyOn(sm, "destroySession").mockImplementation(() => {});
    vi.spyOn(sm, "panesOfTab").mockReturnValue(["target"]);
    let pinned = true;
    vi.spyOn(sm, "isPinned").mockImplementation(() => pinned);
    const told: string[] = [];
    const realInfo = vscodeMockWindow.showInformationMessage;
    vscodeMockWindow.showInformationMessage = ((message: string) => {
      told.push(message);
      return Promise.resolve(undefined);
    }) as never;

    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");
    const { webviewView, messageHandlers } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    const close = async () => {
      for (const handler of messageHandlers) {
        handler({ type: "closeTab", tabId: "target" });
      }
      await new Promise((r) => setTimeout(r, 5));
    };

    await close();
    expect(told).toEqual([PINNED_TAB_CLOSE_REFUSED]);
    expect(destroy).not.toHaveBeenCalled();

    // Non-vacuous: the same message on the unpinned tab closes it, silently.
    told.length = 0;
    pinned = false;
    await close();
    expect(told).toEqual([]);
    expect(destroy).toHaveBeenCalledWith("target");

    vscodeMockWindow.showInformationMessage = realInfo;
    sm.dispose();
  });

  it("asks before closeTab kills a tab running an agent, and drops it on a decline", async () => {
    // The provider door, not the gate: `closeGates.test.ts` proves the order,
    // nothing proved this arm was wired to it (review round-3 F004).
    const sm = new SessionManager();
    const evidence = createPaneEvidenceStore();
    evidence.create("target", { viewId: "sidebar", shell: "claude", isAgentLaunch: true });
    // Mid-turn: an agent idle at its own prompt is closed without asking.
    evidence.reportTurn("target", { state: "working", stateStartedAt: 0, subagents: [] });
    const destroy = vi.spyOn(sm, "destroySession").mockImplementation(() => {});
    vi.spyOn(sm, "panesOfTab").mockReturnValue(["target"]);
    const asked: string[] = [];
    // Restored below: the mock's `window` is a module-level object, and
    // `__resetAll` does not put its function properties back.
    const realWarn = vscodeMockWindow.showWarningMessage;
    vscodeMockWindow.showWarningMessage = ((message: string) => {
      asked.push(message);
      return Promise.resolve(undefined);
    }) as never;

    const provider = new TerminalViewProvider(
      { fsPath: "/mock/extension" } as vscode.Uri,
      sm,
      "sidebar",
      null,
      null,
      null,
      null,
      null,
      null,
      evidence,
    );
    const { webviewView, messageHandlers } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    for (const handler of messageHandlers) {
      handler({ type: "closeTab", tabId: "target" });
    }
    await new Promise((r) => setTimeout(r, 5));

    expect(asked).toEqual(["Close this terminal tab?"]);
    expect(destroy).not.toHaveBeenCalled();

    // Non-vacuous: the same message on an ordinary shell asks nothing and closes.
    asked.length = 0;
    evidence.create("plain", { viewId: "sidebar", shell: "zsh", isAgentLaunch: false });
    vi.spyOn(sm, "panesOfTab").mockReturnValue(["plain"]);
    for (const handler of messageHandlers) {
      handler({ type: "closeTab", tabId: "plain" });
    }
    await new Promise((r) => setTimeout(r, 5));
    expect(asked).toEqual([]);
    expect(destroy).toHaveBeenCalledWith("plain");

    vscodeMockWindow.showWarningMessage = realWarn;
    sm.dispose();
  });

  it("cancels the in-flight preview token when closeTab arrives for the same session", async () => {
    const sm = new SessionManager();
    stubSession(sm);
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");
    const { webviewView, messageHandlers } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }

    let cancelled = false;
    (previewFileLink as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (_msg, _deps, token) => {
      const t = token as { onCancellationRequested?: (cb: () => void) => { dispose(): void } };
      await new Promise<void>((resolve) => {
        t.onCancellationRequested?.(() => {
          cancelled = true;
          resolve();
        });
      });
      return null;
    });

    for (const handler of messageHandlers) {
      handler({ type: "requestFilePreview", requestId: "r1", sessionId: "target", path: "foo.ts" });
    }
    await Promise.resolve();
    for (const handler of messageHandlers) {
      handler({ type: "closeTab", tabId: "target" });
    }
    await new Promise((r) => setTimeout(r, 5));

    expect(cancelled).toBe(true);

    sm.dispose();
  });

  it("cancels all in-flight preview tokens on webview dispose", async () => {
    const sm = new SessionManager();
    stubSession(sm);
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");
    const { webviewView, messageHandlers, disposeHandlers } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }

    let cancellations = 0;
    (previewFileLink as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (_msg, _deps, token) => {
      const t = token as { onCancellationRequested?: (cb: () => void) => { dispose(): void } };
      await new Promise<void>((resolve) => {
        t.onCancellationRequested?.(() => {
          cancellations++;
          resolve();
        });
      });
      return null;
    });

    for (const handler of messageHandlers) {
      handler({ type: "requestFilePreview", requestId: "r1", sessionId: "s1", path: "a" });
      handler({ type: "requestFilePreview", requestId: "r2", sessionId: "s2", path: "b" });
    }
    await Promise.resolve();
    for (const handler of disposeHandlers) {
      handler();
    }
    await new Promise((r) => setTimeout(r, 5));

    expect(cancellations).toBe(2);

    sm.dispose();
  });
});

// ─── theme bridge (task 1_3) ────────────────────────────────────────

describe("TerminalViewProvider: theme bridge", () => {
  it("posts the initial theme on ready for each ColorThemeKind", async () => {
    const cases: Array<{ kind: number; expected: string }> = [
      { kind: 1 /* Light */, expected: "light" },
      { kind: 2 /* Dark */, expected: "dark" },
      { kind: 3 /* HighContrast */, expected: "hc-dark" },
      { kind: 4 /* HighContrastLight */, expected: "hc-light" },
    ];

    const { __setActiveColorTheme } = await import("../test/__mocks__/vscode");

    for (const { kind, expected } of cases) {
      __setActiveColorTheme(kind);
      const sm = new SessionManager();
      const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");
      const { webviewView, messageHandlers, postMessageSpy } = createMockWebviewView();
      provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);

      for (const handler of messageHandlers) {
        handler({ type: "ready" });
      }

      const themeMessages = postMessageSpy.mock.calls
        .map((args) => args[0] as { type?: string; kind?: string })
        .filter((m) => m && m.type === "themeChanged");
      expect(themeMessages.length).toBeGreaterThan(0);
      expect(themeMessages[0]).toEqual({ type: "themeChanged", kind: expected });

      sm.dispose();
    }
  });

  it("posts themeChanged when onDidChangeActiveColorTheme fires after ready", async () => {
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");
    const { webviewView, messageHandlers, postMessageSpy } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);

    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }
    postMessageSpy.mockClear();

    const { __setActiveColorTheme } = await import("../test/__mocks__/vscode");
    __setActiveColorTheme(1 /* Light */);

    const themeCalls = postMessageSpy.mock.calls.filter(
      (args) => (args[0] as { type?: string }).type === "themeChanged",
    );
    expect(themeCalls).toHaveLength(1);
    expect(themeCalls[0][0]).toEqual({ type: "themeChanged", kind: "light" });

    sm.dispose();
  });

  it("does NOT post themeChanged before ready", async () => {
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");
    const { webviewView, postMessageSpy } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    // No 'ready' message yet.

    postMessageSpy.mockClear();
    const { __setActiveColorTheme } = await import("../test/__mocks__/vscode");
    __setActiveColorTheme(1 /* Light */);

    const themeCalls = postMessageSpy.mock.calls.filter(
      (args) => (args[0] as { type?: string }).type === "themeChanged",
    );
    expect(themeCalls).toHaveLength(0);

    sm.dispose();
  });

  it("disposes the theme subscription on webview dispose", async () => {
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");
    const { webviewView, messageHandlers, disposeHandlers, postMessageSpy } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);

    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }
    postMessageSpy.mockClear();

    // Simulate webview dispose — should unsubscribe theme listener.
    for (const handler of disposeHandlers) {
      handler();
    }

    const { __setActiveColorTheme, __getThemeListenerCount } = await import("../test/__mocks__/vscode");
    expect(__getThemeListenerCount()).toBe(0);

    __setActiveColorTheme(1 /* Light */);
    const themeCalls = postMessageSpy.mock.calls.filter(
      (args) => (args[0] as { type?: string }).type === "themeChanged",
    );
    expect(themeCalls).toHaveLength(0);

    sm.dispose();
  });
});

// ─── vault fresh-response supersession (review round-2 F4) ──────────

describe("TerminalViewProvider: vault fresh-response supersession (F4)", () => {
  function freshResult(id: string) {
    return {
      entries: [
        {
          id: `claude:${id}`,
          agent: "claude",
          sessionId: id,
          title: "t",
          cwd: "/x",
          modified: 1,
          flags: {},
        },
      ],
      unreadable: { count: 0, reasons: [] },
    };
  }

  it("does not re-post a superseded fresh list on retry after a newer request arrives", async () => {
    const sm = new SessionManager();
    let refreshes = 0;
    const fakeVault = {
      listCached: () => null, // no instant-cache post — isolate the fresh path
      refresh: async () => freshResult(`r${++refreshes}`),
    } as unknown as VaultService;
    const provider = new TerminalViewProvider(
      { fsPath: "/mock/extension" } as vscode.Uri,
      sm,
      "sidebar",
      null, // gitDecorationProvider
      null, // watcherPool
      fakeVault,
    );

    const { webviewView, messageHandlers, postMessageSpy } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }

    postMessageSpy.mockReset();
    const isFresh = (m: unknown, id: string) => {
      const x = m as { type?: string; fromCache?: boolean; result?: { entries: Array<{ id: string }> } };
      return x.type === "vaultSessionsResponse" && x.fromCache === false && x.result?.entries[0]?.id === `claude:${id}`;
    };
    let firedSecond = false;
    postMessageSpy.mockImplementation((msg: unknown) => {
      // On token-1's FIRST fresh post attempt: fire a newer request (bumps the seq
      // synchronously), then fail this attempt to push token-1 into its retry window.
      if (!firedSecond && isFresh(msg, "r1")) {
        firedSecond = true;
        for (const handler of messageHandlers) {
          handler({ type: "requestVaultSessions" });
        }
        return Promise.resolve(false);
      }
      return Promise.resolve(true);
    });

    for (const handler of messageHandlers) {
      handler({ type: "requestVaultSessions" }); // token-1
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 250));

    const r1Posts = postMessageSpy.mock.calls.filter(([m]) => isFresh(m, "r1"));
    const r2Posts = postMessageSpy.mock.calls.filter(([m]) => isFresh(m, "r2"));
    // token-1's retry is aborted: r1 is posted exactly once (the failed first attempt),
    // never re-sent after token-2 superseded it.
    expect(r1Posts).toHaveLength(1);
    // The newer list still reaches the webview.
    expect(r2Posts.length).toBeGreaterThanOrEqual(1);

    sm.dispose();
  });
});

// ─── Dropped paths ──────────────────────────────────────────────────

describe("TerminalViewProvider: insertPaths", () => {
  function wired(shell: string) {
    const sm = new SessionManager();
    const webview = { postMessage: vi.fn(async () => true) };
    const tabId = sm.createSession("portaterm.sidebar", webview, { shell });
    const write = vi.spyOn(sm, "writeToSession");
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");
    const { webviewView, messageHandlers } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    const send = (msg: unknown) => {
      for (const handler of messageHandlers) {
        handler(msg);
      }
    };
    return { sm, tabId, write, send };
  }

  it("quotes dropped paths for the pane's shell and types them into that pane", () => {
    for (const [shell, expected] of [
      ["/bin/zsh", "'/a b/it'\\''s' "],
      ["/usr/local/bin/pwsh", "'/a b/it''s' "],
      ["C:\\Windows\\System32\\cmd.exe", '"/a b/it\'s" '],
    ] as const) {
      const { sm, tabId, write, send } = wired(shell);
      send({ type: "insertPaths", tabId, paths: ["/a b/it's"] });
      expect(write).toHaveBeenCalledWith(tabId, expected);
      sm.dispose();
    }
  });

  it("hands an OS drop the target pane's shell, which decides the quoting", () => {
    const { sm, tabId, send } = wired("/usr/local/bin/pwsh");
    send({ type: "insertOsDropPaths", tabId, names: ["a b.txt"] });
    expect(handleInsertOsDropPaths).toHaveBeenCalledWith(
      tabId,
      ["a b.txt"],
      expect.any(Function),
      "/usr/local/bin/pwsh",
    );
    sm.dispose();
  });

  it("ignores a malformed request", () => {
    const { sm, tabId, write, send } = wired("/bin/zsh");
    send({ type: "insertPaths", tabId, paths: [] });
    send({ type: "insertPaths", tabId, paths: [1] });
    send({ type: "insertPaths", tabId: 3, paths: ["/a"] });
    send({ type: "insertPaths", tabId, paths: "/a" });
    expect(write).not.toHaveBeenCalled();
    sm.dispose();
  });
});

// ─── session-detail requestId echo (round-6 W15) ────────────────────

describe("TerminalViewProvider: session-detail requestId echo", () => {
  function providerWith(vault: Partial<VaultService>): {
    messageHandlers: Array<(msg: unknown) => void>;
    postMessageSpy: ReturnType<typeof vi.fn>;
    dispose: () => void;
  } {
    const sm = new SessionManager();
    const provider = new TerminalViewProvider(
      { fsPath: "/mock/extension" } as vscode.Uri,
      sm,
      "sidebar",
      null,
      null,
      vault as VaultService,
    );
    const { webviewView, messageHandlers, postMessageSpy } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }
    postMessageSpy.mockReset();
    postMessageSpy.mockImplementation(() => Promise.resolve(true));
    return { messageHandlers, postMessageSpy, dispose: () => sm.dispose() };
  }

  const detailResponses = (spy: ReturnType<typeof vi.fn>) =>
    spy.mock.calls.map(([m]) => m as Record<string, unknown>).filter((m) => m.type === "vaultSessionDetailResponse");

  it("echoes the requestId on success and error, and omits it when the request carried none", async () => {
    const { messageHandlers, postMessageSpy, dispose } = providerWith({
      getDetail: async (entryId: string) =>
        entryId === "claude:ok"
          ? {
              entryId,
              contentKind: "timeline" as const,
              timeline: [],
              recentActivity: [],
              stats: { messageCount: 0, toolCount: 0, subagentCount: 0 },
            }
          : null,
    });
    for (const handler of messageHandlers) {
      handler({ type: "requestVaultSessionDetail", entryId: "claude:ok", requestId: "nested-7" });
      handler({ type: "requestVaultSessionDetail", entryId: "claude:missing", requestId: "nested-8" });
      handler({ type: "requestVaultSessionDetail", entryId: "claude:ok" });
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const responses = detailResponses(postMessageSpy);
    expect(responses.find((m) => m.requestId === "nested-7")).toMatchObject({ entryId: "claude:ok" });
    expect(responses.find((m) => m.requestId === "nested-8")).toMatchObject({
      entryId: "claude:missing",
      // Not "Session not found.": a reader returns nothing both for a session
      // the store does not hold and for one whose read could not be completed,
      // and this branch never established which (round 3 W3).
      error: "Session not found or could not be read.",
    });
    const untagged = responses.filter((m) => m.requestId === undefined);
    expect(untagged).toHaveLength(1);
    expect("requestId" in untagged[0]).toBe(false);
    dispose();
  });

  it("does not claim a session is absent when the read merely produced nothing", async () => {
    // `readOpenCodeDetail` returns null for a session it read but could not
    // prove complete — an existing session. Copy asserting absence sends the
    // user looking for a missing session instead of retrying.
    const { messageHandlers, postMessageSpy, dispose } = providerWith({ getDetail: async () => null });
    for (const handler of messageHandlers) {
      handler({ type: "requestVaultSessionDetail", entryId: "opencode:exists" });
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const error = String(detailResponses(postMessageSpy)[0]?.error ?? "");
    expect(error).toMatch(/could not be read/);
    expect(error).not.toBe("Session not found.");
    dispose();
  });

  it("echoes the requestId when the read throws", async () => {
    const { messageHandlers, postMessageSpy, dispose } = providerWith({
      getDetail: async () => {
        throw new Error("boom");
      },
    });
    for (const handler of messageHandlers) {
      handler({ type: "requestVaultSessionDetail", entryId: "claude:x", requestId: "nested-9" });
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(detailResponses(postMessageSpy).find((m) => m.requestId === "nested-9")).toMatchObject({
      entryId: "claude:x",
      error: "boom",
    });
    dispose();
  });
});

// ─── safeSendWithRetry ──────────────────────────────────────────────

describe("TerminalViewProvider: safeSendWithRetry via createTab", () => {
  it("retries postMessage when first attempt returns false then succeeds", async () => {
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");

    const { webviewView, messageHandlers, postMessageSpy } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);

    // Simulate ready
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }

    // Reset spy and make it fail once then succeed
    postMessageSpy.mockReset();
    let callCount = 0;
    postMessageSpy.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(false); // First attempt fails
      }
      return Promise.resolve(true); // Retry succeeds
    });

    // Trigger createTab which uses safeSendWithRetry
    for (const handler of messageHandlers) {
      handler({ type: "createTab" });
    }

    // Wait for retries to complete
    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    // Should have been called at least twice (retry)
    expect(postMessageSpy.mock.calls.length).toBeGreaterThanOrEqual(2);

    sm.dispose();
  });

  it("returns false after all retries exhausted", async () => {
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");

    const { webviewView, messageHandlers, postMessageSpy } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);

    // Simulate ready
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }

    // Let the ready path finish first. Its init is awaited before the row-activation
    // post, so that post would otherwise land AFTER the reset below and be counted
    // as a createTab attempt.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    // Reset spy and make it always fail
    postMessageSpy.mockReset();
    postMessageSpy.mockImplementation(() => Promise.resolve(false));

    // Trigger createTab which uses safeSendWithRetry
    for (const handler of messageHandlers) {
      handler({ type: "createTab" });
    }

    // Wait for all retries to complete (3 attempts × 50ms delay)
    await new Promise<void>((resolve) => setTimeout(resolve, 500));

    // Should have been called 3 times (initial + 2 retries)
    expect(postMessageSpy.mock.calls.length).toBe(3);

    sm.dispose();
  });
});

// ─── Scrollback Replay on Re-creation ───────────────────────────────

describe("TerminalViewProvider: scrollback replay on re-creation", () => {
  it("first-time creation creates a new session", () => {
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");

    const { webviewView, messageHandlers, postMessageSpy } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);

    // Simulate ready
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }

    const tabs = sm.getTabsForView(provider.getViewId());
    expect(tabs).toHaveLength(1);

    // Should have sent init with the new session
    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "init",
        tabs: expect.arrayContaining([expect.objectContaining({ isActive: true })]),
        navigationBootstrap: "cold",
      }),
    );

    sm.dispose();
  });

  it("re-creation restores existing sessions without creating new ones", async () => {
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");

    // First creation
    const { webviewView: wv1, messageHandlers: mh1 } = createMockWebviewView();
    provider.resolveWebviewView(wv1, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    for (const handler of mh1) {
      handler({ type: "ready" });
    }

    const tabsBefore = sm.getTabsForView(provider.getViewId());
    expect(tabsBefore).toHaveLength(1);
    const sessionId = tabsBefore[0].id;

    // Simulate PTY output to build scrollback
    const ptyMock = mockPtySessions.find((p) => p.id === sessionId);
    ptyMock!.onData?.("hello world");

    // Simulate re-creation (new webview view)
    const { webviewView: wv2, messageHandlers: mh2, postMessageSpy: pms2 } = createMockWebviewView();
    provider.resolveWebviewView(wv2, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    for (const handler of mh2) {
      handler({ type: "ready" });
    }
    // onReady is async — Phase A awaits init delivery before the restore loop.
    // Flush microtasks so the for-loop runs before assertions.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    // Should NOT have created a new session
    const tabsAfter = sm.getTabsForView(provider.getViewId());
    expect(tabsAfter).toHaveLength(1);
    expect(tabsAfter[0].id).toBe(sessionId);

    // Should have sent init with existing tabs
    expect(pms2).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "init",
        tabs: expect.arrayContaining([expect.objectContaining({ id: sessionId })]),
        navigationBootstrap: "live",
      }),
    );

    // Should have sent restore message with scrollback data
    expect(pms2).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "restore",
        tabId: sessionId,
        data: "hello world",
      }),
    );

    sm.dispose();
  });
});

// ─── Visibility Pause/Resume ────────────────────────────────────────

describe("TerminalViewProvider: visibility pause/resume", () => {
  it("pauses output when view becomes hidden", () => {
    const sm = new SessionManager();
    const pauseSpy = vi.spyOn(sm, "pauseOutputForView");
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");

    const { webviewView, messageHandlers, setVisible } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);

    // Simulate ready
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }

    // Hide the view
    setVisible(false);

    expect(pauseSpy).toHaveBeenCalledWith(provider.getViewId());

    sm.dispose();
  });

  it("resumes output when view becomes visible", () => {
    const sm = new SessionManager();
    const resumeSpy = vi.spyOn(sm, "resumeOutputForView");
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");

    const { webviewView, messageHandlers, setVisible } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);

    // Simulate ready
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }

    // Hide then show
    setVisible(false);
    setVisible(true);

    expect(resumeSpy).toHaveBeenCalledWith(provider.getViewId());

    sm.dispose();
  });

  it("does NOT destroy sessions on webview dispose (PTY survives)", () => {
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");

    const { webviewView, messageHandlers, disposeHandlers } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);

    // Simulate ready — creates a session
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }

    const tabsBefore = sm.getTabsForView(provider.getViewId());
    expect(tabsBefore).toHaveLength(1);

    // Simulate webview dispose
    for (const handler of disposeHandlers) {
      handler();
    }

    // Sessions should still exist (PTY anchored to Extension Host)
    const tabsAfter = sm.getTabsForView(provider.getViewId());
    expect(tabsAfter).toHaveLength(1);
    expect(tabsAfter[0].id).toBe(tabsBefore[0].id);

    sm.dispose();
  });

  it("pauses output on webview dispose", () => {
    const sm = new SessionManager();
    const pauseSpy = vi.spyOn(sm, "pauseOutputForView");
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");

    const { webviewView, messageHandlers, disposeHandlers } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);

    // Simulate ready
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }

    // Simulate webview dispose
    for (const handler of disposeHandlers) {
      handler();
    }

    expect(pauseSpy).toHaveBeenCalledWith(provider.getViewId());

    sm.dispose();
  });
});

// ─── Vault Watch Coordinator Delegation ─────────────────────────────

describe("TerminalViewProvider: vault watch coordinator", () => {
  it("attaches, delegates session watches, and disposes the resolved webview client", async () => {
    const sm = new SessionManager();
    const client = { watchSession: vi.fn(async () => {}), dispose: vi.fn() };
    const coordinator = { attach: vi.fn(() => client), dispose: vi.fn() } as unknown as VaultWatchCoordinator;
    const provider = new TerminalViewProvider(
      { fsPath: "/mock/extension" } as vscode.Uri,
      sm,
      "sidebar",
      null,
      null,
      null,
      null,
      coordinator,
    );
    const { webviewView, messageHandlers, disposeHandlers } = createMockWebviewView();

    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    expect(coordinator.attach).toHaveBeenCalledTimes(1);

    for (const handler of messageHandlers) {
      handler({ type: "vaultWatchSession", entryId: "claude:s1" });
    }
    await Promise.resolve();
    expect(client.watchSession).toHaveBeenCalledWith("claude:s1");

    for (const handler of disposeHandlers) {
      handler();
    }
    expect(client.dispose).toHaveBeenCalledTimes(1);
    sm.dispose();
  });

  it("keeps late messages and disposal bound to the client captured by each resolution", async () => {
    const sm = new SessionManager();
    const firstClient = { watchSession: vi.fn(async () => {}), dispose: vi.fn() };
    const secondClient = { watchSession: vi.fn(async () => {}), dispose: vi.fn() };
    const coordinator = {
      attach: vi.fn().mockReturnValueOnce(firstClient).mockReturnValueOnce(secondClient),
      dispose: vi.fn(),
    } as unknown as VaultWatchCoordinator;
    const provider = new TerminalViewProvider(
      { fsPath: "/mock/extension" } as vscode.Uri,
      sm,
      "sidebar",
      null,
      null,
      null,
      null,
      coordinator,
    );
    const first = createMockWebviewView();
    const second = createMockWebviewView();

    provider.resolveWebviewView(
      first.webviewView,
      {} as vscode.WebviewViewResolveContext,
      {} as vscode.CancellationToken,
    );
    provider.resolveWebviewView(
      second.webviewView,
      {} as vscode.WebviewViewResolveContext,
      {} as vscode.CancellationToken,
    );

    for (const handler of first.messageHandlers) {
      handler({ type: "vaultWatchSession", entryId: "claude:old" });
    }
    await Promise.resolve();
    expect(firstClient.watchSession).toHaveBeenCalledWith("claude:old");
    expect(secondClient.watchSession).not.toHaveBeenCalled();

    for (const handler of first.disposeHandlers) {
      handler();
    }
    expect(secondClient.dispose).not.toHaveBeenCalled();

    for (const handler of second.messageHandlers) {
      handler({ type: "vaultWatchSession", entryId: "claude:new" });
    }
    await Promise.resolve();
    expect(secondClient.watchSession).toHaveBeenCalledWith("claude:new");
    sm.dispose();
  });
});

// ─── Split Pane Ghost Tab Fix ───────────────────────────────────────

describe("TerminalViewProvider: split pane ghost tab fix", () => {
  it("creates split pane session with isSplitPane flag", () => {
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");

    const { webviewView, messageHandlers } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);

    // Simulate ready — creates root session
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }

    const tabsBefore = sm.getTabsForView(provider.getViewId());
    expect(tabsBefore).toHaveLength(1);
    const rootTabId = tabsBefore[0].id;

    // Simulate split request
    for (const handler of messageHandlers) {
      handler({
        type: "requestSplitSession",
        requestId: "split-flag",
        direction: "vertical",
        sourceTabId: rootTabId,
        sourcePaneId: rootTabId,
      });
    }

    const child = sm.getAllSessionsForView(provider.getViewId()).find((session) => session.isSplitPane)!.id;
    for (const handler of messageHandlers) {
      handler({ type: "splitPaneAttachmentResult", requestId: "split-flag", newSessionId: child, status: "attached" });
    }

    // getTabsForView should still return only the root tab (split pane filtered out)
    const tabsAfter = sm.getTabsForView(provider.getViewId());
    expect(tabsAfter).toHaveLength(1);
    expect(tabsAfter[0].id).toBe(rootTabId);

    // Root tab should still be active
    expect(tabsAfter[0].isActive).toBe(true);

    sm.dispose();
  });

  it("inherits the source pane's stable owner and cwd", () => {
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");
    const { webviewView, messageHandlers, postMessageSpy } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    const rootTabId = sm.createSession(provider.getViewId(), webviewView.webview, {
      cwd: "/repo-wt/feat",
      worktreeId: "/repo-wt/feat",
    });
    sm.setCurrentCwd(rootTabId, "/repo-wt/feat/packages/app");

    for (const handler of messageHandlers) {
      handler({
        type: "requestSplitSession",
        requestId: "split-owner",
        direction: "vertical",
        sourceTabId: rootTabId,
        sourcePaneId: rootTabId,
      });
    }

    const split = sm.getAllSessionsForView(provider.getViewId()).find((session) => session.id !== rootTabId);
    expect(split?.worktreeId).toBe("/repo-wt/feat");
    expect(sm.getSession(split!.id)?.initialCwd).toBe("/repo-wt/feat/packages/app");
    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "splitPaneCreated", requestId: "split-owner", sourceTabId: rootTabId }),
    );
    for (const handler of messageHandlers) {
      handler({
        type: "splitPaneAttachmentResult",
        requestId: "split-owner",
        newSessionId: split!.id,
        status: "attached",
      });
    }
    sm.dispose();
  });

  it("init on re-creation includes split pane sessions with isSplitPane flag", () => {
    // Contract change (restore-terminal-sessions design.md D12): init MUST
    // carry every session — roots AND split-pane children — so the webview
    // can recreate every xterm referenced by `tabLayouts` on reload. Splits
    // are still filtered from the tab strip (root-only), but the WIRE-level
    // init now exposes them tagged with `isSplitPane: true`.
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");

    const { webviewView: wv1, messageHandlers: mh1 } = createMockWebviewView();
    provider.resolveWebviewView(wv1, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    for (const handler of mh1) {
      handler({ type: "ready" });
    }

    const rootTabId = sm.getTabsForView(provider.getViewId())[0].id;

    for (const handler of mh1) {
      handler({
        type: "requestSplitSession",
        requestId: "split-restore",
        direction: "horizontal",
        sourceTabId: rootTabId,
        sourcePaneId: rootTabId,
      });
    }
    const splitSessionId = sm.getAllSessionsForView(provider.getViewId()).find((session) => session.isSplitPane)!.id;
    for (const handler of mh1) {
      handler({
        type: "splitPaneAttachmentResult",
        requestId: "split-restore",
        newSessionId: splitSessionId,
        status: "attached",
      });
    }

    const { webviewView: wv2, messageHandlers: mh2, postMessageSpy: pms2 } = createMockWebviewView();
    provider.resolveWebviewView(wv2, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    for (const handler of mh2) {
      handler({ type: "ready" });
    }

    const initCall = pms2.mock.calls.find((call: unknown[]) => (call[0] as { type: string }).type === "init");
    expect(initCall).toBeDefined();
    const initMsg = initCall![0] as { tabs: Array<{ id: string; isSplitPane?: boolean }> };
    expect(initMsg.tabs).toHaveLength(2);
    const root = initMsg.tabs.find((t) => t.id === rootTabId);
    const split = initMsg.tabs.find((t) => t.id !== rootTabId);
    expect(root?.isSplitPane).toBe(false);
    expect(split?.isSplitPane).toBe(true);

    // Tab strip still filters splits — the root-only view stays root-only.
    expect(sm.getTabsForView(provider.getViewId())).toHaveLength(1);

    sm.dispose();
  });
});

// ─── vaultCopyResumeCommand ─────────────────────────────────────────

describe("TerminalViewProvider: vaultCopyResumeCommand", () => {
  function wireCopy(launcher: Partial<VaultLauncher>): {
    sm: SessionManager;
    send: (msg: unknown) => void;
    writeText: ReturnType<typeof vi.fn>;
    postMessageSpy: ReturnType<typeof vi.fn>;
  } {
    const writeText = vi.fn(async () => {});
    // The mock module has no clipboard of its own; the provider imports this
    // very object, so defining it here is enough (and stays inside the test).
    (vscodeMockEnv as { clipboard?: { writeText: unknown } }).clipboard = { writeText };
    const sm = new SessionManager();
    const provider = new TerminalViewProvider(
      { fsPath: "/mock/extension" } as vscode.Uri,
      sm,
      "sidebar",
      null,
      null,
      {} as VaultService,
      launcher as VaultLauncher,
    );
    const { webviewView, messageHandlers, postMessageSpy } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    return {
      sm,
      send: (msg: unknown) => {
        for (const handler of messageHandlers) {
          handler(msg);
        }
      },
      writeText,
      postMessageSpy,
    };
  }

  afterEach(() => {
    delete (vscodeMockEnv as { clipboard?: unknown }).clipboard;
  });

  it("copies the command the launcher built after its own gates passed", async () => {
    const buildResumeCommand = vi.fn(async () => "cursor-agent --resume chat-1");
    const { sm, send, writeText } = wireCopy({ buildResumeCommand });
    send({ type: "vaultCopyResumeCommand", entryId: "cursor:chat-1" });
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("cursor-agent --resume chat-1"));
    expect(buildResumeCommand).toHaveBeenCalledWith("cursor:chat-1");
    sm.dispose();
  });

  it("leaves the clipboard untouched when the launcher refuses the entry", async () => {
    const buildResumeCommand = vi.fn(async () => {
      throw new VaultLaunchError("Couldn't verify the stored session identity", "resume-unsupported");
    });
    const { sm, send, writeText, postMessageSpy } = wireCopy({ buildResumeCommand });
    send({ type: "vaultCopyResumeCommand", entryId: "cursor:chat-1" });
    await vi.waitFor(() =>
      expect(postMessageSpy.mock.calls.some((call: unknown[]) => (call[0] as { type: string }).type === "error")).toBe(
        true,
      ),
    );
    expect(writeText).not.toHaveBeenCalled();
    sm.dispose();
  });
});

// ─── vaultSetStarred / vaultEditTags ────────────────────────────────

describe("TerminalViewProvider: vault stars and tags", () => {
  afterEach(() => {
    delete (vscodeMockWindow as { createQuickPick?: unknown }).createQuickPick;
  });

  function wireMarks(vaultService: Partial<VaultService>): { sm: SessionManager; send: (msg: unknown) => void } {
    const sm = new SessionManager();
    const provider = new TerminalViewProvider(
      { fsPath: "/mock/extension" } as vscode.Uri,
      sm,
      "sidebar",
      null,
      null,
      vaultService as VaultService,
    );
    const { webviewView, messageHandlers } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    return {
      sm,
      send: (msg: unknown) => {
        for (const handler of messageHandlers) {
          handler(msg);
        }
      },
    };
  }

  it("stars and unstars the named entry", () => {
    const setStarred = vi.fn();
    const { sm, send } = wireMarks({ setStarred });
    send({ type: "vaultSetStarred", entryId: "claude:s1", starred: true });
    send({ type: "vaultSetStarred", entryId: "claude:s1", starred: false });
    expect(setStarred.mock.calls).toEqual([
      ["claude:s1", true],
      ["claude:s1", false],
    ]);
    sm.dispose();
  });

  it("ignores a malformed star message", () => {
    const setStarred = vi.fn();
    const { sm, send } = wireMarks({ setStarred });
    send({ type: "vaultSetStarred", entryId: "claude:s1", starred: "yes" });
    send({ type: "vaultSetStarred", entryId: 7, starred: true });
    send({ type: "vaultSetStarred", starred: true });
    expect(setStarred).not.toHaveBeenCalled();
    sm.dispose();
  });

  it("opens the tag picker over the entry's tags and saves what is accepted", async () => {
    const listeners: Record<string, Array<(...args: unknown[]) => unknown>> = {};
    const on = (name: string) => (l: (...args: unknown[]) => unknown) => {
      (listeners[name] ??= []).push(l);
      return { dispose: () => {} };
    };
    const qp = {
      title: undefined,
      placeholder: undefined,
      canSelectMany: false,
      items: [] as Array<{ label: string }>,
      selectedItems: [] as Array<{ label: string }>,
      value: "",
      onDidChangeValue: on("value"),
      onDidChangeSelection: on("selection"),
      onDidAccept: on("accept"),
      onDidHide: on("hide"),
      show: vi.fn(),
      hide: () => {
        for (const l of listeners.hide ?? []) {
          l();
        }
      },
      dispose: vi.fn(),
    };
    (vscodeMockWindow as { createQuickPick?: unknown }).createQuickPick = () => qp;
    const setTags = vi.fn();
    const { sm, send } = wireMarks({
      marksOf: () => ({ tags: ["review"] }),
      knownTags: () => ["infra", "review"],
      setTags,
    });
    send({ type: "vaultEditTags", entryId: "claude:s1" });
    await vi.waitFor(() => expect(qp.show).toHaveBeenCalled());
    expect(qp.items.map((i) => i.label)).toEqual(["review", "infra"]);
    expect(qp.selectedItems.map((i) => i.label)).toEqual(["review"]);
    qp.selectedItems = qp.items.slice();
    for (const l of listeners.accept ?? []) {
      l();
    }
    await vi.waitFor(() => expect(setTags).toHaveBeenCalledWith("claude:s1", ["review", "infra"]));
    expect(qp.dispose).toHaveBeenCalled();
    sm.dispose();
  });

  it("ignores a tag edit without an entry id", () => {
    const createQuickPick = vi.fn();
    (vscodeMockWindow as { createQuickPick?: unknown }).createQuickPick = createQuickPick;
    const { sm, send } = wireMarks({ marksOf: () => undefined, knownTags: () => [], setTags: vi.fn() });
    send({ type: "vaultEditTags" });
    expect(createQuickPick).not.toHaveBeenCalled();
    sm.dispose();
  });
});

// ─── vaultExportMarkdown ────────────────────────────────────────────

describe("TerminalViewProvider: vaultExportMarkdown", () => {
  afterEach(() => {
    delete (vscodeMockWindow as { showSaveDialog?: unknown }).showSaveDialog;
  });

  function wireExport(vaultService: Partial<VaultService>): {
    sm: SessionManager;
    send: (msg: unknown) => void;
  } {
    const sm = new SessionManager();
    const provider = new TerminalViewProvider(
      { fsPath: "/mock/extension" } as vscode.Uri,
      sm,
      "sidebar",
      null,
      null,
      vaultService as VaultService,
    );
    const { webviewView, messageHandlers } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    return {
      sm,
      send: (msg: unknown) => {
        for (const handler of messageHandlers) {
          handler(msg);
        }
      },
    };
  }

  it("reads the full session and asks where to save it", async () => {
    const showSaveDialog = vi.fn(async () => undefined);
    (vscodeMockWindow as { showSaveDialog?: unknown }).showSaveDialog = showSaveDialog;
    const getDetail = vi.fn(async () => ({
      entryId: "claude:s1",
      contentKind: "timeline" as const,
      recentActivity: [],
      timeline: [],
      stats: { messageCount: 0, toolCount: 0, subagentCount: 0 },
    }));
    const { sm, send } = wireExport({
      getEntry: vi.fn(async () => ({
        id: "claude:s1",
        agent: "claude",
        sessionId: "s1",
        title: "Fix login",
        cwd: "/not/a/dir",
        modified: 0,
        flags: {},
      })),
      getDetail,
      customNameOf: () => undefined,
    });
    send({ type: "vaultExportMarkdown", entryId: "claude:s1" });
    await vi.waitFor(() => expect(showSaveDialog).toHaveBeenCalledTimes(1));
    expect(getDetail).toHaveBeenCalledWith("claude:s1", 5000);
    sm.dispose();
  });

  it("ignores a message without a string entry id", async () => {
    const getEntry = vi.fn();
    const { sm, send } = wireExport({ getEntry });
    send({ type: "vaultExportMarkdown", entryId: 42 });
    await Promise.resolve();
    expect(getEntry).not.toHaveBeenCalled();
    sm.dispose();
  });
});

describe("TerminalViewProvider: committed navigation", () => {
  it("routes a retained split pane and clears tab and pane together", () => {
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");
    const { webviewView, messageHandlers } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }
    const root = sm.getTabsForView(provider.getViewId())[0].id;
    const pane = sm.createSession(provider.getViewId(), webviewView.webview, {
      isSplitPane: true,
      rootTabId: "retained-root",
    });

    for (const handler of messageHandlers) {
      handler({ type: "terminalNavigationCommitted", activeTabId: "retained-root", activePaneId: pane });
    }
    expect(provider.getActiveTabId()).toBe("retained-root");
    expect(provider.getActiveSessionId()).toBe(pane);

    for (const handler of messageHandlers) {
      handler({ type: "terminalNavigationCommitted", activeTabId: null, activePaneId: null });
    }
    expect(provider.getActiveTabId()).toBeUndefined();
    expect(provider.getActiveSessionId()).toBeUndefined();
    expect(sm.getSession(root)?.isActive).toBe(false);
    sm.dispose();
  });

  it("does not let a different surface replace its routing cache", () => {
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");
    const { webviewView, messageHandlers } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }
    const sidebarRoot = sm.getTabsForView(provider.getViewId())[0].id;
    const panelRoot = sm.createSession("portaterm.panel", webviewView.webview);

    for (const handler of messageHandlers) {
      handler({ type: "terminalNavigationCommitted", activeTabId: panelRoot, activePaneId: panelRoot });
    }
    expect(provider.getActiveTabId()).toBe(sidebarRoot);
    expect(provider.getActiveSessionId()).toBe(sidebarRoot);
    sm.dispose();
  });

  it("keeps focus messages as surface recency only", () => {
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");
    const { webviewView, messageHandlers } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }
    const root = sm.getTabsForView(provider.getViewId())[0].id;
    const pane = sm.createSession(provider.getViewId(), webviewView.webview, { isSplitPane: true, rootTabId: root });

    for (const handler of messageHandlers) {
      handler({ type: "focus", activeSessionId: pane });
    }
    expect(provider.getActiveSessionId()).toBe(root);
    expect(TerminalViewProvider.getLastFocusedProvider()).toBe(provider);
    sm.dispose();
  });
});

describe("TerminalViewProvider: split attachment lifecycle", () => {
  it("destroys a child rejected by the webview", async () => {
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");
    const { webviewView, messageHandlers } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }
    const root = sm.getTabsForView(provider.getViewId())[0].id;

    for (const handler of messageHandlers) {
      handler({
        type: "requestSplitSession",
        requestId: "rejected",
        sourceTabId: root,
        sourcePaneId: root,
        direction: "vertical",
      });
    }
    const child = sm.getAllSessionsForView(provider.getViewId()).find((session) => session.isSplitPane)!.id;
    for (const handler of messageHandlers) {
      handler({ type: "splitPaneAttachmentResult", requestId: "rejected", newSessionId: child, status: "rejected" });
    }
    await vi.waitFor(() => expect(sm.getSession(child)).toBeUndefined());
    sm.dispose();
  });

  it("destroys a delivered child rejected by the webview deadline without a child id", async () => {
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");
    const { webviewView, messageHandlers } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }
    const root = sm.getTabsForView(provider.getViewId())[0].id;

    for (const handler of messageHandlers) {
      handler({
        type: "requestSplitSession",
        requestId: "deadline-rejected",
        sourceTabId: root,
        sourcePaneId: root,
        direction: "vertical",
      });
    }
    const child = sm.getAllSessionsForView(provider.getViewId()).find((session) => session.isSplitPane)!.id;
    for (const handler of messageHandlers) {
      handler({ type: "splitPaneAttachmentResult", requestId: "deadline-rejected", status: "rejected" });
    }

    await vi.waitFor(() => expect(sm.getSession(child)).toBeUndefined());
    sm.dispose();
  });

  it("never rolls back an acknowledged child", async () => {
    vi.useFakeTimers();
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");
    const { webviewView, messageHandlers } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }
    const root = sm.getTabsForView(provider.getViewId())[0].id;

    for (const handler of messageHandlers) {
      handler({
        type: "requestSplitSession",
        requestId: "attached",
        sourceTabId: root,
        sourcePaneId: root,
        direction: "vertical",
      });
    }
    const child = sm.getAllSessionsForView(provider.getViewId()).find((session) => session.isSplitPane)!.id;
    for (const handler of messageHandlers) {
      handler({ type: "splitPaneAttachmentResult", requestId: "attached", newSessionId: child, status: "attached" });
    }
    await vi.advanceTimersByTimeAsync(6000);
    expect(sm.getSession(child)).toBeDefined();
    vi.useRealTimers();
    sm.dispose();
  });

  it("retains a delivered child while attachment acknowledgement is delayed", async () => {
    vi.useFakeTimers();
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");
    const { webviewView, messageHandlers } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }
    const root = sm.getTabsForView(provider.getViewId())[0].id;

    for (const handler of messageHandlers) {
      handler({
        type: "requestSplitSession",
        requestId: "delivered-awaiting-ack",
        sourceTabId: root,
        sourcePaneId: root,
        direction: "vertical",
      });
    }
    const child = sm.getAllSessionsForView(provider.getViewId()).find((session) => session.isSplitPane)!.id;

    await vi.advanceTimersByTimeAsync(6000);
    expect(sm.getSession(child)).toBeDefined();

    for (const handler of messageHandlers) {
      handler({
        type: "splitPaneAttachmentResult",
        requestId: "delivered-awaiting-ack",
        newSessionId: child,
        status: "attached",
      });
    }
    vi.useRealTimers();
    sm.dispose();
  });

  it("rejects a split response delivered after the host delivery deadline", async () => {
    vi.useFakeTimers();
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");
    const { webviewView, messageHandlers, postMessageSpy } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }
    const root = sm.getTabsForView(provider.getViewId())[0].id;
    let resolveDelivery!: (delivered: boolean) => void;
    postMessageSpy.mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveDelivery = resolve;
      }),
    );

    for (const handler of messageHandlers) {
      handler({
        type: "requestSplitSession",
        requestId: "late-delivery",
        sourceTabId: root,
        sourcePaneId: root,
        direction: "vertical",
      });
    }
    const child = sm.getAllSessionsForView(provider.getViewId()).find((session) => session.isSplitPane)!.id;

    await vi.advanceTimersByTimeAsync(5001);
    expect(sm.getSession(child)).toBeDefined();
    resolveDelivery(true);
    await vi.advanceTimersByTimeAsync(0);
    for (const handler of messageHandlers) {
      handler({ type: "splitPaneAttachmentResult", requestId: "late-delivery", status: "rejected" });
    }
    await vi.waitFor(() => expect(sm.getSession(child)).toBeUndefined());

    vi.useRealTimers();
    sm.dispose();
  });

  it("rolls back a child when response delivery fails", async () => {
    vi.useFakeTimers();
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");
    const { webviewView, messageHandlers, postMessageSpy } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }
    const root = sm.getTabsForView(provider.getViewId())[0].id;
    postMessageSpy.mockResolvedValue(false);

    for (const handler of messageHandlers) {
      handler({
        type: "requestSplitSession",
        requestId: "undelivered",
        sourceTabId: root,
        sourcePaneId: root,
        direction: "vertical",
      });
    }
    const child = sm.getAllSessionsForView(provider.getViewId()).find((session) => session.isSplitPane)!.id;
    await vi.advanceTimersByTimeAsync(200);
    expect(sm.getSession(child)).toBeUndefined();
    vi.useRealTimers();
    sm.dispose();
  });

  it("[I21] keeps an unresolved delivery tracked until surface disposal", async () => {
    vi.useFakeTimers();
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");
    const { webviewView, messageHandlers, postMessageSpy, disposeHandlers } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }
    const root = sm.getTabsForView(provider.getViewId())[0].id;
    postMessageSpy.mockReturnValue(new Promise<boolean>(() => {}));
    for (const handler of messageHandlers) {
      handler({
        type: "requestSplitSession",
        requestId: "timeout",
        sourceTabId: root,
        sourcePaneId: root,
        direction: "vertical",
      });
    }
    const child = sm.getAllSessionsForView(provider.getViewId()).find((session) => session.isSplitPane)!.id;

    await vi.advanceTimersByTimeAsync(5001);
    expect(sm.getSession(child)).toBeDefined();
    for (const dispose of disposeHandlers) {
      dispose();
    }
    await vi.waitFor(() => expect(sm.getSession(child)).toBeUndefined());
    vi.useRealTimers();
    sm.dispose();
  });

  it("rolls back pending children when their source disappears", async () => {
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");
    const { webviewView, messageHandlers } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }
    const root = sm.getTabsForView(provider.getViewId())[0].id;
    for (const handler of messageHandlers) {
      handler({
        type: "requestSplitSession",
        requestId: "source-gone",
        sourceTabId: root,
        sourcePaneId: root,
        direction: "vertical",
      });
    }
    const child = sm.getAllSessionsForView(provider.getViewId()).find((session) => session.isSplitPane)!.id;
    for (const handler of messageHandlers) {
      handler({ type: "requestCloseSplitPane", sessionId: root });
    }

    await vi.waitFor(() => expect(sm.getSession(child)).toBeUndefined());
    sm.dispose();
  });

  it("rolls back pending children when the surface is disposed", async () => {
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");
    const { webviewView, messageHandlers, disposeHandlers } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }
    const root = sm.getTabsForView(provider.getViewId())[0].id;
    for (const handler of messageHandlers) {
      handler({
        type: "requestSplitSession",
        requestId: "disposed",
        sourceTabId: root,
        sourcePaneId: root,
        direction: "vertical",
      });
    }
    const child = sm.getAllSessionsForView(provider.getViewId()).find((session) => session.isSplitPane)!.id;
    for (const dispose of disposeHandlers) {
      dispose();
    }

    await vi.waitFor(() => expect(sm.getSession(child)).toBeUndefined());
    expect(sm.getSession(root)).toBeDefined();
    sm.dispose();
  });

  it("creates no child for a missing source", () => {
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");
    const { webviewView, messageHandlers } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }
    const before = sm.getAllSessionsForView(provider.getViewId()).length;

    for (const handler of messageHandlers) {
      handler({
        type: "requestSplitSession",
        requestId: "missing",
        sourceTabId: "gone",
        sourcePaneId: "gone",
        direction: "vertical",
      });
    }
    expect(sm.getAllSessionsForView(provider.getViewId())).toHaveLength(before);
    sm.dispose();
  });
});

describe("TerminalViewProvider: explicit panel sizing", () => {
  it.each(["panel", "sidebar"] as const)("gates panel sizing by the %s provider location", (location) => {
    const execute = vi.spyOn(vscodeMockCommands, "executeCommand");
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, location);
    const { webviewView, messageHandlers, disposeHandlers } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    try {
      expect(execute).not.toHaveBeenCalledWith("workbench.action.toggleMaximizedPanel");
      for (const handler of messageHandlers) {
        handler({ type: "toggleMaximizedPanel" });
      }
      const calls = execute.mock.calls.filter(([command]) => command === "workbench.action.toggleMaximizedPanel");
      expect(calls).toHaveLength(location === "panel" ? 1 : 0);
      if (location === "panel") {
        expect(calls[0]).toEqual(["workbench.action.toggleMaximizedPanel"]);
      }
      execute.mockClear();
      for (const dispose of disposeHandlers) {
        dispose();
      }
      for (const handler of messageHandlers) {
        handler({ type: "toggleMaximizedPanel" });
      }
      expect(execute).not.toHaveBeenCalledWith("workbench.action.toggleMaximizedPanel");
    } finally {
      sm.dispose();
    }
  });
});
