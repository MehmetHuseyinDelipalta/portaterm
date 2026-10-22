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
