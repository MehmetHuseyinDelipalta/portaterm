// src/webview/worktree/worktreeView/foldState.ts — Which repos, worktrees and
// idle tails are folded, and nothing else.
//
// Extracted from `WorktreeView` by change `decompose-worktree-webview`
// (design.md D1, task 1_1). The class held six sets and seven methods over them
// while also owning render, the dialogs and a timer; this is the half that
// answers "is it open" and remembers the answer across a tree arriving.
//
// `pruneStaleState` did NOT come with them. It also clears the selection, calls
// `onSelectWorktree` and reconciles `RosterRequests`, none of which is fold
// state — the facade keeps it and calls `prune` below for its half.
//
// `uncapped` did not come either: no method here touches it, and the render path
// reads it directly.

/**
 * Namespaced so it can never collide with a repoId or a worktree id, both of which
 * share the same collapse set and are matched against the live tree.
 */
export function idleTailKey(repoId: string): string {
  return `\u0000idle-tail:${repoId}`;
}

/** One repository, as the fold reconciliation needs to see it. */
export interface FoldRepoInput {
  readonly repoId: string;
  /** How many of its worktrees are idle right now. */
  readonly idleCount: number;
  readonly worktrees: readonly { readonly id: string; readonly inWorkspace: boolean }[];
}

export interface FoldPruneInput {
  readonly repos: readonly FoldRepoInput[];
  readonly liveIds: ReadonlySet<string>;
  readonly liveRowIds: ReadonlySet<string>;
  readonly sessionRowIds: ReadonlySet<string>;
}

export interface FoldStateDeps {
  /** Persisted collapse keys, or `undefined` when nothing was ever stored. */
  readonly persisted: readonly string[] | undefined;
  readonly initialExpandedRows: readonly string[];
  readonly initialIdleSeeded: readonly string[];
  /** How many idle worktrees a repo needs before its tail is folded by default. */
  readonly idleFoldThreshold: number;
  persistCollapsed?(keys: readonly string[]): void;
  persistExpandedRows?(rowIds: readonly string[]): void;
  persistIdleSeeded?(repoIds: readonly string[]): void;
  /** The live search text. A filter REVEALS a tail; it does not re-decide it. */
  query(): string;
  repaint(): void;
}

export interface FoldState {
  isCollapsed(key: string): boolean;
  /** The set is a real collapsed set, so this is the whole rule. */
  isExpanded(worktreeId: string): boolean;
  isRowExpanded(rowId: string): boolean;
  idleTailFolded(repoId: string): boolean;
  toggleCollapsed(id: string): void;
  toggleKey(key: string): void;
  toggleRow(rowId: string): void;
  toggleIdleTail(repoId: string): void;
  /** The fold half of the view's `pruneStaleState`, and only that half. */
  prune(input: FoldPruneInput): void;
}

export function createFoldState(deps: FoldStateDeps): FoldState {
  const { persisted, idleFoldThreshold, query, repaint } = deps;
  const NUL = "\u0000";

  let collapsed = new Set(persisted ?? []);
  let expandedRows = new Set(deps.initialExpandedRows);
  const seeded = new Set(collapsed);
  const idleSeeded = new Set(deps.initialIdleSeeded);
  // True for exactly one prune: persisted keys mean every worktree in the first
  // tree has already been "seen", so none of them takes the first-time default.
  let restored = persisted !== undefined;

  /** The one place a collapse key flips, so persistence and repaint cannot
   *  diverge between the row kinds that share the set. */
  const toggleKey = (key: string): void => {
    if (collapsed.has(key)) {
      collapsed.delete(key);
    } else {
      collapsed.add(key);
    }
    deps.persistCollapsed?.([...collapsed]);
    repaint();
  };

  return {
    isCollapsed: (key) => collapsed.has(key),
    isExpanded: (worktreeId) => !collapsed.has(worktreeId),
    isRowExpanded: (rowId) => expandedRows.has(rowId),

    idleTailFolded(repoId) {
      if (query()) {
        return false;
      }
      return collapsed.has(idleTailKey(repoId));
    },

    toggleCollapsed(id) {
      toggleKey(id);
    },

    toggleKey,

    toggleRow(rowId) {
      if (expandedRows.has(rowId)) {
        expandedRows.delete(rowId);
      } else {
        expandedRows.add(rowId);
      }
      deps.persistExpandedRows?.([...expandedRows]);
      repaint();
    },

    toggleIdleTail(repoId) {
      // A filter REVEALS the tail; it does not re-decide it. `idleTailFolded`
      // already returns false while a query is up, so the rendered state here is
      // the query's and not the user's — flipping against the stored state would
      // spend a choice the user never made on this render.
      //
      // Nothing rendered can reach this any more: since W5 no disclosure is drawn
      // while a query reveals the tail, so no click arrives to guard. Kept because
      // the reveal rule and this one are the same rule, and a later render that
      // puts the disclosure back on screen under a filter would otherwise silently
      // spend the fold — the failure it protects against leaves no trace, only a
      // fold the user did not choose.
      if (query()) {
        return;
      }
      toggleKey(idleTailKey(repoId));
    },

    prune({ repos, liveIds, liveRowIds, sessionRowIds }) {
      const before = [...collapsed].join(NUL);
      const seededBefore = [...idleSeeded].join(NUL);
      const next = new Set<string>();

      for (const repo of repos) {
        if (collapsed.has(repo.repoId)) {
          next.add(repo.repoId);
        }
        const tailKey = idleTailKey(repo.repoId);
        if (idleSeeded.has(repo.repoId)) {
          if (collapsed.has(tailKey)) {
            next.add(tailKey);
          }
        } else if (repo.idleCount >= idleFoldThreshold) {
          // First time this repo has had a tail to present: default it folded, and
          // record that it HAS been presented. Seeding on the repo rather than on
          // the first push matters — a repo that gains its fourth idle worktree
          // later must still meet the tail folded.
          idleSeeded.add(repo.repoId);
          next.add(tailKey);
        }
        for (const wt of repo.worktrees) {
          const seen = seeded.has(wt.id) || restored;
          seeded.add(wt.id);
          if (seen ? collapsed.has(wt.id) : !wt.inWorkspace) {
            next.add(wt.id);
          }
        }
      }

      restored = false;
      for (const id of seeded) {
        if (!liveIds.has(id)) {
          seeded.delete(id);
        }
      }
      collapsed = next;
      if ([...next].join(NUL) !== before) {
        deps.persistCollapsed?.([...next]);
      }
      for (const id of idleSeeded) {
        if (!liveIds.has(id)) {
          idleSeeded.delete(id);
        }
      }
      if ([...idleSeeded].join(NUL) !== seededBefore) {
        deps.persistIdleSeeded?.([...idleSeeded]);
      }
      // Reconciled against the identities presence actually carries, never
      // accumulated — the same rule the host applies at the other end (D3, D14).
      // A row that lost its session keeps no expansion: the disclosure that would
      // collapse it is offered by the session, so the state would be unreachable.
      const expanded = [...expandedRows].filter((id) => liveRowIds.has(id) && sessionRowIds.has(id));
      if (expanded.length !== expandedRows.size) {
        expandedRows = new Set(expanded);
        deps.persistExpandedRows?.(expanded);
      }
    },
  };
}
