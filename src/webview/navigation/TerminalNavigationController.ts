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
  mutateCatalog(): unknown;
  transition: TerminalNavigationTransition;
  catalogChanged: boolean;
}

interface PendingCommittedEffects {
  state: TerminalNavigationState;
  generation: number;
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
  private pendingEffects: PendingCommittedEffects | null = null;
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
    return this.enqueue({ mutateCatalog: () => {}, transition, catalogChanged: false });
  }

  transaction(
    mutateCatalog: () => unknown,
    transition: TerminalNavigationTransition,
  ): TerminalNavigationDispatchResult {
    return this.enqueue({ mutateCatalog, transition, catalogChanged: true });
  }

  reconcileEffects(): boolean {
    if (this.processing || this.pendingEffects === null) {
      return false;
    }
    this.drainPending();
    return true;
  }

  private enqueue(transaction: PendingTransaction): TerminalNavigationDispatchResult {
    if (this.processing) {
      this.pending.push(transaction);
      return "queued";
    }
    if (this.pendingEffects !== null || this.pending.length > 0) {
      this.drainPending();
    }
    this.pending.push(transaction);
    return this.drainPending();
  }

  private drainPending(): TerminalNavigationDispatchResult {
    this.processing = true;
    let firstResult: TerminalNavigationDispatchResult = "noop";
    let first = true;
    try {
      this.runPendingEffects();
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
    } finally {
      this.processing = false;
    }
  }

  private runTransaction(transaction: PendingTransaction): TerminalNavigationDispatchResult {
    const catalogChanged = transaction.catalogChanged && transaction.mutateCatalog() !== false;
    const catalog = this.deps.readCatalog();
    const next = transaction.transition(catalog, cloneState(this.state));
    if (!isTerminalNavigationStateValid(catalog, next)) {
      throw new Error("Terminal navigation transition produced invalid state");
    }
    if (statesEqual(this.state, next) && !catalogChanged) {
      return "noop";
    }

    this.state = cloneState(next);
    this.generation += 1;
    this.pendingEffects = {
      state: cloneState(this.state),
      generation: this.generation,
    };
    this.runPendingEffects();
    return "committed";
  }

  private runPendingEffects(): void {
    const pending = this.pendingEffects;
    if (pending === null) {
      return;
    }
    const committed = cloneState(pending.state);
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
      const generation = pending.generation;
      this.deps.effects.scheduleDelayed(() => {
        if (this.generation === generation) {
          this.deps.effects.runDelayedFocusAndFit?.(cloneState(committed));
        }
      });
    }
    this.pendingEffects = null;
  }
}
