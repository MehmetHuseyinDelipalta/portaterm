// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { MAIN_TERMINAL_OWNER, type TerminalOwner } from "./navigation/TerminalNavigationState";
import type { PaneReport } from "./paneAttribution";
import { createLeaf, type SplitNode } from "./SplitModel";
import { buildTabBarData, renderTabBar } from "./TabBarUtils";
import { type TabBarScopeWiring, wireTabBarScope } from "./tabBarScopeWiring";
import type { WorktreeInfo, WorktreeTree } from "./worktree/worktreeViewTypes";

const LINKED_ID = "/repo-wt/feature";

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

function tree(branch = "feat/feature"): WorktreeTree {
  return {
    gitAvailable: true,
    unreadable: { count: 0, reasons: [] },
    repos: [
      {
        repoId: "/repo/.git",
        label: "repo",
        mainPath: "/repo",
        worktrees: [worktree({ id: LINKED_ID, branch })],
      },
    ],
  };
}

interface Surface {
  seam: TabBarScopeWiring;
  setOwner(owner: TerminalOwner): void;
  push(report?: PaneReport, nextTree?: WorktreeTree | null): void;
  draw(): void;
  tabs(): string[];
  chip(): HTMLElement | null;
  navigationIntents: TerminalOwner[];
  empty: { owner: TerminalOwner; label: string } | null;
  renders: number;
  presenceRevalidations: number;
}

function surface(): Surface {
  let owner: TerminalOwner = MAIN_TERMINAL_OWNER;
  const navigationIntents: TerminalOwner[] = [];
  const source = {
    tabLayouts: new Map<string, SplitNode>([
      ["main", createLeaf("main")],
      ["linked", createLeaf("linked")],
      ["loose", createLeaf("loose")],
    ]),
    tabActivePaneIds: new Map<string, string>(),
    terminals: new Map([
      ["main", { name: "main", defaultName: "main", activityStatus: "idle" }],
      ["linked", { name: "linked", defaultName: "linked", activityStatus: "idle", worktreeId: LINKED_ID }],
      ["loose", { name: "loose", defaultName: "loose", activityStatus: "idle" }],
    ]) as never,
  };
  const tabBarEl = document.createElement("div");
  document.body.appendChild(tabBarEl);
  let renders = 0;
  let empty: Surface["empty"] = null;
  let presenceRevalidations = 0;
  let seam!: TabBarScopeWiring;

  const draw = (): void => {
    seam.syncEmptyScope();
    const data = buildTabBarData(source, seam.effectiveScope());
    renderTabBar({
      tabBarEl,
      terminals: data.tabs,
      activeTabId: null,
      scope: seam.chip(data.hiddenWaiting),
      onTabClick: () => {},
      onTabClose: () => {},
      onAddClick: () => {},
    });
  };

  seam = wireTabBarScope({
    activeOwner: () => owner,
    selectOwner: (next) => {
      navigationIntents.push(next);
      owner = next;
      draw();
    },
    source: () => source,
    render: () => {
      renders += 1;
      draw();
    },
    revalidatePresence: () => {
      presenceRevalidations += 1;
    },
    showEmptyScope: (projection) => {
      empty = projection;
    },
  });
  draw();

  return {
    seam,
    setOwner(next) {
      owner = next;
      draw();
    },
    push(report = { placement: new Map(), waiting: new Set() }, nextTree = tree()) {
      seam.applyTree(nextTree, () => seam.onAttribution(report));
    },
    draw,
    tabs: () => [...tabBarEl.querySelectorAll(".tab-name")].map((node) => node.textContent ?? ""),
    chip: () => tabBarEl.querySelector(".tab-scope"),
    navigationIntents,
    get empty() {
      return empty;
    },
    get renders() {
      return renders;
    },
    get presenceRevalidations() {
      return presenceRevalidations;
    },
  };
}

beforeEach(() => document.body.replaceChildren());

describe("tab-bar owner projection wiring", () => {
  it("shows only main-owned tabs and no linked indicator for main", () => {
    const s = surface();
    s.push();
    expect(s.tabs()).toEqual(["main", "loose"]);
    expect(s.chip()).toBeNull();
  });

  it("shows only linked-owned tabs and names the linked owner", () => {
    const s = surface();
    s.push();
    s.setOwner({ kind: "linked", id: LINKED_ID });
    expect(s.tabs()).toEqual(["linked"]);
    expect(s.chip()?.textContent).toContain("feat/feature");
  });

  it("uses presence only for hidden waiting decoration, never membership", () => {
    const s = surface();
    s.push({ placement: new Map([["main", LINKED_ID]]), waiting: new Set(["main"]) });
    s.setOwner({ kind: "linked", id: LINKED_ID });
    expect(s.tabs()).toEqual(["linked"]);
    expect(s.chip()?.querySelector(".tab-scope-badge")?.textContent).toBe("1");
  });

  it("projects owner-empty state without dispatching navigation", () => {
    const s = surface();
    s.setOwner({ kind: "linked", id: "/wt/empty" });
    expect(s.empty).toEqual({ owner: { kind: "linked", id: "/wt/empty" }, label: "/wt/empty" });
    expect(s.navigationIntents).toEqual([]);
  });

  it("delegates a worktree click as one owner intent", () => {
    const s = surface();
    s.seam.onSelectWorktree(LINKED_ID);
    expect(s.navigationIntents).toEqual([{ kind: "linked", id: LINKED_ID }]);
    s.seam.onSelectWorktree(null);
    expect(s.navigationIntents.at(-1)).toEqual(MAIN_TERMINAL_OWNER);
  });

  it("never dispatches owner navigation from tree, presence, or render projections", () => {
    const s = surface();
    s.push({ placement: new Map([["main", LINKED_ID]]), waiting: new Set(["main"]) });
    s.seam.effectiveScope();
    s.seam.chip(1);
    s.seam.syncEmptyScope();
    expect(s.navigationIntents).toEqual([]);
  });

  it("redraws once for a combined tree/presence push and skips an identical push", () => {
    const s = surface();
    s.setOwner({ kind: "linked", id: LINKED_ID });
    s.push({ placement: new Map(), waiting: new Set(["main"]) });
    const rendered = s.renders;
    s.push({ placement: new Map([["linked", "/wrong"]]), waiting: new Set(["main"]) });
    expect(s.renders).toBe(rendered);
  });

  it("revalidates presence when the active owner crosses main/linked", () => {
    const s = surface();
    const before = s.presenceRevalidations;
    s.setOwner({ kind: "linked", id: LINKED_ID });
    expect(s.presenceRevalidations).toBe(before + 1);
    s.setOwner(MAIN_TERMINAL_OWNER);
    expect(s.presenceRevalidations).toBe(before + 2);
  });
});
