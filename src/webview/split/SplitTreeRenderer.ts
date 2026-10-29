// src/webview/split/SplitTreeRenderer.ts — Split tree rendering and pane orchestration
//
// Encapsulates split tree DOM rendering, active pane visuals,
// pane close/create orchestration, and tab container visibility.
//
// See: docs/design/xterm-integration.md, specs/split-layout-data-model/spec.md

import type { SplitPaneCreatedMessage } from "../../types/messages";
import type { FlowControl } from "../flow/FlowControl";
import type { ResizeCoordinator } from "../resize/ResizeCoordinator";
import { renderSplitTree } from "../SplitContainer";
import {
  createBranch,
  createLeaf,
  getAllSessionIds,
  removeLeaf,
  replaceNode,
  tabOwningPane,
  updateBranchRatio,
} from "../SplitModel";
import { attachResizeHandle } from "../SplitResizeHandle";
import type { WebviewStateStore } from "../state/WebviewStateStore";
import type { TerminalFactory } from "../terminal/TerminalFactory";

// ─── SplitTreeRenderer ──────────────────────────────────────────────

export type SplitPaneCloseResult =
  | { kind: "close-tab"; tabId: string }
  | { kind: "closed"; tabId: string; closedPaneId: string; survivingPaneId: string };

/** Dependencies injected into SplitTreeRenderer. */
export interface SplitTreeRendererDeps {
  store: WebviewStateStore;
  resizeCoordinator: ResizeCoordinator;
  flowControl: FlowControl;
  postMessage: (msg: unknown) => void;
  onTabBarUpdate: () => void;
  /** Fired when the user selects a different pane (click-to-focus). Optional. */
  onPaneFocused?: (sessionId: string) => void;
  /** Whether a tab mirrors typed input to all its panes. Absent: never. */
  isBroadcasting?: (tabId: string) => boolean;
}

/**
 * Manages split tree DOM rendering, active pane visuals, and pane lifecycle.
 *
 * Owns:
 * - `renderTabSplitTree()` — DOM rendering of the split layout tree
 * - `showTabContainer()` — tab container visibility
 * - `updateActivePaneVisual()` — active pane CSS class management
 * - `closeSplitPaneById()` — fact-only split pane removal
 * - `handleSplitPaneCreated()` — split pane creation orchestration
 */
export class SplitTreeRenderer {
  private readonly store: WebviewStateStore;
  private readonly resizeCoordinator: ResizeCoordinator;
  private readonly flowControl: FlowControl;
  private readonly postMessage: (msg: unknown) => void;
  private readonly onTabBarUpdate: () => void;
  private readonly onPaneFocused?: (sessionId: string) => void;
  private readonly isBroadcasting: (tabId: string) => boolean;

  constructor(deps: SplitTreeRendererDeps) {
    this.store = deps.store;
    this.resizeCoordinator = deps.resizeCoordinator;
    this.flowControl = deps.flowControl;
    this.postMessage = deps.postMessage;
    this.onTabBarUpdate = deps.onTabBarUpdate;
    this.onPaneFocused = deps.onPaneFocused;
    this.isBroadcasting = deps.isBroadcasting ?? (() => false);
  }

  /**
   * Render the split tree for a tab and attach terminals to leaf containers.
   * Also attaches resize handles to branch nodes.
   */
  renderTabSplitTree(tabId: string): void {
    const layout = this.store.tabLayouts.get(tabId);
    if (!layout) {
      return;
    }

    const containerEl = document.getElementById("terminal-container");
    if (!containerEl) {
      return;
    }

    // Find or create the tab's root container
    let tabContainer = containerEl.querySelector(`[data-tab-id="${tabId}"]`) as HTMLDivElement | null;
    if (!tabContainer) {
      tabContainer = document.createElement("div");
      tabContainer.dataset.tabId = tabId;
      tabContainer.style.width = "100%";
      tabContainer.style.height = "100%";
      tabContainer.style.display = "none";
      containerEl.appendChild(tabContainer);
    }

    // Clean up existing resize handles for this tab
    const cleanups = this.store.resizeCleanups.get(tabId);
    if (cleanups) {
      for (const cleanup of cleanups) {
        cleanup();
      }
    }
    this.store.resizeCleanups.set(tabId, []);

    // Clear existing content
    tabContainer.innerHTML = "";

    // Render the split tree
    renderSplitTree(layout, tabContainer, {
      onLeafMounted: (sessionId: string, leafContainer: HTMLDivElement) => {
        const instance = this.store.terminals.get(sessionId);
        if (instance) {
          // Move the terminal's container div into the leaf
          leafContainer.appendChild(instance.container);
          instance.container.style.display = "block";
          instance.container.style.width = "100%";
          instance.container.style.height = "100%";
        }

        leafContainer.addEventListener("mousedown", () => {
          this.onPaneFocused?.(sessionId);
        });
      },
    });

    // Attach resize handles to all branch nodes
    const handles = Array.from(tabContainer.querySelectorAll(".split-handle"));
    for (const handle of handles) {
      const handleEl = handle as HTMLDivElement;
      const branchEl = handleEl.parentElement as HTMLDivElement;
      const direction = handleEl.dataset.direction as "horizontal" | "vertical";
      const branchIndex = Number.parseInt(handleEl.dataset.branchIndex ?? "0", 10);

      const cleanup = attachResizeHandle(handleEl, branchEl, direction, {
        onRatioChange: (newRatio: number) => {
          // Update the layout tree model with the new ratio
          const currentLayout = this.store.tabLayouts.get(tabId);
          if (currentLayout) {
            const updatedLayout = updateBranchRatio(currentLayout, branchIndex, newRatio);
            this.store.tabLayouts.set(tabId, updatedLayout);
          }
          this.store.persist();
        },
        onResizeComplete: () => {
          // Fit all leaf terminals in this tab
          this.resizeCoordinator.debouncedFitAllLeaves(tabId);
        },
      });

      this.store.resizeCleanups.get(tabId)?.push(cleanup);
    }

    // Apply active pane visual indicator after rendering
    this.updateActivePaneVisual(tabId);
  }

  /**
   * Show the tab container for a given tab ID (make it visible in the DOM).
   */
  showTabContainer(tabId: string): void {
    const containerEl = document.getElementById("terminal-container");
    if (!containerEl) {
      return;
    }
    const tabContainer = containerEl.querySelector(`[data-tab-id="${tabId}"]`) as HTMLDivElement | null;
    if (tabContainer) {
      tabContainer.style.display = "flex";
    }
  }

  /**
   * Update the visual active pane indicator for a tab.
   * Adds `.active-pane` class to the active leaf, removes from all others.
   * Only applies when the tab has 2+ panes (no indicator for single-pane tabs).
   *
   * Also the one place the broadcast-input mark and the panes' context-menu
   * keys are refreshed, since every split, close and focus change ends here.
   */
  updateActivePaneVisual(tabId: string): void {
    const layout = this.store.tabLayouts.get(tabId);
    const hasSplits = layout?.type === "branch";
    const broadcasting = this.isBroadcasting(tabId);

    // `paneSplit` offers "Broadcast Input" only where there is a sibling to
    // reach; `broadcastInput` swaps it for "Stop Broadcasting Input". Written on
    // the terminal's own container (where a right-click lands) and, below, on
    // its leaf, so the two never disagree about which entry to show.
    const paneContext = (sessionId: string): string =>
      JSON.stringify({
        webviewSection: "splitPane",
        paneSessionId: sessionId,
        paneSplit: hasSplits,
        broadcastInput: broadcasting,
      });
    for (const sessionId of layout ? getAllSessionIds(layout) : []) {
      const instance = this.store.terminals.get(sessionId);
      if (instance) {
        instance.container.dataset.vscodeContext = paneContext(sessionId);
      }
    }

    const containerEl = document.getElementById("terminal-container");
    if (!containerEl) {
      return;
    }
    const tabContainer = containerEl.querySelector(`[data-tab-id="${tabId}"]`);
    if (!tabContainer) {
      return;
    }
    tabContainer.classList.toggle("broadcast-input", broadcasting);
    for (const leaf of Array.from(tabContainer.querySelectorAll<HTMLElement>(".split-leaf"))) {
      if (leaf.dataset.sessionId) {
        leaf.dataset.vscodeContext = paneContext(leaf.dataset.sessionId);
      }
    }
    const activePaneId = this.store.tabActivePaneIds.get(tabId) ?? tabId;

    // Remove active-pane from all leaves in this tab
    const leaves = Array.from(tabContainer.querySelectorAll(".split-leaf"));
    for (const leaf of leaves) {
      leaf.classList.remove("active-pane");
    }

    // Only add indicator when there are 2+ panes
    if (hasSplits) {
      const activeLeaf = tabContainer.querySelector(`.split-leaf[data-session-id="${activePaneId}"]`);
      if (activeLeaf) {
        activeLeaf.classList.add("active-pane");
      }
    }
  }

  /**
   * Hide the tab container for a given tab ID.
   */
  hideTabContainer(tabId: string): void {
    const containerEl = document.getElementById("terminal-container");
    if (!containerEl) {
      return;
    }
    const tabContainer = containerEl.querySelector(`[data-tab-id="${tabId}"]`) as HTMLDivElement | null;
    if (tabContainer) {
      tabContainer.style.display = "none";
    }
  }

  /**
   * Remove a tab's DOM container and clean up split layout state.
   * Disposes all split pane terminals (not the root terminal — caller handles that).
   * Returns the list of split session IDs that were disposed.
   */
  removeTab(tabId: string): string[] {
    // Get all session IDs in this tab's split tree before cleanup
    const layout = this.store.tabLayouts.get(tabId);
    const splitSessionIds = layout ? getAllSessionIds(layout).filter((sid) => sid !== tabId) : [];

    // Dispose all split pane terminals belonging to this tab
    for (const splitId of splitSessionIds) {
      const splitInstance = this.store.terminals.get(splitId);
      if (splitInstance) {
        splitInstance.terminal.dispose();
        splitInstance.container.remove();
        this.store.terminals.delete(splitId);
      }
      this.flowControl.delete(splitId);
      this.postMessage({ type: "requestCloseSplitPane", sessionId: splitId });
    }

    // Remove the tab container from DOM
    const containerEl = document.getElementById("terminal-container");
    if (containerEl) {
      const tabContainer = containerEl.querySelector(`[data-tab-id="${tabId}"]`);
      if (tabContainer) {
        tabContainer.remove();
      }
    }

    // Clean up split layout and active pane tracking
    this.store.tabLayouts.delete(tabId);
    this.store.tabActivePaneIds.delete(tabId);
    const cleanups = this.store.resizeCleanups.get(tabId);
    if (cleanups) {
      for (const cleanup of cleanups) {
        cleanup();
      }
      this.store.resizeCleanups.delete(tabId);
    }

    return splitSessionIds;
  }

  /** Remove one pane from topology and terminal facts without navigation effects. */
  closeSplitPaneById(paneSessionId: string): SplitPaneCloseResult | null {
    const tabId = tabOwningPane(this.store.tabLayouts, paneSessionId);
    if (!tabId) {
      return null;
    }
    const layout = this.store.tabLayouts.get(tabId);
    if (!layout) {
      return null;
    }
    if (layout.type === "leaf") {
      return { kind: "close-tab", tabId };
    }

    const updatedLayout = removeLeaf(layout, paneSessionId);
    if (updatedLayout === null) {
      return { kind: "close-tab", tabId };
    }
    const survivingPaneId = getAllSessionIds(updatedLayout)[0];
    if (!survivingPaneId) {
      return { kind: "close-tab", tabId };
    }

    this.store.tabLayouts.set(tabId, updatedLayout);
    this.store.tabActivePaneIds.set(tabId, survivingPaneId);
    const closedInstance = this.store.terminals.get(paneSessionId);
    if (closedInstance) {
      closedInstance.terminal.dispose();
      closedInstance.container.remove();
      this.store.terminals.delete(paneSessionId);
    }
    this.flowControl.delete(paneSessionId);

    return { kind: "closed", tabId, closedPaneId: paneSessionId, survivingPaneId };
  }

  /** Attach a completed child to the tab captured by its request. */
  handleSplitPaneCreated(msg: SplitPaneCreatedMessage, factory: TerminalFactory): boolean {
    const layout = this.store.tabLayouts.get(msg.sourceTabId);
    const source = this.store.terminals.get(msg.sourcePaneId);
    if (!layout || !source || !getAllSessionIds(layout).includes(msg.sourcePaneId)) {
      return false;
    }

    factory.createTerminal(msg.newSessionId, msg.newSessionName, this.store.currentConfig, false, null, {
      isSplitPane: true,
      worktreeId: source.worktreeId,
    });
    const newBranch = createBranch(msg.direction, createLeaf(msg.sourcePaneId), createLeaf(msg.newSessionId));
    this.store.tabLayouts.set(msg.sourceTabId, replaceNode(layout, msg.sourcePaneId, newBranch));
    return true;
  }
}
