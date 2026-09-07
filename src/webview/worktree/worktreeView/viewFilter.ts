// src/webview/worktree/worktreeView/viewFilter.ts — Which worktrees a repo
// draws: the query that admits them, the idle partition, and the render cap.
//
// Extracted from `WorktreeView` by change `decompose-worktree-view` (design.md
// D1, task 3_10). Filter, partition and cap have to happen in that order — the
// cap's affordance must report only what the CAP excluded, and the fold must
// count only rows the cap admitted — and the three steps sat 200 lines apart
// from the predicates they call.
//
// The query and the uncapped set live here because this is what writes them.

import { agentRowTitle, branchLabel } from "../worktreeFormat";
import type { WorktreeAgentRow, WorktreeInfo, WorktreeRepo, WorktreeSubagentRow } from "../worktreeViewTypes";
import type { FoldState } from "./foldState";
import type { WorktreeViewData } from "./viewTypes";

/** The rows a roster actually delivered — nothing for unread, empty or failed. */
function delegatedRows(row: WorktreeAgentRow): readonly WorktreeSubagentRow[] {
  return row.delegations?.kind === "ok" ? row.delegations.rows : [];
}

export interface ViewFilterDeps {
  /** Read at call time: the fold state is constructed after this module. */
  fold(): Pick<FoldState, "isCollapsed" | "toggleIdleTail" | "idleTailFolded">;
  /** The envelope currently held — `isIdleIn` also runs against an incoming one. */
  data(): WorktreeViewData;
  /** The rows this view DRAWS for a worktree, from a supplied envelope. */
  displayRows(data: WorktreeViewData, worktreeId: string): WorktreeAgentRow[];
  rowsFor(worktreeId: string): WorktreeAgentRow[];
  /** Worktrees drawn per repo before the cap offers "Show all". */
  cap: number;
  repaint(): void;
}

export interface ViewFilter {
  /** The active query, trimmed and lowercased. Empty admits everything. */
  query(): string;

  /** Filter the tree by branch, path, and agent title. Ancestors of a match stay. */
  setQuery(query: string): void;

  /** The user asked to see past this repo's render cap. */
  uncap(repoId: string): void;

  /** A worktree survives the filter on its own text, or because a descendant matched. */
  matches(info: WorktreeInfo): boolean;

  /**
   * A POSITIVE determination that a worktree holds no agents — never a bare
   * `rows.length === 0`. There are three states, not two: has agents, has none,
   * and cannot be read. Collapsing the third into the second folds away exactly
   * the worktrees the degradation marker exists to surface.
   *
   * `PresenceDegradation` carries no repository or worktree attribution, so one
   * failed source suppresses folding everywhere. That is the honest reading of
   * the data rather than a shortcut.
   */
  isIdle(info: WorktreeInfo): boolean;

  /** Against a supplied envelope, because `pruneStaleState` runs on the incoming one. */
  isIdleIn(data: WorktreeViewData, info: WorktreeInfo): boolean;

  toggleIdleTail(repoId: string): void;

  /** Whether this repo's tail is folded right now — a live filter reveals it. */
  idleTailFolded(repoId: string): boolean;

  /**
   * The worktrees this repo draws: none when it is collapsed, otherwise the
   * matching ones up to the display cap.
   */
  shownWorktrees(repo: WorktreeRepo, multiRepo: boolean): WorktreeInfo[];
}

export function createViewFilter(deps: ViewFilterDeps): ViewFilter {
  let query = "";
  /** Repos the user asked to see past the render cap. */
  const uncapped = new Set<string>();

  const matches = (info: WorktreeInfo): boolean => {
    if (!query) {
      return true;
    }
    const q = query;
    if (branchLabel(info).text.toLowerCase().includes(q) || info.displayPath.toLowerCase().includes(q)) {
      return true;
    }
    return deps
      .rowsFor(info.id)
      .some(
        (row) =>
          agentRowTitle(row).toLowerCase().includes(q) ||
          (row.preview ?? "").toLowerCase().includes(q) ||
          delegatedRows(row).some((s) => `${s.name} ${s.title ?? ""}`.toLowerCase().includes(q)),
      );
  };

  const isIdleIn = (data: WorktreeViewData, info: WorktreeInfo): boolean => {
    const presence = data.presence;
    if (!presence || presence.degradedSources.length > 0) {
      return false;
    }
    // What is DRAWN, not what was projected: a worktree holding nothing but a
    // shell pane shows no agent rows, and calling it active kept it out of the
    // idle tail on the strength of a row the user cannot see (round-1 F001).
    return deps.displayRows(data, info.id).length === 0;
  };

  const isIdle = (info: WorktreeInfo): boolean => isIdleIn(deps.data(), info);

  return {
    query: () => query,
    matches,
    isIdle,
    isIdleIn,

    setQuery(next) {
      const trimmed = next.trim().toLowerCase();
      if (trimmed === query) {
        return;
      }
      query = trimmed;
      deps.repaint();
    },

    uncap(repoId) {
      uncapped.add(repoId);
    },

    shownWorktrees(repo, multiRepo) {
      if (multiRepo && deps.fold().isCollapsed(repo.repoId)) {
        return [];
      }
      // Filter, then partition, then cap — in that order, so the cap's affordance
      // keeps reporting only what the CAP excluded and the fold only ever counts
      // rows the cap admitted. Neither ends up describing the other's rows.
      const visible = repo.worktrees.filter((w) => matches(w));
      const ordered = [...visible.filter((w) => !isIdle(w)), ...visible.filter((w) => isIdle(w))];
      return uncapped.has(repo.repoId) ? ordered : ordered.slice(0, deps.cap);
    },

    toggleIdleTail(repoId) {
      // A filter REVEALS the tail; it does not re-decide it. `idleTailFolded` already
      // returns false while a query is up, so the rendered state here is the query's
      // and not the user's — flipping against the stored state would spend a choice
      // the user never made on this render.
      //
      // Nothing rendered can reach this any more: since W5 no disclosure is drawn while
      // a query reveals the tail, so no click arrives to guard. Kept because the reveal
      // rule and this one are the same rule, and a later render that puts the disclosure
      // back on screen under a filter would otherwise silently spend the fold — the
      // failure it protects against leaves no trace, only a fold the user did not choose.
      deps.fold().toggleIdleTail(repoId);
    },

    idleTailFolded: (repoId) => deps.fold().idleTailFolded(repoId),
  };
}
