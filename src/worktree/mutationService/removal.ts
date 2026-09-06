// src/worktree/mutationService/removal.ts — What removing a worktree would
// destroy, the confirmation that authorizes destroying it, and the removal
// itself.
//
// Extracted from `createWorktreeMutationService` by change
// `decompose-worktree-mutation-service` (design.md D1, D1a, task 1_2).
//
// The first draft of the cut kept `removeWorktree` in the facade and moved only
// the assessment members. The plan attack refuted it: five of the fingerprint
// store's nine reads are inside `removeWorktree`, so that split would have left
// one store with two owners across a module boundary — the exact leak this cut
// exists to remove. Assessment and removal are one responsibility.
//
// `withTarget` and `settled` are NOT this module's. Lock and unlock leave
// through the same wrapper, so it stays on the facade and arrives here as a
// dependency; a copy would give two verbs two different report stampings.

import type { WorktreeMutationTarget } from "../../providers/WorktreeHost";
import type { BranchDeleteRequest } from "../../types/messages";
import type { DeleteBranchOutcome } from "../deleteBranch";
import type { GitCommandRunner } from "../gitCommandRunner";
import type { MutationSettle } from "../mutationCoordinator";
import type { RemovalAssessment, RemovalEvidence } from "../worktreeBlockers";
import { createFingerprintStore } from "../worktreeFingerprint";
import type { MutationOutcome, MutationVerb, RemovalReport, ResolvedTarget } from "../worktreeMutationService";
import { classifyRemoval, type RemovalOutcome, removeWorktree as runRemoveWorktree } from "../worktreeMutations";
import { paths } from "./outcomes";

export interface RemovalDeps {
  runner: GitCommandRunner;
  resolve(target: WorktreeMutationTarget): ResolvedTarget | null;
  now(): number;
  assessRemoval(target: WorktreeMutationTarget): Promise<RemovalAssessment | null>;
  /** The rebuild generation. Read twice, and the removal is refused if it moved. */
  observation(repoId: string): number | undefined;
  observeAfter(
    target: WorktreeMutationTarget,
    journalledPath: string,
  ): Promise<{ isRegistered: boolean; existsOnDisk: boolean } | null>;
  deleteBranch?(repoPath: string, request: BranchDeleteRequest): Promise<DeleteBranchOutcome>;
  /** The facade's wrapper. Shared with lock and unlock, so never copied here. */
  withTarget(
    verb: MutationVerb,
    target: WorktreeMutationTarget,
    body: (resolved: ResolvedTarget, ctx: MutationSettle) => Promise<MutationOutcome>,
    missing?: () => Promise<MutationOutcome>,
  ): Promise<void>;
  runCoordinated<TResult>(
    repoId: string,
    step: {
      resolve(): Promise<ResolvedTarget | null>;
      missing?(): Promise<TResult>;
      body(target: ResolvedTarget, ctx: MutationSettle): Promise<TResult>;
    },
  ): Promise<TResult>;
}

export interface Removal {
  issueFingerprint(target: WorktreeMutationTarget, evidence: RemovalEvidence): string | null;
  assessRemovalReport(target: WorktreeMutationTarget): Promise<RemovalReport | null>;
  removeWorktree(
    target: WorktreeMutationTarget,
    fingerprint?: string,
    deleteBranchRequest?: BranchDeleteRequest,
  ): Promise<void>;
  /** The fingerprint half of the service's reconciliation (D1b). */
  forgetAbsent(present: ReadonlySet<string>): void;
}

/**
 * Whether an unforced `git worktree remove` would destroy something the user has
 * not been shown.
 *
 * Ignored material counts, and so does a walk that could not finish: git refuses
 * a dirty worktree itself and knows nothing about the `node_modules` and copied
 * `.env` this extension provisions, so "unforced ran straight to git" is exactly
 * how those get destroyed unannounced. An unmeasured amount is still an amount
 * the user has to be told about before an irreversible delete — confirmable
 * throughout, never a refusal (worktree-removal.md § 2.3).
 */
function atRisk(e: RemovalEvidence): boolean {
  return (
    e.dirtyPaths.length > 0 ||
    e.untrackedPaths.length > 0 ||
    e.paneIds.length > 0 ||
    e.externalSessionIds.length > 0 ||
    e.locked ||
    e.ignored.kind === "unproven" ||
    e.ignored.entries > 0
  );
}

/** A classified removal as the report the surface publishes. Indeterminate is a
 *  third answer, never folded into either of the other two. */
function asOutcome(verb: MutationVerb, repoId: string, outcome: RemovalOutcome): MutationOutcome {
  if (outcome.outcome === "ok") {
    return { kind: "ok", verb, repoId };
  }
  if (outcome.outcome === "error") {
    return { kind: "error", verb, repoId, message: outcome.message };
  }
  return { kind: "indeterminate", verb, repoId, observed: outcome.observed };
}

export function createRemoval(deps: RemovalDeps): Removal {
  const fingerprints = createFingerprintStore();

  /** The report itself, once the barrier above has fixed what it reads. */
  async function assess(target: WorktreeMutationTarget): Promise<RemovalReport | null> {
    const assessment = await deps.assessRemoval(target);
    if (assessment === null) {
      return null;
    }
    if (assessment.kind === "unavailable") {
      return { kind: "unavailable", unreadable: assessment.unreadable };
    }
    // A refusal carries no evidence BY CONSTRUCTION, so there is nothing to
    // bind a fingerprint to and nothing a forced removal could redeem — the
    // same null the blocked path already sends for one.
    if (assessment.kind === "refused") {
      return { kind: "assessed", assessment, fingerprint: null };
    }
    // Confirmation authority and Git force are orthogonal (D7). A clean report
    // still needs proof that the dialog it opened was answered; fresh evidence
    // later decides whether the resulting Git command needs force.
    return {
      kind: "assessed",
      assessment,
      fingerprint: fingerprints.issue({ worktreeId: target.worktreeId }, assessment.evidence, deps.now()),
    };
  }

  return {
    issueFingerprint(target, evidence) {
      const resolved = deps.resolve(target);
      if (resolved === null) {
        return null;
      }
      return fingerprints.issue({ worktreeId: target.worktreeId }, evidence, deps.now());
    },

    assessRemovalReport(target) {
      // Inside the coordinator, never `withTarget`: the barrier this read needs
      // and the mutation result `withTarget` publishes are separable, and only
      // the second is what D6 was right to avoid. Reading from the cache instead
      // let a rebuild still pending hand the predecessor's report the
      // replacement's evidence and removal authority (round-4 B3).
      return deps.runCoordinated<RemovalReport | null>(target.repoId, {
        resolve: async () => deps.resolve(target),
        // The other silent exit. The departure is only the user's answer while
        // the rebuild broadcasts it, and one whose presence projection rejects
        // publishes nothing at all (D12).
        missing: async () => ({ kind: "unavailable", unreadable: ["the worktree is no longer registered"] }),
        body: async () => assess(target),
      });
    },

    removeWorktree: (target, fingerprint, deleteBranchRequest?: BranchDeleteRequest) =>
      deps.withTarget(
        "remove",
        target,
        async (t, ctx) => {
          // Assessed on EVERY removal. A request with no fingerprint reports;
          // a request with one re-evaluates before it may execute. Git refuses a
          // dirty worktree itself, but idle panes and external sessions are not
          // Git's concern and would otherwise be destroyed unannounced.
          // EVERY confirmed exit spends the token, including the ones below that
          // never reach git. Returning `reprompt` without redeeming left it live
          // after an evidence-read failure, so the next message could retry a
          // removal that may already have run half-way (round-2 B5).
          const spend = (): void => {
            if (fingerprint !== undefined) {
              fingerprints.forget(target.worktreeId);
            }
          };

          // A throw is a forced exit too. Every `return` below spends the
          // token; an exception left it live, so the next message could retry a
          // removal whose git call may already have run (round-4 S1).
          // Taken BEFORE the assessment, so the window this closes covers the
          // whole of it as well as the handoff below (round-10 B8).
          const observed = deps.observation(target.repoId);
          const assessment = await deps.assessRemoval(target).catch((error: unknown) => {
            spend();
            throw error;
          });
          if (assessment === null) {
            spend();
            return {
              kind: "error",
              verb: "remove",
              repoId: target.repoId,
              message: "The worktree this action names could not be assessed.",
            };
          }
          if (assessment.kind === "unavailable") {
            spend();
            return { kind: "unavailable", verb: "remove", repoId: target.repoId, unreadable: assessment.unreadable };
          }
          if (assessment.kind === "refused") {
            spend();
            return {
              kind: "blocked",
              verb: "remove",
              repoId: target.repoId,
              worktreeId: target.worktreeId,
              assessment,
              fingerprint: null,
            };
          }

          if (fingerprint === undefined) {
            // A fingerprint-free request is an ask, never execution authority.
            // Every readable non-refused assessment therefore returns the report
            // and the one-shot token its dialog callback must send back (D7).
            return {
              kind: "blocked",
              verb: "remove",
              repoId: target.repoId,
              worktreeId: target.worktreeId,
              assessment,
              fingerprint: fingerprints.issue({ worktreeId: target.worktreeId }, assessment.evidence, deps.now()),
            };
          }

          const redemption = fingerprints.redeem(
            { worktreeId: target.worktreeId },
            fingerprint,
            assessment.evidence,
            deps.now(),
          );
          if (redemption.kind === "reprompt") {
            return {
              kind: "error",
              verb: "remove",
              repoId: target.repoId,
              message: "What is at risk here changed since you confirmed it. Please review it again.",
            };
          }
          const force = atRisk(assessment.evidence);
          const journal = {
            worktreePath: t.worktreePath,
            wasRegistered: t.wasRegistered,
            existedOnDisk: t.existedOnDisk,
          };
          // The last window, and the one every earlier check depends on: the
          // assessment validated its own observation, but this caller resumes
          // from an `await`, and a rebuild continuation already queued behind it
          // lands first. Asked here, synchronously, with nothing between this
          // line and the command — evidence gathered under one observation must
          // not authorize a command issued under another (round-10 B8).
          if (deps.observation(target.repoId) !== observed) {
            spend();
            return { kind: "unavailable", verb: "remove", repoId: target.repoId, unreadable: ["listing"] };
          }
          const { result, timedOut } = await runRemoveWorktree(deps.runner, {
            ...paths(t),
            force,
            locked: t.locked,
          });
          // The coordinator's own post-attempt rebuild, taken here rather than
          // added to: `classifyRemoval` compares against what the rebuild found,
          // and a third forced rebuild per removal was pure cost (round-3 W5).
          await ctx.settle();
          // The observation D15 names, made at the exact point it happens. The
          // host reconciles after every rebuild too (round-3 B5); this one stays
          // because a removal is where a stale token is most dangerous, and a
          // cache read is not a rebuild.
          if (deps.resolve(target) === null) {
            fingerprints.forget(target.worktreeId);
          }
          const removal = asOutcome(
            "remove",
            target.repoId,
            classifyRemoval({
              journal,
              timedOut,
              result,
              after: await deps.observeAfter(target, journal.worktreePath),
            }),
          );
          if (removal.kind !== "ok" || deleteBranchRequest === undefined) {
            return removal;
          }
          // The transaction's OIDs come from what was ISSUED with the
          // fingerprint (`redemption.approved`), never from a fresh
          // assessment and never from the caller's own claim — that is the
          // exact substitution the guard exists to prevent (design.md D10).
          const mergeEvidence = redemption.approved.proofs.mergeEvidence;
          if (
            mergeEvidence === undefined ||
            deleteBranchRequest.fingerprint !== fingerprint ||
            deleteBranchRequest.branch !== mergeEvidence.branch ||
            deleteBranchRequest.expectedBranchOid !== mergeEvidence.branchOid ||
            deleteBranchRequest.defaultBranch !== mergeEvidence.base ||
            deleteBranchRequest.expectedDefaultOid !== mergeEvidence.baseOid
          ) {
            // The opt-in authorizes only the offer echoed from THIS report.
            // Another report can replace the stored evidence while retaining
            // the same removal-risk fingerprint, so every field is part of the
            // consent binding even though none is trusted as Git evidence.
            return { ...removal, branchDelete: { kind: "refused", reason: "holders-unavailable" } };
          }
          const guardedRequest: BranchDeleteRequest = {
            branch: mergeEvidence.branch,
            expectedBranchOid: mergeEvidence.branchOid,
            defaultBranch: mergeEvidence.base,
            expectedDefaultOid: mergeEvidence.baseOid,
            fingerprint,
          };
          const branchDelete = await (
            deps.deleteBranch?.(t.repoPath, guardedRequest) ??
            Promise.resolve({ kind: "refused" as const, reason: "holders-unavailable" as const })
          ).catch(() => ({
            kind: "refused" as const,
            reason: "holders-unavailable" as const,
          }));
          return { ...removal, branchDelete };
        },
        // The id resolved to nothing on the far side of the forced rebuild, so
        // the worktree is already gone. That IS D15's observation, and it has to
        // spend the token here: the coordinator used to throw straight past the
        // body, leaving a live confirmation for whatever takes this location
        // next (round-3 B5).
        async () => {
          fingerprints.forget(target.worktreeId);
          return {
            kind: "error",
            verb: "remove",
            repoId: target.repoId,
            worktreeId: target.worktreeId,
            message: "That worktree is already gone.",
          };
        },
      ),

    forgetAbsent(present) {
      for (const worktreeId of fingerprints.worktreeIds()) {
        if (!present.has(worktreeId)) {
          fingerprints.forget(worktreeId);
        }
      }
    },
  };
}
