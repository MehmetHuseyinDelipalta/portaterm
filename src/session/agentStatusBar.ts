// src/session/agentStatusBar.ts — Sum up every agent in one status bar entry.
//
// The tab dots and the view badges show an agent where it lives; this is the
// one place that counts them all, for a window whose terminals are out of
// sight. It reads the same attention set the tabs draw, so the two never
// disagree. Clicking it goes to the pane that needs the user most. The text
// leads with the extension's name, so the counts read as Portaterm's and not
// as one more anonymous spinner beside the editor's own entries. With no agent
// to show it stays as the bare name, a way back to Portaterm itself.

import type { AgentAttentionState } from "../types/messages";
import type { AttentionPanes } from "./agentAttention";

/** The command a click on the entry runs while it counts agents. */
export const GO_TO_AGENT_COMMAND = "portaterm.goToAgent";
/** The command a click on the entry runs while no agent is counted. */
export const OPEN_COMMAND = "portaterm.open";

export interface AgentStatusSummary {
  text: string;
  tooltip: string;
  /** Some agent is blocked on the user. */
  urgent: boolean;
  /** What a click runs: Portaterm itself while no agent is counted, otherwise the pick of agents. */
  command: typeof GO_TO_AGENT_COMMAND | typeof OPEN_COMMAND;
}

const NAME = "Portaterm";

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

/** One row of the pick a click on the entry opens. */
export type AgentPickEntry<T extends AgentStatusTarget> =
  | { kind: "agent"; label: string; description: string; target: T }
  | { kind: "separator" }
  | { kind: "open"; label: string };

/** What a click on the entry does. */
export type GoToAgentPlan<T extends AgentStatusTarget> =
  | { kind: "open" }
  | { kind: "pick"; entries: AgentPickEntry<T>[] };

/**
 * With no agent counted a click opens Portaterm. Otherwise it is always a pick,
 * even for one agent, so the way to Portaterm itself is there while agents are
 * counted too: the agents most urgent first, then a row that opens Portaterm.
 */
export function planGoToAgent<T extends AgentStatusTarget>(
  targets: readonly T[],
  tabName: (paneId: string) => string | undefined,
): GoToAgentPlan<T> {
  if (targets.length === 0) {
    return { kind: "open" };
  }
  return {
    kind: "pick",
    entries: [
      ...targets.map((target) => ({
        kind: "agent" as const,
        label: tabName(target.paneId) ?? "Terminal",
        description: `${target.agent} · ${describeAttention(target.state)}`,
        target,
      })),
      { kind: "separator" },
      { kind: "open", label: `$(terminal) Open ${NAME}` },
    ],
  };
}

/** The status bar entry for an attention set; the bare name when no agent has anything to show. */
export function summarizeAttention(
  panes: AttentionPanes,
  tabName: (paneId: string) => string | undefined,
): AgentStatusSummary {
  const targets = attentionTargets(panes);
  if (targets.length === 0) {
    return { text: NAME, tooltip: `Open ${NAME}`, urgent: false, command: OPEN_COMMAND };
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
    text: `${NAME} — ${parts.join(" · ")}`,
    tooltip: `${lines.join("\n")}\n\nClick to pick an agent's tab or open ${NAME}.`,
    urgent: waiting > 0,
    command: GO_TO_AGENT_COMMAND,
  };
}

/** A pick row as the editor's quick pick takes it, carrying the entry it stands for. */
export interface AgentPickItem<T extends AgentStatusTarget> {
  label: string;
  description?: string;
  kind?: number;
  entry: AgentPickEntry<T>;
}

/** The entries as quick pick rows; `separatorKind` is the editor's separator kind, passed in to keep this module free of it. */
export function agentPickItems<T extends AgentStatusTarget>(
  entries: readonly AgentPickEntry<T>[],
  separatorKind: number,
): AgentPickItem<T>[] {
  return entries.map((entry) => {
    if (entry.kind === "agent") {
      return { label: entry.label, description: entry.description, entry };
    }
    if (entry.kind === "separator") {
      return { label: "", kind: separatorKind, entry };
    }
    return { label: entry.label, entry };
  });
}

export const AGENT_PICK_PLACEHOLDER = "Go to an agent's tab, or open Portaterm";

export interface GoToAgentDeps<T extends AgentStatusTarget> {
  /** The attention set the status bar entry counted. */
  panes: () => AttentionPanes;
  /** The view a pane lives in; `undefined` for a pane no view can reveal. */
  viewIdOf: (paneId: string) => string | undefined;
  tabName: (paneId: string) => string | undefined;
  /** Shows the entries and resolves to the one picked, `undefined` when the pick is dismissed. */
  pick: (
    entries: AgentPickEntry<T & { viewId: string }>[],
  ) => Promise<AgentPickEntry<T & { viewId: string }> | undefined>;
  focusPane: (paneId: string, viewId: string) => Promise<void>;
  /** Opens Portaterm itself. */
  open: () => Promise<void>;
}

/**
 * What a click on the entry does, end to end. A pane no view can reveal is left
 * out, since picking it could go nowhere; with nothing left, Portaterm opens.
 */
export async function goToAgent(deps: GoToAgentDeps<AgentStatusTarget>): Promise<void> {
  const targets = attentionTargets(deps.panes()).flatMap((target) => {
    const viewId = deps.viewIdOf(target.paneId);
    return viewId === undefined ? [] : [{ ...target, viewId }];
  });
  const plan = planGoToAgent(targets, deps.tabName);
  const picked = plan.kind === "open" ? plan : await deps.pick(plan.entries);
  if (picked?.kind === "agent") {
    await deps.focusPane(picked.target.paneId, picked.target.viewId);
  } else if (picked?.kind === "open") {
    await deps.open();
  }
}

/** The command that reveals and focuses a Portaterm view. */
export function focusViewCommand(viewId: string): string {
  return `${viewId}.focus`;
}
