// src/webview/worktree/createDialog/draftModel.ts — What the create form's
// answer IS, with no reference to what draws it.
//
// Extracted from `openWorktreeCreateDialog` by change `decompose-worktree-webview`
// (design.md D1, task 2_1). The closure held the answer, the DOM that states it
// and the correlation of host asks in one scope, so "what would this form submit"
// could only be asked by building a dialog.
//
// What did NOT come with it, and why:
//
//   * the destination DERIVATION. It reads `nameInput.value`, consults
//     `document.activeElement` before it writes, and writes `pathInput.value`.
//     It is the DOM stating the answer, not the answer; it stays there and reads
//     this model instead.
//   * `destExact`, `activeAt`, `listOpen` — presentation.
//   * `pickAsks` / `pickAsked` — request correlation, not the answer. The
//     withdrawal `stateDestination` performs on them stays with them; this module
//     is told the same edit and moves only its own half.
//
// The test beside this file declares NO environment pragma, so it runs under
// node: a `document` or an `HTMLElement` reaching in here throws rather than
// quietly passing under the view's jsdom (OBL-4).

import type { WorktreeCreateDraft, WorktreeOpenAfter } from "../worktreeViewTypes";

/**
 * What the form OFFERS, which is not the wire vocabulary. Opening the folder is
 * one intent with two destinations; `folderMode` picks between them and
 * `draft.openAfter` is derived from the pair.
 */
export type AfterChoice = "none" | "terminal" | "agent" | "folder";

/**
 * The one place a stated destination becomes form state — three states and every
 * edge between them (design.md D6): derived under the configured root, derived
 * inside a folder the host offered this form, or typed.
 */
export type DestinationEdit =
  | { readonly kind: "typed"; readonly path: string }
  | { readonly kind: "chosen" }
  | { readonly kind: "repoChanged" };

/** The destination half of what the host is told a submit would do. */
export interface DestinationCandidate {
  readonly candidatePath?: string;
  readonly useChosenFolder?: true;
}

export interface DraftModelDeps {
  readonly initialRepoId: string;
  readonly initialAfterChoice: AfterChoice;
}

export interface DraftModel {
  /**
   * The draft itself, mutated in place by the fields that own their own value —
   * `branchName`, `baseRef`, `branchMode`, `repoId`. Exposed rather than wrapped
   * because it is what `onSubmit` receives: a copy here would be a second answer.
   */
  readonly draft: WorktreeCreateDraft;

  pathIsDerived(): boolean;
  usingChosen(): boolean;
  supplied(): string;
  afterChoice(): AfterChoice;
  folderMode(): WorktreeOpenAfter;
  closed(): boolean;

  /** True once this opening is over. Read by every bound applier. */
  close(): void;

  setAfterChoice(choice: AfterChoice): void;
  setFolderMode(mode: WorktreeOpenAfter): void;

  /**
   * Only a choice the rebuild actually withdrew is reset. The folder choice is
   * always offered, so a repo switch that drops the agent one must leave it —
   * and its secondary selection — exactly where the user put them.
   */
  retargetAfterChoice(offered: readonly AfterChoice[], fallback: AfterChoice): void;

  /** `draft.openAfter` is derived from the choice and the folder mode — one wire
   *  value, never two sources for it. */
  applyOpenAfter(): void;

  /** The headless half of the form's `stateDestination`. */
  stateDestination(next: DestinationEdit): void;

  /**
   * The mode refuses a destination, so any override is WITHDRAWN, not merely
   * ignored — including the chosen folder, which would otherwise give the form
   * two meanings of "withdrawn" (round-1 F004).
   */
  withdrawDestination(): void;

  /** ONE value, read by the destination line and by the submission. */
  statePath(path: string): void;

  /** Only an override travels. The derived path is the host's own answer coming
   *  back, and sending it would pin the resolution to what it just produced. */
  destinationCandidate(): DestinationCandidate;
}

export function createDraftModel(deps: DraftModelDeps): DraftModel {
  const draft: WorktreeCreateDraft = {
    repoId: deps.initialRepoId,
    branchMode: "new",
    branchName: "",
    baseRef: "",
    path: "",
    // The derivation rule at t=0 rather than a copy of the choice: `openAfter`
    // is the wire value and "folder" is not one of them, so the pair has to be
    // consulted here for the same reason `applyOpenAfter` consults it later.
    openAfter: deps.initialAfterChoice === "folder" ? "addToWorkspace" : deps.initialAfterChoice,
  };
  /** True until the user edits the path themselves; after that we stop deriving it. */
  let pathIsDerived = true;
  /**
   * The destination is derived inside a folder the HOST offered this form.
   *
   * A flag, never a path: the form has no folder to hold that the host did not
   * give it, and sending one back would create a webview-supplied path to
   * resolve (design.md D5). Withdrawn by typing and by switching repository.
   */
  let usingChosen = false;
  /**
   * The destination the user typed — the QUESTION, never the answer (D8).
   *
   * `draft.path` is what the form states and submits, and once a resolution has
   * landed that is the resolution's own target. Keeping the candidate here is
   * what lets the two differ: a candidate the host suffixed past, or refused
   * because it resolves outside the create root, stays askable and visible in
   * the field while the create carries the path the host actually answered.
   */
  let supplied = "";
  /** What the user picked, in the form's vocabulary. */
  let afterChoice: AfterChoice = deps.initialAfterChoice;
  let folderMode: WorktreeOpenAfter = "addToWorkspace";
  let closed = false;

  return {
    draft,

    pathIsDerived: () => pathIsDerived,
    usingChosen: () => usingChosen,
    supplied: () => supplied,
    afterChoice: () => afterChoice,
    folderMode: () => folderMode,
    closed: () => closed,

    close() {
      closed = true;
    },

    setAfterChoice(choice) {
      afterChoice = choice;
    },

    setFolderMode(mode) {
      folderMode = mode;
    },

    retargetAfterChoice(offered, fallback) {
      if (!offered.includes(afterChoice)) {
        afterChoice = fallback;
      }
    },

    applyOpenAfter() {
      draft.openAfter = afterChoice === "folder" ? folderMode : afterChoice;
    },

    stateDestination(next) {
      if (next.kind === "chosen") {
        // No path is held. The form states that it is using the folder; only the
        // host knows which folder that is, and only the host says what it derives
        // to (D5). Any typed override is withdrawn — the two are never both live.
        usingChosen = true;
        supplied = "";
        pathIsDerived = true;
      } else if (next.kind === "typed") {
        // A typed path names a destination outright, so it retires the folder.
        //
        // Clearing the field is not an override of "nowhere" — it is withdrawing
        // the override, which is why an empty path derives again.
        usingChosen = false;
        supplied = next.path;
        pathIsDerived = next.path.trim() === "";
      } else {
        // The form is form-wide across repositories while the host's record is per
        // repository, so a flag carried across a switch would ask the new
        // repository to use a folder only its predecessor was given — and it would
        // fall back to its configured root in silence. A typed override is not
        // withdrawn here: it names a path, and a path means the same thing in
        // either repository.
        usingChosen = false;
      }
    },

    withdrawDestination() {
      pathIsDerived = true;
      usingChosen = false;
    },

    statePath(path) {
      draft.path = path;
    },

    destinationCandidate() {
      return {
        ...(pathIsDerived || supplied.trim().length === 0 ? {} : { candidatePath: supplied }),
        // Never both: typing withdraws the folder and choosing withdraws the
        // typed path, so the host's tie-break is unreachable from this form.
        ...(usingChosen ? { useChosenFolder: true as const } : {}),
      };
    },
  };
}
