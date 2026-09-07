import type { TerminalOwner } from "./navigation/TerminalNavigationState";
import { getAllSessionIds } from "./SplitModel";
import type { TabBarDataSource, TabBarScope } from "./TabBarUtils";
import type { WorktreeTree } from "./worktree/worktreeViewTypes";

export interface EmptyOwnerProjection {
  owner: TerminalOwner;
  label: string;
}

export function labelsForWorktreeTree(tree: WorktreeTree | null): ReadonlyMap<string, string> | null {
  if (tree === null) {
    return null;
  }
  const labels = new Map<string, string>();
  for (const repo of tree.repos) {
    for (const worktree of repo.worktrees) {
      if (worktree.kind === "linked") {
        labels.set(worktree.id, worktree.branch ?? worktree.displayPath);
      }
    }
  }
  return labels;
}

export function ownerPresentsPane(owner: TerminalOwner, stableOwner?: string): boolean {
  return owner.kind === "main" ? stableOwner === undefined : stableOwner === owner.id;
}

export function tabBarScopeForOwner(owner: TerminalOwner, waiting?: ReadonlySet<string>): TabBarScope | undefined {
  if (owner.kind === "main") {
    return undefined;
  }
  return {
    worktreeId: owner.id,
    ...(waiting === undefined ? {} : { waiting }),
  };
}

export function labelForTerminalOwner(owner: TerminalOwner, labels: ReadonlyMap<string, string>): string {
  return owner.kind === "main" ? "Main" : (labels.get(owner.id) ?? owner.id);
}

function ownerHasPane(source: TabBarDataSource, owner: TerminalOwner): boolean {
  for (const layout of source.tabLayouts.values()) {
    for (const paneId of getAllSessionIds(layout)) {
      const terminal = source.terminals.get(paneId);
      if (terminal && ownerPresentsPane(owner, terminal.worktreeId)) {
        return true;
      }
    }
  }
  return false;
}

export function emptyOwnerProjection(
  source: TabBarDataSource,
  owner: TerminalOwner,
  labels: ReadonlyMap<string, string>,
): EmptyOwnerProjection | null {
  return ownerHasPane(source, owner) ? null : { owner, label: labelForTerminalOwner(owner, labels) };
}

export function tabBarProjectionSignature(
  source: TabBarDataSource,
  owner: TerminalOwner,
  ownerLabel: string | null,
  hiddenWaiting: number,
): string {
  const membership = [...source.tabLayouts].map(([tabId, layout]) => [
    tabId,
    getAllSessionIds(layout).map((paneId) => [paneId, source.terminals.get(paneId)?.worktreeId ?? null]),
  ]);
  return JSON.stringify([owner, ownerLabel, membership, hiddenWaiting]);
}
