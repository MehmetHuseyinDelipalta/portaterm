// src/webview/paneZoom.test.ts — when a split tab shows one pane full size, and when it stops.

import { describe, expect, it, vi } from "vitest";
import { applyPaneZoomCommand, PaneZoom, SINGLE_PANE_ZOOM_NOTICE } from "./paneZoom";
import { createBranch, createLeaf, removeLeaf, replaceNode, type SplitNode } from "./SplitModel";

function setup(layouts: Record<string, SplitNode>, active: Record<string, string> = {}) {
  const tabLayouts = new Map(Object.entries(layouts));
  const tabActivePaneIds = new Map(Object.entries(active));
  const zoom = new PaneZoom({ tabLayouts, tabActivePaneIds });
  return { zoom, tabLayouts, tabActivePaneIds };
}

const threePanes = () => ({
  t1: createBranch("vertical", createLeaf("t1"), createBranch("horizontal", createLeaf("p2"), createLeaf("p3"))),
  t9: createBranch("vertical", createLeaf("t9"), createLeaf("p9")),
});

describe("PaneZoom.set", () => {
  it("zooms the named pane of its tab and no other tab", () => {
    const { zoom } = setup(threePanes(), { t1: "p2" });
    expect(zoom.set("p2", true)).toEqual({ kind: "changed", tabId: "t1", paneId: "p2", zoomed: true });
    expect(zoom.zoomedPane("t1")).toBe("p2");
    expect(zoom.zoomedPane("t9")).toBeNull();
    expect(zoom.zoomedTabIds()).toEqual(new Set(["t1"]));
  });

  it("toggles: zooms the named pane when the tab shows its layout, unzooms when it does not", () => {
    const { zoom } = setup(threePanes(), { t1: "p3" });
    expect(zoom.set("p3")).toEqual({ kind: "changed", tabId: "t1", paneId: "p3", zoomed: true });
    expect(zoom.set("p3")).toEqual({ kind: "changed", tabId: "t1", paneId: "p3", zoomed: false });
    expect(zoom.zoomedPane("t1")).toBeNull();
  });

  it("unzooms the tab from any of its panes", () => {
    const { zoom } = setup(threePanes(), { t1: "p3" });
    zoom.set("p3", true);
    expect(zoom.set("t1", false)).toEqual({ kind: "changed", tabId: "t1", paneId: "p3", zoomed: false });
  });

  it("reports an explicit request that matches what is shown as unchanged", () => {
    const { zoom } = setup(threePanes(), { t1: "p2" });
    expect(zoom.set("p2", false)).toEqual({ kind: "unchanged", tabId: "t1", zoomed: false });
    zoom.set("p2", true);
    expect(zoom.set("p2", true)).toEqual({ kind: "unchanged", tabId: "t1", zoomed: true });
  });

  it("moves the zoom when a different pane is zoomed explicitly", () => {
    const { zoom, tabActivePaneIds } = setup(threePanes(), { t1: "p2" });
    zoom.set("p2", true);
    expect(zoom.set("p3", true)).toEqual({ kind: "changed", tabId: "t1", paneId: "p3", zoomed: true });
    tabActivePaneIds.set("t1", "p3");
    expect(zoom.zoomedPane("t1")).toBe("p3");
  });

  it("refuses a single-pane tab and records nothing", () => {
    const { zoom, tabLayouts } = setup({ solo: createLeaf("solo") });
    expect(zoom.set("solo")).toEqual({ kind: "single-pane", tabId: "solo" });
    // A later split must not open already zoomed.
    tabLayouts.set("solo", createBranch("vertical", createLeaf("solo"), createLeaf("s2")));
    expect(zoom.zoomedPane("solo")).toBeNull();
  });

  it("reports a pane no tab holds", () => {
    const { zoom } = setup(threePanes());
    expect(zoom.set("ghost")).toEqual({ kind: "unknown-pane" });
  });
});

describe("PaneZoom — a zoom holds only while it describes the screen", () => {
  it("shows only once the zoomed pane is the tab's active one, and ends when focus moves away", () => {
    const { zoom, tabActivePaneIds } = setup(threePanes(), { t1: "t1" });
    zoom.set("p2", true);
    expect(zoom.zoomedPane("t1")).toBeNull();
    tabActivePaneIds.set("t1", "p2");
    expect(zoom.zoomedPane("t1")).toBe("p2");
    tabActivePaneIds.set("t1", "p3");
    expect(zoom.zoomedPane("t1")).toBeNull();
    expect(zoom.zoomedTabIds()).toEqual(new Set());
  });

  it("treats a tab with no recorded active pane as active on its own id", () => {
    const { zoom } = setup(threePanes());
    zoom.set("t1", true);
    expect(zoom.zoomedPane("t1")).toBe("t1");
  });

  it("ends when the tab gains a pane", () => {
    const { zoom, tabLayouts } = setup(threePanes(), { t1: "p2" });
    zoom.set("p2", true);
    const layout = tabLayouts.get("t1")!;
    tabLayouts.set("t1", replaceNode(layout, "p2", createBranch("vertical", createLeaf("p2"), createLeaf("p4"))));
    expect(zoom.zoomedPane("t1")).toBeNull();
  });

  it("ends when a hidden pane closes", () => {
    const { zoom, tabLayouts } = setup(threePanes(), { t1: "p2" });
    zoom.set("p2", true);
    tabLayouts.set("t1", removeLeaf(tabLayouts.get("t1")!, "p3")!);
    expect(zoom.zoomedPane("t1")).toBeNull();
  });

  it("ends for good when the tab falls back to one pane", () => {
    const { zoom, tabLayouts } = setup(threePanes(), { t9: "t9" });
    zoom.set("t9", true);
    const original = tabLayouts.get("t9")!;
    tabLayouts.set("t9", createLeaf("t9"));
    expect(zoom.zoomedPane("t9")).toBeNull();
    expect(zoom.prune()).toBe(true);
    tabLayouts.set("t9", original);
    expect(zoom.zoomedPane("t9")).toBeNull();
  });

  it("ends when the tab closes", () => {
    const { zoom, tabLayouts } = setup(threePanes(), { t9: "t9" });
    zoom.set("t9", true);
    tabLayouts.delete("t9");
    expect(zoom.zoomedPane("t9")).toBeNull();
  });

  it("survives a ratio change — the same panes in the same order", () => {
    const { zoom, tabLayouts } = setup(threePanes(), { t1: "p2" });
    zoom.set("p2", true);
    const layout = tabLayouts.get("t1") as Extract<SplitNode, { type: "branch" }>;
    tabLayouts.set("t1", { ...layout, ratio: 0.3 });
    expect(zoom.zoomedPane("t1")).toBe("p2");
  });
});

describe("PaneZoom.prune", () => {
  it("drops only zooms that no longer hold and says whether it dropped any", () => {
    const { zoom, tabActivePaneIds } = setup(threePanes(), { t1: "p2", t9: "t9" });
    zoom.set("p2", true);
    zoom.set("t9", true);
    expect(zoom.prune()).toBe(false);
    tabActivePaneIds.set("t1", "p3");
    expect(zoom.prune()).toBe(true);
    expect(zoom.zoomedTabIds()).toEqual(new Set(["t9"]));
    // Dropped for good: focusing the pane again does not bring the zoom back.
    tabActivePaneIds.set("t1", "p2");
    expect(zoom.zoomedPane("t1")).toBeNull();
  });
});

describe("PaneZoom.wouldZoomIn", () => {
  it("is true only for a request that zooms a split tab in", () => {
    const { zoom } = setup({ ...threePanes(), solo: createLeaf("solo") }, { t1: "p2" });
    expect(zoom.wouldZoomIn("p2")).toBe(true);
    expect(zoom.wouldZoomIn("p2", true)).toBe(true);
    expect(zoom.wouldZoomIn("p2", false)).toBe(false);
    expect(zoom.wouldZoomIn("solo")).toBe(false);
    expect(zoom.wouldZoomIn("ghost", true)).toBe(false);
    zoom.set("p2", true);
    expect(zoom.wouldZoomIn("p2")).toBe(false);
  });
});

describe("applyPaneZoomCommand", () => {
  function effects() {
    return { focusPane: vi.fn(), refresh: vi.fn(), notify: vi.fn() };
  }

  it("focuses the pane before recording the zoom, then redraws its tab", () => {
    const { zoom, tabActivePaneIds } = setup(threePanes(), { t1: "t1" });
    const fx = effects();
    // The focus change redraws, and the redraw prunes. A zoom recorded before
    // the pane is active would be pruned there, against the old active pane.
    fx.focusPane.mockImplementation((paneId: string) => {
      zoom.prune();
      tabActivePaneIds.set("t1", paneId);
    });
    applyPaneZoomCommand(zoom, { sessionId: "p3", zoomed: true }, fx);
    expect(fx.focusPane).toHaveBeenCalledWith("p3");
    expect(fx.refresh).toHaveBeenCalledWith("t1");
    expect(zoom.zoomedPane("t1")).toBe("p3");
    expect(fx.notify).not.toHaveBeenCalled();
  });

  it("unzooms without moving focus", () => {
    const { zoom } = setup(threePanes(), { t1: "p2" });
    zoom.set("p2", true);
    const fx = effects();
    applyPaneZoomCommand(zoom, { sessionId: "p2" }, fx);
    expect(fx.focusPane).not.toHaveBeenCalled();
    expect(fx.refresh).toHaveBeenCalledWith("t1");
    expect(zoom.zoomedPane("t1")).toBeNull();
  });

  it("tells the user why a single pane does not zoom", () => {
    const { zoom } = setup({ solo: createLeaf("solo") });
    const fx = effects();
    applyPaneZoomCommand(zoom, { sessionId: "solo" }, fx);
    expect(fx.notify).toHaveBeenCalledWith(SINGLE_PANE_ZOOM_NOTICE);
    expect(fx.focusPane).not.toHaveBeenCalled();
    expect(fx.refresh).not.toHaveBeenCalled();
  });

  it("does nothing visible for an unchanged request or an unknown pane", () => {
    const { zoom } = setup(threePanes(), { t1: "p2" });
    const fx = effects();
    applyPaneZoomCommand(zoom, { sessionId: "p2", zoomed: false }, fx);
    applyPaneZoomCommand(zoom, { sessionId: "ghost", zoomed: true }, fx);
    expect(fx.focusPane).not.toHaveBeenCalled();
    expect(fx.refresh).not.toHaveBeenCalled();
    expect(fx.notify).not.toHaveBeenCalled();
  });
});
