// src/webview/worktree/createDialog/draftModel.test.ts — The create form's
// answer, driven without a form.
//
// NO environment pragma, deliberately (OBL-4). The root vitest config runs node,
// so `document` and every DOM constructor are undefined here: a reference that
// creeps into `draftModel.ts` throws in whichever method holds it rather than
// passing quietly under the dialog suite's jsdom. Every method below is called
// for that reason as much as for its assertion.

import { describe, expect, it } from "vitest";
import { type AfterChoice, createDraftModel, type DraftModel } from "./draftModel";

function model(initialAfterChoice: AfterChoice = "terminal"): DraftModel {
  return createDraftModel({ initialRepoId: "r1", initialAfterChoice });
}

describe("the module is headless (OBL-4)", () => {
  it("has no DOM to reach for", () => {
    expect(typeof globalThis.document).toBe("undefined");
  });
});

describe("the destination's three states", () => {
  it("starts derived, with nothing to tell the host", () => {
    const m = model();
    expect(m.pathIsDerived()).toBe(true);
    expect(m.destinationCandidate()).toEqual({});
  });

  it("carries a typed path as the candidate, never as the answer", () => {
    const m = model();
    m.stateDestination({ kind: "typed", path: "/tmp/wt" });
    expect(m.pathIsDerived()).toBe(false);
    expect(m.destinationCandidate()).toEqual({ candidatePath: "/tmp/wt" });
    // `draft.path` is what a submit states, and only the resolution writes it.
    expect(m.draft.path).toBe("");
  });

  it("treats a cleared field as withdrawing the override, not as overriding nowhere", () => {
    const m = model();
    m.stateDestination({ kind: "typed", path: "/tmp/wt" });
    m.stateDestination({ kind: "typed", path: "   " });
    expect(m.pathIsDerived()).toBe(true);
    expect(m.destinationCandidate()).toEqual({});
  });

  it("never sends a path and the folder together, whichever came first", () => {
    const m = model();
    m.stateDestination({ kind: "typed", path: "/tmp/wt" });
    m.stateDestination({ kind: "chosen" });
    expect(m.destinationCandidate()).toEqual({ useChosenFolder: true });
    expect(m.supplied()).toBe("");

    m.stateDestination({ kind: "typed", path: "/tmp/other" });
    expect(m.destinationCandidate()).toEqual({ candidatePath: "/tmp/other" });
    expect(m.usingChosen()).toBe(false);
  });

  it("drops the folder on a repo switch but keeps a typed path, which means the same in either repo", () => {
    const m = model();
    m.stateDestination({ kind: "chosen" });
    m.stateDestination({ kind: "repoChanged" });
    expect(m.destinationCandidate()).toEqual({});

    m.stateDestination({ kind: "typed", path: "/tmp/wt" });
    m.stateDestination({ kind: "repoChanged" });
    expect(m.destinationCandidate()).toEqual({ candidatePath: "/tmp/wt" });
  });

  it("withdraws both halves where the mode refuses a destination (round-1 F004)", () => {
    const m = model();
    m.stateDestination({ kind: "typed", path: "/tmp/wt" });
    m.withdrawDestination();
    expect(m.destinationCandidate()).toEqual({});

    // Withdrawn for good: the chosen folder does not come back on the next edge.
    m.stateDestination({ kind: "repoChanged" });
    expect(m.destinationCandidate()).toEqual({});
  });

  it("states the path the resolution answered with, separately from the candidate", () => {
    const m = model();
    m.stateDestination({ kind: "typed", path: "/tmp/wt" });
    m.statePath("/tmp/wt-2");
    expect(m.draft.path).toBe("/tmp/wt-2");
    expect(m.supplied()).toBe("/tmp/wt");
  });
});

describe("what happens after creating", () => {
  it("derives one wire value from the choice and the folder mode", () => {
    const m = model("agent");
    expect(m.draft.openAfter).toBe("agent");

    m.setAfterChoice("folder");
    m.applyOpenAfter();
    expect(m.draft.openAfter).toBe("addToWorkspace");

    m.setFolderMode("newWindow");
    m.applyOpenAfter();
    expect(m.draft.openAfter).toBe("newWindow");
  });

  it("never leaves `folder` on the wire, which has no such value", () => {
    const m = model("folder");
    expect(m.draft.openAfter).toBe("addToWorkspace");
    expect(m.afterChoice()).toBe("folder");
  });

  it("resets only a choice the rebuild actually withdrew", () => {
    const m = model("agent");
    m.setFolderMode("newWindow");
    m.retargetAfterChoice(["none", "terminal", "folder"], "terminal");
    expect(m.afterChoice()).toBe("terminal");

    // The folder choice is always offered, so its secondary selection survives.
    m.setAfterChoice("folder");
    m.retargetAfterChoice(["none", "terminal", "folder"], "terminal");
    expect(m.afterChoice()).toBe("folder");
    expect(m.folderMode()).toBe("newWindow");
  });
});

describe("the opening's end", () => {
  it("is what every bound applier reads, and it only goes one way", () => {
    const m = model();
    expect(m.closed()).toBe(false);
    m.close();
    expect(m.closed()).toBe(true);
    m.close();
    expect(m.closed()).toBe(true);
  });
});
