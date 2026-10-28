// src/session/agentStatusBar.ts — Sum up every agent in one status bar entry.
//
// The tab dots and the view badges show an agent where it lives; this is the
// one place that counts them all, for a window whose terminals are out of
// sight. It reads the same attention set the tabs draw, so the two never
// disagree. Clicking it goes to the pane that needs the user most.

import type { AgentAttentionState } from "../types/messages";
import type { AttentionPanes } from "./agentAttention";

export interface AgentStatusSummary {
  text: string;
  tooltip: string;
  /** Some agent is blocked on the user. */
  urgent: boolean;
}

export interface AgentStatusTarget {
  paneId: string;
  state: AgentAttentionState;
  agent: string;
}

/** Most urgent first: a blocked agent, then an unseen finished turn, then one at work. */
const RANK: Record<AgentAttentionState, number> = { approval: 0, question: 0, unseen: 1, working: 2 };

const DESCRIBE: Record<AgentAttentionState, string> = {
  approval: "waiting for your approval",
  question: "waiting for your answer",
  unseen: "finished",
  working: "working",
};

export function describeAttention(state: AgentAttentionState): string {
  return DESCRIBE[state];
}

/** The panes to go to, most urgent first; ties keep the order the set lists them in. */
export function attentionTargets(panes: AttentionPanes): AgentStatusTarget[] {
  return Object.entries(panes)
    .map(([paneId, { state, agent }]) => ({ paneId, state, agent }))
    .sort((a, b) => RANK[a.state] - RANK[b.state]);
}

/** The status bar entry for an attention set; `undefined` when no agent has anything to show. */
export function summarizeAttention(
  panes: AttentionPanes,
  tabName: (paneId: string) => string | undefined,
): AgentStatusSummary | undefined {
  const targets = attentionTargets(panes);
  if (targets.length === 0) {
    return undefined;
  }
  const count = (states: readonly AgentAttentionState[]) => targets.filter((t) => states.includes(t.state)).length;
  const working = count(["working"]);
  const waiting = count(["approval", "question"]);
  const done = count(["unseen"]);
  const parts: string[] = [];
  if (working > 0) {
    parts.push(`$(sync~spin) ${working} working`);
  }
  if (waiting > 0) {
    parts.push(`$(bell-dot) ${waiting} waiting`);
  }
  if (done > 0) {
    parts.push(`$(check) ${done} done`);
  }
  const lines = targets.map((t) => `${tabName(t.paneId) ?? "Terminal"}: ${t.agent} is ${describeAttention(t.state)}`);
  return {
    text: parts.join(" · "),
    tooltip: `${lines.join("\n")}\n\nClick to go to ${targets.length === 1 ? "its tab" : "an agent's tab"}.`,
    urgent: waiting > 0,
  };
}
