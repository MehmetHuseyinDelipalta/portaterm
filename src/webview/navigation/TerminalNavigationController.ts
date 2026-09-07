import {
  isTerminalNavigationStateValid,
  type TerminalNavigationCatalog,
  type TerminalNavigationCheckpointV1,
  type TerminalNavigationState,
  terminalOwnersEqual,
  toTerminalNavigationCheckpoint,
} from "./TerminalNavigationState";

export type TerminalNavigationTransition = (
  catalog: TerminalNavigationCatalog,
  current: TerminalNavigationState,
) => TerminalNavigationState;

export interface TerminalNavigationEffects {
  renderProjections(state: TerminalNavigationState): void;
  displayActive(state: TerminalNavigationState): void;
  updateSplitVisual(state: TerminalNavigationState): void;
  focusActivePane(paneId: string | null): void;
  syncVault(paneId: string | null): void;
  persistCheckpoint(checkpoint: TerminalNavigationCheckpointV1): void;
  emitHostEcho(activeTabId: string | null, activePaneId: string | null): void;
  scheduleDelayed?(run: () => void): void;
  runDelayedFocusAndFit?(state: TerminalNavigationState): void;
}

export interface TerminalNavigationControllerDeps {
  readCatalog(): TerminalNavigationCatalog;
  effects: TerminalNavigationEffects;
}

export type TerminalNavigationDispatchResult = "committed" | "noop" | "queued";

interface PendingTransaction {
  mutateCatalog(): void;
  transition: TerminalNavigationTransition;
}

function cloneState(state: TerminalNavigationState): TerminalNavigationState {
  return {
    activeOwner: state.activeOwner.kind === "main" ? { kind: "main" } : { kind: "linked", id: state.activeOwner.id },
    activeTabId: state.activeTabId,
    activePaneByTab: { ...state.activePaneByTab },
  };
}

function statesEqual(left: TerminalNavigationState, right: TerminalNavigationState): boolean {
  if (left.activeTabId !== right.activeTabId || !terminalOwnersEqual(left.activeOwner, right.activeOwner)) {
    return false;
  }
  const leftEntries = Object.entries(left.activePaneByTab);
  const rightEntries = Object.entries(right.activePaneByTab);
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }
  return leftEntries.every(([tabId, paneId]) => right.activePaneByTab[tabId] === paneId);
}

export class TerminalNavigationController {
  private state: TerminalNavigationState;
  private readonly pending: PendingTransaction[] = [];
  private processing = false;
  private generation = 0;

  constructor(
    initialState: TerminalNavigationState,
    private readonly deps: TerminalNavigationControllerDeps,
  ) {
    if (!isTerminalNavigationStateValid(deps.readCatalog(), initialState)) {
      throw new Error("Initial terminal navigation state is invalid");
    }
    this.state = cloneState(initialState);
  }

  getState(): TerminalNavigationState {
    return cloneState(this.state);
  }

  dispatch(transition: TerminalNavigationTransition): TerminalNavigationDispatchResult {
    return this.transaction(() => {}, transition);
  }

  transaction(mutateCatalog: () => void, transition: TerminalNavigationTransition): TerminalNavigationDispatchResult {
    this.pending.push({ mutateCatalog, transition });
    if (this.processing) {
      return "queued";
    }

    this.processing = true;
    let firstResult: TerminalNavigationDispatchResult = "noop";
    let first = true;
    try {
      while (this.pending.length > 0) {
        const next = this.pending.shift();
        if (!next) {
          break;
        }
        const result = this.runTransaction(next);
        if (first) {
          firstResult = result;
          first = false;
        }
      }
      return firstResult;
    } catch (error) {
      this.pending.length = 0;
      throw error;
    } finally {
      this.processing = false;
    }
  }

  private runTransaction(transaction: PendingTransaction): TerminalNavigationDispatchResult {
    transaction.mutateCatalog();
    const catalog = this.deps.readCatalog();
    const next = transaction.transition(catalog, cloneState(this.state));
    if (!isTerminalNavigationStateValid(catalog, next)) {
      throw new Error("Terminal navigation transition produced invalid state");
    }
    if (statesEqual(this.state, next)) {
      return "noop";
    }

    this.state = cloneState(next);
    this.generation += 1;
    const generation = this.generation;
    const committed = cloneState(this.state);
    const activePaneId =
      committed.activeTabId === null ? null : (committed.activePaneByTab[committed.activeTabId] ?? null);

    this.deps.effects.renderProjections(committed);
    this.deps.effects.displayActive(committed);
    this.deps.effects.updateSplitVisual(committed);
    this.deps.effects.focusActivePane(activePaneId);
    this.deps.effects.syncVault(activePaneId);
    this.deps.effects.persistCheckpoint(toTerminalNavigationCheckpoint(committed));
    this.deps.effects.emitHostEcho(committed.activeTabId, activePaneId);

    if (this.deps.effects.scheduleDelayed && this.deps.effects.runDelayedFocusAndFit) {
      this.deps.effects.scheduleDelayed(() => {
        if (this.generation === generation) {
          this.deps.effects.runDelayedFocusAndFit?.(cloneState(committed));
        }
      });
    }
    return "committed";
  }
}
