// src/webview/worktree/createDialog/afterCreate.ts — What happens once the
// worktree exists: the choice, the two reveals it drives, and the hint under it.
//
// Split out of `derivePass.ts` during task 1_9b of change
// `decompose-create-dialog`: the pass came to 542 lines with these inside, over
// the goal this change exists to meet, and they are their own subject. The
// derive pass is about what the create WOULD DO; this is about what happens
// after it has been done.
//
// Two different questions, and the agent box keeps them apart: "this create is
// not launching" is ours, "there is nothing to launch" is its own.

import { initialSafeAgentId, type WorktreeAgentBox } from "../worktreeAgentBox";
import type { WorktreeLaunchAgent } from "../worktreeViewTypes";
import type { AfterChoice, DraftModel } from "./draftModel";

export interface AfterCreateDeps {
  readonly model: DraftModel;
  readonly afterSelect: HTMLSelectElement;
  readonly afterNote: HTMLElement;
  readonly folderField: HTMLElement;
  readonly agentBox: WorktreeAgentBox;
  canLaunch(): boolean;
  agents(): readonly WorktreeLaunchAgent[];
  /** The full re-derive, which this drives but is not part of. */
  syncDerived(): void;
  openAfterOptions(canLaunch: boolean): readonly { value: AfterChoice; label: string }[];
}

export interface AfterCreate {
  /** The reveals the after-create choice drives, and the wire value it means. */
  syncOpenAfter(): void;
  /** A repo switch can withdraw the launch — the mode goes with it, not just the box. */
  rebuildAfterOptions(): void;
  /** The hint under the choice, restated from what the form now holds. */
  syncAfterHint(): void;
}

export function createAfterCreate(deps: AfterCreateDeps): AfterCreate {
  const { afterNote, afterSelect, agentBox, folderField, model } = deps;
  const _draft = model.draft;

  /**
   * The one place the offered choice becomes a wire value, and the one place the
   * two reveals it drives are applied. Two different questions, and the agent box
   * keeps them apart: "this create is not launching" is ours, "there is nothing
   * to launch" is its own.
   */
  function syncAfterHint(): void {
    if (model.afterChoice() === "none") {
      afterNote.textContent = "No terminal, folder, or agent opens after creation.";
    } else if (model.afterChoice() === "terminal") {
      afterNote.textContent = "Opens a terminal in the worktree.";
    } else if (model.afterChoice() === "folder") {
      afterNote.textContent =
        model.folderMode() === "addToWorkspace"
          ? "Adds the worktree folder to this workspace."
          : "Opens the worktree folder in a separate window.";
    } else {
      const selected = agentBox.read().agentId;
      const label = deps.agents().find((agent) => agent.id === selected)?.label ?? "the selected agent";
      afterNote.textContent = `Starts ${label} in the worktree.`;
    }
  }

  function syncOpenAfter(): void {
    model.applyOpenAfter();
    agentBox.setVisible(model.afterChoice() === "agent");
    syncAfterHint();
    folderField.hidden = model.afterChoice() !== "folder";
    // The submit gate reads the revealed block, so revealing one has to re-ask
    // it. `syncDerived` does not call back here, so this does not recurse.
    deps.syncDerived();
  }

  /** A repo switch can withdraw the launch — the mode goes with it, not just the box. */
  function rebuildAfterOptions(): void {
    const offered = deps.openAfterOptions(deps.agents().length > 0);
    // Only a choice the rebuild actually withdrew is reset. The folder choice is
    // always offered, so a repo switch that drops the agent one must leave it —
    // and its secondary selection — exactly where the user put them.
    model.retargetAfterChoice(
      offered.map((o) => o.value),
      initialSafeAgentId(deps.agents()) === undefined ? "terminal" : "agent",
    );
    afterSelect.replaceChildren(
      ...offered.map((o) => {
        const opt = document.createElement("option");
        opt.value = o.value;
        opt.textContent = o.label;
        return opt;
      }),
    );
    afterSelect.value = model.afterChoice();
    syncOpenAfter();
  }

  return { syncOpenAfter, rebuildAfterOptions, syncAfterHint };
}
