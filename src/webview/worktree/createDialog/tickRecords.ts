// src/webview/worktree/createDialog/tickRecords.ts — Which added rows the user
// turned off, by ordinal, per repository — and what that means for the offer
// that answers an ask.
//
// Split out of `provisionState.ts` during task 1_7 of change
// `decompose-create-dialog`: the two together came to 544 lines, over the goal
// this change exists to meet, and this half is the one with its own subject.
// It is also the subject of both of the change's provisioning obligations, so
// the suite has something smaller than a dialog to drive.
//
//   * OBL-1 — keyed by REPOSITORY. A tick set on repo A is not applied to repo
//     B, and is still there on the way back.
//   * OBL-2 — `carryForward` carries ticks AND unticks across a reminted offer
//     id, which is what `settleStep` and `settleCopy` are built on.
//
// Ordinal, never descriptor: two added rows may carry the same script, and a
// descriptor moved the first one's tick onto the second on a remove.
//
// Headless — no import touches the DOM.

import { SETUP_STEP_ADDED_SOURCE } from "../../../types/messages";
import type { WorktreeProvisionOffer } from "../worktreeViewTypes";
import { bringRows, carryForward } from "./bringSummaries";

type ProvisionModel = WorktreeProvisionOffer["model"];

/** The half of a pending ask this module needs: what it went out against. */
export interface AnsweredAsk {
  readonly model: ProvisionModel;
  readonly kept: ReadonlySet<string>;
  /** For a remove: which ordinal the answer will have spliced out. */
  readonly removing?: number;
}

export interface TickRecords {
  /** Apply the record for `repoId` over a selection being built. */
  applyFor(repoId: string, model: ProvisionModel, into: Set<string>): void;
  /** Record one tick or untick against the model it was made on. */
  record(repoId: string, model: ProvisionModel, itemId: string, on: boolean): void;
  /** The selection an answered ask leaves behind, record applied. */
  settle(ask: AnsweredAsk, model: ProvisionModel, repoId: string): Set<string>;
}

export const addedOf = (model: ProvisionModel) => model.setup.filter((step) => step.source === SETUP_STEP_ADDED_SOURCE);

export function createTickRecords(): TickRecords {
  /**
   * Every added step's tick, per repository, by RECORD ordinal.
   *
   * Written on each toggle and applied to every answering offer, whatever
   * answered it. Ordinal, not descriptor: two added rows may carry the same
   * script, and a descriptor moved the first one's tick onto the second on a
   * remove (round 1 F001). One vector for the whole record, not a snapshot of
   * the rows shown: a denser source shows only a prefix of the record
   * (design.md D3), and a snapshot of that prefix forgot every hidden step's
   * tick, which came back at its default on the switch back (round 2 plan
   * attack 3). The shown rows are a prefix, so the shown ordinal IS the record
   * ordinal. A step past the vector's end is new and takes its default, ON.
   */
  const addedTickRecord = new Map<string, boolean[]>();
  const applyAddedTicksFor = (repoId: string, model: ProvisionModel, into: Set<string>): void => {
    const ticks = addedTickRecord.get(repoId) ?? [];
    addedOf(model).forEach((step, i) => {
      if (ticks[i] ?? true) {
        into.add(step.id);
      } else {
        into.delete(step.id);
      }
    });
  };
  const addedCopyTickRecord = new Map<string, boolean[]>();
  const addedCopiesOf = (model: ProvisionModel) => model.entries.filter((entry) => entry.addedForCreate === true);
  const applyAddedCopyTicksFor = (repoId: string, model: ProvisionModel, into: Set<string>): void => {
    const ticks = addedCopyTickRecord.get(repoId) ?? [];
    addedCopiesOf(model).forEach((entry, index) => {
      if (ticks[index] ?? true) {
        into.add(entry.id);
      } else {
        into.delete(entry.id);
      }
    });
  };
  const recordOrdinalTick = (
    repoId: string,
    itemId: string,
    on: boolean,
    items: readonly { id: string }[],
    records: Map<string, boolean[]>,
  ): void => {
    const ordinal = items.findIndex((item) => item.id === itemId);
    if (ordinal < 0) {
      return;
    }
    const ticks = records.get(repoId) ?? [];
    while (ticks.length <= ordinal) {
      ticks.push(true);
    }
    ticks[ordinal] = on;
    records.set(repoId, ticks);
  };
  const applyBoth = (repoId: string, model: ProvisionModel, into: Set<string>): void => {
    applyAddedTicksFor(repoId, model, into);
    applyAddedCopyTicksFor(repoId, model, into);
  };

  return {
    applyFor: applyBoth,

    record(repoId, model, itemId, on) {
      recordOrdinalTick(repoId, itemId, on, addedOf(model), addedTickRecord);
      recordOrdinalTick(repoId, itemId, on, addedCopiesOf(model), addedCopyTickRecord);
    },

    settle(ask, model, repoId) {
      const ticked = carryForward(ask.model, ask.kept, bringRows(model), model);
      if (ask.removing !== undefined) {
        const ticks = addedTickRecord.get(repoId);
        if (ticks !== undefined && ask.removing < ticks.length) {
          ticks.splice(ask.removing, 1);
        }
      }
      applyBoth(repoId, model, ticked);
      return ticked;
    },
  };
}
