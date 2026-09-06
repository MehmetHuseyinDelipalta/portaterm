// src/webview/worktree/createDialog/provisionState.test.ts — The two provisioning
// obligations of change `decompose-create-dialog`, asserted against the state
// module rather than against a rendered dialog.
//
// NO environment pragma. `vitest.config.mts` sets no environment and no match
// rule, so the node default applies and `document` is undefined here — a DOM
// reference creeping into `provisionState.ts` or `tickRecords.ts` throws in
// whichever method holds it rather than passing quietly under the dialog
// suite's jsdom.
//
//   * OBL-1 — tick records are keyed by REPOSITORY. A tick set on repo A is not
//     applied to repo B, and is still there on the way back.
//   * OBL-2 — `carryForward` carries ticks AND unticks across a reminted offer
//     id. The inherited dialog suite asserts the tick half at `:3040-3078`; the
//     untick half is asserted here, and by mutation it is the faster witness
//     rather than the only one (workflow.md Notes).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { type ProvisionEntry, type ProvisionSetupStep, SETUP_STEP_ADDED_SOURCE } from "../../../types/messages";
import type { WorktreeProvisionOffer } from "../worktreeViewTypes";
import { createProvisionState, type ProvisionState } from "./provisionState";

type Model = WorktreeProvisionOffer["model"];

const entry = (id: string, path: string, over: Partial<ProvisionEntry> = {}): ProvisionEntry =>
  ({ id, path, mode: "copy", ...over }) as ProvisionEntry;

/** An ADDED step: the only kind the ordinal record is about. */
const added = (id: string, script: string): ProvisionSetupStep =>
  ({ id, script, source: SETUP_STEP_ADDED_SOURCE }) as ProvisionSetupStep;

function model(over: Partial<Model> = {}): Model {
  return {
    entries: [],
    setup: [],
    ports: [],
    providers: [],
    excluded: [],
    contenders: [],
    problems: [],
    ...over,
  } as Model;
}

const offer = (offerId: string, m: Model): WorktreeProvisionOffer => ({ offerId, model: m }) as WorktreeProvisionOffer;

let repoId: string;
let state: ProvisionState;
const onSetupStepAsk = vi.fn();
const onProvisionSave = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  repoId = "repo-a";
  state = createProvisionState({
    repoId: () => repoId,
    pickAsking: () => false,
    canSave: true,
    canAskStep: true,
    canAskCopy: true,
    onProvisionSave,
    onSetupStepAsk,
  });
});

describe("the module is headless", () => {
  it("has no DOM to reach for", () => {
    expect(typeof globalThis.document).toBe("undefined");
  });
});

describe("tick records are keyed by repository (OBL-1)", () => {
  it("does not apply repo A's untick to repo B, and still has it on the way back", () => {
    const a1 = model({ setup: [added("a-s1", "pnpm i")] });
    const b1 = model({ setup: [added("b-s1", "pnpm i")] });

    // Repo A: the added step arrives ticked by default, and the user turns it off.
    state.settle(offer("a-1", a1));
    expect(state.ticked()?.has("a-s1")).toBe(true);
    state.toggle("a-s1", false);
    expect(state.ticked()?.has("a-s1")).toBe(false);

    // Repo B, a different repository with an added step at the SAME ordinal.
    // Nothing repo A recorded may reach it: its step is new and takes its
    // default, ON.
    repoId = "repo-b";
    state.settle(offer("b-1", b1));
    expect(state.ticked()?.has("b-s1")).toBe(true);

    // Back on A, on a reminted offer id — the record, not the dead set.
    repoId = "repo-a";
    const a2 = model({ setup: [added("a-s1-new", "pnpm i")] });
    state.settle(offer("a-2", a2));
    expect(state.ticked()?.has("a-s1-new")).toBe(false);
  });

  it("keeps one repository's copy-record off another's added file", () => {
    const a = model({ entries: [entry("a-e1", ".env", { addedForCreate: true })] });
    const b = model({ entries: [entry("b-e1", ".env", { addedForCreate: true })] });

    state.settle(offer("a-1", a));
    state.toggle("a-e1", false);

    repoId = "repo-b";
    state.settle(offer("b-1", b));
    expect(state.ticked()?.has("b-e1")).toBe(true);
  });
});

describe("an untick survives a reminted offer (OBL-2)", () => {
  it("carries the untick, not only the tick, onto the answering offer", () => {
    const before = model({
      entries: [entry("e1", ".env"), entry("e2", ".npmrc")],
    });
    state.settle(offer("o-1", before));
    // Both arrive ticked; the user turns one off. That decision is the thing
    // that has to survive — a carry that only copied ticks would silently put
    // `.npmrc` back.
    state.toggle("e2", false);
    expect([...(state.ticked() ?? [])].sort()).toEqual(["e1"]);

    // The ask, and the answer: a fresh offer id whose item ids are all new.
    expect(state.askStep({ kind: "add" }, false)).toBe(true);
    const after = model({
      entries: [entry("n1", ".env"), entry("n2", ".npmrc")],
      setup: [added("n3", "pnpm i")],
    });
    state.settle(offer("o-2", after));

    expect(state.ticked()?.has("n1")).toBe(true);
    expect(state.ticked()?.has("n2")).toBe(false);
    // The step just added is new and takes its default.
    expect(state.ticked()?.has("n3")).toBe(true);
  });

  it("splices the removed ordinal out, so the survivor keeps its own tick", () => {
    const before = model({ setup: [added("s1", "one"), added("s2", "two")] });
    state.settle(offer("o-1", before));
    // The FIRST is turned off. Removing it must not leave the second wearing
    // that untick — the defect an ordinal record exists to prevent.
    state.toggle("s1", false);
    expect(state.askStep({ kind: "remove", offerId: "o-1", itemId: "s1" }, false)).toBe(true);

    const after = model({ setup: [added("s2-new", "two")] });
    state.settle(offer("o-2", after));
    expect(state.ticked()?.has("s2-new")).toBe(true);
  });
});

describe("what an ask is refused for", () => {
  it("posts nothing while another ask is already out", () => {
    state.settle(offer("o-1", model({ setup: [added("s1", "one")] })));
    expect(state.askStep({ kind: "add" }, false)).toBe(true);
    expect(state.askStep({ kind: "add" }, false)).toBe(false);
    expect(onSetupStepAsk).toHaveBeenCalledTimes(1);
  });

  it("posts nothing with no offer drawn", () => {
    expect(state.askSave()).toBe(false);
    expect(onProvisionSave).not.toHaveBeenCalled();
  });

  it("withdraws a pending restore when focus moves elsewhere in the dialog", () => {
    state.settle(offer("o-1", model({ setup: [added("s1", "one")] })));
    state.askStep({ kind: "add" }, true);
    state.releaseFocusRestore();
    const settled = state.settle(offer("o-2", model({ setup: [added("s1-new", "one")] })));
    expect(settled.stepAnswered?.restoreFocus).toBe(false);
  });
});
