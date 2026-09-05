// `panesOfTab` is what the close-confirmation gate weighs. It replaced a list
// the WEBVIEW sent: that could be short a pane, and a short list makes the
// warning silent about exactly the agent the close is about to kill.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAll, __setAppRoot, __setWorkspaceFolders } from "../test/__mocks__/vscode";
import { mockWebview as makeWebview } from "../test/sessionMocks";

vi.mock("../pty/processCwd", async () => (await import("../test/sessionMocks")).processCwdMock());
vi.mock("../pty/PtyManager", async () => (await import("../test/sessionMocks")).ptyManagerMock());
vi.mock("../pty/PtySession", async () => (await import("../test/sessionMocks")).ptySessionMock());
vi.mock("./OutputBuffer", async () => (await import("../test/sessionMocks")).outputBufferMock());

import { SessionManager } from "./SessionManager";

beforeEach(() => {
  __resetAll();
  __setAppRoot("/mock/vscode/app");
  __setWorkspaceFolders([{ uri: { fsPath: "/mock/workspace" } }]);
  vi.clearAllMocks();
});

afterEach(() => {
  __resetAll();
  vi.restoreAllMocks();
});

describe("SessionManager.panesOfTab", () => {
  it("names the tab and every split pane under it", () => {
    const sm = new SessionManager();
    const webview = makeWebview();
    const rootId = sm.createSession("sidebar", webview, { shell: "/bin/zsh" });
    const splitId = sm.createSession("sidebar", webview, {
      shell: "/bin/zsh",
      isSplitPane: true,
      rootTabId: rootId,
    });

    expect(sm.panesOfTab(rootId).sort()).toEqual([rootId, splitId].sort());
    sm.dispose();
  });

  it("does not reach into a different tab's panes", () => {
    const sm = new SessionManager();
    const webview = makeWebview();
    const a = sm.createSession("sidebar", webview, { shell: "/bin/zsh" });
    const b = sm.createSession("sidebar", webview, { shell: "/bin/zsh" });
    const underB = sm.createSession("sidebar", webview, {
      shell: "/bin/zsh",
      isSplitPane: true,
      rootTabId: b,
    });

    expect(sm.panesOfTab(a)).toEqual([a]);
    // Non-vacuous: the pane exists and belongs to the other tab.
    expect(sm.panesOfTab(b)).toContain(underB);
    sm.dispose();
  });

  it("answers empty for a tab it does not hold", () => {
    // Empty is not "no panes to worry about" — the caller treats an unknown tab
    // as the id itself rather than as nothing to weigh.
    const sm = new SessionManager();
    expect(sm.panesOfTab("never-created")).toEqual([]);
    sm.dispose();
  });
});
