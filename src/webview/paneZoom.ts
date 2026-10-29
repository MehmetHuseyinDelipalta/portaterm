// src/webview/paneZoom.ts — Pane zoom: one pane of a split tab, temporarily full size.
//
// The tmux `resize-pane -Z` model. Zooming hides the tab's other panes and
// gives one pane the tab's whole area; unzooming brings the layout back exactly
// as it was. Nothing about the layout changes: the split tree, its ratios and
// the hidden panes' shells are untouched, so there is nothing to restore.
//
// A zoom holds only while it still describes what is on screen:
//   - the tab is split (a lone pane has nothing to zoom over),
//   - its panes are the ones it had when the zoom began (a split or a close
//     reshapes the layout the user is looking at, so the zoom ends — tmux
//     unzooms on the same events), and
//   - the zoomed pane is the tab's active pane (moving focus to a hidden pane
//     must show it, which is what ending the zoom does).
// Each query re-checks these, so a stale entry can never hide a pane; `prune`
// only forgets entries that no longer hold.
//
// Not persisted: a reload shows the full layout rather than a zoom the user may
// not remember leaving on.

import { getAllSessionIds, type SplitNode, tabOwningPane } from "./SplitModel";

/** The slice of the webview store this module reads. */
export interface PaneZoomStore {
  readonly tabLayouts: ReadonlyMap<string, SplitNode>;
  readonly tabActivePaneIds: ReadonlyMap<string, string>;
}

/** What `set` did, so the caller can redraw or tell the user why nothing happened. */
export type PaneZoomSetResult =
  | { kind: "changed"; tabId: string; paneId: string; zoomed: boolean }
  | { kind: "unchanged"; tabId: string; zoomed: boolean }
  | { kind: "unknown-pane" }
  | { kind: "single-pane"; tabId: string };

interface ZoomEntry {
  paneId: string;
  /** The tab's panes when the zoom began, in layout order. */
  panes: string;
}

export class PaneZoom {
  private readonly store: PaneZoomStore;
  private readonly zoomed = new Map<string, ZoomEntry>();

  constructor(store: PaneZoomStore) {
    this.store = store;
  }

  /** The pane `tabId` is zoomed to, or null when the tab shows its full layout. */
  zoomedPane(tabId: string): string | null {
    const entry = this.zoomed.get(tabId);
    const layout = this.store.tabLayouts.get(tabId);
    // A zoom is only recorded on a split tab, so a layout that fell back to one
    // pane — or lost or gained any pane — no longer matches its signature.
    if (!entry || !layout || paneSignature(layout) !== entry.panes) {
      return null;
    }
    const activePaneId = this.store.tabActivePaneIds.get(tabId) ?? tabId;
    return activePaneId === entry.paneId ? entry.paneId : null;
  }

  /** Every tab currently zoomed — for the tab bar's mark. */
  zoomedTabIds(): ReadonlySet<string> {
    return new Set([...this.zoomed.keys()].filter((tabId) => this.zoomedPane(tabId) !== null));
  }

  /**
   * Zoom `paneSessionId` (true), unzoom its tab (false), or toggle (omitted).
   * Zooming records the pane; it shows once that pane is the tab's active one,
   * so the caller focuses it first. Zooming a single-pane tab is refused rather
   * than recorded, so a later split never opens already zoomed.
   */
  set(paneSessionId: string, zoomed?: boolean): PaneZoomSetResult {
    const tabId = tabOwningPane(this.store.tabLayouts, paneSessionId);
    if (!tabId) {
      return { kind: "unknown-pane" };
    }
    const current = this.zoomedPane(tabId);
    const next = zoomed ?? current === null;
    if (!next) {
      if (current === null) {
        return { kind: "unchanged", tabId, zoomed: false };
      }
      this.zoomed.delete(tabId);
      return { kind: "changed", tabId, paneId: current, zoomed: false };
    }
    if (current === paneSessionId) {
      return { kind: "unchanged", tabId, zoomed: true };
    }
    const layout = this.store.tabLayouts.get(tabId);
    if (layout?.type !== "branch") {
      return { kind: "single-pane", tabId };
    }
    this.zoomed.set(tabId, { paneId: paneSessionId, panes: paneSignature(layout) });
    return { kind: "changed", tabId, paneId: paneSessionId, zoomed: true };
  }

  /**
   * Whether `set(paneSessionId, zoomed)` would zoom a split tab in — the case
   * where the pane must become active first.
   */
  wouldZoomIn(paneSessionId: string, zoomed?: boolean): boolean {
    const tabId = tabOwningPane(this.store.tabLayouts, paneSessionId);
    if (!tabId || this.store.tabLayouts.get(tabId)?.type !== "branch") {
      return false;
    }
    return zoomed ?? this.zoomedPane(tabId) === null;
  }

  /** Forget zooms that no longer hold. Returns whether anything was dropped. */
  prune(): boolean {
    let dropped = false;
    for (const tabId of [...this.zoomed.keys()]) {
      if (this.zoomedPane(tabId) === null) {
        this.zoomed.delete(tabId);
        dropped = true;
      }
    }
    return dropped;
  }
}

function paneSignature(layout: SplitNode): string {
  return getAllSessionIds(layout).join("\n");
}

/** What the webview does after a zoom command, injected so the choice is testable. */
export interface PaneZoomCommandEffects {
  /** Make `paneId` the active pane of its tab — a zoom shows the active pane. */
  focusPane(paneId: string): void;
  /** Redraw the tab's panes, menu keys and tab-bar mark. */
  refresh(tabId: string): void;
  /** Tell the user why nothing happened. */
  notify(message: string): void;
}

export const SINGLE_PANE_ZOOM_NOTICE = "Zoom needs at least two panes — split this terminal first.";

/**
 * Apply a host `setPaneZoom` command and show its outcome. A zoom focuses its
 * pane before recording it: recorded first, the focus change's own redraw
 * would see a zoomed pane that is not yet active, and drop it.
 */
export function applyPaneZoomCommand(
  zoom: PaneZoom,
  msg: { sessionId: string; zoomed?: boolean },
  effects: PaneZoomCommandEffects,
): void {
  if (zoom.wouldZoomIn(msg.sessionId, msg.zoomed)) {
    effects.focusPane(msg.sessionId);
  }
  const result = zoom.set(msg.sessionId, msg.zoomed);
  if (result.kind === "single-pane") {
    effects.notify(SINGLE_PANE_ZOOM_NOTICE);
  } else if (result.kind === "changed") {
    effects.refresh(result.tabId);
  }
}
