// src/providers/worktreeHost/actions/removal.ts — The actions that unregister a worktree.
//
// Extracted from `handleAction` by change `decompose-worktree-host-controller`
// (design.md D1, task 2_2). Assess, remove, lock, unlock and prune: the arms that
// end with something no longer being registered.
//
// This module is named explicitly in `src/test/invariants/fsDeletionGate.ts`.
// The gate matches a stated list by exact path, so moving this code here without
// adding it there would have left the I10 invariant passing while watching
// nothing (design.md OBL-1).

import type { WorktreeActionMessage } from "../../../types/messages";
import type { WorktreeActions, WorktreeSurface } from "../hostTypes";
import { isKnownDeleteBranchRequest } from "../messageGuards";

/** One arm, once the dispatcher has proved `actions` is there. */
type Arm<T extends WorktreeActionMessage["type"]> = (
  surface: WorktreeSurface,
  msg: Extract<WorktreeActionMessage, { type: T }>,
  actions: WorktreeActions,
) => void;

/**
 * A report request awaiting admission.
 *
 * Structurally the host's own `PendingAssess`. Named here so this module states
 * what it needs rather than importing a type back out of the host.
 */
export type AssessRequest =
  | { kind: "assessment"; surface: WorktreeSurface; worktreeId: string; token: string }
  | { kind: "rawRemoval"; surface: WorktreeSurface; worktreeId: string };

export interface RemovalDeps {
  actionPath(worktreeId: string, allowMissing: boolean): string | undefined;
  repoIdOf(worktreeId: string): string | undefined;
  /** Share the per-repository report bound with fingerprint-free raw intents. */
  admitAssess(repoId: string, request: AssessRequest): void;
  perform(run: () => Promise<void>): void;
  /** Whether this surface is still attached — an unanswered request leaves the panel waiting (D12). */
  hasSurface(surface: WorktreeSurface): boolean;
}

export function createRemovalActions(deps: RemovalDeps) {
  const { actionPath, repoIdOf, admitAssess, perform, hasSurface } = deps;

  const worktreeRemoveAssess: Arm<"worktreeRemoveAssess"> = (surface, msg, actions) => {
    const assess = actions.assessRemovalReport;
    const assessTarget = msg.worktreeId;
    const assessRepo = repoIdOf(assessTarget);
    // NOT `perform`: that wrapper publishes a mutation result, and a read
    // must not announce itself as one. It also takes the rebuild gate — but
    // that half was never a reason to avoid it, and the capability now takes
    // that barrier itself, because a report read from the cache can describe
    // a registration the confirmation will not act on (D10).
    if (assess === undefined || assessRepo === undefined || actionPath(assessTarget, true) === undefined) {
      // Answered, not dropped. D12 admits no exception: an unanswered
      // request leaves the panel waiting on a reply that is never coming.
      if (hasSurface(surface)) {
        surface.post({
          type: "worktreeRemoveAssessment",
          worktreeId: assessTarget,
          token: msg.token,
          result: { kind: "unavailable", unreadable: ["the worktree is no longer registered"] },
        });
      }
      return;
    }
    // Admission is shared with fingerprint-free raw intents: both produce
    // reports and therefore contribute to the same per-repository bound.
    admitAssess(assessRepo, {
      kind: "assessment",
      surface,
      worktreeId: assessTarget,
      token: msg.token,
    });
    return;
  };

  const worktreeRemove: Arm<"worktreeRemove"> = (surface, msg, actions) => {
    // A `missing` worktree still resolves: `git worktree remove` is how its
    // stale registration gets pruned (worktree-rpc.md:241).
    const remove = actions.removeWorktree;
    // Gated on resolvability HERE and resolved for real later. The gate is
    // a fail-fast so an id the host never published spawns nothing at all;
    // it is not the resolution the action acts on (B2).
    const gate = actionPath(msg.worktreeId, true);
    // Deliberately NOT pre-resolved: the capability re-resolves this id
    // after its own forced rebuild (B2). A `missing` worktree still
    // resolves there — `git worktree remove` is how its stale registration
    // gets pruned (worktree-rpc.md:241).
    //
    // The host forwards confirmation authority, not Git's execution mode.
    // No fingerprint means "report this target"; only the service owns the
    // fresh evidence that can choose ordinary versus forced execution (D7).
    const repoId = repoIdOf(msg.worktreeId);
    if (remove && repoId !== undefined && gate !== undefined) {
      if (msg.fingerprint === undefined) {
        admitAssess(repoId, { kind: "rawRemoval", surface, worktreeId: msg.worktreeId });
      } else {
        // Validated at runtime like every other inbound field on this
        // message: an unrecognized or malformed `deleteBranch` is not a
        // lesser opt-in, it is the same as none (round-1 W1 pattern).
        const deleteBranchRequest = isKnownDeleteBranchRequest(msg.deleteBranch) ? msg.deleteBranch : undefined;
        perform(() =>
          deleteBranchRequest === undefined
            ? remove({ repoId, worktreeId: msg.worktreeId, origin: surface }, msg.fingerprint)
            : remove({ repoId, worktreeId: msg.worktreeId, origin: surface }, msg.fingerprint, deleteBranchRequest),
        );
      }
    }
    return;
  };

  const worktreeLock: Arm<"worktreeLock"> = (surface, msg, actions) => {
    const lock = actions.lockWorktree;
    const repoId = repoIdOf(msg.worktreeId);
    // A worktree whose directory is gone resolves for a copy and nothing
    // else (design.md D3) — locking one would act on a path that is not
    // there.
    if (lock && repoId !== undefined && actionPath(msg.worktreeId, false) !== undefined) {
      perform(() => lock({ repoId, worktreeId: msg.worktreeId, origin: surface }, msg.reason));
    }
    return;
  };

  const worktreeUnlock: Arm<"worktreeUnlock"> = (surface, msg, actions) => {
    const unlock = actions.unlockWorktree;
    const repoId = repoIdOf(msg.worktreeId);
    if (unlock && repoId !== undefined && actionPath(msg.worktreeId, false) !== undefined) {
      perform(() => unlock({ repoId, worktreeId: msg.worktreeId, origin: surface }));
    }
    return;
  };

  const worktreePrune: Arm<"worktreePrune"> = (surface, msg, actions) => {
    // Repo-scoped, so it resolves against the repo id rather than a
    // worktree — there is no single worktree a prune acts on.
    const prune = actions.pruneRepo;
    if (prune && typeof msg.repoId === "string" && msg.repoId.length > 0) {
      perform(() => prune(msg.repoId, msg.confirmedCount, surface));
    }
    return;
  };

  return {
    worktreeRemoveAssess,
    worktreeRemove,
    worktreeLock,
    worktreeUnlock,
    worktreePrune,
  };
}
