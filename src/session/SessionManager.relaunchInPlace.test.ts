// An agent launch takes over a fresh, untouched shell tab instead of opening a
// second tab beside it.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAll, __setAppRoot, __setWorkspaceFolders } from "../test/__mocks__/vscode";
import { mockPtySessions, mockWebview } from "../test/sessionMocks";

vi.mock("../pty/processCwd", async () => (await import("../test/sessionMocks")).processCwdMock());
vi.mock("../pty/PtyManager", async () => (await import("../test/sessionMocks")).ptyManagerMock());
vi.mock("../pty/PtySession", async () => (await import("../test/sessionMocks")).ptySessionMock());
vi.mock("./OutputBuffer", async () => (await import("../test/sessionMocks")).outputBufferMock());

import { SessionManager } from "./SessionManager";

const AGENT = { shell: "claude", shellArgs: [], cwd: "/proj", isAgentLaunch: true };

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

describe("SessionManager.untouchedActiveTab", () => {
  it("offers a fresh active shell tab", () => {
    const sm = new SessionManager();
    const id = sm.createSession("sidebar", mockWebview());
    expect(sm.untouchedActiveTab("sidebar", undefined)).toBe(id);
    sm.dispose();
  });

  it("ignores terminal replies and navigation keys, but not typed input", () => {
    const sm = new SessionManager();
    const id = sm.createSession("sidebar", mockWebview());
    sm.writeToSession(id, "\x1b[?1;2c");
    sm.writeToSession(id, "\x1b[12;1R");
    sm.writeToSession(id, "\x1bOA");
    sm.writeToSession(id, "\x1b]11;rgb:0000/0000/0000\x07");
    expect(sm.untouchedActiveTab("sidebar", undefined)).toBe(id);

    sm.writeToSession(id, "l");
    expect(sm.untouchedActiveTab("sidebar", undefined)).toBeUndefined();
    sm.dispose();
  });

  it("does not offer an agent tab, a split tab, another worktree's tab, or an inactive tab", () => {
    const sm = new SessionManager();
    sm.createSession("agents", mockWebview(), AGENT);
    expect(sm.untouchedActiveTab("agents", undefined)).toBeUndefined();

    const split = sm.createSession("split", mockWebview());
    sm.createSession("split", mockWebview(), { isSplitPane: true, rootTabId: split });
    expect(sm.untouchedActiveTab("split", undefined)).toBeUndefined();

    sm.createSession("wt", mockWebview(), { worktreeId: "wt-1" });
    expect(sm.untouchedActiveTab("wt", undefined)).toBeUndefined();
    expect(sm.untouchedActiveTab("wt", "wt-1")).toBeDefined();

    const first = sm.createSession("two", mockWebview());
    const second = sm.createSession("two", mockWebview());
    sm.writeToSession(second, "x");
    // The untouched tab is not the active one.
    expect(sm.untouchedActiveTab("two", undefined)).toBeUndefined();
    sm.commitNavigation("two", first, first);
    expect(sm.untouchedActiveTab("two", undefined)).toBe(first);
    sm.dispose();
  });
});

describe("SessionManager.relaunchInPlace", () => {
  it("runs the launch in the same tab and number, as an agent pane", () => {
    const sm = new SessionManager();
    const id = sm.createSession("sidebar", mockWebview());
    const before = sm.getSession(id);
    const oldPty = before?.pty;

    expect(sm.relaunchInPlace(id, { ...AGENT, vaultEntryId: "claude:abc" })).toBe(true);

    const session = sm.getSession(id);
    expect(mockPtySessions).toHaveLength(2);
    expect(oldPty?.dispose).toHaveBeenCalled();
    expect(session?.pty).not.toBe(oldPty);
    expect(session?.number).toBe(1);
    expect(session?.shell).toBe("claude");
    expect(session?.initialCwd).toBe("/proj");
    expect(session?.isAgentLaunch).toBe(true);
    expect(session?.vaultEntryId).toBe("claude:abc");
    expect(session?.shellFallbackArmed).toBe(true);
    // The idle prompt is cleared off the pane.
    expect(session?.outputBuffer.append).toHaveBeenCalledWith("\x1b[H\x1b[2J\x1b[3J");
    // Offered once: the tab now runs the agent.
    expect(sm.untouchedActiveTab("sidebar", undefined)).toBeUndefined();
    expect(sm.relaunchInPlace(id, AGENT)).toBe(false);
    sm.dispose();
  });

  it("refuses a tab someone has typed into", () => {
    const sm = new SessionManager();
    const id = sm.createSession("sidebar", mockWebview());
    sm.writeToSession(id, "ls\r");
    expect(sm.relaunchInPlace(id, AGENT)).toBe(false);
    expect(mockPtySessions).toHaveLength(1);
    sm.dispose();
  });
});

describe("a resume wears what its vault entry remembers", () => {
  const appearanceMessages = (webview: ReturnType<typeof mockWebview>) =>
    (webview.postMessage as ReturnType<typeof vi.fn>).mock.calls
      .map(([m]) => m as { type?: string })
      .filter((m) => m.type === "tabAppearance");

  it("a new tab for a resumed entry opens wearing its color and icon", () => {
    const sm = new SessionManager();
    sm.appearanceForEntry = (entryId) => (entryId === "claude:abc" ? { tabColor: "red", tabIcon: "bug" } : undefined);
    const resumed = sm.createSession("sidebar", mockWebview(), { ...AGENT, vaultEntryId: "claude:abc" });
    const other = sm.createSession("sidebar", mockWebview(), { ...AGENT, vaultEntryId: "claude:zzz" });
    const fresh = sm.createSession("sidebar", mockWebview(), AGENT);
    expect([sm.getSession(resumed)?.tabColor, sm.getSession(resumed)?.tabIcon]).toEqual(["red", "bug"]);
    for (const id of [other, fresh]) {
      expect(sm.getSession(id)?.tabColor).toBeUndefined();
      expect(sm.getSession(id)?.tabIcon).toBeUndefined();
    }
    sm.dispose();
  });

  it("asks only for an agent launch, and never gives a split pane its own", () => {
    const sm = new SessionManager();
    const lookup = vi.fn(() => ({ tabColor: "red" as const }));
    sm.appearanceForEntry = lookup;
    const shell = sm.createSession("sidebar", mockWebview(), { vaultEntryId: "claude:abc" });
    const pane = sm.createSession("sidebar", mockWebview(), {
      ...AGENT,
      vaultEntryId: "claude:abc",
      isSplitPane: true,
      rootTabId: shell,
    });
    expect(sm.getSession(shell)?.tabColor).toBeUndefined();
    expect(sm.getSession(pane)?.tabColor).toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
    sm.dispose();
  });

  it("an in-place resume brings the entry's values and keeps the tab's own where the entry has none", () => {
    const sm = new SessionManager();
    sm.appearanceForEntry = () => ({ tabColor: "cyan" });
    const webview = mockWebview();
    const id = sm.createSession("sidebar", webview);
    sm.setTabAppearance(id, { tabIcon: "rocket" });

    expect(sm.relaunchInPlace(id, { ...AGENT, vaultEntryId: "claude:abc" })).toBe(true);

    expect([sm.getSession(id)?.tabColor, sm.getSession(id)?.tabIcon]).toEqual(["cyan", "rocket"]);
    expect(appearanceMessages(webview).at(-1)).toEqual({
      type: "tabAppearance",
      tabId: id,
      tabColor: "cyan",
      tabIcon: "rocket",
    });
    sm.dispose();
  });

  it("an in-place resume of an entry with only an icon keeps the tab's own color", () => {
    const sm = new SessionManager();
    sm.appearanceForEntry = () => ({ tabIcon: "bug" });
    const id = sm.createSession("sidebar", mockWebview());
    sm.setTabAppearance(id, { tabColor: "green" });
    sm.relaunchInPlace(id, { ...AGENT, vaultEntryId: "claude:abc" });
    expect([sm.getSession(id)?.tabColor, sm.getSession(id)?.tabIcon]).toEqual(["green", "bug"]);
    sm.dispose();
  });

  it("an in-place resume of an entry with nothing remembered leaves the tab as it was", () => {
    const sm = new SessionManager();
    sm.appearanceForEntry = () => undefined;
    const webview = mockWebview();
    const id = sm.createSession("sidebar", webview);
    sm.setTabAppearance(id, { tabColor: "green" });
    const before = appearanceMessages(webview).length;
    sm.relaunchInPlace(id, { ...AGENT, vaultEntryId: "claude:abc" });
    expect(sm.getSession(id)?.tabColor).toBe("green");
    expect(appearanceMessages(webview)).toHaveLength(before);
    sm.dispose();
  });

  it("tells the vault after every change from the tab", () => {
    const sm = new SessionManager();
    const changed = vi.fn();
    sm.onTabAppearanceChange = changed;
    const id = sm.createSession("sidebar", mockWebview());
    const pane = sm.createSession("sidebar", mockWebview(), { isSplitPane: true, rootTabId: id });
    sm.setTabAppearance(id, { tabColor: "red" });
    sm.setTabAppearance(pane, { tabColor: "red" });
    expect(changed.mock.calls).toEqual([[id]]);
    sm.dispose();
  });
});
