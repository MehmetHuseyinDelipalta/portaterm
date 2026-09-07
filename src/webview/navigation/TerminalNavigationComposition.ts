import type { SplitNode } from "../SplitModel";
import {
  decodeTerminalOwner,
  type TerminalNavigationCatalog,
  type TerminalNavigationState,
  type TerminalOwner,
} from "./TerminalNavigationState";

export interface TerminalNavigationStoreProjection {
  readonly terminals: ReadonlyMap<string, { worktreeId?: string }>;
  readonly tabLayouts: ReadonlyMap<string, SplitNode>;
  activeTabId: string | null;
  readonly tabActivePaneIds: Map<string, string>;
}

export function navigationCatalogFromStore(store: TerminalNavigationStoreProjection): TerminalNavigationCatalog {
  return {
    ownerByPaneId: new Map(
      Array.from(store.terminals, ([paneId, terminal]) => [paneId, decodeTerminalOwner(terminal.worktreeId)]),
    ),
    tabLayouts: store.tabLayouts,
  };
}

export function worktreeIdForTerminalOwner(owner: TerminalOwner): string | undefined {
  return owner.kind === "linked" ? owner.id : undefined;
}

export function applyTerminalNavigationProjection(
  state: TerminalNavigationState,
  deps: {
    store: TerminalNavigationStoreProjection;
    selectOwner(worktreeId?: string): void;
    render(): void;
  },
): void {
  deps.store.activeTabId = state.activeTabId;
  deps.store.tabActivePaneIds.clear();
  for (const [tabId, paneId] of Object.entries(state.activePaneByTab)) {
    deps.store.tabActivePaneIds.set(tabId, paneId);
  }
  deps.selectOwner(worktreeIdForTerminalOwner(state.activeOwner));
  deps.render();
}
