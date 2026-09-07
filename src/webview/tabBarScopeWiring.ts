import { MAIN_TERMINAL_OWNER, type TerminalOwner } from "./navigation/TerminalNavigationState";
import type { PaneReport } from "./paneAttribution";
import { buildTabBarData, type TabBarDataSource, type TabBarScope } from "./TabBarUtils";
import {
  emptyOwnerProjection,
  labelForTerminalOwner,
  labelsForWorktreeTree,
  tabBarProjectionSignature,
  tabBarScopeForOwner,
} from "./tabBarScope";
import type { WorktreeTree } from "./worktree/worktreeViewTypes";

export interface TabBarScopeWiringDeps {
  activeOwner(): TerminalOwner;
  selectOwner(owner: TerminalOwner): void;
  source(): TabBarDataSource;
  render(): void;
  revalidatePresence?: () => void;
  showEmptyScope(projection: { owner: TerminalOwner; label: string } | null): void;
}

export interface TabBarScopeWiring {
  onSelectWorktree(worktreeId: string | null): void;
  onAttribution(report: PaneReport): void;
  applyTree(tree: WorktreeTree | null, deliver: () => void): void;
  effectiveScope(): TabBarScope | undefined;
  needsPresence(): boolean;
  syncEmptyScope(): void;
  chip(hiddenWaiting?: number): { worktreeId: string; label: string; hiddenWaiting?: number } | undefined;
}

export function wireTabBarScope(deps: TabBarScopeWiringDeps): TabBarScopeWiring {
  let labels: ReadonlyMap<string, string> = new Map();
  let waiting: ReadonlySet<string> = new Set();
  let signature: string | null = null;
  let deliveringTree = false;
  let presenceNeeded = deps.activeOwner().kind === "linked";

  const ownerLabel = (): string | null => {
    const owner = deps.activeOwner();
    return owner.kind === "linked" ? labelForTerminalOwner(owner, labels) : null;
  };

  const effectiveScope = (): TabBarScope | undefined => tabBarScopeForOwner(deps.activeOwner(), waiting);

  const currentSignature = (): string => {
    const source = deps.source();
    const { hiddenWaiting } = buildTabBarData(source, effectiveScope());
    return tabBarProjectionSignature(source, deps.activeOwner(), ownerLabel(), hiddenWaiting);
  };

  const syncPresence = (): void => {
    const next = deps.activeOwner().kind === "linked";
    if (next !== presenceNeeded) {
      presenceNeeded = next;
      deps.revalidatePresence?.();
    }
  };

  const renderIfMoved = (): void => {
    const next = currentSignature();
    if (next === signature) {
      return;
    }
    deps.render();
    signature = currentSignature();
  };

  return {
    onSelectWorktree(worktreeId) {
      deps.selectOwner(worktreeId === null ? MAIN_TERMINAL_OWNER : { kind: "linked", id: worktreeId });
    },

    onAttribution(report) {
      waiting = report.waiting;
      if (!deliveringTree) {
        syncPresence();
        renderIfMoved();
      }
    },

    applyTree(tree, deliver) {
      const nextLabels = labelsForWorktreeTree(tree);
      if (nextLabels !== null) {
        labels = nextLabels;
      }
      deliveringTree = true;
      try {
        deliver();
      } finally {
        deliveringTree = false;
        syncPresence();
        renderIfMoved();
      }
    },

    effectiveScope,
    needsPresence: () => deps.activeOwner().kind === "linked",

    syncEmptyScope() {
      syncPresence();
      deps.showEmptyScope(emptyOwnerProjection(deps.source(), deps.activeOwner(), labels));
      signature = currentSignature();
    },

    chip(hiddenWaiting) {
      const owner = deps.activeOwner();
      if (owner.kind === "main") {
        return undefined;
      }
      return {
        worktreeId: owner.id,
        label: labelForTerminalOwner(owner, labels),
        ...(hiddenWaiting === undefined || hiddenWaiting === 0 ? {} : { hiddenWaiting }),
      };
    },
  };
}
