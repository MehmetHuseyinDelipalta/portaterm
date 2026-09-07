// src/providers/worktreeHost/actions/create/probes.ts — What a create against
// one selection WOULD do, answered before the user submits.
//
// Extracted from `createCreateActions` by change `decompose-worktree-host`
// (design.md D1, task 2_13). The probe, the two verdicts it asks for, the two
// well-formedness guards that admit it and the two corroborations it may reach
// for are one subject: everything the panel is told about a create it has not
// made yet.
//
// `matchesPublished` came with them. It is the same comparison read backwards —
// the probe publishes a repair, and the submit checks the submission against
// what was published — so the two belong in one place or they drift apart.
//
// `corroborate` and `corroborateAdopt` came too. Direction B (D1a) found the
// probe is their only caller, so leaving them behind would have left two dead
// helpers in the file this task is cutting down.
//
// Module-scope functions over a `ProbeDeps` bag rather than a factory: nothing
// here holds state between calls.

import type {
  BaseVerdict,
  BranchNameVerdict,
  ProbeBase,
  ResolvedDisposition,
  ResolvedMode,
  WorktreeActionMessage,
  WorktreeCreateMode,
} from "../../../../types/messages";
import type { AdoptVerdict } from "../../../../worktree/adoptProbe";
import { resolveSelection } from "../../../../worktree/createResolution";
import type { ReattachVerdict } from "../../../../worktree/reattachProbe";
import type { WorktreeRepo } from "../../../../worktree/types";
import type { WorktreeHostOptions } from "../../../WorktreeHost";
import type { Opening, PublishedRepair, WorktreeSurface } from "../../hostTypes";

/** What answering a probe needs from the host. A subset of `CreateDeps`. */
export interface ProbeDeps {
  readonly options: WorktreeHostOptions;
  disposed(): boolean;
  hasSurface(surface: WorktreeSurface): boolean;
  openingFor(s: WorktreeSurface, repoId: string, token: number): Opening | undefined;
  resolveDestination(
    repo: WorktreeRepo,
    branch: string,
    override?: string,
    chosen?: string,
  ): {
    root: string;
    base: string;
    bare: string;
    freePath: string;
    occupiedCandidate?: { path: string; disposition: ResolvedDisposition };
  };
  vettedOverride(candidate: string | undefined, repo: WorktreeRepo): Promise<string | undefined>;
}

/**
 * Is this submission the repair the host published, in every field?
 *
 * The stated destination is compared too: an adoption re-registers the
 * directory it was offered on, and a create naming a different one is not the
 * create the panel composed.
 */
export function matchesPublished(
  published: PublishedRepair | null | undefined,
  mode: WorktreeCreateMode,
  path: string,
): boolean {
  if (published === undefined || published === null || published.kind !== mode.kind) {
    return false;
  }
  if (published.kind === "adopt" && mode.kind === "adopt") {
    return (
      published.branch === mode.branch &&
      published.adoptPath === mode.adoptPath &&
      published.expectedBranchOid === mode.expectedBranchOid &&
      published.adoptPath === path
    );
  }
  return (
    published.kind === "reattach" &&
    mode.kind === "reattach" &&
    published.branch === mode.branch &&
    published.repairPath === mode.repairPath &&
    published.expectedOid === mode.expectedOid &&
    published.repairPath === path
  );
}

/**
 * Which create the destination would actually take, once the two corroborations
 * that only some candidates need have been asked for.
 *
 * Separated from the probe because it is the one part with no ownership
 * question in it: it takes the facts the probe gathered and returns a mode.
 */
async function resolveProbeMode(
  deps: ProbeDeps,
  repo: WorktreeRepo,
  branch: string,
  selection: ReturnType<typeof resolveSelection>,
  occupiedCandidate: { path: string; disposition: ResolvedDisposition } | undefined,
  tip: string | undefined,
  adoptable: boolean,
): Promise<ResolvedMode> {
  switch (selection.mode.kind) {
    case "none":
    case "fresh":
      return { kind: "fresh" };
    case "reuse": {
      // Adopt is a state of the DESTINATION, and the destination that matters
      // is the one the suffixing skipped — not the free path it moved to. A
      // branch that does not exist never reaches here, which is D2: there
      // would be no ref to attach the checkout to and no tip to promise.
      // A live holder is `reuse`'s other shape, and it is not adoptable: the
      // executor refuses that branch again at the moment of the write, and a
      // mode that will always be refused is not one to put on screen either.
      const occupied = selection.blockedBy === undefined ? occupiedCandidate?.path : undefined;
      const verdict =
        adoptable && occupied !== undefined && tip !== undefined
          ? await corroborateAdopt(deps, repo, occupied)
          : undefined;
      return verdict?.kind === "adopt" && occupied !== undefined && tip !== undefined
        ? { kind: "adopt", adoptPath: occupied, expectedBranchOid: tip }
        : { kind: "reuse" };
    }
    case "reattachCandidate": {
      // A candidate is a claim, not an answer. Failing corroboration does NOT
      // degrade to `fresh` at the same path — that would suffix a
      // near-duplicate beside a checkout already there — it falls back to the
      // FREE path the suffixing already computed (D3).
      const verdict = await corroborate(deps, repo, branch, selection.mode.repairPath);
      return verdict?.kind === "offer"
        ? { kind: "reattach", repairPath: verdict.repairPath, expectedOid: verdict.expectedOid }
        : verdict?.kind === "adopt" && adoptable && tip !== undefined
          ? { kind: "adopt", adoptPath: verdict.adoptPath, expectedBranchOid: tip }
          : { kind: "fresh" };
    }
  }
}

/**
 * What this answer authorizes, recorded on the opening AS it is published.
 *
 * The debris candidate and the repair are the two things a later submission is
 * allowed to act on, so they are written here and nowhere else: the only path
 * an authorization can be issued for is the one this opening's latest answer
 * put on screen (round-1 B1, F001).
 */
function recordPublication(
  publishing: Opening,
  branch: string,
  base: ProbeBase | undefined,
  mode: ResolvedMode,
  occupiedCandidate: { path: string; disposition: ResolvedDisposition } | undefined,
): void {
  // Only where the FORM would offer it. A `reattach` create acts on the
  // registration's own path, so the dialog never offers the skipped candidate
  // for one — recording it anyway left a path authorizable that no form could
  // put on screen (round-2 B1). The one exception is a detached probe: the
  // toggle discards the classification (D5), so the form takes the free path
  // and does offer. `base.kind` is how the probe says so.
  // `adopt` joins `reattach`: both act on a directory of their own, so the
  // skipped candidate is never a path either form puts on screen — and
  // recording it would leave a path authorizable for a delete no form offers.
  // Adopt is stronger still: its own directory IS the skipped candidate, and
  // minting a clearance for it would offer to delete the work being adopted.
  const offerable = (mode.kind !== "reattach" && mode.kind !== "adopt") || base?.kind === "detached";
  publishing.debrisCandidate =
    offerable && occupiedCandidate !== undefined && occupiedCandidate.disposition.kind === "debris"
      ? occupiedCandidate.path
      : null;
  // `branch` is the query that answer was about — the same value the form
  // submits (round-1 F001).
  publishing.publishedRepair =
    mode.kind === "adopt"
      ? { kind: "adopt", branch, adoptPath: mode.adoptPath, expectedBranchOid: mode.expectedBranchOid }
      : mode.kind === "reattach"
        ? { kind: "reattach", branch, repairPath: mode.repairPath, expectedOid: mode.expectedOid }
        : null;
}

/**
 * What a create against this selection would do, answered before submit.
 *
 * Every input but one is already in the host's hand — the listing answers
 * which worktrees hold which branches and which registrations git calls
 * stale, and the enumeration answers which branches exist. The exception is
 * § 2.3's corroboration, which is a filesystem read and runs ONLY for a
 * candidate the classification already produced, so the common path adds no
 * I/O at all (design.md D2, D3).
 */
export async function answerCreateProbe(
  deps: ProbeDeps,
  surface: WorktreeSurface,
  msg: Extract<WorktreeActionMessage, { type: "worktreeCreateProbe" }>,
  repo: WorktreeRepo,
  /**
   * The opening the dispatch admitted this probe on.
   *
   * It INITIALISES the anchor and is never read as a captured reference —
   * `stillOurs()` keeps its own map lookup, its sequence test and its
   * equality check, so this can only reject a replacement the first call used
   * to admit, never admit anything the first call would have refused.
   */
  admitted: Opening,
): Promise<void> {
  // Identity, never a captured reference (D9). The map entry can be released
  // while this continuation is suspended — the repository leaves the
  // workspace, a newer opening replaces it — and an object taken before the
  // await cannot be reached by that release, so the probe resumed and posted
  // from facts about a repository nobody has any more (round-5 B7).
  // Anchored at ENTRY, not on first use. `deps.vettedOverride` awaits before the
  // first `stillOurs()` call, so a same-token replay landing inside THAT await
  // was anchored into rather than rejected — the window round 1's fix left
  // open, because the dispatch had already looked this object up to set
  // `latestSeq` and simply did not hand it on (round-3 F001).
  let anchored: Opening | undefined = admitted;
  const stillOurs = (): Opening | undefined => {
    const held = deps.openingFor(surface, msg.repoId, msg.token);
    if (held === undefined || held.latestSeq > msg.seq) {
      return undefined;
    }
    // The FIRST call anchors; every later one must find the same object. The
    // token survives a same-token refs replay and the replacement's reset
    // `latestSeq` passes the seq test, so a token-only guard readmitted a
    // continuation that had derived its destination — and its debris and
    // repair state — from a record nobody holds any more (round-1 F001).
    anchored ??= held;
    return held === anchored ? held : undefined;
  };

  const override = await deps.vettedOverride(msg.candidatePath, repo);
  const opening = stillOurs();
  if (opening === undefined) {
    return;
  }
  // Read from the opening `stillOurs()` just returned, with NO await between
  // here and the derivation. Vetting a webview-named folder would have needed
  // two more awaits, and `stillOurs()` proves neither that the same `Opening`
  // object survived them nor that its record still says what it said — a
  // same-token refs replay replaces the object outright (design.md D5).
  //
  // Branched on the FIELD's presence, never on what `deps.vettedOverride` returned:
  // reading its result would let a typed path refused for being out of root
  // fall through to the chosen folder, which is a widening this does not claim.
  const chosen =
    msg.candidatePath === undefined && msg.useChosenFolder === true ? opening.chosenRoot?.resolved : undefined;
  const { freePath, occupiedCandidate } = deps.resolveDestination(repo, msg.query, override, chosen);

  // The enumeration the dialog's opening already took, not a second one: a
  // probe per settled edit that re-asks git is the per-keystroke read D2
  // rejected, and two reads of one repository can disagree about one instant.
  //
  // Nothing to join, or a read that failed, answers `refs: []`, which
  // resolves every query to `fresh`. That is the documented fail-OPEN: a
  // branch we cannot confirm exists is treated as one to create, and git's
  // own refusal at `add` is the backstop, surfaced verbatim (§ 6).
  const read = await opening.read.catch(() => undefined);
  // A newer probe was asked for this opening while this one was suspended on
  // the enumeration. Answering now would post a classification the form has
  // already moved past, and under a slow read every keystroke's continuation
  // would resume and re-classify (round-1 B5, B6).
  if (stillOurs() === undefined) {
    return;
  }
  const refs = read !== undefined && read.ok === true ? read.refs : [];
  const selection = resolveSelection({ query: msg.query, refs, worktrees: repo.worktrees });

  // The tip comes from the enumeration this probe already took, for both adopt
  // producers (design.md D3). No tip, no adopt: the offer promises the user a
  // commit, and the form must not have to invent one.
  const named = refs.find((ref) => ref.name === msg.query)?.oid;
  const tip = named !== undefined && named.length > 0 ? named : undefined;
  // WT-012.14 owns the value; this is the predicate it sets. Its answer is in:
  // the recipe fails on Windows, so the default withholds a mode that would be
  // offered and left to fail. Withholding is still not the same as reporting a
  // failure the user did not ask for, which is what D7 forbids here.
  const adoptable = deps.options.adoptSupported ?? process.platform !== "win32";

  const mode = await resolveProbeMode(deps, repo, msg.query, selection, occupiedCandidate, tip, adoptable);

  // The surface may have detached while git was answering. Posting to a dead
  // one is at best wasted, and the form it described is gone.
  if (deps.disposed() || !deps.hasSurface(surface) || stillOurs() === undefined) {
    return;
  }
  // Only where a base can actually apply. `reuse` and `reattach` take their
  // starting point from something that already exists, and a verdict on a
  // control the form has disabled would imply it is still live (D7).
  // `adopt` used to be here too, because the dialog had no adopt action and
  // fell back to creating one. It has one now, and adoption takes its
  // starting point from the checkout that already exists — so the base is
  // refused for it on the same rule `reuse` and `reattach` follow
  // (design.md D6).
  const takesBase = mode.kind === "fresh";
  const baseValid = takesBase ? await resolveBaseVerdict(deps, repo, msg.base) : undefined;
  // The same rule, for the same reason: only `fresh` creates a branch, and a
  // verdict on a name no create would take is a verdict on nothing.
  const branchValid = takesBase ? await resolveBranchVerdict(deps, repo, msg.query) : undefined;
  const publishing = stillOurs();
  if (deps.disposed() || !deps.hasSurface(surface) || publishing === undefined) {
    return;
  }
  recordPublication(publishing, msg.query, msg.base, mode, occupiedCandidate);
  surface.post({
    type: "worktreeCreateResolution",
    repoId: msg.repoId,
    token: msg.token,
    seq: msg.seq,
    query: msg.query,
    mode,
    freePath,
    ...(occupiedCandidate === undefined ? {} : { occupiedCandidate }),
    ...(selection.blockedBy === undefined ? {} : { blockedBy: selection.blockedBy }),
    ...(baseValid === undefined ? {} : { baseValid }),
    ...(branchValid === undefined ? {} : { branchValid }),
  });
}

/**
 * Does git take the typed name as a branch?
 *
 * ASKED, never decided here. `check-ref-format`'s rules are long,
 * version-dependent and easy to get subtly wrong, and a validator that is
 * merely close rejects names git would take — which is why
 * `branchNameIsValid` asks in the first place. `undefined` when nobody could
 * be asked, the same shape the base verdict uses, so an unassembled reader
 * reports "not told" rather than "invalid".
 */
async function resolveBranchVerdict(
  deps: ProbeDeps,
  repo: WorktreeRepo,
  branch: string,
): Promise<BranchNameVerdict | undefined> {
  const ask = deps.options.acceptsBranchName;
  if (ask === undefined) {
    return undefined;
  }
  const accepted = await ask({ repoPath: repo.mainPath, branch }).catch(() => null);
  return accepted === null
    ? undefined
    : accepted
      ? { ok: true }
      : { ok: false, reason: `git will not take "${branch}" as a branch name.` };
}

/**
 * Does the base the form would start from resolve to a commit? (D7)
 *
 * `undefined` when nobody can ask — the same shape corroboration uses, so an
 * unassembled reader reports "not told" rather than "invalid".
 */
async function resolveBaseVerdict(
  deps: ProbeDeps,
  repo: WorktreeRepo,
  base: ProbeBase | undefined,
): Promise<BaseVerdict | undefined> {
  if (base === undefined || base.kind === "detached") {
    return undefined;
  }
  const resolve = deps.options.resolveBase;
  if (resolve === undefined) {
    return undefined;
  }
  const oid = await resolve({ repoPath: repo.mainPath, ref: base.ref }).catch(() => undefined);
  return oid === undefined
    ? { ok: false, reason: `"${base.ref}" does not name a commit in this repository.` }
    : { ok: true, oid };
}

/**
 * Is this probe exactly the payload the contract declares?
 *
 * Exact rather than partial: a field the guard skips is a field that reaches
 * async work, and `base` is the one that reaches git argv. Declared keys
 * only, so a payload carrying an undeclared one is refused rather than
 * silently trimmed; non-negative safe integers for the two ordering fields,
 * because the comparisons that supersede answers are meaningless on a
 * fraction or an infinity (round-3 W1).
 */
export function isWellFormedProbe(msg: Extract<WorktreeActionMessage, { type: "worktreeCreateProbe" }>): boolean {
  const ordinal = (v: unknown): boolean => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
  const declared = new Set(["type", "repoId", "token", "seq", "query", "candidatePath", "useChosenFolder", "base"]);
  for (const key of Object.keys(msg)) {
    if (!declared.has(key)) {
      return false;
    }
  }
  // Types and key set, not emptiness: an empty `repoId` matches no repository
  // and an empty `candidatePath` resolves nowhere, so both already fail closed
  // downstream and a clause here could not be told from its absence.
  if (
    typeof msg.repoId !== "string" ||
    !ordinal(msg.token) ||
    !ordinal(msg.seq) ||
    typeof msg.query !== "string" ||
    (msg.candidatePath !== undefined && typeof msg.candidatePath !== "string") ||
    // Exactly `true` or absent. A flag whose only meaning is "use the record"
    // has no second value, and admitting `false` would put two spellings of
    // "the configured root" on the wire.
    (msg.useChosenFolder !== undefined && msg.useChosenFolder !== true)
  ) {
    return false;
  }
  return isWellFormedBase(msg.base);
}

/** `undefined`, exactly `detached`, or exactly a `ref` naming something. */
function isWellFormedBase(base: ProbeBase | undefined): boolean {
  if (base === undefined) {
    return true;
  }
  if (typeof base !== "object" || base === null) {
    return false;
  }
  const keys = Object.keys(base);
  if ((base as { kind?: unknown }).kind === "detached") {
    return keys.length === 1;
  }
  if ((base as { kind?: unknown }).kind === "ref") {
    const ref = (base as { ref?: unknown }).ref;
    return keys.length === 2 && typeof ref === "string" && ref.length > 0;
  }
  return false;
}

/** § 2.3 conditions 2 and 3, or `undefined` when nobody can ask them. */
async function corroborate(
  deps: ProbeDeps,
  repo: WorktreeRepo,
  branch: string,
  repairPath: string,
): Promise<ReattachVerdict | undefined> {
  const probe = deps.options.probeReattach;
  if (probe === undefined) {
    return undefined;
  }
  return probe({ repoPath: repo.mainPath, branch, repairPath }).catch(() => undefined);
}

/**
 * Whether the destination's occupied candidate is an adoptable checkout.
 *
 * One filesystem read, and only for a candidate the derivation already
 * produced — the common path adds no I/O at all, which is the rule
 * `corroborate` follows for the same reason (design.md D1).
 */
async function corroborateAdopt(
  deps: ProbeDeps,
  repo: WorktreeRepo,
  candidatePath: string,
): Promise<AdoptVerdict | undefined> {
  const probe = deps.options.probeAdopt;
  if (probe === undefined) {
    return undefined;
  }
  // `repoId` IS the normalized git common directory (types.ts), resolved once
  // by the tree through the capability-aware reader. The probe needs it to
  // prove the surviving checkout was a worktree of THIS repository, and
  // asking git again here would be a second answer about one thing (F002).
  return probe({ candidatePath, commonDir: repo.repoId }).catch(() => undefined);
}
