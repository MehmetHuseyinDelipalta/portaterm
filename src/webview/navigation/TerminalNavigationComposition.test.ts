import { describe, expect, it } from "vitest";
import { createLeaf } from "../SplitModel";
import {
  applyTerminalNavigationProjection,
  navigationCatalogFromStore,
  rejectExpiredSplitRequest,
  runRecoverableNavigationTransaction,
  worktreeIdForTerminalOwner,
} from "./TerminalNavigationComposition";
import { TerminalNavigationController, type TerminalNavigationEffects } from "./TerminalNavigationController";
import {
  focusNavigationPane,
  MAIN_TERMINAL_OWNER,
  selectNavigationOwner,
  type TerminalNavigationState,
} from "./TerminalNavigationState";

function storeFixture() {
  return {
    terminals: new Map<string, { worktreeId?: string }>(),
    tabLayouts: new Map<string, ReturnType<typeof createLeaf>>(),
    activeTabId: null as string | null,
    tabActivePaneIds: new Map<string, string>(),
  };
}

function noEffects(overrides: Partial<TerminalNavigationEffects> = {}): TerminalNavigationEffects {
  return {
    renderProjections: () => {},
    displayActive: () => {},
    updateSplitVisual: () => {},
    focusActivePane: () => {},
    syncVault: () => {},
    persistCheckpoint: () => {},
    emitHostEcho: () => {},
    ...overrides,
  };
}

describe("terminal navigation composition", () => {
  it("projects committed tab and pane facts without an owner callback", () => {
    const store = storeFixture();
    store.terminals.set("a", { worktreeId: "/wt/a" });
    store.tabLayouts.set("a", createLeaf("a"));
    let rendered = false;

    applyTerminalNavigationProjection(
      {
        activeOwner: { kind: "linked", id: "/wt/a" },
        activeTabId: "a",
        activePaneByTab: { a: "a" },
      },
      {
        store,
        render: () => {
          rendered = store.activeTabId === "a" && store.tabActivePaneIds.get("a") === "a";
        },
      },
    );

    expect(rendered).toBe(true);
  });

  it("registers a created terminal before projecting only that terminal", () => {
    const store = storeFixture();
    store.terminals.set("old", { worktreeId: "/wt/a" });
    store.tabLayouts.set("old", createLeaf("old"));
    const projected: Array<string | null> = [];
    const initial: TerminalNavigationState = {
      activeOwner: { kind: "linked", id: "/wt/a" },
      activeTabId: "old",
      activePaneByTab: { old: "old" },
    };
    const controller = new TerminalNavigationController(initial, {
      readCatalog: () => navigationCatalogFromStore(store),
      effects: noEffects({
        renderProjections: (state) => {
          applyTerminalNavigationProjection(state, { store, render: () => {} });
          projected.push(store.activeTabId);
        },
      }),
    });

    controller.transaction(
      () => {
        store.terminals.set("created", { worktreeId: "/wt/a" });
        store.tabLayouts.set("created", createLeaf("created"));
      },
      (catalog, state) => focusNavigationPane(catalog, state, "created"),
    );

    expect(projected).toEqual(["created"]);
  });

  it("turns synchronous focusin re-entry into a queued no-op", () => {
    const store = storeFixture();
    store.terminals.set("main", {});
    store.tabLayouts.set("main", createLeaf("main"));
    let renders = 0;
    let controller!: TerminalNavigationController;
    controller = new TerminalNavigationController(
      { activeOwner: MAIN_TERMINAL_OWNER, activeTabId: null, activePaneByTab: {} },
      {
        readCatalog: () => navigationCatalogFromStore(store),
        effects: noEffects({
          renderProjections: (state) => {
            renders += 1;
            applyTerminalNavigationProjection(state, { store, render: () => {} });
          },
          focusActivePane: (paneId) => {
            if (paneId) {
              controller.dispatch((catalog, state) => focusNavigationPane(catalog, state, paneId));
            }
          },
        }),
      },
    );

    controller.dispatch((catalog, state) => focusNavigationPane(catalog, state, "main"));
    expect(renders).toBe(1);
  });

  it("rejects a split explicitly when the webview request deadline expires", () => {
    const pending = new Map([["split-1", { sourcePaneId: "source" }]]);
    const messages: unknown[] = [];

    expect(rejectExpiredSplitRequest(pending, "split-1", (message) => messages.push(message))).toBe(true);
    expect(pending.has("split-1")).toBe(false);
    expect(messages).toEqual([{ type: "splitPaneAttachmentResult", requestId: "split-1", status: "rejected" }]);
    expect(rejectExpiredSplitRequest(pending, "split-1", (message) => messages.push(message))).toBe(false);
    expect(messages).toHaveLength(1);
  });

  it("recovers an attached split when a required commit effect throws", () => {
    const store = storeFixture();
    store.terminals.set("source", {});
    store.tabLayouts.set("source", createLeaf("source"));
    const effects: string[] = [];
    let failPersist = true;
    const controller = new TerminalNavigationController(
      { activeOwner: MAIN_TERMINAL_OWNER, activeTabId: "source", activePaneByTab: { source: "source" } },
      {
        readCatalog: () => navigationCatalogFromStore(store),
        effects: noEffects({
          renderProjections: () => effects.push("render"),
          persistCheckpoint: () => {
            effects.push("persist");
            if (failPersist) {
              failPersist = false;
              throw new Error("transient persistence failure");
            }
          },
          emitHostEcho: () => effects.push("echo"),
        }),
      },
    );
    let attached = false;
    const acknowledgements: string[] = [];

    const effectsComplete = runRecoverableNavigationTransaction(
      controller,
      () => {
        store.terminals.set("child", {});
        store.tabLayouts.set("source", createLeaf("child"));
        attached = true;
        return true;
      },
      (catalog, state) => focusNavigationPane(catalog, state, "child"),
    );
    if (attached && effectsComplete) {
      acknowledgements.push("attached");
    }

    expect(acknowledgements).toEqual(["attached"]);
    expect(effects).toEqual(["render", "persist", "render", "persist", "echo"]);
  });

  it("does not acknowledge attachment while committed effects remain failed", () => {
    const store = storeFixture();
    store.terminals.set("source", {});
    store.tabLayouts.set("source", createLeaf("source"));
    const controller = new TerminalNavigationController(
      { activeOwner: MAIN_TERMINAL_OWNER, activeTabId: "source", activePaneByTab: { source: "source" } },
      {
        readCatalog: () => navigationCatalogFromStore(store),
        effects: noEffects({
          persistCheckpoint: () => {
            throw new Error("persistent failure");
          },
        }),
      },
    );
    let attached = false;

    const effectsComplete = runRecoverableNavigationTransaction(
      controller,
      () => {
        store.terminals.set("child", {});
        store.tabLayouts.set("source", createLeaf("child"));
        attached = true;
        return true;
      },
      (catalog, state) => focusNavigationPane(catalog, state, "child"),
    );

    expect(attached).toBe(true);
    expect(effectsComplete).toBe(false);
  });

  it("retains the active linked owner when its last tab requests replacement", () => {
    const store = storeFixture();
    store.terminals.set("a", { worktreeId: "/wt/a" });
    store.tabLayouts.set("a", createLeaf("a"));
    const initial: TerminalNavigationState = {
      activeOwner: { kind: "linked", id: "/wt/a" },
      activeTabId: "a",
      activePaneByTab: { a: "a" },
    };
    const controller = new TerminalNavigationController(initial, {
      readCatalog: () => navigationCatalogFromStore(store),
      effects: noEffects(),
    });

    controller.transaction(
      () => {
        store.terminals.delete("a");
        store.tabLayouts.delete("a");
      },
      (catalog, state) => selectNavigationOwner(catalog, state, state.activeOwner),
    );

    expect(controller.getState()).toMatchObject({
      activeOwner: { kind: "linked", id: "/wt/a" },
      activeTabId: null,
    });
    expect(worktreeIdForTerminalOwner(controller.getState().activeOwner)).toBe("/wt/a");
  });
});
