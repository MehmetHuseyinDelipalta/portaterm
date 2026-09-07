import { describe, expect, it } from "vitest";
import { MAIN_TERMINAL_OWNER, type TerminalOwner } from "./navigation/TerminalNavigationState";
import { createBranch, createLeaf, type SplitNode } from "./SplitModel";
import { buildTabBarData, type TabBarDataSource } from "./TabBarUtils";
import {
  emptyOwnerProjection,
  labelsForWorktreeTree,
  ownerPresentsPane,
  tabBarProjectionSignature,
  tabBarScopeForOwner,
} from "./tabBarScope";
import type { WorktreeInfo, WorktreeTree } from "./worktree/worktreeViewTypes";

const HERE = "/wt/here";
const ELSEWHERE = "/wt/elsewhere";
const LINKED: TerminalOwner = { kind: "linked", id: HERE };

function worktree(over: Partial<WorktreeInfo> & { id: string }): WorktreeInfo {
  return {
    displayPath: over.id,
    kind: "linked",
    bare: false,
    detached: false,
    locked: false,
    prunable: false,
    missing: false,
    inWorkspace: false,
    ...over,
  };
}

function treeOf(...worktrees: WorktreeInfo[]): WorktreeTree {
  return {
    gitAvailable: true,
    unreadable: { count: 0, reasons: [] },
    repos: [{ repoId: "/repo/.git", label: "repo", mainPath: "/repo", worktrees }],
  };
}

function source(entries: Array<[string, string | undefined, "idle" | "waiting"]>): TabBarDataSource {
  return {
    tabLayouts: new Map<string, SplitNode>(entries.map(([id]) => [id, createLeaf(id)])),
    tabActivePaneIds: new Map<string, string>(),
    terminals: new Map(
      entries.map(([id, worktreeId, activityStatus]) => [
        id,
        { name: id, defaultName: id, exited: false, activityStatus, worktreeId },
      ]),
    ) as never,
  };
}

describe("active-owner tab projection", () => {
  it("maps main and linked owners to exact stable membership", () => {
    expect(tabBarScopeForOwner(MAIN_TERMINAL_OWNER)).toBeUndefined();
    expect(tabBarScopeForOwner(LINKED)).toEqual({ worktreeId: HERE });
    expect(ownerPresentsPane(MAIN_TERMINAL_OWNER, undefined)).toBe(true);
    expect(ownerPresentsPane(MAIN_TERMINAL_OWNER, HERE)).toBe(false);
    expect(ownerPresentsPane(LINKED, HERE)).toBe(true);
    expect(ownerPresentsPane(LINKED, ELSEWHERE)).toBe(false);
    expect(ownerPresentsPane(LINKED, undefined)).toBe(false);
  });

  it("filters only by stable owner and counts waiting hidden tabs", () => {
    const data = source([
      ["main", undefined, "waiting"],
      ["here", HERE, "idle"],
      ["elsewhere", ELSEWHERE, "waiting"],
    ]);

    expect(buildTabBarData(data, tabBarScopeForOwner(LINKED))).toMatchObject({
      tabs: new Map([["here", expect.objectContaining({ name: "here" })]]),
      hiddenWaiting: 2,
    });
  });

  it("does not accept presence attribution as membership evidence", () => {
    const scope = tabBarScopeForOwner(LINKED, new Set(["main"]));
    const data = source([
      ["main", undefined, "idle"],
      ["here", HERE, "idle"],
    ]);

    expect(scope).not.toHaveProperty("attribution");
    expect([...buildTabBarData(data, scope).tabs.keys()]).toEqual(["here"]);
  });

  it("projects owner-empty state without changing owner", () => {
    const data = source([["main", undefined, "idle"]]);
    const labels = new Map([[HERE, "feat/here"]]);

    expect(emptyOwnerProjection(data, MAIN_TERMINAL_OWNER, labels)).toBeNull();
    expect(emptyOwnerProjection(data, LINKED, labels)).toEqual({ owner: LINKED, label: "feat/here" });
    expect(emptyOwnerProjection(source([]), MAIN_TERMINAL_OWNER, labels)).toEqual({
      owner: MAIN_TERMINAL_OWNER,
      label: "Main",
    });
  });

  it("finds live split leaves when deciding whether an owner is empty", () => {
    const data = source([["survivor", HERE, "idle"]]);
    data.tabLayouts = new Map([["old-root", createBranch("horizontal", createLeaf("gone"), createLeaf("survivor"))]]);
    expect(emptyOwnerProjection(data, LINKED, new Map())).toBeNull();
  });
});

describe("worktree labels and render signatures", () => {
  it("uses branch labels and replaces the tree snapshot whole", () => {
    expect(
      labelsForWorktreeTree(
        treeOf(worktree({ id: HERE, branch: "feat/here" }), worktree({ id: ELSEWHERE, missing: true })),
      ),
    ).toEqual(
      new Map([
        [HERE, "feat/here"],
        [ELSEWHERE, ELSEWHERE],
      ]),
    );
    expect(labelsForWorktreeTree(null)).toBeNull();
  });

  it("redraws for owner, label, membership, topology, or hidden waiting changes", () => {
    const base = source([
      ["main", undefined, "idle"],
      ["here", HERE, "idle"],
    ]);
    const initial = tabBarProjectionSignature(base, LINKED, "feat/here", 0);

    expect(tabBarProjectionSignature(base, LINKED, "feat/here", 0)).toBe(initial);
    expect(tabBarProjectionSignature(base, MAIN_TERMINAL_OWNER, null, 0)).not.toBe(initial);
    expect(tabBarProjectionSignature(base, LINKED, "renamed", 0)).not.toBe(initial);
    expect(tabBarProjectionSignature(base, LINKED, "feat/here", 1)).not.toBe(initial);

    base.terminals.get("main")!.worktreeId = HERE;
    expect(tabBarProjectionSignature(base, LINKED, "feat/here", 0)).not.toBe(initial);
  });
});
