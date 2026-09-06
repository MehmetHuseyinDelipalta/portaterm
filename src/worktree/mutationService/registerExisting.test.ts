// src/worktree/mutationService/registerExisting.test.ts — OBL-2: an adoption or
// repair carrying a debris clearance is refused BEFORE its branch corroborates
// anything.
//
// The assertion is the CALL COUNT, not the reported message. Moving the guard
// past `corroborateAdopt` / `corroborateRepair` — after the entry write for
// adopt, after the probe for reattach — leaves the message byte-identical, so a
// test on the text passes with the defeater in place. The existing service suite
// asserts the message and the absence of the final git call, and both mutations
// survive it.
//
// The refusal matters because a clearance promises to DELETE the directory, and
// both of these modes re-register the very directory the clearance names. A
// branch that corroborates first has already read, and for adopt already
// written, against a path the same request asked to have destroyed.

import { describe, expect, it, vi } from "vitest";
import type { WorktreeMutationCapabilities } from "../../providers/WorktreeHost";
import type { DebrisAuthorization, WorktreeCreateMode } from "../../types/messages";
import type { GitCommandRunner } from "../gitCommandRunner";
import type { MutationOutcome } from "../worktreeMutationService";
import { createRegisterExisting, type RegisterExistingDeps } from "./registerExisting";

type CreateRequest = Parameters<WorktreeMutationCapabilities["createWorktree"]>[0];

const ADOPT: Extract<WorktreeCreateMode, { kind: "adopt" }> = {
  kind: "adopt",
  branch: "feat",
  adoptPath: "/repo/../wt",
  expectedBranchOid: "oid-branch",
};

const REATTACH: Extract<WorktreeCreateMode, { kind: "reattach" }> = {
  kind: "reattach",
  branch: "feat",
  repairPath: "/repo/../wt",
  expectedOid: "oid-head",
};

const request = (mode: WorktreeCreateMode, debris: boolean): CreateRequest => ({
  repoId: "/repo/.git",
  path: "/repo/../wt",
  mode,
  disposition: debris
    ? { kind: "debris", authorization: { fingerprint: "f1" } as unknown as DebrisAuthorization }
    : { kind: "free" },
  afterCreate: { kind: "none" },
});

const fail = (message: string): MutationOutcome => ({
  kind: "error",
  verb: "create",
  repoId: "/repo/.git",
  message,
});

function harness() {
  const corroborateAdopt = vi.fn(async () => ({ kind: "adopt" as const }) as never);
  const corroborateRepair = vi.fn(async () => ({ kind: "offer" as const }) as never);
  const listWorktrees = vi.fn(async () => []);
  const reconstructEntry = vi.fn(async () => ({ ok: false as const, message: "not reached" }) as never);
  const reported: MutationOutcome[] = [];

  const deps: RegisterExistingDeps = {
    runner: { run: vi.fn() } as unknown as GitCommandRunner,
    repoPath: () => "/repo",
    pathDeps: {
      normalize: async (raw: string) => raw,
      lstat: async () => ({ isDirectory: () => true, isSymbolicLink: () => false }),
    } as unknown as RegisterExistingDeps["pathDeps"],
    listWorktrees,
    corroborateAdopt,
    corroborateRepair,
    reconstructEntry,
    afterCreate: vi.fn(async () => {}),
    report: (outcome) => {
      reported.push(outcome);
    },
    runCoordinated: async (_repoId, step) => {
      const repoPath = await step.resolve();
      return await step.body(repoPath as string);
    },
  };

  return {
    handlers: createRegisterExisting(deps),
    reported,
    corroborateAdopt,
    corroborateRepair,
    listWorktrees,
    reconstructEntry,
  };
}

describe("a carried debris clearance (OBL-2)", () => {
  it("stops an adoption before it corroborates anything", async () => {
    const h = harness();

    await h.handlers.adopt(request(ADOPT, true), ADOPT, fail);

    // THE assertion. A test on the message below passes with the guard moved
    // past this call — and past `reconstructEntry`, which writes.
    expect(h.corroborateAdopt).not.toHaveBeenCalled();
    expect(h.reconstructEntry).not.toHaveBeenCalled();
    // Not even the listing the branch opens with: the guard is the first
    // statement, so nothing in the coordinator body runs at all.
    expect(h.listWorktrees).not.toHaveBeenCalled();
    expect(h.reported).toEqual([
      fail("An adoption re-registers the directory it was offered on, so this create will not run."),
    ]);
  });

  it("stops a repair before it corroborates anything", async () => {
    const h = harness();

    await h.handlers.reattach(request(REATTACH, true), REATTACH, fail);

    expect(h.corroborateRepair).not.toHaveBeenCalled();
    expect(h.listWorktrees).not.toHaveBeenCalled();
    expect(h.reported).toEqual([fail("A repair does not clear a directory, so this create will not run.")]);
  });
});

describe("without a clearance", () => {
  it("lets the adoption reach its corroboration, so the guard is what refused above", async () => {
    const h = harness();

    await h.handlers.adopt(request(ADOPT, false), ADOPT, fail);

    expect(h.corroborateAdopt).toHaveBeenCalledTimes(1);
  });

  it("lets the repair reach its corroboration", async () => {
    const h = harness();
    h.listWorktrees.mockResolvedValue([{ displayPath: "/repo/../wt", branch: "feat", prunable: true }] as never);

    await h.handlers.reattach(request(REATTACH, false), REATTACH, fail);

    expect(h.corroborateRepair).toHaveBeenCalledTimes(1);
  });
});
