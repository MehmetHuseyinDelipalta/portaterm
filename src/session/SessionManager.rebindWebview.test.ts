// src/session/SessionManager.rebindWebview.test.ts — after a view is re-created,
// a session's later events reach the NEW webview.
//
// `updateWebviewForView` swaps `session.webview` and the output buffer's target.
// The PTY's exit handler and the agent shell-fallback used to post through the
// webview captured when the PTY was wired, so after a move the "[Process
// exited]" message and the fallback shell's whole output went to the dead page.
// The real OutputBuffer runs here, so a flush shows exactly where output lands.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAll, __setAppRoot, __setWorkspaceFolders } from "../test/__mocks__/vscode";
import { mockPtySessions } from "../test/sessionMocks";
import type { MessageSender } from "./OutputBuffer";

vi.mock("../pty/processCwd", async () => (await import("../test/sessionMocks")).processCwdMock());
vi.mock("../pty/PtyManager", async () => (await import("../test/sessionMocks")).ptyManagerMock());
vi.mock("../pty/PtySession", async () => (await import("../test/sessionMocks")).ptySessionMock());

import { SessionManager } from "./SessionManager";

function page(): MessageSender & { types: () => string[]; output: () => string } {
  const messages: Array<{ type: string; data?: string }> = [];
  return {
    postMessage: async (m: unknown) => {
      messages.push(m as { type: string; data?: string });
      return true;
    },
    types: () => messages.map((m) => m.type),
    output: () =>
      messages
        .filter((m) => m.type === "output")
        .map((m) => m.data)
        .join(""),
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

describe("events after the view is re-created", () => {
  it("posts a natural exit to the new webview, not the one the PTY was wired with", () => {
    const sm = new SessionManager();
    const oldPage = page();
    const newPage = page();
    sm.createSession("sidebar", oldPage);
    sm.updateWebviewForView("sidebar", newPage);

    mockPtySessions[0].onExit?.(0);

    expect(newPage.types()).toContain("exit");
    expect(oldPage.types()).not.toContain("exit");
    sm.dispose();
  });

  it("sends the agent fallback shell's output to the new webview", () => {
    const sm = new SessionManager();
    const oldPage = page();
    const newPage = page();
    const id = sm.createSession("sidebar", oldPage, {
      shell: "claude",
      shellArgs: ["--resume", "x"],
      isAgentLaunch: true,
    });
    sm.updateWebviewForView("sidebar", newPage);

    mockPtySessions[0].onExit?.(0); // the agent quits; a shell takes the pane
    expect(mockPtySessions).toHaveLength(2);
    // The mock indexes handlers by session id: the fallback PTY's onData is entry 0's.
    mockPtySessions[0].onData?.("fallback$ ");
    vi.advanceTimersByTime(20);

    expect(newPage.output()).toContain("fallback$ ");
    expect(oldPage.output()).not.toContain("fallback$ ");
    expect(sm.getSession(id)?.webview).toBe(newPage);
    sm.dispose();
  });

  it("posts the fallback shell's own later exit to the new webview", () => {
    const sm = new SessionManager();
    const oldPage = page();
    const newPage = page();
    sm.createSession("sidebar", oldPage, { shell: "claude", shellArgs: [], isAgentLaunch: true });
    sm.updateWebviewForView("sidebar", newPage);

    mockPtySessions[0].onExit?.(0); // agent → fallback shell
    mockPtySessions[0].onExit?.(0); // the user types `exit` in the fallback shell

    expect(newPage.types()).toContain("exit");
    expect(oldPage.types()).not.toContain("exit");
    sm.dispose();
  });
});
