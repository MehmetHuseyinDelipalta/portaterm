import { describe, expect, it } from "vitest";
import { createBranch, createLeaf } from "../SplitModel";
import {
  decodeTerminalNavigationCheckpoint,
  decodeTerminalOwner,
  focusNavigationPane,
  isTerminalNavigationStateValid,
  MAIN_TERMINAL_OWNER,
  normalizeTerminalNavigationState,
  selectNavigationOwner,
  selectNavigationTab,
  type TerminalNavigationCatalog,
  type TerminalNavigationState,
} from "./TerminalNavigationState";

const linked = (id: string) => ({ kind: "linked" as const, id });

function catalog(
  owners: Record<string, ReturnType<typeof linked> | typeof MAIN_TERMINAL_OWNER>,
  tabs: Record<string, ReturnType<typeof createLeaf> | ReturnType<typeof createBranch>>,
): TerminalNavigationCatalog {
  return {
    ownerByPaneId: new Map(Object.entries(owners)),
    tabLayouts: new Map(Object.entries(tabs)),
  };
}

describe("TerminalNavigationState", () => {
  it("decodes optional worktree ownership into a total owner", () => {
    expect(decodeTerminalOwner(undefined)).toEqual({ kind: "main" });
    expect(decodeTerminalOwner("/repo/wt-a")).toEqual(linked("/repo/wt-a"));
  });

  it("accepts only the versioned checkpoint shape", () => {
    expect(
      decodeTerminalNavigationCheckpoint({
        version: 1,
        activeOwner: linked("/repo/wt-a"),
        activeTabId: null,
        activePaneByTab: {},
      }),
    ).toEqual({
      version: 1,
      activeOwner: linked("/repo/wt-a"),
      activeTabId: null,
      activePaneByTab: {},
    });
    expect(decodeTerminalNavigationCheckpoint({ version: 2 })).toBeNull();
    expect(
      decodeTerminalNavigationCheckpoint({
        version: 1,
        activeOwner: { kind: "linked", id: "" },
        activeTabId: null,
        activePaneByTab: {},
      }),
    ).toBeNull();
    expect(
      decodeTerminalNavigationCheckpoint({
        version: 1,
        activeOwner: MAIN_TERMINAL_OWNER,
        activeTabId: null,
        activePaneByTab: { tab: 42 },
      }),
    ).toBeNull();
  });

  it("derives owner from a surviving active tab and clamps its stale pane", () => {
    const wt = linked("/repo/wt-a");
    const facts = catalog(
      { main: MAIN_TERMINAL_OWNER, a1: wt, a2: wt },
      {
        main: createLeaf("main"),
        a: createBranch("vertical", createLeaf("a1"), createLeaf("a2")),
      },
    );
    const candidate: TerminalNavigationState = {
      activeOwner: MAIN_TERMINAL_OWNER,
      activeTabId: "a",
      activePaneByTab: { a: "gone" },
    };

    expect(normalizeTerminalNavigationState(facts, candidate)).toEqual({
      activeOwner: wt,
      activeTabId: "a",
      activePaneByTab: { main: "main", a: "a1" },
    });
  });

  it("replaces a stale tab within the saved owner before falling back to main", () => {
    const wt = linked("/repo/wt-a");
    const facts = catalog({ main: MAIN_TERMINAL_OWNER, a1: wt }, { main: createLeaf("main"), a: createLeaf("a1") });

    expect(
      normalizeTerminalNavigationState(facts, {
        activeOwner: wt,
        activeTabId: "gone",
        activePaneByTab: {},
      }),
    ).toMatchObject({ activeOwner: wt, activeTabId: "a" });

    expect(
      normalizeTerminalNavigationState(catalog({ main: MAIN_TERMINAL_OWNER }, { main: createLeaf("main") }), {
        activeOwner: wt,
        activeTabId: "gone",
        activePaneByTab: {},
      }),
    ).toMatchObject({ activeOwner: MAIN_TERMINAL_OWNER, activeTabId: "main" });
  });

  it("preserves an explicit owner-empty checkpoint", () => {
    const wt = linked("/repo/wt-a");
    const facts = catalog({ a1: wt }, { a: createLeaf("a1") });

    expect(
      normalizeTerminalNavigationState(
        facts,
        { activeOwner: wt, activeTabId: null, activePaneByTab: {} },
        { preserveExplicitEmpty: true },
      ),
    ).toEqual({ activeOwner: wt, activeTabId: null, activePaneByTab: { a: "a1" } });
  });

  it("selects owner, tab, and exact pane through pure transitions", () => {
    const wt = linked("/repo/wt-a");
    const facts = catalog(
      { main: MAIN_TERMINAL_OWNER, a1: wt, a2: wt },
      {
        main: createLeaf("main"),
        a: createBranch("horizontal", createLeaf("a1"), createLeaf("a2")),
      },
    );
    const initial: TerminalNavigationState = {
      activeOwner: MAIN_TERMINAL_OWNER,
      activeTabId: "main",
      activePaneByTab: { main: "main" },
    };

    const ownerSelected = selectNavigationOwner(facts, initial, wt);
    expect(ownerSelected).toMatchObject({ activeOwner: wt, activeTabId: "a" });

    const tabSelected = selectNavigationTab(facts, initial, "a");
    expect(tabSelected).toMatchObject({ activeOwner: wt, activeTabId: "a" });

    const paneFocused = focusNavigationPane(facts, initial, "a2");
    expect(paneFocused).toMatchObject({
      activeOwner: wt,
      activeTabId: "a",
      activePaneByTab: { main: "main", a: "a2" },
    });
    expect(isTerminalNavigationStateValid(facts, paneFocused)).toBe(true);
  });

  it("ignores transitions that target absent tabs or panes", () => {
    const facts = catalog({ main: MAIN_TERMINAL_OWNER }, { main: createLeaf("main") });
    const initial: TerminalNavigationState = {
      activeOwner: MAIN_TERMINAL_OWNER,
      activeTabId: "main",
      activePaneByTab: { main: "main" },
    };

    expect(selectNavigationTab(facts, initial, "gone")).toBe(initial);
    expect(focusNavigationPane(facts, initial, "gone")).toBe(initial);
  });
});
