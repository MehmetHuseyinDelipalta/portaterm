// src/webview/worktree/createDialog/branchChoices.test.ts — The order the branch
// box offers, what taking a row decides, and when a fork head still describes
// the selection on screen.
//
// NO environment pragma, deliberately. Under node `document` is undefined, so a
// DOM reference creeping into `branchChoices.ts` throws in whichever method
// holds it rather than passing quietly under the dialog suite's jsdom — the same
// witness `draftModel.test.ts` is (OBL-4). Every method is exercised for that
// reason as much as for its assertion.

import { describe, expect, it } from "vitest";
import type { PullRequestOffer } from "../../../types/messages";
import type { WorktreePullRequestOffer, WorktreeRef } from "../worktreeViewTypes";
import {
  type BranchChoices,
  branchOfPullRequest,
  createBranchChoices,
  orderChoices,
  partialListText,
} from "./branchChoices";

const ref = (name: string, heldBy?: string): WorktreeRef => ({
  name,
  oid: `oid-${name}`,
  ...(heldBy === undefined ? {} : { heldBy }),
});

const pr = (number: number, over: Partial<PullRequestOffer> = {}): PullRequestOffer =>
  ({
    number,
    title: `pull ${number}`,
    baseRefName: "main",
    headOwner: "someone",
    fromFork: false,
    ...over,
  }) as PullRequestOffer;

const offered = (...list: PullRequestOffer[]): WorktreePullRequestOffer =>
  ({ available: true, list, truncated: false }) as WorktreePullRequestOffer;

function harness(refs: WorktreeRef[], prs?: WorktreePullRequestOffer, repoId = "r1"): BranchChoices {
  return createBranchChoices({ refs: () => refs, repoId: () => repoId, pullRequests: () => prs });
}

const kinds = (rows: readonly { kind: string }[]): string[] => rows.map((r) => r.kind);

describe("the module is headless", () => {
  it("has no DOM to reach for", () => {
    expect(typeof globalThis.document).toBe("undefined");
  });
});

describe("the order the list offers", () => {
  it("puts the exact match first, then the prefixes, then create-new", () => {
    const rows = orderChoices([ref("feat/b"), ref("feat"), ref("feat/a")], "feat");
    expect(rows.map((r) => (r.kind === "existing" ? r.ref.name : r.kind))).toEqual(["feat", "feat/b", "feat/a", "new"]);
  });

  it("offers every ref when nothing is typed, none of them as an exact match", () => {
    const rows = orderChoices([ref("main"), ref("dev")], "   ");
    expect(rows.map((r) => (r.kind === "existing" ? r.ref.name : r.kind))).toEqual(["main", "dev", "new"]);
  });

  it("drops a ref that neither matches exactly nor by prefix", () => {
    const rows = orderChoices([ref("main"), ref("release/1")], "rel");
    expect(rows.map((r) => (r.kind === "existing" ? r.ref.name : r.kind))).toEqual(["release/1", "new"]);
  });

  it("keeps create-new even when the enumeration produced nothing", () => {
    expect(kinds(orderChoices([], "anything"))).toEqual(["new"]);
  });

  it("seats the pull requests between the prefix matches and create-new", () => {
    const rows = orderChoices([ref("feat/a")], "feat", offered(pr(7, { title: "feat: the widget" })));
    expect(kinds(rows)).toEqual(["existing", "pr", "new"]);
  });

  it("says nothing about a forge it has not been asked about", () => {
    expect(kinds(orderChoices([], "", undefined))).toEqual(["new"]);
  });

  it("contributes one quiet row when the forge is unavailable, whatever the reason", () => {
    const rows = orderChoices([], "", { available: false } as WorktreePullRequestOffer);
    expect(kinds(rows)).toEqual(["prsUnavailable", "new"]);
  });

  it("matches a pull request on its number and anywhere in its title, never on its head branch", () => {
    const prs = offered(
      pr(12, { title: "add the widget", headRefName: "wip/widget" } as Partial<PullRequestOffer>),
      pr(34, { title: "unrelated" }),
    );
    const byNumber = orderChoices([], "12", prs).filter((r) => r.kind === "pr");
    expect(byNumber).toHaveLength(1);

    const byTitle = orderChoices([], "widget", prs).filter((r) => r.kind === "pr");
    expect(byTitle).toHaveLength(1);

    // The branch a create mints is `pr/<n>`; matching the fork's own branch name
    // would suggest that is what gets checked out.
    expect(orderChoices([], "wip/", prs).filter((r) => r.kind === "pr")).toHaveLength(0);
  });
});

describe("what the typed text means", () => {
  it("upgrades to the ref that exists and demotes again when it stops existing", () => {
    let refs = [ref("main")];
    const branches = createBranchChoices({ refs: () => refs, repoId: () => "r1", pullRequests: () => undefined });

    expect(branches.derive("main").kind).toBe("existing");
    expect(branches.mode()).toBe("existing");

    // The same name, on a repository that does not have it (round-1 B2).
    refs = [];
    expect(branches.derive("main").kind).toBe("new");
    expect(branches.mode()).toBe("new");
  });

  it("means create-new when nothing is typed", () => {
    const branches = harness([ref("")]);
    expect(branches.derive("   ").kind).toBe("new");
  });
});

describe("taking a row", () => {
  it("ignores an index the list does not offer, and the unavailable row", () => {
    const branches = harness([], { available: false } as WorktreePullRequestOffer);
    branches.offer("");
    expect(branches.commit(9)).toEqual({ kind: "ignored" });
    expect(branches.commit(0)).toEqual({ kind: "ignored" });
  });

  it("refuses a branch another worktree holds, and says which", () => {
    const branches = harness([ref("main", "api")]);
    branches.offer("main");
    expect(branches.commit(0)).toEqual({ kind: "refused", message: "main is checked out in api" });
    // Refused means not taken: the choice is still what it was.
    expect(branches.choice().kind).toBe("new");
  });

  it("states the ref's own name for an existing row", () => {
    const branches = harness([ref("feat/a")]);
    branches.offer("feat");
    expect(branches.commit(0)).toEqual({
      kind: "taken",
      choice: { kind: "existing", ref: ref("feat/a") },
      branchName: "feat/a",
    });
  });

  it("names nothing for create-new, so the typed text is left alone", () => {
    const branches = harness([]);
    branches.offer("whatever");
    const decided = branches.commit(0);
    expect(decided).toEqual({ kind: "taken", choice: { kind: "new" } });
  });

  it("turns a pull request into the branch it mints plus the base it names", () => {
    const branches = harness([], offered(pr(7, { baseRefName: "release/2" })));
    branches.offer("");
    expect(branches.commit(0)).toEqual({
      kind: "taken",
      choice: { kind: "new" },
      branchName: "pr/7",
      baseRef: "release/2",
    });
    expect(branchOfPullRequest(pr(7))).toBe("pr/7");
  });

  it("decides a pull request against the same refs, so an existing `pr/<n>` reuses it", () => {
    const branches = harness([ref("pr/7")], offered(pr(7)));
    branches.offer("");
    const decided = branches.commit(1);
    expect(decided.kind === "taken" && decided.choice.kind).toBe("existing");
    expect(branches.mode()).toBe("existing");
  });

  it("refuses a pull request whose minted branch is already held", () => {
    const branches = harness([ref("pr/7", "api")], offered(pr(7)));
    branches.offer("");
    expect(branches.commit(1)).toEqual({ kind: "refused", message: "pr/7 is checked out in api" });
  });
});

describe("the fork head", () => {
  it("is stated only while it still describes this selection", () => {
    const branches = harness([], offered(pr(7, { fromFork: true, headOwner: "octo" })));
    branches.offer("");
    branches.commit(0);

    expect(branches.forkStated("pr/7", "new")).toEqual({ repoId: "r1", branch: "pr/7", owner: "octo" });
    // Typed past: the selection it describes is gone.
    expect(branches.forkStated("pr/8", "new")).toBeNull();
    // Detached creates at a ref and mints no branch, so the pull request is not
    // what it creates from.
    expect(branches.forkStated("pr/7", "detached")).toBeNull();
  });

  it("is not claimed for a pull request whose head is not a fork", () => {
    const branches = harness([], offered(pr(7, { fromFork: false })));
    branches.offer("");
    branches.commit(0);
    expect(branches.forkStated("pr/7", "new")).toBeNull();
  });

  it("does not come back after detached withdrew it", () => {
    const branches = harness([], offered(pr(7, { fromFork: true, headOwner: "octo" })));
    branches.offer("");
    branches.commit(0);
    branches.clearForkHead();
    expect(branches.forkStated("pr/7", "new")).toBeNull();
  });

  it("does not describe a selection on a different repository", () => {
    let repoId = "r1";
    const branches = createBranchChoices({
      refs: () => [],
      repoId: () => repoId,
      pullRequests: () => offered(pr(7, { fromFork: true, headOwner: "octo" })),
    });
    branches.offer("");
    branches.commit(0);

    repoId = "r2";
    expect(branches.forkStated("pr/7", "new")).toBeNull();
  });
});

describe("what a capped list says about itself", () => {
  it("keeps the two caps as two sentences, because they answer typing differently", () => {
    expect(partialListText(true, false)).toContain("type to find others");
    expect(partialListText(false, true)).toContain("not searchable here");
    expect(partialListText(true, true).split(" Showing")).toHaveLength(2);
    expect(partialListText(false, false)).toBe("");
  });
});
