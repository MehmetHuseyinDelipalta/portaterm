// src/webview/worktree/createDialog/sections.ts — The blocks of the form below
// the branch: what happens once the worktree exists, the agent box, the setup
// wait it gates, the advanced disclosure, and the actions row.
//
// Extracted from `openWorktreeCreateDialog` by change `decompose-create-dialog`
// (design.md D1, task 1_10). What holds them together is the dialog's own field
// ORDER — each is appended where it appears on screen, and the appends have to
// stay in one place and in this sequence or the form rearranges itself. So this
// is construction, not behaviour: the only decision that stayed is
// `syncWaitForSetup`, because the wait box is the one control here whose state
// is re-decided from something else (the setup rows above it).
//
// `waitChoice` came with it. It is the reason the wait is a value and not a
// touched flag, and it is read by nothing else.
//
// The after-choice vocabulary moved too, since `openAfterOptions` is what builds
// the select this file owns; the facade re-exports nothing of it and hands it to
// `afterCreate` and the render pass from here.
//
// No suite beside this file (design.md D2): it appends elements, and the
// 386-case dialog suite is what can see where they landed.

import { ICON_CHEVRON_DOWN } from "../../vault/icons";
import { createWorktreeAgentBox, type WorktreeAgentBox } from "../worktreeAgentBox";
import { field, keyHint, selectControl, textButton } from "../worktreeDialogShell";
import type { WorktreeCreateDefaults, WorktreeOpenAfter } from "../worktreeViewTypes";
import type { AfterChoice, DraftModel } from "./draftModel";
import type { FormFields } from "./formFields";
import type { ProvisionState } from "./provisionState";

// `AfterChoice` is the form's own vocabulary and lives with the answer it names
// (createDialog/draftModel.ts). Opening the folder is one intent with two
// destinations, and listing them as two peers of "Nothing" made the choice read
// as four ways to open something. The pair is reached through a secondary
// control instead; no wire value becomes unreachable.
const AFTER_CHOICES: readonly { value: AfterChoice; label: string }[] = [
  { value: "none", label: "Nothing" },
  { value: "terminal", label: "Open a terminal here" },
  { value: "agent", label: "Start an agent" },
  { value: "folder", label: "Open the folder" },
];

/** The two the folder choice resolves to. Adding to the workspace leads: opening
 *  a second window on a folder the user is already in is the disruptive one. */
const FOLDER_MODES: readonly { value: WorktreeOpenAfter; label: string }[] = [
  { value: "addToWorkspace", label: "Add to this workspace" },
  { value: "newWindow", label: "Open in a new window" },
];

/**
 * `agent` is offered only where something can perform it — the option is built
 * from the repo's own agent list, so a host that reported none leaves it absent
 * rather than selectable-and-refused. The folder choice is always performable.
 */
export function openAfterOptions(canLaunch: boolean): { value: AfterChoice; label: string }[] {
  return AFTER_CHOICES.filter((o) => o.value !== "agent" || canLaunch);
}

export interface SectionsDeps {
  readonly dialog: HTMLElement;
  readonly actions: HTMLElement;
  readonly fields: FormFields;
  readonly model: DraftModel;
  readonly bring: ProvisionState;
  /** The bring-over section's own field: the wait line is its last row, because
   *  what the wait gates is the setup rows above it. */
  readonly bringField: HTMLElement;
  readonly defaults: HTMLElement;
  readonly safeInitialAgentId: string | undefined;
  currentRepo(): WorktreeCreateDefaults;
  syncOpenAfter(): void;
  syncDerived(): void;
  refreshFocusTrap(): void;
  cancel(): void;
  submit(): void;
}

export interface Sections {
  readonly afterSelect: HTMLSelectElement;
  readonly afterNote: HTMLElement;
  readonly folderField: HTMLElement;
  readonly agentBox: WorktreeAgentBox;
  readonly waitBox: HTMLInputElement;
  readonly disabledReason: HTMLElement;
  readonly createBtn: HTMLButtonElement;
  readonly createLabel: HTMLElement;
  /**
   * Re-decide the wait's visibility and enablement from the agent choice and the
   * current setup selection. Called wherever either can have changed: the
   * after-choice toggle, a full re-derive (repo switch, offer replacement), and
   * a tick inside the bring-over section.
   */
  syncWaitForSetup(): void;
}

export function createSections(deps: SectionsDeps): Sections {
  const { dialog, actions, fields, model } = deps;
  dialog.classList.add("wt-create-dialog");
  const launch = document.createElement("div");
  launch.className = "wt-create-launch";

  // ── After creating ──────────────────────────────────────────────────────
  const afterField = field("After creating", "wt-after");
  const afterSelect = selectControl(
    "wt-after",
    openAfterOptions(deps.currentRepo().agents.length > 0).map((o) => ({ value: o.value, label: o.label })),
    model.afterChoice(),
  );
  afterSelect.addEventListener("change", () => {
    model.setAfterChoice(afterSelect.value as AfterChoice);
    deps.syncOpenAfter();
  });
  const afterNote = document.createElement("span");
  afterNote.className = "wt-fhint wt-after-note";
  afterField.append(afterSelect, afterNote);

  // The secondary control on the folder choice, revealed by it the same way the
  // agent block is revealed by the agent choice.
  const folderField = field("Where", "wt-folder-mode");
  folderField.classList.add("wt-folder-mode");
  const folderSelect = selectControl("wt-folder-mode", [...FOLDER_MODES], model.folderMode());
  folderSelect.addEventListener("change", () => {
    model.setFolderMode(folderSelect.value as WorktreeOpenAfter);
    deps.syncOpenAfter();
  });
  folderField.appendChild(folderSelect);
  folderField.hidden = true;
  launch.append(afterField, folderField);
  dialog.appendChild(launch);

  // ── Agent box — shown only for `openAfter: "agent"` ─────────────────────
  // The block itself is shared with the standalone launch dialog, so create-then-
  // launch and launch-here collect the same thing rather than two things that
  // happen to look alike (design.md D7).
  const agentBox = createWorktreeAgentBox(
    deps.currentRepo().agents,
    () => deps.syncDerived(),
    deps.safeInitialAgentId,
    { compact: true },
  );
  agentBox.setVisible(model.afterChoice() === "agent");
  launch.appendChild(agentBox.element);

  // Sequencing belongs beside setup, and appears only once there is something to wait for.
  const waitField = document.createElement("div");
  waitField.className = "wt-wait-setup";
  waitField.hidden = true;
  const waitLabel = document.createElement("label");
  waitLabel.htmlFor = "wt-wait-setup";
  const waitBox = document.createElement("input");
  waitBox.type = "checkbox";
  waitBox.id = "wt-wait-setup";
  const waitText = document.createElement("span");
  waitText.textContent = "Start agent after setup";
  waitLabel.append(waitBox, waitText);
  waitField.appendChild(waitLabel);
  // The order the current state produces, said rather than left to be inferred
  // from a checkbox: an agent that starts into a half-installed tree is the
  // confusion this recommendation exists to prevent.
  const waitNote = document.createElement("span");
  waitNote.className = "wt-fhint wt-wait-note";
  waitField.appendChild(waitNote);
  // The setup choices above own this sequencing control.
  deps.bringField.appendChild(waitField);

  /**
   * What the user set the wait to themselves, or `undefined` while untouched.
   *
   * The VALUE rather than a touched flag, because the box is forced off
   * whenever no setup is selected: a flag alone remembers that a choice was
   * made and loses which one, so an explicit ON came back off the next time
   * there was something to wait for. The recommendation is a default, not a
   * policy — an armed box and an explicitly ticked one are the same DOM state,
   * and only the untouched one may be re-decided by the selection.
   */
  let waitChoice: boolean | undefined;
  waitBox.addEventListener("change", () => {
    waitChoice = waitBox.checked;
    syncWaitForSetup();
  });

  /** The setup steps currently selected in the drawn offer, if any. */
  /**
   * Re-decide visibility and enablement from the agent choice and the current
   * setup selection. Called wherever either can have changed: the after-choice
   * toggle, a full re-derive (repo switch, offer replacement), and a tick
   * inside the bring-over section.
   *
   * Unchecked along with disabled, not merely disabled-and-stale: a wait this
   * control cannot be seen to be armed for must not silently keep armed.
   */
  function syncWaitForSetup(): void {
    const selected = deps.bring.hasSelectedSetup();
    waitField.hidden = model.afterChoice() !== "agent" || !selected;
    waitBox.disabled = !selected || deps.bring.anyAsking();
    if (!selected) {
      // Nothing to wait for is not a gate. The user's own choice is kept for
      // the next time there IS something, but the box cannot stay armed for
      // steps that are no longer selected.
      waitBox.checked = false;
    } else {
      // Recommended, because setup usually installs what the agent is about to
      // read — but only while untouched. An explicit choice owns the box from
      // then on, in both directions.
      waitBox.checked = waitChoice ?? true;
    }
    waitNote.hidden = !selected || waitBox.checked;
    waitNote.textContent = waitNote.hidden ? "" : "The agent starts while the selected setup is still running.";
  }

  // ── Advanced — collapsed, and out of the focus order while it is ────────
  // The same reveal idiom the agent block uses: a toggle carrying `aria-expanded`
  // over a region carrying `hidden`. `openDialogShell`'s focus trap already
  // filters on `[hidden]`, so nothing inside reaches Tab until it opens — which a
  // native `<details>` would not have given us without widening that filter.
  const advanced = document.createElement("div");
  advanced.className = "wt-advanced";
  const advToggle = document.createElement("button");
  advToggle.type = "button";
  advToggle.className = "wt-advanced-toggle";
  advToggle.id = "wt-advanced-toggle";
  advToggle.setAttribute("aria-expanded", "false");
  advToggle.setAttribute("aria-controls", "wt-advanced-body");
  // "Advanced" says who the contents are for, not what they are, so a user has
  // to open it to find out whether it holds anything they wanted. Naming the
  // three inputs lets them decide without opening it. The chevron is the
  // tree's own (`worktreeTreeView.ts`), turned by `aria-expanded` below, so the
  // line reads as something that opens and not as a heading.
  const advChev = document.createElement("span");
  advChev.className = "wt-chev";
  advChev.innerHTML = ICON_CHEVRON_DOWN;
  advChev.setAttribute("aria-hidden", "true");
  const advLabel = document.createElement("span");
  advLabel.textContent = "Branch, location & defaults";
  advToggle.append(advChev, advLabel);
  const advBody = document.createElement("div");
  advBody.className = "wt-advanced-body";
  advBody.id = "wt-advanced-body";
  advBody.hidden = true;
  advBody.append(fields.modeField, fields.baseField, fields.pathField, deps.defaults);
  advToggle.addEventListener("click", () => {
    advBody.hidden = !advBody.hidden;
    advToggle.setAttribute("aria-expanded", advBody.hidden ? "false" : "true");
    deps.refreshFocusTrap();
  });
  advanced.append(advToggle, advBody);
  dialog.appendChild(advanced);

  // ── Actions ─────────────────────────────────────────────────────────────
  const disabledReason = document.createElement("span");
  disabledReason.className = "wt-create-disabled-reason";
  disabledReason.id = "wt-create-disabled-reason";
  disabledReason.setAttribute("role", "status");
  disabledReason.setAttribute("aria-live", "polite");
  actions.appendChild(disabledReason);
  const cancelBtn = textButton("Cancel", "plain", () => deps.cancel());
  const createBtn = textButton("", "primary", () => deps.submit());
  const createLabel = document.createElement("span");
  createLabel.className = "wt-create-label";
  createLabel.textContent = "Create worktree";
  createBtn.append(createLabel, keyHint("⌘↵"));
  actions.append(cancelBtn, createBtn);
  dialog.appendChild(actions);
  return {
    afterSelect,
    afterNote,
    folderField,
    agentBox,
    waitBox,
    disabledReason,
    createBtn,
    createLabel,
    syncWaitForSetup,
  };
}
