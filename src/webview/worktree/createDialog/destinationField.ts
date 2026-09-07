// src/webview/worktree/createDialog/destinationField.ts — Where the worktree
// goes: the one place a stated destination becomes form state, the folder pick
// that can answer it, and the tooltip that shows the path in full.
//
// Extracted from `openWorktreeCreateDialog` by change `decompose-create-dialog`
// (design.md D1, task 1_10). The three were in three places and are one subject:
// `stateDestination` withdraws the pick, the pick is the only thing that mints
// `chosen`, and the tooltip is the shortened line the pair produce. Keeping the
// ask counter beside the withdrawal is the point — those were forty lines apart,
// and the rule that a replaced destination retires a pick in flight had to be
// read in two files to be seen at all.
//
// The three states and their edges are the model's (createDialog/draftModel.ts);
// this half is the field. What did NOT come: the destination DERIVATION, which
// is the render pass's (createDialog/derivePass.ts) and is asked here only for
// the text the tooltip shows.
//
// No suite beside this file (design.md D2): every method writes or reads the
// DOM, and the 386-case dialog suite is where a pick can be answered late.

import { attachTooltip } from "../../ui/Tooltip";
import { ICON_FOLDER } from "../../vault/icons";
import type { WorktreeCreateDefaults } from "../worktreeViewTypes";
import type { DestinationEdit, DraftModel } from "./draftModel";
import { explain, type FormFields, labelOf } from "./formFields";
import type { ProvisionState } from "./provisionState";
import type { ProvisionView } from "./provisionView";

export interface DestinationFieldDeps {
  readonly fields: FormFields;
  readonly model: DraftModel;
  readonly bring: ProvisionState;
  readonly bringView: ProvisionView;
  /** Offered only where the answer can come back — see `pickDestination` below. */
  readonly onPickDestination?: (request: { repoId: string; ask: number }) => void;
  readonly canBindPicked: boolean;
  currentRepo(): WorktreeCreateDefaults;
  syncDerived(settled?: boolean): void;
  /** The path the line is currently shortening, from the render pass that wrote it. */
  destExact(): string;
}

export interface DestinationField {
  /** The Choose button, or `undefined` where the pick cannot be answered. */
  readonly pickDestination: HTMLButtonElement | undefined;

  /**
   * The one place a stated destination becomes form state.
   *
   * Three states and every edge between them (design.md D6): the destination is
   * derived under the configured root, derived inside a folder the host offered
   * this form, or typed. `pathIsDerived` stays true in the middle one — the
   * destination IS derived, just from a different root — so the field keeps
   * showing the host's answer.
   *
   * What the form submits is NOT read from the input: the selection reads
   * `pathIsDerived`, `supplied` and `usingChosen`, and the render pass re-derives
   * over the input whenever the caret is elsewhere — which after a picker it
   * always is. So a caller that assigned `pathInput.value` would be silently
   * overwritten and would compose a create stating nothing at all.
   *
   * Clearing the field is not an override of "nowhere" — it is withdrawing the
   * override.
   */
  stateDestination(next: DestinationEdit, fromInput?: boolean): void;

  /** Which pick this form is waiting on, or null. */
  pickAsked(): number | null;
  pickAsking(): boolean;
  /** An answer arrived and was applied; the wait is over. */
  clearPickAsked(): void;

  ensureDestTip(): void;
  releaseDestTip(): void;
}

export function createDestinationField(deps: DestinationFieldDeps): DestinationField {
  const { fields, model, bring, bringView } = deps;
  const { dest, pathField, pathInput, pathRow, baseField } = fields;

  /** How many picks this form has opened. Minted like `recoverAsks` in createDialog/recoverOffer.ts (D7). */
  let pickAsks = 0;
  /**
   * Which pick this form is waiting on, or null.
   *
   * Its OWN gate, deliberately not the `outstanding` flag the destination probe
   * uses. Nothing disables Choose while a probe is in flight, so a pick can open
   * on top of one; that probe's answer is still current and clears `outstanding`,
   * after which Create would be offered again — at the destination from BEFORE
   * the pick. One boolean cannot hold two independent waits (design.md D7).
   */
  let pickAsked: number | null = null;

  /**
   * Attached the first time there IS a destination, not at construction.
   * `attachTooltip` resolves its text once at attach and returns a no-op when it
   * is empty — and at construction the exact path is "", so attaching here bound
   * nothing at all and every release path released nothing.
   */
  let disposeDestTip: (() => void) | null = null;

  const stateDestination = (next: DestinationEdit, fromInput = false): void => {
    // The user replacing the destination withdraws any pick they were waiting
    // on — typed, cleared (the `typed` branch with empty text), or the
    // repository switched. An answer to a withdrawn ask changes nothing, which
    // is what stops a late pick wiping a newer typed path or marking a
    // repository chosen that was never offered a folder (design.md D7).
    //
    // Scoped to those three and claimed no wider: `stateDestination` is not the
    // only writer of destination state — the render pass's withdrawal arm and
    // the resolution application both write it — but those are not the user
    // replacing anything.
    if (next.kind !== "chosen") {
      pickAsked = null;
    }
    // The three states and their edges are the model's; this half is the field.
    model.stateDestination(next);
    if (next.kind === "typed" && !fromInput) {
      pathInput.value = next.path;
    }
    // Typing is settled by the field's own `change`; a chosen folder and a
    // repository switch have no such event and nothing more is coming, so each
    // IS the settled edit. Left unsettled, the host is never asked and Create
    // stays disabled waiting for an answer nobody requested.
    bringView.syncControls();
    deps.syncDerived(!fromInput);
  };

  explain(
    labelOf(baseField),
    "The base ref is the commit the new branch starts from — a branch name, a tag, or a commit id. Left empty it starts from HEAD, the commit this repository is on now.",
  );

  // Rendered only when it can be answered. `onPickDestination` without
  // `bindDestinationPicked` is a button whose reply reaches nobody.
  const pickDestination =
    deps.onPickDestination !== undefined && deps.canBindPicked ? document.createElement("button") : undefined;
  if (pickDestination !== undefined) {
    pickDestination.type = "button";
    pickDestination.className = "wt-path-pick";
    // An icon on the line, a name for everything that reads one: the word was
    // the widest thing beside the field and said nothing the folder does not.
    pickDestination.innerHTML = ICON_FOLDER;
    pickDestination.setAttribute("aria-label", "Choose…");
    pickDestination.title = "Pick the folder this worktree is created in.";
    pickDestination.addEventListener("click", () => {
      if (bring.anyAsking()) {
        return;
      }
      // Minted here, like `recoverAsks` in createDialog/recoverOffer.ts: `token` separates two openings
      // and this separates two picks inside one, so an answer to an earlier
      // pick cannot be mistaken for an answer to this one (design.md D7).
      pickAsks += 1;
      pickAsked = pickAsks;
      deps.onPickDestination?.({ repoId: deps.currentRepo().repoId, ask: pickAsks });
      bringView.syncControls();
      // The gate is only read while the form re-renders, and a click is not one
      // of the events that already does — so Create would stay armed at the
      // pre-pick destination until something else moved.
      deps.syncDerived();
    });
    pathRow.appendChild(pickDestination);
  }
  // BEFORE the hint, not after it. `formFields.ts` appends `pathNote` when the
  // elements are built and this module runs 133 lines later, so an append here
  // would seat the refusal sentence ABOVE the input it describes — a screen
  // reader would announce the refusal before reaching the control (round-1 F001).
  // The base built both in one block; the cut split them, and this is what
  // restores the order it had.
  pathField.insertBefore(pathRow, fields.pathNote);
  explain(
    labelOf(pathField),
    "The folder this worktree is created in. Left empty it goes to the location shown above, derived from the branch name; a value here overrides that for this create only.",
  );

  return {
    pickDestination,
    stateDestination,
    pickAsked: () => pickAsked,
    pickAsking: () => pickAsked !== null,
    clearPickAsked() {
      pickAsked = null;
    },
    ensureDestTip() {
      if (disposeDestTip === null && deps.destExact() !== "") {
        // Asked for, never held: the render pass is its only writer, and a copy
        // here would be the previous pass's path under this pass's line.
        disposeDestTip = attachTooltip(dest, { getText: () => deps.destExact() });
      }
    },
    releaseDestTip() {
      disposeDestTip?.();
      disposeDestTip = null;
    },
  };
}
