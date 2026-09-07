import { describe, expect, it, vi } from "vitest";
import { createBranch, createLeaf, getAllSessionIds, type SplitNode } from "../SplitModel";
import { SplitTreeRenderer } from "./SplitTreeRenderer";

function fixture() {
  const store = {
    terminals: new Map<string, any>(),
    tabLayouts: new Map<string, SplitNode>([
      ["tab-a", createLeaf("pane-a")],
      ["tab-b", createLeaf("pane-b")],
    ]),
    tabActivePaneIds: new Map([
      ["tab-a", "pane-a"],
      ["tab-b", "pane-b"],
    ]),
    resizeCleanups: new Map(),
    activeTabId: "tab-b",
    currentConfig: { fontSize: 14, cursorBlink: true, scrollback: 1000, fontFamily: "" },
    persist: vi.fn(),
  };
  store.terminals.set("pane-a", { worktreeId: "/wt/a" });
  store.terminals.set("pane-b", {});
  const resizeCoordinator = { debouncedFitAllLeaves: vi.fn() };
  const flowControl = { delete: vi.fn() };
  const postMessage = vi.fn();
  const onTabBarUpdate = vi.fn();
  const renderer = new SplitTreeRenderer({
    store: store as any,
    resizeCoordinator: resizeCoordinator as any,
    flowControl: flowControl as any,
    postMessage,
    onTabBarUpdate,
  });
  const factory = {
    createTerminal: vi.fn(
      (
        id: string,
        _name: string,
        _config: unknown,
        _active: boolean,
        _customName: unknown,
        options: { worktreeId?: string },
      ) => {
        const instance = { id, worktreeId: options.worktreeId };
        store.terminals.set(id, instance);
        return instance;
      },
    ),
  };
  return { store, renderer, factory, resizeCoordinator, flowControl, postMessage, onTabBarUpdate };
}

const message = {
  type: "splitPaneCreated" as const,
  requestId: "split-1",
  sourceTabId: "tab-a",
  sourcePaneId: "pane-a",
  newSessionId: "pane-new",
  newSessionName: "Terminal 3",
  direction: "vertical" as const,
};

describe("SplitTreeRenderer split completion", () => {
  it("attaches to the captured source tab while another tab is active", () => {
    const { store, renderer, factory } = fixture();

    expect(renderer.handleSplitPaneCreated(message, factory as any)).toBe(true);
    expect(getAllSessionIds(store.tabLayouts.get("tab-a")!)).toEqual(["pane-a", "pane-new"]);
    expect(store.tabLayouts.get("tab-b")).toEqual(createLeaf("pane-b"));
    expect(store.activeTabId).toBe("tab-b");
    expect(store.tabActivePaneIds.get("tab-b")).toBe("pane-b");
    expect(factory.createTerminal.mock.calls[0][5]).toMatchObject({ isSplitPane: true, worktreeId: "/wt/a" });
    expect(store.persist).not.toHaveBeenCalled();
  });

  it("derives child ownership from the source fact after reconciliation", () => {
    const { store, renderer, factory } = fixture();
    store.terminals.get("pane-a").worktreeId = undefined;

    expect(renderer.handleSplitPaneCreated(message, factory as any)).toBe(true);
    expect(factory.createTerminal.mock.calls[0][5]).toMatchObject({ isSplitPane: true, worktreeId: undefined });
  });

  it("rejects completion when the captured source is gone", () => {
    const { store, renderer, factory } = fixture();
    store.terminals.delete("pane-a");

    expect(renderer.handleSplitPaneCreated(message, factory as any)).toBe(false);
    expect(factory.createTerminal).not.toHaveBeenCalled();
    expect(store.terminals.has("pane-new")).toBe(false);
  });
});

describe("SplitTreeRenderer split close facts", () => {
  it("removes one pane and returns the surviving fact without running navigation effects", () => {
    const f = fixture();
    f.store.tabLayouts.set("tab-a", createBranch("vertical", createLeaf("pane-a"), createLeaf("pane-child")));
    f.store.tabActivePaneIds.set("tab-a", "pane-child");
    const focus = vi.fn();
    const remove = vi.fn();
    const dispose = vi.fn();
    f.store.terminals.set("pane-child", { terminal: { focus }, container: { remove: vi.fn() } });
    f.store.terminals.set("pane-a", { terminal: { dispose }, container: { remove } });

    expect(f.renderer.closeSplitPaneById("pane-a")).toEqual({
      kind: "closed",
      tabId: "tab-a",
      closedPaneId: "pane-a",
      survivingPaneId: "pane-child",
    });
    expect(f.store.tabLayouts.get("tab-a")).toEqual(createLeaf("pane-child"));
    expect(f.store.tabActivePaneIds.get("tab-a")).toBe("pane-child");
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(f.flowControl.delete).toHaveBeenCalledWith("pane-a");
    expect(f.postMessage).not.toHaveBeenCalled();
    expect(f.store.persist).not.toHaveBeenCalled();
    expect(f.onTabBarUpdate).not.toHaveBeenCalled();
    expect(f.resizeCoordinator.debouncedFitAllLeaves).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
  });

  it("returns a whole-tab close intent without posting it", () => {
    const f = fixture();
    expect(f.renderer.closeSplitPaneById("pane-a")).toEqual({ kind: "close-tab", tabId: "tab-a" });
    expect(f.postMessage).not.toHaveBeenCalled();
    expect(f.store.tabLayouts.get("tab-a")).toEqual(createLeaf("pane-a"));
  });
});
