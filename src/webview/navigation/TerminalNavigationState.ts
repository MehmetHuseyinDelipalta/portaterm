import type { SplitNode } from "../SplitModel";
import { getAllSessionIds, tabOwningPane } from "../SplitModel";

export type TerminalOwner = { kind: "main" } | { kind: "linked"; id: string };

export interface TerminalNavigationState {
  activeOwner: TerminalOwner;
  activeTabId: string | null;
  activePaneByTab: Record<string, string>;
}

export interface TerminalNavigationCheckpointV1 extends TerminalNavigationState {
  version: 1;
}

export interface TerminalNavigationCatalog {
  ownerByPaneId: ReadonlyMap<string, TerminalOwner>;
  tabLayouts: ReadonlyMap<string, SplitNode>;
}

export const MAIN_TERMINAL_OWNER: TerminalOwner = Object.freeze({ kind: "main" });

export function decodeTerminalOwner(worktreeId?: string): TerminalOwner {
  return typeof worktreeId === "string" && worktreeId.length > 0
    ? { kind: "linked", id: worktreeId }
    : MAIN_TERMINAL_OWNER;
}

export function terminalOwnersEqual(left: TerminalOwner, right: TerminalOwner): boolean {
  return left.kind === right.kind && (left.kind === "main" || (right.kind === "linked" && left.id === right.id));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeOwner(value: unknown): TerminalOwner | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.kind === "main") {
    return MAIN_TERMINAL_OWNER;
  }
  return value.kind === "linked" && typeof value.id === "string" && value.id.length > 0
    ? { kind: "linked", id: value.id }
    : null;
}

export function decodeTerminalNavigationCheckpoint(value: unknown): TerminalNavigationCheckpointV1 | null {
  if (!isRecord(value) || value.version !== 1) {
    return null;
  }
  const activeOwner = decodeOwner(value.activeOwner);
  if (
    activeOwner === null ||
    (value.activeTabId !== null && typeof value.activeTabId !== "string") ||
    !isRecord(value.activePaneByTab)
  ) {
    return null;
  }
  const activePaneByTab: Record<string, string> = {};
  for (const [tabId, paneId] of Object.entries(value.activePaneByTab)) {
    if (typeof paneId !== "string") {
      return null;
    }
    activePaneByTab[tabId] = paneId;
  }
  return {
    version: 1,
    activeOwner,
    activeTabId: value.activeTabId,
    activePaneByTab,
  };
}

export function toTerminalNavigationCheckpoint(state: TerminalNavigationState): TerminalNavigationCheckpointV1 {
  return {
    version: 1,
    activeOwner: state.activeOwner,
    activeTabId: state.activeTabId,
    activePaneByTab: { ...state.activePaneByTab },
  };
}

export function livePaneIdsForTab(catalog: TerminalNavigationCatalog, tabId: string): string[] {
  const layout = catalog.tabLayouts.get(tabId);
  if (!layout) {
    return [];
  }
  return getAllSessionIds(layout).filter((paneId) => catalog.ownerByPaneId.has(paneId));
}

export function tabContainingPane(catalog: TerminalNavigationCatalog, paneId: string): string | null {
  if (!catalog.ownerByPaneId.has(paneId)) {
    return null;
  }
  return tabOwningPane(catalog.tabLayouts, paneId);
}

function sanitizePaneSelections(
  catalog: TerminalNavigationCatalog,
  selections: Readonly<Record<string, string>>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [tabId] of catalog.tabLayouts) {
    const panes = livePaneIdsForTab(catalog, tabId);
    if (panes.length === 0) {
      continue;
    }
    const selected = selections[tabId];
    result[tabId] = selected !== undefined && panes.includes(selected) ? selected : panes[0];
  }
  return result;
}

function firstSelectionForOwner(
  catalog: TerminalNavigationCatalog,
  activePaneByTab: Readonly<Record<string, string>>,
  owner: TerminalOwner,
): { tabId: string; paneId: string } | null {
  for (const [tabId] of catalog.tabLayouts) {
    const selected = activePaneByTab[tabId];
    if (selected) {
      const selectedOwner = catalog.ownerByPaneId.get(selected);
      if (selectedOwner && terminalOwnersEqual(selectedOwner, owner)) {
        return { tabId, paneId: selected };
      }
    }
    for (const paneId of livePaneIdsForTab(catalog, tabId)) {
      const paneOwner = catalog.ownerByPaneId.get(paneId);
      if (paneOwner && terminalOwnersEqual(paneOwner, owner)) {
        return { tabId, paneId };
      }
    }
  }
  return null;
}

export function normalizeTerminalNavigationState(
  catalog: TerminalNavigationCatalog,
  candidate: TerminalNavigationState,
  options: { preserveExplicitEmpty?: boolean } = {},
): TerminalNavigationState {
  const activePaneByTab = sanitizePaneSelections(catalog, candidate.activePaneByTab);

  if (candidate.activeTabId === null && options.preserveExplicitEmpty === true) {
    return {
      activeOwner: candidate.activeOwner,
      activeTabId: null,
      activePaneByTab,
    };
  }

  if (candidate.activeTabId !== null) {
    const paneId = activePaneByTab[candidate.activeTabId];
    const owner = paneId ? catalog.ownerByPaneId.get(paneId) : undefined;
    if (owner) {
      return {
        activeOwner: owner,
        activeTabId: candidate.activeTabId,
        activePaneByTab,
      };
    }
  }

  const retainedOwner = firstSelectionForOwner(catalog, activePaneByTab, candidate.activeOwner);
  if (retainedOwner) {
    activePaneByTab[retainedOwner.tabId] = retainedOwner.paneId;
    return {
      activeOwner: candidate.activeOwner,
      activeTabId: retainedOwner.tabId,
      activePaneByTab,
    };
  }

  const main = firstSelectionForOwner(catalog, activePaneByTab, MAIN_TERMINAL_OWNER);
  if (main) {
    activePaneByTab[main.tabId] = main.paneId;
    return {
      activeOwner: MAIN_TERMINAL_OWNER,
      activeTabId: main.tabId,
      activePaneByTab,
    };
  }

  return {
    activeOwner: MAIN_TERMINAL_OWNER,
    activeTabId: null,
    activePaneByTab,
  };
}

export function selectNavigationOwner(
  catalog: TerminalNavigationCatalog,
  current: TerminalNavigationState,
  owner: TerminalOwner,
): TerminalNavigationState {
  const activePaneByTab = sanitizePaneSelections(catalog, current.activePaneByTab);
  if (current.activeTabId !== null) {
    const paneId = activePaneByTab[current.activeTabId];
    const paneOwner = paneId ? catalog.ownerByPaneId.get(paneId) : undefined;
    if (paneOwner && terminalOwnersEqual(paneOwner, owner)) {
      return { activeOwner: owner, activeTabId: current.activeTabId, activePaneByTab };
    }
  }
  const selected = firstSelectionForOwner(catalog, activePaneByTab, owner);
  if (!selected) {
    return { activeOwner: owner, activeTabId: null, activePaneByTab };
  }
  activePaneByTab[selected.tabId] = selected.paneId;
  return { activeOwner: owner, activeTabId: selected.tabId, activePaneByTab };
}

export function selectNavigationTab(
  catalog: TerminalNavigationCatalog,
  current: TerminalNavigationState,
  tabId: string,
): TerminalNavigationState {
  const panes = livePaneIdsForTab(catalog, tabId);
  if (panes.length === 0) {
    return current;
  }
  const activePaneByTab = sanitizePaneSelections(catalog, current.activePaneByTab);
  const paneId = activePaneByTab[tabId] ?? panes[0];
  const activeOwner = catalog.ownerByPaneId.get(paneId);
  if (!activeOwner) {
    return current;
  }
  activePaneByTab[tabId] = paneId;
  return { activeOwner, activeTabId: tabId, activePaneByTab };
}

export function focusNavigationPane(
  catalog: TerminalNavigationCatalog,
  current: TerminalNavigationState,
  paneId: string,
): TerminalNavigationState {
  const activeOwner = catalog.ownerByPaneId.get(paneId);
  const activeTabId = tabContainingPane(catalog, paneId);
  if (!activeOwner || activeTabId === null) {
    return current;
  }
  const activePaneByTab = sanitizePaneSelections(catalog, current.activePaneByTab);
  activePaneByTab[activeTabId] = paneId;
  return { activeOwner, activeTabId, activePaneByTab };
}

export function isTerminalNavigationStateValid(
  catalog: TerminalNavigationCatalog,
  state: TerminalNavigationState,
): boolean {
  if (decodeOwner(state.activeOwner) === null) {
    return false;
  }
  for (const [tabId, paneId] of Object.entries(state.activePaneByTab)) {
    if (!livePaneIdsForTab(catalog, tabId).includes(paneId)) {
      return false;
    }
  }
  if (state.activeTabId === null) {
    return true;
  }
  const paneId = state.activePaneByTab[state.activeTabId];
  const owner = paneId ? catalog.ownerByPaneId.get(paneId) : undefined;
  return owner !== undefined && terminalOwnersEqual(owner, state.activeOwner);
}
