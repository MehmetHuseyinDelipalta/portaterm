// src/webview/split/restoreLayouts.ts — Which persisted split layouts survive
// an `init`.
//
// The webview persists every tab's split tree; the host's `init` names the
// sessions that are actually alive. The two disagree whenever a pane died while
// the webview was away. Two ways that went wrong:
//
// - A leaf whose session is gone was rendered anyway: an empty pane, holding
//   space, that nothing could ever write to.
// - A layout was kept only if its TAB id was a live session. A tab whose root
//   pane was closed lives on under the root's id with only its splits
//   (split/tabDisplay.ts), so the host no longer sends that id — and on reload
//   the layout was dropped, leaving the live split with no tab to show it.
//
// So a layout is judged by its leaves: dead ones are pruned, and the layout
// stays while any live leaf remains.

import { createBranch, createLeaf, getAllSessionIds, removeLeaf, type SplitNode } from "../SplitModel";

/** `layout` with every leaf not in `live` removed, or `null` when none is left. */
export function pruneDeadLeaves(layout: SplitNode, live: ReadonlySet<string>): SplitNode | null {
  let pruned: SplitNode | null = layout;
  for (const id of getAllSessionIds(layout)) {
    if (pruned === null) {
      break;
    }
    if (!live.has(id)) {
      pruned = removeLeaf(pruned, id);
    }
  }
  return pruned;
}

/**
 * The layouts to keep, each pruned to its live leaves, and an active pane per
 * kept tab that names one of them (falling back to its first live leaf).
 */
export function reconcileRestoredLayouts(
  restored: ReadonlyMap<string, SplitNode>,
  activePanes: ReadonlyMap<string, string>,
  live: ReadonlySet<string>,
): { layouts: Map<string, SplitNode>; activePanes: Map<string, string> } {
  const layouts = new Map<string, SplitNode>();
  const panes = new Map<string, string>();
  for (const [tabId, layout] of restored) {
    const pruned = pruneDeadLeaves(layout, live);
    if (pruned === null) {
      continue;
    }
    layouts.set(tabId, pruned);
    const leaves = getAllSessionIds(pruned);
    const active = activePanes.get(tabId);
    if (active !== undefined && leaves.includes(active)) {
      panes.set(tabId, active);
    } else if (active !== undefined || !leaves.includes(tabId)) {
      // A pruned pointer, or a tab whose own pane is gone and had none stored:
      // without one, input would be routed to the tab id — a dead pane.
      panes.set(tabId, leaves[0]);
    }
  }
  return { layouts, activePanes: panes };
}

/**
 * Put live split panes that no layout mentions back into their tab: appended
 * to the tab's layout when it has one, or as the tab's only leaf when it has
 * none (its root pane was closed, and the layout was lost). A pane with no
 * known tab is left out. Without this a live pane whose layout went missing
 * was a PTY no tab could show.
 */
export function adoptOrphanPanes(
  layouts: Map<string, SplitNode>,
  activePanes: Map<string, string>,
  splitPanes: ReadonlyArray<{ id: string; rootTabId?: string }>,
  /** Root tabs that are themselves live: a layout begun for one starts with its own pane. */
  liveRoots: ReadonlySet<string>,
): void {
  const placed = new Set<string>();
  for (const layout of layouts.values()) {
    for (const id of getAllSessionIds(layout)) {
      placed.add(id);
    }
  }
  for (const pane of splitPanes) {
    if (placed.has(pane.id) || pane.rootTabId === undefined) {
      continue;
    }
    // A live root with no layout yet would have its own leaf added later — but
    // only when no layout exists, so the layout begun here must include it.
    const existing =
      layouts.get(pane.rootTabId) ?? (liveRoots.has(pane.rootTabId) ? createLeaf(pane.rootTabId) : undefined);
    layouts.set(
      pane.rootTabId,
      existing ? createBranch("vertical", existing, createLeaf(pane.id)) : createLeaf(pane.id),
    );
    if (!existing && !activePanes.has(pane.rootTabId)) {
      // A tab made of this pane alone: input goes to it, not the gone root.
      activePanes.set(pane.rootTabId, pane.id);
    }
    placed.add(pane.id);
  }
}
