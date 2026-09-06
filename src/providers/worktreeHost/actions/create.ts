// src/providers/worktreeHost/actions/create.ts — Everything the create form asks for.
//
// Extracted from `handleAction` by change `decompose-worktree-host-controller`
// (design.md D1, task 2_4): the eight create arms plus the ten helpers only they
// called. Defaults, refs, probe, destination, debris and the submit itself share
// one opening, one set of maps and one notion of which token is live, which is
// why they cut as a unit rather than one arm at a time.

import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type {
  BaseVerdict,
  BranchNameVerdict,
  DebrisAuthorization,
  ExtensionToWebViewMessage,
  ProbeBase,
  ProvisionEntry,
  ProvisionModel,
  ProvisionPort,
  ProvisionSetupStep,
  ResolvedDisposition,
  ResolvedMode,
  WorktreeActionMessage,
  WorktreeCreateMode,
} from "../../../types/messages";
import { prepareResolvedRoot } from "../../../utils/resolvedPathBoundary";
import type { AdoptVerdict } from "../../../worktree/adoptProbe";
import { resolveSelection } from "../../../worktree/createResolution";
import type { MigrationOfferEvidence, MigrationRepositoryBinding } from "../../../worktree/migrateChanges";
import type { ProvisionOfferStore } from "../../../worktree/provisioning/offerStore";
import type { HeldProvisionSource } from "../../../worktree/provisioning/provisionMaterial";
import { claimProvisionMaterials, disposeProvisionMaterials } from "../../../worktree/provisioning/provisionMaterial";
import type { ReattachVerdict } from "../../../worktree/reattachProbe";
import type { PullRequestsRead } from "../../../worktree/repoPullRequests";
import type { WorktreeRepo } from "../../../worktree/types";
import type { createWorktreeCache } from "../../../worktree/WorktreeCache";
import type { WorktreeHostOptions } from "../../WorktreeHost";
import type { Opening, PublishedRepair, WorktreeActions, WorktreeSurface } from "../hostTypes";
import {
  isKnownAfterCreate,
  isKnownCreateMode,
  isKnownDisposition,
  isKnownMigration,
  isKnownProvision,
  isKnownSetupRetry,
  namedOpening,
} from "../messageGuards";
import type { OpeningLifecycle } from "../openingLifecycle";

/** One arm, once the dispatcher has proved `actions` is there. */
type Arm<T extends WorktreeActionMessage["type"]> = (
  surface: WorktreeSurface,
  msg: Extract<WorktreeActionMessage, { type: T }>,
  actions: WorktreeActions,
) => void;

/** What one repository's migration offer holds, keyed by its own sequence. */
interface MigrationOffer {
  surface: string;
  opening: number;
  repoId: string;
  sourceWorktreeId: string;
  sourcePath: string;
  binding: MigrationRepositoryBinding;
  evidence: MigrationOfferEvidence;
}

/**
 * What the create arms need from the host.
 *
 * Maps and the offer store cross by REFERENCE — the host keeps writing to them
 * while a form is open, and a copy would freeze this module's view at wiring
 * time (design.md D4, OBL-4). `disposed` and `bumpMigrationSequence` are
 * accessors because a `let` binding cannot be shared through an object field.
 */
export interface CreateDeps {
  readonly cache: ReturnType<typeof createWorktreeCache>;
  readonly lifecycle: OpeningLifecycle;
  readonly openings: Map<string, Opening>;
  readonly migrationOffers: Map<string, MigrationOffer>;
  readonly migrationReading: Map<
    string,
    { sequence: number; repoId: string; sourceWorktreeId: string; sourceGeneration: number }
  >;
  readonly offers: ProvisionOfferStore;
  readonly provisionBaseline: Map<string, string>;
  readonly provisionReading: Map<string, number>;
  readonly options: WorktreeHostOptions;
  readonly surfaces: Map<WorktreeSurface, unknown>;
  actionPath(worktreeId: string, allowMissing: boolean): string | undefined;
  admissibleLaunch(surface: WorktreeSurface, fields: unknown): boolean;
  currentMigrationRegistration(repoId: string): MigrationRepositoryBinding["registration"] | undefined;
  deliver(surface: WorktreeSurface, message: ExtensionToWebViewMessage): boolean;
  disposed(): boolean;
  bumpMigrationSequence(): number;
  issueWithAdded(
    offerKey: { surface: string; repoId: string },
    slot: string,
    model: ProvisionModel,
  ): { readonly offerId: string; readonly model: ProvisionModel };
  openingFor(s: WorktreeSurface, repoId: string, token: number): Opening | undefined;
  openingKey(s: WorktreeSurface, repoId: string): string;
  perform(run: () => Promise<void>): void;
  previewProvisioning(repo: WorktreeRepo, model: ProvisionModel): Promise<ProvisionModel>;
  repoIdOf(worktreeId: string): string | undefined;
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
  retireOpening(key: string): void;
  surfaceKey(s: WorktreeSurface): string;
  vettedOverride(candidate: string | undefined, repo: WorktreeRepo): Promise<string | undefined>;
}

export function createCreateActions(deps: CreateDeps) {
  const {
    actionPath,
    admissibleLaunch,
    bumpMigrationSequence,
    cache,
    currentMigrationRegistration,
    deliver,
    disposed,
    issueWithAdded,
    lifecycle,
    migrationOffers,
    migrationReading,
    offers,
    openingFor,
    openingKey,
    openings,
    options,
    perform,
    previewProvisioning,
    provisionBaseline,
    provisionReading,
    repoIdOf,
    resolveDestination,
    retireOpening,
    surfaceKey,
    surfaces,
    vettedOverride,
  } = deps;

  /**
   * Is this submission the repair the host published, in every field?
   *
   * The stated destination is compared too: an adoption re-registers the
   * directory it was offered on, and a create naming a different one is not the
   * create the panel composed.
   */
  const matchesPublished = (
    published: PublishedRepair | null | undefined,
    mode: WorktreeCreateMode,
    path: string,
  ): boolean => {
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
  };

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
  /**
   * Show the system folder picker for one create form, and answer only if that
   * form is still the one asking.
   *
   * The dialog is modal to the USER but async to the extension: they can dismiss
   * the create form, open another, and only then confirm this picker. So the
   * opening is re-read AFTER the await, the way every other post-await
   * continuation here re-reads its own ownership — a captured reference would
   * still be reachable and would answer a form that no longer exists.
   *
   * Every pick a live form opened is answered — a confirmed choice with its
   * path, and cancel, failure, an unresolvable root, an unwired capability and
   * a superseded pick with none. The form DOES gate itself while the dialog is
   * up, on both Create and the picker action, so it needs a terminal answer to
   * be released: a form locked behind an OS dialog that never returns is a form
   * the user cannot escape, which is why silence is reserved for a form that is
   * already gone (design.md D3, amended after review round 3).
   */
  async function pickDestination(
    surface: WorktreeSurface,
    msg: Extract<WorktreeActionMessage, { type: "worktreePickDestination" }>,
  ): Promise<void> {
    // The opening as an OBJECT, taken before the dialog opens, because the token
    // it rides is not identity: `requestWorktreeRefs` REPLACES the whole record
    // even for a token it already holds, and this continuation is suspended
    // across the longest await in the host. Matching on the token alone would
    // let the answer to a question asked of one record become consent held by
    // its replacement (round-1 F001). A pick naming an opening this host does
    // not hold opens no dialog at all.
    //
    // Not the same as nobody waiting, which is what this used to claim. A
    // predecessor dialog can still be on screen after its opening was retired,
    // and its click sets the form's gate and posts a token this host has moved
    // past; it is then released only by the successor opening it is already
    // waiting for. Bounded in practice, unbounded if that successor never
    // arrives — round-4 F007, carried as a residual because telling a retired
    // opening apart from a gone form is a change to what D3 means by "gone".
    const held = openingFor(surface, msg.repoId, msg.token);
    if (held === undefined) {
      return;
    }
    /**
     * End this pick, one way or the other.
     *
     * Silence is for a form that is GONE, and nothing else (design.md D3). Every
     * other arm answers, carrying no path — the form cannot tell "no folder"
     * from "still waiting" without being told, and the plan attack found two
     * arms below dropping an answer while the surface and its token were still
     * live, either of which would have left the form waiting forever.
     *
     * `ask` is echoed, so releasing an older pick cannot release a newer one.
     */
    const release = (path?: string): void => {
      if (disposed() || !surfaces.has(surface) || openingFor(surface, msg.repoId, msg.token) === undefined) {
        return;
      }
      surface.post({
        type: "worktreeDestinationPicked",
        repoId: msg.repoId,
        token: msg.token,
        ask: msg.ask,
        ...(path === undefined ? {} : { path }),
      });
    };
    const pick = options.actions?.pickFolder;
    if (pick === undefined) {
      // A capability nobody wired is still an answer. The form renders its
      // action on its own dependencies, not on this one, so leaving it silent
      // would hang a form the host can simply tell.
      release();
      return;
    }
    let chosen: string | undefined;
    try {
      chosen = await pick();
    } catch {
      release();
      return;
    }
    if (chosen === undefined || chosen === "") {
      release();
      return;
    }
    // Ordered by CONFIRMATION, not by resolution: the two picks race only behind
    // the dialog, and the user's second answer is the one they meant even when
    // its root resolves first (round-1 F003).
    held.pickGeneration += 1;
    const generation = held.pickGeneration;
    // Resolved HERE, once, on the answer the dialog returned. Recording the
    // spelling instead would leave it to be re-resolved when the probe uses it,
    // and a link retargeted in between would move the honoured area onto a
    // directory the user never selected (design.md D4).
    const resolved = await prepareResolvedRoot(chosen, options.resolvedPathDeps).catch(() => null);
    // Re-read AFTER both awaits, not once at the top: the form can be dismissed
    // or superseded while either is suspended, and writing the record onto an
    // object the retirement already dropped is the same mistake as posting to a
    // form that is gone.
    const opening = disposed() || !surfaces.has(surface) ? undefined : openingFor(surface, msg.repoId, msg.token);
    if (opening === undefined || opening !== held || opening.pickGeneration !== generation || resolved === null) {
      // Not recorded — and, where a form is still there to hear it, still
      // answered. A replaced `Opening` and a superseded pick both leave the
      // surface and the token alive, so `release` finds a form and tells it.
      release();
      return;
    }
    opening.chosenRoot = resolved;
    release(chosen);
  }

  async function answerCreateProbe(
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
    // Anchored at ENTRY, not on first use. `vettedOverride` awaits before the
    // first `stillOurs()` call, so a same-token replay landing inside THAT await
    // was anchored into rather than rejected — the window round 1's fix left
    // open, because the dispatch had already looked this object up to set
    // `latestSeq` and simply did not hand it on (round-3 F001).
    let anchored: Opening | undefined = admitted;
    const stillOurs = (): Opening | undefined => {
      const held = openingFor(surface, msg.repoId, msg.token);
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

    const override = await vettedOverride(msg.candidatePath, repo);
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
    // Branched on the FIELD's presence, never on what `vettedOverride` returned:
    // reading its result would let a typed path refused for being out of root
    // fall through to the chosen folder, which is a widening this does not claim.
    const chosen =
      msg.candidatePath === undefined && msg.useChosenFolder === true ? opening.chosenRoot?.resolved : undefined;
    const { freePath, occupiedCandidate } = resolveDestination(repo, msg.query, override, chosen);

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
    const adoptable = options.adoptSupported ?? process.platform !== "win32";

    let mode: ResolvedMode;
    switch (selection.mode.kind) {
      case "none":
      case "fresh":
        mode = { kind: "fresh" };
        break;
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
          adoptable && occupied !== undefined && tip !== undefined ? await corroborateAdopt(repo, occupied) : undefined;
        mode =
          verdict?.kind === "adopt" && occupied !== undefined && tip !== undefined
            ? { kind: "adopt", adoptPath: occupied, expectedBranchOid: tip }
            : { kind: "reuse" };
        break;
      }
      case "reattachCandidate": {
        // A candidate is a claim, not an answer. Failing corroboration does NOT
        // degrade to `fresh` at the same path — that would suffix a
        // near-duplicate beside a checkout already there — it falls back to the
        // FREE path the suffixing already computed (D3).
        const verdict = await corroborate(repo, msg.query, selection.mode.repairPath);
        mode =
          verdict?.kind === "offer"
            ? { kind: "reattach", repairPath: verdict.repairPath, expectedOid: verdict.expectedOid }
            : verdict?.kind === "adopt" && adoptable && tip !== undefined
              ? { kind: "adopt", adoptPath: verdict.adoptPath, expectedBranchOid: tip }
              : { kind: "fresh" };
        break;
      }
    }

    // The surface may have detached while git was answering. Posting to a dead
    // one is at best wasted, and the form it described is gone.
    if (disposed() || !surfaces.has(surface) || stillOurs() === undefined) {
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
    const baseValid = takesBase ? await resolveBaseVerdict(repo, msg.base) : undefined;
    // The same rule, for the same reason: only `fresh` creates a branch, and a
    // verdict on a name no create would take is a verdict on nothing.
    const branchValid = takesBase ? await resolveBranchVerdict(repo, msg.query) : undefined;
    const publishing = stillOurs();
    if (disposed() || !surfaces.has(surface) || publishing === undefined) {
      return;
    }
    // Recorded as it is PUBLISHED, so the only path an authorization can be
    // issued for is the one this opening's latest answer put on screen. A newer
    // answer replaces it; an answer naming no debris clears it (round-1 B1).
    //
    // And only where the FORM would offer it. A `reattach` create acts on the
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
    const offerable = (mode.kind !== "reattach" && mode.kind !== "adopt") || msg.base?.kind === "detached";
    publishing.debrisCandidate =
      offerable && occupiedCandidate !== undefined && occupiedCandidate.disposition.kind === "debris"
        ? occupiedCandidate.path
        : null;
    // Recorded as it is PUBLISHED, beside the debris candidate and on the same
    // rule: the only repair a submission may run is the one this opening's
    // latest answer put on screen. `msg.query` is the branch that answer was
    // about — the same value the form submits (round-1 F001).
    publishing.publishedRepair =
      mode.kind === "adopt"
        ? { kind: "adopt", branch: msg.query, adoptPath: mode.adoptPath, expectedBranchOid: mode.expectedBranchOid }
        : mode.kind === "reattach"
          ? { kind: "reattach", branch: msg.query, repairPath: mode.repairPath, expectedOid: mode.expectedOid }
          : null;
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
  async function resolveBranchVerdict(repo: WorktreeRepo, branch: string): Promise<BranchNameVerdict | undefined> {
    const ask = options.acceptsBranchName;
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
  async function resolveBaseVerdict(repo: WorktreeRepo, base: ProbeBase | undefined): Promise<BaseVerdict | undefined> {
    if (base === undefined || base.kind === "detached") {
      return undefined;
    }
    const resolve = options.resolveBase;
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
  function isWellFormedProbe(msg: Extract<WorktreeActionMessage, { type: "worktreeCreateProbe" }>): boolean {
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

  /**
   * Issue an authorization to clear `path`, or say why there is none.
   *
   * ONE read of the directory answers both questions — what the offer will state
   * and what the token is digested over. Reading twice would let the user be
   * shown one set and the fingerprint bind another (design.md D6).
   */
  async function answerDebrisAuthorization(
    surface: WorktreeSurface,
    msg: Extract<WorktreeActionMessage, { type: "worktreeAuthorizeDebris" }>,
  ): Promise<void> {
    const answer = (
      rest:
        | { granted: true; authorization: DebrisAuthorization; entries: readonly string[] }
        | { granted: false; because: "notDebris" | "unreadable" },
    ): void => {
      surface.post({
        type: "worktreeDebrisAuthorized",
        repoId: msg.repoId,
        token: msg.token,
        // Echoed, never re-derived: it is what tells this answer from one the
        // form has already withdrawn (round-2 W2).
        ask: msg.ask,
        path: msg.path,
        ...rest,
      });
    };
    const issue = options.issueDebrisAuthorization;
    if (issue === undefined) {
      answer({ granted: false, because: "unreadable" });
      return;
    }
    const issued = await issue(msg.path);
    // The opening AND the candidate, re-asked after the read. A newer answer can
    // have published a different destination while this one was reading, and a
    // token bound to the superseded one is not an answer to any question now on
    // screen (round-1 B1).
    if (
      disposed() ||
      !surfaces.has(surface) ||
      openingFor(surface, msg.repoId, msg.token)?.debrisCandidate !== msg.path
    ) {
      return;
    }
    answer(
      issued.ok
        ? {
            granted: true,
            authorization: { path: msg.path, fingerprint: issued.fingerprint },
            entries: issued.entries,
          }
        : { granted: false, because: issued.because },
    );
  }

  /** § 2.3 conditions 2 and 3, or `undefined` when nobody can ask them. */
  async function corroborate(
    repo: WorktreeRepo,
    branch: string,
    repairPath: string,
  ): Promise<ReattachVerdict | undefined> {
    const probe = options.probeReattach;
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
  async function corroborateAdopt(repo: WorktreeRepo, candidatePath: string): Promise<AdoptVerdict | undefined> {
    const probe = options.probeAdopt;
    if (probe === undefined) {
      return undefined;
    }
    // `repoId` IS the normalized git common directory (types.ts), resolved once
    // by the tree through the capability-aware reader. The probe needs it to
    // prove the surviving checkout was a worktree of THIS repository, and
    // asking git again here would be a second answer about one thing (F002).
    return probe({ candidatePath, commonDir: repo.repoId }).catch(() => undefined);
  }

  const worktreeCreate: Arm<"worktreeCreate"> = (surface, msg, actions) => {
    const create = actions.createWorktree;
    // The last door outside the one-opening contract (round-5 W1): a form
    // the user closed cannot still be asking for a worktree.
    //
    // Equality, not consumption. The panel posts the submit before the
    // retirement on one ordered channel, so the legitimate one is still
    // live when it lands; spending the opening here would be a new rule
    // about how many submits an opening is worth. `namedOpening` is the
    // same defence in depth as at the refs door, unkillable alone.
    if (!namedOpening(msg.opening) || !lifecycle.isLive(surfaceKey(surface), msg.opening)) {
      return;
    }
    // Validated at RUNTIME, not merely typed. The unions make a bad request
    // unrepresentable in our own code, which is what stops us writing one —
    // but this message arrives from the webview, and a type erases at the
    // boundary. worktree-rpc.md § 4 asks for the check on every inbound
    // message, so an unknown discriminant fails closed here rather than
    // reaching a `switch` that has no arm for it.
    if (!isKnownCreateMode(msg.mode) || !isKnownAfterCreate(msg.afterCreate) || !isKnownDisposition(msg.disposition)) {
      return;
    }
    // The authorization names the directory it authorizes, and this create
    // names the directory it will take. A create whose disposition
    // authorizes a DIFFERENT path is not a create the panel composed.
    if (msg.disposition.kind === "debris" && msg.disposition.authorization.path !== msg.path) {
      return;
    }
    // A repair runs on the host's own resolution or not at all. Refused OUT
    // LOUD, like a stale provisioning offer: a Create button that silently
    // does nothing leaves the user no way to learn that reopening the
    // dialog is the recovery (round-1 F001).
    if (
      (msg.mode.kind === "adopt" || msg.mode.kind === "reattach") &&
      !matchesPublished(openingFor(surface, msg.repoId, msg.opening)?.publishedRepair, msg.mode, msg.path)
    ) {
      surface.post({
        type: "worktreeMutationResult",
        verb: "create",
        repoId: msg.repoId,
        result: {
          kind: "error",
          message:
            "the directory this create was resolved against has changed — close and reopen the dialog, then create again",
        },
      });
      return;
    }
    // The selection names ITEMS; the host holds the model. Resolved here,
    // from the offer this surface was shown, so nothing the webview spelled
    // reaches the filesystem — the property offerStore.ts exists for
    // (worktree-rpc.md § 2.4, design.md D2).
    //
    // An id the store no longer holds means NO CREATE: § 2.4 requires a
    // fresh model and a second submission, and honouring a stale offer
    // would provision from a model the user is not looking at. The other
    // half of that rule — resolving and re-presenting the fresh model — is
    // a named follow-up, so the user's recovery today is to reopen the
    // dialog.
    let selectedEntries: readonly ProvisionEntry[] | undefined;
    let selectedHeldFiles: ReadonlyMap<string, HeldProvisionSource> | undefined;
    let selectedPorts: readonly ProvisionPort[] | undefined;
    let migrationOffer: ReturnType<typeof migrationOffers.get>;
    let selectedSetup: readonly ProvisionSetupStep[] | undefined;
    let asimovEnvironment: boolean | undefined;
    if (msg.provision !== undefined) {
      // Checked at RUNTIME like its three neighbours above. It was the one
      // field that got only a `!== undefined` before `.offerId` and
      // `new Set(.itemIds)` were read off it — and the worktree dispatch at
      // `TerminalViewProvider.ts:1024-1031` returns BEFORE its `try`, so a
      // malformed message escaped into VS Code's callback instead of
      // failing closed (round-1 F006).
      if (!isKnownProvision(msg.provision)) {
        return;
      }
      const offered = offers.redeem({ surface: surfaceKey(surface), repoId: msg.repoId }, msg.provision.offerId);
      if (offered === undefined) {
        // Refused OUT LOUD. D3 says a stale offer refuses the create "with
        // a stated reason, on the existing error arm"; returning bare left
        // the user with a Create button that did nothing and no way to
        // learn that reopening the dialog is the recovery (round-1 F001).
        surface.post({
          type: "worktreeMutationResult",
          verb: "create",
          repoId: msg.repoId,
          result: {
            kind: "error",
            message: "the list of files to bring over is out of date — close and reopen the dialog, then create again",
          },
        });
        return;
      }
      const wanted = new Set(msg.provision.itemIds);
      selectedEntries = offered.model.entries.filter((entry) => wanted.has(entry.id));
      selectedHeldFiles = offered.heldFiles;
      selectedPorts = offered.model.ports.filter((port) => wanted.has(port.id));
      selectedSetup = offered.model.setup.filter((step) => wanted.has(step.id));
      asimovEnvironment = offered.model.providers.some((provider) => provider.id === "asimov" && provider.active);
    }
    if (msg.migrateChanges !== undefined) {
      if (
        !isKnownMigration(msg.migrateChanges) ||
        (msg.mode.kind !== "fresh" && msg.mode.kind !== "fresh-detached" && msg.mode.kind !== "reuse")
      ) {
        return;
      }
      const offered = migrationOffers.get(msg.migrateChanges.offerId);
      const source = cache
        .read()
        .repos.find((repo) => repo.repoId === msg.repoId)
        ?.worktrees.find(
          (row) =>
            row.id === offered?.sourceWorktreeId &&
            row.kind === offered?.binding.sourceKind &&
            !row.bare &&
            !row.missing &&
            !row.prunable,
        );
      if (
        offered === undefined ||
        offered.surface !== surfaceKey(surface) ||
        offered.opening !== msg.opening ||
        offered.repoId !== msg.repoId ||
        !isDeepStrictEqual(currentMigrationRegistration(msg.repoId), offered.binding.registration) ||
        !lifecycle.isLive(surfaceKey(surface), msg.opening) ||
        source === undefined ||
        options.probeMigrationSource === undefined
      ) {
        return;
      }
      migrationOffers.delete(msg.migrateChanges.offerId);
      migrationOffer = offered;
    }
    if (create && typeof msg.path === "string" && msg.path.length > 0 && msg.repoId.length > 0) {
      if (msg.afterCreate.kind === "agent" && !admissibleLaunch(surface, msg.afterCreate)) {
        return;
      }
      const selected =
        selectedEntries === undefined
          ? undefined
          : claimProvisionMaterials(selectedEntries, selectedHeldFiles ?? new Map());
      if (selectedEntries !== undefined && selected === undefined) {
        surface.post({
          type: "worktreeMutationResult",
          verb: "create",
          repoId: msg.repoId,
          result: {
            kind: "error",
            message: "one of the files selected for this create is no longer available — reopen the dialog",
          },
        });
        return;
      }
      const request = {
        repoId: msg.repoId,
        path: msg.path,
        mode: msg.mode,
        disposition: msg.disposition,
        afterCreate: msg.afterCreate,
        ...(selected === undefined ? {} : { provision: selected }),
        ...(selectedPorts === undefined ? {} : { ports: selectedPorts }),
        ...(selectedSetup === undefined ? {} : { setup: selectedSetup }),
        ...(asimovEnvironment === undefined ? {} : { asimovEnvironment }),
        origin: surface,
      };
      const runCreate = async (): Promise<void> => {
        try {
          if (migrationOffer === undefined) {
            await create(request);
            return;
          }
          const current = await options
            .probeMigrationSource?.(migrationOffer.sourcePath, migrationOffer.binding)
            .catch(() => undefined);
          const source = cache
            .read()
            .repos.find((repo) => repo.repoId === migrationOffer.repoId)
            ?.worktrees.find(
              (row) =>
                row.id === migrationOffer.sourceWorktreeId &&
                row.kind === migrationOffer.binding.sourceKind &&
                !row.bare &&
                !row.missing &&
                !row.prunable,
            );
          if (
            source === undefined ||
            current === undefined ||
            !isDeepStrictEqual(
              currentMigrationRegistration(migrationOffer.repoId),
              migrationOffer.binding.registration,
            ) ||
            !isDeepStrictEqual(current, migrationOffer.evidence)
          ) {
            surface.post({
              type: "worktreeMutationResult",
              verb: "create",
              repoId: msg.repoId,
              result: {
                kind: "error",
                message: "the source work changed — close and reopen the dialog, then create again",
              },
            });
            return;
          }
          await create({
            ...request,
            migration: {
              sourcePath: migrationOffer.sourcePath,
              source: migrationOffer.evidence.source,
              snapshot: migrationOffer.evidence.snapshot,
              binding: migrationOffer.binding,
            },
          });
        } finally {
          disposeProvisionMaterials(selected ?? []);
        }
      };
      perform(runCreate);
    }
    return;
  };

  const worktreeSetupRetry: Arm<"worktreeSetupRetry"> = (surface, msg, actions) => {
    if (!isKnownSetupRetry(msg)) {
      return;
    }
    const repoId = repoIdOf(msg.worktreeId);
    const retry = actions.retrySetup;
    if (retry !== undefined && repoId !== undefined && actionPath(msg.worktreeId, false) !== undefined) {
      perform(() => retry({ repoId, worktreeId: msg.worktreeId, origin: surface }, msg.retryId));
    }
    return;
  };

  const worktreePickDestination: Arm<"worktreePickDestination"> = (surface, msg, _actions) => {
    // Type-checked before it enters async logic, like every other inbound
    // payload: the discriminant alone is not the payload (round-3 W1).
    if (
      typeof msg.repoId !== "string" ||
      !Number.isSafeInteger(msg.token) ||
      msg.token < 0 ||
      !Number.isSafeInteger(msg.ask) ||
      msg.ask < 0
    ) {
      return;
    }
    void pickDestination(surface, msg);
    return;
  };

  const worktreeCreateProbe: Arm<"worktreeCreateProbe"> = (surface, msg, _actions) => {
    // The discriminant alone is not the payload. Every field crosses a
    // trust boundary and then enters async logic, where a wrong type is an
    // unhandled rejection rather than a refusal (round-3 W1).
    if (!isWellFormedProbe(msg)) {
      return;
    }
    const repo = cache.read().repos.find((r) => r.repoId === msg.repoId);
    if (repo === undefined) {
      return;
    }
    // Marked BEFORE the await, which is the whole point: recording it after
    // would leave the window every superseded continuation resumes inside.
    // A probe whose token is not the opening's is unowned — a superseded
    // opening, or a token nobody minted — and must not create sequence
    // state for one (round-4 B7).
    const opening = openingFor(surface, msg.repoId, msg.token);
    if (opening === undefined || opening.latestSeq >= msg.seq) {
      return;
    }
    opening.latestSeq = msg.seq;
    // WITHDRAWN here, not when the new answer lands. Between admitting a
    // newer probe and posting its answer the previous candidate stayed
    // authorizable, which is the whole window a user's edit was supposed to
    // close (round-2 B1).
    opening.debrisCandidate = null;
    // WITHDRAWN with it, and for the same reason: between admitting a newer
    // probe and posting its answer, the previous repair stayed submittable.
    opening.publishedRepair = null;
    void answerCreateProbe(surface, msg, repo, opening);
    return;
  };

  const worktreeAuthorizeDebris: Arm<"worktreeAuthorizeDebris"> = (surface, msg, _actions) => {
    if (
      typeof msg.path !== "string" ||
      msg.path.length === 0 ||
      typeof msg.token !== "number" ||
      typeof msg.ask !== "number"
    ) {
      return;
    }
    const repo = cache.read().repos.find((r) => r.repoId === msg.repoId);
    if (repo === undefined) {
      return;
    }
    const opening = openingFor(surface, msg.repoId, msg.token);
    // The path this opening's latest answer PUBLISHED as debris, and no
    // other. A request naming any other directory is not the request the
    // panel makes, and answering it would hand out a delete for a
    // destination the user was never shown (round-1 B1).
    if (opening === undefined || opening.debrisCandidate !== msg.path) {
      return;
    }
    void answerDebrisAuthorization(surface, msg);
    return;
  };

  const worktreeCreateClosed: Arm<"worktreeCreateClosed"> = (surface, msg, _actions) => {
    // The only signal that a create conversation ENDED. Closure cannot be
    // inferred from the next opening: a form cancelled and never reopened
    // is exactly the case such a rule would never reach, and it is the case
    // that matters most — its read keeps the right to mint host authority
    // for a form the user dismissed (design.md D3).
    const key = surfaceKey(surface);
    // Retirement spends the same authority an answer does. A close naming
    // an opening this surface no longer holds is a late or replayed message
    // from a form already replaced; honouring it would let it silence the
    // form the user is looking at now (D2).
    //
    // The shape check is defensive and honestly so: a live opening is
    // always a positive integer, so the comparison already refuses every
    // malformed value, and no test can tell the two apart. It is here
    // because reading an unvalidated field as an identity is wrong, not
    // because a symptom was measured.
    if (!namedOpening(msg.opening) || !lifecycle.isLive(key, msg.opening)) {
      return;
    }
    // What the opening issued goes with it (D5). A create citing an evicted
    // id needs no new refusal path: § 2.4 already requires no create, no
    // provisioning, a freshly resolved model, and a second submission.
    retireOpening(key);
    return;
  };

  const requestWorktreeCreateDefaults: Arm<"requestWorktreeCreateDefaults"> = (surface, msg, _actions) => {
    // Answered by the HOST because only it knows the configured root, the
    // repo's own layout, and which candidates are free. A panel-computed
    // path would state a destination the create might refuse.
    //
    // Before the repository read and before the destination is resolved:
    // work done for a message the host will refuse anyway is work an
    // untrusted sender chose (round-1 B1).
    if (!namedOpening(msg.opening)) {
      return;
    }
    const repo = cache.read().repos.find((r) => r.repoId === msg.repoId);
    if (repo === undefined) {
      return;
    }
    // The repo's own name is the base a branch is appended to, so the form's
    // placeholder and the destination it opens on describe one scheme. With
    // a branch, the base is what the form would have shown for it — the
    // host resolves the collision on THAT, not on the bare default. Through
    // the SAME resolver the probe answers with, so the destination the
    // resolution names and the one this reply names cannot drift (W4).
    const { root, base, bare, freePath: path } = resolveDestination(repo, msg.branch ?? "");
    // Resolved ONCE per form, not per keystroke. This message is re-sent
    // as the user types a branch, and a fresh offer each time would churn
    // ids under a dialog the user has not stopped looking at — and
    // superseding evicts, so a submission mid-type would name nothing.
    // § 4.0's rule is that the host keeps the model it displayed.
    //
    // A branch-less ask is a form OPENING; an ask carrying one is the user
    // typing in a form already open. That distinction already exists on this
    // path — the webview relies on it to tell a superseded ask's leftovers
    // from a current answer — so it is what decides when to resolve a fresh
    // model, and no new message is needed to learn that a form closed.
    const opening = msg.branch === undefined;
    const offerKey = { surface: surfaceKey(surface), repoId: msg.repoId };
    const reading = `${offerKey.surface} ${msg.repoId}`;
    const key = surfaceKey(surface);
    // Synchronously, before anything awaits. An opening ask ADOPTS the
    // opening the panel named; any other request must already be riding one
    // this surface holds, or it is answered with nothing — a retired or
    // never-seen opening has no authority to spend (D2).
    if (opening) {
      // An opening ask may only REPEAT the one being served or ADVANCE past
      // everything this surface has ever named. Anything else is a replay of
      // a spent form or a delayed predecessor, and adopting either put the
      // host back onto a conversation the user had already ended (B1).
      const admission = lifecycle.admitOpen(key, msg.opening);
      if (!admission.admitted) {
        return;
      }
      // A DIFFERENT opening retires the last one whole — every read slot it
      // holds and every offer it issued, not just the ones this new opening
      // happens to re-ask about. Rewriting only the slots it touches left a
      // read for another repository still holding its predecessor, and that
      // read published an offer for a form that no longer existed.
      if (admission.supersedes) {
        retireOpening(key);
      }
      lifecycle.markOpen(key, msg.opening);
    } else if (!lifecycle.isLive(key, msg.opening)) {
      return;
    }
    if (
      opening &&
      msg.sourceWorktreeId !== undefined &&
      Number.isSafeInteger(msg.sourceGeneration) &&
      (msg.sourceGeneration as number) > 0 &&
      options.probeMigrationSource !== undefined
    ) {
      const slot = `${key}::${msg.opening}`;
      const reading = migrationReading.get(slot);
      if (reading === undefined) {
        const sourceGeneration = msg.sourceGeneration as number;
        const mine = {
          sequence: bumpMigrationSequence(),
          repoId: msg.repoId,
          sourceWorktreeId: msg.sourceWorktreeId,
          sourceGeneration,
        };
        migrationReading.set(slot, mine);
        const source = repo.worktrees.find(
          (row) => row.id === msg.sourceWorktreeId && !row.bare && !row.missing && !row.prunable,
        );
        const registration = cache.registrationFor(msg.repoId, sourceGeneration);
        if (source !== undefined && registration !== undefined) {
          const sourcePath = source.id;
          const binding = { registration, sourceKind: source.kind };
          void options
            .probeMigrationSource(sourcePath, binding)
            .then((evidence) => {
              const currentReading = migrationReading.get(slot);
              const currentSource = cache
                .read()
                .repos.find((candidate) => candidate.repoId === msg.repoId)
                ?.worktrees.find(
                  (row) =>
                    row.id === source.id && row.kind === source.kind && !row.bare && !row.missing && !row.prunable,
                );
              if (
                disposed() ||
                !surfaces.has(surface) ||
                !lifecycle.isLive(key, msg.opening) ||
                currentReading?.sequence !== mine.sequence ||
                currentReading.sourceWorktreeId !== mine.sourceWorktreeId ||
                currentReading.sourceGeneration !== mine.sourceGeneration ||
                !isDeepStrictEqual(currentMigrationRegistration(msg.repoId), registration) ||
                currentSource === undefined ||
                evidence === undefined ||
                !Number.isSafeInteger(evidence.snapshot.count) ||
                evidence.snapshot.count <= 0
              ) {
                return;
              }
              const offerId = (options.migrationOfferId ?? randomUUID)();
              if (migrationOffers.has(offerId)) {
                return;
              }
              migrationOffers.set(offerId, {
                surface: key,
                opening: msg.opening,
                repoId: msg.repoId,
                sourceWorktreeId: source.id,
                sourcePath,
                binding,
                evidence,
              });
              deliver(surface, {
                type: "worktreeMigrationOffer",
                repoId: msg.repoId,
                opening: msg.opening,
                sourceWorktreeId: source.id,
                offerId,
                count: evidence.snapshot.count,
              });
            })
            .catch(() => {});
        }
      }
    }
    // A DIFFERENT opening supersedes: it starts its own read and retires the
    // previous one's right to publish. A repeat of the one already reading
    // JOINS it — starting a second would let a duplicated message suppress
    // the legitimate answer and grow reads without bound (D4). Only the READ
    // joins: the destination reply below is cheap and idempotent, and
    // withholding it would make a duplicate message cost the form its
    // destination.
    const joins = provisionReading.get(reading) === msg.opening;
    if (options.readProvisioning && opening && !joins) {
      const mine = msg.opening;
      provisionReading.set(reading, mine);
      void options
        .readProvisioning(repo.mainPath)
        .then(async (model) => {
          // The surface may have detached while the file was being read. A
          // post to a dead surface is at best wasted and at worst revives an
          // offer the detach was supposed to forget (B6).
          if (disposed() || !surfaces.has(surface)) {
            return;
          }
          // A later opening already took over this form. Its own read is in
          // flight or answered, and this model describes a form the user has
          // closed.
          // Both records, not just the read slot. The slot is per
          // repository and the opening is per surface, so the slot alone
          // could not see an opening superseded through a DIFFERENT
          // repository — that read kept its slot and published for a form
          // that no longer existed (.reviews/round-1.md B2).
          //
          // The supersede path now sweeps those slots as well, so either
          // half alone would refuse this. That is deliberate and each is
          // stated separately: the sweep bounds the map, and this states
          // the actual invariant — publish only for the opening still being
          // served. Mutating either alone is therefore NOT caught by the
          // suite; mutating both is.
          if (provisionReading.get(reading) !== mine || !lifecycle.isLive(key, mine)) {
            return;
          }
          // The source this opening starts on, recorded once, from the first
          // offer it is given. A later offer is a source the user chose or a
          // save's own re-read, and neither is where the form began
          // (design.md D18).
          const start = `${key} ${msg.repoId} ${msg.opening}`;
          if (!provisionBaseline.has(start)) {
            provisionBaseline.set(start, model.providers.find((p) => p.active)?.id ?? "");
          }
          const previewed = await previewProvisioning(repo, model);
          if (
            disposed() ||
            !surfaces.has(surface) ||
            provisionReading.get(reading) !== mine ||
            !lifecycle.isLive(key, mine)
          ) {
            return;
          }
          const offer = issueWithAdded(offerKey, start, previewed);
          deliver(surface, {
            type: "worktreeProvisionOffer",
            repoId: msg.repoId,
            opening: msg.opening,
            offerId: offer.offerId,
            model: offer.model,
          });
        })
        // The section is not the create. A provider layer that cannot
        // answer must not delay or refuse the destination the form needs.
        //
        // Clearing the marker is the FAILURE path's job, and only its job.
        // It used to run in a `finally`, so a read that succeeded released
        // the slot too — which bounded concurrent duplicates and nothing
        // else: a repeat delivered after the read settled found no marker,
        // read again, and rotated the offer under a dialog the user had not
        // stopped looking at (.reviews/round-1.md B4). A successful read's
        // marker is now released by retirement — close, supersede or detach.
        //
        // A FAILED read is different, and D4 says so: the marker records
        // that a read succeeded, not that one was attempted. Held through a
        // failure it would cost the user the provisioning section for the
        // life of the form, with no way back but closing and reopening it.
        //
        // Only the generation that still owns the slot clears it — a
        // superseded read failing late must not unlock the live one.
        .catch(() => {
          if (provisionReading.get(reading) === mine) {
            provisionReading.delete(reading);
          }
        });
    }
    surface.post({
      type: "worktreeCreateDefaults",
      repoId: msg.repoId,
      opening: msg.opening,
      root,
      prefix: repo.label,
      path,
      // The branch this answer is FOR. Replies race the typing that caused
      // them, and a form cannot tell a current answer from a stale one
      // without it (round-4 B12).
      ...(msg.branch === undefined ? {} : { branch: msg.branch }),
      // The taken NAME, never the path to it. The destination line the form
      // draws above this already carries the path, and stating it a second
      // time is what WT-009.3's acceptance forbids (worktree-rpc.md § 2).
      // `base` is exactly that name: `bare` is `join(root, base)`, because
      // the predicate it was resolved with never reports a collision.
      ...(path === bare ? {} : { collidedWith: base }),
    });
    return;
  };

  const requestWorktreeRefs: Arm<"requestWorktreeRefs"> = (surface, msg, _actions) => {
    // One group, not a snapshot of the workspace. This runs once per
    // repository when the dialog opens, so `cache.read()` here made the
    // open cost R × O(R + W) in copying alone (round-1 B3).
    // This is the message that SEEDS the record probe and debris
    // authorization are gated on, so it is an authority door and has to be
    // guarded like one. Retirement swept the records and this writer put one
    // straight back: replaying a retired token here recreated the entry, and
    // the probe-then-authorize pair then reached `issueDebrisAuthorization`
    // exactly as it would have before the close (.reviews/round-3.md B2).
    // Closing the sweep without closing the writer left D5's own sentence —
    // retirement withdraws every channel the opening carries — false.
    //
    // Equality, not the defaults ask's repeat-or-advance rule: refs never
    // ESTABLISHES an opening. The branch-less defaults ask is the only door
    // that does, and the panel always sends it first, so a legitimate refs
    // ask is always riding an opening this surface already holds. Letting
    // refs advance the mark too would give a second message the power to
    // mint a form's identity.
    //
    // `namedOpening` here is defence in depth and no test can kill it on its
    // own: the lifecycle only ever serves tokens that already passed it on the
    // defaults channel, so the equality alone rejects `0`, a fraction and a
    // string too. Kept because the shape check is what makes the equality's
    // guarantee legible at this door rather than three hundred lines away —
    // the same call the close-side guard makes.
    const refsKey = surfaceKey(surface);
    if (!namedOpening(msg.token) || !lifecycle.isLive(refsKey, msg.token)) {
      return;
    }
    /** Still the opening this read belongs to, checked after every await. */
    const refsLive = (): boolean => lifecycle.isLive(refsKey, msg.token);
    const repo = cache.readRepo(msg.repoId);
    if (repo === undefined) {
      return;
    }
    // Started here because one gesture opens the form, and resolved on its
    // own promise posting its own message: a forge that is slow, absent or
    // unauthenticated must not delay the local list underneath it
    // (worktree-create.md § 4.1, design.md D3). There is deliberately no
    // code path on which the refs answer awaits this one.
    const forge = options.readPullRequests;
    if (forge !== undefined) {
      const unavailable = {
        type: "worktreePullRequests",
        token: msg.token,
        repoId: msg.repoId,
        available: false,
      } as const;
      const postForge = (answer: PullRequestsRead | undefined): void => {
        if (disposed() || !surfaces.has(surface)) {
          return;
        }
        // The form may have closed while the forge was answering. A reply
        // for a retired opening is a reply for a conversation that ended.
        if (!refsLive()) {
          return;
        }
        // Unavailable is POSTED rather than withheld: the form has a row
        // to render for it, and silence would leave "not asked yet" and
        // "asked and there are none to be had" indistinguishable.
        surface.post(
          answer?.ok === true
            ? {
                type: "worktreePullRequests",
                token: msg.token,
                repoId: msg.repoId,
                pullRequests: answer.pullRequests,
                truncated: answer.truncated,
                available: true,
              }
            : unavailable,
        );
      };
      void forge({ cwd: repo.mainPath })
        .then(postForge)
        // Discovery, never the create. A reader that throws must not take
        // the destination reply — or the refs answer — down with it. It also
        // must not leave the form waiting forever: a rejection is one more
        // way the forge did not answer, so it POSTS the unavailable row
        // rather than being swallowed (.reviews/round-1.md W1).
        .catch(() => {
          postForge(undefined);
        });
    }
    const read = options.readRefs;
    if (read === undefined) {
      return;
    }
    // Kept so the probe can classify against it instead of asking git a
    // second time for an answer the dialog's opening already paid for
    // (design.md D2). The PROMISE rather than its value: a settle that
    // lands before the read resolves joins this one rather than starting
    // another. One entry per repository, replaced on every ask.
    const inFlight = read({ cwd: repo.mainPath, worktrees: repo.worktrees });
    // This ask IS the new opening: the record is REPLACED, so the previous
    // one is gone without anything having to go looking for it (B7, W8).
    openings.set(openingKey(surface, msg.repoId), {
      token: msg.token,
      read: inFlight,
      latestSeq: Number.NEGATIVE_INFINITY,
      debrisCandidate: null,
      publishedRepair: null,
      // A fresh opening was offered no folder. This is also what a REPLAY of
      // this request costs a form that had one: the record is dropped, which
      // narrows the honoured area to the configured root and can never widen
      // it (design.md D4).
      chosenRoot: null,
      // A fresh opening has confirmed nothing, so a pick still suspended on
      // the opening this one replaced can never match it.
      pickGeneration: 0,
    });
    void inFlight
      .then((answer) => {
        // The surface may have detached while git was answering. Posting to
        // a dead one is at best wasted, and the form it described is gone.
        if (disposed() || !surfaces.has(surface)) {
          return;
        }
        // A failed read posts nothing: the form treats absent as "not told
        // yet", which is honest, and the create-new row is never gated on
        // this. Saying `refs: []` would state that the repository has no
        // branches — a claim git declined to make.
        if (answer.ok !== true) {
          return;
        }
        // Same rule as the forge continuation above: retirement outranks a
        // read that was already running when it happened.
        if (!refsLive()) {
          return;
        }
        surface.post({
          type: "worktreeRefs",
          token: msg.token,
          repoId: msg.repoId,
          refs: answer.refs,
          truncated: answer.truncated,
        });
      })
      // The list is discovery, never the create. A reader that throws must
      // not take the destination reply down with it.
      .catch(() => {});
    return;
  };

  return {
    worktreeCreate,
    worktreeSetupRetry,
    worktreePickDestination,
    worktreeCreateProbe,
    worktreeAuthorizeDebris,
    worktreeCreateClosed,
    requestWorktreeCreateDefaults,
    requestWorktreeRefs,
  };
}
