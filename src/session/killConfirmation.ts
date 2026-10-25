// src/session/killConfirmation.ts — The question asked before a close that
// would kill a running agent.
//
// Closing a tab or a split pane destroys its pty. For a shell sitting at a
// prompt that costs nothing and a confirmation would only be in the way, so
// there is none. For an agent mid-session it costs the session: the process is
// killed, and whatever it had not written to disk goes with it. That is the
// only case this module speaks up for.
//
// "Mid-session" means mid-TURN. An agent that finished its turn and sits at its
// own prompt has already written its conversation out — closing it loses
// nothing a resume cannot bring back — so a live process alone is not enough:
// the pane must also be working or blocked on the user.
//
// The rule reads `PaneEvidenceStore`, which is the host's pane registry and
// outlives `SessionManager`'s own maps (a naturally-exited pane still has a
// row there while its tab is on screen). `exited` panes are excluded for
// exactly that reason: there is no process left to kill.
//
// The UI seam is a parameter rather than an import so the rule is testable
// without the `vscode` module — the same shape `exportCommands.ts` uses.

import type { AgentTurnReport } from "../agentHooks/AgentHookRuntime";
import type { PaneActivity } from "../shared/paneEvidence";

/** What `PaneEvidenceStore` exposes that this rule needs. `undefined` = no such pane. */
export interface KillEvidenceReader {
  read(
    paneId: string,
  ):
    | { exited: boolean; isAgentLaunch?: boolean; shell?: string; turn?: { report: { state: AgentTurnState } } }
    | undefined;
  activityFor(paneId: string): PaneActivity | undefined;
}

type AgentTurnState = AgentTurnReport["state"];

/** One pane that would lose a live agent. `name` is its root executable. */
export interface RunningAgentPane {
  sessionId: string;
  name: string;
}

/** The `vscode.window` surface used to ask. Injected so the rule stays testable. */
export interface KillConfirmationUi {
  showWarningMessage(
    message: string,
    options: { modal: boolean; detail?: string },
    ...items: string[]
  ): Thenable<string | undefined>;
}

/** What the gesture is about to close — decides the wording and the button. */
export type KillTarget = "tab" | "pane" | "terminal";

const WORDING: Record<KillTarget, { question: string; confirm: string }> = {
  tab: { question: "Close this terminal tab?", confirm: "Close Tab" },
  pane: { question: "Close this terminal pane?", confirm: "Close Pane" },
  terminal: { question: "Kill this terminal?", confirm: "Kill Terminal" },
};

/**
 * Which of `sessionIds` is running an agent that is mid-turn right now.
 *
 * `isAgentLaunch` is the host's own fact — it is written when the pty is
 * spawned and cleared when a fallback shell replaces the process — so this asks
 * about the process, not about anything a surface reported seeing. Duplicate
 * ids collapse: a caller assembling a tab's panes may well name the tab's own
 * session twice.
 */
export function runningAgentPanes(
  sessionIds: readonly string[],
  evidence: KillEvidenceReader | null,
): RunningAgentPane[] {
  if (!evidence) {
    return [];
  }
  const seen = new Set<string>();
  const found: RunningAgentPane[] = [];
  for (const sessionId of sessionIds) {
    if (seen.has(sessionId)) {
      continue;
    }
    seen.add(sessionId);
    const pane = evidence.read(sessionId);
    if (!pane || pane.exited || pane.isAgentLaunch !== true || !midTurn(sessionId, pane.turn, evidence)) {
      continue;
    }
    found.push({ sessionId, name: pane.shell ?? "An agent" });
  }
  return found;
}

/**
 * Whether the agent is in the middle of something closing would cut off.
 *
 * Either source is enough. The agent's own turn report is the authority when
 * it has made one, and it is read regardless of age: hooks fire on events, so
 * a long tool call leaves a `working` report standing that is still true. The
 * inferred activity covers the agent with no hooks at all, and the moment
 * between a prompt being typed and its first hook landing.
 */
function midTurn(
  sessionId: string,
  turn: { report: { state: AgentTurnState } } | undefined,
  evidence: KillEvidenceReader,
): boolean {
  if (turn !== undefined && turn.report.state !== "done") {
    return true;
  }
  const activity = evidence.activityFor(sessionId);
  return activity === "running" || activity === "waiting";
}

/**
 * Ask, but only when there is something to ask about.
 *
 * Resolves `true` when the close may proceed — which includes the common case
 * of no running agent, where nothing is shown at all. A dismissed dialog is a
 * `false`, so closing the modal with Escape cancels the close rather than
 * falling through to it.
 */
export async function confirmKill(
  sessionIds: readonly string[],
  target: KillTarget,
  evidence: KillEvidenceReader | null,
  ui: KillConfirmationUi,
): Promise<boolean> {
  const running = runningAgentPanes(sessionIds, evidence);
  if (running.length === 0) {
    return true;
  }
  const { question, confirm } = WORDING[target];
  const choice = await ui.showWarningMessage(question, { modal: true, detail: killDetail(running) }, confirm);
  return choice === confirm;
}

/** Names what is lost, and names the agents, because "an agent" is not enough to decide. */
function killDetail(running: readonly RunningAgentPane[]): string {
  const names = running.map((p) => p.name).join(", ");
  const subject =
    running.length === 1
      ? `${names} is still running here`
      : `${running.length} agents are still running here (${names})`;
  return `${subject}. Closing kills the process, and anything it has not written to disk is lost.`;
}
