import { describe, expect, it } from "vitest";
import { createLeaf } from "../SplitModel";
import { reconcileTerminalNavigationOwners, restoreTerminalNavigation } from "./TerminalNavigationRestore";
import {
  MAIN_TERMINAL_OWNER,
  type TerminalNavigationCatalog,
  type TerminalNavigationCheckpointV1,
} from "./TerminalNavigationState";

const linked = (id: string) => ({ kind: "linked" as const, id });

function catalog(owners: Record<string, ReturnType<typeof linked> | typeof MAIN_TERMINAL_OWNER>) {
  const tabLayouts = new Map<string, ReturnType<typeof createLeaf>>();
  for (const paneId of Object.keys(owners)) {
    tabLayouts.set(paneId, createLeaf(paneId));
  }
  return {
    ownerByPaneId: new Map(Object.entries(owners)),
    tabLayouts,
  } satisfies TerminalNavigationCatalog;
}

function checkpoint(
  activeOwner: ReturnType<typeof linked> | typeof MAIN_TERMINAL_OWNER,
  activeTabId: string | null,
  activePaneByTab: Record<string, string> = {},
): TerminalNavigationCheckpointV1 {
  return { version: 1, activeOwner, activeTabId, activePaneByTab };
}

describe("restoreTerminalNavigation", () => {
  it("lets a valid checkpoint outrank live host and legacy hints", () => {
    const facts = catalog({ main: MAIN_TERMINAL_OWNER, a: linked("/wt/a") });
    const result = restoreTerminalNavigation({
      catalog: facts,
      checkpoint: checkpoint(linked("/wt/a"), "a", { a: "a" }),
      hostHint: { activeTabId: "main", activePaneId: "main" },
      legacyWorktreeScope: "/wt/other",
      bootstrap: "live",
    });

    expect(result.state).toMatchObject({ activeOwner: linked("/wt/a"), activeTabId: "a" });
    expect(result.clearLegacyScope).toBe(true);
  });

  it("derives owner from a surviving tab and clamps a stale pane", () => {
    const facts = catalog({ a: linked("/wt/a") });
    const result = restoreTerminalNavigation({
      catalog: facts,
      checkpoint: checkpoint(MAIN_TERMINAL_OWNER, "a", { a: "gone" }),
      bootstrap: "cold",
    });

    expect(result.state).toEqual({
      activeOwner: linked("/wt/a"),
      activeTabId: "a",
      activePaneByTab: { a: "a" },
    });
  });

  it("replaces a stale tab within its owner and then falls back to main", () => {
    const facts = catalog({ main: MAIN_TERMINAL_OWNER, a: linked("/wt/a") });
    expect(
      restoreTerminalNavigation({
        catalog: facts,
        checkpoint: checkpoint(linked("/wt/a"), "gone"),
        bootstrap: "cold",
      }).state,
    ).toMatchObject({ activeOwner: linked("/wt/a"), activeTabId: "a" });

    expect(
      restoreTerminalNavigation({
        catalog: catalog({ main: MAIN_TERMINAL_OWNER }),
        checkpoint: checkpoint(linked("/wt/a"), "gone"),
        bootstrap: "cold",
      }).state,
    ).toMatchObject({ activeOwner: MAIN_TERMINAL_OWNER, activeTabId: "main" });
  });

  it("preserves an explicit linked owner-empty checkpoint without tree information", () => {
    const result = restoreTerminalNavigation({
      catalog: catalog({ a: linked("/wt/a") }),
      checkpoint: checkpoint(linked("/wt/a"), null),
      bootstrap: "cold",
    });

    expect(result.state).toMatchObject({ activeOwner: linked("/wt/a"), activeTabId: null });
  });

  it("uses a validated host echo only for a live bootstrap", () => {
    const facts = catalog({ main: MAIN_TERMINAL_OWNER, a: linked("/wt/a") });
    const live = restoreTerminalNavigation({
      catalog: facts,
      hostHint: { activeTabId: "a", activePaneId: "a" },
      legacyWorktreeScope: "/wt/other",
      bootstrap: "live",
    });
    expect(live.state).toMatchObject({ activeOwner: linked("/wt/a"), activeTabId: "a" });

    const cold = restoreTerminalNavigation({
      catalog: facts,
      hostHint: { activeTabId: "a", activePaneId: "a" },
      legacyWorktreeScope: "/wt/a",
      bootstrap: "cold",
    });
    expect(cold.state).toMatchObject({ activeOwner: MAIN_TERMINAL_OWNER, activeTabId: "main" });
    expect(cold.clearLegacyScope).toBe(true);
  });

  it("migrates a legacy linked scope only on a live bootstrap", () => {
    const result = restoreTerminalNavigation({
      catalog: catalog({ main: MAIN_TERMINAL_OWNER, a: linked("/wt/a") }),
      legacyWorktreeScope: "/wt/a",
      bootstrap: "live",
    });

    expect(result.state).toMatchObject({ activeOwner: linked("/wt/a"), activeTabId: "a" });
    expect(result.clearLegacyScope).toBe(true);
  });

  it("treats exited panes as displayable terminal facts", () => {
    const result = restoreTerminalNavigation({
      catalog: catalog({ exited: MAIN_TERMINAL_OWNER }),
      checkpoint: checkpoint(MAIN_TERMINAL_OWNER, "exited", { exited: "exited" }),
      bootstrap: "cold",
    });
    expect(result.state.activeTabId).toBe("exited");
  });

  it("falls back atomically after a complete tree removes the active owner", () => {
    const facts = catalog({ a: MAIN_TERMINAL_OWNER });
    const state = reconcileTerminalNavigationOwners(
      facts,
      {
        activeOwner: linked("/wt/a"),
        activeTabId: "a",
        activePaneByTab: { a: "a" },
      },
      new Set(),
    );
    expect(state).toEqual({ activeOwner: MAIN_TERMINAL_OWNER, activeTabId: "a", activePaneByTab: { a: "a" } });
  });

  it("does not infer owner disappearance from an absent tree", () => {
    const original = {
      activeOwner: linked("/wt/a"),
      activeTabId: null,
      activePaneByTab: {},
    };
    expect(reconcileTerminalNavigationOwners(catalog({}), original, null)).toBe(original);
  });
});
