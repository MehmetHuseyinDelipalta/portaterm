// The vault entry a tab resumed, and the panes of pinned tabs — what the vault's
// pinned-session mirror reads from the session manager.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAll, __setAppRoot, __setWorkspaceFolders } from "../test/__mocks__/vscode";
import { headlessFactories, mockPtySessions, mockWebview } from "../test/sessionMocks";

vi.mock("../pty/processCwd", async () => (await import("../test/sessionMocks")).processCwdMock());
vi.mock("../pty/PtyManager", async () => (await import("../test/sessionMocks")).ptyManagerMock());
vi.mock("../pty/PtySession", async () => (await import("../test/sessionMocks")).ptySessionMock());
vi.mock("./OutputBuffer", async () => (await import("../test/sessionMocks")).outputBufferMock());

import { createPaneEvidenceStore, type PaneEvidenceStore } from "./PaneEvidenceStore";
import { SessionManager } from "./SessionManager";
import type { SessionSnapshotMetadata } from "./SessionSnapshot";

function newSM(paneEvidence?: PaneEvidenceStore) {
  const { headless, serialize } = headlessFactories({ serialize: () => "OUT" });
  return new SessionManager(undefined, {
    restoreEnabled: true,
    headlessFactory: headless,
    serializeAddonFactory: serialize,
    ...(paneEvidence ? { paneEvidence } : {}),
  });
}

const resume = { shell: "claude", shellArgs: ["--resume", "s1"], isAgentLaunch: true, vaultEntryId: "claude:s1" };

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

describe("SessionManager vault entry of a resumed tab", () => {
  it("keeps the entry a resume launch names", () => {
    const sm = newSM();
    const id = sm.createSession("sidebar", mockWebview(), resume);
    expect(sm.getSession(id)?.vaultEntryId).toBe("claude:s1");
    sm.dispose();
  });

  it("drops an entry offered to a session that is not an agent launch", () => {
    const sm = newSM();
    const id = sm.createSession("sidebar", mockWebview(), { vaultEntryId: "claude:s1" });
    expect(sm.getSession(id)?.vaultEntryId).toBeUndefined();
    sm.dispose();
  });

  it("writes the entry into the snapshot, and reads it back on restore", () => {
    const sm = newSM();
    const id = sm.createSession("sidebar", mockWebview(), resume);
    mockPtySessions[0].onData?.("seed"); // the headless mirror the snapshot reads starts on output
    const metadata = sm.generateSnapshotMetadata(id)?.metadata;
    expect(metadata?.vaultEntryId).toBe("claude:s1");
    sm.dispose();

    const restored = newSM();
    const restoredId = restored.createSession("sidebar", mockWebview(), {
      restoreFrom: { metadata: { ...metadata!, sessionId: "r1", rootTabId: "r1" }, buffer: "" },
    });
    expect(restored.getSession(restoredId)?.vaultEntryId).toBe("claude:s1");
    restored.dispose();
  });

  it("forgets the entry when the agent exits and the fallback shell takes the tab", () => {
    const sm = newSM();
    const id = sm.createSession("sidebar", mockWebview(), resume);
    mockPtySessions[0].onData?.("seed");
    mockPtySessions[0].onExit?.(0);
    expect(sm.getSession(id)?.state).toBe("live");
    expect(sm.getSession(id)?.vaultEntryId).toBeUndefined();
    expect(sm.generateSnapshotMetadata(id)?.metadata.vaultEntryId).toBeUndefined();
    sm.dispose();
  });
});

describe("SessionManager.pinnedTabPanes", () => {
  it("lists nothing while no tab is pinned", () => {
    const sm = newSM();
    sm.createSession("sidebar", mockWebview(), resume);
    expect(sm.pinnedTabPanes()).toEqual([]);
    sm.dispose();
  });

  it("lists every pane of a pinned tab, with the entry its launch resumed", () => {
    const sm = newSM();
    const webview = mockWebview();
    const root = sm.createSession("sidebar", webview, resume);
    const split = sm.createSession("sidebar", webview, { isSplitPane: true, rootTabId: root });
    sm.createSession("sidebar", webview);
    sm.setPinned(root, true);

    expect(sm.pinnedTabPanes()).toEqual([{ paneId: root, vaultEntryId: "claude:s1" }, { paneId: split }]);
    sm.dispose();
  });

  it("stops listing a tab once it is unpinned", () => {
    const sm = newSM();
    const root = sm.createSession("sidebar", mockWebview(), resume);
    sm.setPinned(root, true);
    sm.setPinned(root, false);
    expect(sm.pinnedTabPanes()).toEqual([]);
    sm.dispose();
  });

  it("announces each pin change", () => {
    const sm = newSM();
    const onPinnedChange = vi.fn();
    sm.onPinnedChange = onPinnedChange;
    const root = sm.createSession("sidebar", mockWebview());
    sm.setPinned(root, true);
    sm.setPinned(root, false);
    expect(onPinnedChange).toHaveBeenCalledTimes(2);
    sm.dispose();
  });
});

describe("SessionManager restore of a pinned tab's title and hand-started Claude", () => {
  const CLAUDE_ID = "0f7af73f-7dba-4817-9b6e-e3bb63d0ecb0";

  /** A snapshot of a plain shell tab, with the given fields over it. */
  function snapshotOf(over: Partial<SessionSnapshotMetadata>): SessionSnapshotMetadata {
    const sm = newSM();
    const id = sm.createSession("sidebar", mockWebview());
    mockPtySessions[0].onData?.("seed");
    const metadata = sm.generateSnapshotMetadata(id)?.metadata;
    sm.dispose();
    mockPtySessions.length = 0;
    return { ...metadata!, sessionId: "r1", rootTabId: "r1", ...over };
  }

  function restore(metadata: SessionSnapshotMetadata) {
    const sm = newSM();
    const id = sm.createSession("sidebar", mockWebview(), { restoreFrom: { metadata, buffer: "" } });
    const pty = sm.getSession(id)!.pty as unknown as {
      write: ReturnType<typeof vi.fn>;
      setShellIntegrationSink: ReturnType<typeof vi.fn>;
    };
    const promptStart = () => pty.setShellIntegrationSink.mock.calls[0]?.[0]?.({ kind: "promptStart" });
    return { sm, id, pty, promptStart };
  }

  it("writes the tab's last terminal title into the snapshot", () => {
    const evidence = createPaneEvidenceStore();
    const sm = newSM(evidence);
    const id = sm.createSession("sidebar", mockWebview());
    mockPtySessions[0].onData?.("seed");
    evidence.report({ type: "paneEvidence", paneId: id, title: "Greeting", decorated: false });
    expect(sm.generateSnapshotMetadata(id)?.metadata.lastTitle).toBe("Greeting");
    sm.dispose();
  });

  it("restores a tab under its last title, and under its number without one", () => {
    const titled = restore(snapshotOf({ lastTitle: "Greeting" }));
    expect(titled.sm.getSession(titled.id)?.name).toBe("Greeting");
    titled.sm.dispose();

    const untitled = restore(snapshotOf({ lastTitle: "   " }));
    expect(untitled.sm.getSession(untitled.id)?.name).toMatch(/^Terminal \d+$/);
    untitled.sm.dispose();
  });

  it("types the resume into the restored shell at its first prompt, once", () => {
    const r = restore(snapshotOf({ resumeClaudeSessionId: CLAUDE_ID }));
    expect(r.pty.write).not.toHaveBeenCalled();
    r.promptStart();
    r.promptStart();
    expect(r.pty.write).toHaveBeenCalledTimes(1);
    expect(r.pty.write).toHaveBeenCalledWith(`claude --resume ${CLAUDE_ID}\r`);
    // Carried forward, so a reload before the next process pass still resumes.
    expect(r.sm.getSession(r.id)?.resumeClaudeSessionId).toBe(CLAUDE_ID);
    r.sm.dispose();
  });

  it("types it ahead after the fallback delay when the shell reports no prompt", () => {
    vi.useFakeTimers();
    try {
      const r = restore(snapshotOf({ resumeClaudeSessionId: CLAUDE_ID }));
      vi.advanceTimersByTime(2999);
      expect(r.pty.write).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(r.pty.write).toHaveBeenCalledWith(`claude --resume ${CLAUDE_ID}\r`);
      r.sm.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("never types an id that is not a Claude session id into a shell", () => {
    const r = restore(snapshotOf({ resumeClaudeSessionId: "x; rm -rf ~" }));
    r.promptStart();
    expect(r.pty.write).not.toHaveBeenCalled();
    r.sm.dispose();
  });

  it("does not resume into an agent launch, which re-runs its own launch", () => {
    const r = restore(snapshotOf({ shell: "claude", isAgentLaunch: true, resumeClaudeSessionId: CLAUDE_ID }));
    r.promptStart();
    expect(r.pty.write).not.toHaveBeenCalled();
    r.sm.dispose();
  });

  it("drops the resume when the tab closes before its prompt", () => {
    vi.useFakeTimers();
    try {
      const r = restore(snapshotOf({ resumeClaudeSessionId: CLAUDE_ID }));
      r.sm.destroySession(r.id);
      vi.advanceTimersByTime(5000);
      expect(r.pty.write).not.toHaveBeenCalled();
      r.sm.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("records the running Claude of plain panes only, and forgets every pane not named", () => {
    const sm = newSM();
    const webview = mockWebview();
    const shell = sm.createSession("sidebar", webview);
    const agent = sm.createSession("sidebar", webview, resume);
    mockPtySessions[0].onData?.("seed");

    sm.setResumeClaudeSessions(
      new Map([
        [shell, CLAUDE_ID],
        [agent, CLAUDE_ID],
      ]),
    );
    expect(sm.getSession(shell)?.resumeClaudeSessionId).toBe(CLAUDE_ID);
    expect(sm.getSession(agent)?.resumeClaudeSessionId).toBeUndefined();
    expect(sm.generateSnapshotMetadata(shell)?.metadata.resumeClaudeSessionId).toBe(CLAUDE_ID);

    sm.setResumeClaudeSessions(new Map());
    expect(sm.getSession(shell)?.resumeClaudeSessionId).toBeUndefined();
    sm.dispose();
  });
});
