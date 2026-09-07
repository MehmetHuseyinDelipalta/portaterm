// src/providers/worktreeHost/hostLookups.ts — Reading one worktree, repository,
// path, registration or agent row out of the tree this host currently holds.
//
// Extracted from `createWorktreeHost` by change `decompose-worktree-host`
// (design.md D1, task 2_5). Eight readers over one cache, spread across a
// thousand lines of the closure. None of them writes anything, which is why
// they travel together: everything that acts asks one of these first.
//
// Two doc comments arrived attached to the wrong declaration — `actionPath`'s
// sat above `launchTarget` in the closure. Each is seated on its own subject
// here; no code moved with them.

import type { WorktreeAgentRow } from "../../worktree/presenceTypes";
import type { WorktreeInfo, WorktreeRepo } from "../../worktree/types";
import type { LaunchTargetRecord } from "./hostTypes";

/**
 * The registration a repository publishes when the host OBSERVED its listing.
 *
 * Absent when the cache RETAINED the listing rather than reading it, and
 * absent for every repository while git itself is unusable — a retained
 * listing is right for DISPLAY (three worktrees marked degraded beats none)
 * and wrong for authority, because admitting on it would mint fresh authority
 * over registrations discovery just failed to verify (round-5 B7).
 *
 * Present for a repository nobody can watch: its listing WAS read, it may
 * just go stale unnoticed, and refusing there would disable launches and
 * removals on every host without file watching (D11).
 *
 * A launch and a removal ask this and nothing else (design.md D12). Nobody
 * re-derives it from `degraded`, which is the composed line shown to the user
 * and also carries the watch claim (round-7 W8).
 */
export function observationOf(repo: WorktreeRepo | undefined): number | undefined {
  return repo?.generation;
}

export interface HostLookupsDeps {
  /** The repositories in the tree this host currently holds. */
  repos(): readonly WorktreeRepo[];
  /** One row out of the presence envelope last published (task 2_6). */
  publishedRow(rowId: string): WorktreeAgentRow | undefined;
}

export interface HostLookups {
  /** The worktree `worktreeId` names in the tree this host currently holds. */
  cachedWorktree(worktreeId: string): WorktreeInfo | undefined;

  /**
   * Which repository holds this worktree, derived rather than accepted.
   *
   * The inbound messages carry only a `worktreeId`, and that is the right
   * shape: a webview-supplied `repoId` would let one repo's panel name
   * another's queue, and the id it names is the only thing a mutation is
   * entitled to act on. Resolved here for the queue key only — the TARGET is
   * re-resolved from the id on the far side of the rebuild (round-1 B2).
   */
  repoIdOf(worktreeId: string): string | undefined;

  repoById(repoId: string): WorktreeRepo | undefined;

  /**
   * Which observation of this worktree's registration the host currently holds,
   * or `undefined` when it holds none.
   *
   * "Something is there" and "the same thing is there" are different questions,
   * and remove-then-recreate at the same normalized id answers yes to the first.
   * Nothing git reports answers the second: the same branch at the same commit
   * lists identically, and git reuses `.git/worktrees/<name>` after a deletion
   * (`worktreeFingerprint.ts`). So the answer is the cache's own — it advances
   * the number whenever it re-observes a repository, because re-observing is
   * exactly when it stops being able to prove continuity (design.md D10).
   *
   * Per repository, never the global `treeVersion`: a sibling repository
   * rebuilding must not refuse this launch.
   */
  launchTarget(worktreeId: string): LaunchTargetRecord | undefined;

  /**
   * The path to act on for a worktree request, or undefined to do nothing.
   *
   * A `missing` worktree resolves for a copy and for nothing else: copying the
   * path is how a user goes and looks at what happened to a directory that is
   * gone, but opening, revealing or spawning a terminal in one would act on a
   * path that is not there (design.md D3).
   */
  actionPath(worktreeId: string, allowMissing: boolean): string | undefined;

  /**
   * The published row this request names, only if the value it carried still
   * matches the host's own.
   *
   * The carried id is an expected-version token, never an argument: a surface
   * whose last envelope was skipped still shows the previous session under a
   * stable row id, and acting on the id it sent would act on the wrong session
   * (D3). Returning the row rather than a boolean is what makes it impossible to
   * check one value and then act on another.
   */
  matchedRow(rowId: string, field: "paneId" | "entryId", carried: string): WorktreeAgentRow | undefined;

  /** The repo record holding `worktreeId`, paired with the worktree itself. */
  locate(worktreeId: string): { repo: WorktreeRepo; wt: WorktreeInfo } | null;
}

export function createHostLookups(deps: HostLookupsDeps): HostLookups {
  function cachedWorktree(worktreeId: string): WorktreeInfo | undefined {
    for (const repo of deps.repos()) {
      const found = repo.worktrees.find((wt) => wt.id === worktreeId);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  return {
    cachedWorktree,

    repoIdOf(worktreeId) {
      for (const repo of deps.repos()) {
        if (repo.worktrees.some((wt) => wt.id === worktreeId)) {
          return repo.repoId;
        }
      }
      return undefined;
    },

    repoById(repoId) {
      return deps.repos().find((r) => r.repoId === repoId);
    },

    launchTarget(worktreeId) {
      for (const repo of deps.repos()) {
        const found = repo.worktrees.find((wt) => wt.id === worktreeId);
        if (found === undefined) {
          continue;
        }
        const observed = observationOf(repo);
        if (found.missing === true || observed === undefined) {
          return undefined;
        }
        // git's own display string, never the normalized id.
        return { path: found.displayPath, generation: observed };
      }
      return undefined;
    },

    actionPath(worktreeId, allowMissing) {
      const wt = cachedWorktree(worktreeId);
      if (!wt || (wt.missing && !allowMissing)) {
        return undefined;
      }
      return wt.displayPath;
    },

    matchedRow(rowId, field, carried) {
      const row = deps.publishedRow(rowId);
      const own = row?.[field];
      return own !== undefined && own === carried ? row : undefined;
    },

    locate(worktreeId) {
      for (const repo of deps.repos()) {
        const wt = repo.worktrees.find((w) => w.id === worktreeId);
        if (wt) {
          return { repo, wt };
        }
      }
      return null;
    },
  };
}
