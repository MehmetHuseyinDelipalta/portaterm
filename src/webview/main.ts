// src/webview/main.ts — Portaterm WebView Entry Point (Composition Root)
//
// Wires together extracted modules and provides thin orchestration.
// All business logic lives in dedicated modules.
//
// See: docs/design/xterm-integration.md, docs/design/message-protocol.md

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

import { SerializeAddon } from "@xterm/addon-serialize";
import { MAX_PASTE_IMAGE_BYTES } from "../shared/imagePasteTrigger";
import { stripDecorations } from "../shared/titleDecorations";
import type {
  ExtensionToWebViewMessage,
  HoverPreviewSettings,
  HoverPreviewSettingsMessage,
  InitMessage,
  ThemeChangedMessage,
} from "../types/messages";
import { SETI_FONT_CSS } from "../vendor/seti/setiFontCss";
import { DragDropHandler } from "./DragDropHandler";
import { mountEmptyScopeRegion } from "./emptyScopeRegion";
import { FileTreeController } from "./fileTree/FileTreeController";
import { FlowControl } from "./flow/FlowControl";
import {
  base64ToBlob,
  clipboardEventHasPlainText,
  extractImageBlobFromClipboardItems,
  forwardImagePaste,
  ImagePasteDeduper,
  isPasteShortcut,
  probeClipboardForImageBlob,
  shouldHostReadOsClipboardImage,
} from "./imagePasteBridge";
import type { HoverPreviewThemeKind } from "./links/HoverPreviewController";
import { preloadSyntaxHighlighter } from "./links/syntaxRenderer";
import { createMessageRouter } from "./messaging/MessageRouter";
import { createScrollbackDumpHandler } from "./messaging/scrollbackDumpHandler";
import {
  applyTerminalNavigationProjection,
  navigationCatalogFromStore,
  rejectExpiredSplitRequest,
  rollbackFailedNavigationTransaction,
  runRecoverableNavigationTransaction,
  scheduleBoundedNavigationRecovery,
  worktreeIdForTerminalOwner,
} from "./navigation/TerminalNavigationComposition";
import { TerminalNavigationController } from "./navigation/TerminalNavigationController";
import { reconcileTerminalNavigationOwners, restoreTerminalNavigation } from "./navigation/TerminalNavigationRestore";
import {
  focusNavigationPane,
  MAIN_TERMINAL_OWNER,
  normalizeTerminalNavigationState,
  recordRecentTab,
  selectNavigationOwner,
  selectNavigationTab,
  selectRecentNavigationTab,
  type TerminalNavigationState,
  type TerminalOwner,
} from "./navigation/TerminalNavigationState";
import { ResizeCoordinator } from "./resize/ResizeCoordinator";
import { getAllSessionIds } from "./SplitModel";
import { isFindStepShortcut, TerminalSearchWidget } from "./search/TerminalSearchWidget";
import { SplitTreeRenderer } from "./split/SplitTreeRenderer";
import { resolveTabDisplayPane } from "./split/tabDisplay";
import { WebviewStateStore } from "./state/WebviewStateStore";
import {
  buildTabBarData,
  handleTabKeyboardShortcut,
  isCloseTabShortcut,
  renderTabBar,
  revealActiveTab,
  revealTab,
} from "./TabBarUtils";
import { type TabBarScopeWiring, wireTabBarScope } from "./tabBarScopeWiring";
import { hideRenameOverlay, repositionRenameOverlay, showRenameOverlay } from "./tabRenameOverlay";
import { hasCurrentCursorApproval, hasStrictCursorTitle } from "./terminal/CursorApprovalDetector";
import { createPaneEvidenceReporter } from "./terminal/paneEvidenceReporter";
import { formatRestoreDivider } from "./terminal/restoreDivider";
import { TerminalActivityTracker } from "./terminal/TerminalActivityTracker";
import { TerminalFactory } from "./terminal/TerminalFactory";
import { ThemeManager } from "./theme/ThemeManager";
import { showBanner } from "./ui/BannerService";
import { isStackedLayout } from "./vault/stackedLayout";
import { VaultPanel } from "./vault/VaultPanel";
import { activatePane } from "./worktree/activatePane";
import { resolveInitialView, WorktreeController } from "./worktree/WorktreeController";
import { worktreeDelegatedHandlers } from "./worktree/worktreeMessageHandlers";

// Inject the vendored Seti icon-font @font-face rule (with the woff embedded
// as a data URL) into the document. Lives in the webview bundle because
// esbuild's `.woff: dataurl` loader is configured only for webviewConfig;
// inlining at runtime keeps the extension bundle free of the ~50 KB font.
(() => {
  const styleEl = document.createElement("style");
  styleEl.setAttribute("data-source", "seti-icon-font");
  styleEl.textContent = SETI_FONT_CSS;
  document.head.appendChild(styleEl);
})();

// Kick off Shiki highlighter init in the background; first hover will then
// render synchronously. Failures fall back to plain text in the popup.
void preloadSyntaxHighlighter().catch((err) => {
  console.warn("[Portaterm] preloadSyntaxHighlighter failed:", err);
});

// Debug helper for diagnosing wrap-aware link detection. Set true from the
// webview devtools console: `window.__AT_DEBUG_WRAP = true`, then hover the
// problematic path to see the rows, isWrapped flags, and parsed matches.
console.log("[Portaterm] To debug hover/link wrapping, run in this console: window.__AT_DEBUG_WRAP = true");

// Webview-local store for the latest theme kind from the host. `TerminalFactory`
// reads this via the getter for each render. Default to `dark` (matches the
// host's mock + most VSCode users) until the first `themeChanged` arrives.
const themeStore: { kind: HoverPreviewThemeKind } = { kind: "dark" };

/**
 * Webview-local snapshot of hover-preview settings. The host posts
 * `hoverPreviewSettings` on init + every config change; controllers / popup
 * read via the closures below. Default mirrors `contributes.configuration`.
 */
const hoverPreviewSettingsStore: { settings: HoverPreviewSettings } = {
  settings: { enabled: true, delay: 300, blockSensitive: true },
};

// ─── State & Services ───────────────────────────────────────────────

const vscode = acquireVsCodeApi();
const store = new WebviewStateStore(vscode);
const themeManager = new ThemeManager("sidebar");
let isComposing = false;
/**
 * Pane title + waiting evidence for the extension host's window-wide presence
 * view. Ungated by which body this surface is showing: presence is window
 * state, and a surface that only reported while the Worktree view was open
 * would blind the host to exactly the panes it alone renders.
 *
 * See: asimov/changes/add-host-pane-evidence/design.md D7, D8.
 */
const paneEvidenceReporter = createPaneEvidenceReporter((msg) => vscode.postMessage(msg));
const activityTracker = new TerminalActivityTracker({
  getTerminal: (sessionId) => store.terminals.get(sessionId),
  onStatusChange: () => updateTabBar(),
  onWaitingChange: (sessionId, waiting) => paneEvidenceReporter.reportWaiting(sessionId, waiting),
});
const cursorHookIdentity = new Set<string>();

function clearWaitingOnCursorTitleLoss(tabId: string, title: string): void {
  if (!cursorHookIdentity.has(tabId) && !hasStrictCursorTitle(title)) {
    activityTracker.setWaiting(tabId, false);
  }
}

const flowControl = new FlowControl((msg) => vscode.postMessage(msg));
const factory = new TerminalFactory({
  themeManager,
  store,
  postMessage: (msg) => vscode.postMessage(msg),
  onTabBarUpdate: () => updateTabBar(),
  onTitleEvidence: (sessionId, rawTitle) => {
    paneEvidenceReporter.reportTitle(sessionId, rawTitle);
    // The tab classifies the same title the host does, from the same site, so
    // the two can never come to different answers about one pane.
    activityTracker.setTitle(sessionId, rawTitle);
  },
  getIsComposing: () => isComposing,
  getHoverPreviewTheme: () => themeStore.kind,
  getHoverPreviewSettings: () => hoverPreviewSettingsStore.settings,
});

const dragDropHandler = new DragDropHandler({
  postMessage: (msg) => vscode.postMessage(msg),
  getActiveSessionId: () => {
    const tabId = store.activeTabId;
    if (!tabId) {
      return null;
    }
    // Resolve to the active pane session ID (not the tab ID) for correct split-pane routing
    return store.tabActivePaneIds.get(tabId) ?? tabId;
  },
  getTerminalExited: () => {
    const tabId = store.activeTabId;
    if (!tabId) {
      return true;
    }
    const paneId = store.tabActivePaneIds.get(tabId) ?? tabId;
    const instance = store.terminals.get(paneId);
    return !instance || instance.exited;
  },
});

const resizeCoordinator = new ResizeCoordinator(
  (instance) => factory.fitTerminal(instance),
  () => ({ activeTabId: store.activeTabId, terminals: store.terminals, tabLayouts: store.tabLayouts }),
);

const splitTabsNeedingRender = new Set<string>();

const splitRenderer = new SplitTreeRenderer({
  store,
  resizeCoordinator,
  flowControl,
  postMessage: (msg) => vscode.postMessage(msg),
  onTabBarUpdate: () => updateTabBar(),
  onPaneFocused: (paneId) => {
    navigationController.dispatch((catalog, state) => focusNavigationPane(catalog, state, paneId));
  },
});

/**
 * FLIP-animate the sidebar region around a collapse toggle, the way VS Code's
 * paneview animates its panes: freeze the region + its two sections to their
 * CURRENT pixel sizes, apply the layout change, then transition `flex-basis` in
 * pixels to the final sizes (grow/shrink disabled for the tween). Animating an
 * explicit pixel dimension — instead of `flex-grow`, whose ratio interpolates
 * non-linearly in pixel terms — keeps the file tree (the in-region grow-sibling)
 * from bouncing. Inline styles are always cleared after the tween so the steady
 * state reverts to the class-based flex; a failed/early-cleared tween therefore
 * degrades to the correct final layout, never a stuck size.
 */
function runAuxCollapseAnimation(apply: () => void): void {
  const region = document.getElementById("aux-region");
  const layout = document.getElementById("webview-layout");
  if (!region || !layout) {
    apply();
    return;
  }
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    apply();
    return;
  }
  // Region axis follows the dock: height for top/bottom, width for left/right.
  const vertical = isStackedLayout(layout);
  const all = [region, ...Array.from(region.children)] as HTMLElement[];
  const measure = (el: HTMLElement): number =>
    vertical ? el.getBoundingClientRect().height : el.getBoundingClientRect().width;

  const before = all.map(measure);
  apply();
  const after = all.map(measure);

  // Only tween elements whose size actually changed. Freezing an UNCHANGED
  // element — e.g. the region during an internal vault↔tree split, where its
  // edge size is constant — to a pixel flex-basis can introduce a 1px
  // border/box-sizing snap that reads as a small "bounce". Leaving it on its
  // native `flex: 0 0 var(--file-tree-size)` keeps it rock-solid.
  const movers = all
    .map((el, i) => ({ el, from: before[i], to: after[i] }))
    .filter((m) => Math.abs(m.from - m.to) >= 0.5);
  if (movers.length === 0) {
    return; // nothing resized — no tween needed
  }

  // `box-sizing: border-box` makes flex-basis count border + padding, so the
  // px we measured (getBoundingClientRect = border box) equals the px we set.
  // Without it a bordered section (region's border-top in bottom dock, the
  // vault's seam border) lands ~1px off and snaps when the tween ends.
  for (const m of movers) {
    const s = m.el.style;
    s.boxSizing = "border-box";
    s.transition = "none";
    s.flexGrow = "0";
    s.flexShrink = "0";
    s.flexBasis = `${m.from}px`;
  }
  void region.offsetWidth; // reflow so the "from" sizes register
  for (const m of movers) {
    const s = m.el.style;
    s.transition = "flex-basis 150ms ease-out";
    s.flexBasis = `${m.to}px`;
  }
  window.setTimeout(() => {
    for (const m of movers) {
      const s = m.el.style;
      s.transition = "";
      s.flexGrow = "";
      s.flexShrink = "";
      s.flexBasis = "";
      s.boxSizing = "";
    }
  }, 170);
}

/** The active terminal pane's session id, or null. */
function getActivePaneId(): string | null {
  const tabId = store.activeTabId;
  if (!tabId) {
    return null;
  }
  return store.tabActivePaneIds.get(tabId) ?? tabId;
}

/** Resolve the active terminal pane's tracked cwd (OSC 7), or null. */
function getActivePaneCwd(): string | null {
  const paneId = getActivePaneId();
  return paneId ? (store.terminals.get(paneId)?.cwd ?? null) : null;
}

/** Re-read the vault session list, but only while the section is expanded. */
function refreshVaultIfOpen(): void {
  if (vaultPanel && !vaultPanel.isCollapsed()) {
    vaultPanel.requestRefresh();
  }
}

/** Last active-pane cwd the vault was synced/refreshed against (dedupe guard). */
let lastSyncedVaultCwd: string | null = null;
/**
 * The active pane's REAL cwd as resolved by the HOST (lsof/`/proc` live cwd →
 * shell-integration-tracked → spawn cwd). Authoritative over the webview's
 * OSC-7-only value, so "This folder only" scopes correctly even without shell
 * integration. Cleared on pane change; refreshed via `requestVaultContextCwd`
 * (pane switch / vault open / `cd`). Updated by the `vaultContextCwd` reply.
 */
let hostContextCwd: string | null = null;
/** Workspace root, for the folder-filter fallback when no pane cwd resolves. */
let vaultWorkspaceRoot: string | null = null;
/** Debounce for re-probing the active pane's cwd after terminal output (a `cd`). */
let vaultCwdReprobeTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Resolve the folder-filter scope cwd: the host-resolved value first (reliable,
 * OSC-7-independent), then the webview's OSC 7 value, then the workspace root.
 */
function resolveVaultContextCwd(): string | null {
  return hostContextCwd ?? getActivePaneCwd() ?? vaultWorkspaceRoot ?? null;
}

/**
 * Ask the host for the active pane's REAL cwd so the folder filter scopes to the
 * focused terminal's actual folder without depending on OSC 7 / shell
 * integration. No-op when no pane is active; the `vaultContextCwd` reply updates
 * the filter.
 */
function requestVaultContextCwd(): void {
  const sessionId = getActivePaneId();
  if (sessionId) {
    vscode.postMessage({ type: "requestVaultContextCwd", sessionId });
  }
}

/**
 * Point the vault's folder filter at the active pane, then refresh if open.
 * The active pane changed, so the previous host-resolved cwd is stale: clear it,
 * apply the optimistic value now, and ask the host for the authoritative cwd.
 * Only re-reads the agent stores when the scope cwd actually CHANGED.
 */
function syncVaultToActivePane(): void {
  hostContextCwd = null;
  const cwd = resolveVaultContextCwd();
  vaultPanel?.setContextCwd(cwd);
  requestVaultContextCwd();
  if (cwd !== lastSyncedVaultCwd) {
    lastSyncedVaultCwd = cwd;
    refreshVaultIfOpen();
  }
}

/**
 * After the active pane emits output, re-probe its live cwd (debounced) so a bare
 * `cd` re-scopes "This folder only" without shell integration. Gated to the
 * active pane + filter-on + vault-open so it costs nothing otherwise.
 */
function scheduleVaultCwdReprobe(tabId: string): void {
  if (!vaultPanel || vaultPanel.isCollapsed() || !vaultPanel.isFolderOnly()) {
    return;
  }
  if (tabId !== getActivePaneId()) {
    return;
  }
  clearTimeout(vaultCwdReprobeTimer);
  vaultCwdReprobeTimer = setTimeout(() => requestVaultContextCwd(), 400);
}

// File-tree controller — instantiated lazily on init once we know workspaceRoot +
// rootGeneration from the host. Owns the FileTreePanel + all router handlers
// for the file-tree subsystem. See: webview/fileTree/FileTreeController.ts
// and port-vscode-async-data-tree spec.
let fileTreeController: FileTreeController | null = null;

// AI-vault panel — mounted on init into `#vault-panel`, a collapsible section
// stacked directly above the file tree inside `#aux-region`. Fed by
// `vaultSessionsResponse`. See: webview/vault/VaultPanel.ts.
let vaultPanel: VaultPanel | null = null;
// Vault entries pinned tabs are running (host-pushed, `vaultPinnedSessions`).
let pinnedVaultEntryIds: readonly string[] = [];
// Vault entries some live pane is running, and those panes (host-pushed, `vaultOpenSessions`).
let openVaultEntryIds: readonly string[] = [];
let openVaultPanesByEntry: Record<string, string[]> = {};
let worktreeController: WorktreeController | null = null;
// This surface's tab-bar scope — the panel, the coordinator and the bar joined.
// Constructed on init beside the controller that feeds it, and owning the join
// itself. See: webview/tabBarScopeWiring.ts and design.md D8.
let tabBarScope: TabBarScopeWiring | null = null;
/** Cmd+F / Ctrl+F find widget; created in bootstrap once #terminal-container exists. */
let terminalSearch: TerminalSearchWidget | null = null;
const pendingSplitAttachmentAcks = new Map<string, string>();

function flushPendingSplitAttachmentAcks(): void {
  for (const [requestId, newSessionId] of pendingSplitAttachmentAcks) {
    vscode.postMessage({
      type: "splitPaneAttachmentResult",
      requestId,
      newSessionId,
      status: "attached",
    });
    pendingSplitAttachmentAcks.delete(requestId);
  }
}

// Most recently active first; closing the active tab returns to the next one.
let recentTabIds: string[] = [];

const navigationController = new TerminalNavigationController(
  { activeOwner: MAIN_TERMINAL_OWNER, activeTabId: null, activePaneByTab: {} },
  {
    readCatalog: () => navigationCatalogFromStore(store),
    effects: {
      renderProjections: (state) => {
        recentTabIds = recordRecentTab(recentTabIds, state.activeTabId);
        applyTerminalNavigationProjection(state, {
          store,
          render: () => {
            worktreeController?.projectActiveOwner();
            updateTabBar();
          },
        });
      },
      displayActive: (state) => {
        const tabs = [...splitTabsNeedingRender];
        for (const tabId of tabs) {
          splitRenderer.renderTabSplitTree(tabId);
          splitTabsNeedingRender.delete(tabId);
        }
        displayNavigationState(state);
      },
      updateSplitVisual: (state) => {
        if (state.activeTabId) {
          splitRenderer.updateActivePaneVisual(state.activeTabId);
        }
      },
      focusActivePane: (paneId) => {
        if (paneId) {
          store.terminals.get(paneId)?.terminal.focus();
        }
      },
      syncVault: () => syncVaultToActivePane(),
      persistCheckpoint: (checkpoint) => {
        store.persist();
        store.persistNavigationCheckpoint(checkpoint);
      },
      emitHostEcho: (activeTabId, activePaneId) => {
        vscode.postMessage(
          activeTabId === null || activePaneId === null
            ? { type: "terminalNavigationCommitted", activeTabId: null, activePaneId: null }
            : { type: "terminalNavigationCommitted", activeTabId, activePaneId },
        );
        flushPendingSplitAttachmentAcks();
      },
      scheduleDelayed: (run) => requestAnimationFrame(run),
      runDelayedFocusAndFit: (state) => {
        if (!state.activeTabId) {
          return;
        }
        const paneId = state.activePaneByTab[state.activeTabId];
        const instance = paneId ? store.terminals.get(paneId) : undefined;
        if (instance) {
          factory.fitAllAndFocus(state.activeTabId, instance);
        }
      },
    },
  },
);

// ─── Orchestration ──────────────────────────────────────────────────

function scheduleFailedSplitAttachmentRollback(message: {
  requestId: string;
  sourceTabId: string;
  newSessionId: string;
}): void {
  scheduleBoundedNavigationRecovery(
    (run) => requestAnimationFrame(run),
    () => pendingSplitAttachmentAcks.has(message.requestId),
    () => navigationController.reconcileEffects(),
    () => {
      if (!pendingSplitAttachmentAcks.delete(message.requestId)) {
        return;
      }
      const outcome: { result: ReturnType<typeof splitRenderer.closeSplitPaneById> } = { result: null };
      rollbackFailedNavigationTransaction(
        navigationController,
        () => {
          outcome.result = splitRenderer.closeSplitPaneById(message.newSessionId);
          const result = outcome.result;
          if (result?.kind !== "closed") {
            return false;
          }
          activityTracker.delete(result.closedPaneId);
          paneEvidenceReporter.forget(result.closedPaneId);
          factory.disposeHoverController(result.closedPaneId);
          splitTabsNeedingRender.add(result.tabId);
          return true;
        },
        (catalog, state) =>
          outcome.result?.kind === "closed" && state.activeTabId === outcome.result.tabId
            ? focusNavigationPane(catalog, state, outcome.result.survivingPaneId)
            : normalizeTerminalNavigationState(catalog, state, {
                preserveExplicitEmpty: state.activeTabId === null,
              }),
      );
      if (outcome.result?.kind === "closed") {
        vscode.postMessage({
          type: "splitPaneAttachmentResult",
          requestId: message.requestId,
          newSessionId: message.newSessionId,
          status: "rejected",
        });
      }
    },
  );
}

function requestNewTerminal(
  worktreeId = worktreeIdForTerminalOwner(navigationController.getState().activeOwner),
): void {
  vscode.postMessage(worktreeId ? { type: "worktreeOpenTerminal", worktreeId } : { type: "createTab" });
}

interface PendingSplitRequest {
  sourceTabId: string;
  sourcePaneId: string;
  direction: "horizontal" | "vertical";
  timer: ReturnType<typeof setTimeout>;
}

let splitRequestSequence = 0;
const pendingSplitRequests = new Map<string, PendingSplitRequest>();

function requestSplitSession(direction: "horizontal" | "vertical", sourceTabId: string, sourcePaneId: string): void {
  if (pendingSplitRequests.size >= 64) {
    return;
  }
  const requestId = `split-${++splitRequestSequence}`;
  const timer = setTimeout(() => {
    rejectExpiredSplitRequest(pendingSplitRequests, requestId, (message) => vscode.postMessage(message));
  }, 15_000);
  pendingSplitRequests.set(requestId, { sourceTabId, sourcePaneId, direction, timer });
  vscode.postMessage({ type: "requestSplitSession", requestId, direction, sourceTabId, sourcePaneId });
}

/** The last pane set reported to the host, so an unchanged set is not resent. */
let presentedPanes: string | undefined;

/**
 * Tell the host which panes this surface holds tabs for. Every tab counts,
 * including those a worktree scope hides: the user can still reach them.
 */
function reportPresentedPanes(): void {
  const paneIds = [...store.tabLayouts.values()].flatMap((layout) => getAllSessionIds(layout)).sort();
  const signature = paneIds.join("\n");
  if (signature !== presentedPanes) {
    presentedPanes = signature;
    vscode.postMessage({ type: "presentedPanes", paneIds });
  }
}

function updateTabBar(): void {
  reportPresentedPanes();
  // Every route a pane arrives or leaves by ends in a redraw: the region's own
  // offers, the `+` button, a split, a close, a tree push. Deciding the region at
  // selection alone left it standing over the terminal it had just opened. Ahead
  // of the tab-bar check, because the region does not depend on that element
  // (round-2 suggestion).
  tabBarScope?.syncEmptyScope();
  // An open find widget follows the active pane; a no-op when it did not change.
  terminalSearch?.sync();
  const tabBarEl = document.getElementById("tab-bar");
  if (!tabBarEl) {
    return;
  }
  // Built once and read twice: the bar draws `tabs`, and the chip's badge counts
  // what the same pass dropped. Calling it again for the count would be a second
  // filter to keep in step.
  const data = buildTabBarData(store, tabBarScope?.effectiveScope());
  renderTabBar({
    tabBarEl,
    terminals: data.tabs,
    scope: tabBarScope?.chip(data.hiddenWaiting),
    activeTabId: store.activeTabId,
    onTabClick: (tabId) => switchTab(tabId),
    onTabClose: (tabId) => vscode.postMessage({ type: "closeTab", tabId }),
    onAddClick: (worktreeId) => requestNewTerminal(worktreeId),
    onTabRename: (tabId, tabEl) => startInlineRename(tabId, tabEl, tabBarEl),
    onTabReorder: (tabId, targetTabId, placement) => {
      // The order lives in the webview's persisted layout state, which survives
      // reloads and restarts, so the host needs no message.
      if (store.moveTab(tabId, targetTabId, placement)) {
        store.persist();
        updateTabBar();
      }
    },
    onAfterRender: () => {
      // If an inline rename is in progress, re-anchor the overlay to the
      // (possibly re-created) tab DOM. See add-tab-rename design.md D4.
      if (store.renameSession) {
        repositionRenameOverlay();
      }
    },
  });
}

function startInlineRename(tabId: string, tabEl: HTMLElement, tabBarEl: HTMLElement): void {
  // Unscoped on purpose: renaming asks about a tab the user is pointing at, and
  // the count is not part of that question.
  const tabInfo = buildTabBarData(store).tabs.get(tabId);
  if (!tabInfo) {
    return;
  }
  // Frame glyphs stripped: an agent's `✳` / spinner prefix is not part of the
  // name, and committing the raw title would freeze it into the custom name.
  const displayed = stripDecorations(tabInfo.customName ?? tabInfo.name);
  // IMPORTANT: showRenameOverlay first, THEN beginRename. If a prior overlay is
  // open, showRenameOverlay commits it — that commit's onCommit closure calls
  // store.endRename() and would clear the new tabId's marker we'd just set.
  // Doing showRenameOverlay first means the prior endRename runs, THEN we set
  // the new beginRename. See `.reviews/round-1.md` W1.
  showRenameOverlay({
    tabBarEl,
    targetTabEl: tabEl,
    initialValue: displayed,
    callbacks: {
      onCommit: (value) => {
        store.endRename();
        vscode.postMessage({ type: "renameTab", tabId, customName: value });
      },
      onCancel: () => {
        store.endRename();
      },
    },
  });
  store.beginRename(tabId, displayed);
}

function displayNavigationState(state: TerminalNavigationState): void {
  factory.disposeSubagentPopup();
  for (const tabId of store.tabLayouts.keys()) {
    if (tabId === state.activeTabId) {
      continue;
    }
    splitRenderer.hideTabContainer(tabId);
    const terminal = store.terminals.get(tabId);
    if (terminal) {
      terminal.container.style.display = "none";
    }
  }
  if (state.activeTabId === null) {
    return;
  }
  splitRenderer.showTabContainer(state.activeTabId);
  const terminal = store.terminals.get(state.activeTabId);
  if (terminal) {
    terminal.container.style.display = "block";
  }
}

function switchTab(newTabId: string): void {
  navigationController.dispatch((catalog, state) => selectNavigationTab(catalog, state, newTabId));
}

/** Resolve what the empty-scope region offers here, and hand it to the mount. */
function showEmptyScope(projection: { owner: TerminalOwner; label: string } | null): void {
  const containerEl = document.getElementById("terminal-container");
  if (containerEl === null) {
    return;
  }
  if (projection === null) {
    mountEmptyScopeRegion(containerEl, null);
    return;
  }
  const worktreeId = worktreeIdForTerminalOwner(projection.owner);
  const launch = worktreeId ? worktreeController?.launchOfferFor(worktreeId) : undefined;
  mountEmptyScopeRegion(containerEl, {
    owner: projection.owner,
    label: projection.label,
    onOpenTerminal: () => requestNewTerminal(worktreeId),
    ...(launch === undefined ? {} : { onLaunchAgent: launch }),
  });
}

/** Bring a pane forward through the surface navigation controller. */
function activatePaneById(paneId: string): boolean {
  const activated = activatePane(paneId, {
    tabLayouts: store.tabLayouts,
    canDisplayTab: (tabId) =>
      resolveTabDisplayPane(tabId, {
        tabLayouts: store.tabLayouts,
        hasTerminal: (sessionId) => store.terminals.has(sessionId),
      }) !== null,
    navigatePane: (id) => {
      navigationController.dispatch((catalog, state) => focusNavigationPane(catalog, state, id));
    },
  });
  // The bar reveals a newly active tab itself; this covers a pane whose tab was
  // already active but scrolled out of sight (a resume of a running session).
  const tabBarEl = document.getElementById("tab-bar");
  if (activated && tabBarEl) {
    revealActiveTab(tabBarEl);
  }
  return activated;
}

function removeTerminal(id: string): void {
  const instance = store.terminals.get(id);
  if (!instance) {
    return;
  }
  const closedActiveTab = navigationController.getState().activeTabId === id;

  navigationController.transaction(
    () => {
      factory.disposeSubagentPopup();
      factory.disposeHoverController(id);
      instance.terminal.dispose();
      instance.container.remove();
      store.terminals.delete(id);
      cursorHookIdentity.delete(id);
      activityTracker.delete(id);
      paneEvidenceReporter.forget(id);
      flowControl.delete(id);

      for (const splitId of splitRenderer.removeTab(id)) {
        cursorHookIdentity.delete(splitId);
        activityTracker.delete(splitId);
        paneEvidenceReporter.forget(splitId);
        factory.disposeHoverController(splitId);
      }
    },
    (catalog, state) =>
      closedActiveTab
        ? selectRecentNavigationTab(catalog, state, recentTabIds)
        : selectNavigationOwner(catalog, state, state.activeOwner),
  );
  recentTabIds = recentTabIds.filter((tabId) => tabId !== id);
  // Closing the last tab leaves the scope empty on purpose: no replacement is
  // spawned, so repeated Cmd+W drains the terminals and then falls through to
  // VS Code's editors. The empty-scope region offers "Open a terminal" instead.
}

// ─── Scrollback Dump (export-terminal-session) ───────────────────────

// `@xterm/addon-serialize` is bundled eagerly. The webview build is
// single-file iife (`esbuild.js:92`), so a `await import(...)` here would
// still inline the module into `media/webview.js` (~3.6 MB) — only the
// module's top-level execution would be deferred, which is negligible.
// True lazy load would require switching the build away from iife AND
// teaching the webview CSP to fetch chunks at runtime; out of scope for
// the export feature. See external-review round W1.
const handleScrollbackDump = createScrollbackDumpHandler({
  getTerminal: (tabId) => store.terminals.get(tabId)?.terminal,
  postMessage: (msg) => vscode.postMessage(msg),
  createSerializeAddon: () => new SerializeAddon(),
});

// ─── Message Router ─────────────────────────────────────────────────

const routeMessage = createMessageRouter({
  onOutput(msg) {
    activityTracker.markOutput(msg.tabId);
    const dataLen = msg.data.length;
    const instance = store.terminals.get(msg.tabId);
    if (instance) {
      instance.terminal.write(msg.data, () => {
        activityTracker.setWaiting(
          msg.tabId,
          hasCurrentCursorApproval(instance.terminal, cursorHookIdentity.has(msg.tabId), instance.name),
        );
        flowControl.ackChars(dataLen, msg.tabId);
      });
    } else {
      flowControl.ackChars(dataLen, msg.tabId);
    }
    // A `cd` in the focused pane changes its real cwd with no other signal when
    // shell integration is off — re-probe the host cwd (debounced) so the open,
    // folder-scoped vault re-filters. Cheap: gated to the active pane + filter on.
    scheduleVaultCwdReprobe(msg.tabId);
  },
  onAgentActivityStatus(msg) {
    if (msg.agent === "cursor") {
      cursorHookIdentity.add(msg.tabId);
      activityTracker.setAgentStatus(msg.tabId, msg.state);
      return;
    }
    cursorHookIdentity.delete(msg.tabId);
    activityTracker.setAgentStatus(msg.tabId, null);
    activityTracker.setWaiting(msg.tabId, false);
  },
  onExit(msg) {
    cursorHookIdentity.delete(msg.tabId);
    activityTracker.delete(msg.tabId);
    paneEvidenceReporter.forget(msg.tabId);
    const instance = store.terminals.get(msg.tabId);
    if (instance) {
      instance.exited = true;
      instance.terminal.write(`\r\n\x1b[90m[Process exited with code ${msg.code}]\x1b[0m\r\n`);
      updateTabBar();
    }
  },
  onTabCreated(msg) {
    navigationController.transaction(
      () => {
        const instance = factory.createTerminal(msg.tabId, msg.name, store.currentConfig, false, msg.customName, {
          worktreeId: msg.worktreeId,
        });
        instance.terminal.onTitleChange((title) => clearWaitingOnCursorTitleLoss(msg.tabId, title));
        instance.terminal.onResize(() => activityTracker.setWaiting(msg.tabId, false));
      },
      (catalog, state) => focusNavigationPane(catalog, state, msg.tabId),
    );
  },
  onTabRemoved(msg) {
    removeTerminal(msg.tabId);
  },
  onTabRenamed(msg) {
    // Mirror the normalized customName into the local instance. If an inline
    // overlay is still mounted for THIS tab (e.g. a parallel rename completed
    // via context menu / F2 while the overlay was open), dismount the overlay
    // so the rendered label updates cleanly.
    const instance = store.terminals.get(msg.tabId);
    if (instance) {
      instance.customName = msg.customName;
    }
    if (store.renameSession?.tabId === msg.tabId) {
      hideRenameOverlay();
      store.endRename();
    }
    updateTabBar();
  },
  onTabPinned(msg) {
    const instance = store.terminals.get(msg.tabId);
    if (instance) {
      instance.pinned = msg.pinned;
    }
    updateTabBar();
    // Pinning re-sorts the tab to the other end of the strip; follow it there.
    const tabBarEl = document.getElementById("tab-bar");
    if (tabBarEl) {
      revealTab(tabBarEl, msg.tabId);
    }
  },
  onRestore(msg) {
    const instance = store.terminals.get(msg.tabId);
    if (instance) {
      instance.terminal.write(msg.data);
    }
  },
  onConfigUpdate(msg) {
    factory.applyConfig(msg.config);
  },
  onViewShow() {
    resizeCoordinator.onViewShow();
    // The view becoming visible is a "becomes visible" event (design D11): an
    // already-expanded vault re-reads the agents' stores so it isn't stale.
    // Guarded — no fetch when collapsed. The active pane is unchanged on
    // reshow, so a plain re-read (not a re-scope) suffices.
    refreshVaultIfOpen();
  },
  onSplitPane(msg) {
    const state = navigationController.getState();
    if (!state.activeTabId) {
      return;
    }
    const activePaneId = state.activePaneByTab[state.activeTabId];
    if (activePaneId) {
      requestSplitSession(msg.direction, state.activeTabId, activePaneId);
    }
  },
  onSplitPaneCreated(msg) {
    const pending = pendingSplitRequests.get(msg.requestId);
    if (
      !pending ||
      pending.sourceTabId !== msg.sourceTabId ||
      pending.sourcePaneId !== msg.sourcePaneId ||
      pending.direction !== msg.direction
    ) {
      vscode.postMessage({
        type: "splitPaneAttachmentResult",
        requestId: msg.requestId,
        newSessionId: msg.newSessionId,
        status: "rejected",
      });
      return;
    }
    clearTimeout(pending.timer);
    pendingSplitRequests.delete(msg.requestId);
    let attached = false;
    const effectsComplete = runRecoverableNavigationTransaction(
      navigationController,
      () => {
        attached = splitRenderer.handleSplitPaneCreated(msg, factory);
        if (attached) {
          splitTabsNeedingRender.add(msg.sourceTabId);
          pendingSplitAttachmentAcks.set(msg.requestId, msg.newSessionId);
        }
        return attached;
      },
      (catalog, state) =>
        attached && state.activeTabId === msg.sourceTabId
          ? focusNavigationPane(catalog, state, msg.newSessionId)
          : normalizeTerminalNavigationState(catalog, state, {
              preserveExplicitEmpty: state.activeTabId === null,
            }),
    );
    if (!attached) {
      vscode.postMessage({
        type: "splitPaneAttachmentResult",
        requestId: msg.requestId,
        newSessionId: msg.newSessionId,
        status: "rejected",
      });
    } else if (!effectsComplete) {
      scheduleFailedSplitAttachmentRollback(msg);
    }
  },
  onCloseSplitPaneById(msg) {
    if (!msg.sessionId) {
      return;
    }
    factory.disposeSubagentPopup();
    const outcome: { result: ReturnType<typeof splitRenderer.closeSplitPaneById> } = { result: null };
    try {
      navigationController.transaction(
        () => {
          outcome.result = splitRenderer.closeSplitPaneById(msg.sessionId!);
          const result = outcome.result;
          if (result?.kind !== "closed") {
            return false;
          }
          activityTracker.delete(result.closedPaneId);
          paneEvidenceReporter.forget(result.closedPaneId);
          factory.disposeHoverController(result.closedPaneId);
          splitTabsNeedingRender.add(result.tabId);
          return true;
        },
        (catalog, state) =>
          outcome.result?.kind === "closed" && state.activeTabId === outcome.result.tabId
            ? focusNavigationPane(catalog, state, outcome.result.survivingPaneId)
            : normalizeTerminalNavigationState(catalog, state, {
                preserveExplicitEmpty: state.activeTabId === null,
              }),
      );
    } finally {
      const result = outcome.result;
      if (result?.kind === "close-tab") {
        vscode.postMessage({ type: "closeTab", tabId: result.tabId });
      } else if (result?.kind === "closed") {
        vscode.postMessage({ type: "requestCloseSplitPane", sessionId: result.closedPaneId });
      }
    }
  },
  onSplitPaneAt(msg) {
    if (!msg.direction || !msg.sourcePaneId) {
      return;
    }
    navigationController.dispatch((catalog, state) => focusNavigationPane(catalog, state, msg.sourcePaneId!));
    const state = navigationController.getState();
    if (state.activeTabId && state.activePaneByTab[state.activeTabId] === msg.sourcePaneId) {
      requestSplitSession(msg.direction, state.activeTabId, msg.sourcePaneId);
    }
  },
  onCtxClear(msg) {
    const instance = msg.sessionId ? store.terminals.get(msg.sessionId) : factory.getActivePaneTerminal();
    if (instance) {
      instance.terminal.clear();
    }
  },
  onError(msg) {
    console.error(`[Portaterm] ${msg.severity}: ${msg.message}`);
    const containerEl = document.getElementById("terminal-container");
    if (containerEl) {
      showBanner(containerEl, msg.message, msg.severity);
    }
  },
  onInsertPathEffect() {
    const containerEl = document.getElementById("terminal-container");
    if (!containerEl) {
      return;
    }
    // Remove class first in case animation is still running, then re-add
    containerEl.classList.remove("path-inserted");
    // Force reflow to restart animation
    void containerEl.offsetWidth;
    containerEl.classList.add("path-inserted");
    containerEl.addEventListener("animationend", () => containerEl.classList.remove("path-inserted"), { once: true });
  },
  onFilePreviewResult(msg) {
    // Route by `requestId` is the controller's job — but we look up by session
    // here so a stale message for a since-disposed terminal is silently dropped.
    // The host sends one result per sessionId at most (token-map enforces 1
    // in-flight), so we don't need to fan out across all controllers.
    for (const controller of factory.hoverControllers.values()) {
      controller.onMessage(msg);
    }
  },
  onThemeChanged(msg: ThemeChangedMessage) {
    themeStore.kind = msg.kind;
  },
  onHoverPreviewSettings(msg: HoverPreviewSettingsMessage) {
    hoverPreviewSettingsStore.settings = msg.settings;
    // Push the new debounce and on/off switch into every active controller so
    // the next hover uses them. Existing in-flight timers run to completion under the old delay.
    for (const controller of factory.hoverControllers.values()) {
      controller.setDebounceMs(msg.settings.delay);
      controller.setEnabled(msg.settings.enabled);
    }
  },
  // ── File-tree (port-vscode-async-data-tree) ──
  // All five handlers delegate to FileTreeController, which owns the panel
  // and the lastWorkspaceRoot fallback used by reveal. See
  // webview/fileTree/FileTreeController.ts.
  onReadDirectoryResponse(msg) {
    fileTreeController?.handleReadDirectoryResponse(msg);
  },
  onWorkspaceRootChanged(msg) {
    vaultWorkspaceRoot = msg.rootPath; // keep the folder-filter fallback in sync
    fileTreeController?.handleWorkspaceRootChanged(msg);
  },
  onSetFileTreePosition(msg) {
    fileTreeController?.handleSetPosition(msg);
  },
  onRevealInFileTree(msg) {
    if (!fileTreeController) {
      console.warn("[Portaterm] reveal-in-file-tree: no file tree controller mounted");
      return;
    }
    fileTreeController.handleReveal(msg);
  },
  onFileTreeSearchResponse(msg) {
    fileTreeController?.handleSearchResponse(msg);
  },
  onGitStatusChanged(msg) {
    fileTreeController?.handleGitStatusChanged(msg);
  },
  onFsChangesInvalidated(msg) {
    fileTreeController?.handleFsChangesInvalidated(msg);
  },
  onFsRehydrate(msg) {
    fileTreeController?.handleFsRehydrate(msg);
  },
  onSetPanelId(msg) {
    // Persist the panel identity so VS Code includes it in the serializer's
    // `state` arg on next reload. See: restore-terminal-sessions design.md D2.
    store.updateState({ panelId: msg.panelId });
  },
  onRequestScrollbackDump(msg) {
    handleScrollbackDump(msg);
  },
  onVaultSessionsResponse(msg) {
    vaultPanel?.render(msg.result);
  },
  onAgentAttention(msg) {
    store.agentAttention.clear();
    for (const [paneId, attention] of Object.entries(msg.panes)) {
      store.agentAttention.set(paneId, attention);
    }
    updateTabBar();
    vaultPanel?.setAgentAttention(store.agentAttention);
  },
  onVaultPinnedSessions(msg) {
    // Held as well as applied: the set can land before the panel mounts.
    pinnedVaultEntryIds = msg.entryIds;
    vaultPanel?.setPinnedEntryIds(msg.entryIds);
  },
  onVaultOpenSessions(msg) {
    // Held as well as applied: the set can land before the panel mounts.
    openVaultEntryIds = msg.entryIds;
    openVaultPanesByEntry = msg.panesByEntry ?? {};
    vaultPanel?.setOpenEntryIds(msg.entryIds, openVaultPanesByEntry);
  },
  onVaultSessionDetailResponse(msg) {
    vaultPanel?.handleSessionDetailResponse(msg);
  },
  onVaultMessageRecordResponse(msg) {
    vaultPanel?.handleMessageRecordResponse(msg);
  },
  onVaultLaunchTargets(msg) {
    // Two dialogs ask the same question with different capabilities, and the
    // answers are different agent sets — so the reply is routed by what it says
    // it answers, never broadcast to both.
    if (msg.capability === "start") {
      worktreeController?.handleLaunchTargets(msg);
      return;
    }
    vaultPanel?.handleLaunchTargets(msg);
  },
  onVaultStartTargets(msg) {
    vaultPanel?.setStartableAgents(msg.agents);
  },
  onSubagentPreviewResponse(msg) {
    // Fill the (factory-owned) subagent popup. An `entryId` marks a nested
    // drill-down reply (routed to that block); else top-level, matched by requestId.
    factory.fillSubagentPreview(msg.requestId, msg.detail, msg.error, msg.entryId);
  },
  onClipboardImagePreview(msg) {
    // Host-read fallback: cache bytes the webview Clipboard API couldn't see.
    if (!msg.data) {
      return;
    }
    const blob = base64ToBlob(msg.data, msg.mimeType);
    if (!blob) {
      return;
    }
    const file = new File([blob], "clipboard.png", { type: blob.type || "image/png" });
    factory.getPastedImageStore(msg.tabId)?.add(file);
  },
  onOsClipboardPasteMiss(_msg) {
    // Empty-paste host probe found no image. Text paste never reaches here
    // (it stays on the native paste path); nothing to restore.
  },
  onWorktreeTreeResponse(msg) {
    if (msg.tree) {
      const linked = new Set(
        msg.tree.repos.flatMap((repo) =>
          repo.worktrees.filter((worktree) => worktree.kind === "linked").map((worktree) => worktree.id),
        ),
      );
      navigationController.transaction(
        () => {
          let changed = false;
          for (const terminal of store.terminals.values()) {
            if (terminal.worktreeId !== undefined && !linked.has(terminal.worktreeId)) {
              terminal.worktreeId = undefined;
              changed = true;
            }
          }
          return changed;
        },
        (catalog, state) => reconcileTerminalNavigationOwners(catalog, state, linked),
      );
    }
    if (tabBarScope) {
      tabBarScope.applyTree(msg.tree, () => worktreeController?.handleTreeResponse(msg));
      return;
    }
    worktreeController?.handleTreeResponse(msg);
  },
  // The routes that only delegate live in ONE table, shared with the assembly
  // test so a route cannot exist in the test and not here (round-1 W4). The two
  // below stay written out because main.ts genuinely does more than delegate.
  ...worktreeDelegatedHandlers(() => worktreeController),
  onVaultContextCwd(msg) {
    // Drop a reply for a pane that is no longer active (stale-guard): the user
    // switched panes before this resolved, and a later request owns the scope.
    if (msg.sessionId !== getActivePaneId()) {
      return;
    }
    hostContextCwd = msg.cwd;
    vaultPanel?.setContextCwd(resolveVaultContextCwd());
  },
  onOpenVault() {
    // Open the vault section (it sits above the file tree, both visible) and
    // re-read the agents' session stores — source files are the source of
    // truth (D2). `expand()` triggers the refresh on the collapsed→expanded
    // transition; when already open it's a no-op, so refresh explicitly.
    if (vaultPanel && !vaultPanel.isCollapsed()) {
      vaultPanel.requestRefresh();
    } else {
      vaultPanel?.expand();
    }
    // Scope the folder filter to the focused pane's real cwd on open.
    requestVaultContextCwd();
  },
  onFlashPane(msg) {
    // Visual confirmation for title-bar export click. Adds `.export-flash`
    // to the matching split-leaf; CSS animation auto-fades. We force a
    // reflow between remove + re-add so a rapid second click restarts the
    // animation (same pattern as onInsertPathEffect above).
    //
    // Listener hygiene: remove the prior `animationend` handler before
    // re-registering so rapid repeated triggers don't accumulate stacked
    // `{once:true}` listeners (they would all fire on the final animationend
    // — harmless DOM-wise but unbounded registration). See: .reviews/
    // round-2.md [S1].
    const leaf = document.querySelector<HTMLElement>(`.split-leaf[data-session-id="${CSS.escape(msg.sessionId)}"]`);
    if (!leaf) {
      return;
    }
    type FlashLeaf = HTMLElement & { __exportFlashHandler?: () => void };
    const flashLeaf = leaf as FlashLeaf;
    if (flashLeaf.__exportFlashHandler) {
      flashLeaf.removeEventListener("animationend", flashLeaf.__exportFlashHandler);
    }
    const handler = (): void => {
      flashLeaf.classList.remove("export-flash");
      flashLeaf.__exportFlashHandler = undefined;
    };
    flashLeaf.__exportFlashHandler = handler;
    flashLeaf.classList.remove("export-flash");
    void flashLeaf.offsetWidth;
    flashLeaf.classList.add("export-flash");
    flashLeaf.addEventListener("animationend", handler, { once: true });
  },
  onRestoreFromSnapshot(msg) {
    // Replay a persisted snapshot into an xterm instance. The typical sequence
    // when triggered cross-restart is: `init` arrives first → factory creates
    // each tab terminal with `open()` called (default). Then this message
    // arrives → we write the buffer and the restore divider; the post-init
    // refit (debouncedFitAllLeaves) owns the live container's true cols/rows.
    // If the instance is missing (defensive — init didn't include this tab),
    // we create one with `deferOpen: true` and finalize the attach here.
    // See: restore-terminal-sessions design.md D8, D9, D13.
    let instance = store.terminals.get(msg.tabId);
    let attachLater = false;
    if (!instance) {
      // Pass isSplitPane through so the factory's `tabLayouts.set(...,
      // createLeaf)` branch is skipped for split-pane children — otherwise
      // a deferOpen revive of a split child would clobber the parent's
      // tabLayouts entry with a bare leaf, collapsing the split tree and
      // persisting the corruption via store.persist(). Defensively default
      // to false (root tab) when the message lacks the field (legacy
      // ext-host wire shape). See .reviews/round-4.md [W4].
      instance = factory.createTerminal(
        msg.tabId,
        msg.tabId,
        store.currentConfig,
        store.activeTabId === msg.tabId,
        null,
        { deferOpen: true, isSplitPane: msg.isSplitPane === true, worktreeId: msg.worktreeId },
      );
      instance.terminal.onTitleChange((title) => clearWaitingOnCursorTitleLoss(msg.tabId, title));
      instance.terminal.onResize(() => activityTracker.setWaiting(msg.tabId, false));
      attachLater = true;
    }
    // Resize only for the deferred path — the open-already path's terminal has
    // its REAL container dimensions established by the post-init refit. Writing
    // the snapshot buffer at the persisted (stale) cols/rows and then refit
    // afterwards would mis-wrap any concurrent live PTY output (round-1 W4).
    if (attachLater) {
      try {
        instance.terminal.resize(Math.max(1, msg.cols), Math.max(1, msg.rows));
      } catch {
        // resize fails when terminal not yet open — the post-open fit recovers.
      }
    }
    instance.terminal.write(msg.serializedBuffer);
    instance.terminal.write(
      formatRestoreDivider({
        snapshotAt: msg.snapshotAt,
        shellExited: msg.shellExited,
        exitCode: msg.exitCode,
      }),
    );
    if (msg.shellExited) {
      instance.exited = true;
      updateTabBar();
    }
    if (attachLater) {
      factory.attachDeferredTerminal(instance);
      factory.fitTerminal(instance);
    }
  },
});

// ─── Init & Bootstrap ───────────────────────────────────────────────

function handleInit(msg: InitMessage): void {
  store.currentConfig = { ...msg.config };
  vaultWorkspaceRoot = msg.workspaceRoot ?? null; // folder-filter fallback scope
  const savedCheckpoint = store.getNavigationCheckpoint();
  const legacyWorktreeScope = store.getLegacyWorktreeScope();
  const validTabIds = new Set(msg.tabs.map((t) => t.id));

  const restoredLayouts = store.restore();
  for (const [tabId, layout] of restoredLayouts) {
    if (validTabIds.has(tabId)) {
      store.tabLayouts.set(tabId, layout);
    }
  }
  for (const tabId of store.tabActivePaneIds.keys()) {
    if (!validTabIds.has(tabId)) {
      store.tabActivePaneIds.delete(tabId);
    }
  }
  // Create xterm instances for every session. For split-pane children we pass
  // `isSplitPane: true` so the factory skips the per-tab side effects (no new
  // `tabLayouts` leaf, never `activeTabId`) — the root tab's layout already
  // references this pane. See restore-terminal-sessions design.md D12.
  for (const tab of msg.tabs) {
    const instance = factory.createTerminal(tab.id, tab.name, msg.config, tab.isActive, tab.customName, {
      isSplitPane: tab.isSplitPane,
      worktreeId: tab.worktreeId,
    });
    instance.pinned = tab.pinned === true;
    instance.terminal.onTitleChange((title) => clearWaitingOnCursorTitleLoss(tab.id, title));
    instance.terminal.onResize(() => activityTracker.setWaiting(tab.id, false));
  }
  // Build the split-tree DOM for every restored multi-pane tab. Without this,
  // a Cmd+R reload (Phase A) or cross-restart (Phase B) loses the split layout
  // because nothing in the existing init flow re-renders it.
  const splitRootIds: string[] = [];
  for (const [tabId, layout] of store.tabLayouts) {
    if (layout.type === "branch") {
      splitRenderer.renderTabSplitTree(tabId);
      splitRootIds.push(tabId);
    }
  }
  // Refit every leaf in each restored split layout. Split-pane children were
  // created with `isActive=false` (their containers started `display: none`,
  // so `terminal.open()` measured a 0×0 box) — without refitting after
  // `renderTabSplitTree` reparents them into visible leaves, the xterm
  // renderer keeps the 0×0 canvas and the pane stays visually blank even
  // though its `restore` payload was written. Mirrors the recovery path in
  // `SplitTreeRenderer.handleSplitPaneCreated`.
  if (splitRootIds.length > 0) {
    requestAnimationFrame(() => {
      for (const tabId of splitRootIds) {
        resizeCoordinator.debouncedFitAllLeaves(tabId);
      }
    });
  }
  const containerEl = document.getElementById("terminal-container");
  if (containerEl) {
    resizeCoordinator.setup(containerEl);
    dragDropHandler.setup(containerEl);
  }

  // File-tree controller — mount once per session. Per-location persistence,
  // defaults, seed-vs-restore, and all five router handlers live inside the
  // controller. See: webview/fileTree/FileTreeController.ts.
  const fileTreeHost = document.getElementById("file-tree");
  const layoutWrapper = document.getElementById("webview-layout");
  const auxRegion = document.getElementById("aux-region");
  if (fileTreeHost && layoutWrapper) {
    fileTreeController = FileTreeController.mount({
      fileTreeHost,
      layoutWrapper,
      // Vault + file tree share `#aux-region`; the resize sash mounts on it and
      // the header's vault button toggles the section stacked above.
      regionEl: auxRegion ?? undefined,
      onToggleVault: () => vaultPanel?.toggleCollapsed(),
      // Same VS-Code-style pixel FLIP the vault uses — collapsing/expanding the
      // file tree resizes the shared region smoothly without bouncing the vault.
      animateCollapse: (apply) => runAuxCollapseAnimation(apply),
      init: {
        workspaceRoot: msg.workspaceRoot,
        resolvedWorkspaceRoot: msg.resolvedWorkspaceRoot,
        rootGeneration: msg.rootGeneration,
      },
      store,
      postMessage: (m) => vscode.postMessage(m),
      getActiveSessionId: () => {
        const tabId = store.activeTabId;
        if (!tabId) {
          return null;
        }
        return store.tabActivePaneIds.get(tabId) ?? tabId;
      },
      onLayoutChange: () => resizeCoordinator.debouncedFit(),
      getInstanceCwd: (sessionId) => store.terminals.get(sessionId)?.cwd ?? null,
    });
  }

  // AI-vault panel — a collapsible section stacked directly above the file tree
  // (no exclusivity; both visible). Default expanded; the collapsed state
  // persists across reloads. See: add-ai-coding-vault/design.md D11.
  const vaultHost = document.getElementById("vault-panel");
  if (vaultHost) {
    // Worktree segment — the window's own tree, pushed by the host and gated on
    // this surface declaring the view visible. See: worktree/WorktreeController.ts.
    // Before the controller: its first push already carries a tree, and the
    // coordinator has to be holding the persisted scope when that arrives.
    tabBarScope = wireTabBarScope({
      activeOwner: () => navigationController.getState().activeOwner,
      selectOwner: (owner) => {
        navigationController.dispatch((catalog, state) => selectNavigationOwner(catalog, state, owner));
      },
      source: () => store,
      render: () => updateTabBar(),
      revalidatePresence: () => worktreeController?.revalidateVisibility(),
      showEmptyScope,
    });
    worktreeController = WorktreeController.mount({
      host: vaultHost,
      postMessage: (m) => vscode.postMessage(m),
      store,
      init: {
        workspaceRoot: msg.workspaceRoot,
        rowActivation: msg.worktreeRowActivation,
      },
      // The overlay and the panes belong to the surfaces that hold them; the
      // controller only forwards, so neither is rebuilt here (D2).
      showPreview: (entryId) => vaultPanel?.openPreviewById(entryId) ?? false,
      activatePane: (paneId) => activatePaneById(paneId),
      // The toolbar create is absent, not inert, when there is nothing to create
      // in — and only the tree knows that.
      onCreateAvailability: (available) => vaultPanel?.setCreateWorktreeAvailable(available),
      // A scope keeps this surface subscribed to presence with the rail
      // collapsed: its chip, escape control and hidden-waiting count are all
      // drawn from presence. The subscription drops to the presence level, so
      // the window stops per-row work nothing is drawing.
      presenceNeeded: () => tabBarScope?.needsPresence() === true,
      // Selecting a worktree scopes the tab bar and nothing else: the rail stays
      // exactly as the user left it. It used to collapse itself here, which read
      // as the panel closing on a click the user made inside it.
      onSelectWorktree: (worktreeId) => tabBarScope?.onSelectWorktree(worktreeId),
      activeOwner: () => navigationController.getState().activeOwner,
      activePaneId: () => {
        const state = navigationController.getState();
        return state.activeTabId === null ? null : (state.activePaneByTab[state.activeTabId] ?? null);
      },
      onAttribution: (map) => tabBarScope?.onAttribution(map),
    });
    vaultPanel = new VaultPanel({
      host: vaultHost,
      actionsAvailable: msg.vaultActionsAvailable,
      worktreeBody: worktreeController.element,
      // Supplying this is what CONSTRUCTS the toolbar control: `VaultPanel` builds
      // it only when a create callback exists, and nothing here supplied one, so
      // the primary create affordance had never been rendered.
      onCreateWorktree: () => worktreeController?.openCreate(),
      onWorktreeQuery: (query) => worktreeController?.setQuery(query),
      onWorktreeVisibility: (visible) => worktreeController?.setVisible(visible),
      getInitialView: () => resolveInitialView(store.getState().vaultView, msg.worktreeHasRepo),
      persistView: (view) => store.updateState({ vaultView: view }),
      postMessage: (m) => vscode.postMessage(m),
      getActiveSessionId: () => {
        const tabId = store.activeTabId;
        if (!tabId) {
          return null;
        }
        return store.tabActivePaneIds.get(tabId) ?? tabId;
      },
      // Absent persisted value → expanded (default).
      getInitialCollapsed: () => store.getState().vaultCollapsed === true,
      persistCollapsed: (collapsed) => store.updateState({ vaultCollapsed: collapsed }),
      // "This folder only" scope — default on; only an explicit opt-out shows all.
      getInitialFolderOnly: () => store.getState().vaultFolderOnly !== false,
      persistFolderOnly: (folderOnly) => store.updateState({ vaultFolderOnly: folderOnly }),
      // Grouping mode — default "recent". Persisted across reloads.
      getInitialGroupMode: () => store.getState().vaultGroupMode ?? "recent",
      persistGroupMode: (mode) => store.updateState({ vaultGroupMode: mode }),
      // Session-preview overlay size/position/maximized — persisted so the
      // user's dragged + resized layout survives reloads and restarts.
      getInitialPreviewGeometry: () => store.getState().vaultPreviewGeometry ?? null,
      persistPreviewGeometry: (geometry) => store.updateState({ vaultPreviewGeometry: geometry }),
      // Folder-filter scope, pulled on each render: the HOST-resolved cwd first
      // (lsof/`/proc` live → shell-integration tracked → spawn cwd — reliable and
      // OSC-7-independent), then the webview's OSC 7 value, then the workspace
      // root. Without the host value, "This folder only" couldn't distinguish
      // panes / react to `cd` when shell integration is off.
      getContextCwd: () => resolveVaultContextCwd(),
      // VS-Code-style pixel FLIP of the shared region so expanding/collapsing
      // the vault doesn't bounce the file tree (the grow-sibling).
      animateCollapse: (apply) => runAuxCollapseAnimation(apply),
    });
    // Seed the folder-filter context to the current active pane (optimistic), then
    // ask the host for its authoritative cwd; it updates on every pane select /
    // tab switch / `cd`. A vault that restored expanded refreshes itself via the
    // constructor seed (setCollapsed's collapsed→expanded path).
    vaultPanel.setContextCwd(resolveVaultContextCwd());
    vaultPanel.setPinnedEntryIds(pinnedVaultEntryIds);
    vaultPanel.setOpenEntryIds(openVaultEntryIds, openVaultPanesByEntry);
    vaultPanel.setAgentAttention(store.agentAttention);
    requestVaultContextCwd();
  }

  const restoredNavigation = restoreTerminalNavigation({
    catalog: navigationCatalogFromStore(store),
    checkpoint: savedCheckpoint,
    hostHint: msg.navigationHint,
    legacyWorktreeScope,
    bootstrap: msg.navigationBootstrap ?? "cold",
  });
  if (restoredNavigation.clearLegacyScope) {
    store.consumeLegacyWorktreeScope();
  }
  navigationController.transaction(
    () => true,
    () => restoredNavigation.state,
  );
  showDragDropTip();
}

// ─── Drag-Drop Tip Banner ───────────────────────────────────────────

const DRAG_DROP_TIP_DISMISSED_KEY = "dragDropTipDismissed";

function showDragDropTip(): void {
  // Check if already dismissed
  const state = vscode.getState() as Record<string, unknown> | null;
  if (state?.[DRAG_DROP_TIP_DISMISSED_KEY]) {
    return;
  }

  const tipEl = document.getElementById("drag-drop-tip");
  if (!tipEl) {
    return;
  }

  tipEl.className = "drag-drop-tip";
  tipEl.innerHTML = "";

  const iconSpan = document.createElement("span");
  iconSpan.textContent = "\ud83d\udca1";
  iconSpan.style.fontSize = "13px";
  iconSpan.style.flexShrink = "0";
  tipEl.appendChild(iconSpan);

  const textSpan = document.createElement("span");
  textSpan.className = "drag-drop-tip-text";
  textSpan.textContent =
    'Drag files from Explorer or Finder while holding Shift to insert path, or right-click \u2192 "Insert Path in Portaterm".';
  tipEl.appendChild(textSpan);

  const dismissBtn = document.createElement("button");
  dismissBtn.className = "drag-drop-tip-dismiss";
  dismissBtn.textContent = "\u00d7";
  dismissBtn.title = "Dismiss";
  dismissBtn.addEventListener("click", () => {
    tipEl.remove();
    // Persist dismissal
    const currentState = (vscode.getState() as Record<string, unknown>) ?? {};
    vscode.setState({ ...currentState, [DRAG_DROP_TIP_DISMISSED_KEY]: true });
    // Refit terminal to reclaim the space freed by the dismissed banner
    resizeCoordinator.debouncedFit();
  });
  tipEl.appendChild(dismissBtn);
}

/** Cmd+F on macOS, Ctrl+F elsewhere, with no other modifier. */
function isFindShortcut(e: KeyboardEvent, isMac: boolean): boolean {
  const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  return mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "f";
}

function isInAuxRegion(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("#aux-region") !== null;
}

function bootstrap(): void {
  const locationAttr = document.body.getAttribute("data-terminal-location");
  if (locationAttr === "sidebar" || locationAttr === "panel" || locationAttr === "editor") {
    themeManager.updateLocation(locationAttr);
  }
  themeManager.applyBodyBackground();

  document.addEventListener("compositionstart", () => {
    isComposing = true;
  });
  document.addEventListener("compositionend", () => {
    isComposing = false;
  });
  // Document-level capture handler — runs before xterm so events are
  // intercepted even if the embedding host (or another listener) would
  // otherwise consume them.
  //
  // Handled here:
  // - Shift+Enter → ESC+CR (\x1b\r) so REPLs like Claude Code insert a
  //   newline instead of submitting.
  // - Cmd+Left / Cmd+Right (macOS) → Ctrl+A / Ctrl+E so readline-style
  //   shells jump to start/end of line. xterm.js does not bind these by
  //   default; this matches Terminal.app / iTerm2 / VS Code's terminal.
  // - Option+Left / Option+Right (macOS) → ESC+b / ESC+f for readline
  //   word-jump (backward-word / forward-word). xterm.js's default
  //   behavior with `macOptionIsMeta: false` does not produce these.
  const isMac = navigator.platform.includes("Mac");
  const isWindows = navigator.platform.includes("Win");
  const terminalContainerEl = document.getElementById("terminal-container");
  if (terminalContainerEl) {
    terminalSearch = new TerminalSearchWidget({
      host: terminalContainerEl,
      getTarget: () => {
        const instance = factory.getActivePaneTerminal();
        return instance?.searchAddon
          ? { id: instance.id, terminal: instance.terminal, searchAddon: instance.searchAddon }
          : undefined;
      },
      getThemeKind: () => themeStore.kind,
    });
  }
  document.addEventListener(
    "keydown",
    (e: KeyboardEvent) => {
      if (isComposing) {
        return;
      }
      // The find widget's input owns its own keys (Enter, Escape, Cmd+Left…);
      // routing them to the PTY here would type into the shell instead.
      if (terminalSearch?.contains(e.target)) {
        return;
      }
      // Cmd+F / Ctrl+F → find in the active terminal. Stopped here so VS Code
      // never sees it. Left alone in the side region (file tree, vault), whose
      // own inputs and lists keep their native behaviour.
      if (isFindShortcut(e, isMac) && !isInAuxRegion(e.target)) {
        if (terminalSearch && factory.getActivePaneTerminal()) {
          e.preventDefault();
          e.stopPropagation();
          terminalSearch.open();
          return;
        }
      }
      // Cmd+G / Shift+Cmd+G (F3 / Shift+F3 off macOS, where Ctrl+G is the shell's
      // abort) step through matches while the widget is open, even with focus
      // back in the terminal.
      if (terminalSearch?.isOpen && isFindStepShortcut(e, isMac)) {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) {
          terminalSearch.findPrevious();
        } else {
          terminalSearch.findNext();
        }
        return;
      }
      const tabId = store.activeTabId;
      const targetId = tabId ? (store.tabActivePaneIds.get(tabId) ?? tabId) : null;
      if (!targetId) {
        return;
      }

      // Cmd+W / Ctrl+Shift+W → close. Stopped here so the key never reaches VS
      // Code, which would close the active editor instead. Both doors are the
      // existing gated ones: a root pane goes the tab close button's way (pin
      // refusal + kill confirmation), a split pane the context menu's Close Pane.
      if (isCloseTabShortcut(e, isMac)) {
        e.preventDefault();
        e.stopPropagation();
        vscode.postMessage(
          targetId === tabId ? { type: "closeTab", tabId } : { type: "requestClosePane", sessionId: targetId },
        );
        return;
      }

      // Shift+Enter → ESC+CR
      if (e.key === "Enter" && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        vscode.postMessage({ type: "input", tabId: targetId, data: "\x1b\r" });
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // macOS: Cmd+Left → start of line (\x01), Cmd+Right → end of line (\x05),
      // Cmd+Backspace → kill-line (\x15). Handled at document-capture so the
      // shortcut works even when DOM focus is on the file tree or another
      // sibling of the xterm textarea (where xterm's attached keydown handler
      // would otherwise never see the event).
      if (isMac && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        if (e.key === "ArrowLeft") {
          vscode.postMessage({ type: "input", tabId: targetId, data: "\x01" });
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (e.key === "ArrowRight") {
          vscode.postMessage({ type: "input", tabId: targetId, data: "\x05" });
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (e.key === "Backspace") {
          vscode.postMessage({ type: "input", tabId: targetId, data: "\x15" });
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }
      // Non-mac: Ctrl+Backspace → kill-line (\x15). Same global routing.
      if (!isMac && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key === "Backspace") {
        vscode.postMessage({ type: "input", tabId: targetId, data: "\x15" });
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // macOS: Option+Left → backward-word (\x1bb), Option+Right → forward-word (\x1bf)
      if (isMac && e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        if (e.key === "ArrowLeft") {
          vscode.postMessage({ type: "input", tabId: targetId, data: "\x1bb" });
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (e.key === "ArrowRight") {
          vscode.postMessage({ type: "input", tabId: targetId, data: "\x1bf" });
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }
    },
    true,
  );
  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if (handleTabKeyboardShortcut(e, { terminals: store.terminals, activeTabId: store.activeTabId, switchTab })) {
      e.preventDefault();
    }
  });

  // Image paste bridge: AI CLIs (Claude Code, Codex, Grok) read images from the
  // OS clipboard out-of-band after a paste trigger (\x16 or bracketed paste).
  // The webview mirrors the blob to the host, which syncs OS clipboard + PTY.
  const imagePasteDeduper = new ImagePasteDeduper();
  // Bumped on every paste-shortcut keydown; a probe launched under an older
  // generation is stale (a newer Cmd+V superseded it) and must not re-forward.
  let pasteProbeGeneration = 0;
  // Trailing-debounce handle for the keydown clipboard probe (see below).
  let pasteProbeTimer: ReturnType<typeof setTimeout> | undefined;
  // Rapid Ctrl+V (vim visual-block, key-repeat) must collapse to a single probe:
  // each macOS Ctrl+V otherwise costs the host ~2 osascript spawns just to learn
  // there is no image. The cache is preview-only, so a small delay is invisible.
  const PASTE_PROBE_DEBOUNCE_MS = 150;

  // `forward` false = cache the blob for hover preview only, without asking the
  // host to sync the OS clipboard + emit a PTY trigger. Used for macOS Ctrl+V,
  // where xterm already delivers \x16 natively — forwarding would double-paste.
  const handleImagePasteBlob = (blob: File, targetId: string, forward = true): void => {
    if (blob.size > MAX_PASTE_IMAGE_BYTES) {
      console.warn(`[Portaterm] pasted image (${blob.size} bytes) exceeds the size cap — skipped`);
      return;
    }
    factory.getPastedImageStore(targetId)?.add(blob);
    imagePasteDeduper.markHandled();
    if (forward) {
      void forwardImagePaste(blob, targetId, (msg) => vscode.postMessage(msg));
    }
  };

  document.addEventListener(
    "keydown",
    (e: KeyboardEvent) => {
      if (!isPasteShortcut(e, isMac)) {
        return;
      }
      imagePasteDeduper.reset();
      const probeGeneration = ++pasteProbeGeneration;
      const tabId = store.activeTabId;
      const targetId = tabId ? (store.tabActivePaneIds.get(tabId) ?? tabId) : null;
      // macOS Ctrl+V isn't the OS paste accelerator: no `paste` event fires and
      // xterm sends \x16, which OpenCode/Codex use to read the OS clipboard
      // themselves. Capture the blob for preview ONLY — forwarding double-pastes.
      const nativeDelivers = isMac && e.ctrlKey && !e.metaKey;
      // Never preventDefault on the OS paste accelerator (Cmd+V / Ctrl+V).
      // Text must stay on the native xterm path. Windows DIB image paste is
      // handled in the `paste` listener only when the event has no text/image.
      if (!targetId) {
        return;
      }
      // Fallback when no `paste` event fires (image clipboards, or macOS Ctrl+V).
      // Trailing-debounced so a burst of Ctrl+V collapses to one clipboard read.
      if (pasteProbeTimer !== undefined) {
        clearTimeout(pasteProbeTimer);
      }
      pasteProbeTimer = setTimeout(() => {
        pasteProbeTimer = undefined;
        void probeClipboardForImageBlob().then((blob) => {
          if (probeGeneration !== pasteProbeGeneration || imagePasteDeduper.wasHandled()) {
            return;
          }
          if (blob) {
            const file =
              blob instanceof File ? blob : new File([blob], "clipboard.png", { type: blob.type || "image/png" });
            handleImagePasteBlob(file, targetId, !nativeDelivers);
            return;
          }
          // Preview-only host read for macOS Ctrl+V (CLI already got the image
          // via \x16). Do NOT pasteOsClipboardImage from keydown — that would
          // race with native text paste when the clipboard holds text.
          if (nativeDelivers) {
            vscode.postMessage({ type: "requestClipboardImagePreview", tabId: targetId });
          }
        });
      }, PASTE_PROBE_DEBOUNCE_MS);
    },
    true,
  );

  document.addEventListener(
    "paste",
    (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      const blob = items ? extractImageBlobFromClipboardItems(items) : null;
      const tabId = store.activeTabId;
      const targetId = tabId ? (store.tabActivePaneIds.get(tabId) ?? tabId) : null;
      if (!targetId) {
        return;
      }

      if (blob) {
        // Consume image paste so xterm does not also emit an empty bracketed paste
        // (double-trigger). This `paste` event is authoritative vs the keydown
        // async probe (dedup via wasHandled) — never gate on the sticky dedup
        // flag, or a context-menu paste with no keydown gets dropped.
        e.preventDefault();
        e.stopPropagation();
        handleImagePasteBlob(blob, targetId);
        return;
      }

      // Plain text → native xterm paste (instant). Do not wait for host.
      const hasPlainText = clipboardEventHasPlainText(e.clipboardData);
      if (hasPlainText) {
        // The paste event is authoritative. Cancel the keydown fallback before
        // native xterm paste runs so a delayed navigator.clipboard.read() cannot
        // append an image from another clipboard representation or a newer copy.
        imagePasteDeduper.markHandled();
        pasteProbeGeneration += 1;
        if (pasteProbeTimer !== undefined) {
          clearTimeout(pasteProbeTimer);
          pasteProbeTimer = undefined;
        }
        return;
      }
      if (
        shouldHostReadOsClipboardImage({
          isWindows,
          hasImageBlob: false,
          hasPlainText,
        })
      ) {
        // Windows DIB/CF_BITMAP: webview sees neither image/* nor text. Block
        // empty native paste and let the host read the OS clipboard + emit the
        // PTY trigger (Alt+V for Claude). On miss there is nothing to restore.
        e.preventDefault();
        e.stopPropagation();
        imagePasteDeduper.markHandled();
        vscode.postMessage({ type: "pasteOsClipboardImage", tabId: targetId });
      }
    },
    true,
  );

  // A split leaf focus is a navigation intent. The separate focus message only
  // updates provider recency; routing comes from the controller's committed echo.
  document.addEventListener("focusin", (event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>(".split-leaf") : null;
    const leafSessionId = target?.dataset.sessionId;
    if (leafSessionId) {
      navigationController.dispatch((catalog, state) => focusNavigationPane(catalog, state, leafSessionId));
    }
    vscode.postMessage({ type: "focus" });
  });
  // A click on a pane, or on a tab and so on every pane it holds, is what says
  // the user looked at it; focus returning with the window says nothing.
  document.addEventListener(
    "pointerdown",
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const leafSessionId = target?.closest<HTMLElement>(".split-leaf")?.dataset.sessionId;
      const tabId = target?.closest<HTMLElement>("[data-tab-id]")?.dataset.tabId;
      const layout = tabId === undefined ? undefined : store.tabLayouts.get(tabId);
      const paneIds = leafSessionId ? [leafSessionId] : layout ? getAllSessionIds(layout) : [];
      if (paneIds.length > 0) {
        vscode.postMessage({ type: "paneEngaged", paneIds });
      }
    },
    true,
  );
  // Focus leaving the webview (to the editor, another view, or another app) means
  // a turn that ends here is no longer watched.
  window.addEventListener("blur", () => vscode.postMessage({ type: "blur" }));
  window.addEventListener("message", (event: MessageEvent) => {
    const msg = event.data;
    if (!msg || typeof msg.type !== "string") {
      return;
    }
    const typed = msg as ExtensionToWebViewMessage;
    if (typed.type === "init") {
      handleInit(typed);
    } else {
      routeMessage(typed);
    }
  });
  window.addEventListener("resize", () => {
    resizeCoordinator.debouncedFit();
  });
  themeManager.startWatching(() => {
    themeManager.applyToAll(store.terminals.values());
  });
  vscode.postMessage({ type: "ready" });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}
