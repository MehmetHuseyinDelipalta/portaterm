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
import type { WorktreeMutationCapabilities, WorktreeMutationTarget, WorktreeSurface } from "../providers/WorktreeHost";
import type {
  BranchDeleteRequest,
  ProvisionEntry,
  ProvisionPort,
  ProvisionPortResult,
  ProvisionPortWarning,
  ProvisionSetupResult,
  ProvisionSetupStep,
  ProvisionStepResult,
  WorktreeAfterCreate,
  WorktreeCreateMode,
  WorktreeProvisionResultMessage,
} from "../types/messages";
import type { AuthorizedDirectory } from "../utils/authorizedDirectory";
import { provesAbsence } from "../utils/fsPresence";
import { normalizePathForCompare } from "../utils/pathBoundary";
import type { AdoptVerdict } from "./adoptProbe";
import type { AdoptRequest, AdoptResult } from "./adoptWorktree";
import { type ClearDebrisDeps, clearDebris, nodeClearDebrisDeps } from "./clearDebris";
import { type CreatePathContext, type CreatePathDeps, identityOf, intentFor, validateCreatePath } from "./createPath";
import {
  createDebrisAuthorizationStore,
  type DebrisAuthorizationStore,
  type DebrisIssueResult,
} from "./debrisAuthorization";
import type { DeleteBranchOutcome } from "./deleteBranch";
import { messageOf } from "./errorMessage";
import type { GitCommandRunner } from "./gitCommandRunner";
import { excludePatternFor } from "./gitExclude";
import type {
  MigrateChangesOutcome,
  MigrationOfferEvidence,
  MigrationRepositoryBinding,
  MigrationSourceEvidence,
} from "./migrateChanges";
import { createMutationCoordinator, type MutationCoordinator, type MutationSettle } from "./mutationCoordinator";
import { createMutationQueue } from "./mutationQueue";
import { paths, settled } from "./mutationService/outcomes";
import { createRegisterExisting } from "./mutationService/registerExisting";
import { createRemoval } from "./mutationService/removal";
import { createSetupExecution, type PendingSetupRetry } from "./mutationService/setupExecution";
import { disposeProvisionMaterials, type ProvisionMaterial, provisionEntryOf } from "./provisioning/provisionMaterial";
import type { ReattachVerdict } from "./reattachProbe";
import type { RemovalAssessment, RemovalEvidence } from "./worktreeBlockers";
import {
  branchNameIsValid,
  type CreateSource,
  createWorktree,
  lockWorktree,
  pruneRepo,
  unlockWorktree,
} from "./worktreeMutations";

/**
 * What an id names once the tree has been rebuilt.
 *
 * `incarnation` is what does NOT survive a remove-and-recreate at the same
 * path — the registration's admin directory, or failing that its head. It is
 * what binds a confirmation to a thing rather than to a location (round-1 B5).
 */
export interface ResolvedTarget {
  repoPath: string;
  worktreePath: string;
  incarnation: string;
  locked: boolean;
  wasRegistered: boolean;
  existedOnDisk: boolean;
}

/**
 * Which scope a notice attaches to. Present for the worktree-scoped verbs and
 * absent for `create` and `prune`, which act on a repository and have no single
 * worktree to hang a result on.
 */
export type MutationOutcome =
  | {
      kind: "ok";
      verb: MutationVerb;
      repoId: string;
      worktreeId?: string;
      openTerminalAt?: string;
      /**
       * The action succeeded and the thing it was asked to do AFTERWARDS did
       * not. Reported on the success rather than as a second outcome, because
       * a follow-up notice sharing this one's scope replaces it (round-4 W7).
       */
      openFailed?: string;
      /** The optional branch action runs only after the removal itself succeeded. */
      branchDelete?: DeleteBranchOutcome;
      /**
       * What provisioning did, per entry and selected port, and the worktree it did it in.
       *
       * Rides the create's OWN outcome so ordering is structural: the create is
       * reported first and this follows it. Provisioning never decides whether
       * the create succeeded (worktree-apply.md § 1).
       */
      provision?: {
        path: string;
        steps: readonly ProvisionStepResult[];
        ports: readonly ProvisionPortResult[];
        portWarnings?: readonly ProvisionPortWarning[];
        setup?: readonly ProvisionSetupResult[];
        setupOutputId?: string;
        setupRetryId?: string;
        manifestWarning?: string;
      };
      /** The checkout exists, but migration could not establish where all source work ended up. */
      migrationIndeterminate?: string;
    }
  /**
   * Something is at risk, so the removal has NOT run and is waiting on a
   * confirmation — or can never get one.
   *
   * `fingerprint` is null exactly when the assessment refuses, which is what
   * makes a force against a refusal unrepresentable rather than merely checked.
   */
  | {
      kind: "blocked";
      verb: "remove";
      repoId: string;
      worktreeId: string;
      /** Never `unavailable`: an unreadable assessment is its own outcome. */
      assessment: Exclude<RemovalAssessment, { kind: "unavailable" }>;
      fingerprint: string | null;
    }
  | { kind: "unavailable"; verb: MutationVerb; repoId: string; worktreeId?: string; unreadable: readonly string[] }
  | { kind: "error"; verb: MutationVerb; repoId: string; worktreeId?: string; message: string }
  | { kind: "indeterminate"; verb: MutationVerb; repoId: string; worktreeId?: string; observed: string };

export type MutationVerb = "create" | "remove" | "lock" | "unlock" | "prune";

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

function migrationReasonOf(error: unknown): string {
  try {
    const text = error instanceof Error ? error.message : String(error);
    return text.trim().slice(0, 1_000) || "the Git integration did not complete the migration";
  } catch {
    return "the Git integration did not complete the migration";
  }
}

/** The fields of a worktree record that answer D3's conditions 1 and 4. */
export interface RepairListingRecord {
  displayPath: string;
  branch?: string;
  prunable: boolean;
}

export interface SetupExecutionInput {
  readonly repoId: string;
  readonly mainPath: string;
  readonly worktreeId: string;
  readonly worktreePath: string;
  readonly branch: string;
  readonly steps: readonly ProvisionSetupStep[];
  readonly asimovEnvironment: boolean;
  readonly ports: Readonly<Record<string, number>>;
  readonly authorization: AuthorizedDirectory;
}

export interface SetupExecutionOutcome {
  readonly steps: readonly ProvisionSetupResult[];
  readonly succeeded: boolean;
  readonly outputId?: string;
}

export interface MutationServiceDeps {
  /**
   * Materialize the host-resolved provenance-bearing inputs, and answer per entry.
   *
   * Optional: a host without it provisions nothing, which is every caller that
   * existed before this. Its rejection is caught at the call site — the create
   * has already succeeded by then, and nothing provisioning does may change
   * that (design.md D1).
   */
  authorizeDirectory(path: string): Promise<AuthorizedDirectory | undefined>;
  applyProvision?(
    mainCheckout: string,
    worktreePath: string,
    materials: readonly ProvisionMaterial[],
    authorization: { readonly source: AuthorizedDirectory; readonly destination: AuthorizedDirectory },
  ): Promise<readonly ProvisionStepResult[]>;
  provisionUnavailable?(
    worktreePath: string,
    entries: readonly ProvisionEntry[],
    reason: string,
  ): readonly ProvisionStepResult[];
  applyPorts?(input: {
    repoId: string;
    repoPath: string;
    worktreePath: string;
    ports: readonly ProvisionPort[];
    authorization: AuthorizedDirectory;
  }): Promise<{ ports: readonly ProvisionPortResult[]; warnings: readonly ProvisionPortWarning[] }>;
  runSetup?(input: SetupExecutionInput, origin?: WorktreeSurface): Promise<SetupExecutionOutcome>;
  writeProvisionManifest?(
    worktreePath: string,
    steps: readonly ProvisionStepResult[],
    ports: readonly ProvisionPortResult[],
    setup: readonly ProvisionSetupResult[],
  ): Promise<{ readonly warning?: string }>;
  /** Setup-only retries report without emitting another create mutation notice. */
  reportProvisioning?(outcome: WorktreeProvisionResultMessage, origin?: WorktreeSurface): void;
  /** Retire the prior output capability as soon as a valid retry spends its token. */
  retireSetupOutput?(worktreeId: string): void;
  /** Injectable so retry capabilities are deterministic in tests. */
  newSetupRetryId?(): string;

  /**
   * The identity the TREE gives a worktree path — `WorktreeInfo.id`.
   *
   * Optional for the same reason `applyProvision` is: a caller without it
   * reports the resolved path, which is what every caller did before. Answers
   * null for a path it cannot normalize, and the path is used then.
   */
  normalizeWorktreeId?(worktreePath: string): Promise<string | null>;
  /** The migration registration paired with the currently published generation. */
  migrationRegistration?(repoId: string): MigrationRepositoryBinding["registration"] | undefined;

  /** Capture the checkout registration observed immediately after Git creates it. */
  captureMigrationDestination?(
    repoId: string,
    destinationPath: string,
    registration: MigrationRepositoryBinding["registration"],
  ): Promise<MigrationSourceEvidence | undefined>;
  /** Move host-authorized source work after checkout creation and before every later step. */
  migrateChanges?(input: {
    readonly sourcePath: string;
    readonly destinationPath: string;
    readonly source: MigrationOfferEvidence["source"];
    readonly destination: MigrationSourceEvidence;
    readonly snapshot: MigrationOfferEvidence["snapshot"];
    readonly binding: MigrationRepositoryBinding;
  }): Promise<MigrateChangesOutcome>;

  /** Delete the requested branch only after the worktree removal is known to have succeeded. */
  deleteBranch?(repoPath: string, request: BranchDeleteRequest): Promise<DeleteBranchOutcome>;

  runner: GitCommandRunner;
  /**
   * Force a rebuild of `repoId` and wait for it. The coordinator calls this
   * before resolving and again after every attempt, so resolution never reads a
   * cache the previous mutation invalidated (design.md D12).
   */
  forceRebuild(repoId: string): Promise<void>;
  /** What `worktreeId` names in the CURRENT tree, or null once it is gone. */
  resolve(target: WorktreeMutationTarget): ResolvedTarget | null;
  /** The repository's own path, for the repo-scoped verbs. */
  repoPath(repoId: string): string | null;
  /**
   * The blocker assessment a removal is judged against, re-read at execution.
   *
   * A `refused` assessment carries no evidence BY CONSTRUCTION, which is what
   * makes a force against one unrepresentable rather than merely checked.
   */
  assessRemoval(target: WorktreeMutationTarget): Promise<RemovalAssessment | null>;
  /**
   * The observation the tree currently holds of this repository (design.md D12).
   *
   * Synchronous by contract: the coordinator asks it immediately before it
   * issues a destructive command, and an `await` in there would reopen the very
   * window the question exists to close (round-10 B8).
   */
  observation(repoId: string): number | undefined;
  /**
   * What the rebuilt tree and the filesystem say about the target NOW.
   *
   * Two independent readings, not one: D11 turns on registration and directory
   * disagreeing, so a single "is it still resolvable" answer cannot produce the
   * comparison. `null` when the rebuild could not obtain a listing at all,
   * which is itself indeterminate.
   */
  observeAfter(
    target: WorktreeMutationTarget,
    /** The path recorded BEFORE the spawn. The only path worth statting. */
    journalledPath: string,
  ): Promise<{ isRegistered: boolean; existsOnDisk: boolean } | null>;
  /** Where a create may go, and what already occupies this repo. */
  createContext(repoId: string): CreatePathContext | null;
  pathDeps: CreatePathDeps;
  /**
   * Re-establish D3's conditions 2 and 3 at the mutation, through the SAME
   * probe that offered the repair.
   *
   * Injected rather than reimplemented so the offer and the mutation cannot
   * disagree about what was checked — a second hand-rolled copy of the link and
   * HEAD reads is how they would drift (round-1 B1).
   */
  corroborateRepair(input: { repoPath: string; branch: string; repairPath: string }): Promise<ReattachVerdict>;
  /**
   * D5's re-probe, through the SAME probe that offered the adoption.
   *
   * The user's decision sits between the offer and this mutation, and an
   * administrative entry restored inside that window is a registration this
   * adoption would otherwise overwrite — whatever branch it names.
   */
  corroborateAdopt(input: { candidatePath: string; commonDir: string }): Promise<AdoptVerdict>;
  /**
   * Reconstruct the administrative entry, and hand back its undo.
   *
   * Injected rather than called directly so every failure inside it — and every
   * failure of its own undo — is witnessable from this module's tests, which is
   * where the guards that call the undo live.
   */
  reconstructEntry(request: AdoptRequest): Promise<AdoptResult>;
  /**
   * The repository's worktrees, from the listing that negotiates `-z`.
   *
   * `null` when no listing could be obtained, which is indeterminate rather
   * than "nothing is registered". D3's conditions 1 and 4 both read this, and
   * they must read it the same way the offer did (round-1 W5).
   */
  listWorktrees(repoPath: string): Promise<readonly RepairListingRecord[] | null>;
  /** Report an outcome to the surface that started it (D17). */
  report(outcome: MutationOutcome, origin?: WorktreeSurface): void;
  /**
   * Everything this action should do once git has succeeded.
   *
   * Takes the whole `WorktreeAfterCreate` rather than a mode plus an optional
   * payload: the launch details live on the `agent` variant, and splitting them
   * apart here would recreate the "does this pairing make sense" question the
   * union exists to answer. `origin` is the surface that asked — only a surface
   * can hold the session a launch creates. A rejection here is the create's
   * `openFailed`, never the create's failure.
   */
  afterCreate(path: string, after: WorktreeAfterCreate, origin?: WorktreeSurface): Promise<void>;
  /** The `.git` dir whose `info/exclude` needs the entry, or null (D8). */
  /**
   * The `.git` directory whose `info/exclude` should hide `createdPath`, plus
   * that path relative to the repository. `null` when the worktree was not
   * created inside the repository, which is the ordinary case.
   *
   * The RELATIVE path is what comes back because `info/exclude` patterns are
   * repo-root-relative; the absolute one this used to pass matched nothing at
   * all, so D8 had never taken effect (round-3 B10).
   */
  gitExcludeDirFor(
    repoId: string,
    repoPath: string,
    createdPath: string,
  ): { gitDir: string; relativePath: string } | null;
  /** The narrow selected-source rule required before migration, if the destination is nested there. */
  migrationGitExcludeDirFor(
    repoId: string,
    sourcePath: string,
    createdPath: string,
  ): { gitDir: string; relativePath: string } | null;
  addToGitExclude(gitDir: string, entry: string): Promise<void>;
  now(): number;
  /** Authorizations for clearing crash debris — the create path's own store (design.md D2). */
  debrisAuthorizations?: DebrisAuthorizationStore;
  /** How a cleared destination is actually removed. Production takes the module default. */
  clearDebrisDeps?: ClearDebrisDeps;
  coordinator?: MutationCoordinator;
}

/**
 * What a removal WOULD cost, and what answering the report is worth.
 *
 * Every readable non-refused report carries a fingerprint authorizing one
 * confirmed attempt. Git's force mode is derived later from fresh evidence by
 * the same module's single `atRisk` predicate; the panel never chooses it
 * (design.md D7).
 */
export type RemovalReport =
  | {
      kind: "assessed";
      assessment: Exclude<RemovalAssessment, { kind: "unavailable" }>;
      fingerprint: string | null;
    }
  | { kind: "unavailable"; unreadable: readonly string[] };

export interface WorktreeMutationService extends WorktreeMutationCapabilities {
  /** Spend one rotating capability to repeat setup only for the same live worktree. */
  retrySetup(target: WorktreeMutationTarget, retryId: string): Promise<void>;
  /** Issue the confirmation token for what the user is about to be shown. */
  issueFingerprint(target: WorktreeMutationTarget, evidence: RemovalEvidence): string | null;
  /**
   * Assess a removal WITHOUT performing it. Reads only; deletes nothing.
   *
   * The reason this exists at all: the only other way to obtain a report is the
   * `blocked` outcome, which this module produces BY ATTEMPTING THE REMOVAL. So
   * a worktree with nothing at risk fell straight through to git and was deleted
   * having never been reported (round-3 B1).
   *
   * Runs behind the same forced-rebuild barrier a mutation takes, so the report
   * describes the registration the confirmation will act on rather than whatever
   * the cache still held (D10). An id the barrier finds gone answers
   * `unavailable`, not silence (D12); `null` is left for an assessment the
   * capability itself declined, where there is nothing to report.
   */
  assessRemovalReport(target: WorktreeMutationTarget): Promise<RemovalReport | null>;
  /**
   * Issue a clearance authorization for `path`, or say why there is none.
   *
   * Discriminated rather than nullable: "this holds a repository" and "this
   * could not be read" are different answers, and collapsing them told a user
   * whose permissions failed that their directory holds a repository
   * (round-1 W1).
   *
   * Lives here because the store it writes to is the one the create redeems
   * against — an issuer anywhere else would mint tokens nothing could spend.
   */
  issueDebrisAuthorization(path: string): Promise<DebrisIssueResult>;
}

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
  const { executeSetup, writeManifest, failedSetup, portEnvironment } = setup;
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
      // Reported after the create's own outcome, never in place of it: the
      // worktree exists whether or not a window opened (round-3 W7).
      let openFailure: string | null = null;

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
            const wanted = request.provision ?? [];
            const wantedEntries = wanted.map(provisionEntryOf);
            const wantedPorts = request.ports ?? [];
            const wantedSetup = request.setup ?? [];
            const migrationIndeterminate = async (reason: string): Promise<MutationOutcome> => ({
              kind: "ok",
              verb: "create",
              repoId: request.repoId,
              worktreeId: (await deps.normalizeWorktreeId?.(check.path).catch(() => null)) ?? check.path,
              migrationIndeterminate: reason.slice(0, 1_000),
            });
            let destinationEvidence: MigrationSourceEvidence | undefined;
            if (request.migration !== undefined) {
              if (deps.captureMigrationDestination === undefined) {
                return migrationIndeterminate("migration destination authorization is unavailable in this window");
              }
              try {
                destinationEvidence = await deps.captureMigrationDestination(
                  request.repoId,
                  check.path,
                  request.migration.binding.registration,
                );
              } catch (error) {
                return migrationIndeterminate(
                  `the migration destination registration could not be verified: ${migrationReasonOf(error)}`,
                );
              }
              if (destinationEvidence === undefined) {
                return migrationIndeterminate("the migration destination registration could not be verified");
              }
            }

            const writtenExclusions = new Set<string>();
            const writeExclusion = async (
              exclusion: { gitDir: string; relativePath: string } | null,
              critical: boolean,
            ): Promise<MutationOutcome | undefined> => {
              if (exclusion === null) {
                return undefined;
              }
              const pattern = excludePatternFor(exclusion.relativePath);
              const key = `${normalizePathForCompare(exclusion.gitDir)}\0${pattern}`;
              if (writtenExclusions.has(key)) {
                return undefined;
              }
              try {
                await deps.addToGitExclude(exclusion.gitDir, pattern);
                writtenExclusions.add(key);
                return undefined;
              } catch (error) {
                return critical
                  ? migrationIndeterminate(
                      `the selected-source destination exclusion could not be established: ${migrationReasonOf(error)}`,
                    )
                  : undefined;
              }
            };

            if (request.migration !== undefined) {
              const exclusionFailure = await writeExclusion(
                deps.migrationGitExcludeDirFor(request.repoId, request.migration.sourcePath, check.path),
                true,
              );
              if (exclusionFailure !== undefined) {
                return exclusionFailure;
              }
            }
            await writeExclusion(deps.gitExcludeDirFor(request.repoId, repoPath, check.path), false);

            if (request.migration !== undefined && destinationEvidence !== undefined) {
              const migration =
                deps.migrateChanges === undefined
                  ? ({ kind: "indeterminate", reason: "migration is unavailable in this window" } as const)
                  : await deps
                      .migrateChanges({
                        sourcePath: request.migration.sourcePath,
                        destinationPath: check.path,
                        source: request.migration.source,
                        destination: destinationEvidence,
                        snapshot: request.migration.snapshot,
                        binding: request.migration.binding,
                      })
                      .catch((error) => ({ kind: "indeterminate" as const, reason: migrationReasonOf(error) }));
              if (migration.kind === "indeterminate") {
                return migrationIndeterminate(migration.reason);
              }
            }
            let sourceAuthorization: AuthorizedDirectory | undefined;
            let destinationAuthorization: AuthorizedDirectory | undefined;
            if (wanted.length > 0) {
              [sourceAuthorization, destinationAuthorization] = await Promise.all([
                deps.authorizeDirectory(repoPath).catch(() => undefined),
                deps.authorizeDirectory(check.path).catch(() => undefined),
              ]);
            } else {
              destinationAuthorization = await deps.authorizeDirectory(check.path).catch(() => undefined);
            }
            // BEFORE afterCreate, which launches an agent or a terminal INTO
            // this worktree: the whole point of copying `.env` is that whatever
            // starts here can read it (design.md D1).
            //
            // Inside its own catch, exactly like afterCreate's below. Without
            // one, a rejection reaches this body's outer arm and reports a
            // SUCCESSFUL git create as a create error — the defect the plan
            // attack found by reading that arm rather than this line.
            let provisioned: readonly ProvisionStepResult[] | undefined;
            let allocatedPorts: readonly ProvisionPortResult[] | undefined;
            let setupOutcome: SetupExecutionOutcome | undefined;
            let portWarnings: readonly ProvisionPortWarning[] = [];
            let manifestWarning: string | undefined;
            let provisionedAt: string | undefined;
            if (wanted.length > 0) {
              const failed = (reason: string): readonly ProvisionStepResult[] =>
                wantedEntries.map((entry) => ({
                  id: entry.id,
                  path: entry.path,
                  outcome: { kind: "failed" as const, reason },
                }));
              const unavailableReason =
                destinationAuthorization === undefined
                  ? "the worktree could not be read after it was created"
                  : "the main checkout could not be read after the worktree was created";
              provisioned =
                sourceAuthorization === undefined || destinationAuthorization === undefined
                  ? (deps.provisionUnavailable?.(check.path, wantedEntries, unavailableReason) ??
                    failed(unavailableReason))
                  : deps.applyProvision === undefined
                    ? // A host with no binding cannot provision, but it CAN say so.
                      // Dropping the selection produced an outcome byte-identical
                      // to "the user selected nothing", which is the one answer
                      // nobody can tell from the truth (round-1 F009).
                      failed("this window cannot bring files over")
                    : await deps
                        .applyProvision(repoPath, check.path, wanted, {
                          source: sourceAuthorization,
                          destination: destinationAuthorization,
                        })
                        .catch((error) => failed(messageOf(error)));
            }
            if (wantedPorts.length > 0) {
              const failed = (reason: string): readonly ProvisionPortResult[] =>
                wantedPorts.map((port) => ({
                  id: port.id,
                  name: port.name,
                  ...(port.port === undefined ? {} : { preview: port.port }),
                  outcome: { kind: "failed" as const, reason },
                }));
              const applied =
                destinationAuthorization === undefined
                  ? { ports: failed("the worktree identity could not be verified after creation"), warnings: [] }
                  : deps.applyPorts === undefined
                    ? { ports: failed("this window cannot allocate ports"), warnings: [] }
                    : await deps
                        .applyPorts({
                          repoId: request.repoId,
                          repoPath,
                          worktreePath: check.path,
                          ports: wantedPorts,
                          authorization: destinationAuthorization,
                        })
                        .catch((error) => ({ ports: failed(messageOf(error)), warnings: [] }));
              allocatedPorts = applied.ports;
              portWarnings = applied.warnings;
            }
            // Every fresh create owns a manifest, including a truthful empty one.
            // Use the id the tree will key this worktree on, not the path git was handed.
            provisionedAt = (await deps.normalizeWorktreeId?.(check.path).catch(() => null)) ?? check.path;

            const launch = async (): Promise<void> => {
              await deps.afterCreate(check.path, request.afterCreate, request.origin).catch((error: unknown) => {
                const reason = messageOf(error);
                openFailure = request.afterCreate.kind === "agent" ? `Agent did not start: ${reason}` : reason;
              });
            };

            if (wantedSetup.length > 0) {
              const run =
                destinationAuthorization !== undefined && provisionedAt !== undefined
                  ? executeSetup(
                      {
                        repoId: request.repoId,
                        mainPath: repoPath,
                        worktreeId: provisionedAt,
                        worktreePath: check.path,
                        branch: setupBranch(request.mode),
                        steps: wantedSetup,
                        asimovEnvironment: request.asimovEnvironment ?? false,
                        ports: portEnvironment(allocatedPorts ?? []),
                        authorization: destinationAuthorization,
                      },
                      request.origin,
                    )
                  : Promise.resolve({
                      steps: failedSetup(wantedSetup, "the worktree identity could not be verified after creation"),
                      succeeded: false,
                    });
              if (request.afterCreate.kind === "agent" && request.afterCreate.waitForSetup) {
                // The choice is ORDER, not permission: "wait for setup to finish
                // before starting the agent" is what the checkbox says, and a
                // failed step is exactly when the user wants the agent there to
                // look at it. Gating the launch on success stranded the create
                // with nothing running in it and no way forward but a retry.
                setupOutcome = await run;
                await launch();
              } else {
                const launchPromise = launch();
                setupOutcome = await run;
                await launchPromise;
              }
            } else {
              await launch();
            }

            const setupResults = setupOutcome?.steps ?? [];
            if (provisionedAt !== undefined) {
              manifestWarning = await writeManifest(check.path, provisioned ?? [], allocatedPorts ?? [], setupResults);
              if (!setupOutcome?.succeeded && destinationAuthorization !== undefined && wantedSetup.length > 0) {
                pendingSetupRetry = {
                  repoId: request.repoId,
                  worktreeId: provisionedAt,
                  worktreePath: check.path,
                  mainPath: repoPath,
                  branch: setupBranch(request.mode),
                  steps: wantedSetup,
                  asimovEnvironment: request.asimovEnvironment ?? false,
                  ports: portEnvironment(allocatedPorts ?? []),
                  authorization: destinationAuthorization,
                  materialized: provisioned ?? [],
                  portResults: allocatedPorts ?? [],
                };
              }
            }
            return {
              kind: "ok",
              verb: "create",
              repoId: request.repoId,
              ...(openFailure === null ? {} : { openFailed: openFailure }),
              // A repair provisions nothing, so this rides the create branch only:
              // a reattach rewrites a link to a directory git already registered.
              //
              // The id travels WITH the steps, on one outcome. Without it the
              // create notice carried no `worktreeId` at all, so the merge key
              // the provisioning message arrives under matched nothing and every
              // real create grew a second, invented notice (round-2 F017).
              ...(provisionedAt === undefined
                ? {}
                : {
                    worktreeId: provisionedAt,
                    provision: {
                      path: provisionedAt,
                      steps: provisioned ?? [],
                      ports: allocatedPorts ?? [],
                      ...(portWarnings.length === 0 ? {} : { portWarnings }),
                      ...(setupOutcome === undefined ? {} : { setup: setupOutcome.steps }),
                      ...(setupOutcome?.outputId === undefined ? {} : { setupOutputId: setupOutcome.outputId }),
                      ...(manifestWarning === undefined ? {} : { manifestWarning }),
                    },
                  }),
              // Only a SURFACE can open a terminal — it needs a view id and a
              // webview (D2). The host performs it on the origin.
              ...(request.afterCreate.kind === "terminal" ? { openTerminalAt: check.path } : {}),
            };
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

function setupBranch(mode: WorktreeCreateMode): string {
  switch (mode.kind) {
    case "fresh":
    case "reuse":
      return mode.branch;
    case "fresh-detached":
      return mode.baseRef;
    case "reattach":
      return mode.branch;
    case "adopt":
      return mode.branch;
  }
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
