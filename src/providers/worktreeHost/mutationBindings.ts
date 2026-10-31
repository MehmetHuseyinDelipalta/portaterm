// src/providers/worktreeHost/mutationBindings.ts — The narrow read surface a
// mutation service is built on, what it hands back, and what an id names once
// the tree has been rebuilt.
//
// Split off `hostOptions.ts` by change `decompose-worktree-host` (task 2_1)
// after `asm refactor shape` reported the contract file as a type blob. These
// three answer to a different consumer than the rest of it: the mutation
// service reads them, and the host only hands them out (round-1 B1).
//
// Re-exported from `src/providers/WorktreeHost.ts`, so no importer moved (D4).

import type { WorktreeMutationResultMessage, WorktreeProvisionResultMessage } from "../../types/messages";
import type { MigrationRepositoryBinding } from "../../worktree/migrateChanges";
import type { RemovalAssessment } from "../../worktree/worktreeBlockers";
import type { WorktreeMutationTarget, WorktreeSurface } from "./hostTypes";

/**
 * The reads a mutation service needs from the host, and nothing else.
 *
 * Handed out rather than injected because the host is what OWNS the cache, the
 * rebuild gate and the projection, and the service is constructed alongside it
 * at the extension seam. One narrow interface keeps that seam from becoming a
 * back door onto the whole host.
 */
export interface WorktreeMutationBindings {
  /** Rebuild `repoId` and wait for it. */
  forceRebuild(repoId: string): Promise<void>;
  /** What `worktreeId` names in the CURRENT tree, or null once it is gone. */
  resolve(target: WorktreeMutationTarget): ResolvedMutationTarget | null;
  /** The repository's main worktree path, for the repo-scoped verbs. */
  repoPath(repoId: string): string | null;
  /** The migration registration paired with the currently published generation. */
  migrationRegistration(repoId: string): MigrationRepositoryBinding["registration"] | undefined;
  /**
   * The observation the current tree holds of this repository, or `undefined`
   * when it holds none — the listing is stale, failed, absent, or git is
   * unusable (design.md D12).
   *
   * The value, not a boolean: a caller that reads state on one side of an
   * `await` and acts on it on the other has to be able to ask whether it is
   * still the same observation (round-9 B8).
   */
  observation(repoId: string): number | undefined;
  /** Where a create may go in this repo, and what already occupies it. */
  createContext(
    repoId: string,
  ): { mainWorktree: string; linkedWorktrees: readonly string[]; commonDir?: string } | null;
  /**
   * The full blocker assessment for a removal target, from real state.
   *
   * On the host because the host is what holds all six inputs — the listing,
   * the projection, the pane store, the registry, and the git runner that reads
   * `--porcelain`. `null` when the id names nothing or the facts are unavailable.
   */
  assessRemoval(target: WorktreeMutationTarget): Promise<RemovalAssessment | null>;
}

/** What an id names once the tree has been rebuilt. */
/** What the service hands back, plus where it came from. */
export interface WorktreeMutationReport {
  origin: WorktreeSurface | null;
  message: WorktreeMutationResultMessage;
  /** Set only on a successful create that asked for a terminal. */
  openTerminalAt?: string;
  /**
   * Posted to the same surface immediately after `message`.
   *
   * Provisioning results ride here rather than through a second surface lookup:
   * this path already owns attachment, and posting straight at the providers is
   * what missed every editor surface (D17). Ordering is the contract — the
   * create's own outcome first, then what provisioning did.
   */
  provisionResult?: WorktreeProvisionResultMessage;
}

export interface ResolvedMutationTarget {
  repoPath: string;
  worktreePath: string;
  /** Does NOT survive a remove-and-recreate at the same path (round-1 B5). */
  incarnation: string;
  locked: boolean;
  wasRegistered: boolean;
  existedOnDisk: boolean;
}
