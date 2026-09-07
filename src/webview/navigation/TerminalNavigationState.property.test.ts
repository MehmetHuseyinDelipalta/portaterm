import { describe, expect, it } from "vitest";
import { createBranch, createLeaf, getAllSessionIds, type SplitNode } from "../SplitModel";
import {
  MAIN_TERMINAL_OWNER,
  normalizeTerminalNavigationState,
  type TerminalNavigationCatalog,
  type TerminalNavigationState,
  type TerminalOwner,
} from "./TerminalNavigationState";

function rng(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value;
  };
}

function ownerEqual(left: TerminalOwner, right: TerminalOwner): boolean {
  return left.kind === right.kind && (left.kind === "main" || (right.kind === "linked" && left.id === right.id));
}

function independentlyValid(catalog: TerminalNavigationCatalog, state: TerminalNavigationState): boolean {
  for (const [tabId, paneId] of Object.entries(state.activePaneByTab)) {
    const layout = catalog.tabLayouts.get(tabId);
    if (!layout || !getAllSessionIds(layout).includes(paneId) || !catalog.ownerByPaneId.has(paneId)) {
      return false;
    }
  }
  if (state.activeTabId === null) {
    return true;
  }
  const paneId = state.activePaneByTab[state.activeTabId];
  const paneOwner = paneId ? catalog.ownerByPaneId.get(paneId) : undefined;
  return paneOwner !== undefined && ownerEqual(paneOwner, state.activeOwner);
}

function generatedCase(seed: number): {
  catalog: TerminalNavigationCatalog;
  candidate: TerminalNavigationState;
} {
  const next = rng(seed);
  const linkedOwners: TerminalOwner[] = [
    { kind: "linked", id: "/wt/a" },
    { kind: "linked", id: "/wt/b" },
  ];
  const owners = [MAIN_TERMINAL_OWNER, ...linkedOwners];
  const ownerByPaneId = new Map<string, TerminalOwner>();
  const tabLayouts = new Map<string, SplitNode>();
  const tabCount = next() % 7;

  for (let tabIndex = 0; tabIndex < tabCount; tabIndex++) {
    const tabId = `tab-${tabIndex}`;
    const first = `${tabId}-pane-0`;
    ownerByPaneId.set(first, owners[next() % owners.length]);
    let layout: SplitNode = createLeaf(first);
    const paneCount = 1 + (next() % 3);
    for (let paneIndex = 1; paneIndex < paneCount; paneIndex++) {
      const paneId = `${tabId}-pane-${paneIndex}`;
      ownerByPaneId.set(paneId, ownerByPaneId.get(first)!);
      layout = createBranch(next() % 2 === 0 ? "horizontal" : "vertical", layout, createLeaf(paneId));
    }
    if (next() % 5 === 0) {
      ownerByPaneId.delete(first);
    }
    tabLayouts.set(tabId, layout);
  }

  const tabChoice = next() % (tabCount + 2);
  const activeTabId = tabChoice < tabCount ? `tab-${tabChoice}` : tabChoice === tabCount ? null : "stale-tab";
  const activePaneByTab: Record<string, string> = {};
  for (let tabIndex = 0; tabIndex < tabCount; tabIndex++) {
    if (next() % 2 === 0) {
      activePaneByTab[`tab-${tabIndex}`] = next() % 3 === 0 ? "stale-pane" : `tab-${tabIndex}-pane-${next() % 3}`;
    }
  }
  if (next() % 4 === 0) {
    activePaneByTab["stale-tab"] = "stale-pane";
  }

  return {
    catalog: { ownerByPaneId, tabLayouts },
    candidate: {
      activeOwner: owners[next() % owners.length],
      activeTabId,
      activePaneByTab,
    },
  };
}

describe("TerminalNavigationState properties", () => {
  it("normalization always produces independently live references", () => {
    for (let seed = 0; seed < 500; seed++) {
      const { catalog, candidate } = generatedCase(seed);
      const normalized = normalizeTerminalNavigationState(catalog, candidate);
      expect(independentlyValid(catalog, normalized), `seed ${seed}`).toBe(true);
    }
  });

  it("normalization is deterministic and idempotent", () => {
    for (let seed = 500; seed < 1000; seed++) {
      const { catalog, candidate } = generatedCase(seed);
      const first = normalizeTerminalNavigationState(catalog, candidate);
      const repeated = normalizeTerminalNavigationState(catalog, candidate);
      expect(repeated, `determinism seed ${seed}`).toEqual(first);
      expect(normalizeTerminalNavigationState(catalog, first), `idempotence seed ${seed}`).toEqual(first);
    }
  });
});
