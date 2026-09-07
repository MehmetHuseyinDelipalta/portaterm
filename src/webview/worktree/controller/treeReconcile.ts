// src/webview/worktree/controller/treeReconcile.ts — A tree arriving, and
// everything keyed against the tree it replaces.
//
// Extracted from `WorktreeController` by change `decompose-worktree-view`
// (design.md D1, task 3_6). Reconciliation runs BEFORE the new tree is stored,
// because the outgoing tree is the only place a departed row's label still
// exists — and the store, the reconcile and the push that follows them sat in
// three different parts of the class.
//
// The tree, the presence beside it and the two loading flags come here because
// this is what writes them: a binding belongs to its writer.

import type { WebViewToExtensionMessage, WorktreeTreeResponseMessage } from "../../../types/messages";
import type { WorktreeViewData } from "../WorktreeView";
import type { WorktreeActionResult, WorktreeInfo, WorktreePresence, WorktreeTree } from "../worktreeViewTypes";
import type { CreateFlow } from "./createFlow";
import type { createDialogChannels } from "./dialogChannels";

/** Enough to explain a burst of removals; never a session-long history (W6). */
const MAX_ORPHAN_NOTICES = 4;
const MAX_DEPARTED = 64;

/** Drop the oldest entries until `map` fits. Insertion order is age. */
function trim(map: Map<string, string>, limit: number): void {
  for (const key of map.keys()) {
    if (map.size <= limit) {
      return;
    }
    map.delete(key);
  }
}

/**
 * The repository holding `info`, from the tree this controller last rendered.
 *
 * `prunableCount` is the host's number, carried on the repo. Absent until the
 * host sends one, and a prune with no count is not offered at all — the
 * confirmation exists to name a number, so there is nothing to confirm.
 */
function repoFor(state: TreeState, info: WorktreeInfo): { repoId: string; prunableCount: number } | undefined {
  const repo = state.tree?.repos.find((r) => r.worktrees.some((w) => w.id === info.id));
  if (repo === undefined) {
    return undefined;
  }
  // Counted from the tree the panel is already rendering: git's own
  // `prunable` flag rides on every worktree, so this needs no protocol of its
  // own (design.md D14). The host re-counts authoritatively before it acts.
  return { repoId: repo.repoId, prunableCount: repo.worktrees.filter((w) => w.prunable).length };
}

/** Toolbar refresh: rebuild the listings rather than re-serve the cache. */
function requestRefresh(deps: TreeReconcileDeps, state: TreeState): void {
  // `bodyShown`, not the subscription: the toolbar this serves is in the body,
  // so a scope holding presence open is not a reason to accept one (D4).
  if (!deps.bodyShown() || state.refreshing) {
    return;
  }
  state.refreshing = true;
  deps.postMessage({ type: "requestWorktreeTree", force: true });
  push(deps, state);
}

function infoOf(state: TreeState, worktreeId: string): WorktreeInfo | undefined {
  return state.tree?.repos.flatMap((repo) => repo.worktrees).find((wt) => wt.id === worktreeId);
}

/** The registration token the tree currently publishes for this worktree. */
function generationOf(state: TreeState, worktreeId: string): number | undefined {
  return state.tree?.repos.find((repo) => repo.worktrees.some((wt) => wt.id === worktreeId))?.generation;
}

/** A reply and an unsolicited push are the same message, handled the same way. */
function handleTreeResponse(deps: TreeReconcileDeps, state: TreeState, msg: WorktreeTreeResponseMessage): void {
  reconcile(deps, state, msg.tree);
  state.tree = msg.tree;
  state.presence = msg.presence;
  deps.emitAttribution();
  state.loading = false;
  state.refreshing = false;
  deps.onCreateAvailability(msg.tree.repos.length > 0);
  push(deps, state);
}

/**
 * Bring the two collections keyed by tree identity back onto the tree that
 * has just arrived, BEFORE it replaces the one they were keyed against —
 * the outgoing tree is the only place a departed row's label still exists.
 *
 * Two distinct failures, one pass (round-3 B1, W6):
 * - a result whose worktree is gone renders nowhere, so a successful removal
 *   reported nothing at all. Re-scoped to its repo, it stays dismissable.
 * - both maps otherwise grow with every repository and worktree the surface
 *   has ever seen, and a recreation at the same id inherits the old notice.
 */
/** Drop every per-repository answer whose repository has left the workspace. */
function sweepDepartedRepos(deps: TreeReconcileDeps, repos: ReadonlySet<string>): void {
  for (const repoId of deps.createDefaults().keys()) {
    if (!repos.has(repoId)) {
      deps.createDefaults().delete(repoId);
    }
  }
  for (const repoId of deps.provisionOffers().keys()) {
    if (!repos.has(repoId)) {
      deps.provisionOffers().delete(repoId);
    }
  }
  for (const repoId of deps.createFlow().migrationOffers().keys()) {
    if (!repos.has(repoId)) {
      deps.createFlow().migrationOffers().delete(repoId);
      deps.dialogChannels().migration.push(repoId, undefined);
    }
  }
  for (const repoId of deps.repoRefs().keys()) {
    if (!repos.has(repoId)) {
      deps.repoRefs().delete(repoId);
    }
  }
}

/**
 * Drop the create's source row when the tree no longer holds it as a worktree
 * a snapshot could be moved off — which withdraws the migration offer with it.
 */
function sweepCreateSource(deps: TreeReconcileDeps, next: WorktreeTree): void {
  const source = deps.createFlow().createSource();
  if (
    source !== null &&
    !next.repos
      .find((repo) => repo.repoId === source.repoId)
      ?.worktrees.some((row) => row.id === source.worktreeId && !row.bare && !row.missing && !row.prunable)
  ) {
    deps.createFlow().clearCreateSource();
    deps.createFlow().migrationOffers().delete(source.repoId);
    deps.dialogChannels().migration.push(source.repoId, undefined);
  }
}

/**
 * A create waiting on a repository that has left is waiting for a message the
 * host has no way to send: it answers only while the repo is in its cache, and
 * there is no error reply. Unreconciled, one departure jams the create for
 * every repository it asked (round-1 W1).
 */
function reconcilePendingCreate(deps: TreeReconcileDeps, repos: ReadonlySet<string>): void {
  const pending = deps.createFlow().pendingCreate();
  if (pending === null) {
    return;
  }
  for (const repoId of pending.outstanding) {
    if (!repos.has(repoId)) {
      pending.outstanding.delete(repoId);
    }
  }
  if (pending.initialRepoId !== undefined && !repos.has(pending.initialRepoId)) {
    delete pending.initialRepoId;
  }
  if (pending.outstanding.size === 0) {
    deps.createFlow().openPendingCreate(pending);
  }
}

/**
 * Remember what left, so a result that arrives after this rebuild can name the
 * row it outlived. Dropped again the moment the id comes back.
 */
function noteDeparted(state: TreeState, labels: ReadonlyMap<string, string>, worktrees: ReadonlySet<string>): void {
  for (const [id, label] of labels) {
    if (!worktrees.has(id)) {
      state.departed.set(id, label);
    }
  }
  for (const id of state.departed.keys()) {
    if (worktrees.has(id)) {
      state.departed.delete(id);
    }
  }
  trim(state.departed, MAX_DEPARTED);
}

/** Re-scope every notice onto the arriving tree, and bound the orphans (W6). */
function rescopeNotices(deps: TreeReconcileDeps, repos: ReadonlySet<string>, worktrees: ReadonlySet<string>): void {
  deps.setActionResults(
    deps.actionResults().flatMap((r) => {
      if (r.repoId !== undefined && !repos.has(r.repoId)) {
        // The repository itself left the workspace. Nothing is left to report to.
        return [];
      }
      return [deps.rescope(r, worktrees)];
    }),
  );
  // W6: orphan notices answer to no row, so nothing else would ever bound them.
  const orphans = deps.actionResults().filter((r) => r.orphanedLabel !== undefined);
  if (orphans.length > MAX_ORPHAN_NOTICES) {
    const dropped = new Set(orphans.slice(0, orphans.length - MAX_ORPHAN_NOTICES));
    deps.setActionResults(deps.actionResults().filter((r) => !dropped.has(r)));
  }
}

function reconcile(deps: TreeReconcileDeps, state: TreeState, next: WorktreeTree): void {
  const repos = new Set(next.repos.map((r) => r.repoId));
  const worktrees = new Set(next.repos.flatMap((r) => r.worktrees.map((w) => w.id)));
  const labels = new Map(
    (state.tree?.repos ?? []).flatMap((r) => r.worktrees.map((w) => [w.id, w.displayPath] as const)),
  );

  sweepDepartedRepos(deps, repos);
  sweepCreateSource(deps, next);
  reconcilePendingCreate(deps, repos);
  noteDeparted(state, labels, worktrees);
  rescopeNotices(deps, repos, worktrees);
}

function push(deps: TreeReconcileDeps, state: TreeState): void {
  deps.setData({
    tree: state.tree,
    presence: state.presence,
    loading: state.loading,
    refreshing: state.refreshing,
    actionResults: deps.actionResults(),
    noFolder: deps.noFolder(),
  });
}
export interface TreeReconcileDeps {
  postMessage(msg: WebViewToExtensionMessage): void;
  setData(data: WorktreeViewData): void;
  /** Whether the panel asked for this body. Owned by `visibility`. */
  bodyShown(): boolean;
  /** Report where the panes are, off the presence this tree arrived with. */
  emitAttribution(): void;
  /** The three answer caches D5 pins to the controller (3_5). */
  createDefaults(): Map<string, unknown>;
  provisionOffers(): Map<string, unknown>;
  repoRefs(): Map<string, unknown>;
  dialogChannels(): ReturnType<typeof createDialogChannels>;
  /** The create opening, whose source and pending ask this reconciles. */
  createFlow(): CreateFlow;
  /** The notice list, which stays a controller field (D5). */
  actionResults(): WorktreeActionResult[];
  setActionResults(next: WorktreeActionResult[]): void;
  /** Re-scope a notice onto a tree that may no longer hold its row (3_4). */
  rescope(result: WorktreeActionResult, present?: ReadonlySet<string>): WorktreeActionResult;
  /** Whether the tree now holds a repository a create could act in. */
  onCreateAvailability(available: boolean): void;
  /** True while the workspace has no folder at all — the skeleton is a lie then. */
  noFolder(): boolean;
}

/** The tree this surface last rendered, and the two flags drawn beside it. */
interface TreeState {
  tree: WorktreeTree | null;
  presence: WorktreePresence | null;
  loading: boolean;
  refreshing: boolean;
  /**
   * Display paths of rows that have LEFT the tree, so a result arriving after
   * the rebuild that removed its row can still say what it was about.
   *
   * This exists because of the order production actually produces: the
   * coordinator awaits its rebuild in a `finally`, so the tree without the row
   * reaches the surface before the outcome does (round-4 B1).
   */
  departed: Map<string, string>;
}

export interface TreeReconcile {
  tree(): WorktreeTree | null;
  presence(): WorktreePresence | null;
  refreshing(): boolean;
  /** Abandon a force that crossed a visibility transition — it is never answered. */
  abandonRefresh(): void;
  /** Labels of rows that have left, for a notice that outlived its row. */
  departed(): Map<string, string>;
  /** The repository holding `info`, from the tree this controller last rendered. */
  repoFor(info: WorktreeInfo): { repoId: string; prunableCount: number } | undefined;
  infoOf(worktreeId: string): WorktreeInfo | undefined;
  /** The registration token the tree currently publishes for this worktree. */
  generationOf(worktreeId: string): number | undefined;
  /** Toolbar refresh: rebuild the listings rather than re-serve the cache. */
  requestRefresh(): void;
  /** A reply and an unsolicited push are the same message, handled the same way. */
  handleTreeResponse(msg: WorktreeTreeResponseMessage): void;
  /** Hand the view everything it draws from. */
  push(): void;
}

export function createTreeReconcile(deps: TreeReconcileDeps, initialLoading: boolean): TreeReconcile {
  const state: TreeState = {
    tree: null,
    presence: null,
    loading: initialLoading,
    refreshing: false,
    departed: new Map(),
  };

  return {
    tree: () => state.tree,
    presence: () => state.presence,
    refreshing: () => state.refreshing,
    abandonRefresh() {
      state.refreshing = false;
    },
    departed: () => state.departed,
    repoFor: (info) => repoFor(state, info),
    infoOf: (worktreeId) => infoOf(state, worktreeId),
    generationOf: (worktreeId) => generationOf(state, worktreeId),
    requestRefresh: () => {
      requestRefresh(deps, state);
    },
    handleTreeResponse: (msg) => {
      handleTreeResponse(deps, state, msg);
    },
    push: () => {
      push(deps, state);
    },
  };
}
