// @vitest-environment jsdom
// src/webview/split/SplitTreeRenderer.zoom.test.ts — the zoom marks the `.pane-zoomed` CSS
// reads, the context-menu key that picks "Zoom Pane" or "Unzoom Pane", and the refit a
// change of zoom needs.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBranch, createLeaf, type SplitNode } from "../SplitModel";
import { SplitTreeRenderer } from "./SplitTreeRenderer";

const PANES = ["t1", "p2", "p3"];

function fixture(layout: SplitNode) {
  let zoomed: string | null = null;
  const store = {
    terminals: new Map<string, { container: HTMLDivElement }>(),
    tabLayouts: new Map<string, SplitNode>([["t1", layout]]),
    tabActivePaneIds: new Map([["t1", "t1"]]),
    resizeCleanups: new Map(),
    activeTabId: "t1",
    persist: vi.fn(),
  };
  for (const id of PANES) {
    store.terminals.set(id, { container: document.createElement("div") });
  }
  const debouncedFitAllLeaves = vi.fn();
  const renderer = new SplitTreeRenderer({
    store: store as never,
    resizeCoordinator: { debouncedFitAllLeaves } as never,
    flowControl: { delete: vi.fn() } as never,
    postMessage: vi.fn(),
    onTabBarUpdate: vi.fn(),
    zoomedPane: () => zoomed,
  });
  const tabEl = () => document.querySelector<HTMLElement>('[data-tab-id="t1"]')!;
  const contextOf = (el: HTMLElement) => JSON.parse(el.dataset.vscodeContext ?? "{}");
  const leafOf = (id: string) => document.querySelector<HTMLElement>(`.split-leaf[data-session-id="${id}"]`)!;
  const zoomTo = (id: string | null) => {
    zoomed = id;
  };
  const marked = (cls: string) =>
    Array.from(tabEl().querySelectorAll<HTMLElement>(`.${cls}`)).map((el) => el.dataset.sessionId ?? el.className);
  return { store, renderer, tabEl, contextOf, leafOf, zoomTo, marked, debouncedFitAllLeaves };
}

/** t1 | (p2 / p3) — p3 sits two branches deep. */
const nested = () =>
  createBranch("vertical", createLeaf("t1"), createBranch("horizontal", createLeaf("p2"), createLeaf("p3")));

beforeEach(() => {
  document.body.innerHTML = '<div id="terminal-container"></div>';
});

describe("SplitTreeRenderer zoom visuals", () => {
  it("marks the zoomed leaf and exactly the branches that hold it", () => {
    const { renderer, tabEl, leafOf, zoomTo } = fixture(nested());
    renderer.renderTabSplitTree("t1");
    zoomTo("p3");
    renderer.updateActivePaneVisual("t1");

    expect(tabEl().classList.contains("pane-zoomed")).toBe(true);
    expect(leafOf("p3").classList.contains("zoomed-pane")).toBe(true);
    expect(leafOf("p2").classList.contains("zoomed-pane")).toBe(false);
    expect(leafOf("t1").classList.contains("zoomed-pane")).toBe(false);
    const branches = Array.from(tabEl().querySelectorAll<HTMLElement>(".split-branch"));
    expect(branches).toHaveLength(2);
    // Both the root and the inner branch hold p3.
    expect(branches.every((b) => b.classList.contains("zoom-path"))).toBe(true);
  });

  it("leaves a sibling branch off the zoom path", () => {
    const { renderer, tabEl, zoomTo } = fixture(nested());
    renderer.renderTabSplitTree("t1");
    zoomTo("t1");
    renderer.updateActivePaneVisual("t1");
    const [root, inner] = Array.from(tabEl().querySelectorAll<HTMLElement>(".split-branch"));
    expect(root!.classList.contains("zoom-path")).toBe(true);
    expect(inner!.classList.contains("zoom-path")).toBe(false);
  });

  it("clears every mark when the zoom ends", () => {
    const { renderer, tabEl, zoomTo } = fixture(nested());
    renderer.renderTabSplitTree("t1");
    zoomTo("p3");
    renderer.updateActivePaneVisual("t1");
    zoomTo(null);
    renderer.updateActivePaneVisual("t1");
    expect(tabEl().classList.contains("pane-zoomed")).toBe(false);
    expect(tabEl().querySelectorAll(".zoomed-pane, .zoom-path")).toHaveLength(0);
    expect(tabEl().dataset.zoomedPane).toBeUndefined();
  });

  it("re-applies the zoom to the leaves a re-render rebuilds", () => {
    const { renderer, leafOf, tabEl, zoomTo } = fixture(nested());
    zoomTo("p2");
    renderer.renderTabSplitTree("t1");
    renderer.renderTabSplitTree("t1");
    expect(tabEl().classList.contains("pane-zoomed")).toBe(true);
    expect(leafOf("p2").classList.contains("zoomed-pane")).toBe(true);
  });

  it("does not zoom over a leaf it cannot find — hiding every pane would blank the tab", () => {
    const { renderer, tabEl, zoomTo } = fixture(nested());
    renderer.renderTabSplitTree("t1");
    zoomTo("ghost");
    renderer.updateActivePaneVisual("t1");
    expect(tabEl().classList.contains("pane-zoomed")).toBe(false);
  });

  it("never zooms a single-pane tab, whatever the zoom state says", () => {
    const { renderer, tabEl, contextOf, store, zoomTo } = fixture(createLeaf("t1"));
    zoomTo("t1");
    renderer.renderTabSplitTree("t1");
    expect(tabEl().classList.contains("pane-zoomed")).toBe(false);
    expect(contextOf(store.terminals.get("t1")!.container).paneZoomed).toBe(false);
  });

  it("flips every pane's menu key, on both the terminal container and its leaf", () => {
    const { store, renderer, contextOf, leafOf, zoomTo } = fixture(nested());
    renderer.renderTabSplitTree("t1");
    for (const id of PANES) {
      expect(contextOf(store.terminals.get(id)!.container).paneZoomed).toBe(false);
      expect(contextOf(leafOf(id)).paneZoomed).toBe(false);
    }
    zoomTo("p2");
    renderer.updateActivePaneVisual("t1");
    for (const id of PANES) {
      expect(contextOf(store.terminals.get(id)!.container).paneZoomed).toBe(true);
      expect(contextOf(leafOf(id)).paneZoomed).toBe(true);
    }
  });
});

describe("SplitTreeRenderer zoom refit", () => {
  it("refits the tab when the zoom begins, moves, or ends — and only then", () => {
    const { renderer, zoomTo, debouncedFitAllLeaves } = fixture(nested());
    renderer.renderTabSplitTree("t1");
    expect(debouncedFitAllLeaves).not.toHaveBeenCalled();

    zoomTo("p2");
    renderer.updateActivePaneVisual("t1");
    expect(debouncedFitAllLeaves).toHaveBeenCalledTimes(1);
    expect(debouncedFitAllLeaves).toHaveBeenLastCalledWith("t1");

    // Unchanged: a focus redraw or a re-render of the same zoom fits nothing.
    renderer.updateActivePaneVisual("t1");
    renderer.renderTabSplitTree("t1");
    expect(debouncedFitAllLeaves).toHaveBeenCalledTimes(1);

    zoomTo("p3");
    renderer.updateActivePaneVisual("t1");
    expect(debouncedFitAllLeaves).toHaveBeenCalledTimes(2);

    zoomTo(null);
    renderer.updateActivePaneVisual("t1");
    expect(debouncedFitAllLeaves).toHaveBeenCalledTimes(3);
  });
});
