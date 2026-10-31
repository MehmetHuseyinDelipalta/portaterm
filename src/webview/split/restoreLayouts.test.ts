// src/webview/split/restoreLayouts.test.ts — persisted layouts against the live session list.

import { describe, expect, it } from "vitest";
import { createBranch, createLeaf } from "../SplitModel";
import { adoptOrphanPanes, pruneDeadLeaves, reconcileRestoredLayouts } from "./restoreLayouts";

const live = (...ids: string[]) => new Set(ids);

describe("pruneDeadLeaves", () => {
  it("keeps a layout whose leaves are all alive, unchanged", () => {
    const layout = createBranch("vertical", createLeaf("t1"), createLeaf("p2"));
    expect(pruneDeadLeaves(layout, live("t1", "p2"))).toEqual(layout);
  });

  it("collapses a branch around a dead leaf", () => {
    const layout = createBranch("vertical", createLeaf("t1"), createLeaf("gone"));
    expect(pruneDeadLeaves(layout, live("t1"))).toEqual(createLeaf("t1"));
  });

  it("prunes several dead leaves in a nested tree", () => {
    const layout = createBranch(
      "vertical",
      createBranch("horizontal", createLeaf("t1"), createLeaf("x")),
      createBranch("horizontal", createLeaf("y"), createLeaf("p2")),
    );
    expect(pruneDeadLeaves(layout, live("t1", "p2"))).toEqual(
      createBranch("vertical", createLeaf("t1"), createLeaf("p2")),
    );
  });

  it("answers null when no leaf is alive", () => {
    expect(pruneDeadLeaves(createBranch("vertical", createLeaf("a"), createLeaf("b")), live())).toBeNull();
  });
});

describe("reconcileRestoredLayouts", () => {
  it("keeps the layout of a tab whose root pane was closed, by its live split", () => {
    // The host sends p2 only; the tab is still keyed by the closed root t1.
    const { layouts } = reconcileRestoredLayouts(new Map([["t1", createLeaf("p2")]]), new Map(), live("p2"));
    expect(layouts.get("t1")).toEqual(createLeaf("p2"));
  });

  it("drops a layout with nothing alive, and a pane pointer with it", () => {
    const { layouts, activePanes } = reconcileRestoredLayouts(
      new Map([["t9", createLeaf("t9")]]),
      new Map([["t9", "t9"]]),
      live("t1"),
    );
    expect(layouts.size).toBe(0);
    expect(activePanes.size).toBe(0);
  });

  it("moves an active pane off a pruned leaf onto the first live one", () => {
    const { activePanes } = reconcileRestoredLayouts(
      new Map([["t1", createBranch("vertical", createLeaf("t1"), createLeaf("gone"))]]),
      new Map([["t1", "gone"]]),
      live("t1"),
    );
    expect(activePanes.get("t1")).toBe("t1");
  });

  it("keeps an active pane that is still alive", () => {
    const { activePanes } = reconcileRestoredLayouts(
      new Map([["t1", createBranch("vertical", createLeaf("t1"), createLeaf("p2"))]]),
      new Map([["t1", "p2"]]),
      live("t1", "p2"),
    );
    expect(activePanes.get("t1")).toBe("p2");
  });
});

describe("reconcileRestoredLayouts: active pane of a tab whose own pane is gone", () => {
  it("points it at the first live leaf even when none was stored", () => {
    const { activePanes } = reconcileRestoredLayouts(new Map([["t1", createLeaf("p2")]]), new Map(), live("p2"));
    expect(activePanes.get("t1")).toBe("p2");
  });

  it("leaves an ordinary tab without a stored pointer alone", () => {
    const { activePanes } = reconcileRestoredLayouts(new Map([["t1", createLeaf("t1")]]), new Map(), live("t1"));
    expect(activePanes.has("t1")).toBe(false);
  });
});

describe("adoptOrphanPanes", () => {
  it("appends a live split no layout mentions to its tab's layout", () => {
    const layouts = new Map([["t1", createLeaf("t1")]]);
    adoptOrphanPanes(layouts, new Map(), [{ id: "p2", rootTabId: "t1" }], new Set(["t1"]));
    expect(layouts.get("t1")).toEqual(createBranch("vertical", createLeaf("t1"), createLeaf("p2")));
  });

  it("begins a live root's missing layout with the root's own pane", () => {
    const layouts = new Map<string, ReturnType<typeof createLeaf>>();
    const active = new Map<string, string>();
    adoptOrphanPanes(layouts, active, [{ id: "p2", rootTabId: "t1" }], new Set(["t1"]));
    expect(layouts.get("t1")).toEqual(createBranch("vertical", createLeaf("t1"), createLeaf("p2")));
    expect(active.has("t1")).toBe(false);
  });

  it("gives a split whose tab has no layout left a tab of its own, under the tab id, with it active", () => {
    const layouts = new Map<string, ReturnType<typeof createLeaf>>();
    const active = new Map<string, string>();
    adoptOrphanPanes(layouts, active, [{ id: "p2", rootTabId: "t1" }], new Set());
    expect(layouts.get("t1")).toEqual(createLeaf("p2"));
    expect(active.get("t1")).toBe("p2");
  });

  it("leaves a pane that is already placed, or that names no tab", () => {
    const layout = createBranch("vertical", createLeaf("t1"), createLeaf("p2"));
    const layouts = new Map([["t1", layout]]);
    adoptOrphanPanes(layouts, new Map(), [{ id: "p2", rootTabId: "t1" }, { id: "p9" }], new Set(["t1"]));
    expect(layouts.get("t1")).toBe(layout);
    expect(layouts.size).toBe(1);
  });
});
