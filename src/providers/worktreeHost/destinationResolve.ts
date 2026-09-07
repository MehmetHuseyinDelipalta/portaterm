// src/providers/worktreeHost/destinationResolve.ts — Where a create for one
// branch would land, and what it stepped over to get there.
//
// Extracted from `createWorktreeHost` by change `decompose-worktree-host`
// (design.md D1, task 2_3). ONE derivation for both answers: the probe and
// `worktreeCreateDefaults` each derived root, taken paths, slug, base and free
// suffix separately, so the destination the resolution named and the one the
// defaults reply named could drift apart (round-1 W4) — that is what this
// module is, and it now has a name rather than a position in a closure.
//
// Reads four host options and nothing else, so it is constructed from a `Pick`
// of them rather than a restatement: a field that changes shape changes here by
// type error, not by silence.

import type { ResolvedDisposition } from "../../types/messages";
import { isResolvedPathInside } from "../../utils/resolvedPathBoundary";
import { sanitizeBranchForPath } from "../../worktree/branchSlug";
import { resolveCreateRoot, suggestFreePath } from "../../worktree/createPath";
import { classifyDestination } from "../../worktree/debrisClassification";
import type { WorktreeRepo } from "../../worktree/types";
import type { WorktreeHostOptions } from "./hostOptions";

export type DestinationResolveDeps = Pick<
  WorktreeHostOptions,
  "createRoot" | "exists" | "probeGitEntry" | "resolvedPathDeps"
>;

/** Where a create would land, and the one thing it suffixed past. */
export interface ResolvedDestination {
  root: string;
  /** The directory NAME the candidate is built from, not a path to it. */
  base: string;
  bare: string;
  freePath: string;
  occupiedCandidate?: { path: string; disposition: ResolvedDisposition };
}

export interface DestinationResolve {
  /** The configured create root for one repository. */
  createRootFor(repo: WorktreeRepo): string;

  /**
   * A destination override the probe may act on, or `undefined`.
   *
   * Resolved rather than lexical containment: the answer authorizes
   * `options.exists`, which follows symlinks, so a path spelled beneath the
   * root that traverses a link out of it would turn the resolution into an
   * existence oracle for the filesystem (round-3 B8).
   */
  vettedOverride(candidate: string | undefined, repo: WorktreeRepo): Promise<string | undefined>;

  /**
   * A registered worktree is not debris, and neither is an unregistered
   * directory holding a `.git` — `classifyDestination` reads for one rather than
   * inferring from the listing (design.md D1). Runs only for a candidate the
   * suffixing already skipped, so the common path still adds no I/O.
   */
  dispositionOf(candidatePath: string, isRegistered: boolean): ResolvedDisposition;

  resolveDestination(
    repo: WorktreeRepo,
    branch: string,
    /** A destination override ALREADY proven to resolve inside the create root. */
    override?: string,
    /**
     * Derive inside THIS folder instead of the configured root.
     *
     * Already resolved, and resolved by the host's own dialog rather than named
     * by any message — the caller passes `Opening.chosenRoot`, never a value a
     * probe carried (design.md D4, D5).
     */
    chosen?: string,
  ): ResolvedDestination;
}

export function createDestinationResolve(options: DestinationResolveDeps): DestinationResolve {
  function createRootFor(repo: WorktreeRepo): string {
    return resolveCreateRoot({
      configured: options.createRoot?.() ?? { value: undefined, explicitlySet: false },
      linkedWorktrees: repo.worktrees.filter((w) => w.id !== repo.mainPath).map((w) => w.id),
      mainWorktree: repo.mainPath,
    });
  }

  function dispositionOf(candidatePath: string, isRegistered: boolean): ResolvedDisposition {
    return classifyDestination(candidatePath, isRegistered, options.probeGitEntry);
  }

  return {
    createRootFor,
    dispositionOf,

    async vettedOverride(candidate, repo) {
      if (candidate === undefined) {
        return undefined;
      }
      const inside = await isResolvedPathInside(candidate, createRootFor(repo), options.resolvedPathDeps).catch(
        () => false,
      );
      return inside ? candidate : undefined;
    },

    resolveDestination(repo, branch, override, chosen) {
      const root = chosen ?? createRootFor(repo);
      const registered = new Set(repo.worktrees.map((w) => w.id));
      // Registrations AND the filesystem: a directory nobody registered still
      // makes `git worktree add` fail, so proving a path free against the listing
      // alone proves the wrong thing (round-3 B12).
      const taken = (candidate: string): boolean => registered.has(candidate) || (options.exists?.(candidate) ?? false);
      const slug = sanitizeBranchForPath(branch);
      const base = slug.length > 0 ? `${repo.label}-${slug}` : repo.label;
      // An override is honoured only inside the configured root — vetted by the
      // caller through RESOLVED containment, because the answer states whether a
      // path is occupied and lexical containment would let a link out of the root
      // turn the probe into an existence oracle for the filesystem (round-3 B8).
      const inRoot = override;
      const bare = inRoot ?? suggestFreePath(root, base, () => false);
      const freePath = taken(bare) ? suggestFreePath(root, base, taken) : bare;
      return {
        root,
        base,
        bare,
        freePath,
        // Present only when the suffixing actually skipped something. `debris` is
        // the directory nobody registered — a registered worktree is not debris,
        // and nothing here mints an authorization to delete either (D4).
        ...(freePath === bare
          ? {}
          : { occupiedCandidate: { path: bare, disposition: dispositionOf(bare, registered.has(bare)) } }),
      };
    },
  };
}
