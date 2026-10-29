// @vitest-environment jsdom
// src/webview/split/SplitTreeRenderer.broadcast.test.ts — the broadcast frame and the
// context-menu keys that pick "Broadcast Input" or "Stop Broadcasting Input".

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBranch, createLeaf, type SplitNode } from "../SplitModel";
import { SplitTreeRenderer } from "./SplitTreeRenderer";

function fixture(layout: SplitNode) {
  const broadcasting = new Set<string>();
  const store = {
    terminals: new Map<string, { container: HTMLDivElement }>(),
    tabLayouts: new Map<string, SplitNode>([["t1", layout]]),
    tabActivePaneIds: new Map([["t1", "t1"]]),
    resizeCleanups: new Map(),
    activeTabId: "t1",
    persist: vi.fn(),
  };
  for (const id of ["t1", "p2"]) {
    store.terminals.set(id, { container: document.createElement("div") });
  }
  const renderer = new SplitTreeRenderer({
    store: store as never,
    resizeCoordinator: { debouncedFitAllLeaves: vi.fn() } as never,
    flowControl: { delete: vi.fn() } as never,
    postMessage: vi.fn(),
    onTabBarUpdate: vi.fn(),
    isBroadcasting: (tabId) => broadcasting.has(tabId),
  });
  const tabEl = () => document.querySelector<HTMLElement>('[data-tab-id="t1"]')!;
  const contextOf = (el: HTMLElement) => JSON.parse(el.dataset.vscodeContext ?? "{}");
  const leafOf = (id: string) => document.querySelector<HTMLElement>(`.split-leaf[data-session-id="${id}"]`)!;
  return { store, renderer, broadcasting, tabEl, contextOf, leafOf };
}

const split = () => createBranch("vertical", createLeaf("t1"), createLeaf("p2"));

beforeEach(() => {
  document.body.innerHTML = '<div id="terminal-container"></div>';
});

describe("SplitTreeRenderer broadcast visuals", () => {
  it("offers Broadcast on a split tab that is not broadcasting", () => {
    const { store, renderer, tabEl, contextOf, leafOf } = fixture(split());
    renderer.renderTabSplitTree("t1");
    expect(tabEl().classList.contains("broadcast-input")).toBe(false);
    for (const id of ["t1", "p2"]) {
      const expected = { webviewSection: "splitPane", paneSessionId: id, paneSplit: true, broadcastInput: false };
      expect(contextOf(store.terminals.get(id)!.container)).toEqual(expected);
      expect(contextOf(leafOf(id))).toEqual(expected);
    }
  });

  it("frames the tab and flips every pane's menu key while broadcasting", () => {
    const { store, renderer, broadcasting, tabEl, contextOf, leafOf } = fixture(split());
    renderer.renderTabSplitTree("t1");
    broadcasting.add("t1");
    renderer.updateActivePaneVisual("t1");
    expect(tabEl().classList.contains("broadcast-input")).toBe(true);
    for (const id of ["t1", "p2"]) {
      expect(contextOf(store.terminals.get(id)!.container).broadcastInput).toBe(true);
      expect(contextOf(leafOf(id)).broadcastInput).toBe(true);
    }

    broadcasting.delete("t1");
    renderer.updateActivePaneVisual("t1");
    expect(tabEl().classList.contains("broadcast-input")).toBe(false);
    expect(contextOf(leafOf("p2")).broadcastInput).toBe(false);
  });

  it("marks a single-pane tab as not split, so the menu offers no broadcast", () => {
    const { store, renderer, contextOf, leafOf } = fixture(createLeaf("t1"));
    renderer.renderTabSplitTree("t1");
    expect(contextOf(store.terminals.get("t1")!.container)).toMatchObject({ paneSplit: false, broadcastInput: false });
    expect(contextOf(leafOf("t1")).paneSplit).toBe(false);
  });

  it("drops the frame when a broadcasting tab re-renders as one pane", () => {
    const { store, renderer, broadcasting, tabEl } = fixture(split());
    broadcasting.add("t1");
    renderer.renderTabSplitTree("t1");
    expect(tabEl().classList.contains("broadcast-input")).toBe(true);
    store.tabLayouts.set("t1", createLeaf("t1"));
    broadcasting.delete("t1");
    renderer.renderTabSplitTree("t1");
    expect(tabEl().classList.contains("broadcast-input")).toBe(false);
  });
});
