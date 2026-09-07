// src/webview/worktree/controller/agentActions.ts — Launching an agent in a
// worktree, resuming one that is already there, and telling the tab bar which
// worktree each of this window's panes is in.
//
// Extracted from `WorktreeController` by change `decompose-worktree-view`
// (design.md D1, task 3_3). Three of the four frozen records live here — the
// launch offer, the launch target, and the menu row — because freezing is the
// same rule each time: what a dialog or a menu was BUILT against is the only
// thing it may act on, and re-reading the live tree at click time is what
// round-4 B1 and round-7 B5 both are.
//
// `launchOfferFor` and `handleLaunchTargets` stay on the class as facade
// methods — `main.ts`, `VaultPanel` and three suites call them through the
// instance (D5).

import type { VaultLaunchTargetsMessage, WebViewToExtensionMessage } from "../../../types/messages";
import { attributionKey, type PaneReport, waitingKey } from "../../paneAttribution";
import type { WorktreeMenuActions } from "../WorktreeContextMenu";
import type {
  WorktreeAgentRow,
  WorktreeInfo,
  WorktreeLaunchAgent,
  WorktreePresence,
  WorktreeRowActivation,
} from "../worktreeViewTypes";

/** What the launch dialog was RENDERED against, frozen when it opened. */
export interface FrozenLaunch {
  worktreeId: string;
  offerId?: string;
  generation?: number;
}

export interface AgentActionsDeps {
  postMessage(msg: WebViewToExtensionMessage): void;
  /** Report where the panes are. Absent on the controller's deps → a no-op. */
  onAttribution(report: PaneReport): void;
  /** The envelope attribution is read off. Owned by `treeReconcile`. */
  presence(): WorktreePresence | null;
  /** The worktree this id names in the tree now, and its registration token. */
  infoOf(worktreeId: string): WorktreeInfo | undefined;
  generationOf(worktreeId: string): number | undefined;
  openLaunchDialog(title: string, agents: WorktreeLaunchAgent[]): void;
  /**
   * The menu record whose two launch items this syncs. Read at call time: it is
   * one object the controller mutates in place, never replaced.
   */
  menuActions(): WorktreeMenuActions;
  push(): void;
}

/**
 * Everything one window's launch, resume and attribution state amounts to.
 *
 * A record rather than closure variables so every routine below can sit at
 * module scope — the shape `asm refactor shape` asks for, and the reason this
 * file has no long body in it.
 */
interface AgentState {
  /**
   * Agents the host said can start a fresh session. Empty until it answers, and
   * empty is meaningful: no launch item is offered, rather than one that opens a
   * picker with nothing in it.
   */
  launchAgents: WorktreeLaunchAgent[];
  /** True between asking which agents can start a session and being told. */
  awaitingLaunchTargets: boolean;
  /** Which answer `launchAgents` came from. Never read at submit — see `frozen`. */
  launchOfferId: string | undefined;
  /**
   * What the open dialog was RENDERED against, frozen when it opened.
   *
   * A dialog shows one offer and one worktree, and the user answers it minutes
   * later. Reading the panel's current offer at submit — which is what this
   * used to do — lets an answer that arrived under the open dialog relabel that
   * old choice as a choice made from the new list (round-4 B1). Frozen here,
   * a superseded choice is refused by the host instead of admitted.
   */
  frozenLaunch: FrozenLaunch | null;
  /**
   * What the open agent menu was BUILT against, by row.
   *
   * Not read from the tree when the item is clicked: a generation-only update
   * replaces the tree without repainting — that is D10's deliberate choice —
   * so at click time the tree and the menu on screen disagree, and the tree is
   * the wrong one of the two to believe (round-7 B5).
   */
  frozenMenuTarget: { rowId: string; worktreeId: string; generation?: number } | null;
  /** The last attribution reported, keyed for comparison. `null` → none yet. */
  lastAttribution: string | null;
}

/**
 * Open the launch dialog for one worktree.
 *
 * The worktree is remembered rather than threaded through the dialog: the
 * dialog collects WHAT to launch, and the panel already knows WHERE, so a
 * mismatch between the two is not representable.
 */
function openLaunchFor(deps: AgentActionsDeps, state: AgentState, info: WorktreeInfo): void {
  // Captured together with the list the dialog is about to render: the offer,
  // the worktree, and the registration of that worktree are one answer to one
  // question, and reading any of them again later would be reading a
  // different question's answer (design.md D10).
  state.frozenLaunch = {
    worktreeId: info.id,
    ...(state.launchOfferId === undefined ? {} : { offerId: state.launchOfferId }),
    ...(deps.generationOf(info.id) === undefined ? {} : { generation: deps.generationOf(info.id) }),
  };
  deps.openLaunchDialog(info.branch ?? info.displayPath, state.launchAgents);
}

/**
 * The launch offer for one worktree, or `undefined` when there is none to make.
 *
 * Gate and action are one value on purpose: a caller that has to ask whether
 * launching is possible before offering it can render the offer inert, which is
 * the one thing `syncLaunchActions` already refuses to do (design.md D4).
 */
function launchOfferFor(deps: AgentActionsDeps, state: AgentState, worktreeId: string): (() => void) | undefined {
  if (state.launchAgents.length === 0 || deps.infoOf(worktreeId) === undefined) {
    return undefined;
  }
  // Re-resolved when the offer is TAKEN, not when the region was built: the
  // region outlives several tree pushes, and the dialog would otherwise be
  // titled with a branch the worktree has since been renamed off
  // (round-1 suggestion).
  return () => {
    const info = deps.infoOf(worktreeId);
    if (info !== undefined) {
      openLaunchFor(deps, state, info);
    }
  };
}

/** Capture what an agent row's menu is being built against. */
function captureMenuTarget(deps: AgentActionsDeps, state: AgentState, row: WorktreeAgentRow): void {
  const worktreeId = worktreeIdOf(deps, row);
  state.frozenMenuTarget =
    worktreeId === undefined
      ? null
      : {
          rowId: row.rowId,
          worktreeId,
          ...(deps.generationOf(worktreeId) === undefined ? {} : { generation: deps.generationOf(worktreeId) }),
        };
}

/** Resume a row's session in the worktree that row is published under. */
function resumeHere(deps: AgentActionsDeps, state: AgentState, row: WorktreeAgentRow): void {
  const frozen = state.frozenMenuTarget;
  // The menu this item belongs to must be the one that was captured. A row
  // that never went through a menu open, or one from an earlier menu, has no
  // authority here — refusing is the safe direction, and the item cannot be
  // reached any other way.
  if (row.entryId === undefined || frozen === null || frozen.rowId !== row.rowId) {
    return;
  }
  deps.postMessage({
    type: "worktreeResumeHere",
    worktreeId: frozen.worktreeId,
    rowId: row.rowId,
    entryId: row.entryId,
    ...(frozen.generation === undefined ? {} : { generation: frozen.generation }),
  });
  state.frozenMenuTarget = null;
}

/**
 * Which worktree each of this window's panes is running in, read off the
 * envelope that already carries presence — the only attribution path there is
 * (design.md D2). An absent key means "not placed", which is why no sentinel
 * value exists for it: a third value would invite a fourth outcome.
 *
 * A pane published under more than one worktree is OMITTED, not resolved by
 * last-write-wins. Two answers to a question the evidence did not settle is not
 * proof, and the consumer hides only what it can prove belongs elsewhere.
 */
/**
 * Where presence puts each pane, and which panes it says are waiting — from ONE
 * walk, reported together (design.md D1). The two halves answer different
 * questions and neither gates the other: a contested pane is dropped from the
 * placement but keeps whatever it said about waiting, because "we cannot say
 * which worktree this is in" is not a claim about whether it needs a human.
 */
function buildAttribution(deps: AgentActionsDeps): PaneReport {
  const map = new Map<string, string>();
  const waiting = new Set<string>();
  const contested = new Set<string>();
  for (const [worktreeId, rows] of Object.entries(deps.presence()?.rowsByWorktreeId ?? {})) {
    // External rows name agents this window does not host — they carry no pane
    // of ours and so say nothing about where any of our tabs belongs. Dropped
    // in one pass rather than tested twice inside the loop below.
    for (const row of rows.filter((r) => r.scope === "window")) {
      if (row.paneId === undefined) {
        continue;
      }
      if (row.activity === "waiting") {
        waiting.add(row.paneId);
      }
      const held = map.get(row.paneId);
      if (held !== undefined && held !== worktreeId) {
        contested.add(row.paneId);
      }
      map.set(row.paneId, worktreeId);
    }
  }
  for (const paneId of contested) {
    map.delete(paneId);
  }
  return { placement: map, waiting };
}

/**
 * Report attribution, but only where it moved. A presence scan lands on its own
 * cadence and most of them carry the same placement — reporting each one would
 * make every scan a reason to redraw the tab bar.
 */
function emitAttribution(deps: AgentActionsDeps, state: AgentState): void {
  const next = buildAttribution(deps);
  // The SAME canonicalisers the render signature uses. Both suppress a duplicate
  // on the same question and were byte-identical copies of this encoding, which
  // is one edit away from disagreeing about it (round-1 W3). BOTH halves are in
  // the key: either moving is a report, and neither moving is silence.
  const key = `${attributionKey(next.placement)}\u0002${waitingKey(next.waiting)}`;
  if (key === state.lastAttribution) {
    return;
  }
  state.lastAttribution = key;
  deps.onAttribution(next);
}

/** Which worktree the presence envelope published this row under. */
function worktreeIdOf(deps: AgentActionsDeps, row: WorktreeAgentRow): string | undefined {
  for (const [worktreeId, rows] of Object.entries(deps.presence()?.rowsByWorktreeId ?? {})) {
    if (rows.some((r) => r.rowId === row.rowId)) {
      return worktreeId;
    }
  }
  return undefined;
}

/** The host's answer to "which agents can start a fresh session here". */
function handleLaunchTargets(deps: AgentActionsDeps, state: AgentState, msg: VaultLaunchTargetsMessage): void {
  // Only the start answer is ours: the continuation dialog asks the same
  // question with the other capability and gets a different set back.
  if (msg.capability !== "start") {
    return;
  }
  state.awaitingLaunchTargets = false;
  // Kept with the list it came with: the host admits a launch only against the
  // answer this panel actually received, and quoting it is the proof.
  state.launchOfferId = msg.offerId;
  state.launchAgents = msg.targets.map((t) => ({
    id: t.agent,
    label: t.displayName,
    permissionChoices: t.permissionChoices,
    canSeedPrompt: t.canSeedPrompt,
  }));
  syncLaunchActions(deps, state);
  deps.push();
}

/**
 * Both launch items ride on the same host capability, so the host's own answer
 * gates them together: no agent can start a session here means neither item is
 * offered, rather than offered and refused.
 */
function syncLaunchActions(deps: AgentActionsDeps, state: AgentState): void {
  // The MENU needs no nudge — `openForWorktree` rebuilds its items at click
  // time from this same record. The row's launch control does: it is built at
  // paint, behind a guard `menuActions` is not an input to. That capability is
  // in the view's render key for exactly this reason, so mutating the record
  // here and pushing is enough to move it (.reviews/round-1.md B3).
  if (state.launchAgents.length === 0) {
    delete deps.menuActions().launchAgentHere;
    delete deps.menuActions().resumeHere;
    return;
  }
  deps.menuActions().launchAgentHere = (info) => openLaunchFor(deps, state, info);
  deps.menuActions().resumeHere = (row) => resumeHere(deps, state, row);
}

/** The reply is the next envelope, carrying the roster on the row itself. */
function requestRoster(deps: AgentActionsDeps, row: WorktreeAgentRow): void {
  if (row.entryId !== undefined) {
    deps.postMessage({ type: "requestWorktreeSubagents", rowId: row.rowId, entryId: row.entryId });
  }
}

/** Ids only — the host resolves them against its own tree and presence (D2). */
function activateAgent(deps: AgentActionsDeps, row: WorktreeAgentRow, activation: WorktreeRowActivation): void {
  if (activation === "focus") {
    if (row.paneId !== undefined) {
      deps.postMessage({ type: "worktreeFocusPane", rowId: row.rowId, paneId: row.paneId });
    }
    return;
  }
  if (row.entryId !== undefined) {
    deps.postMessage({ type: "worktreeOpenPreview", rowId: row.rowId, entryId: row.entryId });
  }
}

function activateSubagentParent(deps: AgentActionsDeps, parent: WorktreeAgentRow): void {
  if (parent.paneId !== undefined) {
    deps.postMessage({ type: "worktreeFocusPane", rowId: parent.rowId, paneId: parent.paneId });
  }
}

export interface AgentActions {
  /** Agents the host said can start a fresh session here. */
  launchAgents(): WorktreeLaunchAgent[];
  /** Which answer that list came from, quoted back when a create is submitted. */
  launchOfferId(): string | undefined;
  awaitingLaunchTargets(): boolean;
  noteAwaitingLaunchTargets(): void;
  /** What the open launch dialog was rendered against, and dropping it. */
  frozenLaunch(): FrozenLaunch | null;
  clearFrozenLaunch(): void;
  openLaunchFor(info: WorktreeInfo): void;
  launchOfferFor(worktreeId: string): (() => void) | undefined;
  captureMenuTarget(row: WorktreeAgentRow): void;
  resumeHere(row: WorktreeAgentRow): void;
  emitAttribution(): void;
  handleLaunchTargets(msg: VaultLaunchTargetsMessage): void;
  requestRoster(row: WorktreeAgentRow): void;
  activateAgent(row: WorktreeAgentRow, activation: WorktreeRowActivation): void;
  activateSubagentParent(parent: WorktreeAgentRow): void;
}

export function createAgentActions(deps: AgentActionsDeps): AgentActions {
  const state: AgentState = {
    launchAgents: [],
    awaitingLaunchTargets: false,
    launchOfferId: undefined,
    frozenLaunch: null,
    frozenMenuTarget: null,
    lastAttribution: null,
  };

  return {
    launchAgents: () => state.launchAgents,
    launchOfferId: () => state.launchOfferId,
    awaitingLaunchTargets: () => state.awaitingLaunchTargets,
    noteAwaitingLaunchTargets() {
      state.awaitingLaunchTargets = true;
    },
    frozenLaunch: () => state.frozenLaunch,
    clearFrozenLaunch() {
      state.frozenLaunch = null;
    },
    openLaunchFor: (info) => {
      openLaunchFor(deps, state, info);
    },
    launchOfferFor: (worktreeId) => launchOfferFor(deps, state, worktreeId),
    captureMenuTarget: (row) => {
      captureMenuTarget(deps, state, row);
    },
    resumeHere: (row) => {
      resumeHere(deps, state, row);
    },
    emitAttribution: () => {
      emitAttribution(deps, state);
    },
    handleLaunchTargets: (msg) => {
      handleLaunchTargets(deps, state, msg);
    },
    requestRoster: (row) => {
      requestRoster(deps, row);
    },
    activateAgent: (row, activation) => {
      activateAgent(deps, row, activation);
    },
    activateSubagentParent: (parent) => {
      activateSubagentParent(deps, parent);
    },
  };
}
