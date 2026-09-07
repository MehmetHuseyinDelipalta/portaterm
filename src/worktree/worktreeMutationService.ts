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

import * as nodePath from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { WorktreeMutationTarget } from "../providers/WorktreeHost";
import type { BranchDeleteRequest, WorktreeCreateMode } from "../types/messages";
import { provesAbsence } from "../utils/fsPresence";
import { type ClearDebrisDeps, clearDebris, nodeClearDebrisDeps } from "./clearDebris";
import { identityOf, intentFor, validateCreatePath } from "./createPath";
import { createDebrisAuthorizationStore } from "./debrisAuthorization";
import { messageOf } from "./errorMessage";
import { createMutationCoordinator, type MutationSettle } from "./mutationCoordinator";
import { createMutationQueue } from "./mutationQueue";
import { createCreateProvisioning } from "./mutationService/createProvisioning";
import { paths, settled } from "./mutationService/outcomes";
import { createRegisterExisting } from "./mutationService/registerExisting";
import { createRemoval } from "./mutationService/removal";
import { createSetupExecution, type PendingSetupRetry } from "./mutationService/setupExecution";
import { disposeProvisionMaterials } from "./provisioning/provisionMaterial";
import {
  branchNameIsValid,
  type CreateSource,
  createWorktree,
  lockWorktree,
  pruneRepo,
  unlockWorktree,
} from "./worktreeMutations";

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
  const debrisAuthorizations = deps.debrisAuthorizations ?? createDebrisAuthorizationStore();
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

    async issueDebrisAuthorization(path) {
      // ONE observation answers both halves: what the offer will state, and what
      // the token binds. Reading twice would let them disagree (design.md D6).
      const stat = await deps.pathDeps.lstat(path);
      const identity = identityOf(stat);
      if (stat === null || !stat.isDirectory()) {
        return { ok: false, because: "unreadable" };
      }
      // No identity is not "not debris": the reading succeeded and the platform
      // supplied nothing to bind to, which is a failure to read what the
      // authorization needs.
      if (identity === null) {
        return { ok: false, because: "unreadable" };
      }
      const git = clearDebrisDeps.probeEntry(nodePath.join(path, ".git"));
      if (git !== "absent") {
        return { ok: false, because: git === "present" ? "notDebris" : "unreadable" };
      }
      const entries = await deps.pathDeps.readdir(path);
      if (entries === null) {
        return { ok: false, because: "unreadable" };
      }
      return { ok: true, fingerprint: debrisAuthorizations.issue(path, { entries, identity }, deps.now()), entries };
    },

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

    createWorktree: async (request) => {
      const fail = (message: string): MutationOutcome => ({
        kind: "error",
        verb: "create",
        repoId: request.repoId,
        message,
      });

      // PHASE 1 — before the queue. D6 wants two observations with the wait
      // BETWEEN them; validating only on the far side is one observation with a
      // wait in front of it, which cannot detect a change because it never saw
      // the earlier state (round-2 B4). This is the "earlier state".
      if (request.migration !== undefined && (request.mode.kind === "reattach" || request.mode.kind === "adopt")) {
        deps.report(fail("Migration is available only when creating a new checkout."), request.origin);
        return;
      }

      // Adopt leaves before the create-path check, for the reason reattach does
      // and one more: `validateCreatePath` refuses an occupied destination, and
      // the surviving checkout IS the destination. An adoption creates nothing —
      // it writes the administrative entry git will not write (design.md D4).
      if (request.mode.kind === "adopt") {
        return registerExisting.adopt(request, request.mode, fail);
      }

      // Reattach leaves before the create-path check, not inside it.
      //
      // `validateCreatePath` answers "may a worktree be CREATED here", and one
      // of its rules is that the destination is not another worktree of this
      // repository — which the stale registration still is, so every reattach
      // would be refused by the check that exists to protect creates. A repair
      // creates nothing: it rewrites the link to a directory git already
      // registered. Its guard is D3's conditions, re-established below.
      if (request.mode.kind === "reattach") {
        return registerExisting.reattach(request, request.mode, fail);
      }

      const before = deps.createContext(request.repoId);
      if (before === null) {
        deps.report(fail("That repository is gone."), request.origin);
        return;
      }
      // Resolved ONCE and used for both observations. Deriving it separately in
      // each phase would let the two checks disagree about what the destination
      // was supposed to be, which is the one thing the two-phase check exists to
      // detect.
      const intent = intentFor(request.mode, request.disposition);
      const first = await validateCreatePath(request.path, before, deps.pathDeps, intent, {
        allowedContainingWorktree: request.migration?.sourcePath,
      });
      if (!first.ok) {
        deps.report(fail(first.reason), request.origin);
        return;
      }

      let pendingSetupRetry: PendingSetupRetry | undefined;
      return coordinator
        .run<string, MutationOutcome>(request.repoId, {
          resolve: async () => deps.repoPath(request.repoId),
          body: async (repoPath) => {
            const ctx = deps.createContext(request.repoId);
            if (ctx === null) {
              return fail("That repository is gone.");
            }
            // PHASE 2 — the FULL check again, not a spot-check. Lexical walk,
            // normalization, containment, type and emptiness all re-run here,
            // because any of them can have changed during the wait.
            const check = await validateCreatePath(request.path, ctx, deps.pathDeps, intent, {
              allowedContainingWorktree: request.migration?.sourcePath,
            });
            if (!check.ok) {
              return fail(check.reason);
            }
            if (check.path !== first.path) {
              // The same input string now normalizes somewhere else, which means
              // something in the ancestry was replaced.
              return fail("That location changed while the action was queued. Please try again.");
            }
            const stat = await deps.pathDeps.lstat(check.recheckPath);
            const moved =
              check.recheckPath !== first.recheckPath ||
              check.mustBeEmpty !== first.mustBeEmpty ||
              identityOf(stat) !== first.recheckIdentity;
            if (moved) {
              return fail("That location changed while the action was queued. Please try again.");
            }
            // Emptiness is re-asked of the CURRENT observation, not inherited
            // from phase 1 — `mustBeEmpty` was never consumed a second time.
            if (check.mustBeEmpty) {
              const entries = await deps.pathDeps.readdir(check.recheckPath);
              if (entries === null || entries.length > 0) {
                return fail("That directory is no longer empty.");
              }
            }
            // Before anything is created: git's own answer, so an invalid name
            // fails as a name rather than as a half-finished worktree (W9).
            const named = branchOf(request.mode);
            if (named !== undefined && (await branchNameIsValid(deps.runner, repoPath, named)) === false) {
              return fail(`Git will not accept "${named}" as a branch name.`);
            }
            const migrationAuthorityIsCurrent = (): boolean =>
              request.migration === undefined ||
              isDeepStrictEqual(deps.migrationRegistration?.(request.repoId), request.migration.binding.registration);
            // The clearance goes LAST, after every recheck and every question
            // that can still refuse — a directory deleted before a refusal is a
            // directory deleted for nothing. `clearDebris` re-takes the identity
            // reading itself: `branchNameIsValid` above awaited, so the phase-2
            // comparison no longer describes the moment of the delete (D3).
            if (intent.kind === "mustMatchDebrisAuthorization") {
              if (!migrationAuthorityIsCurrent()) {
                return fail("The source repository changed while the create was queued. Please try again.");
              }
              const entries = await deps.pathDeps.readdir(check.path);
              if (entries === null) {
                // An unreadable directory is not an empty one. Redeeming it as
                // `[]` made it a subset of every approved set, so contents
                // nobody could inspect passed the comparison (round-1 B3). The
                // authorization goes with it: it was issued over a reading that
                // can no longer be taken.
                debrisAuthorizations.forget(check.path);
                return fail("That directory could not be read, so it will not be cleared.");
              }
              const identity = identityOf(await deps.pathDeps.lstat(check.path));
              const verdict = debrisAuthorizations.redeem(
                check.path,
                intent.authorization.fingerprint,
                { entries, identity },
                deps.now(),
              );
              if (verdict.kind !== "proceed") {
                return fail("That directory changed since it was shown to you. Please try again.");
              }
              // The APPROVED evidence travels, not this redemption's reading of
              // the moment: the boundary re-compares, and comparing against an
              // intermediate reading refused an approved entry that had vanished
              // and come back (round-1 B4, round-2 W4).
              const approvedIdentity = verdict.approved.identity;
              const cleared = await clearDebris(
                check.path,
                ctx,
                approvedIdentity === null ? null : { identity: approvedIdentity, entries: verdict.approved.entries },
                clearDebrisDeps,
              );
              if (!cleared.ok) {
                return fail(cleared.reason);
              }
            }
            if (!migrationAuthorityIsCurrent()) {
              return fail("The source repository changed while the create was queued. Please try again.");
            }
            const result = await createWorktree(deps.runner, {
              repoPath,
              worktreePath: check.path,
              source: sourceOf(request.mode),
            });
            if (!result.ok) {
              return settled("create", request.repoId, result);
            }
            return provisioning.provisionCreated({
              request,
              repoPath,
              worktreePath: check.path,
              setPendingSetupRetry: (retry) => {
                pendingSetupRetry = retry;
              },
            });
          },
        })
        .then(
          (outcome) => {
            let reported = outcome;
            if (outcome.kind === "ok" && outcome.worktreeId !== undefined && outcome.provision !== undefined) {
              // One call: the retire and the mint-and-insert are the same
              // decision, and the id has to be minted where the map is (D3).
              const retryId = setup.register(request.repoId, outcome.worktreeId, pendingSetupRetry);
              if (retryId !== null) {
                reported = { ...outcome, provision: { ...outcome.provision, setupRetryId: retryId } };
              }
            }
            deps.report(reported, request.origin);
          },
          (error: unknown) => deps.report(fail(messageOf(error)), request.origin),
        );
    },
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

/**
 * The branch this create would CREATE, or undefined.
 *
 * Only a new branch is checked: an existing branch was already accepted by git
 * when it was made, and a detached create names a revision, not a branch.
 */
function branchOf(mode: WorktreeCreateMode): string | undefined {
  return mode.kind === "fresh" ? mode.branch : undefined;
}

/**
 * The wire mode, in git's own vocabulary. A TOTAL map, with no inference.
 *
 * This used to read the request's optional fields and guess: `newBranch` only
 * when `baseRef` happened to be present, `existingBranch` otherwise. The
 * new-branch and existing-branch modes were indistinguishable on the wire, so
 * the ordinary create — a new branch, no base ref — became
 * `git worktree add <path> <branch>` against a branch nobody had made, and git
 * answered `fatal: invalid reference`. There is nothing left here to guess with.
 *
 * `reattach` and `adopt` are not `git worktree add` at all; they throw rather
 * than resolve, and WT-012.15 is where they get their own commands.
 */
function sourceOf(mode: WorktreeCreateMode): CreateSource {
  switch (mode.kind) {
    case "fresh":
      return {
        kind: "newBranch",
        branch: mode.branch,
        ...(mode.baseRef === undefined ? {} : { baseRef: mode.baseRef }),
      };
    case "fresh-detached":
      return { kind: "detached", ref: mode.baseRef };
    case "reuse":
      return { kind: "existingBranch", branch: mode.branch };
    case "reattach":
    case "adopt":
      throw new Error(`"${mode.kind}" is not a git worktree add; it has no CreateSource.`);
  }
}
