import { describe, expect, it, vi } from "vitest";
import { createLeaf, getAllSessionIds } from "../SplitModel";
import { SplitTreeRenderer } from "./SplitTreeRenderer";

function fixture() {
  const store = {
    terminals: new Map<string, any>(),
    tabLayouts: new Map([
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
  const renderer = new SplitTreeRenderer({
    store: store as any,
    resizeCoordinator: {} as any,
    flowControl: {} as any,
    postMessage: vi.fn(),
    onTabBarUpdate: vi.fn(),
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
  return { store, renderer, factory };
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
