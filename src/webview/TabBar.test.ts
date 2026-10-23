// src/webview/TabBar.test.ts — Unit tests for Tab Bar rendering and interactions
//
// Tests renderTabBar output, click handlers, keyboard shortcuts, and tab lifecycle.

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBranch, createLeaf } from "./SplitModel";
import {
  buildTabBarData,
  chooseScopeDensity,
  countTabsPastRightEdge,
  handleTabKeyboardShortcut,
  type RenderTabBarDeps,
  renderTabBar,
  revealActiveTab,
  type TabBarDataSource,
  type TabBarScope,
  type TabKeyboardDeps,
} from "./TabBarUtils";

// ─── Helpers ────────────────────────────────────────────────────────

/** Create a minimal #tab-bar element in a JSDOM-like environment. */
function createTabBarElement(): HTMLDivElement {
  const el = document.createElement("div");
  el.id = "tab-bar";
  document.body.appendChild(el);
  return el;
}

/** Create mock deps for renderTabBar. */
function createMockDeps(overrides: Partial<RenderTabBarDeps> = {}): RenderTabBarDeps {
  return {
    tabBarEl: createTabBarElement(),
    terminals: new Map(),
    activeTabId: null,
    onTabClick: vi.fn(),
    onTabClose: vi.fn(),
    onAddClick: vi.fn(),
    ...overrides,
  };
}

// ─── Setup / Teardown ───────────────────────────────────────────────

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

// ─── renderTabBar ───────────────────────────────────────────────────

describe("renderTabBar", () => {
  it("shows tab bar when 0 terminals exist", () => {
    const deps = createMockDeps();
    renderTabBar(deps);
    expect(deps.tabBarEl.classList.contains("visible")).toBe(true);
    expect(deps.tabBarEl.querySelectorAll(".tab-item")).toHaveLength(0);
    // Should still have the "+" button
    expect(deps.tabBarEl.querySelector(".tab-add")).toBeTruthy();
  });

  it("shows tab bar with the lone tab when only 1 terminal exists", () => {
    const terminals = new Map<string, { name: string }>([["tab-1", { name: "Terminal 1" }]]);
    const deps = createMockDeps({ terminals: terminals as never, activeTabId: "tab-1" });
    renderTabBar(deps);
    expect(deps.tabBarEl.classList.contains("visible")).toBe(true);
    expect(deps.tabBarEl.querySelector(".tab-item .tab-name")?.textContent).toBe("Terminal 1");
  });

  it("shows tab bar when 2 terminals exist", () => {
    const terminals = new Map<string, { name: string }>([
      ["tab-1", { name: "Terminal 1" }],
      ["tab-2", { name: "Terminal 2" }],
    ]);
    const deps = createMockDeps({ terminals: terminals as never, activeTabId: "tab-1" });
    renderTabBar(deps);
    expect(deps.tabBarEl.classList.contains("visible")).toBe(true);
  });

  it("shows tab bar when 3 terminals exist", () => {
    const terminals = new Map<string, { name: string }>([
      ["tab-1", { name: "Terminal 1" }],
      ["tab-2", { name: "Terminal 2" }],
      ["tab-3", { name: "Terminal 3" }],
    ]);
    const deps = createMockDeps({ terminals: terminals as never, activeTabId: "tab-1" });
    renderTabBar(deps);
    expect(deps.tabBarEl.classList.contains("visible")).toBe(true);
    const tabs = deps.tabBarEl.querySelectorAll(".tab-item");
    expect(tabs.length).toBe(3);
  });

  it("marks the active tab with 'active' class", () => {
    const terminals = new Map<string, { name: string }>([
      ["tab-1", { name: "Terminal 1" }],
      ["tab-2", { name: "Terminal 2" }],
    ]);
    const deps = createMockDeps({ terminals: terminals as never, activeTabId: "tab-2" });
    renderTabBar(deps);
    const tabs = deps.tabBarEl.querySelectorAll(".tab-item");
    expect(tabs[0].classList.contains("active")).toBe(false);
    expect(tabs[1].classList.contains("active")).toBe(true);
  });

  it("renders tab names correctly", () => {
    const terminals = new Map<string, { name: string }>([
      ["tab-1", { name: "Terminal 1" }],
      ["tab-2", { name: "Terminal 2" }],
    ]);
    const deps = createMockDeps({ terminals: terminals as never, activeTabId: "tab-1" });
    renderTabBar(deps);
    const tabs = deps.tabBarEl.querySelectorAll(".tab-item");
    expect(tabs[0].querySelector(".tab-name")?.textContent).toBe("Terminal 1");
    expect(tabs[1].querySelector(".tab-name")?.textContent).toBe("Terminal 2");
  });

  it("renders close button on each tab", () => {
    const terminals = new Map<string, { name: string }>([
      ["tab-1", { name: "Terminal 1" }],
      ["tab-2", { name: "Terminal 2" }],
    ]);
    const deps = createMockDeps({ terminals: terminals as never, activeTabId: "tab-1" });
    renderTabBar(deps);
    const closeButtons = deps.tabBarEl.querySelectorAll(".tab-close");
    expect(closeButtons.length).toBe(2);
  });

  it("renders add button as last element", () => {
    const terminals = new Map<string, { name: string }>([
      ["tab-1", { name: "Terminal 1" }],
      ["tab-2", { name: "Terminal 2" }],
    ]);
    const deps = createMockDeps({ terminals: terminals as never, activeTabId: "tab-1" });
    renderTabBar(deps);
    const lastChild = deps.tabBarEl.lastElementChild;
    expect(lastChild?.classList.contains("tab-add")).toBe(true);
    expect(lastChild?.textContent).toBe("+");
  });

  it("preserves tab elements across re-renders", () => {
    const terminals = new Map<string, { name: string }>([
      ["tab-1", { name: "Terminal 1" }],
      ["tab-2", { name: "Terminal 2" }],
    ]);
    const deps = createMockDeps({ terminals: terminals as never, activeTabId: "tab-1" });
    renderTabBar(deps);
    const before = deps.tabBarEl.querySelectorAll(".tab-item");
    renderTabBar(deps);
    const after = deps.tabBarEl.querySelectorAll(".tab-item");
    expect(after.length).toBe(2);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
  });

  it("reorders existing tab nodes in place without recreating them", () => {
    const deps = createMockDeps({
      terminals: new Map<string, { name: string }>([
        ["tab-1", { name: "One" }],
        ["tab-2", { name: "Two" }],
      ]) as never,
      activeTabId: "tab-1",
    });
    renderTabBar(deps);
    const nodeA = deps.tabBarEl.querySelector<HTMLElement>('[data-tab-id="tab-1"]');
    const nodeB = deps.tabBarEl.querySelector<HTMLElement>('[data-tab-id="tab-2"]');

    // Re-render with the two tabs swapped in iteration order.
    deps.terminals = new Map<string, { name: string }>([
      ["tab-2", { name: "Two" }],
      ["tab-1", { name: "One" }],
    ]) as never;
    renderTabBar(deps);

    const tabs = deps.tabBarEl.querySelectorAll<HTMLElement>(".tab-item");
    expect(tabs.length).toBe(2);
    // Same DOM nodes, reused — just moved, not recreated.
    expect(tabs[0]).toBe(nodeB);
    expect(tabs[1]).toBe(nodeA);
    // "+" button stays last after the reorder.
    expect(deps.tabBarEl.lastElementChild?.classList.contains("tab-add")).toBe(true);
  });

  // ─── Click Handlers ─────────────────────────────────────────────

  it("calls onTabClick when tab is clicked", () => {
    const onTabClick = vi.fn();
    const terminals = new Map<string, { name: string }>([
      ["tab-1", { name: "Terminal 1" }],
      ["tab-2", { name: "Terminal 2" }],
    ]);
    const deps = createMockDeps({ terminals: terminals as never, activeTabId: "tab-1", onTabClick });
    renderTabBar(deps);
    const tabs = deps.tabBarEl.querySelectorAll(".tab-item");
    (tabs[1] as HTMLElement).click();
    expect(onTabClick).toHaveBeenCalledWith("tab-2");
  });

  it("calls onTabClose when close button is clicked with stopPropagation", () => {
    const onTabClick = vi.fn();
    const onTabClose = vi.fn();
    const terminals = new Map<string, { name: string }>([
      ["tab-1", { name: "Terminal 1" }],
      ["tab-2", { name: "Terminal 2" }],
    ]);
    const deps = createMockDeps({
      terminals: terminals as never,
      activeTabId: "tab-1",
      onTabClick,
      onTabClose,
    });
    renderTabBar(deps);
    const closeButtons = deps.tabBarEl.querySelectorAll(".tab-close");
    (closeButtons[0] as HTMLElement).click();
    expect(onTabClose).toHaveBeenCalledWith("tab-1");
    // Tab click should NOT have been called (stopPropagation)
    expect(onTabClick).not.toHaveBeenCalled();
  });

  it("calls onAddClick when add button is clicked", () => {
    const onAddClick = vi.fn();
    const terminals = new Map<string, { name: string }>([
      ["tab-1", { name: "Terminal 1" }],
      ["tab-2", { name: "Terminal 2" }],
    ]);
    const deps = createMockDeps({ terminals: terminals as never, activeTabId: "tab-1", onAddClick });
    renderTabBar(deps);
    const addButton = deps.tabBarEl.querySelector(".tab-add") as HTMLElement;
    addButton.click();
    expect(onAddClick).toHaveBeenCalled();
  });

  // ─── Exited State ──────────────────────────────────────────────────

  it("applies tab-exited class when exited is true", () => {
    const terminals = new Map<string, { name: string; exited?: boolean }>([
      ["tab-1", { name: "Terminal 1", exited: true }],
      ["tab-2", { name: "Terminal 2" }],
    ]);
    const deps = createMockDeps({ terminals: terminals as never, activeTabId: "tab-1" });
    renderTabBar(deps);
    const tabs = deps.tabBarEl.querySelectorAll(".tab-item");
    expect(tabs[0].classList.contains("tab-exited")).toBe(true);
    expect(tabs[1].classList.contains("tab-exited")).toBe(false);
  });

  it("shows '(exited)' suffix in tab name when exited is true", () => {
    const terminals = new Map<string, { name: string; exited?: boolean }>([
      ["tab-1", { name: "zsh", exited: true }],
      ["tab-2", { name: "Terminal 2" }],
    ]);
    const deps = createMockDeps({ terminals: terminals as never, activeTabId: "tab-1" });
    renderTabBar(deps);
    const tabs = deps.tabBarEl.querySelectorAll(".tab-item");
    expect(tabs[0].querySelector(".tab-name")?.textContent).toBe("zsh (exited)");
    expect(tabs[1].querySelector(".tab-name")?.textContent).toBe("Terminal 2");
  });

  it("does not apply tab-exited class when exited is false or undefined", () => {
    const terminals = new Map<string, { name: string; exited?: boolean }>([
      ["tab-1", { name: "Terminal 1", exited: false }],
      ["tab-2", { name: "Terminal 2" }],
    ]);
    const deps = createMockDeps({ terminals: terminals as never, activeTabId: "tab-1" });
    renderTabBar(deps);
    const tabs = deps.tabBarEl.querySelectorAll(".tab-item");
    expect(tabs[0].classList.contains("tab-exited")).toBe(false);
    expect(tabs[1].classList.contains("tab-exited")).toBe(false);
  });

  it("renders running, idle, and exited status indicators", () => {
    const terminals = new Map<
      string,
      { name: string; activityStatus?: "idle" | "running" | "waiting"; exited?: boolean }
    >([
      ["tab-1", { name: "Codex", activityStatus: "running" }],
      ["tab-2", { name: "Cursor", activityStatus: "waiting" }],
      ["tab-3", { name: "Grok", activityStatus: "idle" }],
      ["tab-4", { name: "Shell", activityStatus: "running", exited: true }],
    ]);
    const deps = createMockDeps({ terminals: terminals as never, activeTabId: "tab-1" });

    renderTabBar(deps);

    const tabs = deps.tabBarEl.querySelectorAll<HTMLElement>(".tab-item");
    expect(tabs[0].dataset.status).toBe("running");
    expect(tabs[0].querySelector(".tab-status-running")).toBeTruthy();
    expect(tabs[1].dataset.status).toBe("waiting");
    expect(tabs[1].querySelector(".tab-status-waiting")).toBeTruthy();
    expect(tabs[1].getAttribute("aria-label")).toBe("Cursor: Cursor approval required");
    expect(tabs[2].dataset.status).toBe("idle");
    expect(tabs[2].querySelector(".tab-status-idle")).toBeTruthy();
    expect(tabs[3].dataset.status).toBe("exited");
    expect(tabs[3].querySelector(".tab-status-exited")).toBeTruthy();
  });
});

// ─── handleTabKeyboardShortcut ──────────────────────────────────────

describe("handleTabKeyboardShortcut", () => {
  function createKeyboardDeps(overrides: Partial<TabKeyboardDeps> = {}): TabKeyboardDeps {
    return {
      terminals: new Map(),
      activeTabId: null,
      switchTab: vi.fn(),
      ...overrides,
    };
  }

  function makeKeyEvent(overrides: Partial<{ ctrlKey: boolean; shiftKey: boolean; key: string }> = {}) {
    return {
      ctrlKey: true,
      shiftKey: false,
      key: "Tab",
      ...overrides,
    };
  }

  it("returns false for non-Ctrl+Tab events", () => {
    const deps = createKeyboardDeps();
    expect(handleTabKeyboardShortcut(makeKeyEvent({ ctrlKey: false }), deps)).toBe(false);
    expect(handleTabKeyboardShortcut(makeKeyEvent({ key: "a" }), deps)).toBe(false);
  });

  it("is no-op when single tab exists", () => {
    const terminals = new Map<string, { name: string }>([["tab-1", { name: "Terminal 1" }]]);
    const deps = createKeyboardDeps({ terminals: terminals as never, activeTabId: "tab-1" });
    const result = handleTabKeyboardShortcut(makeKeyEvent(), deps);
    expect(result).toBe(true); // Handled
    expect(deps.switchTab).not.toHaveBeenCalled();
  });

  it("cycles forward with Ctrl+Tab", () => {
    const terminals = new Map<string, { name: string }>([
      ["tab-1", { name: "Terminal 1" }],
      ["tab-2", { name: "Terminal 2" }],
      ["tab-3", { name: "Terminal 3" }],
    ]);
    const deps = createKeyboardDeps({ terminals: terminals as never, activeTabId: "tab-1" });
    handleTabKeyboardShortcut(makeKeyEvent(), deps);
    expect(deps.switchTab).toHaveBeenCalledWith("tab-2");
  });

  it("wraps around forward with Ctrl+Tab", () => {
    const terminals = new Map<string, { name: string }>([
      ["tab-1", { name: "Terminal 1" }],
      ["tab-2", { name: "Terminal 2" }],
      ["tab-3", { name: "Terminal 3" }],
    ]);
    const deps = createKeyboardDeps({ terminals: terminals as never, activeTabId: "tab-3" });
    handleTabKeyboardShortcut(makeKeyEvent(), deps);
    expect(deps.switchTab).toHaveBeenCalledWith("tab-1");
  });

  it("cycles backward with Ctrl+Shift+Tab", () => {
    const terminals = new Map<string, { name: string }>([
      ["tab-1", { name: "Terminal 1" }],
      ["tab-2", { name: "Terminal 2" }],
      ["tab-3", { name: "Terminal 3" }],
    ]);
    const deps = createKeyboardDeps({ terminals: terminals as never, activeTabId: "tab-2" });
    handleTabKeyboardShortcut(makeKeyEvent({ shiftKey: true }), deps);
    expect(deps.switchTab).toHaveBeenCalledWith("tab-1");
  });

  it("wraps around backward with Ctrl+Shift+Tab", () => {
    const terminals = new Map<string, { name: string }>([
      ["tab-1", { name: "Terminal 1" }],
      ["tab-2", { name: "Terminal 2" }],
      ["tab-3", { name: "Terminal 3" }],
    ]);
    const deps = createKeyboardDeps({ terminals: terminals as never, activeTabId: "tab-1" });
    handleTabKeyboardShortcut(makeKeyEvent({ shiftKey: true }), deps);
    expect(deps.switchTab).toHaveBeenCalledWith("tab-3");
  });

  it("is no-op when 0 terminals exist", () => {
    const deps = createKeyboardDeps();
    const result = handleTabKeyboardShortcut(makeKeyEvent(), deps);
    expect(result).toBe(true);
    expect(deps.switchTab).not.toHaveBeenCalled();
  });
});

// ─── customName render priority (add-tab-rename) ─────────────────────

describe("renderTabBar: customName render priority", () => {
  it("renders customName instead of name when customName is non-null", () => {
    const terminals = new Map<string, { name: string; customName: string | null }>([
      ["tab-1", { name: "Terminal 1", customName: "build" }],
      ["tab-2", { name: "node index.js", customName: null }],
    ]);
    const deps = createMockDeps({ terminals: terminals as never, activeTabId: "tab-1" });
    renderTabBar(deps);
    const tabs = deps.tabBarEl.querySelectorAll(".tab-item");
    expect(tabs[0].querySelector(".tab-name")?.textContent).toBe("build");
    expect(tabs[1].querySelector(".tab-name")?.textContent).toBe("node index.js");
  });

  it("falls back to name when customName is null or undefined", () => {
    const terminals = new Map<string, { name: string; customName?: string | null }>([
      ["tab-1", { name: "Terminal 1", customName: null }],
      ["tab-2", { name: "Terminal 2" }], // customName field absent
    ]);
    const deps = createMockDeps({ terminals: terminals as never, activeTabId: "tab-1" });
    renderTabBar(deps);
    const tabs = deps.tabBarEl.querySelectorAll(".tab-item");
    expect(tabs[0].querySelector(".tab-name")?.textContent).toBe("Terminal 1");
    expect(tabs[1].querySelector(".tab-name")?.textContent).toBe("Terminal 2");
  });

  it("appends (exited) suffix to customName when the session has exited", () => {
    const terminals = new Map<string, { name: string; customName: string | null; exited: boolean }>([
      ["tab-1", { name: "Terminal 1", customName: "build", exited: true }],
    ]);
    const deps = createMockDeps({ terminals: terminals as never, activeTabId: "tab-1" });
    renderTabBar(deps);
    expect(deps.tabBarEl.querySelector(".tab-name")?.textContent).toBe("build (exited)");
  });
});

describe("renderTabBar: tab DOM carries data-vscode-context for rename menu", () => {
  it("each tab has data-vscode-context with webviewSection=terminalTab + tabId", () => {
    const terminals = new Map<string, { name: string }>([
      ["tab-abc", { name: "Terminal 1" }],
      ["tab-def", { name: "Terminal 2" }],
    ]);
    const deps = createMockDeps({ terminals: terminals as never, activeTabId: "tab-abc" });
    renderTabBar(deps);
    const tabs = deps.tabBarEl.querySelectorAll<HTMLElement>(".tab-item");
    expect(JSON.parse(tabs[0].dataset.vscodeContext!)).toEqual({
      webviewSection: "terminalTab",
      tabId: "tab-abc",
      tabPinned: false,
      tabLabel: "Terminal 1",
    });
    expect(JSON.parse(tabs[1].dataset.vscodeContext!)).toEqual({
      webviewSection: "terminalTab",
      tabId: "tab-def",
      tabPinned: false,
      tabLabel: "Terminal 2",
    });
  });

  it("carries the shown label, frame glyphs stripped, so the rename box is seeded with it", () => {
    const terminals = new Map<string, { name: string; customName?: string | null }>([
      ["tab-osc", { name: "✳ Last commit history" }],
      ["tab-custom", { name: "✳ Agent title", customName: "build" }],
    ]);
    const deps = createMockDeps({ terminals: terminals as never, activeTabId: "tab-osc" });
    renderTabBar(deps);
    const tabs = deps.tabBarEl.querySelectorAll<HTMLElement>(".tab-item");
    expect(JSON.parse(tabs[0].dataset.vscodeContext!).tabLabel).toBe("Last commit history");
    expect(JSON.parse(tabs[1].dataset.vscodeContext!).tabLabel).toBe("build");
  });

  it("carries tabPinned so the menu offers Unpin on a pinned tab", () => {
    const terminals = new Map<string, { name: string; pinned?: boolean }>([
      ["tab-abc", { name: "Terminal 1", pinned: true }],
    ]);
    const deps = createMockDeps({ terminals: terminals as never, activeTabId: "tab-abc" });
    renderTabBar(deps);
    const tab = deps.tabBarEl.querySelector<HTMLElement>(".tab-item")!;
    expect(JSON.parse(tab.dataset.vscodeContext!).tabPinned).toBe(true);
  });
});

// ─── Pinned tabs ─────────────────────────────────────────────────────

describe("pinned tabs", () => {
  it("swaps the close button for a pin mark, and back when unpinned", () => {
    const terminals = new Map<string, { name: string; pinned?: boolean }>([
      ["tab-1", { name: "Terminal 1", pinned: true }],
    ]);
    const deps = createMockDeps({ terminals: terminals as never, activeTabId: "tab-1" });
    renderTabBar(deps);
    const tab = deps.tabBarEl.querySelector<HTMLElement>(".tab-item")!;
    expect(tab.classList.contains("tab-pinned")).toBe(true);
    expect(tab.querySelector<HTMLElement>(".tab-close")!.hidden).toBe(true);
    expect(tab.querySelector<HTMLElement>(".tab-pin")!.hidden).toBe(false);

    terminals.get("tab-1")!.pinned = false;
    renderTabBar(deps);
    // Same element, reconciled in place.
    expect(deps.tabBarEl.querySelector(".tab-item")).toBe(tab);
    expect(tab.classList.contains("tab-pinned")).toBe(false);
    expect(tab.querySelector<HTMLElement>(".tab-close")!.hidden).toBe(false);
    expect(tab.querySelector<HTMLElement>(".tab-pin")!.hidden).toBe(true);
  });

  it("lists pinned tabs first, each group keeping its order", () => {
    const store = {
      tabLayouts: new Map([
        ["a", createLeaf("a")],
        ["b", createLeaf("b")],
        ["c", createLeaf("c")],
        ["d", createLeaf("d")],
      ]),
      tabActivePaneIds: new Map<string, string>(),
      terminals: new Map([
        ["a", { name: "a" }],
        ["b", { name: "b", pinned: true }],
        ["c", { name: "c" }],
        ["d", { name: "d", pinned: true }],
      ]) as never,
    };
    expect([...buildTabBarData(store).tabs.keys()]).toEqual(["b", "d", "a", "c"]);
  });

  it("takes a split tab's pin from its root pane", () => {
    const store = {
      tabLayouts: new Map([["root", createBranch("horizontal", createLeaf("root"), createLeaf("child"))]]),
      tabActivePaneIds: new Map([["root", "child"]]),
      terminals: new Map([
        ["root", { name: "root", pinned: true }],
        ["child", { name: "child" }],
      ]) as never,
    };
    expect(buildTabBarData(store).tabs.get("root")?.pinned).toBe(true);
  });
});

describe("renderTabBar: onTabRename + onAfterRender hooks", () => {
  it("uses native dblclick for rename while preserving the tab node", () => {
    const onTabClick = vi.fn();
    const onTabRename = vi.fn();
    const terminals = new Map<string, { name: string }>([
      ["tab-1", { name: "Terminal 1" }],
      ["tab-2", { name: "Terminal 2" }],
    ]);
    const deps = createMockDeps({
      terminals: terminals as never,
      activeTabId: "tab-1",
      onTabClick,
      onTabRename,
    });
    renderTabBar(deps);
    const tab = deps.tabBarEl.querySelectorAll<HTMLElement>(".tab-item")[1];
    deps.activeTabId = "tab-2";
    renderTabBar(deps);
    expect(deps.tabBarEl.querySelectorAll<HTMLElement>(".tab-item")[1]).toBe(tab);

    tab.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    tab.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 2 }));
    tab.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, detail: 2 }));

    expect(onTabClick).toHaveBeenCalledTimes(1);
    expect(onTabClick).toHaveBeenCalledWith("tab-2");
    expect(onTabRename).toHaveBeenCalledTimes(1);
    expect(onTabRename).toHaveBeenCalledWith("tab-2", tab);
  });

  it("does not reinterpret regular clicks as rename after another switch path", () => {
    const onTabClick = vi.fn();
    const onTabRename = vi.fn();
    const terminals = new Map<string, { name: string }>([
      ["tab-1", { name: "Terminal 1" }],
      ["tab-2", { name: "Terminal 2" }],
    ]);
    const deps = createMockDeps({
      terminals: terminals as never,
      activeTabId: "tab-1",
      onTabClick,
      onTabRename,
    });
    renderTabBar(deps);
    const tabs = deps.tabBarEl.querySelectorAll<HTMLElement>(".tab-item");
    tabs[1].dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    deps.activeTabId = "tab-2";
    renderTabBar(deps);
    deps.activeTabId = "tab-1";
    renderTabBar(deps);
    tabs[1].dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));

    expect(onTabClick).toHaveBeenCalledTimes(2);
    expect(onTabRename).not.toHaveBeenCalled();
  });

  it("calls onAfterRender at the end of each render (if provided)", () => {
    const onAfterRender = vi.fn();
    const terminals = new Map<string, { name: string }>([["tab-1", { name: "Terminal 1" }]]);
    const deps = createMockDeps({
      terminals: terminals as never,
      activeTabId: "tab-1",
      onAfterRender,
    });
    renderTabBar(deps);
    expect(onAfterRender).toHaveBeenCalledTimes(1);
  });
});

// ─── buildTabBarData: split-tab activity aggregation ────────────────

describe("buildTabBarData", () => {
  const source = (over: Partial<TabBarDataSource>): TabBarDataSource => ({
    tabLayouts: new Map(),
    tabActivePaneIds: new Map(),
    terminals: new Map(),
    ...over,
  });

  it("lights a split tab when ANY non-exited background pane is running", () => {
    const store = source({
      tabLayouts: new Map([["tab-1", createBranch("horizontal", createLeaf("tab-1"), createLeaf("pane-b"))]]),
      tabActivePaneIds: new Map([["tab-1", "tab-1"]]), // active pane is idle
      terminals: new Map([
        ["tab-1", { name: "Shell", exited: false, activityStatus: "idle" }],
        ["pane-b", { name: "Codex", exited: false, activityStatus: "running" }],
      ]) as never,
    });

    expect(buildTabBarData(store).tabs.get("tab-1")?.activityStatus).toBe("running");
  });

  it("stays idle when every pane is idle, and ignores a running-but-exited pane", () => {
    const idle = source({
      tabLayouts: new Map([["tab-1", createBranch("horizontal", createLeaf("tab-1"), createLeaf("pane-b"))]]),
      tabActivePaneIds: new Map([["tab-1", "tab-1"]]),
      terminals: new Map([
        ["tab-1", { name: "Shell", exited: false, activityStatus: "idle" }],
        ["pane-b", { name: "Codex", exited: true, activityStatus: "running" }],
      ]) as never,
    });

    expect(buildTabBarData(idle).tabs.get("tab-1")?.activityStatus).toBe("idle");
  });

  it("falls back to the default name when a program cleared the title", () => {
    const store = source({
      tabLayouts: new Map([["tab-1", createLeaf("tab-1")]]),
      terminals: new Map([["tab-1", { name: "", defaultName: "Terminal 3", customName: null }]]) as never,
    });

    expect(buildTabBarData(store).tabs.get("tab-1")?.name).toBe("Terminal 3");
  });

  it("keeps a user's name over the fallback when the title is cleared", () => {
    const store = source({
      tabLayouts: new Map([["tab-1", createLeaf("tab-1")]]),
      terminals: new Map([["tab-1", { name: "", defaultName: "Terminal 3", customName: "build" }]]) as never,
    });

    expect(buildTabBarData(store).tabs.get("tab-1")?.customName).toBe("build");
  });

  it("falls back for the active pane of a split tab too", () => {
    const store = source({
      tabLayouts: new Map([["tab-1", createBranch("horizontal", createLeaf("tab-1"), createLeaf("pane-b"))]]),
      tabActivePaneIds: new Map([["tab-1", "pane-b"]]),
      terminals: new Map([
        ["tab-1", { name: "Shell", defaultName: "Terminal 1", exited: false, activityStatus: "idle" }],
        ["pane-b", { name: "", defaultName: "Terminal 2", exited: false, activityStatus: "idle" }],
      ]) as never,
    });

    expect(buildTabBarData(store).tabs.get("tab-1")?.name).toBe("Terminal 2");
  });

  it("shows action-required when any non-exited split pane is waiting", () => {
    const store = source({
      tabLayouts: new Map([["tab-1", createBranch("horizontal", createLeaf("tab-1"), createLeaf("pane-b"))]]),
      tabActivePaneIds: new Map([["tab-1", "tab-1"]]),
      terminals: new Map([
        ["tab-1", { name: "Shell", exited: false, activityStatus: "running" }],
        ["pane-b", { name: "Cursor", exited: false, activityStatus: "waiting" }],
      ]) as never,
    });

    expect(buildTabBarData(store).tabs.get("tab-1")?.activityStatus).toBe("waiting");
  });
});

// ─── Main and linked-worktree ownership ─────────────────────────────

describe("the tab bar filters by stable terminal owner", () => {
  const HERE = "/wt/here";
  const ELSEWHERE = "/wt/elsewhere";

  function ownedStore(): TabBarDataSource {
    return {
      tabLayouts: new Map([
        ["main", createLeaf("main")],
        ["here", createLeaf("here")],
        ["elsewhere", createLeaf("elsewhere")],
      ]),
      tabActivePaneIds: new Map(),
      terminals: new Map([
        ["main", { name: "main", exited: false, activityStatus: "idle" }],
        ["here", { name: "here", exited: false, activityStatus: "idle", worktreeId: HERE }],
        ["elsewhere", { name: "elsewhere", exited: false, activityStatus: "waiting", worktreeId: ELSEWHERE }],
      ]) as never,
    };
  }

  it("shows only main-owned terminals when no linked worktree is selected", () => {
    expect([...buildTabBarData(ownedStore()).tabs.keys()]).toEqual(["main"]);
  });

  it("shows only terminals owned by the selected linked worktree", () => {
    const scope: TabBarScope = { worktreeId: HERE };
    expect([...buildTabBarData(ownedStore(), scope).tabs.keys()]).toEqual(["here"]);
  });

  it("[I18] does not let presence attribution move a terminal between owners", () => {
    const presenceAttribution = new Map([
      ["main", HERE],
      ["here", ELSEWHERE],
    ]);
    const scope: TabBarScope = { worktreeId: HERE };
    expect(presenceAttribution.size).toBe(2);
    expect(scope).not.toHaveProperty("attribution");
    expect([...buildTabBarData(ownedStore(), scope).tabs.keys()]).toEqual(["here"]);
  });

  it("counts hidden waiting tabs without changing their owner", () => {
    const data = buildTabBarData(ownedStore(), { worktreeId: HERE });
    expect(data.hiddenWaiting).toBe(1);
  });

  it("keeps a split under the owner inherited by its panes", () => {
    const store: TabBarDataSource = {
      tabLayouts: new Map([["root", createBranch("horizontal", createLeaf("root"), createLeaf("child"))]]),
      tabActivePaneIds: new Map([["root", "child"]]),
      terminals: new Map([
        ["root", { name: "root", exited: false, activityStatus: "idle", worktreeId: HERE }],
        ["child", { name: "child", exited: false, activityStatus: "waiting", worktreeId: HERE }],
      ]) as never,
    };
    const tab = buildTabBarData(store, { worktreeId: HERE }).tabs.get("root");
    expect(tab?.name).toBe("child");
    expect(tab?.activityStatus).toBe("waiting");
    expect(tab?.worktreeId).toBe(HERE);
  });

  it("presents the bar whatever the tab count, linked or in main", () => {
    const one = new Map([["a", { name: "a" }]]);
    for (const [size, linked, visible] of [
      [0, true, true],
      [1, true, true],
      [0, false, true],
      [1, false, true],
    ] as const) {
      const deps = createMockDeps({
        terminals: size === 0 ? new Map() : one,
        ...(linked ? { scope: { worktreeId: HERE, label: "here" } } : {}),
      });
      renderTabBar(deps);
      expect(deps.tabBarEl.classList.contains("visible"), `size ${size}, linked ${linked}`).toBe(visible);
    }
  });
});

// ─── The chip that names the scope, and the escape it offers ─────────

describe("a scope is named wherever it is in force", () => {
  const chip = (el: HTMLElement) => el.querySelector<HTMLElement>(".tab-scope");
  const two = () =>
    new Map([
      ["a", { name: "a" }],
      ["b", { name: "b" }],
    ]);

  it("[I19] carries an indicator exactly for a linked owner, and none for main", () => {
    const deps = createMockDeps({ terminals: two(), scope: { worktreeId: "/wt/scope", label: "feat/here" } });
    renderTabBar(deps);
    expect(chip(deps.tabBarEl)?.textContent).toContain("Worktree");
    expect(chip(deps.tabBarEl)?.textContent).toContain("feat/here");
    expect(chip(deps.tabBarEl)?.querySelector(".tab-scope-icon svg")).not.toBeNull();
    expect(chip(deps.tabBarEl)?.getAttribute("aria-label")).toBe("Showing only tabs in feat/here");
    expect(chip(deps.tabBarEl)?.getAttribute("aria-describedby")).toBe("webview-tooltip-widget");
    expect(chip(deps.tabBarEl)?.hasAttribute("title")).toBe(false);

    renderTabBar({ ...deps, scope: undefined });
    expect(chip(deps.tabBarEl)).toBeNull();
  });

  it("shows the scoped worktree name through the shared hover tooltip", () => {
    vi.useFakeTimers();
    try {
      const deps = createMockDeps({ terminals: two(), scope: { worktreeId: "/wt/scope", label: "feat/here" } });
      renderTabBar(deps);
      chip(deps.tabBarEl)?.dispatchEvent(new MouseEvent("mouseenter"));
      vi.advanceTimersByTime(300);
      const tooltip = document.body.querySelector<HTMLElement>(".webview-tooltip");
      expect(tooltip?.style.display).toBe("block");
      expect(tooltip?.textContent).toBe("Worktree: feat/here");
    } finally {
      vi.useRealTimers();
    }
  });

  it("frames every scoped worktree, including main", () => {
    const deps = createMockDeps({ terminals: two(), scope: { worktreeId: "/wt/scope", label: "feat/here" } });
    renderTabBar(deps);
    expect(deps.tabBarEl.dataset.worktreeScope).toBe("active");

    renderTabBar({ ...deps, scope: { worktreeId: "/wt/scope", label: "main" } });
    expect(deps.tabBarEl.dataset.worktreeScope).toBe("active");

    renderTabBar({ ...deps, scope: undefined });
    expect(deps.tabBarEl.dataset.worktreeScope).toBeUndefined();
  });

  it("hands New Terminal the selected worktree instead of creating in the default cwd", () => {
    const onAddClick = vi.fn();
    const deps = createMockDeps({
      terminals: two(),
      scope: { worktreeId: "/repo-wt/feat", label: "feat/here" },
      onAddClick,
    });
    renderTabBar(deps);

    deps.tabBarEl.querySelector<HTMLButtonElement>(".tab-add")?.click();
    expect(onAddClick).toHaveBeenCalledWith("/repo-wt/feat");
  });

  it("chooses content from the measured space left after terminal tabs", () => {
    expect(chooseScopeDensity(140, { full: 120, kind: 70, icon: 30 })).toBe("full");
    expect(chooseScopeDensity(90, { full: 120, kind: 70, icon: 30 })).toBe("kind");
    expect(chooseScopeDensity(20, { full: 120, kind: 70, icon: 30 })).toBe("icon");
  });

  it("rebalances when adding tabs without waiting for a viewport resize", () => {
    const clientWidth = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.id === "tab-bar" ? 280 : 0;
    });
    const offsetWidth = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.classList.contains("tab-item")) {
        return 80;
      }
      if (this.classList.contains("tab-add")) {
        return 28;
      }
      return 0;
    });
    const scrollWidth = vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (!this.classList.contains("tab-scope")) {
        return 0;
      }
      return this.dataset.density === "full" ? 120 : this.dataset.density === "kind" ? 70 : 30;
    });
    try {
      const deps = createMockDeps({
        terminals: new Map([["a", { name: "a" }]]),
        scope: { worktreeId: "/wt/scope", label: "feat/here" },
      });
      renderTabBar(deps);
      expect(chip(deps.tabBarEl)?.dataset.density).toBe("full");

      deps.terminals = new Map([
        ["a", { name: "a" }],
        ["b", { name: "b" }],
      ]);
      renderTabBar(deps);
      expect(chip(deps.tabBarEl)?.dataset.density).toBe("kind");

      deps.terminals.set("c", { name: "c" });
      renderTabBar(deps);
      expect(chip(deps.tabBarEl)?.dataset.density).toBe("icon");
    } finally {
      clientWidth.mockRestore();
      offsetWidth.mockRestore();
      scrollWidth.mockRestore();
    }
  });

  const badge = (el: HTMLElement) => el.querySelector<HTMLElement>(".tab-scope-badge");

  it("marks the worktree indicator with the count of hidden tabs that need a human", () => {
    const deps = createMockDeps({
      terminals: two(),
      scope: { worktreeId: "/wt/scope", label: "feat/here", hiddenWaiting: 2 },
    });
    renderTabBar(deps);
    expect(badge(deps.tabBarEl)?.textContent).toBe("2");
    expect(chip(deps.tabBarEl)?.contains(badge(deps.tabBarEl))).toBe(true);
    expect(chip(deps.tabBarEl)?.getAttribute("aria-label")).toBe(
      "Showing terminals in feat/here; 2 hidden tabs need you",
    );
  });

  it("renders no mark at all at zero, and none when the count is not given", () => {
    // Not a "0": a badge that is always present is a badge nobody reads.
    const deps = createMockDeps({
      terminals: two(),
      scope: { worktreeId: "/wt/scope", label: "feat/here", hiddenWaiting: 0 },
    });
    renderTabBar(deps);
    expect(badge(deps.tabBarEl)).toBeNull();

    renderTabBar({ ...deps, scope: { worktreeId: "/wt/scope", label: "feat/here" } });
    expect(badge(deps.tabBarEl)).toBeNull();
  });

  it("removes the mark when the last hidden waiting tab stops waiting", () => {
    const deps = createMockDeps({
      terminals: two(),
      scope: { worktreeId: "/wt/scope", label: "feat/here", hiddenWaiting: 1 },
    });
    renderTabBar(deps);
    expect(badge(deps.tabBarEl)?.textContent).toBe("1");

    renderTabBar({ ...deps, scope: { worktreeId: "/wt/scope", label: "feat/here", hiddenWaiting: 0 } });
    // Gone, not blanked — an empty badge still reads as a mark.
    expect(badge(deps.tabBarEl)).toBeNull();
    expect(chip(deps.tabBarEl)?.getAttribute("aria-label")).toBe("Showing only tabs in feat/here");
  });

  it("says one hidden tab in the singular", () => {
    const deps = createMockDeps({
      terminals: two(),
      scope: { worktreeId: "/wt/scope", label: "feat/here", hiddenWaiting: 1 },
    });
    renderTabBar(deps);
    expect(chip(deps.tabBarEl)?.getAttribute("aria-label")).toBe(
      "Showing terminals in feat/here; 1 hidden tab needs you",
    );
  });

  it("updates the mark in place rather than rebuilding the chip", () => {
    const deps = createMockDeps({
      terminals: two(),
      scope: { worktreeId: "/wt/scope", label: "feat/here", hiddenWaiting: 1 },
    });
    renderTabBar(deps);
    const before = chip(deps.tabBarEl);
    renderTabBar({ ...deps, scope: { worktreeId: "/wt/scope", label: "feat/here", hiddenWaiting: 3 } });
    expect(chip(deps.tabBarEl)).toBe(before);
    expect(badge(deps.tabBarEl)?.textContent).toBe("3");
  });

  it("keeps the worktree indicator at the right edge after the tabs and add button", () => {
    const deps = createMockDeps({ terminals: two(), scope: { worktreeId: "/wt/scope", label: "feat/here" } });
    renderTabBar(deps);
    expect([...deps.tabBarEl.children].map((c) => c.className.split(" ")[0])).toEqual([
      "tab-item",
      "tab-item",
      "tab-add",
      "tab-scope",
    ]);
  });

  it("survives a re-render that changes no tab, node and all", () => {
    // The tail-trimming loop after the "+" is what would otherwise delete it, and a
    // rebuilt node would drop an in-flight pointer press the way a rebuilt tab does.
    const deps = createMockDeps({ terminals: two(), scope: { worktreeId: "/wt/scope", label: "feat/here" } });
    renderTabBar(deps);
    const before = chip(deps.tabBarEl);
    renderTabBar(deps);
    expect(chip(deps.tabBarEl)).toBe(before);
    expect(deps.tabBarEl.querySelectorAll(".tab-scope")).toHaveLength(1);
  });

  it("renames in place rather than rebuilding when the scope's label moves", () => {
    const deps = createMockDeps({ terminals: two(), scope: { worktreeId: "/wt/scope", label: "one" } });
    renderTabBar(deps);
    const before = chip(deps.tabBarEl);
    renderTabBar({ ...deps, scope: { worktreeId: "/wt/scope", label: "two" } });
    expect(chip(deps.tabBarEl)).toBe(before);
    expect(chip(deps.tabBarEl)?.textContent).toContain("two");
  });

  it("lives on the tab bar, not in the panel that set the scope", () => {
    // Which is what keeps it reachable when the worktree panel is collapsed or
    // hidden: the escape is not inside the thing that can be put away.
    const panel = document.createElement("div");
    panel.className = "vault-panel";
    panel.hidden = true;
    document.body.appendChild(panel);

    const deps = createMockDeps({ terminals: two(), scope: { worktreeId: "/wt/scope", label: "feat/here" } });
    renderTabBar(deps);
    expect(chip(deps.tabBarEl)?.closest(".vault-panel")).toBeNull();
    expect(deps.tabBarEl.contains(chip(deps.tabBarEl))).toBe(true);
  });

  it("removes the linked indicator when returning to main terminals", () => {
    const deps = createMockDeps({
      terminals: new Map([["linked", { name: "linked", worktreeId: "/wt/here" }]]),
      scope: { worktreeId: "/wt/here", label: "here" },
    });
    renderTabBar(deps);
    expect(chip(deps.tabBarEl)).not.toBeNull();

    renderTabBar({ ...deps, terminals: new Map([["main", { name: "main" }]]), scope: undefined });
    expect(chip(deps.tabBarEl)).toBeNull();
    expect([...deps.tabBarEl.querySelectorAll(".tab-name")].map((el) => el.textContent)).toEqual(["main"]);
  });
});

// ─── Drag to reorder ────────────────────────────────────────────────

describe("renderTabBar: drag to reorder", () => {
  /** jsdom has no DragEvent; a plain Event carrying a DataTransfer stand-in is enough. */
  function fireDrag(target: HTMLElement, type: string, clientX = 0, types: string[] = []): Event {
    const data = new Map<string, string>();
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, {
      clientX,
      dataTransfer: {
        types,
        effectAllowed: "none",
        dropEffect: "none",
        setData: (mime: string, value: string) => data.set(mime, value),
        getData: (mime: string) => data.get(mime) ?? "",
      },
    });
    target.dispatchEvent(event);
    return event;
  }

  function tabEl(deps: RenderTabBarDeps, id: string): HTMLElement {
    const el = deps.tabBarEl.querySelector<HTMLElement>(`[data-tab-id="${id}"]`)!;
    // 100px wide at x=0: the left half drops before, the right half after.
    el.getBoundingClientRect = () => ({ left: 0, width: 100 }) as DOMRect;
    return el;
  }

  function render(onTabReorder?: RenderTabBarDeps["onTabReorder"]) {
    const deps = createMockDeps({
      terminals: new Map([
        ["p", { name: "Pinned", pinned: true }],
        ["a", { name: "A" }],
        ["b", { name: "B" }],
      ]),
      activeTabId: "a",
      onTabReorder,
    });
    renderTabBar(deps);
    return deps;
  }

  it("makes tabs draggable only when a reorder handler is given", () => {
    expect(tabEl(render(), "a").draggable).toBe(false);
    expect(tabEl(render(vi.fn()), "a").draggable).toBe(true);
  });

  it("reports the drop position from the half of the target tab", () => {
    const onTabReorder = vi.fn();
    const deps = render(onTabReorder);
    fireDrag(tabEl(deps, "b"), "dragstart");
    expect(tabEl(deps, "b").classList.contains("tab-dragging")).toBe(true);

    const over = fireDrag(tabEl(deps, "a"), "dragover", 20);
    expect(over.defaultPrevented).toBe(true);
    expect(tabEl(deps, "a").classList.contains("tab-drop-before")).toBe(true);

    fireDrag(tabEl(deps, "a"), "drop", 20);
    expect(onTabReorder).toHaveBeenCalledWith("b", "a", "before");
    expect(tabEl(deps, "a").classList.contains("tab-drop-before")).toBe(false);

    fireDrag(tabEl(deps, "b"), "dragend");
    fireDrag(tabEl(deps, "a"), "dragstart");
    fireDrag(tabEl(deps, "b"), "drop", 80);
    expect(onTabReorder).toHaveBeenLastCalledWith("a", "b", "after");
    fireDrag(tabEl(deps, "a"), "dragend");
    expect(tabEl(deps, "a").classList.contains("tab-dragging")).toBe(false);
  });

  it("refuses a drop across the pinned boundary", () => {
    const onTabReorder = vi.fn();
    const deps = render(onTabReorder);
    fireDrag(tabEl(deps, "a"), "dragstart");
    const over = fireDrag(tabEl(deps, "p"), "dragover", 20);
    expect(over.defaultPrevented).toBe(false);
    fireDrag(tabEl(deps, "p"), "drop", 20);
    expect(onTabReorder).not.toHaveBeenCalled();
    fireDrag(tabEl(deps, "a"), "dragend");
  });

  it("keeps the drag marks across a re-render mid-drag", () => {
    const deps = render(vi.fn());
    fireDrag(tabEl(deps, "b"), "dragstart");
    fireDrag(tabEl(deps, "a"), "dragover", 80);
    renderTabBar(deps);
    expect(tabEl(deps, "b").classList.contains("tab-dragging")).toBe(true);
    expect(tabEl(deps, "a").classList.contains("tab-drop-after")).toBe(true);
    fireDrag(tabEl(deps, "b"), "dragend");
  });
});

describe("tab overflow: active tab reveal and the +N mark", () => {
  const TAB_WIDTH = 100;
  const MARK_WIDTH = 30;

  /**
   * A fake layout: every tab is TAB_WIDTH wide, laid out from the bar's left edge
   * and shifted by its scrollLeft; the bar shows `barWidth` px. JSDOM has none.
   */
  function fakeLayout(barWidth: number): void {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.id === "tab-bar" ? barWidth : 0;
    });
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("tab-overflow") ? MARK_WIDTH : 0;
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const bar = this.closest<HTMLElement>("#tab-bar");
      if (!bar || bar === this || !this.classList.contains("tab-item")) {
        return DOMRect.fromRect({ x: 0, y: 0, width: barWidth, height: 30 });
      }
      const index = Array.from(bar.querySelectorAll(".tab-item")).indexOf(this);
      return DOMRect.fromRect({ x: index * TAB_WIDTH - bar.scrollLeft, y: 0, width: TAB_WIDTH, height: 30 });
    });
  }

  type FakeTab = { name: string; activityStatus?: "idle" | "running" | "waiting" };

  function tabs(count: number): Map<string, FakeTab> {
    return new Map(Array.from({ length: count }, (_, i) => [`t${i}`, { name: `Terminal ${i}` }]));
  }

  it("counts a tab cut off part-way as past the edge", () => {
    expect(countTabsPastRightEdge([100, 200, 300], 250, 0)).toBe(1);
    expect(countTabsPastRightEdge([100, 200, 300], 250, 60)).toBe(2);
    expect(countTabsPastRightEdge([100, 200], 250, 0)).toBe(0);
  });

  it("draws no mark when the tabs fit, and none without layout", () => {
    const deps = createMockDeps({ terminals: tabs(5) as never, activeTabId: "t0" });
    renderTabBar(deps);
    expect(deps.tabBarEl.querySelector(".tab-overflow")).toBeNull();
    fakeLayout(1000);
    renderTabBar(deps);
    expect(deps.tabBarEl.querySelector(".tab-overflow")).toBeNull();
  });

  it("shows how many tabs are past the right edge, the mark's own width included", () => {
    fakeLayout(250);
    const deps = createMockDeps({ terminals: tabs(5) as never, activeTabId: "t0" });
    renderTabBar(deps);
    const mark = deps.tabBarEl.querySelector<HTMLElement>(".tab-overflow");
    // Visible strip is 250 - 30 = 220: t0 and t1 fit, t2..t4 do not.
    expect(mark?.textContent).toBe("+3");
    expect(mark?.getAttribute("aria-label")).toBe("3 more tabs to the right");
    // Sits between "+" and the end, so the reconciled order still reads tabs, "+".
    expect(mark?.previousElementSibling?.classList.contains("tab-add")).toBe(true);
  });

  it("tints the mark when a hidden tab is waiting", () => {
    fakeLayout(250);
    const terminals = tabs(4);
    terminals.set("t3", { name: "Agent", activityStatus: "waiting" });
    const deps = createMockDeps({ terminals: terminals as never, activeTabId: "t0" });
    renderTabBar(deps);
    expect(deps.tabBarEl.querySelector(".tab-overflow")?.classList.contains("tab-overflow-waiting")).toBe(true);
  });

  it("scrolls a newly active tab at the end into view beside the mark", () => {
    fakeLayout(250);
    const deps = createMockDeps({ terminals: tabs(5) as never, activeTabId: "t0" });
    renderTabBar(deps);
    renderTabBar({ ...deps, activeTabId: "t4" });
    // t4 ends at 500; the visible strip is 220 wide with the mark in place.
    expect(deps.tabBarEl.scrollLeft).toBe(280);
  });

  it("does not yank back a bar the user scrolled while the active tab is unchanged", () => {
    fakeLayout(250);
    const deps = createMockDeps({ terminals: tabs(5) as never, activeTabId: "t0" });
    renderTabBar(deps);
    deps.tabBarEl.scrollLeft = 200;
    renderTabBar(deps);
    expect(deps.tabBarEl.scrollLeft).toBe(200);
    revealActiveTab(deps.tabBarEl);
    expect(deps.tabBarEl.scrollLeft).toBe(0);
  });

  it("reveals the next hidden tab when the mark is clicked", () => {
    fakeLayout(250);
    const deps = createMockDeps({ terminals: tabs(5) as never, activeTabId: "t0" });
    renderTabBar(deps);
    deps.tabBarEl.querySelector<HTMLElement>(".tab-overflow")?.click();
    // t2 ends at 300; visible strip 220.
    expect(deps.tabBarEl.scrollLeft).toBe(80);
  });
});
