// src/worktree/worktreeMutationService.ts — The five mutating capabilities, as
// production actually gets them.
//
// Every verb in `worktreeMutations.ts` is a pure function over a git runner, and
// every safety component — the queue, the coordinator, the blocker evaluator,
// the fingerprint store, the create-path validator — is independently
// constructible. Round-1 B1 was that nothing assembled them: the host declared
// all five capabilities optional and the only production factory supplied none,
// so Lock and Remove were inert and Create and Prune were unreachable. This
// module is that assembly, and the one place the ordering rules live.

import type { WorktreeMutationTarget } from "../providers/WorktreeHost";
import type { BranchDeleteRequest } from "../types/messages";
import { provesAbsence } from "../utils/fsPresence";
import { type ClearDebrisDeps, nodeClearDebrisDeps } from "./clearDebris";
import { messageOf } from "./errorMessage";
import { createMutationCoordinator, type MutationSettle } from "./mutationCoordinator";
import { createMutationQueue } from "./mutationQueue";
import { createCreateProvisioning } from "./mutationService/createProvisioning";
import { createCreateRun } from "./mutationService/createRun";
import { paths, settled } from "./mutationService/outcomes";
import { createRegisterExisting } from "./mutationService/registerExisting";
import { createRemoval } from "./mutationService/removal";
import { createSetupExecution } from "./mutationService/setupExecution";
import { disposeProvisionMaterials } from "./provisioning/provisionMaterial";
import { lockWorktree, pruneRepo, unlockWorktree } from "./worktreeMutations";

/**
 * What a rejected `stat` of the journalled path proves.
 *
 * `false` only for the two codes that mean the path is not there. Every other
 * rejection — EACCES, EIO, ELOOP, a revoked mount — means we could not look,
 * and `null` is what `observeAfter` passes on as indeterminate. Reading them
 * all as absence let an unreadable filesystem authorize "the removal
 * succeeded" on the one irreversible verb (round-3 B13).
 */
export function existenceFromStatError(error: NodeJS.ErrnoException): false | null {
  return provesAbsence(error) ? false : null;
}

// The service's contract lives in `mutationService/serviceTypes.ts` (task 4_1).
// Re-exported here so no importer moves, and imported too because a re-export
// is not a local binding.
export type {
  MutationOutcome,
  MutationServiceDeps,
  MutationVerb,
  RemovalReport,
  RepairListingRecord,
  ResolvedTarget,
  SetupExecutionInput,
  SetupExecutionOutcome,
  WorktreeMutationService,
} from "./mutationService/serviceTypes";

import type {
  MutationOutcome,
  MutationServiceDeps,
  MutationVerb,
  ResolvedTarget,
  WorktreeMutationService,
} from "./mutationService/serviceTypes";

export function createWorktreeMutationService(deps: MutationServiceDeps): WorktreeMutationService {
  // The module's own, not deps assembled from `pathDeps`: the boundary's
  // ordering rule holds only while every probe is synchronous, and the async
  // path helpers would satisfy the types while reopening the window (round-1 B4).
  const clearDebrisDeps: ClearDebrisDeps = deps.clearDebrisDeps ?? nodeClearDebrisDeps;
  const coordinator =
    deps.coordinator ??
    createMutationCoordinator({
      queue: createMutationQueue(),
      gate: { request: async (repoId) => void (await deps.forceRebuild(repoId)) },
    });

  // Setup execution and the retry authority it hands out. The map, its key and
  // its id minting live together in there — the one-shot property is their
  // conjunction, not the map's alone (design.md D3).
  const setup = createSetupExecution({
    coordinator,
    newSetupRetryId: deps.newSetupRetryId ?? (() => crypto.randomUUID()),
    resolve: (target) => deps.resolve(target),
    ...(deps.runSetup === undefined ? {} : { runSetup: deps.runSetup }),
    ...(deps.writeProvisionManifest === undefined ? {} : { writeProvisionManifest: deps.writeProvisionManifest }),
    ...(deps.retireSetupOutput === undefined ? {} : { retireSetupOutput: deps.retireSetupOutput }),
    ...(deps.reportProvisioning === undefined ? {} : { reportProvisioning: deps.reportProvisioning }),
  });
  const provisioning = createCreateProvisioning({ service: deps, setup });
  // The fingerprint store lives inside this, with every one of its readers. The
  // facade holds no reference to it at all, which is what task 1_2's Boundary
  // asks for: one owner, or the store has two across a module edge (D1a).
  // The two creates that create nothing. They left create-proper before its
  // create-path check and never reached its body, so nothing of create-proper's
  // travels with them except `fail`, which is passed per call (D2).
  const registerExisting = createRegisterExisting({
    runner: deps.runner,
    repoPath: (repoId) => deps.repoPath(repoId),
    pathDeps: deps.pathDeps,
    listWorktrees: (repoPath) => deps.listWorktrees(repoPath),
    corroborateAdopt: (input) => deps.corroborateAdopt(input),
    corroborateRepair: (input) => deps.corroborateRepair(input),
    reconstructEntry: (request) => deps.reconstructEntry(request),
    afterCreate: (path, after, origin) => deps.afterCreate(path, after, origin),
    report: (outcome, origin) => deps.report(outcome, origin),
    runCoordinated: (repoId, step) => coordinator.run<string, MutationOutcome>(repoId, step),
  });
  const createRun = createCreateRun({
    service: deps,
    registerExisting,
    coordinator,
    clearDebrisDeps,
    provisioning,
    setup,
  });
  const removal = createRemoval({
    runner: deps.runner,
    resolve: (target) => deps.resolve(target),
    now: () => deps.now(),
    assessRemoval: (target) => deps.assessRemoval(target),
    observation: (repoId) => deps.observation(repoId),
    observeAfter: (target, journalledPath) => deps.observeAfter(target, journalledPath),
    ...(deps.deleteBranch === undefined ? {} : { deleteBranch: deps.deleteBranch }),
    // Shared with lock and unlock, so it stays here: a second wrapper would be a
    // second report stamping for the same class of verb.
    withTarget,
    runCoordinated: (repoId, step) => coordinator.run(repoId, step),
  });

  /**
   * Run `body` against whatever `target` names AFTER the rebuild.
   *
   * The id is carried the whole way rather than resolved at the message
   * boundary: a queued mutation that resolved on arrival would act on a path
   * whose registration may have been replaced while it waited, which for a
   * forced removal means deleting a different worktree than the one confirmed
   * (round-1 B2).
   */
  function withTarget(
    verb: MutationVerb,
    target: WorktreeMutationTarget,
    body: (resolved: ResolvedTarget, ctx: MutationSettle) => Promise<MutationOutcome>,
    missing?: () => Promise<MutationOutcome>,
  ): Promise<void> {
    return coordinator
      .run<ResolvedTarget, MutationOutcome>(target.repoId, {
        resolve: async () => deps.resolve(target),
        body,
        ...(missing === undefined ? {} : { missing }),
      })
      .then(
        // Stamped once, here: every worktree-scoped verb leaves through this
        // wrapper, and a notice with no scope attaches to no row at all.
        (outcome) => deps.report({ ...outcome, worktreeId: target.worktreeId }, target.origin),
        (error: unknown) =>
          deps.report(
            { kind: "error", verb, repoId: target.repoId, worktreeId: target.worktreeId, message: messageOf(error) },
            target.origin,
          ),
      );
  }

  const service: WorktreeMutationService = {
    /**
     * Drop the confirmation of every worktree the tree no longer holds.
     *
     * D15 says a confirmation does not survive the disappearance of what it was
     * issued for, and the removal path is only ONE way that disappearance gets
     * observed. A worktree deleted by another window, or by the user in a
     * terminal, is seen by an ordinary watcher-driven rebuild — and until this
     * ran there, a token issued before that deletion stayed live and could
     * authorize destroying whatever was created at the same location next
     * (round-3 B5).
     */
    reconcileFingerprints(presentWorktreeIds: readonly string[]) {
      const present = new Set(presentWorktreeIds);
      removal.forgetAbsent(present);
      setup.forgetAbsent(present);
    },

    retrySetup: (target, retryId) => setup.retrySetup(target, retryId),

    issueFingerprint: (target, evidence) => removal.issueFingerprint(target, evidence),

    assessRemovalReport: (target) => removal.assessRemovalReport(target),

    issueDebrisAuthorization: createRun.issueDebrisAuthorization,

    lockWorktree: (target, reason) =>
      withTarget("lock", target, async (t) =>
        settled("lock", target.repoId, await lockWorktree(deps.runner, { ...paths(t), reason })),
      ),

    unlockWorktree: (target) =>
      withTarget("unlock", target, async (t) =>
        settled("unlock", target.repoId, await unlockWorktree(deps.runner, paths(t))),
      ),

    removeWorktree: (target, fingerprint, deleteBranchRequest?: BranchDeleteRequest) =>
      removal.removeWorktree(target, fingerprint, deleteBranchRequest),

    pruneRepo: (repoId, confirmedCount, origin) => {
      // The count arrives from a webview message. A prune authorized by a
      // number that is not one cannot be re-checked against anything.
      if (!Number.isSafeInteger(confirmedCount) || confirmedCount < 0) {
        deps.report(
          { kind: "error", verb: "prune", repoId, message: "That confirmation did not name a count." },
          origin,
        );
        return Promise.resolve();
      }
      return coordinator
        .run<string, MutationOutcome>(repoId, {
          resolve: async () => deps.repoPath(repoId),
          body: async (repoPath) => {
            // Re-counted inside the queue: the user authorized a NUMBER, and a
            // prune that drops a different one is not what they confirmed.
            const actual = await pruneRepo.countPrunable(deps.runner, repoPath);
            if (!actual.ok) {
              // Unreadable is not zero, and it is not a mismatch either: we
              // cannot say what this prune would drop, so it does not run.
              return { kind: "unavailable", verb: "prune", repoId, unreadable: ["prunable"] };
            }
            if (actual.count !== confirmedCount) {
              return {
                kind: "error",
                verb: "prune",
                repoId,
                message: `There are now ${actual.count} stale registrations, not ${confirmedCount}. Please confirm again.`,
              };
            }
            return settled("prune", repoId, await pruneRepo.run(deps.runner, repoPath));
          },
        })
        .then(
          (outcome) => deps.report(outcome, origin),
          (error: unknown) => deps.report({ kind: "error", verb: "prune", repoId, message: messageOf(error) }, origin),
        );
    },

    createWorktree: createRun.createWorktree,
  };
  const runCreateWorktree = service.createWorktree;
  return {
    ...service,
    createWorktree: async (request) => {
      try {
        await runCreateWorktree(request);
      } finally {
        disposeProvisionMaterials(request.provision ?? []);
      }
    },
  };
}
