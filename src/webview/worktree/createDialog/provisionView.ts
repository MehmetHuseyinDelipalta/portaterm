// src/webview/worktree/createDialog/provisionView.ts — Drawing the "Bring over"
// section: its elements, its three host-owned asks, and the redraw an arriving
// offer forces.
//
// Extracted from `openWorktreeCreateDialog` by change `decompose-create-dialog`
// (design.md D1, task 1_8). The other half of the split task 1_7 made: that
// module owns what has been asked and what is ticked, this one owns what is on
// screen. The seam between them is `settle` — an offer arrives, `provisionState`
// decides what it answers and what the selection becomes, and this file draws
// the verdict. Nothing here holds provisioning state of its own (task Boundary);
// the only bindings it owns are elements.
//
// The dependency runs one way, state to view, so there is no circular value
// import — the condition design.md's Risk Map said would mean the seam was
// wrong.
//
// The section is appended to the dialog by the factory, which is why the facade
// calls it exactly where the old construction stood: the field order in the
// dialog is the order of the appends, and `waitField` is attached inside this
// field afterwards.
//
// DOM throughout, so no suite beside this file (design.md D2): the 386-case
// dialog suite drives the section end to end — rows, problems, switch rows, the
// save control appearing and disappearing, the added-step controls, focus
// restoration after an answer, and the yielding notes.

import { SETUP_STEP_ADDED_SOURCE, type WorktreeSetupStepAskMessage } from "../../../types/messages";
import { field } from "../worktreeDialogShell";
import type { WorktreeProvisionOffer } from "../worktreeViewTypes";
import { bothOrAll, claimingPerGroup } from "./bringContention";
import { bringProblem, sourcePicker } from "./bringRowView";
import { bringRows, bringSummary, changedFileIds } from "./bringSummaries";
import { createProvisionGroups } from "./provisionGroups";
import type { PendingStep, ProvisionState } from "./provisionState";
import { addedOf } from "./tickRecords";

export interface ProvisionViewDeps {
  /** Appended to on construction, and listened to for the focus withdrawal. */
  readonly dialog: HTMLElement;
  readonly bring: ProvisionState;
  /** Undefined where a single repository suppressed the picker entirely. */
  repoSelect(): HTMLSelectElement | undefined;
  /** A destination pick is out, which holds the same controls an ask does. */
  pickAsking(): boolean;
  canAskStep: boolean;
  canAskCopy: boolean;
  syncDerived(): void;
  syncWaitForSetup(): void;
}

export interface ProvisionView {
  /** The section itself, so the wait control can be attached inside it. */
  readonly field: HTMLElement;
  readonly defaults: HTMLElement;
  /** Redraw from the repository's offer. Called on every derive. */
  sync(offer: WorktreeProvisionOffer | undefined): void;
  /** Enablement of every control an in-flight ask must hold, derived, never toggled. */
  syncControls(): void;
}

export function createProvisionView(deps: ProvisionViewDeps): ProvisionView {
  const { bring } = deps;

  // ── Bring over — what the new worktree will NOT inherit ─────────────────
  // Below the destination and above the after-create choice, because it
  // describes the worktree being made rather than what happens once it exists.
  // The section is never a gate: a repository that declares nothing, and one
  // whose provider file cannot be read, both still submit.
  const bringField = field("Environment");
  let groups: ReturnType<typeof createProvisionGroups> | undefined;
  const bringHeading = bringField.firstElementChild as HTMLElement;
  const defaults = document.createElement("div");
  defaults.className = "wt-repository-defaults";
  defaults.hidden = true;
  bringField.classList.add("wt-bring");
  const bringSum = document.createElement("span");
  bringSum.className = "wt-bring-sum";
  bringField.firstChild?.appendChild(bringSum);
  const bringBox = document.createElement("div");
  bringBox.className = "wt-bring-box";
  // Not an empty list. "This repository needs nothing brought over" and "we did
  // not look" are different statements, and an empty box says neither — so the
  // empty case is the sentence, naming what the worktree will actually lack.
  const bringEmpty = document.createElement("div");
  bringEmpty.className = "wt-bring-empty";
  // A finding, not a guess: naming `.env` as absent was a claim about a file
  // that, when present, the fallback detector now offers as a suggestion.
  bringEmpty.textContent = "No configured items or supported repository-root suggestions were found.";
  bringField.append(bringBox, bringEmpty);
  deps.dialog.appendChild(bringField);

  // Attached only while an offer is drawn, and removed rather than disabled
  // when one is not: a save pressed before the host has answered would
  // record the empty selection as "bring nothing over", which is a statement
  // the user never made.
  const saveRow = document.createElement("div");
  saveRow.className = "wt-bring-save-row";
  const saveButton = document.createElement("button");
  // Explicitly a button, like the switch rows: a default-type button inside the
  // form SUBMITS, and a create started by pressing Save is the one thing
  // this must never do.
  saveButton.type = "button";
  saveButton.className = "wt-bring-save wt-inline-action";
  saveButton.textContent = "Save file defaults";
  saveButton.title = "Save eligible file choices and the selected source to .vscode/worktree.json";
  // What the repository will NOT keep, said before the save rather than after
  // it. Setup steps and ports are the two choices the configuration has no
  // vocabulary for — § 7 forbids persisting a pre-ticked command, and an
  // unallocated port has no path for `exclude` to match (design.md D6).
  const saveNote = document.createElement("span");
  saveNote.className = "wt-bring-save-note";
  saveNote.id = "wt-bring-save-note";
  // Only the half the label does not already carry. "Save current choices as
  // defaults" says what the press records; what it cannot say is what it leaves
  // out, and that is the whole note now.
  saveNote.textContent = "Writes .vscode/worktree.json. Added files, setup steps and ports apply to this create only.";
  // The note states what pressing this does NOT record. A sighted user reads it
  // beside the button; without the association a screen reader announces the
  // button alone, which is the half of the sentence that sounds complete
  // (.reviews/round-1.md F014).
  saveButton.setAttribute("aria-describedby", saveNote.id);
  const defaultsToggle = document.createElement("button");
  defaultsToggle.type = "button";
  defaultsToggle.className = "wt-inline-action wt-defaults-toggle";
  defaultsToggle.textContent = "Repository defaults…";
  defaultsToggle.setAttribute("aria-expanded", "false");
  defaultsToggle.setAttribute("aria-controls", "wt-defaults-body");
  const defaultsBody = document.createElement("div");
  defaultsBody.id = "wt-defaults-body";
  defaultsBody.className = "wt-defaults-body";
  defaultsBody.hidden = true;
  defaultsBody.append(saveButton, saveNote);
  defaultsToggle.addEventListener("click", () => {
    defaultsBody.hidden = !defaultsBody.hidden;
    defaultsToggle.setAttribute("aria-expanded", String(!defaultsBody.hidden));
  });
  saveRow.append(defaultsToggle, defaultsBody);
  saveButton.addEventListener("click", () => {
    if (bring.askSave()) {
      saveButton.disabled = true;
    }
  });

  // ── Add a file to copy for this create ──────────────────────────────────
  // The pathname never enters this form. The extension owns the picker and
  // answers with a fresh opaque offer carrying display material only.
  const addCopyRow = document.createElement("div");
  addCopyRow.className = "wt-bring-add";
  const addCopyButton = document.createElement("button");
  addCopyButton.type = "button";
  addCopyButton.className = "wt-bring-add-action wt-bring-add-copy wt-inline-action";
  addCopyButton.textContent = "+ File";
  addCopyButton.setAttribute("aria-label", "Add file to copy for this create");
  addCopyButton.title = "Copy an additional file into this worktree";
  addCopyRow.appendChild(addCopyButton);
  addCopyButton.addEventListener("click", () => {
    // Focus is read HERE, before the control is disabled a moment later: a
    // disabled control cannot hold focus, so asking afterwards always says no.
    if (bring.askCopy(document.activeElement === addCopyButton)) {
      syncStepControls();
      deps.syncDerived();
    }
  });

  // ── Add a setup step for this create ────────────────────────────────────
  // Rendered last inside the box, only while an offer is drawn, and only where
  // an ask can be posted. The text is typed into the HOST's input, not here.
  const addStepRow = document.createElement("div");
  addStepRow.className = "wt-bring-add";
  const addStepButton = document.createElement("button");
  addStepButton.type = "button";
  addStepButton.className = "wt-bring-add-action wt-bring-add-step wt-bring-add-setup wt-inline-action";
  addStepButton.textContent = "+ Command";
  addStepButton.setAttribute("aria-label", "Add setup command for this create");
  addStepButton.title = "Run a command in the new worktree after files are brought over. Applies to this create only.";
  addStepRow.appendChild(addStepButton);
  const askStep = (op: WorktreeSetupStepAskMessage["op"], pressed?: HTMLElement): void => {
    const pressedControl = pressed ?? addStepButton;
    if (bring.askStep(op, document.activeElement === pressedControl)) {
      // Create is withheld from this moment; the gate is only read on a derive.
      syncStepControls();
      deps.syncDerived();
    }
  };
  addStepButton.addEventListener("click", () => askStep({ kind: "add" }, addStepButton));
  // A user who moved on while the input was open is not pulled back (D5).
  deps.dialog.addEventListener("focusin", (ev) => {
    if (!(ev.target instanceof HTMLElement) || ev.target === document.body) {
      return;
    }
    bring.releaseFocusRestore();
  });
  /** Enablement of every control an in-flight ask must hold, derived, never toggled. */
  function syncStepControls(): void {
    const asking = bring.anyAsking();
    const busy = asking || bring.inFlight() || deps.pickAsking();
    const picker = deps.repoSelect();
    if (picker !== undefined) {
      // The input belongs to the form, and changing repository would let
      // every gate below read a repository that never asked (round 1 F002).
      picker.disabled = asking;
    }
    addCopyButton.disabled = busy;
    addStepButton.disabled = busy;
    for (const checkbox of bringBox.querySelectorAll<HTMLInputElement>(".wt-brow-cb")) {
      checkbox.disabled = asking;
    }
    for (const button of bringBox.querySelectorAll<HTMLButtonElement>(".wt-brow-step")) {
      button.disabled = busy;
    }
    // A switch is latest-wins and may be taken over an in-flight switch or
    // save; only an open input holds it, since its answer would land in a
    // source the user had moved on from (design.md D5).
    for (const b of bringBox.querySelectorAll<HTMLSelectElement>(".wt-bring-source-select")) {
      b.disabled = asking;
    }
    saveButton.disabled = bring.saving() || asking;
  }

  // Registered ONCE. Inside the redraw it added a handler per rebuild, each
  // closing over that redraw's own set — and item ids are offer-local, so a
  // stale handler wrote into an offer the form no longer holds
  // (.reviews/round-2.md W5). The set is resolved at event time instead of
  // captured.
  bringBox.addEventListener("change", (ev) => {
    const cb = ev.target;
    if (!(cb instanceof HTMLInputElement) || !cb.classList.contains("wt-brow-cb") || bring.drawnOffer() === null) {
      return;
    }
    bring.toggle(cb.value, cb.checked);
    const ticked = bring.ticked();
    const drawn = bring.drawnModel();
    // The counts and the yielding notes are claims about what this create will
    // bring over, so they are restated from the selection that just changed
    // rather than left at whatever the first render computed (round-1 F001).
    // Text and one hidden flag: no row is rebuilt, so no checkbox is reset.
    if (drawn !== null && ticked !== undefined) {
      bringSum.textContent = bringSummary(drawn, ticked);
      groups?.syncSelection(ticked);
      syncYieldNotes(ticked);
    }
    deps.syncWaitForSetup();
  });

  /**
   * Show each yielding note only while the declaration it names is selected.
   *
   * The note states a condition, so it is displayed exactly when the condition
   * holds. Unticking the favoured member leaves the other one uncontested — the
   * apply recomputes its contests from what was submitted and finds no favoured
   * member — so the refusal it warns about is no longer the one that will
   * happen (round-1 F001).
   */
  function syncYieldNotes(ticked: ReadonlySet<string>): void {
    const drawn = bring.drawnModel();
    if (drawn === null) {
      return;
    }
    const pathOf = new Map(drawn.entries.map((e) => [e.id, e.path] as const));
    // Once per GROUP, not once per note. Every note pointing at a group asks the
    // same question of the same list, and a group is every entry sharing one
    // fold key, so it can hold every row the cap allows: reading it per note
    // made one checked-in file quadratic in its own rows
    // (.reviews/round-8.md F019).
    const claiming = claimingPerGroup(drawn, ticked).map((ids) =>
      ids.flatMap((id) => {
        const path = pathOf.get(id);
        return path === undefined ? [] : [path];
      }),
    );
    for (const note of bringBox.querySelectorAll<HTMLElement>(".wt-brow-yield")) {
      const held = claiming[Number(note.dataset.group)] ?? [];
      // Exactly one, which is D3c's favoured case. None leaves nothing claiming
      // priority and the apply applies the group, so there is no refusal to
      // warn about; more than one refuses it entire, which the note below owns.
      note.hidden = held.length !== 1;
      if (held[0] !== undefined) {
        note.textContent = `refused while ${held[0]} is selected`;
      }
    }
    for (const note of bringBox.querySelectorAll<HTMLElement>(".wt-brow-contested")) {
      const held = claiming[Number(note.dataset.group)] ?? [];
      note.hidden = held.length < 2;
      if (held.length >= 2) {
        note.textContent = `refused while ${bothOrAll(held)} — the repository declares this destination more than once`;
      }
    }
  }

  /** Redraw the section from the repo's offer. Called on every derive. */
  /**
   * The selection an answered ask leaves behind. Provider rows carry by
   * script descriptor. Added rows carry by ORDINAL, for every operation: two
   * of them may carry the same script, and a descriptor cannot tell those
   * apart — removing the first moved its tick onto the second (round 1 F001,
   * design.md D5). An add leaves the snapshot as is and the new last row takes
   * its default; an edit changes neither count nor order; a remove splices
   * its ordinal out.
   */
  /**
   * Where focus goes once the answer has redrawn the section: the same row's
   * same action, the successor row's after a remove, the Add control when no
   * row is left or after an add. `replaceChildren` otherwise dropped the
   * focused button and left focus nowhere (round 2 F007).
   */
  function restoreStepFocus(stepped: PendingStep, model: WorktreeProvisionOffer["model"]): void {
    const { kind, ordinal } = stepped.pressed;
    const rows = Array.from(bringBox.querySelectorAll<HTMLElement>(".wt-brow")).filter((row) =>
      (row.querySelector(".wt-brow-src")?.textContent ?? "").includes(SETUP_STEP_ADDED_SOURCE),
    );
    const count = addedOf(model).length;
    const at = kind === "add" ? -1 : Math.min(ordinal, count - 1);
    const row = at < 0 ? undefined : rows[at];
    const target = row?.querySelector<HTMLButtonElement>(
      kind === "edit" ? ".wt-brow-step-edit" : ".wt-brow-step-remove",
    );
    (target ?? addStepButton).focus();
  }

  function syncBringOver(offer: WorktreeProvisionOffer | undefined): void {
    if (offer === undefined) {
      // No offer has arrived. Saying nothing is right here and only here: the
      // form has not been told what this repository needs, and an empty section
      // would claim it needs nothing.
      bringField.hidden = true;
      bringSum.textContent = "";
      bringBox.replaceChildren();
      saveRow.remove();
      defaults.hidden = true;
      bring.clearDrawn();
      deps.syncWaitForSetup();
      return;
    }
    // `syncDerived` runs on every keystroke, and rebuilding there reset every
    // checkbox — so unticking Run setup and typing one more character silently
    // put it back (W2). The offer is the only thing this section renders, so its
    // id is the only thing that can require a redraw.
    if (bring.isDrawn(offer.offerId)) {
      return;
    }
    const restoreSource = document.activeElement?.classList.contains("wt-bring-source-select") === true;
    const changedFiles = changedFileIds(bring.drawnModel(), offer.model);
    const settled = bring.settle(offer);
    const ticked = settled.ticked;
    bringField.hidden = false;
    // DERIVED, never toggled. The record is per repository and the button is
    // one control shared by all of them, so a `disabled = false` on any redraw
    // re-enabled a button whose handler then silently returned — the busy state
    // the F014 fix exists to show, showing the wrong thing after a trip through
    // the repo picker (.reviews/round-3.md F014).
    saveButton.disabled = bring.saving();
    // And only where a save can actually be made: a control whose press the
    // host would never hear is the same nothing as a control with no offer
    // behind it (.reviews/round-1.md F009).
    defaults.hidden = !settled.canOfferSave;
    if (settled.canOfferSave) {
      defaults.appendChild(saveRow);
    } else {
      saveRow.remove();
    }
    const hasSourceChoice = offer.model.providers.some((provider) => !provider.active);
    bringHeading.hidden = !hasSourceChoice;
    bringField.classList.toggle("wt-bring--sparse", !hasSourceChoice);
    // After the selection exists, never before: the counts are read off it.
    bringSum.textContent = bringSummary(offer.model, ticked);
    bringSum.hidden = offer.model.problems.length === 0;
    const held = ticked;
    const rows = bringRows(offer.model).map((row) => ({ ...row, checked: held.has(row.id) }));
    // Every source the host detected and did not choose. `active` is the host's
    // word for which one supplied the rows above.
    // Problems sit inside the box beside the rows, not instead of them: an
    // unknown key does not discard the keys that parsed, and reporting only the
    // problem would understate what the create is about to do.
    // Replaced, never appended: a redrawn offer that added its switch rows to
    // the previous offer's would grow a row per switch taken.
    const onStep = !deps.canAskStep
      ? undefined
      : (kind: "edit" | "remove", itemId: string, control?: HTMLElement) =>
          askStep({ kind, offerId: offer.offerId, itemId }, control);
    groups = createProvisionGroups({
      rows,
      changedFiles,
      ...(deps.canAskCopy ? { addCopy: addCopyRow } : {}),
      ...(deps.canAskStep ? { addStep: addStepRow } : {}),
      onStep,
    });
    bringBox.replaceChildren(
      ...(hasSourceChoice
        ? [
            sourcePicker(offer.model.providers, (providerId) => {
              if (bring.takeSwitch(offer.offerId, providerId)) {
                saveRow.remove();
                defaults.hidden = true;
                syncStepControls();
              }
            }),
          ]
        : []),
      ...offer.model.problems.map((problem) => bringProblem(problem)),
      ...groups.elements,
    );
    groups.syncSelection(held);
    syncStepControls();
    if (restoreSource) {
      bringBox.querySelector<HTMLSelectElement>(".wt-bring-source-select")?.focus();
    }
    if (settled.stepAnswered?.restoreFocus === true) {
      restoreStepFocus(settled.stepAnswered, offer.model);
    }
    if (settled.copyAnswered?.restoreFocus === true && addCopyButton.isConnected && !addCopyButton.disabled) {
      addCopyButton.focus();
    }
    syncYieldNotes(held);
    bringBox.hidden = bringBox.childElementCount === 0;
    // The sentence stands in only where there is genuinely nothing to list. A
    // file that failed to parse has a problem row, which is a different answer,
    // and a switch row is an offer rather than something this worktree gets —
    // so a present source declaring nothing still says what the worktree lacks.
    bringEmpty.hidden = rows.length + offer.model.problems.length > 0;
    // A replacement offer starts a fresh ticked set (or reuses a prior visit's),
    // never the superseded offer's — so a replacement that selects no setup step
    // must re-disable the wait control rather than leave it armed for a
    // selection that no longer exists.
    deps.syncWaitForSetup();
  }
  return {
    field: bringField,
    defaults,
    sync: syncBringOver,
    syncControls: syncStepControls,
  };
}
