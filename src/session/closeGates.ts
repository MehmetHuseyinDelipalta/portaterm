// src/session/closeGates.ts — the two gated destructions, so every door goes
// through the same one.
//
// The rule itself is `killConfirmation.ts`. What lives here is the ORDER, which
// is where round 1 found both defects: a door that skipped the gate entirely,
// and a door that weighed one pane and then let the webview pick another to
// destroy. Both are shapes a test can only catch if the door is callable, so
// the doors funnel through these and `activate()` supplies the seams.
//
// The invariant both hold: the session id that was weighed is the session id
// that is destroyed. Nothing here re-resolves "the active pane" after the
// modal — a modal is open for as long as the user looks at it, and focus can
// move underneath it.

import {
  confirmKill,
  type KillConfirmationUi,
  type KillEvidenceReader,
  type RunningAgentPane,
  runningAgentPanes,
} from "./killConfirmation";

export interface CloseGateDeps {
  evidence: KillEvidenceReader | null;
  ui: KillConfirmationUi;
  /** Every session closing this tab destroys — the host's own answer, not the webview's. */
  panesOfTab(tabId: string): string[];
  /** Whether this session is a leaf of a split, rather than a tab in its own right. */
  isSplitPane(sessionId: string): boolean;
  destroySession(sessionId: string): void;
  /** Tell the surface holding it to tear the tab down. */
  postTabRemoved(sessionId: string): void;
  /** Tell the surface holding it to close exactly this pane. */
  postClosePane(sessionId: string): void;
}

/**
 * Kill one terminal, asking first when it is running an agent.
 *
 * `panesOfTab` rather than the id alone: killing a tab takes its split panes
 * with it, and a warning that named only the tab's own pane would be silent
 * about the agent in the split beside it.
 */
export async function killTerminalGated(sessionId: string, deps: CloseGateDeps): Promise<boolean> {
  // A focused SPLIT is not a tab, and `tabRemoved` runs the webview's root-tab
  // teardown — which would destroy the session while leaving the split leaf and
  // its layout standing (round-2 F008). The pane protocol is the one that
  // re-renders the tree, and it is also the honest question: killing one leaf
  // does not touch its siblings, so only it is weighed.
  if (deps.isSplitPane(sessionId)) {
    return closePaneGated(sessionId, deps);
  }
  const panes = deps.panesOfTab(sessionId);
  const weighed = panes.length > 0 ? panes : [sessionId];
  if (!(await confirmKill(weighed, "terminal", deps.evidence, deps.ui))) {
    return false;
  }
  deps.destroySession(sessionId);
  deps.postTabRemoved(sessionId);
  return true;
}

/** Close one split pane, asking first when it is running an agent. */
export async function closePaneGated(sessionId: string, deps: CloseGateDeps): Promise<boolean> {
  if (!(await confirmKill([sessionId], "pane", deps.evidence, deps.ui))) {
    return false;
  }
  // By id, never "whichever pane is active now": the webview keeps its own
  // focus state, it can differ from the host's, and it can move while the
  // modal is open (round-1 F002).
  deps.postClosePane(sessionId);
  return true;
}

/**
 * How long to hold a disposed view's ptys, and what is at stake if nobody acts.
 *
 * The editor-tab door is the one door that cannot be gated: `onDidDispose` fires
 * after the tab is gone, and VS Code exposes no close veto to extensions —
 * verified against the vscode-dts of the source tree, where the only `onWill*`
 * hooks are about SAVING a document. So this door trades the question for an
 * undo: a view with a live agent gets a longer window and something to click,
 * instead of a silent kill after the ordinary reload grace.
 *
 * `running` empty means nothing is at stake and the ordinary grace stands —
 * lengthening it for every closed tab would leave ptys around for no reason.
 */
export function disposalGrace(
  sessionIds: readonly string[],
  evidence: KillEvidenceReader | null,
  ms: { idle: number; agents: number },
): { graceMs: number; running: RunningAgentPane[] } {
  const running = runningAgentPanes(sessionIds, evidence);
  return { graceMs: running.length === 0 ? ms.idle : ms.agents, running };
}
