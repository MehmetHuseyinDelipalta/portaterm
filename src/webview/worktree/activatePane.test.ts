import { describe, expect, it } from "vitest";
import { createBranch, createLeaf, type SplitNode } from "../SplitModel";
import { type ActivatePaneDeps, activatePane } from "./activatePane";

function harness(
  layouts: Array<[string, SplitNode]>,
  displayableTabs: string[],
): { deps: ActivatePaneDeps; navigated: string[] } {
  const live = new Set(displayableTabs);
  const navigated: string[] = [];
  return {
    navigated,
    deps: {
      tabLayouts: new Map(layouts),
      canDisplayTab: (id) => live.has(id),
      navigatePane: (paneId) => navigated.push(paneId),
    },
  };
}

const SPLIT = createBranch("horizontal", createLeaf("t1"), createLeaf("t1-b"));

describe("activatePane", () => {
  it("delegates one pane intent without writing navigation effects", () => {
    const { deps, navigated } = harness([["t1", SPLIT]], ["t1"]);
    expect(activatePane("t1-b", deps)).toBe(true);
    expect(navigated).toEqual(["t1-b"]);
  });

  it("activates a tab that is its own single pane", () => {
    const { deps, navigated } = harness([["t1", createLeaf("t1")]], ["t1"]);
    expect(activatePane("t1", deps)).toBe(true);
    expect(navigated).toEqual(["t1"]);
  });

  it("searches every tab, not only the first", () => {
    const { deps, navigated } = harness(
      [
        ["other", createLeaf("other")],
        ["t1", SPLIT],
      ],
      ["other", "t1"],
    );
    expect(activatePane("t1-b", deps)).toBe(true);
    expect(navigated).toEqual(["t1-b"]);
  });

  it("changes nothing when the containing tab has no live pane", () => {
    const { deps, navigated } = harness([["t1", SPLIT]], []);
    expect(activatePane("t1-b", deps)).toBe(false);
    expect(navigated).toEqual([]);
  });

  it("changes nothing for an absent pane", () => {
    const { deps, navigated } = harness([["t1", SPLIT]], ["t1"]);
    expect(activatePane("gone", deps)).toBe(false);
    expect(navigated).toEqual([]);
  });

  it("changes nothing when there are no tabs", () => {
    const { deps, navigated } = harness([], []);
    expect(activatePane("t1", deps)).toBe(false);
    expect(navigated).toEqual([]);
  });
});
