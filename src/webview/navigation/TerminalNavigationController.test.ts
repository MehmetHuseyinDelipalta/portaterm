import { describe, expect, it } from "vitest";
import { createLeaf } from "../SplitModel";
import { TerminalNavigationController, type TerminalNavigationEffects } from "./TerminalNavigationController";
import {
  focusNavigationPane,
  MAIN_TERMINAL_OWNER,
  type TerminalNavigationCatalog,
  type TerminalNavigationState,
} from "./TerminalNavigationState";

function fixture() {
  const ownerByPaneId = new Map([["main", MAIN_TERMINAL_OWNER]]);
  const tabLayouts = new Map([["main", createLeaf("main")]]);
  const catalog: TerminalNavigationCatalog = { ownerByPaneId, tabLayouts };
  const initial: TerminalNavigationState = {
    activeOwner: MAIN_TERMINAL_OWNER,
    activeTabId: null,
    activePaneByTab: {},
  };
  const log: string[] = [];
  const delayed: Array<() => void> = [];
  const effects: TerminalNavigationEffects = {
    renderProjections: (state) => log.push(`render:${state.activeTabId}`),
    displayActive: (state) => log.push(`display:${state.activeTabId}`),
    updateSplitVisual: (state) => log.push(`visual:${state.activeTabId}`),
    focusActivePane: (paneId) => log.push(`focus:${paneId}`),
    syncVault: (paneId) => log.push(`vault:${paneId}`),
    persistCheckpoint: (checkpoint) => log.push(`persist:${checkpoint.activeTabId}`),
    emitHostEcho: (tabId, paneId) => log.push(`echo:${tabId}:${paneId}`),
    scheduleDelayed: (run) => delayed.push(run),
    runDelayedFocusAndFit: (state) => log.push(`delayed:${state.activeTabId}`),
  };
  return { ownerByPaneId, tabLayouts, catalog, initial, log, delayed, effects };
}

describe("TerminalNavigationController", () => {
  it("commits before one ordered effect batch", () => {
    const f = fixture();
    let controller!: TerminalNavigationController;
    f.effects.renderProjections = (state) => {
      expect(controller.getState()).toEqual(state);
      f.log.push(`render:${state.activeTabId}`);
    };
    controller = new TerminalNavigationController(f.initial, {
      readCatalog: () => f.catalog,
      effects: f.effects,
    });

    expect(controller.dispatch((catalog, state) => focusNavigationPane(catalog, state, "main"))).toBe("committed");
    expect(f.log).toEqual([
      "render:main",
      "display:main",
      "visual:main",
      "focus:main",
      "vault:main",
      "persist:main",
      "echo:main:main",
    ]);
  });

  it("runs no effects for a structural no-op", () => {
    const f = fixture();
    const active = focusNavigationPane(f.catalog, f.initial, "main");
    const controller = new TerminalNavigationController(active, {
      readCatalog: () => f.catalog,
      effects: f.effects,
    });

    expect(
      controller.dispatch((_catalog, state) => ({ ...state, activePaneByTab: { ...state.activePaneByTab } })),
    ).toBe("noop");
    expect(f.log).toEqual([]);
    expect(f.delayed).toEqual([]);
  });

  it("queues an intent raised by an effect until the first batch finishes", () => {
    const f = fixture();
    f.ownerByPaneId.set("other", MAIN_TERMINAL_OWNER);
    f.tabLayouts.set("other", createLeaf("other"));
    let controller!: TerminalNavigationController;
    f.effects.renderProjections = (state) => {
      f.log.push(`render:${state.activeTabId}`);
      if (state.activeTabId === "main") {
        expect(controller.dispatch((catalog, current) => focusNavigationPane(catalog, current, "other"))).toBe(
          "queued",
        );
      }
    };
    controller = new TerminalNavigationController(f.initial, {
      readCatalog: () => f.catalog,
      effects: f.effects,
    });

    controller.dispatch((catalog, state) => focusNavigationPane(catalog, state, "main"));

    expect(f.log.indexOf("echo:main:main")).toBeLessThan(f.log.indexOf("render:other"));
    expect(controller.getState().activeTabId).toBe("other");
  });

  it("reads catalog facts after the transaction mutation and before effects", () => {
    const f = fixture();
    const controller = new TerminalNavigationController(f.initial, {
      readCatalog: () => f.catalog,
      effects: f.effects,
    });

    controller.transaction(
      () => {
        f.ownerByPaneId.set("created", MAIN_TERMINAL_OWNER);
        f.tabLayouts.set("created", createLeaf("created"));
      },
      (catalog, state) => focusNavigationPane(catalog, state, "created"),
    );

    expect(controller.getState().activeTabId).toBe("created");
    expect(f.log[0]).toBe("render:created");
  });

  it("cancels a delayed focus and fit effect after a newer commit", () => {
    const f = fixture();
    f.ownerByPaneId.set("other", MAIN_TERMINAL_OWNER);
    f.tabLayouts.set("other", createLeaf("other"));
    const controller = new TerminalNavigationController(f.initial, {
      readCatalog: () => f.catalog,
      effects: f.effects,
    });

    controller.dispatch((catalog, state) => focusNavigationPane(catalog, state, "main"));
    controller.dispatch((catalog, state) => focusNavigationPane(catalog, state, "other"));
    expect(f.delayed).toHaveLength(2);

    f.delayed[0]();
    f.delayed[1]();
    expect(f.log.filter((entry) => entry.startsWith("delayed:"))).toEqual(["delayed:other"]);
  });

  it("keeps queue and delayed generations isolated per controller", () => {
    const left = fixture();
    const right = fixture();
    const leftController = new TerminalNavigationController(left.initial, {
      readCatalog: () => left.catalog,
      effects: left.effects,
    });
    const rightController = new TerminalNavigationController(right.initial, {
      readCatalog: () => right.catalog,
      effects: right.effects,
    });

    leftController.dispatch((catalog, state) => focusNavigationPane(catalog, state, "main"));
    rightController.dispatch((catalog, state) => focusNavigationPane(catalog, state, "main"));
    leftController.dispatch((_catalog, state) => ({ ...state, activeTabId: null }));

    left.delayed[0]();
    right.delayed[0]();
    expect(left.log).not.toContain("delayed:main");
    expect(right.log).toContain("delayed:main");
  });
});
