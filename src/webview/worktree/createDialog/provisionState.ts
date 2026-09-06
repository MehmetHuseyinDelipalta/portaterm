// src/webview/worktree/createDialog/provisionState.ts — What this form has asked
// the host to do to the provisioning offer, and what the user has ticked.
//
// Extracted from `openWorktreeCreateDialog` by change `decompose-create-dialog`
// (design.md D1, task 1_7). Ten bindings sat in the dialog closure and were read
// from roughly forty places between `:740` and `:2260` — the widest of the
// clusters, and the one whose first shape put the count at three (workflow.md
// Notes, D1a).
//
// The split against `provisionView` (task 1_8) is state versus drawing, and the
// seam is `settle`: an offer arrives, this module decides which pending ask it
// answers and what the resulting tick set is, and hands back a verdict the view
// draws. Every mutation of the four pending maps and the two tick records
// happens here; nothing in it touches an element.
//
// The two obligations the suite beside this file exists for:
//
//   * OBL-1 — tick records are keyed by REPOSITORY. A tick set on repo A must
//     not be applied to repo B, and must still be there on the way back.
//   * OBL-2 — `carryForward` carries ticks AND unticks across a reminted offer
//     id. The inherited suite asserts the tick half at `:3040-3078`; the untick
//     half is asserted here. (Correction recorded in workflow.md Notes: the
//     inherited suite does catch the untick half too, so this is the faster and
//     more direct witness rather than the only one.)
//
// No `@vitest-environment` pragma on that suite, deliberately: under node
// `document` is undefined, so a DOM reference creeping in here throws in
// whichever method holds it rather than passing quietly under the dialog's
// jsdom. `restoreFocus` is carried as a plain boolean for exactly that reason —
// it is decided by the view at press time and only stored here.

import type { WorktreeSetupStepAskMessage } from "../../../types/messages";
import type { WorktreeProvisionOffer } from "../worktreeViewTypes";
import { bringRows, carryForward } from "./bringSummaries";
import { addedOf, createTickRecords } from "./tickRecords";

type ProvisionModel = WorktreeProvisionOffer["model"];

export interface ProvisionStateDeps {
  /** The repository the form is on NOW — every record here is keyed by it. */
  repoId(): string;
  /** A destination pick is out, which holds the same controls an ask does. */
  pickAsking(): boolean;
  canSave: boolean;
  canAskStep: boolean;
  canAskCopy: boolean;
  onProvisionSave?: (msg: { repoId: string; switch: number; offerId: string; kept: string[] }) => void;
  onProvisionSwitch?: (msg: { repoId: string; switch: number; provider: string }) => void;
  onSetupStepAsk?: (msg: { repoId: string; switch: number; op: WorktreeSetupStepAskMessage["op"] }) => void;
  onCopyFileAsk?: (msg: { repoId: string; switch: number }) => void;
}

/** What an incoming offer turned out to answer, for the view to draw. */
export interface OfferSettlement {
  /** The selection this offer is drawn under. */
  readonly ticked: Set<string>;
  /** The step ask this offer answered, where it answered one — focus follows it. */
  readonly stepAnswered: PendingStep | undefined;
  /** The copy ask this offer answered, where it answered one. */
  readonly copyAnswered: PendingCopy | undefined;
  /** A save may be offered: the host can hear one and no switch is in flight. */
  readonly canOfferSave: boolean;
}

export interface PendingStep {
  offerId: string;
  model: ProvisionModel;
  kept: ReadonlySet<string>;
  /** What was pressed, so the answer can put focus back where it was (D5). */
  pressed: { kind: WorktreeSetupStepAskMessage["op"]["kind"]; ordinal: number };
  /**
   * Whether the pressed control held focus at the press. Read THEN, because
   * the control is disabled a moment later and a disabled control cannot
   * hold focus; withdrawn by a `focusin` elsewhere in the dialog.
   */
  restoreFocus: boolean;
  /** For a remove: which ordinal the answer will have spliced out. */
  removing?: number;
}

export interface PendingCopy {
  offerId: string;
  model: ProvisionModel;
  kept: ReadonlySet<string>;
  /** Restore only when the user had focused the action and did not move on. */
  restoreFocus: boolean;
}

export interface ProvisionState {
  /** The offer currently drawn, so an unchanged one is not redrawn. */
  drawnOffer(): string | null;
  /** The model behind it, so a tick can restate the summary without a redraw. */
  drawnModel(): ProvisionModel | null;
  /** The selection under the drawn offer. */
  ticked(): Set<string> | undefined;

  /** Any host-owned input still out: each one holds the whole form. */
  anyAsking(): boolean;
  anyStepAsking(): boolean;
  anyCopyAsking(): boolean;
  /** A switch or a save is in flight for the repository on screen. */
  inFlight(): boolean;
  /** A save is in flight for the repository on screen. */
  saving(): boolean;

  /** A tick or untick on the drawn offer, recorded by ordinal for added rows. */
  toggle(itemId: string, on: boolean): void;
  /** The setup steps currently selected in the drawn offer, if any. */
  hasSelectedSetup(): boolean;

  /** Post a save of the current selection. False where nothing was posted. */
  askSave(): boolean;
  /** Post a copy-file ask. False where nothing was posted. */
  askCopy(hadFocus: boolean): boolean;
  /** Post a setup-step ask. False where nothing was posted. */
  askStep(op: WorktreeSetupStepAskMessage["op"], hadFocus: boolean): boolean;
  /** Take an inactive provider as the source. False where nothing was posted. */
  takeSwitch(offerId: string, providerId: string): boolean;
  /** A `focusin` elsewhere withdraws every pending restore (D5). */
  releaseFocusRestore(): void;

  /** The section has nothing to draw: forget the offer behind it. */
  clearDrawn(): void;
  /** This offer is already what is on screen, so no redraw is owed. */
  isDrawn(offerId: string): boolean;
  /** Take an offer as the one now drawn, and settle what it answers. */
  settle(offer: WorktreeProvisionOffer): OfferSettlement;
  /**
   * Settle an offer for a repository the picker has since left: the hold is
   * form-wide, so the answer must still release it and still leave that
   * repository's selection where the user put it. False where it answered
   * nothing.
   */
  settleAway(repoId: string, offer: WorktreeProvisionOffer): boolean;

  /** What the submit carries. */
  settledProvision(): { offerId: string; itemIds: readonly string[] } | undefined;
}

export function createProvisionState(deps: ProvisionStateDeps): ProvisionState {
  /** The offer currently drawn, so an unchanged one is not redrawn. */
  let drawnOfferId: string | null = null;
  /**
   * Per repository, the offer a switch was taken AGAINST and not yet answered for.
   *
   * The offer on screen is superseded the moment a source is taken, so a save
   * pressed before the replacement arrives would record the SUPERSEDED source —
   * and, because it mints the higher sequence, would make the switch fail its
   * own re-check and vanish with no report. The control is removed for exactly
   * as long as that is true, which is the same statement its absence already
   * makes when no offer has arrived: there is nothing here this save can
   * honestly be about (design.md D15).
   *
   * Keyed by repository, and holding the offer id rather than a boolean, because
   * one form-wide flag could not survive the repo picker: moving away and back
   * re-supplies the SAME cached offer, and a flag cleared by any redraw restored
   * the control with the switch still in flight (.reviews/round-2.md F020). The
   * answer is an offer id that DIFFERS from the one the switch was taken
   * against; the same one again is a redraw.
   */
  const pendingSwitch = new Map<string, string>();
  /**
   * Per repository, a save this form posted and has not been answered for.
   *
   * Nothing on screen distinguished "sent" from "not pressed", so a second press
   * posted a second save: the lock serializes them, the later one raises the
   * host's ceiling, and the first answer is dropped — the user sees one result
   * for two writes (.reviews/round-1.md F014).
   *
   * It holds the offer the save went out against, that offer's model, and the
   * selection at the moment of the press, because the answer arrives as a FRESH
   * offer whose item ids are all new. Keyed by repository for the same reason
   * `pendingSwitch` is: a form-wide flag was cleared by an unrelated
   * repository's offer and by the repo picker re-delivering a cached one.
   */
  const pendingSave = new Map<
    string,
    { offerId: string; model: WorktreeProvisionOffer["model"]; kept: ReadonlySet<string> }
  >();
  const pendingStep = new Map<string, PendingStep>();
  const pendingCopy = new Map<string, PendingCopy>();

  /** Any host-owned input still out: each one holds the whole form. */
  const anyStepAsking = (): boolean => pendingStep.size > 0;
  const anyCopyAsking = (): boolean => pendingCopy.size > 0;
  const anyAsking = (): boolean => anyStepAsking() || anyCopyAsking();
  // Which added rows the user turned off, by ordinal, per repository. Its own
  // module (createDialog/tickRecords.ts): it is the subject of both provisioning
  // obligations, and the two together were over this change's own line goal.
  const ticks = createTickRecords();
  // The model behind `drawnOfferId`, so the toggle handler can restate the
  // summary without a redraw — redrawing on a tick is what W2 forbids.
  let drawnModel: WorktreeProvisionOffer["model"] | null = null;
  /**
   * What the user has ticked, per offer.
   *
   * Kept outside the DOM because the section is rebuilt when a new offer
   * supersedes the old one and when the repo picker moves. Nothing reads this
   * yet — WT-012.2 owns redemption — but losing a choice silently is a defect
   * whether or not anything acts on it (.reviews/round-1.md W2).
   */
  const checkedByOffer = new Map<string, Set<string>>();

  /**
   * Monotonic per dialog, minted here.
   *
   * The host orders answers by it, so it must increase across every switch this
   * form takes — including switches for different repositories, which is why it
   * is one counter and not one per repo.
   */
  let switchSeq = 0;

  /** Every gate an ask shares: something drawn, nothing else out, nothing pending. */
  function armable(): { offerId: string; model: ProvisionModel; ticked: Set<string> } | null {
    // Resolved at event time, never captured: item ids are offer-local, so a
    // handler closing over one redraw's set would write into an offer the form
    // no longer holds (round-2 W5).
    if (
      drawnOfferId === null ||
      drawnModel === null ||
      pendingSwitch.has(deps.repoId()) ||
      pendingSave.has(deps.repoId()) ||
      anyAsking()
    ) {
      return null;
    }
    const ticked = checkedByOffer.get(drawnOfferId);
    return ticked === undefined ? null : { offerId: drawnOfferId, model: drawnModel, ticked };
  }

  return {
    drawnOffer: () => drawnOfferId,
    drawnModel: () => drawnModel,
    ticked: () => (drawnOfferId === null ? undefined : checkedByOffer.get(drawnOfferId)),

    anyAsking,
    anyStepAsking,
    anyCopyAsking,
    inFlight: () => pendingSwitch.has(deps.repoId()) || pendingSave.has(deps.repoId()),
    saving: () => pendingSave.has(deps.repoId()),

    toggle(itemId, on) {
      const ticked = drawnOfferId === null ? undefined : checkedByOffer.get(drawnOfferId);
      if (on) {
        ticked?.add(itemId);
      } else {
        ticked?.delete(itemId);
      }
      if (drawnModel !== null) {
        ticks.record(deps.repoId(), drawnModel, itemId, on);
      }
    },

    hasSelectedSetup() {
      if (drawnOfferId === null || drawnModel === null) {
        return false;
      }
      const ticked = checkedByOffer.get(drawnOfferId);
      return ticked !== undefined && drawnModel.setup.some((step) => ticked.has(step.id));
    },

    askSave() {
      const armed = armable();
      if (armed === null) {
        return false;
      }
      switchSeq += 1;
      // The model too, not just the ids: the answering offer mints new ones, and
      // matching the two requires knowing what each old id stood for (F018).
      pendingSave.set(deps.repoId(), { offerId: armed.offerId, model: armed.model, kept: new Set(armed.ticked) });
      deps.onProvisionSave?.({
        repoId: deps.repoId(),
        switch: switchSeq,
        offerId: armed.offerId,
        kept: [...armed.ticked],
      });
      return true;
    },

    askCopy(hadFocus) {
      const armed = deps.pickAsking() ? null : armable();
      if (armed === null) {
        return false;
      }
      switchSeq += 1;
      pendingCopy.set(deps.repoId(), {
        offerId: armed.offerId,
        model: armed.model,
        kept: new Set(armed.ticked),
        restoreFocus: hadFocus,
      });
      deps.onCopyFileAsk?.({ repoId: deps.repoId(), switch: switchSeq });
      return true;
    },

    askStep(op, hadFocus) {
      const armed = deps.pickAsking() ? null : armable();
      if (armed === null) {
        return false;
      }
      let removing: number | undefined;
      let ordinal = addedOf(armed.model).length;
      if (op.kind !== "add") {
        ordinal = addedOf(armed.model).findIndex((step) => step.id === op.itemId);
        if (ordinal < 0) {
          return false;
        }
        if (op.kind === "remove") {
          removing = ordinal;
        }
      }
      switchSeq += 1;
      pendingStep.set(deps.repoId(), {
        offerId: armed.offerId,
        model: armed.model,
        kept: new Set(armed.ticked),
        pressed: { kind: op.kind, ordinal },
        restoreFocus: hadFocus,
        ...(removing === undefined ? {} : { removing }),
      });
      deps.onSetupStepAsk?.({ repoId: deps.repoId(), switch: switchSeq, op });
      return true;
    },

    takeSwitch(offerId, providerId) {
      if (anyAsking()) {
        return false;
      }
      switchSeq += 1;
      pendingSwitch.set(deps.repoId(), offerId);
      deps.onProvisionSwitch?.({ repoId: deps.repoId(), switch: switchSeq, provider: providerId });
      return true;
    },

    releaseFocusRestore() {
      const stepping = pendingStep.get(deps.repoId());
      if (stepping !== undefined) {
        stepping.restoreFocus = false;
      }
      const copying = pendingCopy.get(deps.repoId());
      if (copying !== undefined) {
        copying.restoreFocus = false;
      }
    },

    clearDrawn() {
      drawnOfferId = null;
      drawnModel = null;
    },

    isDrawn: (offerId) => drawnOfferId === offerId,

    settle(offer) {
      drawnOfferId = offer.offerId;
      drawnModel = offer.model;
      const repoId = deps.repoId();
      // A DIFFERENT offer id is the answer the removed control was waiting for.
      // The same id again is this form being redrawn — through the repo picker,
      // most of all — and a redraw is not an answer.
      const switched = pendingSwitch.get(repoId);
      const saved = pendingSave.get(repoId);
      const stepped = pendingStep.get(repoId);
      const copied = pendingCopy.get(repoId);
      if (switched !== offer.offerId) {
        pendingSwitch.delete(repoId);
      }
      // A DIFFERENT id answers the ask; the same id is a redraw, exactly as for
      // a switch. The answer reconciles below through `carryForward`, so the
      // superseded offer's selection is dead state once that has run.
      const stepAnswered = stepped !== undefined && stepped.offerId !== offer.offerId ? stepped : undefined;
      if (stepAnswered !== undefined) {
        pendingStep.delete(repoId);
        checkedByOffer.delete(stepAnswered.offerId);
      }
      const copyAnswered = copied !== undefined && copied.offerId !== offer.offerId ? copied : undefined;
      if (copyAnswered !== undefined) {
        pendingCopy.delete(repoId);
        checkedByOffer.delete(copyAnswered.offerId);
      }
      // The switched-FROM offer's selection, dropped the same way a save answer
      // drops its own. Only save answers were evicting, so repeated switches left
      // one unreachable set per superseded offer for the dialog's lifetime
      // (.reviews/round-3.md F023).
      if (switched !== undefined && switched !== offer.offerId) {
        checkedByOffer.delete(switched);
      }
      // A save is answered only by an offer that is neither the one it went out
      // against nor the answer to a switch taken after it. A switch replaces the
      // source, so the selection it was taken under is about rows this offer no
      // longer claims to have — that reseeds from the new model's defaults.
      const answering = saved !== undefined && saved.offerId !== offer.offerId && switched === undefined;
      if (saved !== undefined && saved.offerId !== offer.offerId) {
        pendingSave.delete(repoId);
        // The superseded offer can never be submitted again, and its selection is
        // either carried below or deliberately dropped. Either way it is dead
        // state keyed by an id nothing will name.
        checkedByOffer.delete(saved.offerId);
      }
      let ticked = checkedByOffer.get(offer.offerId);
      if (ticked === undefined) {
        const fresh = bringRows(offer.model);
        if (stepAnswered !== undefined) {
          ticked = ticks.settle(stepAnswered, offer.model, repoId);
        } else if (copyAnswered !== undefined) {
          ticked = ticks.settle(copyAnswered, offer.model, repoId);
        } else {
          ticked =
            answering && saved !== undefined
              ? carryForward(saved.model, saved.kept, fresh, offer.model)
              : new Set(fresh.filter((r) => r.checked).map((r) => r.id));
          // Whatever answered — a switch reseeding from defaults, a save carrying
          // by descriptor — the added rows take the record's ticks (D5).
          ticks.applyFor(repoId, offer.model, ticked);
        }
        checkedByOffer.set(offer.offerId, ticked);
      }
      // And only where a save can actually be made: a control whose press the
      // host would never hear is the same nothing as a control with no offer
      // behind it (.reviews/round-1.md F009).
      return {
        ticked,
        stepAnswered,
        copyAnswered,
        canOfferSave: deps.canSave && !pendingSwitch.has(repoId),
      };
    },

    settleAway(repoId, offer) {
      const stepped = pendingStep.get(repoId);
      const copied = pendingCopy.get(repoId);
      const stepAnswered = stepped !== undefined && stepped.offerId !== offer.offerId;
      const copyAnswered = copied !== undefined && copied.offerId !== offer.offerId;
      if (!stepAnswered && !copyAnswered) {
        return false;
      }
      if (stepAnswered && stepped !== undefined) {
        pendingStep.delete(repoId);
        checkedByOffer.delete(stepped.offerId);
      }
      if (copyAnswered && copied !== undefined) {
        pendingCopy.delete(repoId);
        checkedByOffer.delete(copied.offerId);
      }
      if (!checkedByOffer.has(offer.offerId)) {
        const ticked =
          stepAnswered && stepped !== undefined
            ? ticks.settle(stepped, offer.model, repoId)
            : copyAnswered && copied !== undefined
              ? ticks.settle(copied, offer.model, repoId)
              : undefined;
        if (ticked !== undefined) {
          checkedByOffer.set(offer.offerId, ticked);
        }
      }
      return true;
    },

    settledProvision() {
      if (drawnOfferId === null) {
        return undefined;
      }
      return { offerId: drawnOfferId, itemIds: [...(checkedByOffer.get(drawnOfferId) ?? [])] };
    },
  };
}
