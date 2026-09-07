import { describe, expect, it, vi } from "vitest";
import { MAIN_TERMINAL_OWNER } from "../navigation/TerminalNavigationState";
import { WebviewStateStore } from "./WebviewStateStore";

function apiWith(initial: unknown = null) {
  let state = initial;
  return {
    getState: vi.fn(() => state),
    setState: vi.fn((next: unknown) => {
      state = next;
    }),
  };
}

describe("WebviewStateStore navigation checkpoint", () => {
  it("persists one V1 owner, tab, and pane checkpoint without dropping other state", () => {
    const api = apiWith({ vaultCollapsed: true });
    const store = new WebviewStateStore(api);

    store.persistNavigationCheckpoint({
      activeOwner: { kind: "linked", id: "/repo/wt-a" },
      activeTabId: "tab-a",
      activePaneByTab: { "tab-a": "pane-a" },
    });

    expect(store.getState()).toEqual({
      vaultCollapsed: true,
      terminalNavigation: {
        version: 1,
        activeOwner: { kind: "linked", id: "/repo/wt-a" },
        activeTabId: "tab-a",
        activePaneByTab: { "tab-a": "pane-a" },
      },
    });
  });

  it("round-trips an explicit owner-empty state", () => {
    const api = apiWith();
    const store = new WebviewStateStore(api);
    store.persistNavigationCheckpoint({
      activeOwner: { kind: "linked", id: "/repo/wt-a" },
      activeTabId: null,
      activePaneByTab: {},
    });

    expect(store.getNavigationCheckpoint()).toEqual({
      version: 1,
      activeOwner: { kind: "linked", id: "/repo/wt-a" },
      activeTabId: null,
      activePaneByTab: {},
    });
  });

  it("rejects malformed or unsupported persisted checkpoints", () => {
    const malformed = [
      { version: 2, activeOwner: MAIN_TERMINAL_OWNER, activeTabId: null, activePaneByTab: {} },
      { version: 1, activeOwner: { kind: "linked", id: "" }, activeTabId: null, activePaneByTab: {} },
      { version: 1, activeOwner: MAIN_TERMINAL_OWNER, activeTabId: 1, activePaneByTab: {} },
      { version: 1, activeOwner: MAIN_TERMINAL_OWNER, activeTabId: null, activePaneByTab: { tab: 1 } },
    ];

    for (const terminalNavigation of malformed) {
      const store = new WebviewStateStore(apiWith({ terminalNavigation }));
      expect(store.getNavigationCheckpoint()).toBeNull();
    }
  });

  it("keeps legacy scope accessible without treating it as a V1 checkpoint", () => {
    const store = new WebviewStateStore(apiWith({ worktreeScope: "/repo/wt-a" }));

    expect(store.getNavigationCheckpoint()).toBeNull();
    expect(store.getLegacyWorktreeScope()).toBe("/repo/wt-a");
  });

  it("ignores malformed legacy scope values", () => {
    const store = new WebviewStateStore(apiWith({ worktreeScope: 42 }));
    expect(store.getLegacyWorktreeScope()).toBeUndefined();
  });
});
