import {
  decodeTerminalNavigationCheckpoint,
  focusNavigationPane,
  MAIN_TERMINAL_OWNER,
  normalizeTerminalNavigationState,
  selectNavigationOwner,
  type TerminalNavigationCatalog,
  type TerminalNavigationState,
} from "./TerminalNavigationState";

export interface TerminalNavigationHostHint {
  activeTabId: string | null;
  activePaneId: string | null;
}

export interface TerminalNavigationRestoreResult {
  state: TerminalNavigationState;
  clearLegacyScope: boolean;
}

const emptyMain = (): TerminalNavigationState => ({
  activeOwner: MAIN_TERMINAL_OWNER,
  activeTabId: null,
  activePaneByTab: {},
});

export function restoreTerminalNavigation(input: {
  catalog: TerminalNavigationCatalog;
  checkpoint?: unknown;
  hostHint?: TerminalNavigationHostHint;
  legacyWorktreeScope?: string;
  bootstrap: "live" | "cold";
}): TerminalNavigationRestoreResult {
  const clearLegacyScope = input.legacyWorktreeScope !== undefined;
  const checkpoint = decodeTerminalNavigationCheckpoint(input.checkpoint);
  if (checkpoint) {
    return {
      state: normalizeTerminalNavigationState(input.catalog, checkpoint, {
        preserveExplicitEmpty: checkpoint.activeTabId === null,
      }),
      clearLegacyScope,
    };
  }

  if (input.bootstrap === "live" && input.hostHint) {
    const { activeTabId, activePaneId } = input.hostHint;
    if (activeTabId === null && activePaneId === null) {
      return {
        state: normalizeTerminalNavigationState(input.catalog, emptyMain(), {
          preserveExplicitEmpty: true,
        }),
        clearLegacyScope,
      };
    }
    if (typeof activeTabId === "string" && typeof activePaneId === "string") {
      const focused = focusNavigationPane(input.catalog, emptyMain(), activePaneId);
      if (focused.activeTabId === activeTabId && focused.activePaneByTab[activeTabId] === activePaneId) {
        return { state: focused, clearLegacyScope };
      }
    }
  }

  if (input.bootstrap === "live" && input.legacyWorktreeScope) {
    return {
      state: selectNavigationOwner(input.catalog, emptyMain(), {
        kind: "linked",
        id: input.legacyWorktreeScope,
      }),
      clearLegacyScope: true,
    };
  }

  return {
    state: normalizeTerminalNavigationState(input.catalog, emptyMain()),
    clearLegacyScope,
  };
}

export function reconcileTerminalNavigationOwners(
  catalog: TerminalNavigationCatalog,
  state: TerminalNavigationState,
  liveLinkedOwners: ReadonlySet<string> | null,
): TerminalNavigationState {
  if (liveLinkedOwners === null) {
    return state;
  }
  const ownerGone = state.activeOwner.kind === "linked" && !liveLinkedOwners.has(state.activeOwner.id);
  return normalizeTerminalNavigationState(catalog, ownerGone ? { ...state, activeOwner: MAIN_TERMINAL_OWNER } : state, {
    preserveExplicitEmpty: state.activeTabId === null && !ownerGone,
  });
}
