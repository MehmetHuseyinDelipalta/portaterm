// src/session/SessionManager.rootPaneClose.test.ts — a tab whose ROOT pane was
// closed keeps its tab-level facts.
//
// Close Pane on a split tab's root leaf keeps the tab (under the root's id)
// with its splits. Pin, custom name, color and icon lived on the root session,
// so they vanished with it: a pinned tab's × then closed it unasked, and
// rename / pin / color on the tab silently did nothing. The first surviving
// split now inherits them and answers for the tab.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAll, __setAppRoot, __setWorkspaceFolders } from "../test/__mocks__/vscode";
import { mockWebview } from "../test/sessionMocks";

vi.mock("../pty/processCwd", async () => (await import("../test/sessionMocks")).processCwdMock());
vi.mock("../pty/PtyManager", async () => (await import("../test/sessionMocks")).ptyManagerMock());
vi.mock("../pty/PtySession", async () => (await import("../test/sessionMocks")).ptySessionMock());
vi.mock("./OutputBuffer", async () => (await import("../test/sessionMocks")).outputBufferMock());

import { SessionManager } from "./SessionManager";

beforeEach(() => {
  __resetAll();
  __setAppRoot("/mock/vscode/app");
  __setWorkspaceFolders([{ uri: { fsPath: "/mock/workspace" } }]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function decoratedSplitTab() {
  const sm = new SessionManager();
  const webview = mockWebview();
  const root = sm.createSession("sidebar", webview, { shell: "/bin/zsh" });
  const split = sm.createSession("sidebar", webview, { shell: "/bin/zsh", isSplitPane: true, rootTabId: root });
  sm.setPinned(root, true);
  sm.renameSession(root, "build");
  sm.setTabAppearance(root, { tabColor: "red", tabIcon: "rocket" } as never);
  const posted = webview.postMessage as ReturnType<typeof vi.fn>;
  posted.mockClear();
  return { sm, root, split, posted };
}

const messages = (posted: ReturnType<typeof vi.fn>) => posted.mock.calls.map(([m]) => m as Record<string, unknown>);

describe("closing a split tab's root pane", () => {
  it("hands the tab's pin, name, color and icon to the surviving split", () => {
    const { sm, root, split } = decoratedSplitTab();
    sm.destroySession(root);

    expect(sm.getTabSession(root)?.id).toBe(split);
    expect(sm.isPinned(root)).toBe(true);
    expect(sm.getSession(split)).toMatchObject({
      pinned: true,
      customName: "build",
      tabColor: "red",
      tabIcon: "rocket",
    });
    sm.dispose();
  });

  it("tells the webview under the TAB id, which it resolves to the same pane", () => {
    const { sm, root, posted } = decoratedSplitTab();
    sm.destroySession(root);

    expect(messages(posted)).toEqual(
      expect.arrayContaining([
        { type: "tabPinned", tabId: root, pinned: true },
        { type: "tabRenamed", tabId: root, customName: "build" },
        { type: "tabAppearance", tabId: root, tabColor: "red", tabIcon: "rocket" },
      ]),
    );
    sm.dispose();
  });

  it("keeps rename, pin and appearance working on the tab afterwards", () => {
    const { sm, root, split, posted } = decoratedSplitTab();
    sm.destroySession(root);
    posted.mockClear();

    sm.renameSession(root, "deploy");
    sm.setPinned(root, false);
    sm.setTabAppearance(root, { tabColor: null });

    expect(sm.getSession(split)).toMatchObject({ customName: "deploy", pinned: false, tabColor: undefined });
    expect(messages(posted).map((m) => [m.type, m.tabId])).toEqual([
      ["tabRenamed", root],
      ["tabPinned", root],
      ["tabAppearance", root],
    ]);
    expect(sm.displayedName(root)).toBe("deploy");
    sm.dispose();
  });

  it("keeps the tab's panes counted as pinned", async () => {
    const { sm, root, split } = decoratedSplitTab();
    sm.destroySession(root);
    await new Promise((r) => setTimeout(r, 20)); // the root is gone from the map
    expect(sm.pinnedTabPanes().map((p) => p.paneId)).toEqual([split]);
    sm.dispose();
  });

  it("sends the inherited facts with the split in the init payload, so a reload keeps them", () => {
    const { sm, root, split } = decoratedSplitTab();
    sm.destroySession(root);
    const entry = sm.getAllSessionsForView("sidebar").find((t) => t.id === split);
    expect(entry).toMatchObject({ pinned: true, customName: "build", tabColor: "red", tabIcon: "rocket" });
    sm.dispose();
  });

  it("does not treat a split pane's own id as a tab", () => {
    const { sm, split } = decoratedSplitTab();
    expect(sm.getTabSession(split)).toBeUndefined();
    sm.renameSession(split, "nope");
    expect(sm.getSession(split)?.customName).not.toBe("nope");
    sm.dispose();
  });

  it("hands nothing over when the root has no split, or when a split pane closes", async () => {
    const sm = new SessionManager();
    const webview = mockWebview();
    const solo = sm.createSession("sidebar", webview, { shell: "/bin/zsh" });
    const root = sm.createSession("sidebar", webview, { shell: "/bin/zsh" });
    const split = sm.createSession("sidebar", webview, { shell: "/bin/zsh", isSplitPane: true, rootTabId: root });
    sm.setPinned(root, true);
    sm.destroySession(solo);
    sm.destroySession(split);
    await new Promise((r) => setTimeout(r, 20)); // the destroy queue
    expect(sm.isPinned(root)).toBe(true);
    expect(sm.getTabSession(root)?.id).toBe(root);
    expect(sm.getTabSession(solo)).toBeUndefined();
    sm.dispose();
  });

  it("answers for the tab through the split while the root's destroy is still queued, and after", async () => {
    const { sm, root, split } = decoratedSplitTab();
    sm.destroySession(root);
    expect(sm.getTabSession(root)?.id).toBe(split); // queued: the root is still in the map
    await new Promise((r) => setTimeout(r, 20));
    expect(sm.getSession(root)).toBeUndefined();
    expect(sm.getTabSession(root)?.id).toBe(split);
    sm.dispose();
  });
});
