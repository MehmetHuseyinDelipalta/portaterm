// src/webview/worktree/createDialog/resolutionAsks.ts — What this form asked the
// host about the current selection, and what came back.
//
// Extracted from `openWorktreeCreateDialog` by change `decompose-create-dialog`
// (design.md D1, task 1_6). Five `let` bindings in the dialog closure carried
// the whole request/answer correlation, and they were read from roughly two
// dozen places across nine hundred lines — so "has this selection been asked
// about, and is the answer on screen the answer to it" was a question only a
// rendered dialog could answer.
//
// `effective` leaves as `resolution()` and NOT under its old name (task
// Boundary). It is read for its fields by the rendering pass — `baseValid`,
// `mode`, `occupiedCandidate`, `blockedBy`, `branchValid` — and that pass is
// task 1_9's, not this one's, so an accessor is what the seam actually is here.
// The three call sites that were whole operations moved in regardless:
// `withdrawTarget`, and the bodies of the resolution and defaults replies.
//
// D4's negation trap, checked by hand at every moved site rather than trusted to
// the type check, because `!x &&` reads a function as truthy in silence:
//
//   * `outstanding || pickAsked !== null`   -> `asks.outstanding() || …`
//   * `: resolutionOutstanding ?`           -> `: asks.classifying() ?`
//   * `!outstanding && !resolutionOutstanding` in `withdrawTarget` moved in
//     whole and still reads the bindings, so there is nothing to convert.
//
// `CreateSelection` comes with the asks — it is the shape of the question, and
// the facade re-exports it because that is where the test and the host deps
// import it from.
//
// DOM-touching in two places only (`nameInput.value`, `baseInput.value`), both
// reading what the user typed to decide whether an answer still describes it, so
// no suite beside this file (design.md D2): the 386-case dialog suite drives the
// correlation end to end — stale answers by query, by repository and by
// withdrawal, the re-ask on every settled edit, and the modes a resolution
// writes back.

import type { ProbeBase, WorktreeCreateResolutionMessage } from "../../../types/messages";
import type { WorktreeCreateDraft, WorktreeRef } from "../worktreeViewTypes";
import type { BranchChoices } from "./branchChoices";
import type { DestinationCandidate } from "./draftModel";

/** Everything the host needs to say what a submit of this form would do. */
export interface CreateSelection {
  repoId: string;
  /** The branch being named, or the ref being detached at. */
  branch: string;
  /** Absent where the mode refuses a base, so no verdict is asked for one. */
  base?: ProbeBase;
  /** Present only where the user typed over the derived destination. */
  candidatePath?: string;
  /** Present only where the host still holds a folder this form chose. */
  useChosenFolder?: true;
}

export interface ResolutionAsksDeps {
  readonly nameInput: HTMLInputElement;
  readonly baseInput: HTMLInputElement;
  /** Read and written: a resolution states the mode it settled on. */
  readonly draft: WorktreeCreateDraft;
  readonly branches: BranchChoices;
  /** The refs the current repository was told about; empty until it is told. */
  offeredRefs(): readonly WorktreeRef[];
  destinationCandidate(): DestinationCandidate;
  /** Withdrawn with the question — an authorization is issued over one path. */
  withdrawRecover(): void;
  onSelectionChange?: (selection: CreateSelection) => void;
  /** Present exactly when an answer can actually arrive. */
  canResolve: boolean;
  syncDerived(settled?: boolean): void;
}

export interface ResolutionAsks {
  /** The ONE resolution this form is acting on (D8), or null. */
  resolution(): WorktreeCreateResolutionMessage | null;
  /** A destination request has no answer yet. Submit waits for it. */
  outstanding(): boolean;
  /** The classification for the typed selection has not landed. */
  classifying(): boolean;
  /** The selection on screen has not been asked about, and could be. */
  unasked(): boolean;

  selection(): CreateSelection;
  targetOf(resolution: WorktreeCreateResolutionMessage): string;
  heldBranch(): string | undefined;
  deriveChoice(): void;

  /** Ask the host what this selection would do, at most once each. */
  ask(): void;
  /** Emptying the field retracts the question, and everything it armed with it. */
  withdraw(): void;

  /** Apply a resolution reply that survived the dialog's own guards. */
  applyResolution(resolution: WorktreeCreateResolutionMessage): void;
  /** Whether a defaults reply answers the question this form actually asked. */
  answersOurDefaults(next: { repoId: string; answersBranch?: string }): boolean;
  /** A defaults reply carries the destination, so it settles that question too. */
  settleDestination(): void;
}

export function createResolutionAsks(deps: ResolutionAsksDeps): ResolutionAsks {
  const { baseInput, branches, draft, nameInput } = deps;

  /** The repo AND branch the last host request was made for, so edits do not
   *  re-ask — and so a repo switch is not mistaken for the same question. The
   *  request is repo-scoped; a key that is not reuses one repo's answer for
   *  another, and the destination line is what states that answer. */
  let askedFor: string | null = null;
  /**
   * The repo and branch of the same request, kept separately because the
   * DEFAULTS reply can only echo those two — a base or destination edit changes
   * `askedFor` without changing the question that reply is answering.
   */
  let defaultsAskedFor: string | null = null;
  /**
   * The whole selection, so an edit to the base or the destination re-asks.
   * Keyed on the same value the request carries — anything the key drops is a
   * field the form could change without the host ever hearing about it.
   */
  const askKey = (s: CreateSelection): string =>
    JSON.stringify([s.repoId, s.branch, s.base ?? null, s.candidatePath ?? null, s.useChosenFolder ?? false]);

  /** True while a destination request has no answer yet. Submit waits for it. */
  let outstanding = false;
  /**
   * The ONE resolution this form is acting on (D8).
   *
   * Mode, the stated action and the guards all read this rather than each
   * interpreting the answer for themselves — two interpretations of one answer
   * is how a repair could act on a different path from the one on screen.
   */
  let effective: WorktreeCreateResolutionMessage | null = null;
  /**
   * True while the classification for the typed selection has not landed.
   *
   * Submit waits for it as well as the destination. Without this the form could
   * submit an existing branch as fresh while its own classification was still in
   * flight — the failure-after-submit this change exists to remove (round-1 B2).
   */
  let resolutionOutstanding = false;

  /** What the form would start a new branch from, where the mode takes one. */
  function probeBase(): ProbeBase | undefined {
    // The toggle and the field, and nothing the ANSWER set: `branchMode` also
    // carries `existing` and `reattach`, which the resolution writes back, so
    // reading those here would change the question every time it was answered.
    // Which modes refuse a base is the HOST's to decide — it withholds the
    // verdict itself (D7).
    if (draft.branchMode === "detached") {
      return { kind: "detached" };
    }
    const ref = draft.baseRef.trim();
    return ref.length === 0 ? undefined : { kind: "ref", ref };
  }

  /** The selection as the host would be told it. */
  function selection(): CreateSelection {
    const base = probeBase();
    return {
      repoId: draft.repoId,
      branch: draft.branchMode === "detached" ? draft.baseRef : draft.branchName,
      ...(base === undefined ? {} : { base }),
      ...deps.destinationCandidate(),
    };
  }

  /**
   * The directory this resolution's create would act on.
   *
   * A repair acts on the registration's OWN path; `freePath` is the free suffix
   * the create would have taken instead, and stating that beside a checkout
   * already sitting there described a directory this create will never touch
   * (round-3 B3).
   */
  function targetOf(resolution: WorktreeCreateResolutionMessage): string {
    // The mode the FORM holds, not the one the answer carried: under detached
    // the classification is discarded (D5), so a repair path it named is not a
    // directory this create will ever act on.
    const mode = resolution.mode;
    if (draft.branchMode === "detached") {
      return resolution.freePath;
    }
    if (mode.kind === "reattach") {
      return mode.repairPath;
    }
    // An adoption's own directory, on the same rule: `freePath` is the suffix
    // the create would have taken INSTEAD, and stating it beside the checkout
    // being re-registered describes a directory this create never touches.
    return mode.kind === "adopt" ? mode.adoptPath : resolution.freePath;
  }

  /** Ask the host what this selection would do, at most once each. */
  function askForDestination(): void {
    const now = selection();
    // There is nothing to resolve for a create with no target. Asking anyway got
    // back a full plan for the empty name — a free suffixed path, the collision
    // it stepped around, an offer to clear a folder — and the form drew all of it
    // under a field nobody had typed in. The seeded destination line already says
    // what the form knows at this point, and says it as a template rather than as
    // a decision (260906-at-create-dialog-resolves-an-empty-name).
    const target = draft.branchMode === "detached" ? draft.baseRef : now.branch;
    if (target.trim().length === 0) {
      return;
    }
    const key = askKey(now);
    if (key === askedFor) {
      return;
    }
    askedFor = key;
    defaultsAskedFor = `${now.repoId}\u0000${now.branch}`;
    if (deps.onSelectionChange !== undefined) {
      // EVERY changed selection, the destination override included. Exempting
      // it — on the reasoning that an override changes which path is reported
      // on rather than what the create does — left the override submittable
      // against an answer that was never about it, and under `reattach` left
      // the form showing the override while the request carried the repair
      // target (round-4 B3).
      outstanding = true;
      // A new question invalidates the old answer immediately, rather than
      // leaving the previous classification readable until the reply lands.
      effective = null;
      // And with it the acceptance: an authorization is issued over ONE path and
      // what was in it, so carrying it across a changed selection would submit a
      // token for a directory this create is no longer aimed at.
      deps.withdrawRecover();
      // Only where an answer is actually coming. With no resolver bound none
      // ever arrives, and gating on it would leave Create permanently disabled
      // rather than waiting for something.
      resolutionOutstanding = deps.canResolve;
      deps.onSelectionChange(now);
    }
  }

  /**
   * The directory holding the branch this form would submit, if one does.
   *
   * The guard, stated once and read in two places: `syncDerived` to disable
   * Create, and `submit` to refuse a route that reached it without re-deriving.
   */
  function heldBranch(): string | undefined {
    if (draft.branchMode === "detached") {
      return undefined;
    }
    // A repair is not blocked by the registration it repairs. `heldBy` comes
    // from the listing, which reports a prunable holder exactly like a live
    // one; the resolution is what told these apart, and it says `blockedBy`
    // when a LIVE worktree holds the branch and `reattach` when the holder is
    // the stale registration this create would fix (design.md D3).
    if (draft.branchMode === "reattach") {
      return undefined;
    }
    // The RESOLUTION when there is one. It is the answer that told a live
    // holder from the stale registration a repair would fix, so re-deriving the
    // holder from the listing here was a second interpretation of it
    // (round-3 B3).
    if (effective !== null) {
      return effective.blockedBy?.ownerPath;
    }
    // Otherwise from the typed NAME against the current repository's list, not
    // from `choice`. Committing the create-new row deliberately sets `choice`
    // to `new` while leaving the typed text alone, so a guard reading `choice`
    // stops seeing the holder and submits a branch another worktree holds
    // (round-2 B4).
    //
    // Still the current repository's list and nothing else: the round-1 W1
    // fallback to a standing selection is not restored, because it could not
    // tell "this repo has the ref and it is free" from "this repo does not
    // have it".
    const typed = nameInput.value.trim();
    return typed.length === 0 ? undefined : deps.offeredRefs().find((ref) => ref.name === typed)?.heldBy;
  }

  /**
   * Re-decide what the typed text means, against the repository the form is on
   * NOW. The single source D4 claims: mode is derived here and nowhere else.
   *
   * Two-way on purpose. Only ever upgrading to `existing` left a branch that
   * exists in one repository still submitting as `existing` after a switch to
   * one where it does not (round-1 B2).
   */
  function deriveChoice(): void {
    const typed = nameInput.value.trim();
    branches.derive(typed);
    if (draft.branchMode === "detached") {
      return;
    }
    // A RESOLVED mode is the host's answer about a directory, and this local
    // derivation only ever knows the ref list — which can be truncated, and
    // which arrives on its own schedule. Letting it demote `adopt` or
    // `reattach` left the form stating it would re-register a fixed directory
    // while the controls were enabled for a different mode, and the submitted
    // mode still adopt (round-1 F008). It only holds while the typed branch is
    // the one that answer was about; anything else re-derives as before.
    if ((draft.branchMode === "adopt" || draft.branchMode === "reattach") && effective?.query.trim() === typed) {
      return;
    }
    draft.branchMode = branches.mode();
  }

  /**
   * Emptying the field retracts the question, and everything it armed with it.
   *
   * Run on EVERY pass rather than from `askForDestination`, which only runs on a
   * settled edit: deleting a name without leaving the field is an ordinary
   * `input`, so the retirement never ran and the deleted name's own destination,
   * collision, refusal and destructive recovery offer stayed on screen for as
   * long as the caret did (round-2 F001). Requests stay settled-only; it is the
   * retirement that has to keep up with the text.
   *
   * Before anything derived is read, for the same reason: a pass that retires
   * after rendering has already drawn the answer it is about to discard.
   *
   * Idempotent, and guarded so a form sitting empty does not call
   * `recover.withdraw` on every keystroke elsewhere.
   */
  function withdrawTarget(): void {
    if (askedFor === null && !outstanding && !resolutionOutstanding && effective === null) {
      return;
    }
    askedFor = null;
    defaultsAskedFor = null;
    effective = null;
    outstanding = false;
    resolutionOutstanding = false;
    deps.withdrawRecover();
  }
  return {
    resolution: () => effective,
    outstanding: () => outstanding,
    classifying: () => resolutionOutstanding,
    unasked: () => deps.onSelectionChange !== undefined && askKey(selection()) !== askedFor,

    selection,
    targetOf,
    heldBranch,
    deriveChoice,
    ask: askForDestination,
    withdraw: withdrawTarget,

    applyResolution(resolution) {
      // An answer the user has typed past describes a selection that is gone.
      // This is what `query` echoes for — the token separates two OPENINGS, and
      // only this separates two edits within one (design.md D1).
      // Under detached the selection's branch is the REF, so that is what the echo
      // is compared against — the branch field is not what was asked about.
      const detached = draft.branchMode === "detached";
      if (resolution.query.trim() !== (detached ? baseInput.value : nameInput.value).trim()) {
        return;
      }
      // And only where the question still stands. A reply that outlives a
      // withdrawal can match the query again the moment the user retypes the same
      // name, and would then answer a question this form has not asked yet — the
      // text matching is not identity, it is only a cheap first test (round-2 F001).
      if (askedFor === null) {
        return;
      }
      // Every mode, not only `reattach`. Dropping the others left `fresh`,
      // `reuse` and `adopt` on whatever the local text derivation last guessed,
      // so a declined corroboration kept the form armed for a repair the host had
      // just withdrawn (round-1 B3).
      effective = resolution;
      resolutionOutstanding = false;
      // It carries `freePath`, which is the destination the form states and
      // submits, so this answer settles the destination question too.
      outstanding = false;
      // Detached is the user's own toggle and outranks a classification of the
      // typed text: the resolution answers "what is this branch name", and under
      // detached the field is not a branch name at all. It outranks the MODE and
      // nothing else — the answer's destination is no less true for the toggle
      // being on, and discarding it wholesale left a detached create offered
      // against a destination nobody had resolved (D5, round-5 B10).
      switch (detached ? "detached" : resolution.mode.kind) {
        case "detached":
          break;
        case "reattach":
          draft.branchMode = "reattach";
          break;
        case "reuse":
          draft.branchMode = "existing";
          break;
        case "adopt":
          draft.branchMode = "adopt";
          break;
        case "fresh":
          draft.branchMode = "new";
          break;
      }
      // Settled, because applying a resolution can CHANGE the selection: a mode
      // that refuses the destination withdraws the override, and the form must
      // ask about the selection it now holds rather than sit behind a gate for a
      // question nobody will ask. It converges — the second answer withdraws
      // nothing further, so the key is stable (round-4 B3).
      deps.syncDerived(true);
    },

    answersOurDefaults(next) {
      return next.answersBranch === undefined || `${next.repoId}\u0000${next.answersBranch}` === defaultsAskedFor;
    },

    settleDestination() {
      outstanding = false;
    },
  };
}
