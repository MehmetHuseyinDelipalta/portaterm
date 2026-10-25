// The one door that cannot ask: VS Code fires `onDidDispose` after the editor
// tab is already gone and exposes no close veto, so this path trades the
// question for an undo. What is asserted here is the lifecycle that undo needs
// — a longer grace and a notification while an agent is live, a reopen that
// lands under the ORIGINAL panelId so the surviving sessions rebind, and
// nothing at all once the window has elapsed (review round-1 F003).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../pty/processCwd", async () => (await import("../test/sessionMocks")).processCwdMock());
vi.mock("../pty/PtyManager", async () => (await import("../test/sessionMocks")).ptyManagerMock());
vi.mock("../pty/PtySession", async () => (await import("../test/sessionMocks")).ptySessionMock());
vi.mock("../session/OutputBuffer", async () => (await import("../test/sessionMocks")).outputBufferMock());

import { createPaneEvidenceStore, type PaneEvidenceStore } from "../session/PaneEvidenceStore";
import { SessionManager } from "../session/SessionManager";
import { __resetAll, __setAppRoot, __setWorkspaceFolders } from "../test/__mocks__/vscode";
import { mockExtensionContext as createMockContext } from "../test/providerTestUtils";
import { TerminalEditorProvider } from "./TerminalEditorProvider";

interface Disposal {
  viewId: string;
  panelId: string;
  running: readonly { sessionId: string; name: string }[];
  graceMs: number;
}

/** Open an editor panel, drive it to `ready`, and hand back its one session. */
async function openPanel(sm: SessionManager, evidence: PaneEvidenceStore) {
  const ctx = createMockContext();
  const vscode = await import("vscode");
  const createSpy = vi.spyOn(vscode.window, "createWebviewPanel");
  const handle = TerminalEditorProvider.createPanel(ctx, sm, null, null, null, evidence);
  const panel = createSpy.mock.results[0].value as {
    dispose(): void;
    __messageHandlers: ((m: unknown) => void)[];
  };
  for (const handler of panel.__messageHandlers) {
    handler({ type: "ready" });
  }
  const panelId = sm.getLiveEditorPanelsRecord().panels[0].panelId;
  const viewId = `editor-${panelId}`;
  const sessionId = sm.getAllSessionsForView(viewId)[0]?.id as string;
  createSpy.mockRestore();
  return { ctx, panel, handle, panelId, viewId, sessionId };
}

let disposals: Disposal[];

beforeEach(() => {
  __resetAll();
  __setAppRoot("/mock/vscode/app");
  __setWorkspaceFolders([{ uri: { fsPath: "/mock/workspace" } }]);
  disposals = [];
  TerminalEditorProvider.setDisposalNotifier((info) => disposals.push(info));
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  TerminalEditorProvider.setDisposalNotifier(null);
  vi.restoreAllMocks();
  __resetAll();
});

describe("closing an editor tab that holds a live agent", () => {
  it("holds the ptys longer and says what is at stake", async () => {
    const evidence = createPaneEvidenceStore();
    const sm = new SessionManager(undefined, { paneEvidence: evidence });
    const { panel, sessionId } = await openPanel(sm, evidence);
    evidence.markProcess(sessionId, { shell: "claude", isAgentLaunch: true });
    evidence.reportTurn(sessionId, { state: "working", stateStartedAt: 0, subagents: [] });
    const scheduleSpy = vi.spyOn(sm, "scheduleDestroyForView");

    panel.dispose();

    expect(scheduleSpy.mock.calls[0][1]).toBe(30_000);
    expect(disposals).toHaveLength(1);
    expect(disposals[0].running).toEqual([{ sessionId, name: "claude" }]);
    expect(disposals[0].viewId).toBe(`editor-${disposals[0].panelId}`);
    sm.dispose();
  });

  it("says nothing, and keeps the ordinary grace, for an idle shell", async () => {
    // Non-vacuous counterpart: same door, same panel, only the evidence differs.
    const evidence = createPaneEvidenceStore();
    const sm = new SessionManager(undefined, { paneEvidence: evidence });
    const { panel, sessionId } = await openPanel(sm, evidence);
    evidence.markProcess(sessionId, { shell: "zsh", isAgentLaunch: false });
    const scheduleSpy = vi.spyOn(sm, "scheduleDestroyForView");

    panel.dispose();

    expect(scheduleSpy.mock.calls[0][1]).toBe(5_000);
    expect(disposals).toEqual([]);
    sm.dispose();
  });
});

describe("the undo", () => {
  it("reopens under the original panelId, so the surviving session rebinds", async () => {
    const evidence = createPaneEvidenceStore();
    const sm = new SessionManager(undefined, { paneEvidence: evidence });
    const { ctx, panel, sessionId } = await openPanel(sm, evidence);
    evidence.markProcess(sessionId, { shell: "claude", isAgentLaunch: true });
    evidence.reportTurn(sessionId, { state: "working", stateStartedAt: 0, subagents: [] });
    panel.dispose();
    const { panelId, viewId } = disposals[0];

    const vscode = await import("vscode");
    const createSpy = vi.spyOn(vscode.window, "createWebviewPanel");
    const rebindSpy = vi.spyOn(sm, "updateWebviewForView");
    const reopened = TerminalEditorProvider.reopen(ctx, sm, panelId, null, null, null, evidence);

    expect(reopened).toBeDefined();
    expect(createSpy).toHaveBeenCalledTimes(1);
    // The new webview announces itself exactly as a reload's does, and the
    // surviving sessions rebind to it — the identity is the whole point, since
    // a fresh panelId would have reattached to nothing.
    const revived = createSpy.mock.results[0].value as { __messageHandlers: ((m: unknown) => void)[] };
    for (const handler of revived.__messageHandlers) {
      handler({ type: "ready" });
    }
    expect(rebindSpy.mock.calls[0][0]).toBe(viewId);
    // The claim is consumed, so the prior instance's timer can no longer kill
    // the ptys the new panel just adopted.
    expect(sm.getPendingDestroyViewIds()).not.toContain(viewId);
    expect(sm.getSession(sessionId)).toBeDefined();

    vi.advanceTimersByTime(60_000);
    expect(sm.getSession(sessionId)).toBeDefined();
    sm.dispose();
  });

  it("opens nothing once the window has elapsed", async () => {
    // The toast outlives its grace — clicking it late must not hand back an
    // empty tab in the name of the agent it promised (round-1 F001).
    const evidence = createPaneEvidenceStore();
    const sm = new SessionManager(undefined, { paneEvidence: evidence });
    const { ctx, panel, sessionId } = await openPanel(sm, evidence);
    evidence.markProcess(sessionId, { shell: "claude", isAgentLaunch: true });
    evidence.reportTurn(sessionId, { state: "working", stateStartedAt: 0, subagents: [] });
    panel.dispose();
    const { panelId } = disposals[0];

    vi.advanceTimersByTime(30_001);

    const vscode = await import("vscode");
    const createSpy = vi.spyOn(vscode.window, "createWebviewPanel");
    expect(TerminalEditorProvider.reopen(ctx, sm, panelId, null, null, null, evidence)).toBeUndefined();
    expect(createSpy).not.toHaveBeenCalled();
    sm.dispose();
  });
});
