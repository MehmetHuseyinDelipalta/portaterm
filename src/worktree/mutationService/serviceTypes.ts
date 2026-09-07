// src/worktree/mutationService/serviceTypes.ts — What the mutation service is
// asked for, and every answer it can give.
//
// Extracted from `worktreeMutationService.ts` by change
// `decompose-mutation-service` (design.md D1, task 4_1). The types formed almost
// a third of the module, separating the five public verbs from the function
// that implements them.
//
// Re-exported from the original module so no importer moves (D4).

import type {
  WorktreeMutationCapabilities,
  WorktreeMutationTarget,
  WorktreeSurface,
} from "../../providers/WorktreeHost";
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
  WorktreeProvisionResultMessage,
} from "../../types/messages";
import type { AuthorizedDirectory } from "../../utils/authorizedDirectory";
import type { AdoptVerdict } from "../adoptProbe";
import type { AdoptRequest, AdoptResult } from "../adoptWorktree";
import type { ClearDebrisDeps } from "../clearDebris";
import type { CreatePathContext, CreatePathDeps } from "../createPath";
import type { DebrisAuthorizationStore, DebrisIssueResult } from "../debrisAuthorization";
import type { DeleteBranchOutcome } from "../deleteBranch";
import type { GitCommandRunner } from "../gitCommandRunner";
import type {
  MigrateChangesOutcome,
  MigrationOfferEvidence,
  MigrationRepositoryBinding,
  MigrationSourceEvidence,
} from "../migrateChanges";
import type { MutationCoordinator } from "../mutationCoordinator";
import type { ProvisionMaterial } from "../provisioning/provisionMaterial";
import type { ReattachVerdict } from "../reattachProbe";
import type { RemovalAssessment, RemovalEvidence } from "../worktreeBlockers";

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
 * the removal module's single `atRisk` predicate; the panel never chooses it
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
