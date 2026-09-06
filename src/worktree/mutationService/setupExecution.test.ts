// src/worktree/mutationService/setupExecution.test.ts — The retry authority,
// driven without a mutation service.
//
// OBL-1 has two halves and the service suite only witnesses one. It spends
// `retry-1` twice against ONE repository, which catches a lost rotation; every
// retry case in it uses one repository, so dropping `repoId` from `retryKey`
// moves nothing there. The cross-repository spend below is the half that
// existing suite cannot see.

import { describe, expect, it, vi } from "vitest";
import type { MutationCoordinator, MutationStep } from "../mutationCoordinator";
import type { ResolvedTarget } from "../worktreeMutationService";
import { createSetupExecution, type PendingSetupRetry, retryKey } from "./setupExecution";

/** Runs the step inline: this suite is about the authority, not the queue. */
const coordinator: MutationCoordinator = {
  async run<TTarget, TResult>(_repoId: string, step: MutationStep<TTarget, TResult>): Promise<TResult> {
    const target = await step.resolve();
    if (target === null) {
      return (await step.missing?.()) as TResult;
    }
    return step.body(target, { settle: async () => {} });
  },
};

const resolved = (worktreePath: string, incarnation = "inc-1"): ResolvedTarget =>
  ({ worktreePath, incarnation, worktreeId: worktreePath }) as unknown as ResolvedTarget;

const pending = (worktreePath: string, repoId: string): PendingSetupRetry =>
  ({
    repoId,
    worktreeId: worktreePath,
    worktreePath,
    mainPath: "/repo",
    branch: "feat",
    steps: [{ id: "s1", source: "repo", script: "echo hi" }],
    asimovEnvironment: false,
    ports: {},
    authorization: { path: worktreePath } as never,
    materialized: [],
    portResults: [],
  }) as unknown as PendingSetupRetry;

function harness(over: { resolve?: (t: { repoId: string; worktreeId: string }) => ResolvedTarget | null } = {}) {
  let minted = 0;
  const runSetup = vi.fn(async () => ({ steps: [], succeeded: false }));
  const reportProvisioning = vi.fn();
  const setup = createSetupExecution({
    coordinator,
    newSetupRetryId: () => `retry-${++minted}`,
    resolve: over.resolve ?? ((t) => resolved(t.worktreeId)),
    runSetup,
    reportProvisioning,
  });
  return { setup, runSetup, reportProvisioning };
}

describe("publishing an authority", () => {
  it("mints where the map is, so a caller cannot hold an id the module never recorded", () => {
    const h = harness();
    const id = h.setup.register("r1", "/wt/a", pending("/wt/a", "r1"));
    expect(id).toBe("retry-1");
    expect(h.setup.heldKeys()).toEqual([retryKey("r1", "/wt/a")]);
  });

  it("mints nothing when the worktree that came back is not the one setup ran against", () => {
    const h = harness({ resolve: () => resolved("/wt/somewhere-else") });
    expect(h.setup.register("r1", "/wt/a", pending("/wt/a", "r1"))).toBeNull();
    expect(h.setup.heldKeys()).toEqual([]);
  });

  it("retires whatever the key held even when there is nothing to publish", () => {
    const h = harness();
    h.setup.register("r1", "/wt/a", pending("/wt/a", "r1"));
    expect(h.setup.register("r1", "/wt/a", undefined)).toBeNull();
    expect(h.setup.heldKeys()).toEqual([]);
  });
});

describe("spending an authority", () => {
  it("is one-shot: the second spend of the same id does nothing", async () => {
    const h = harness();
    const id = h.setup.register("r1", "/wt/a", pending("/wt/a", "r1"));

    await h.setup.retrySetup({ repoId: "r1", worktreeId: "/wt/a" }, id as string);
    expect(h.runSetup).toHaveBeenCalledTimes(1);

    await h.setup.retrySetup({ repoId: "r1", worktreeId: "/wt/a" }, id as string);
    expect(h.runSetup).toHaveBeenCalledTimes(1);
  });

  it("refuses an authority issued for another REPOSITORY (OBL-1 scoping)", async () => {
    const h = harness();
    const id = h.setup.register("r1", "/wt/a", pending("/wt/a", "r1"));

    // Same worktree id, different repository. A key carrying only the worktree
    // would find the record and spend it here.
    await h.setup.retrySetup({ repoId: "r2", worktreeId: "/wt/a" }, id as string);

    expect(h.runSetup).not.toHaveBeenCalled();
    expect(h.setup.heldKeys()).toEqual([retryKey("r1", "/wt/a")]);
  });

  it("refuses an id that was never minted", async () => {
    const h = harness();
    h.setup.register("r1", "/wt/a", pending("/wt/a", "r1"));
    await h.setup.retrySetup({ repoId: "r1", worktreeId: "/wt/a" }, "not-an-id");
    expect(h.runSetup).not.toHaveBeenCalled();
  });
});

describe("reconciling against the tree that just arrived", () => {
  it("drops an authority whose worktree is gone and keeps one that is still there", () => {
    const h = harness();
    h.setup.register("r1", "/wt/a", pending("/wt/a", "r1"));
    h.setup.register("r1", "/wt/b", pending("/wt/b", "r1"));

    h.setup.forgetAbsent(new Set(["/wt/a"]));

    expect(h.setup.heldKeys()).toEqual([retryKey("r1", "/wt/a")]);
  });
});

describe("reporting a setup that could not run", () => {
  it("fails the first step and skips the rest behind it", () => {
    const h = harness();
    const steps = [
      { id: "a", source: "repo", script: "one" },
      { id: "b", source: "repo", script: "two" },
    ] as never;
    const results = h.setup.failedSetup(steps, "nope");
    expect(results.map((r) => r.outcome.kind)).toEqual(["failed", "skipped"]);
  });

  it("carries only the ports that were actually taken", () => {
    const h = harness();
    const env = h.setup.portEnvironment([
      { name: "web", outcome: { kind: "allocated", port: 3000 } },
      { name: "db", outcome: { kind: "refused", reason: "taken" } },
      { name: "api", outcome: { kind: "reused", port: 4000 } },
    ] as never);
    expect(env).toEqual({ web: 3000, api: 4000 });
  });
});
