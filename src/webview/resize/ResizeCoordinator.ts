// src/webview/resize/ResizeCoordinator.ts — Resize coordination and policy
//
// Coordinates ResizeObserver events, debounce timers, visibility state,
// and fit delegation. Owns resize policy — when to fit, when to defer,
// when to skip.
//
// See: docs/design/resize-handling.md

import type { Terminal } from "@xterm/xterm";
import type { SplitNode } from "../SplitModel";
import { getAllSessionIds } from "../SplitModel";

// ─── Types ──────────────────────────────────────────────────────────

/** Minimal terminal instance interface for fit operations. */
interface FittableInstance {
  terminal: Terminal;
  container: HTMLDivElement;
}

/** State accessor callback — provides current state without direct dependency on the store. */
interface ResizeState {
  activeTabId: string | null;
  terminals: Map<string, FittableInstance>;
  tabLayouts: Map<string, SplitNode>;
}

// ─── Constants ──────────────────────────────────────────────────────

/** Resize debounce interval in milliseconds. */
const RESIZE_DEBOUNCE_MS = 100;

// ─── ResizeCoordinator ──────────────────────────────────────────────

/**
 * Coordinates resize observation, debouncing, visibility state, and fit delegation.
 *
 * Owns:
 * - `pendingResize` — whether a resize was deferred because the container was invisible
 * - `fitTimeout` — debounce timer for window resize events
 * - `splitFitTimeout` — debounce timer for split-pane resize events
 * - `observer` — ResizeObserver instance
 *
 * Does NOT own: ThemeManager or terminal instances. Terminal location is the
 * extension's responsibility (baked into `data-terminal-location` on body) —
 * this coordinator never re-infers it from container aspect ratio.
 */
export class ResizeCoordinator {
  private pendingResize = false;
  private fitTimeout: number | undefined;
  /**
   * Per-tab debounce timers — earlier rounds used a single shared slot, which
   * meant a back-to-back loop of `debouncedFitAllLeaves(tabA)` then
   * `debouncedFitAllLeaves(tabB)` cancelled tabA's timer. After cross-restart
   * with multiple split roots, every root except the last stayed visually
   * blank (0×0 canvas). Per-tab slots fix this. See round-1 W5.
   */
  private splitFitTimeouts: Map<string, number> = new Map();
  private observer: ResizeObserver | undefined;

  /** Fit these terminals together: all measured, then all resized (see `TerminalFactory.fitTerminals`). */
  private readonly fitTerminals: (instances: FittableInstance[]) => void;
  private readonly getState: () => ResizeState;

  constructor(fitTerminals: (instances: FittableInstance[]) => void, getState: () => ResizeState) {
    this.fitTerminals = fitTerminals;
    this.getState = getState;
  }

  /** The panes of `tabId`'s split, or the tab's own terminal when it has no layout. */
  private instancesOf(tabId: string, fallbackToTab: boolean): FittableInstance[] {
    const { tabLayouts, terminals } = this.getState();
    const layout = tabLayouts.get(tabId);
    if (layout) {
      return getAllSessionIds(layout).flatMap((sessionId) => terminals.get(sessionId) ?? []);
    }
    const own = fallbackToTab ? terminals.get(tabId) : undefined;
    return own ? [own] : [];
  }

  /**
   * Set up ResizeObserver on the terminal container element.
   * See: docs/design/resize-handling.md#§3
   */
  setup(container: HTMLElement): void {
    if (this.observer) {
      this.observer.disconnect();
    }

    this.observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;

        // Skip if container is not visible (collapsed)
        if (width === 0 || height === 0) {
          this.pendingResize = true;
          return;
        }

        this.debouncedFit();
      }
    });

    this.observer.observe(container);
  }

  /**
   * Debounced fit: resets timer on each call, fits after RESIZE_DEBOUNCE_MS quiet period.
   * Fits all leaf terminals in the active tab's split tree.
   * Uses requestAnimationFrame to ensure the browser has computed new layout dimensions.
   */
  debouncedFit(): void {
    clearTimeout(this.fitTimeout);
    this.fitTimeout = window.setTimeout(() => {
      requestAnimationFrame(() => {
        this.fitAllTerminals();
      });
    }, RESIZE_DEBOUNCE_MS);
  }

  /**
   * Debounced fit for all leaf terminals in a tab. Multiple concurrent calls
   * for DIFFERENT tabs each get their own debounce slot — see round-1 W5.
   */
  debouncedFitAllLeaves(tabId: string): void {
    const existing = this.splitFitTimeouts.get(tabId);
    if (existing !== undefined) {
      clearTimeout(existing);
    }
    const handle = window.setTimeout(() => {
      this.splitFitTimeouts.delete(tabId);
      this.fitTerminals(this.instancesOf(tabId, false));
    }, RESIZE_DEBOUNCE_MS);
    this.splitFitTimeouts.set(tabId, handle);
  }

  /**
   * Handle view becoming visible — flush deferred resize.
   * See: docs/design/resize-handling.md#§5
   */
  onViewShow(): void {
    if (this.pendingResize) {
      this.pendingResize = false;
      requestAnimationFrame(() => this.fitAllTerminals());
    }
  }

  /** Disconnect the ResizeObserver and clear timers. */
  dispose(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = undefined;
    }
    clearTimeout(this.fitTimeout);
    for (const handle of this.splitFitTimeouts.values()) {
      clearTimeout(handle);
    }
    this.splitFitTimeouts.clear();
  }

  /**
   * Immediately fit all visible terminals in the active tab.
   */
  private fitAllTerminals(): void {
    const { activeTabId } = this.getState();
    if (activeTabId) {
      this.fitTerminals(this.instancesOf(activeTabId, true));
    }
  }
}
