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

/** Dependencies injected into SplitTreeRenderer. */
export interface SplitTreeRendererDeps {
  store: WebviewStateStore;
  resizeCoordinator: ResizeCoordinator;
  flowControl: FlowControl;
  postMessage: (msg: unknown) => void;
  onTabBarUpdate: () => void;
  /** Fired when the user selects a different pane (click-to-focus). Optional. */
  onPaneFocused?: (sessionId: string) => void;
}

/**
 * Manages split tree DOM rendering, active pane visuals, and pane lifecycle.
 *
 * Owns:
 * - `renderTabSplitTree()` — DOM rendering of the split layout tree
 * - `showTabContainer()` — tab container visibility
 * - `updateActivePaneVisual()` — active pane CSS class management
 * - `closeSplitPaneById()` — split pane close + cleanup orchestration
 * - `handleSplitPaneCreated()` — split pane creation orchestration
 */
export class SplitTreeRenderer {
  private readonly store: WebviewStateStore;
  private readonly resizeCoordinator: ResizeCoordinator;
  private readonly flowControl: FlowControl;
  private readonly postMessage: (msg: unknown) => void;
  private readonly onTabBarUpdate: () => void;
  private readonly onPaneFocused?: (sessionId: string) => void;

  constructor(deps: SplitTreeRendererDeps) {
    this.store = deps.store;
    this.resizeCoordinator = deps.resizeCoordinator;
    this.flowControl = deps.flowControl;
    this.postMessage = deps.postMessage;
    this.onTabBarUpdate = deps.onTabBarUpdate;
    this.onPaneFocused = deps.onPaneFocused;
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
   */
  updateActivePaneVisual(tabId: string): void {
    const containerEl = document.getElementById("terminal-container");
    if (!containerEl) {
      return;
    }
    const tabContainer = containerEl.querySelector(`[data-tab-id="${tabId}"]`);
    if (!tabContainer) {
      return;
    }

    const layout = this.store.tabLayouts.get(tabId);
    const hasSplits = layout && layout.type === "branch";
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

  /**
   * Close a specific split pane by session ID within the active tab.
   * If the pane is the only one in the tab, closes the entire tab.
   *
   * Returns the session ID of the pane terminal that was actually disposed here
   * (so the caller can dispose its hover-preview controller — the popup lives on
   * `document.body` now, so removing the pane container no longer removes it).
   * Returns null when it falls back to a full tab close (that path disposes the
   * terminal + its controller via `removeTerminal`) or when it no-ops.
   */
  closeSplitPaneById(paneSessionId: string): string | null {
    // The OWNING tab, not the active one. The host confirms a close and then
    // posts this id, and the active tab can move underneath the modal — an
    // `activeTabId` lookup then closed an unrelated tab, or disposed the named
    // pane while leaving its own layout stale (round-3 F002).
    const owner = tabOwningPane(this.store.tabLayouts, paneSessionId);
    if (!owner) {
      return null;
    }
    const layout = this.store.tabLayouts.get(owner);
    if (!layout) {
      return null;
    }

    // If the layout is a single leaf, fall back to tab close
    if (layout.type === "leaf") {
      this.postMessage({ type: "closeTab", tabId: owner });
      return null;
    }

    // Remove the pane from the split tree
    const updatedLayout = removeLeaf(layout, paneSessionId);

    if (updatedLayout === null) {
      this.postMessage({ type: "closeTab", tabId: owner });
      return null;
    }

    // Find the sibling to focus (first leaf in the remaining tree)
    const remainingIds = getAllSessionIds(updatedLayout);
    const newActivePaneId = remainingIds[0] ?? owner;

    // Update state — on the OWNER, so a tab switch during the confirmation
    // cannot write one tab's layout into another's slot.
    this.store.tabLayouts.set(owner, updatedLayout);
    this.store.tabActivePaneIds.set(owner, newActivePaneId);

    // Destroy the terminal instance for the closed pane
    const closedInstance = this.store.terminals.get(paneSessionId);
    if (closedInstance) {
      closedInstance.terminal.dispose();
      closedInstance.container.remove();
      this.store.terminals.delete(paneSessionId);
    }
    this.flowControl.delete(paneSessionId);

    // Request the extension host to destroy the session
    this.postMessage({ type: "requestCloseSplitPane", sessionId: paneSessionId });

    // Re-render the split tree
    this.renderTabSplitTree(owner);
    // Only if the owner is what the user is looking at — showing it otherwise
    // would make closing a background tab's pane switch tabs under them.
    if (this.store.activeTabId === owner) {
      this.showTabContainer(owner);
    }
    this.store.persist();

    // Fit and focus
    requestAnimationFrame(() => {
      this.resizeCoordinator.debouncedFitAllLeaves(owner);
      if (this.store.activeTabId !== owner) {
        return;
      }
      const siblingInstance = this.store.terminals.get(newActivePaneId);
      if (siblingInstance) {
        siblingInstance.terminal.focus();
      }
    });

    this.onTabBarUpdate();
    return paneSessionId;
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
