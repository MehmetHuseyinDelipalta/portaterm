// src/webview/worktree/createDialog/submission.ts — What a create carries, and
// when a field's emptiness became the user's answer rather than the form's
// opening state.
//
// Extracted from `openWorktreeCreateDialog` by change `decompose-create-dialog`
// (design.md D1, task 1_10). Two things live here because they are the same
// subject from two sides: the submit assembles the request from every
// collaborator's settled answer, and the source-snapshot offer is the one part
// of that request with nowhere else to live — it is a checkbox and an offer id,
// too small for a module of its own and read by nothing but the submit.
//
// The four `…Left`/`…Typed` flags come with it for the same reason. They are not
// validation state — the render pass asks for `nameLeft` and `baseLeft` — they
// are the record of whether the user has answered a field at all, and the rule
// that decides it is written once here instead of at each of the four listeners
// that used to hold half of it.
//
// No suite beside this file (design.md D2): every branch is a submit, and the
// 386-case dialog suite is where a submit can be made.

import type { WorktreeAgentBox } from "../worktreeAgentBox";
import type { WorktreeCreateDraft, WorktreeMigrationOffer } from "../worktreeViewTypes";
import type { DraftModel } from "./draftModel";
import type { FormFields } from "./formFields";
import type { ProvisionState } from "./provisionState";
import type { RecoverOffer } from "./recoverOffer";
import type { ResolutionAsks } from "./resolutionAsks";

export interface SubmissionDeps {
  readonly fields: FormFields;
  readonly model: DraftModel;
  readonly asks: ResolutionAsks;
  readonly recover: RecoverOffer;
  readonly bring: ProvisionState;
  readonly agentBox: WorktreeAgentBox;
  readonly createBtn: HTMLButtonElement;
  /** The wait control's current state, asked for rather than held: `sections.ts`
   *  owns the box and re-decides it from the setup selection. */
  waitForSetup(): boolean;
  syncDerived(settled?: boolean): void;
  onSubmit(draft: WorktreeCreateDraft): void;
  /** Every exit goes through the form's own disposer. */
  close(): void;
}

export interface Submission {
  /** Draw the source-snapshot offer, or withdraw it where the mode refuses one. */
  syncMigration(offer: WorktreeMigrationOffer | undefined): void;

  /** Assemble the request and send it. Refuses, and SAYS why, where it cannot. */
  submit(): void;

  nameLeft(): boolean;
  baseLeft(): boolean;

  /** Typing is what makes a field the user's; only then can leaving it empty be
   *  an answer. */
  nameTyped(): void;
  baseTyped(): void;

  /** Leaving a field the user actually used turns its emptiness into their
   *  answer. Leaving the one the form focused for them says nothing. */
  nameBlurred(): void;
  baseBlurred(): void;
}

export function createSubmission(deps: SubmissionDeps): Submission {
  const { fields, model, asks, recover, bring, agentBox, createBtn } = deps;
  const { migrationField, migrationBox, migrationText, nameInput, baseInput } = fields;
  const draft = model.draft;

  let drawnMigrationOfferId: string | null = null;

  /**
   * Has the user been in the field the form would refuse, and left it?
   *
   * A form that opens already saying "Enter a branch name." is scolding someone
   * for not having typed yet — the emptiness is the form's own opening state,
   * not their answer. Leaving the field, or asking to create, is what makes it
   * theirs. Only the EMPTY-field prompt waits on this: a name the host actually
   * refused is a verdict about text the user did type, and says so at once.
   */
  let nameLeft = false;
  let baseLeft = false;
  /**
   * Has the user put anything in the field, ever?
   *
   * The form focuses the branch field when it opens, so the FIRST click anywhere
   * in the dialog blurs it. Blur alone therefore cannot mean "the user left this
   * empty": the caret was never theirs to begin with, and treating it as an
   * answer is what painted git's refusal of `""` under a field nobody had typed
   * in. Typing is what makes the field theirs; after that, leaving it empty is a
   * real answer and is refused like any other.
   */
  let nameTyped = false;
  let baseTyped = false;

  function migrationAllowed(): boolean {
    return (
      draft.branchMode === "detached" ||
      (draft.branchMode !== "reattach" &&
        asks.resolution()?.mode.kind !== "reattach" &&
        asks.resolution()?.mode.kind !== "adopt")
    );
  }

  function settledMigration(): { offerId: string } | undefined {
    return migrationField.hidden || !migrationBox.checked || drawnMigrationOfferId === null
      ? undefined
      : { offerId: drawnMigrationOfferId };
  }

  return {
    syncMigration(offer) {
      if (offer === undefined || !migrationAllowed()) {
        migrationField.hidden = true;
        migrationBox.checked = false;
        migrationText.textContent = "";
        drawnMigrationOfferId = null;
        return;
      }
      if (drawnMigrationOfferId !== offer.offerId) {
        migrationBox.checked = false;
        drawnMigrationOfferId = offer.offerId;
      }
      migrationField.hidden = false;
      migrationText.textContent = `Move ${offer.count} ${offer.count === 1 ? "change" : "changes"} (current snapshot). Git moves the source's uncommitted work present when Create runs.`;
    },

    nameLeft: () => nameLeft,
    baseLeft: () => baseLeft,

    nameTyped() {
      nameTyped = true;
    },
    baseTyped() {
      baseTyped = true;
    },
    nameBlurred() {
      nameLeft = nameLeft || nameTyped || nameInput.value.trim().length > 0;
    },
    baseBlurred() {
      baseLeft = baseLeft || baseTyped || baseInput.value.trim().length > 0;
    },

    submit() {
      if (createBtn.disabled || asks.heldBranch() !== undefined) {
        // Asking to create IS the moment the user has answered, so a form that
        // was staying quiet now says what it is waiting for rather than sitting
        // inert under a disabled button (⌘↵ reaches here; the button cannot).
        if (!nameLeft || !baseLeft) {
          nameLeft = true;
          baseLeft = true;
          deps.syncDerived(true);
        }
        return;
      }
      const launch = model.afterChoice() === "agent" ? agentBox.read() : {};
      // The classification travels WITH the submission, so the owner builds the
      // request from the answer this form was showing rather than from its own
      // second copy of it (round-3 B3).
      // The mode the toggle discarded does not travel either: the owner builds the
      // request from it, so sending a classification of text that is not a branch
      // name would turn a detached create into the repair the form refused.
      const carried = draft.branchMode === "detached" ? null : asks.resolution();
      // The grant, only where it still covers the destination this form is
      // showing. Absent, the create is an ordinary one against a free path — the
      // form never asks for a removal it cannot name the authorization for.
      const disposition = recover.disposition();
      /**
       * The offer on screen and what is ticked in it, or nothing.
       *
       * Nothing in two cases that are NOT the same: no offer ever arrived, so the
       * form was never told what this repository needs; or an offer arrived and
       * the user unticked every row, which is a decision and travels as an empty
       * list. Collapsing the second into the first would let a host that
       * provisions by default provision against a user who said no.
       *
       * The last hop, too. The tick set has been held since WT-012.1 and nothing
       * read it, so every tick the user made was discarded at the submit and the
       * whole provisioning flow was inert end to end (.reviews/round-1.md F005).
       */
      const provision = bring.settledProvision();
      const migrateChanges = settledMigration();
      deps.onSubmit({
        ...draft,
        ...launch,
        ...(carried === null ? {} : { resolved: carried.mode }),
        ...(disposition === undefined ? {} : { disposition }),
        ...(provision === undefined ? {} : { provision }),
        ...(migrateChanges === undefined ? {} : { migrateChanges }),
        // Only where the control was actually offered — a non-agent create never
        // showed this choice, so nothing here is carried for it.
        ...(model.afterChoice() === "agent" ? { waitForSetup: deps.waitForSetup() } : {}),
      });
      deps.close();
    },
  };
}
