// src/session/agentAttention.ts — Show the user which agents need them.
//
// Reads the same pane evidence the tab and the worktree rows read, and turns it
// into the quiet signals the tab bar and the vault draw: a pane waiting on an
// approval or an answer, an agent at work, and a turn that finished while nobody
// was looking — which stays marked until its tab is seen. Each terminal view also carries a badge counting its
// waiting panes, for when the view itself is out of sight. A notification is
// opt-in on top of that, for a pane the user cannot see.

import type { AgentAttentionMessage, AgentAttentionState } from "../types/messages";
import { type PaneEvidence, TURN_FRESHNESS_MS } from "./PaneEvidenceStore";

/** Where a pane's agent stands, as far as the user is concerned. */
export type AttentionPhase = "approval" | "question" | "working" | "done" | "none";

export type AttentionAgent = "Claude" | "Cursor Agent";

export interface AttentionSettings {
  /** Raise a notification, not only the tab and badge marks. */
  enabled: boolean;
  /** Also notify when an agent finishes its turn, not only when it is blocked. */
  onTurnEnd: boolean;
}

export type AttentionPanes = AgentAttentionMessage["panes"];

export interface AgentAttentionDeps {
  readPane(paneId: string): PaneEvidence | undefined;
  panes(): readonly (PaneEvidence & { paneId: string })[];
  /** The tab label the user knows the pane by. */
  tabName(paneId: string): string | undefined;
  /** True when the pane is on screen right now: window focused, view shown, its tab active. */
  isPaneVisible(paneId: string): boolean;
  readSettings(): AttentionSettings;
  /** Show a notification; resolves with the action the user picked, if any. */
  notify(message: string, action: string): Thenable<string | undefined>;
  focusPane(paneId: string, viewId: string): Promise<void> | void;
  /** Badge for a terminal view (sidebar or bottom panel): the tab name of each waiting pane. */
  setBadge(viewId: string, waiting: readonly string[]): void;
  /**
   * A waiting pane its view holds no tab for, left out of the badge. Reported
   * once per pane, so the pane that would have been counted can be found.
   */
  reportUnreachable?(paneId: string, viewId: string): void;
  /** The view ids that can carry a badge. */
  badgeViews: readonly string[];
  /** Deliver the full attention set to every surface; called only when it changed. */
  publish(panes: AttentionPanes): void;
  now?: () => number;
}

export const GO_TO_TAB = "Go to Tab";

/**
 * Classify one pane.
 *
 * Screen-detected waiting (Cursor's approval dialog) outranks everything, as it
 * does for the tab. A Claude wait holds until something answers it — a newer
 * report, or the user typing into the pane (`answered`) — because nothing else
 * reports the end of a wait, and a mark that lapsed after a minute would vanish
 * from exactly the tab the user walked away from. Any other turn decides only
 * while it is fresh, the same authority window the presence projection uses, and
 * Cursor's semantic word is the fallback for panes without one.
 */
export function attentionPhaseOf(
  evidence: PaneEvidence,
  now: number,
  answered = false,
): { phase: AttentionPhase; agent?: AttentionAgent } {
  if (evidence.exited) {
    return { phase: "none" };
  }
  if (evidence.waiting === true) {
    return { phase: "approval", agent: "Cursor Agent" };
  }
  const turn = evidence.turn;
  if (turn?.report.state === "waiting" && !answered) {
    const asking = turn.report.interactivePrompt?.startsWith('{"questions"') === true;
    return { phase: asking ? "question" : "approval", agent: "Claude" };
  }
  if (turn !== undefined && now - turn.receivedAt < TURN_FRESHNESS_MS) {
    const report = turn.report;
    if (report.state === "working" || report.state === "waiting") {
      return { phase: "working", agent: "Claude" };
    }
    // A session boundary is not a turn that ended, and an interrupt was the
    // user's own doing — neither is news to them.
    return report.sessionBoundary === true || report.interrupted === true
      ? { phase: "none" }
      : { phase: "done", agent: "Claude" };
  }
  if (evidence.semantic === "working") {
    return { phase: "working", agent: "Cursor Agent" };
  }
  if (evidence.semantic === "idle") {
    return { phase: "done", agent: "Cursor Agent" };
  }
  return { phase: "none" };
}

function isBlocked(phase: AttentionPhase): phase is "approval" | "question" {
  return phase === "approval" || phase === "question";
}

export interface AgentAttention {
  /** Feed a pane-evidence change. */
  update(paneId: string): void;
  /** The user typed into a pane, which answers whatever wait it was holding. */
  paneInput(paneId: string): void;
  /** What is on screen changed; a finished turn the user can now see is no longer unseen. */
  displayChanged(): void;
  /** The current attention set, for a surface that just loaded. */
  snapshot(): AttentionPanes;
  /** Recount every badge. */
  refreshBadges(): void;
  /** The panes a view holds tabs for; `undefined` when its webview is gone and no longer says. */
  panesPresented(viewId: string, paneIds: ReadonlySet<string> | undefined): void;
}

export function createAgentAttention(deps: AgentAttentionDeps): AgentAttention {
  const now = deps.now ?? Date.now;
  const lastPhase = new Map<string, AttentionPhase>();
  /**
   * Panes whose agent has started a turn that has not yet been announced as
   * finished. Kept apart from `lastPhase` because a turn can outlast the
   * freshness window of the report that opened it: a long tool run reads
   * `none` in the middle, and the `done` after it is still news.
   */
  const turnOpen = new Set<string>();
  /** Finished turns the user has not seen, with the agent that finished. */
  const unseen = new Map<string, AttentionAgent>();
  /** The `receivedAt` of the waiting report the user answered by typing, per pane. */
  const answered = new Map<string, number>();
  const badges = new Map<string, string>();
  /**
   * What each view's webview last said it holds tabs for. A view with no entry
   * has not said, and every pane in it counts.
   */
  const presented = new Map<string, ReadonlySet<string>>();
  /** Waiting panes already reported as unreachable, so each is reported once. */
  const unreachable = new Set<string>();
  let published = "{}";

  function phaseOf(paneId: string, evidence: PaneEvidence, stamp: number) {
    const waitingSince = evidence.turn?.report.state === "waiting" ? evidence.turn.receivedAt : undefined;
    return attentionPhaseOf(evidence, stamp, waitingSince !== undefined && answered.get(paneId) === waitingSince);
  }

  function snapshot(): AttentionPanes {
    const stamp = now();
    const panes: AttentionPanes = {};
    for (const pane of deps.panes()) {
      const { phase, agent } = phaseOf(pane.paneId, pane, stamp);
      const state: AgentAttentionState | undefined = isBlocked(phase)
        ? phase
        : unseen.has(pane.paneId)
          ? "unseen"
          : phase === "working"
            ? "working"
            : undefined;
      const by = state === "unseen" ? unseen.get(pane.paneId) : agent;
      if (state !== undefined && by !== undefined) {
        panes[pane.paneId] = { state, agent: by };
      }
    }
    return panes;
  }

  function refresh(): void {
    const panes = snapshot();
    const signature = JSON.stringify(panes);
    if (signature !== published) {
      published = signature;
      deps.publish(panes);
    }
    refreshBadges(panes);
  }

  function refreshBadges(panes: AttentionPanes = snapshot()): void {
    const waiting = new Map<string, string[]>(deps.badgeViews.map((viewId) => [viewId, []]));
    for (const pane of deps.panes()) {
      const state = panes[pane.paneId]?.state;
      const names = pane.viewId === undefined ? undefined : waiting.get(pane.viewId);
      if (names === undefined || pane.viewId === undefined || (state !== "approval" && state !== "question")) {
        continue;
      }
      // A pane that outlived its tab is one the user cannot reach, so a badge
      // counting it points nowhere.
      const tabs = presented.get(pane.viewId);
      if (tabs !== undefined && !tabs.has(pane.paneId)) {
        if (!unreachable.has(pane.paneId)) {
          unreachable.add(pane.paneId);
          deps.reportUnreachable?.(pane.paneId, pane.viewId);
        }
        continue;
      }
      unreachable.delete(pane.paneId);
      names.push(deps.tabName(pane.paneId) ?? "Terminal");
    }
    for (const [viewId, names] of waiting) {
      const signature = names.join("\n");
      if (badges.get(viewId) !== signature) {
        badges.set(viewId, signature);
        deps.setBadge(viewId, names);
      }
    }
  }

  function panesPresented(viewId: string, paneIds: ReadonlySet<string> | undefined): void {
    if (paneIds === undefined) {
      presented.delete(viewId);
    } else {
      presented.set(viewId, paneIds);
    }
    refreshBadges();
  }

  function announce(paneId: string, viewId: string | undefined, message: string): void {
    void Promise.resolve(deps.notify(message, GO_TO_TAB)).then((picked) => {
      if (picked === GO_TO_TAB && viewId !== undefined) {
        return deps.focusPane(paneId, viewId);
      }
      return undefined;
    });
  }

  function forget(paneId: string): void {
    lastPhase.delete(paneId);
    turnOpen.delete(paneId);
    unseen.delete(paneId);
    answered.delete(paneId);
    unreachable.delete(paneId);
  }

  function update(paneId: string): void {
    const evidence = deps.readPane(paneId);
    if (evidence === undefined || evidence.exited) {
      forget(paneId);
      refresh();
      return;
    }

    const { phase, agent } = phaseOf(paneId, evidence, now());
    const previous = lastPhase.get(paneId) ?? "none";
    lastPhase.set(paneId, phase);

    // A blocked pane is mid-turn by definition, so its end is still worth
    // announcing once it is answered. A new turn supersedes an unseen one.
    const wasOpen = turnOpen.has(paneId);
    if (phase === "working" || isBlocked(phase)) {
      turnOpen.add(paneId);
      unseen.delete(paneId);
    } else if (phase === "done") {
      turnOpen.delete(paneId);
    }
    const visible = deps.isPaneVisible(paneId);
    const finished = phase === "done" && phase !== previous && wasOpen && agent !== undefined;
    if (finished && !visible) {
      unseen.set(paneId, agent);
    }

    refresh();

    if (phase === previous) {
      return;
    }
    const settings = deps.readSettings();
    if (!settings.enabled || agent === undefined || visible) {
      return;
    }
    const name = deps.tabName(paneId) ?? "Terminal";
    if (phase === "approval") {
      announce(paneId, evidence.viewId, `${name}: ${agent} is waiting for your approval`);
    } else if (phase === "question") {
      announce(paneId, evidence.viewId, `${name}: ${agent} is waiting for your answer`);
    } else if (finished && settings.onTurnEnd) {
      announce(paneId, evidence.viewId, `${name}: ${agent} finished and is waiting for you`);
    }
  }

  function paneInput(paneId: string): void {
    const turn = deps.readPane(paneId)?.turn;
    if (turn?.report.state !== "waiting" || answered.get(paneId) === turn.receivedAt) {
      return;
    }
    answered.set(paneId, turn.receivedAt);
    update(paneId);
  }

  function displayChanged(): void {
    let changed = false;
    for (const paneId of unseen.keys()) {
      if (deps.isPaneVisible(paneId)) {
        unseen.delete(paneId);
        changed = true;
      }
    }
    if (changed) {
      refresh();
    }
  }

  return { update, paneInput, displayChanged, snapshot, refreshBadges: () => refreshBadges(), panesPresented };
}
