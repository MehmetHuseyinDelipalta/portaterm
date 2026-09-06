// src/worktree/mutationService/removal.test.ts — The confirmation store, driven
// through the module that now owns it.
//
// NO environment pragma: this is production code under `src/worktree/`, and the
// cut it belongs to is about ownership, not about a DOM.
//
// The whole-service suite reaches the store only through one worktree on one
// repository, so the two properties that make a token an authorization rather
// than a flag — spent once, and only for what it names — are asserted here,
// where the module is constructible on its own (design.md D1a).

import { describe, expect, it, vi } from "vitest";
import type { WorktreeMutationTarget } from "../../providers/WorktreeHost";
import type { GitCommandRunner } from "../gitCommandRunner";
import type { RemovalEvidence } from "../worktreeBlockers";
import type { MutationOutcome, RemovalReport, ResolvedTarget } from "../worktreeMutationService";
import { createRemoval, type RemovalDeps } from "./removal";

function evidence(over: Partial<RemovalEvidence> = {}): RemovalEvidence {
  return {
    dirtyPaths: [],
    untrackedPaths: [],
    paneIds: [],
    externalSessionIds: [],
    notApplicable: [],
    ignored: { kind: "measured", entries: 0, bytes: 0 },
    proofs: { lockAged: "unproven", ownerGone: "unproven", branchMerged: "unproven" },
    locked: false,
    lockReason: null,
    ...over,
  };
}

const target = (worktreeId: string, repoId = "r1"): WorktreeMutationTarget =>
  ({ repoId, worktreeId, origin: undefined }) as unknown as WorktreeMutationTarget;

const resolved = (worktreeId: string): ResolvedTarget => ({
  repoPath: "/repo",
  worktreePath: `/repo/../${worktreeId}`,
  incarnation: `adm-${worktreeId}`,
  locked: false,
  wasRegistered: true,
  existedOnDisk: true,
});

/**
 * The two seams the facade keeps: `withTarget` publishes, `runCoordinated` is
 * the barrier. Here they are pass-throughs that record, so what the module
 * decided is readable without a service around it.
 */
function harness(over: Partial<RemovalDeps> = {}) {
  const reported: MutationOutcome[] = [];
  /** Which worktrees the tree still holds. Removal drops the ones it does not. */
  let present = new Set(["w1", "w2"]);
  const runner = {
    run: vi.fn(async () => ({ code: 0, stdout: Buffer.from(""), stderr: "", timedOut: false, failedToSpawn: false })),
  } as unknown as GitCommandRunner;

  const deps: RemovalDeps = {
    runner,
    resolve: (t) => (present.has(t.worktreeId) ? resolved(t.worktreeId) : null),
    now: () => 1_000,
    assessRemoval: async () => ({ kind: "confirmable" as const, evidence: evidence() }),
    observation: () => 7,
    observeAfter: async () => ({ isRegistered: false, existsOnDisk: false }),
    withTarget: async (_verb, t, body, missing) => {
      const found = deps.resolve(t);
      if (found === null) {
        // The facade's own shape. Without this branch the module's D15 exit —
        // the one that spends a confirmation for a worktree already gone — is
        // simply unreachable from this suite (.reviews/round-1.md F003).
        if (missing !== undefined) {
          reported.push(await missing());
        }
        return;
      }
      reported.push(await body(found, { settle: async () => {} }));
    },
    runCoordinated: async (_repoId, step) => {
      const found = await step.resolve();
      return found === null && step.missing !== undefined
        ? await step.missing()
        : await step.body(found as ResolvedTarget, { settle: async () => {} });
    },
    ...over,
  };

  return {
    removal: createRemoval(deps),
    reported,
    runner,
    drop(worktreeId: string) {
      present = new Set([...present].filter((id) => id !== worktreeId));
    },
    setPresent(ids: string[]) {
      present = new Set(ids);
    },
  };
}

/** The token a report hands back, or a failure if the report did not carry one. */
async function confirm(removal: ReturnType<typeof harness>["removal"], worktreeId: string): Promise<string> {
  const report = (await removal.assessRemovalReport(target(worktreeId))) as RemovalReport & { fingerprint: string };
  expect(report.kind).toBe("assessed");
  expect(report.fingerprint).toEqual(expect.any(String));
  return report.fingerprint;
}

describe("the confirmation a report issues", () => {
  it("authorizes the removal it was issued for", async () => {
    const h = harness();
    const fingerprint = await confirm(h.removal, "w1");

    await h.removal.removeWorktree(target("w1"), fingerprint);

    expect(h.reported.at(-1)?.kind).toBe("ok");
    expect(h.runner.run).toHaveBeenCalled();
  });

  it("is spent by the attempt, so the same token cannot authorize a second one", async () => {
    const h = harness();
    const fingerprint = await confirm(h.removal, "w1");

    await h.removal.removeWorktree(target("w1"), fingerprint);
    const gitCalls = vi.mocked(h.runner.run).mock.calls.length;

    // The same worktree, still there, and the same token. Redemption CONSUMES
    // the record whatever the verdict, so one confirmation is one attempt.
    // (The recreate-at-the-same-location case is the D15 test above; here the
    // tree never lost the id — .reviews/round-1.md F002.)
    await h.removal.removeWorktree(target("w1"), fingerprint);

    expect(h.reported.at(-1)).toMatchObject({ kind: "error" });
    // Refused BEFORE git, not by git: a second `worktree remove` would have run.
    expect(vi.mocked(h.runner.run).mock.calls.length).toBe(gitCalls);
  });

  it("is dead once the removal finds the worktree already gone (D15)", async () => {
    const h = harness();
    const fingerprint = await confirm(h.removal, "w1");
    h.drop("w1");

    // The id resolves to nothing on the far side of the rebuild, so the body
    // never runs and the `missing` exit reports instead.
    await h.removal.removeWorktree(target("w1"), fingerprint);
    expect(h.reported.at(-1)).toMatchObject({ kind: "error", message: "That worktree is already gone." });

    // And the confirmation went with it. Something recreated at the same
    // location must be confirmed again — a token that outlived the
    // disappearance is what would destroy it unasked (round-3 B5).
    h.setPresent(["w1", "w2"]);
    await h.removal.removeWorktree(target("w1"), fingerprint);
    expect(h.reported.at(-1)).toMatchObject({ kind: "error" });
    expect(h.runner.run).not.toHaveBeenCalled();
  });

  it("does not authorize removing a DIFFERENT worktree", async () => {
    const h = harness();
    const fingerprint = await confirm(h.removal, "w1");

    await h.removal.removeWorktree(target("w2"), fingerprint);

    expect(h.reported.at(-1)).toMatchObject({ kind: "error" });
    expect(h.runner.run).not.toHaveBeenCalled();
    // And w1's own token survived being presented elsewhere.
    await h.removal.removeWorktree(target("w1"), fingerprint);
    expect(h.reported.at(-1)?.kind).toBe("ok");
  });

  it("is not issued at all when the assessment refuses, because nothing could redeem it", async () => {
    const h = harness({
      assessRemoval: async () => ({ kind: "refused" as const, blockers: [], evidence: undefined }) as never,
    });

    const report = await h.removal.assessRemovalReport(target("w1"));

    expect(report).toMatchObject({ kind: "assessed", fingerprint: null });
  });

  it("reports the worktree as unreadable rather than assessing one the tree no longer holds", async () => {
    const h = harness();
    h.drop("w1");

    expect(await h.removal.assessRemovalReport(target("w1"))).toMatchObject({ kind: "unavailable" });
  });
});

describe("forgetAbsent (D1b)", () => {
  it("drops the token of a worktree the tree stopped holding and keeps the rest", async () => {
    const h = harness();
    const gone = await confirm(h.removal, "w1");
    const kept = await confirm(h.removal, "w2");

    h.removal.forgetAbsent(new Set(["w2"]));

    // w1's confirmation is gone even though nothing removed w1 through us.
    await h.removal.removeWorktree(target("w1"), gone);
    expect(h.reported.at(-1)).toMatchObject({ kind: "error" });
    expect(h.runner.run).not.toHaveBeenCalled();

    await h.removal.removeWorktree(target("w2"), kept);
    expect(h.reported.at(-1)?.kind).toBe("ok");
  });
});

describe("issueFingerprint", () => {
  it("mints nothing for an id the tree cannot resolve", () => {
    const h = harness();
    h.drop("w1");
    expect(h.removal.issueFingerprint(target("w1"), evidence())).toBeNull();
  });
});
