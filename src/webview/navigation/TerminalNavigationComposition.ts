import type { SplitPaneAttachmentResultMessage } from "../../types/messages";
import type { SplitNode } from "../SplitModel";
import type { TerminalNavigationController, TerminalNavigationTransition } from "./TerminalNavigationController";
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

export function rejectExpiredSplitRequest<T>(
  pending: Map<string, T>,
  requestId: string,
  postMessage: (message: SplitPaneAttachmentResultMessage) => void,
): boolean {
  if (!pending.delete(requestId)) {
    return false;
  }
  postMessage({ type: "splitPaneAttachmentResult", requestId, status: "rejected" });
  return true;
}

export function runRecoverableNavigationTransaction(
  controller: TerminalNavigationController,
  mutateCatalog: () => unknown,
  transition: TerminalNavigationTransition,
): boolean {
  try {
    controller.transaction(mutateCatalog, transition);
    return true;
  } catch {
    try {
      return controller.reconcileEffects();
    } catch {
      return false;
    }
  }
}

export function applyTerminalNavigationProjection(
  state: TerminalNavigationState,
  deps: {
    store: TerminalNavigationStoreProjection;
    render(): void;
  },
): void {
  deps.store.activeTabId = state.activeTabId;
  deps.store.tabActivePaneIds.clear();
  for (const [tabId, paneId] of Object.entries(state.activePaneByTab)) {
    deps.store.tabActivePaneIds.set(tabId, paneId);
  }
  deps.render();
}
