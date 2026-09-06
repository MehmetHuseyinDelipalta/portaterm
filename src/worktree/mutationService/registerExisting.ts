// src/worktree/mutationService/registerExisting.ts — The two creates that create
// nothing: re-registering a surviving checkout git forgot, and repairing one
// whose administrative entry went stale.
//
// Extracted from `createWorktreeMutationService`'s `createWorktree` by change
// `decompose-worktree-mutation-service` (design.md D1, D2, task 1_3). Both
// branches sat inside create-proper's closure and left before its create-path
// check, so the thing they have in common — neither runs `git worktree add`, and
// each re-establishes at the mutation what a probe established at the offer —
// was only visible by reading past two hundred lines of a create they never
// reach.
//
// The debris guard comes with them, and stays FIRST. OBL-2's defeater is the
// guard moving past the corroboration: the reported message is identical either
// way, so its witness is that the corroboration dependency was never called.
//
// `fail` is passed in rather than rebuilt. It stamps `verb: "create"` and the
// request's repo, and a second copy here would be a second answer to what a
// failed registration is called.

import type { WorktreeMutationCapabilities, WorktreeSurface } from "../../providers/WorktreeHost";
import type { WorktreeCreateMode } from "../../types/messages";
import { normalizePathForCompare } from "../../utils/pathBoundary";
import type { AdoptVerdict } from "../adoptProbe";
import type { AdoptRequest, AdoptResidue, AdoptResult } from "../adoptWorktree";
import type { CreatePathDeps } from "../createPath";
import { messageOf } from "../errorMessage";
import type { GitCommandRunner } from "../gitCommandRunner";
import type { ReattachVerdict } from "../reattachProbe";
import type { MutationOutcome, RepairListingRecord } from "../worktreeMutationService";
import { repairWorktree } from "../worktreeMutations";
import { settled } from "./outcomes";

/** The request the host publishes, taken from the capability rather than restated. */
type CreateRequest = Parameters<WorktreeMutationCapabilities["createWorktree"]>[0];

type AdoptMode = Extract<WorktreeCreateMode, { kind: "adopt" }>;
type ReattachMode = Extract<WorktreeCreateMode, { kind: "reattach" }>;

/** How a failed registration is named. Create-proper's, never rebuilt here. */
export type FailOutcome = (message: string) => MutationOutcome;

export interface RegisterExistingDeps {
  runner: GitCommandRunner;
  repoPath(repoId: string): string | null;
  pathDeps: CreatePathDeps;
  listWorktrees(repoPath: string): Promise<readonly RepairListingRecord[] | null>;
  corroborateAdopt(input: { candidatePath: string; commonDir: string }): Promise<AdoptVerdict>;
  corroborateRepair(input: { repoPath: string; branch: string; repairPath: string }): Promise<ReattachVerdict>;
  reconstructEntry(request: AdoptRequest): Promise<AdoptResult>;
  afterCreate(path: string, after: CreateRequest["afterCreate"], origin?: WorktreeSurface): Promise<void>;
  report(outcome: MutationOutcome, origin?: WorktreeSurface): void;
  /** The facade's coordinator, resolving the repo path the branch runs against. */
  runCoordinated(
    repoId: string,
    step: { resolve(): Promise<string | null>; body(repoPath: string): Promise<MutationOutcome> },
  ): Promise<MutationOutcome>;
}

export interface RegisterExisting {
  adopt(request: CreateRequest, mode: AdoptMode, fail: FailOutcome): Promise<void>;
  reattach(request: CreateRequest, mode: ReattachMode, fail: FailOutcome): Promise<void>;
}

/** The record for this exact path and branch, or undefined when the listing has none. */
async function recordFor(
  records: readonly RepairListingRecord[],
  repairPath: string,
  branch: string,
  normalize: (raw: string) => Promise<string | null>,
): Promise<RepairListingRecord | undefined> {
  const target = normalizePathForCompare(repairPath);
  let found: RepairListingRecord | undefined;
  for (const record of records) {
    if (record.branch !== branch) {
      continue;
    }
    const resolved = await normalize(record.displayPath);
    if (resolved === null || normalizePathForCompare(resolved) !== target) {
      continue;
    }
    // Two records for one path and branch is a listing nobody can reason about,
    // and picking one would be a guess. Answered as "no record" so the caller
    // fails closed rather than repairing against an ambiguous identity — and
    // answered on the SECOND, rather than by collecting every match first
    // (round-4 S1).
    if (found !== undefined) {
      return undefined;
    }
    found = record;
  }
  return found;
}

/** Whether the listing still carries the stale registration a repair was offered for. */
async function holdsStaleRegistration(
  records: readonly RepairListingRecord[],
  repairPath: string,
  branch: string,
  normalize: (raw: string) => Promise<string | null>,
): Promise<boolean> {
  const target = normalizePathForCompare(repairPath);
  for (const record of records) {
    if (!record.prunable || record.branch !== branch) {
      continue;
    }
    const resolved = await normalize(record.displayPath);
    if (resolved !== null && normalizePathForCompare(resolved) === target) {
      return true;
    }
  }
  return false;
}

/**
 * The live worktree holding this branch somewhere OTHER than the adopted path,
 * or undefined when none does.
 *
 * Prunable records are excluded on the same rule the resolution follows: a
 * registration git itself calls stale is not a claim on the branch. The adopted
 * path is excluded because after the reconstruction it is the holder, and the
 * post-read asks this same question again.
 */
async function liveHolderOf(
  records: readonly RepairListingRecord[],
  branch: string,
  adoptPath: string,
  normalize: (raw: string) => Promise<string | null>,
): Promise<string | undefined> {
  const target = normalizePathForCompare(adoptPath);
  for (const record of records) {
    if (record.prunable || record.branch !== branch) {
      continue;
    }
    const resolved = await normalize(record.displayPath);
    if (resolved === null || normalizePathForCompare(resolved) !== target) {
      return record.displayPath;
    }
  }
  return undefined;
}

/** Why a re-corroborated adoption was refused, in the user's terms. */
function adoptDeclineReason(verdict: AdoptVerdict): string {
  if (verdict.kind !== "declined") {
    return "That directory is registered with git again, so it is no longer the forgotten checkout that was offered.";
  }
  switch (verdict.because) {
    case "unreadable":
      return "That directory's git link could not be read, so nothing was re-registered.";
    case "anotherRepository":
      return "That directory was a worktree of another repository, so it was not re-registered here.";
    default:
      return "That directory is registered with git again, so it is no longer the forgotten checkout that was offered.";
  }
}

/** What an undo could not put back, said rather than folded into a plain failure. */
function residueNote(residue: AdoptResidue | undefined, adoptPath: string): string {
  if (residue === undefined) {
    return "";
  }
  // Three states, and the third is the one that must never read as a clean
  // failure: the claim write began and the bytes that were there could not be
  // put back, so `<wt>/.git` names nothing anybody can act on. It is reported
  // whether or not an entry was left behind (round-3 F012).
  //
  // `entryPath` is non-null only where the withdrawal could not hand the entry
  // to git — it could not empty the entry's `gitdir`, or could not prove the
  // entry was still its own. An entry it DID hand over is not mentioned: git
  // collects it and there is nothing for a person to do (round-7 F005).
  const link =
    residue.link === "restored"
      ? "its own .git entry was restored"
      : residue.link === "leftAsFound"
        ? "its .git entry now names something else and was left as found"
        : `the .git entry in ${adoptPath} could not be left in a known state`;
  return residue.entryPath === null
    ? ` The ${link}.`
    : ` The administrative entry at ${residue.entryPath} could not be handed back to git, and ${link}.`;
}

/** Why a re-corroborated repair was refused, in the user's terms. */
function declineReason(verdict: ReattachVerdict): string {
  if (verdict.kind === "adopt") {
    return "That worktree's administrative entry is gone, so it can no longer be repaired in place.";
  }
  if (verdict.kind === "declined" && verdict.because === "unreadable") {
    return "That directory's git link could not be read, so nothing was repaired.";
  }
  if (verdict.kind === "declined" && verdict.because === "notALinkedWorktree") {
    return "That directory is no longer a linked worktree, so nothing was repaired.";
  }
  return "That checkout has moved since it was inspected. Nothing was changed; please try again.";
}

export function createRegisterExisting(deps: RegisterExistingDeps): RegisterExisting {
  return {
    adopt(request, mode, fail) {
      // BEFORE the branch, on the rule the repair below follows: a clearance
      // carried into an adoption would report a successful re-registration
      // while the directory it promised to clear is the one just adopted.
      // First statement in the handler, and the corroboration is unreachable
      // from here — moving it past that call is OBL-2's defeater and reports
      // the identical message.
      if (request.disposition.kind === "debris") {
        deps.report(
          fail("An adoption re-registers the directory it was offered on, so this create will not run."),
          request.origin,
        );
        return Promise.resolve();
      }
      // Create-proper's own, and the branch never continues past its return, so
      // this is a local rather than shared state across a module edge.
      let openFailure: string | null = null;
      return deps
        .runCoordinated(request.repoId, {
          resolve: async () => deps.repoPath(request.repoId),
          body: async (repoPath) => {
            const adoptPath = await deps.pathDeps.normalize(mode.adoptPath);
            const stat = adoptPath === null ? null : await deps.pathDeps.lstat(adoptPath);
            if (adoptPath === null || stat === null || stat.isSymbolicLink() || !stat.isDirectory()) {
              return fail("That directory is gone, so there is nothing to re-register.");
            }
            // The branch claim, at the moment of the write rather than from
            // the listing the resolution was built on. Two concurrent
            // `git worktree add` against one existing branch were both
            // observed to exit 0, so git itself excludes nothing globally —
            // this is parity with `add`, read as late as a client can read it.
            const before = await deps.listWorktrees(repoPath);
            if (before === null) {
              return { kind: "unavailable", verb: "create", repoId: request.repoId, unreadable: ["prunable"] };
            }
            const holder = await liveHolderOf(before, mode.branch, adoptPath, deps.pathDeps.normalize);
            if (holder !== undefined) {
              // No confirmation path past it: a second checkout of one branch
              // is what git refuses, and forcing it is not this action's to offer.
              return fail(`${holder} already has ${mode.branch} checked out, so it cannot be re-registered here.`);
            }
            // D5's re-probe. An entry restored during the user's pause is a
            // registration this adoption would overwrite, and the branch check
            // above would not catch one that is detached or on another branch.
            // `repoId` IS the normalized git common directory (types.ts), so
            // the corroboration and the reconstruction are given ONE value
            // resolved once by the tree's capability-aware reader — rather
            // than a second `rev-parse` here that has no such fallback and
            // could answer differently (round-1 F002, F010).
            const commonDir = request.repoId;
            const verdict = await deps.corroborateAdopt({ candidatePath: adoptPath, commonDir });
            if (verdict.kind !== "adopt") {
              return fail(adoptDeclineReason(verdict));
            }
            const written = await deps.reconstructEntry({
              repoPath,
              commonDir,
              worktreePath: adoptPath,
              branch: mode.branch,
              // The path the corroboration just proved absent, carried rather
              // than re-derived: the reconstruction re-reads it at its own
              // write boundary, and two readings of one link could disagree.
              staleGitdir: verdict.staleGitdir,
              // And the bytes, so the reconstruction compares against what
              // the corroboration read rather than against a value it built.
              staleLink: verdict.staleLink,
              // The tip guard belongs to the reconstruction, which is the only
              // place that can run it between `repair` and the index rebuild —
              // the order D4 states. One owner, so the two cannot disagree
              // about which read the claim rests on (round-1 F009).
              expectedBranchOid: mode.expectedBranchOid,
            });
            if (!written.ok) {
              return fail(`${written.message}${residueNote(written.leftBehind, adoptPath)}`);
            }
            /** Withdraw the registration, and say what the withdrawal could not put back. */
            const withdraw = async (why: string): Promise<MutationOutcome> =>
              fail(`${why}${residueNote(await written.undo(), adoptPath)}`);
            // And the branch claim again, because the window this closes is
            // the one between the pre-read and the write. Exactly one
            // non-prunable record, and it is the adopted path.
            const after = await deps.listWorktrees(repoPath);
            if (after === null) {
              return withdraw("The repository's worktrees could not be read after the re-registration.");
            }
            const contender = await liveHolderOf(after, mode.branch, adoptPath, deps.pathDeps.normalize);
            if (contender !== undefined) {
              return withdraw(`${contender} took ${mode.branch} while it was being re-registered.`);
            }
            const proof = await recordFor(after, adoptPath, mode.branch, deps.pathDeps.normalize);
            if (proof === undefined || proof.prunable) {
              return withdraw(`Git does not report ${adoptPath} as a worktree of this repository.`);
            }
            // The adoption is KEPT, so nothing will call `undo` and the pinned
            // `<wt>/.git` has no other owner left to close it.
            await written.release();
            await deps.afterCreate(adoptPath, request.afterCreate, request.origin).catch((error: unknown) => {
              const reason = messageOf(error);
              openFailure = request.afterCreate.kind === "agent" ? `Agent did not start: ${reason}` : reason;
            });
            return {
              kind: "ok",
              verb: "create",
              repoId: request.repoId,
              ...(openFailure === null ? {} : { openFailed: openFailure }),
              ...(request.afterCreate.kind === "terminal" ? { openTerminalAt: adoptPath } : {}),
            };
          },
        })
        .then(
          (outcome) => deps.report(outcome, request.origin),
          (error: unknown) => deps.report(fail(messageOf(error)), request.origin),
        );
    },

    reattach(request, mode, fail) {
      // BEFORE the branch, not inside the create body the branch never
      // reaches: a repair that carries a clearance would otherwise report a
      // successful repair while the directory it promised to clear is
      // untouched (round-1 B7). The dialog withholds the offer for this mode
      // too — neither side depends on the other having got it right.
      if (request.disposition.kind === "debris") {
        deps.report(fail("A repair does not clear a directory, so this create will not run."), request.origin);
        return Promise.resolve();
      }
      let openFailure: string | null = null;
      return deps
        .runCoordinated(request.repoId, {
          resolve: async () => deps.repoPath(request.repoId),
          body: async (repoPath) => {
            const repairPath = await deps.pathDeps.normalize(mode.repairPath);
            const stat = repairPath === null ? null : await deps.pathDeps.lstat(repairPath);
            if (repairPath === null || stat === null || stat.isSymbolicLink() || !stat.isDirectory()) {
              return fail("That directory is gone, so there is nothing to re-register.");
            }
            // D3 condition 1, re-established HERE and not carried from the
            // resolution. If the administrative entry was pruned during the
            // user's pause, `git worktree repair` has nothing to reconnect,
            // exits 0, and the condition-4 check below then asks whether a
            // path nobody registered is still prunable — it is not, so the
            // check passes and a repair that did nothing would be reported as
            // a success. Requiring the stale record BEFORE the command is
            // what makes condition 4 mean what it says (round-1 B1).
            const before = await deps.listWorktrees(repoPath);
            if (before === null) {
              return { kind: "unavailable", verb: "create", repoId: request.repoId, unreadable: ["prunable"] };
            }
            if (!(await holdsStaleRegistration(before, repairPath, mode.branch, deps.pathDeps.normalize))) {
              return fail(
                "Git no longer reports that directory as a stale registration of this branch, so there is nothing to repair.",
              );
            }
            // D3 conditions 2 and 3, through the same probe that offered the
            // repair: the `.git` link, the administrative directory it names,
            // and the branch tip against the directory's HEAD. The user's
            // decision sits between the read and this mutation, and every one
            // of them can have changed inside that window.
            const verdict = await deps.corroborateRepair({ repoPath, branch: mode.branch, repairPath });
            if (verdict.kind !== "offer") {
              return fail(declineReason(verdict));
            }
            // The probe proves the checkout still matches the branch NOW;
            // this proves it is still the same checkout the user was shown.
            if (verdict.expectedOid !== mode.expectedOid) {
              return fail("That checkout has moved since it was inspected. Nothing was changed; please try again.");
            }
            const result = await repairWorktree(deps.runner, { repoPath, worktreePath: repairPath });
            if (!result.ok) {
              return settled("create", request.repoId, result);
            }
            // § 2.3 condition 4. Git exiting 0 is not the claim; the listing
            // losing `prunable` is, and a repair that did not take is
            // reported rather than announced as a success.
            const after = await deps.listWorktrees(repoPath);
            if (after === null) {
              return { kind: "unavailable", verb: "create", repoId: request.repoId, unreadable: ["prunable"] };
            }
            // Success is the registration STILL BEING THERE and no longer
            // prunable — not the absence of a stale one. Absence is also what
            // a registration pruned between the pre-check and the command
            // looks like, and `repair` no-ops at exit 0 against that, so
            // reading absence as success announced a repair that never
            // happened (round-3 B1).
            const proof = await recordFor(after, repairPath, mode.branch, deps.pathDeps.normalize);
            if (proof === undefined) {
              return {
                kind: "unavailable",
                verb: "create",
                repoId: request.repoId,
                unreadable: ["prunable"],
              };
            }
            if (proof.prunable) {
              return fail("Git still reports that worktree as stale, so the repair did not take.");
            }
            await deps.afterCreate(repairPath, request.afterCreate, request.origin).catch((error: unknown) => {
              const reason = messageOf(error);
              openFailure = request.afterCreate.kind === "agent" ? `Agent did not start: ${reason}` : reason;
            });
            return {
              kind: "ok",
              verb: "create",
              repoId: request.repoId,
              ...(openFailure === null ? {} : { openFailed: openFailure }),
              ...(request.afterCreate.kind === "terminal" ? { openTerminalAt: repairPath } : {}),
            };
          },
        })
        .then(
          (outcome) => deps.report(outcome, request.origin),
          (error: unknown) => deps.report(fail(messageOf(error)), request.origin),
        );
    },
  };
}
