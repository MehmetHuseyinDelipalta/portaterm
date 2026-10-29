import * as vscode from "vscode";
import { PINNED_TAB_CLOSE_REFUSED } from "../session/closeGates";
import { confirmKill } from "../session/killConfirmation";
import type { PaneEvidenceStore } from "../session/PaneEvidenceStore";
import type { SessionManager } from "../session/SessionManager";
import {
  affectsWorktreeRowActivation,
  readTerminalConfig,
  readTerminalSettings,
  readWorktreeRowActivation,
} from "../settings/SettingsReader";
import type {
  ExtensionToWebViewMessage,
  ThemeChangedMessage,
  VaultContinueSessionMessage,
  VaultLaunchCapability,
  WebViewToExtensionMessage,
} from "../types/messages";
import { isWorktreeMessage } from "../types/messages";
import { createTrackedPathResolver, type ResolvedPathMemo } from "../utils/resolvedPathMemo";
import { buildContinuationPrompt } from "../vault/ContinuationPrompt";
import type { VaultRefreshHint } from "../vault/cacheTypes";
import { MAX_CONTINUATION_INSTRUCTION } from "../vault/continuationLimits";
import type { ContinuationTarget, LaunchMode } from "../vault/LaunchBuilder";
import { resolveAssistantMessageRef } from "../vault/messageText";
import { agentKindForExecutable, detectLaunchTargets } from "../vault/registry";
import type { VaultSessionEntry } from "../vault/types";
import type { CreateSessionOptions, VaultLauncher } from "../vault/VaultLauncher";
import type { VaultService } from "../vault/VaultService";
import { handlePasteClipboardImage, handlePasteOsClipboardImage, readImageFromOsClipboard } from "./clipboardImageSync";
import { FileTreeHost } from "./fileTreeHost";
import type { WatcherPool } from "./fsWatcherPool";
import type { GitDecorationProvider } from "./gitDecorationProvider";
import { affectsHoverPreview, readHoverPreviewSettings, updateHoverPreviewSetting } from "./hoverPreviewSettings";
import { openExternalLink } from "./openExternalLink";
import { DEFAULT_FIND_FILES_MAX_RESULTS, openFileLink } from "./openFileLink";
import { handleInsertOsDropPaths } from "./osDropPaths";
import { isValidPreviewRequest } from "./previewValidation";
import { signalPaneEngaged, signalPaneInput, signalPanesPresented, signalSurfaceReady } from "./surfaceSignals";
import type { VaultWatchClient, VaultWatchCoordinator } from "./VaultWatchCoordinator";
import { exportVaultSessionMarkdown, vscodeVaultExportDeps } from "./vaultExportMarkdown";
import type { WorktreeHost, WorktreeSurface } from "./WorktreeHost";
import { getTerminalHtml } from "./webviewHtml";
import {
  applyVaultRename,
  handleFilePreviewRequest,
  handleSubagentPreviewRequest,
  handleVaultSessionDetailRequest,
  handleVaultSessionsRequest,
  PreviewTokenRegistry,
  postOnce,
  postWithRetry,
  pushVaultListAfterRename,
  type VaultRenameListener,
} from "./webviewRequests";

/**
 * Map VSCode's `ColorThemeKind` to the four-way `ThemeChangedMessage["kind"]`
 * union the webview popup understands. See `design.md` D8 for the table.
 */
export function themeKindFor(kind: vscode.ColorThemeKind): ThemeChangedMessage["kind"] {
  switch (kind) {
    case vscode.ColorThemeKind.Light:
      return "light";
    case vscode.ColorThemeKind.Dark:
      return "dark";
    case vscode.ColorThemeKind.HighContrastLight:
      return "hc-light";
    case vscode.ColorThemeKind.HighContrast:
      return "hc-dark";
    default:
      // Should be unreachable — the union is closed in vscode.d.ts. Fall back
      // to dark as the conservative default (VSCode itself defaults to dark).
      return "dark";
  }
}

interface PendingSplitChild {
  sessionId: string;
  sourcePaneId: string;
}

const MAX_PENDING_SPLIT_CHILDREN = 64;

/** A badge the workbench draws as no badge at all. See {@link TerminalViewProvider.setBadge}. */
const CLEARED_BADGE: vscode.ViewBadge = { value: 0, tooltip: "" };

/**
 * WebviewViewProvider for sidebar and panel terminal views.
 *
 * The same class is instantiated per view location (sidebar, panel).
 * Each instance manages its own set of terminal sessions through a unique viewId.
 * All session operations are delegated to the shared SessionManager.
 *
 * See: docs/design/webview-provider.md
 */
export class TerminalViewProvider implements vscode.WebviewViewProvider {
  public static readonly sidebarViewType = "portaterm.sidebar";
  public static readonly panelViewType = "portaterm.panel";

  /** The active webview view instance. Set after resolveWebviewView, cleared on dispose. */
  private _view: vscode.WebviewView | undefined;

  /** Whether the webview has sent the 'ready' message. Gates outbound messages. */
  private _ready = false;

  /** Badge to show on this view, kept so a view resolved later still carries it. */
  private _badge: vscode.ViewBadge | undefined;

  /** Callback fired when this provider receives user interaction (message from webview). */
  private _onDidReceiveInteraction: (() => void) | undefined;

  private _activeNavigation: { tabId: string; paneId: string } | null | undefined;
  /** Whether the webview holds keyboard focus, as its `focus` / `blur` messages last said. */
  private _webviewFocused = false;
  private readonly pendingSplitChildren = new Map<string, PendingSplitChild>();

  /**
   * Monotonic token for vault-list refreshes. Bumped per `requestVaultSessions`;
   * a refresh whose token is stale by the time it resolves is dropped so an
   * out-of-order refresh never overwrites a newer one (cache-vault-load D7).
   */
  private _vaultRefreshSeq = 0;

  /**
   * In-flight hover-preview cancellation tokens, keyed by `sessionId`. A new
   * `requestFilePreview` for the same `sessionId` cancels + disposes the
   * prior entry before starting. Cleared on closeTab / requestCloseSplitPane
   * and on webview dispose.
   *
   * See: asimov/changes/add-hover-file-preview/design.md D9, D10
   */
  private readonly _previewTokens = new PreviewTokenRegistry();

  /** Per-resolved-webview vault watcher client owned by the shared coordinator. */
  private _vaultWatchClient: VaultWatchClient | undefined;

  /**
   * Shared file-tree wiring (rootGeneration counter, workspaceRoot getter,
   * onDidChangeWorkspaceFolders subscription, message dispatch). Same
   * instance lives on the editor provider; both delegate through it so the
   * three providers never drift out of sync. The optional
   * `gitDecorationProvider` is shared across all three providers — passing
   * the same singleton lets every webview see the same revision sequence.
   * See: design.md D10.
   */
  private readonly fileTreeHost: FileTreeHost;

  /** Public for external readers (extension.ts ctx commands). Forwarded to fileTreeHost. */
  get rootGeneration(): number {
    return this.fileTreeHost.rootGeneration;
  }

  /** Public for external readers. Forwarded to fileTreeHost. */
  get workspaceRoot(): string | null {
    return this.fileTreeHost.workspaceRoot;
  }

  /** Public accessor for the current webview view. */
  get view(): vscode.WebviewView | undefined {
    return this._view;
  }

  /** True when the view is on screen and its webview holds keyboard focus. */
  get hasFocus(): boolean {
    return this._webviewFocused && this._view?.visible === true;
  }

  /**
   * Set (or clear, with `undefined`) the badge on this view's container icon.
   *
   * A clear is written as a zero badge, which the workbench hides, rather than
   * as `undefined`: Cursor left the last count on the icon when a live view's
   * badge was set to `undefined`, so a wait the user had already answered kept
   * its `1` until the window reloaded.
   */
  setBadge(badge: vscode.ViewBadge | undefined): void {
    this._badge = badge;
    if (this._view) {
      this._view.badge = badge ?? CLEARED_BADGE;
    }
  }

  /** Register a callback to be notified when the user interacts with this view. */
  set onDidReceiveInteraction(callback: (() => void) | undefined) {
    this._onDidReceiveInteraction = callback;
  }

  /**
   * The vault entries pinned tabs are running now. Changes are broadcast by the
   * extension; this answers a list request so a vault that opens later starts
   * from the current set rather than waiting for the next change.
   */
  pinnedVaultEntryIds: (() => string[]) | undefined;

  /** The vault entries some live pane is running now, and those panes; answered like `pinnedVaultEntryIds`. */
  openVaultSessions: (() => { entryIds: string[]; panesByEntry: Record<string, string[]> }) | undefined;

  /**
   * Focus the live pane already running a vault entry, wherever it lives;
   * resolves `false` when none does. Wired by the extension, which owns both
   * the pane identities and the reveal of another surface.
   */
  focusLiveVaultSession: ((entryId: string) => Promise<boolean>) | undefined;

  /**
   * Told after this surface renamed a vault session, with the normalized name
   * (`null` = cleared) and whether the agent's own store took it. Wired by the
   * extension, which owns the tabs running the session and the other surfaces.
   */
  onVaultRenamed: VaultRenameListener | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly sessionManager: SessionManager,
    private readonly location: "sidebar" | "panel" = "sidebar",
    gitDecorationProvider: GitDecorationProvider | null = null,
    watcherPool: WatcherPool | null = null,
    /** AI coding vault — null in contexts where the vault is not wired (tests). */
    private readonly vaultService: VaultService | null = null,
    private readonly vaultLauncher: VaultLauncher | null = null,
    private readonly vaultWatchCoordinator: VaultWatchCoordinator | null = null,
    /** Window-scoped worktree tree — null in contexts where it is not wired (tests). */
    private readonly worktreeHost: WorktreeHost | null = null,
    /**
     * Window-scoped pane evidence — null in contexts where it is not wired
     * (tests). Reports flow here whatever body this surface is showing.
     */
    private readonly paneEvidence: PaneEvidenceStore | null = null,
    /**
     * The window's shared path memo. Each host takes its own claim over it, so
     * the webview can compare containment against where the root resolves —
     * absent, every comparison stays lexical (D6, round-2 B1).
     */
    pathMemo: ResolvedPathMemo | null = null,
  ) {
    this.fileTreeHost = new FileTreeHost(
      gitDecorationProvider,
      watcherPool,
      pathMemo ? createTrackedPathResolver(pathMemo) : null,
    );
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;
    webviewView.badge = this._badge;

    // 1. Configure webview options
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };

    // 2. Set HTML content using shared utility
    webviewView.webview.html = getTerminalHtml(webviewView.webview, this.extensionUri, this.location);

    // 3. Wire message handler and lifecycle handlers
    const disposables: vscode.Disposable[] = [];
    let vaultWatchClient: VaultWatchClient | undefined;

    // This surface's identity to the worktree host: it carries the visibility
    // flag, so the object must be the same one across attach and every message.
    const worktreeSurface: WorktreeSurface = {
      isReady: () => this._ready,
      post: (msg) => {
        if (msg.type === "worktreeTreeResponse") {
          const linked = new Set(
            msg.tree?.repos.flatMap((repo) => repo.worktrees.filter((wt) => wt.kind === "linked").map((wt) => wt.id)) ??
              [],
          );
          this.sessionManager.reconcileWorktreeOwners(this.getViewId(), linked);
        }
        this.safePostMessage(webviewView.webview, msg);
      },
      // A pane can only be created by the provider that owns the view, so this
      // capability lives on the surface rather than among the host's injected
      // ones. The cwd arrives already resolved by the host — it is a worktree's
      // own path, never an id the webview sent (design.md D2).
      openTerminal: async (cwd, worktreeId) => {
        this.newTerminalAt(webviewView.webview, cwd, worktreeId);
      },
      // Same reason as `openTerminal`: the host resolves WHAT to run and where,
      // and only the provider owning this view can hold the pane it runs in.
      launchAgent: async (options) => {
        this.openSessionTab(options, webviewView.webview);
      },
    };

    disposables.push(
      webviewView.webview.onDidReceiveMessage((msg: unknown) => {
        this.handleMessage(msg, webviewView, vaultWatchClient, worktreeSurface);
      }),
    );

    // 4a. Wire theme-change bridge — keep the popup-rendering theme in sync
    // with the user's active VSCode color theme.
    // See: asimov/changes/add-hover-file-preview/design.md D8
    disposables.push(
      vscode.window.onDidChangeActiveColorTheme((theme) => {
        if (!this._ready) {
          // onReady posts the initial theme; skip until then.
          return;
        }
        this.safePostMessage(webviewView.webview, {
          type: "themeChanged",
          kind: themeKindFor(theme.kind),
        } satisfies ThemeChangedMessage);
      }),
    );

    // 4a-bis. Wire hover-preview settings bridge — re-post on every change to
    // `portaterm.hoverPreview.*` so the webview controller / popup
    // pick up new debounce / wrap / disabled toggles without reload.
    // See: asimov/changes/add-hover-file-preview/design.md D17
    disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!affectsHoverPreview(event) || !this._ready) {
          return;
        }
        this.safePostMessage(webviewView.webview, {
          type: "hoverPreviewSettings",
          settings: readHoverPreviewSettings(),
        });
      }),
    );

    // 4a-quater. Worktree row-activation bridge — the panel's neighbours are all
    // live on configuration change, so this one is too rather than asking for a
    // reload (design.md D5).
    disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!affectsWorktreeRowActivation(event) || !this._ready) {
          return;
        }
        this.safePostMessage(webviewView.webview, {
          type: "worktreeRowActivation",
          activation: readWorktreeRowActivation(),
        });
      }),
    );

    // 4a-ter. Workspace-folder bridge — delegated to fileTreeHost so the
    // sidebar / panel / editor providers stay in lockstep.
    disposables.push(
      this.fileTreeHost.attach({
        isReady: () => this._ready,
        post: (msg) => this.safePostMessage(webviewView.webview, msg),
      }),
    );

    // 4a-quater. Worktree tree — one host per window, broadcast to every
    // surface that says it is showing the view. Attaching costs no git call.
    const worktreeAttachment = this.worktreeHost?.attach(worktreeSurface);
    if (worktreeAttachment) {
      // Seeded rather than left to the first change: a view resolved while
      // already on screen never fires a visibility event, and would sit silent.
      worktreeAttachment.setDisplayed(webviewView.visible);
      disposables.push(worktreeAttachment);
    }

    // 4b. Wire visibility handler (for deferred resize on re-show + output pause/resume)
    disposables.push(
      webviewView.onDidChangeVisibility(() => {
        const viewId = this.getViewId();
        // The worktree host pushes only to a surface the window is displaying;
        // `retainContextWhenHidden` means the webview's own declaration cannot
        // tell it that (audit B1).
        worktreeAttachment?.setDisplayed(webviewView.visible);
        if (webviewView.visible) {
          // Resume output flushing when view becomes visible
          this.sessionManager.resumeOutputForView(viewId);
          if (this._ready) {
            this.safePostMessage(webviewView.webview, { type: "viewShow" });
          }
        } else {
          // Pause output flushing when view becomes hidden
          this.sessionManager.pauseOutputForView(viewId);
        }
      }),
    );

    // 4c. Attach one watcher client for this resolved webview. The shared
    // coordinator owns its store/follow subscriptions and timers.
    this._vaultWatchClient?.dispose();
    vaultWatchClient = this.vaultWatchCoordinator?.attach({
      refreshList: (hint) => {
        void this.autoRefreshVaultList(webviewView.webview, hint);
      },
      postFollowDetail: (entryId, detail) => {
        this.safePostMessage(webviewView.webview, {
          type: "vaultSessionDetailResponse",
          entryId,
          detail,
          followUpdate: true,
        });
      },
    });
    this._vaultWatchClient = vaultWatchClient;

    // 5. Wire dispose handler — clean up subscriptions but preserve sessions for re-creation.
    // Sessions are anchored to the Extension Host lifecycle, not the WebView lifecycle.
    // They will be restored when resolveWebviewView is called again.
    webviewView.onDidDispose(() => {
      for (const d of disposables) {
        d.dispose();
      }
      // Cancel any in-flight preview tokens — see design.md D10. Disposal is
      // owned by the handlers.
      this._previewTokens.cancelAll();
      this.rollbackAllPendingSplitChildren();
      // Release only the watcher client attached to this resolved webview.
      vaultWatchClient?.dispose();
      if (this._vaultWatchClient === vaultWatchClient) {
        this._vaultWatchClient = undefined;
      }
      // Pause output for the view — sessions survive but don't flush to a disposed webview
      this.sessionManager.pauseOutputForView(this.getViewId());
      signalPanesPresented(this.getViewId(), undefined);
      this._view = undefined;
      this._ready = false;
      this._webviewFocused = false;
      // Remove from the focus-recency stack so getLastFocusedProvider doesn't
      // pin a disposed provider. See `.reviews/round-1.md` W2.
      this.unmarkFocused();
    });
  }

  /**
   * Handle a hover-preview request. Supersedes any prior in-flight request for
   * the same session via the cancellation-token map.
   *
   * See: asimov/changes/add-hover-file-preview/design.md D9
   */
  private async handleRequestFilePreview(
    message: Extract<WebViewToExtensionMessage, { type: "requestFilePreview" }>,
    webview: vscode.Webview,
  ): Promise<void> {
    await handleFilePreviewRequest(message, {
      webview,
      sessionManager: this.sessionManager,
      tokens: this._previewTokens,
      logSuffix: "",
    });
  }

  /**
   * Serve the vault list with stale-while-revalidate (cache-vault-load D1): post
   * the persisted cache immediately (when present) for an instant render, then
   * refresh the agents' on-disk stores incrementally and post the reconciled
   * list. The on-disk stores remain the source of truth — the cache is only an
   * accelerator. A refresh superseded by a newer request is dropped (D7).
   */
  private async handleRequestVaultSessions(webview: vscode.Webview): Promise<void> {
    if (!this.vaultService) {
      return;
    }
    if (this.pinnedVaultEntryIds) {
      this.safePostMessage(webview, { type: "vaultPinnedSessions", entryIds: this.pinnedVaultEntryIds() });
    }
    if (this.openVaultSessions) {
      this.safePostMessage(webview, { type: "vaultOpenSessions", ...this.openVaultSessions() });
    }
    // Provider-owned: the rename push (`vaultRenameSession`) and the watcher
    // both drive this same counter, so it cannot move into the shared module.
    const token = ++this._vaultRefreshSeq;
    await handleVaultSessionsRequest({
      webview,
      vaultService: this.vaultService,
      isCurrent: () => token === this._vaultRefreshSeq,
      logSuffix: "",
    });
  }

  /**
   * Resolve a vault entry into createSession options and launch it as a new
   * VISIBLE terminal — mirrors the `createTab` flow (createSession + post
   * `tabCreated`) so the resumed agent appears as a selectable tab. A
   * resolve/launch failure surfaces an error notice rather than a broken
   * terminal (D5/D6).
   */
  private async handleVaultLaunch(entryId: string, mode: LaunchMode, webview: vscode.Webview): Promise<void> {
    if (!this.vaultLauncher) {
      return;
    }
    try {
      // A second resume of a session a pane already runs would start another
      // agent on the same transcript; the user wanted the one they have.
      if (mode === "resume" && (await this.focusLiveVaultSession?.(entryId)) === true) {
        return;
      }
      await this.launchVaultSession(entryId, mode, webview);
    } catch (err) {
      console.error("[Portaterm] Failed to launch vault session:", err);
      void this.safeSendWithRetry(webview, {
        type: "error",
        message: err instanceof Error ? err.message : "Failed to launch AI session",
        severity: "error",
      });
    }
  }

  /** Resolve a launch and open it as a new tab. Throws; callers own the error notice. */
  private async launchVaultSession(
    entryId: string,
    mode: LaunchMode,
    webview: vscode.Webview,
    prompt?: string,
    target?: ContinuationTarget,
  ): Promise<void> {
    if (!this.vaultLauncher) {
      return;
    }
    const options = await this.vaultLauncher.resolve(entryId, mode, prompt, target);
    this.openSessionTab(
      { ...options, worktreeId: await this.worktreeHost?.terminalOwnerForCwd?.(options.cwd) },
      webview,
    );
  }

  /**
   * Open resolved session options as a new tab.
   *
   * Shared by every launch this provider performs — a continuation, and the
   * worktree surface's own launches — so a fresh agent lands in a pane the same
   * way a resumed one does rather than in a second, similar-looking one.
   *
   * When the active tab is a fresh shell nobody has typed into, the launch
   * takes that tab over instead of opening another beside it.
   */
  private openSessionTab(opts: CreateSessionOptions, webview: vscode.Webview): void {
    const idleTabId = this.sessionManager.untouchedActiveTab(this.getViewId(), opts.worktreeId);
    if (idleTabId !== undefined && this.sessionManager.relaunchInPlace(idleTabId, opts)) {
      void this.safeSendWithRetry(webview, { type: "worktreeActivatePane", paneId: idleTabId });
      return;
    }
    const newSessionId = this.sessionManager.createSession(this.getViewId(), webview, {
      shell: opts.shell,
      shellArgs: opts.shellArgs,
      cwd: opts.cwd,
      env: opts.env,
      isAgentLaunch: opts.isAgentLaunch,
      vaultEntryId: opts.vaultEntryId,
      worktreeId: opts.worktreeId,
    });
    const newSession = this.sessionManager.getSession(newSessionId);
    if (newSession) {
      void this.safeSendWithRetry(webview, {
        type: "tabCreated",
        tabId: newSessionId,
        name: newSession.name,
        customName: newSession.customName,
        worktreeId: newSession.worktreeId,
      });
    }
  }

  /**
   * Continue a stored session (D9/D10): compose the handoff prompt around the
   * instruction the reader confirmed and launch a NEW session seeded with it. The
   * stored session is never modified or resumed.
   */
  private async handleVaultContinue(msg: VaultContinueSessionMessage, webview: vscode.Webview): Promise<void> {
    if (!this.vaultService || !this.vaultLauncher) {
      return;
    }
    const { entryId } = msg;
    try {
      if (msg.instruction.length > MAX_CONTINUATION_INSTRUCTION) {
        throw new Error(`Instruction exceeds ${MAX_CONTINUATION_INSTRUCTION} characters.`);
      }
      const entry = await this.vaultService.getEntry(entryId);
      if (!entry) {
        throw new Error("Session not found.");
      }
      let anchorRef: string | undefined;
      if (msg.anchorRef) {
        const resolved = await this.vaultService.readMessageRecord(entryId, msg.anchorRef);
        if (!resolved.ok) {
          throw new Error(
            resolved.reason === "too-large"
              ? "Continuation anchor is too large."
              : "Continuation anchor was not found.",
          );
        }
        anchorRef = resolveAssistantMessageRef(entry.agent, resolved.line, msg.anchorRef) ?? undefined;
        if (!anchorRef) {
          throw new Error("Continuation anchor is not an assistant message.");
        }
      }
      const prompt = buildContinuationPrompt(entry, {
        instruction: msg.instruction,
        confirmIntent: msg.confirmIntent,
        ...(anchorRef ? { anchorRef } : {}),
      });
      if (!prompt) {
        throw new Error("Could not compose a handoff prompt for this session.");
      }
      await this.launchVaultSession(entryId, "continue", webview, prompt, {
        ...(msg.agent ? { agent: msg.agent } : {}),
        ...(msg.permissionChoiceId ? { permissionChoiceId: msg.permissionChoiceId } : {}),
      });
    } catch (err) {
      console.error("[Portaterm] Failed to continue vault session:", err);
      void this.safeSendWithRetry(webview, {
        type: "error",
        message: err instanceof Error ? err.message : "Failed to continue AI session",
        severity: "error",
      });
    }
  }

  /**
   * On-demand session detail for the preview overlay. The webview sends the
   * entry id ONLY; `getDetail` resolves the session by id within the agent's
   * store (no full list, no cache — D3). The reply echoes `entryId` so the
   * webview can drop a stale response (D3 stale-render guard).
   */
  private async handleRequestVaultSessionDetail(
    entryId: string,
    webview: vscode.Webview,
    limit?: number,
    requestId?: string,
  ): Promise<void> {
    if (!this.vaultService) {
      return;
    }
    await handleVaultSessionDetailRequest({
      webview,
      vaultService: this.vaultService,
      entryId,
      limit,
      requestId,
    });
  }

  /**
   * Resolve one message back to its stored record for the per-message Raw copy
   * (improve-vault-transcript-messages D5). Both failure modes reply with an
   * error rather than silence, so the webview can decline to confirm the copy.
   */
  /**
   * Which agents this host can launch into (D11) — probed, not assumed, so a
   * dialog cannot offer an agent that would fail at spawn.
   *
   * The reply echoes the capability it answers: continuing and starting return
   * different agent sets, and two dialogs listen on this one message.
   */
  private async handleRequestVaultLaunchTargets(
    webview: vscode.Webview,
    capability: VaultLaunchCapability = "continue",
  ): Promise<void> {
    const targets = await detectLaunchTargets(capability);
    void this.safeSendWithRetry(webview, { type: "vaultLaunchTargets", capability, targets });
  }

  /**
   * Which agents the vault's quick launch can start. Empty without a workspace
   * folder: the launch has nowhere to run, and an offer of one would be refused.
   */
  private async handleRequestVaultStartTargets(webview: vscode.Webview): Promise<void> {
    const agents =
      this.vaultLauncher && this.workspaceRoot !== null
        ? (await detectLaunchTargets("start")).map((target) => target.agent)
        : [];
    void this.safeSendWithRetry(webview, { type: "vaultStartTargets", agents });
  }

  /**
   * Start a fresh session of `agent` in the workspace root — the vault's quick
   * launch. The webview names only the agent; the folder is resolved here, and
   * no posture is passed, so the agent runs under its own default.
   *
   * Admitted against a fresh probe rather than the list the panel was given:
   * that list is not quoted back, and a request for an agent this host would not
   * advertise is not run just because the launcher knows its name.
   */
  private async handleVaultStartAgent(agent: string, webview: vscode.Webview): Promise<void> {
    const cwd = this.workspaceRoot;
    if (!this.vaultLauncher || cwd === null) {
      return;
    }
    try {
      const targets = await detectLaunchTargets("start");
      if (!targets.some((target) => target.agent === agent)) {
        return;
      }
      const options = await this.vaultLauncher.startAgent(agent, cwd, {});
      this.openSessionTab(
        { ...options, worktreeId: await this.worktreeHost?.terminalOwnerForCwd?.(options.cwd) },
        webview,
      );
    } catch (err) {
      console.error("[Portaterm] Failed to start agent:", err);
      void this.safeSendWithRetry(webview, {
        type: "error",
        message: err instanceof Error ? err.message : "Failed to start the agent",
        severity: "error",
      });
    }
  }

  private async handleRequestVaultMessageRecord(
    entryId: string,
    msgRef: string,
    webview: vscode.Webview,
  ): Promise<void> {
    if (!this.vaultService) {
      return;
    }
    const fail = (error: string): void => {
      void this.safeSendWithRetry(webview, { type: "vaultMessageRecordResponse", entryId, msgRef, error });
    };
    try {
      const res = await this.vaultService.readMessageRecord(entryId, msgRef);
      if (res.ok) {
        void this.safeSendWithRetry(webview, {
          type: "vaultMessageRecordResponse",
          entryId,
          msgRef,
          record: res.line,
        });
      } else {
        fail(res.reason === "too-large" ? "That message is too large to copy." : "Message record not found.");
      }
    } catch (err) {
      fail(err instanceof Error ? err.message : "Failed to read the message record");
    }
  }

  /**
   * Rename a vault session from this surface's list or preview header. The
   * write itself is {@link applyVaultRename}; this surface then pushes its own
   * list, and tells the extension (`onVaultRenamed`) so the tabs running the
   * session take the name and the other surfaces refresh.
   */
  private async handleVaultRenameSession(entryId: string, name: string, webview: vscode.Webview): Promise<void> {
    if (!this.vaultService) {
      return;
    }
    const applied = await applyVaultRename(this.vaultService, entryId, name);
    this.onVaultRenamed?.(entryId, applied.name, applied.native, this);
    await this.pushVaultListAfterRename(webview, applied.native);
  }

  /**
   * Push this surface's vault list after a rename made elsewhere — a tab rename
   * mirrored into the vault, or another surface's row edit. No view, nothing to
   * draw: the next open reads the store anyway.
   */
  refreshVaultAfterRename(native: boolean): void {
    if (this._view) {
      void this.pushVaultListAfterRename(this._view.webview, native);
    }
  }

  /** Routes through `_vaultRefreshSeq` so the rename push wins over an older refresh. */
  private async pushVaultListAfterRename(webview: vscode.Webview, native: boolean): Promise<void> {
    if (!this.vaultService) {
      return;
    }
    const token = ++this._vaultRefreshSeq;
    await pushVaultListAfterRename({
      webview,
      vaultService: this.vaultService,
      native,
      isCurrent: () => token === this._vaultRefreshSeq,
    });
  }

  /** Refresh the list from disk and push it, dropping the result if a newer
   *  request (manual open / rename) has taken ownership (`_vaultRefreshSeq`). */
  private async autoRefreshVaultList(webview: vscode.Webview, hint?: VaultRefreshHint): Promise<void> {
    if (!this.vaultService) {
      return;
    }
    const token = ++this._vaultRefreshSeq;
    try {
      const result = await this.vaultService.refresh(hint ? { hint } : undefined);
      if (token !== this._vaultRefreshSeq) {
        return;
      }
      void this.safeSendWithRetry(
        webview,
        { type: "vaultSessionsResponse", result, fromCache: false },
        2,
        () => token !== this._vaultRefreshSeq,
      );
    } catch (err) {
      console.error("[Portaterm] Vault auto-refresh failed:", err);
    }
  }

  /**
   * Resolve a terminal pane's REAL current working directory for the vault
   * "This folder only" filter. Prefers the live OS query (lsof/`/proc`, bounded
   * ≤500 ms), then the shell-integration-tracked cwd, then the spawn cwd; null
   * when none resolve (e.g. Windows / unknown pane). Resolves by `sessionId`
   * from our own SessionManager — never trusts a webview-supplied path. Echoes
   * `sessionId` so the webview can drop a reply for a no-longer-active pane.
   */
  private async handleRequestVaultContextCwd(sessionId: string, webview: vscode.Webview): Promise<void> {
    const cwd =
      (await this.sessionManager.getLiveCwd(sessionId)) ??
      this.sessionManager.getCurrentCwd(sessionId) ??
      this.sessionManager.getInitialCwd(sessionId) ??
      null;
    void this.safeSendWithRetry(webview, { type: "vaultContextCwd", sessionId, cwd });
  }

  /**
   * This surface retries each reply where the editor posts once (D5 OBL-4) —
   * a sidebar webview is more often not yet ready when the reply lands.
   */
  private async handleRequestSubagentPreview(
    message: Extract<WebViewToExtensionMessage, { type: "requestSubagentPreview" }>,
    webview: vscode.Webview,
  ): Promise<void> {
    await handleSubagentPreviewRequest(message, {
      sessionManager: this.sessionManager,
      post: (msg) => {
        void postWithRetry(webview, msg);
      },
    });
  }

  /**
   * Resolve one vault entry from current source metadata for a context-menu action.
   * The webview supplies only an id; paths and capabilities are revalidated host-side.
   */
  private async resolveVaultEntry(entryId: string): Promise<VaultSessionEntry | undefined> {
    return (await this.vaultService?.getEntry(entryId)) ?? undefined;
  }

  /** Reveal the session's transcript file in the OS file manager. */
  private async handleVaultRevealInOS(entryId: string): Promise<void> {
    const sessionPath = (await this.resolveVaultEntry(entryId))?.sessionPath;
    if (!sessionPath) {
      return; // DB-backed session (no file) → no-op
    }
    await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(sessionPath));
  }

  /** Open the session's transcript file in an editor. */
  private async handleVaultOpenSessionFile(entryId: string, webview: vscode.Webview): Promise<void> {
    const sessionPath = (await this.resolveVaultEntry(entryId))?.sessionPath;
    if (!sessionPath) {
      return;
    }
    try {
      await vscode.window.showTextDocument(vscode.Uri.file(sessionPath), { preview: true });
    } catch (err) {
      void this.safeSendWithRetry(webview, {
        type: "error",
        message: err instanceof Error ? err.message : "Failed to open session file",
        severity: "error",
      });
    }
  }

  /** Open the session's recorded working directory in the OS file manager. */
  private async handleVaultOpenWorkingDir(entryId: string): Promise<void> {
    const cwd = (await this.resolveVaultEntry(entryId))?.cwd;
    if (!cwd) {
      return;
    }
    await vscode.env.openExternal(vscode.Uri.file(cwd));
  }

  /** Build the session's resume command and copy it to the clipboard (host-side). */
  private async handleVaultCopyResumeCommand(entryId: string, webview: vscode.Webview): Promise<void> {
    if (!this.vaultLauncher) {
      return;
    }
    try {
      // Through the launcher so the copy passes the same capability + identity
      // gates as Resume itself; a rejected proof leaves the clipboard untouched.
      await vscode.env.clipboard.writeText(await this.vaultLauncher.buildResumeCommand(entryId));
    } catch (err) {
      void this.safeSendWithRetry(webview, {
        type: "error",
        message: err instanceof Error ? err.message : "Failed to copy resume command",
        severity: "error",
      });
    }
  }

  /** Copy the session's transcript file path to the clipboard (host-side). */
  private async handleVaultCopyFilePath(entryId: string): Promise<void> {
    const sessionPath = (await this.resolveVaultEntry(entryId))?.sessionPath;
    if (!sessionPath) {
      return;
    }
    await vscode.env.clipboard.writeText(sessionPath);
  }

  /**
   * Route incoming webview messages to appropriate handlers.
   *
   * See: docs/design/webview-provider.md#§8, docs/design/message-protocol.md#§10
   */
  /**
   * One new terminal tab in this view. `cwd` overrides the configured working
   * directory — the worktree panel's "Open Terminal Here" passes a path the
   * HOST resolved, and everything else takes the setting.
   */
  private newTerminalAt(webview: vscode.Webview, cwd?: string, worktreeId?: string): void {
    const viewId = this.getViewId();
    const settings = readTerminalSettings();
    try {
      const newSessionId = this.sessionManager.createSession(viewId, webview, {
        shell: settings.shell,
        shellArgs: settings.shellArgs,
        cwd: cwd ?? settings.cwd,
        worktreeId,
      });
      const newSession = this.sessionManager.getSession(newSessionId);
      if (newSession) {
        void this.safeSendWithRetry(webview, {
          type: "tabCreated",
          tabId: newSessionId,
          name: newSession.name,
          customName: newSession.customName,
          worktreeId: newSession.worktreeId,
        });
      }
    } catch (err) {
      console.error("[Portaterm] Failed to create tab:", err);
      void this.safeSendWithRetry(webview, {
        type: "error",
        message: err instanceof Error ? err.message : "Failed to create new terminal tab",
        severity: "error",
      });
    }
  }

  private handleMessage(
    msg: unknown,
    webviewView: vscode.WebviewView,
    vaultWatchClient?: VaultWatchClient,
    worktreeSurface?: WorktreeSurface,
  ): void {
    // Basic shape validation
    if (!msg || typeof msg !== "object" || !("type" in msg) || typeof (msg as { type: unknown }).type !== "string") {
      console.warn("[Portaterm] Invalid message from webview:", msg);
      return;
    }

    const message = msg as WebViewToExtensionMessage;

    // Notify that this provider received user interaction
    this._onDidReceiveInteraction?.();

    // Every worktree message, by membership rather than by a list kept here.
    // The switch below used to name them one by one, and the list already
    // failed once: a declared, posted, handled type reached neither provider
    // and its feature shipped inert (design.md D1).
    if (isWorktreeMessage(message)) {
      if (worktreeSurface) {
        // Window-scoped, so the host answers and broadcasts; this provider only
        // names which surface the message came from.
        this.worktreeHost?.handleMessage(worktreeSurface, message);
      }
      return;
    }

    try {
      switch (message.type) {
        case "ready":
          void this.onReady(webviewView);
          break;

        case "input":
          if (typeof message.tabId === "string" && typeof message.data === "string") {
            this.sessionManager.writeToSession(message.tabId, message.data);
            signalPaneInput(message.tabId, message.data);
          }
          break;

        case "insertOsDropPaths":
          if (
            typeof message.tabId === "string" &&
            Array.isArray(message.names) &&
            message.names.every((n: unknown) => typeof n === "string")
          ) {
            void handleInsertOsDropPaths(message.tabId, message.names, (tabId, data) =>
              this.sessionManager.writeToSession(tabId, data),
            );
          }
          break;

        case "pasteClipboardImage":
          if (typeof message.tabId === "string" && typeof message.data === "string") {
            const session = this.sessionManager.getSession(message.tabId);
            const agentKind = session?.isAgentLaunch ? agentKindForExecutable(session.shell) : undefined;
            void handlePasteClipboardImage(
              {
                tabId: message.tabId,
                mimeType: typeof message.mimeType === "string" ? message.mimeType : "image/png",
                data: message.data,
              },
              (tabId, data) => this.sessionManager.writeToSession(tabId, data),
              { agentKind, platform: process.platform },
            );
          }
          break;

        case "requestClipboardImagePreview":
          if (typeof message.tabId === "string") {
            // No agent gate: the CLI may be launched by hand (session.shell is the
            // plain shell, not the agent executable), so we can't detect "is an
            // agent" host-side. Preview-only — the CLI already received the image
            // natively (macOS Ctrl+V → \x16).
            const tabId = message.tabId;
            void readImageFromOsClipboard().then((img) => {
              this.safePostMessage(webviewView.webview, {
                type: "clipboardImagePreview",
                tabId,
                mimeType: img?.mimeType ?? "image/png",
                data: img?.data ?? "",
              });
            });
          }
          break;

        case "pasteOsClipboardImage":
          if (typeof message.tabId === "string") {
            const tabId = message.tabId;
            const session = this.sessionManager.getSession(tabId);
            const agentKind = session?.isAgentLaunch ? agentKindForExecutable(session.shell) : undefined;
            void handlePasteOsClipboardImage(tabId, (tid, data) => this.sessionManager.writeToSession(tid, data), {
              agentKind,
              platform: process.platform,
            }).then((img) => {
              if (img) {
                this.safePostMessage(webviewView.webview, {
                  type: "clipboardImagePreview",
                  tabId,
                  mimeType: img.mimeType,
                  data: img.data,
                });
              } else {
                this.safePostMessage(webviewView.webview, { type: "osClipboardPasteMiss", tabId });
              }
            });
          }
          break;

        case "resize":
          if (
            typeof message.tabId === "string" &&
            typeof message.cols === "number" &&
            typeof message.rows === "number" &&
            Number.isFinite(message.cols) &&
            Number.isFinite(message.rows)
          ) {
            this.sessionManager.resizeSession(message.tabId, message.cols, message.rows);
          }
          break;

        case "ack":
          if (typeof message.charCount === "number" && typeof message.tabId === "string") {
            this.sessionManager.handleAck(message.tabId, message.charCount);
          }
          break;

        case "scrollbackDump":
          if (
            typeof message.requestId === "string" &&
            typeof message.tabId === "string" &&
            typeof message.data === "string" &&
            typeof message.lineCount === "number" &&
            typeof message.truncated === "boolean"
          ) {
            this.sessionManager.handleScrollbackDump(message.requestId, message.tabId, {
              data: message.data,
              lineCount: message.lineCount,
              truncated: message.truncated,
              error: typeof message.error === "string" ? message.error : undefined,
            });
          }
          break;

        case "createTab": {
          this.newTerminalAt(webviewView.webview);
          break;
        }

        case "openVaultSettings":
          void vscode.commands.executeCommand("workbench.action.openSettings", "@ext:mhd.portaterm");
          break;

        case "requestVaultSessions":
          void this.handleRequestVaultSessions(webviewView.webview);
          break;

        case "vaultRenameSession":
          if (typeof message.entryId === "string" && typeof message.name === "string") {
            void this.handleVaultRenameSession(message.entryId, message.name, webviewView.webview);
          }
          break;

        case "vaultWatchSession":
          if (typeof message.entryId === "string" || message.entryId === null) {
            void vaultWatchClient?.watchSession(message.entryId);
          }
          break;

        case "vaultResume":
          if (typeof message.entryId === "string") {
            void this.handleVaultLaunch(message.entryId, "resume", webviewView.webview);
          }
          break;

        case "requestVaultSessionDetail":
          if (typeof message.entryId === "string") {
            void this.handleRequestVaultSessionDetail(
              message.entryId,
              webviewView.webview,
              typeof message.limit === "number" ? message.limit : undefined,
              typeof message.requestId === "string" ? message.requestId : undefined,
            );
          }
          break;

        case "vaultContinueSession":
          if (typeof message.entryId === "string" && typeof message.instruction === "string") {
            void this.handleVaultContinue(message, webviewView.webview);
          }
          break;

        case "requestVaultLaunchTargets":
          // Untrusted like every other inbound field: anything but the one known
          // alternative falls back to continue, which is what an older webview
          // (sending no capability at all) means.
          //
          // The two capabilities are answered by different owners: the host owns
          // the fresh-start answer because it also admits launches against it,
          // and an answer it did not give is an answer it cannot check.
          if (message.capability === "start") {
            if (worktreeSurface) {
              void this.worktreeHost?.publishLaunchTargets(worktreeSurface);
            }
            break;
          }
          void this.handleRequestVaultLaunchTargets(webviewView.webview, "continue");
          break;

        case "requestVaultStartTargets":
          void this.handleRequestVaultStartTargets(webviewView.webview);
          break;

        case "vaultStartAgent":
          if (typeof message.agent === "string") {
            void this.handleVaultStartAgent(message.agent, webviewView.webview);
          }
          break;

        case "requestVaultMessageRecord":
          if (typeof message.entryId === "string" && typeof message.msgRef === "string") {
            void this.handleRequestVaultMessageRecord(message.entryId, message.msgRef, webviewView.webview);
          }
          break;

        case "requestVaultContextCwd":
          if (typeof message.sessionId === "string") {
            void this.handleRequestVaultContextCwd(message.sessionId, webviewView.webview);
          }
          break;

        case "requestSubagentPreview":
          void this.handleRequestSubagentPreview(message, webviewView.webview);
          break;

        case "vaultRevealInOS":
          if (typeof message.entryId === "string") {
            void this.handleVaultRevealInOS(message.entryId);
          }
          break;

        case "vaultOpenSessionFile":
          if (typeof message.entryId === "string") {
            void this.handleVaultOpenSessionFile(message.entryId, webviewView.webview);
          }
          break;

        case "vaultOpenWorkingDir":
          if (typeof message.entryId === "string") {
            void this.handleVaultOpenWorkingDir(message.entryId);
          }
          break;

        case "vaultCopyResumeCommand":
          if (typeof message.entryId === "string") {
            void this.handleVaultCopyResumeCommand(message.entryId, webviewView.webview);
          }
          break;

        case "vaultCopyFilePath":
          if (typeof message.entryId === "string") {
            void this.handleVaultCopyFilePath(message.entryId);
          }
          break;

        case "vaultExportMarkdown":
          if (typeof message.entryId === "string" && this.vaultService) {
            void exportVaultSessionMarkdown(message.entryId, vscodeVaultExportDeps(this.vaultService));
          }
          break;

        case "switchTab":
          break;

        case "terminalNavigationCommitted": {
          const validPair =
            (typeof message.activeTabId === "string" && typeof message.activePaneId === "string") ||
            (message.activeTabId === null && message.activePaneId === null);
          if (
            validPair &&
            this.sessionManager.commitNavigation(this.getViewId(), message.activeTabId, message.activePaneId)
          ) {
            this._activeNavigation =
              message.activeTabId === null || message.activePaneId === null
                ? null
                : { tabId: message.activeTabId, paneId: message.activePaneId };
          }
          break;
        }

        case "closeTab":
          if (typeof message.tabId === "string") {
            const tabId = message.tabId;
            if (this.sessionManager.isPinned(tabId)) {
              void vscode.window.showInformationMessage(PINNED_TAB_CLOSE_REFUSED);
              break;
            }
            // Asked BEFORE anything is destroyed, and before the webview is told
            // to tear the tab down — the teardown is driven by `tabRemoved`, so
            // declining here leaves the tab exactly as it was.
            const panes = this.sessionManager.panesOfTab(tabId);
            void confirmKill(panes, "tab", this.paneEvidence, vscode.window).then((proceed) => {
              if (!proceed) {
                return;
              }
              for (const paneId of panes) {
                this.rollbackPendingSplitChildrenForSource(paneId);
              }
              this._previewTokens.cancel(tabId);
              this.sessionManager.destroySession(tabId);
              this.safePostMessage(webviewView.webview, {
                type: "tabRemoved",
                tabId,
              });
            });
          }
          break;

        case "renameTab":
          if (typeof message.tabId === "string") {
            this.sessionManager.renameSession(message.tabId, message.customName ?? null);
          }
          break;

        case "clear":
          if (typeof message.tabId === "string") {
            this.sessionManager.clearScrollback(message.tabId);
          }
          break;

        case "requestSplitSession": {
          const viewId = this.getViewId();
          const source = this.sessionManager.getSession(message.sourcePaneId);
          if (
            this.pendingSplitChildren.has(message.requestId) ||
            this.pendingSplitChildren.size >= MAX_PENDING_SPLIT_CHILDREN ||
            !source ||
            source.viewId !== viewId ||
            source.rootTabId !== message.sourceTabId
          ) {
            this.safePostMessage(webviewView.webview, {
              type: "error",
              message: "Split source is no longer available",
              severity: "error",
            });
            break;
          }
          const splitSettings = readTerminalSettings();
          try {
            const newSessionId = this.sessionManager.createSession(viewId, webviewView.webview, {
              isSplitPane: true,
              shell: splitSettings.shell,
              shellArgs: splitSettings.shellArgs,
              cwd: source.currentCwd ?? source.initialCwd ?? splitSettings.cwd,
              worktreeId: source.worktreeId,
              rootTabId: message.sourceTabId,
            });
            const newSession = this.sessionManager.getSession(newSessionId);
            if (!newSession) {
              break;
            }
            this.pendingSplitChildren.set(message.requestId, {
              sessionId: newSessionId,
              sourcePaneId: message.sourcePaneId,
            });
            void this.safeSendWithRetry(
              webviewView.webview,
              {
                type: "splitPaneCreated",
                requestId: message.requestId,
                sourceTabId: message.sourceTabId,
                sourcePaneId: message.sourcePaneId,
                newSessionId,
                newSessionName: newSession.name,
                direction: message.direction,
              },
              2,
              () => !this.pendingSplitChildren.has(message.requestId),
            ).then((delivered) => {
              const pending = this.pendingSplitChildren.get(message.requestId);
              if (!pending || pending.sessionId !== newSessionId) {
                return;
              }
              if (!delivered) {
                this.rollbackPendingSplitChild(message.requestId);
              }
            });
          } catch (err) {
            console.error("[Portaterm] Failed to create split session:", err);
            void this.safeSendWithRetry(webviewView.webview, {
              type: "error",
              message: err instanceof Error ? err.message : "Failed to create split terminal",
              severity: "error",
            });
          }
          break;
        }

        case "splitPaneAttachmentResult": {
          const pending = this.pendingSplitChildren.get(message.requestId);
          if (!pending) {
            break;
          }
          if (message.status === "attached") {
            if (pending.sessionId !== message.newSessionId) {
              break;
            }
            this.pendingSplitChildren.delete(message.requestId);
          } else if (message.newSessionId === undefined || pending.sessionId === message.newSessionId) {
            this.rollbackPendingSplitChild(message.requestId);
          }
          break;
        }

        case "requestCloseSplitPane": {
          if (typeof message.sessionId === "string") {
            this.rollbackPendingSplitChildrenForSource(message.sessionId);
            this._previewTokens.cancel(message.sessionId);
            this.sessionManager.destroySession(message.sessionId);
          }
          break;
        }

        case "requestClosePane":
          if (typeof message.sessionId === "string") {
            void vscode.commands.executeCommand("portaterm.ctx.closePane", { paneSessionId: message.sessionId });
          }
          break;

        case "toggleMaximizedPanel":
          if (this.location === "panel" && this._view === webviewView && webviewView.visible) {
            void vscode.commands.executeCommand("workbench.action.toggleMaximizedPanel").then(undefined, (err) => {
              console.warn("[Portaterm] Panel resize failed:", err);
              void vscode.window.showWarningMessage(
                "Could not resize the panel. Try Toggle Maximized Panel from the Command Palette.",
              );
            });
          }
          break;

        case "focus":
          this.markFocused();
          this._webviewFocused = true;
          break;

        case "blur":
          this._webviewFocused = false;
          break;

        case "paneEngaged":
          if (Array.isArray(message.paneIds) && message.paneIds.every((id) => typeof id === "string")) {
            signalPaneEngaged(message.paneIds);
          }
          break;

        case "openLink":
          if (typeof message.url === "string") {
            void openExternalLink(message.url);
          }
          break;

        case "openFile":
          if (typeof message.path === "string" && typeof message.sessionId === "string") {
            void openFileLink(message, {
              getInitialCwd: (id) => this.sessionManager.getInitialCwd(id),
              getCurrentCwd: (id) => this.sessionManager.getCurrentCwd(id),
              getLiveCwd: (id) => this.sessionManager.getLiveCwd(id),
              workspaceFolders: vscode.workspace.workspaceFolders,
              stat: (uri) => vscode.workspace.fs.stat(uri),
              findFiles: (include, exclude, maxResults, token) =>
                vscode.workspace.findFiles(include, exclude, maxResults, token),
              showWarning: vscode.window.showWarningMessage,
              showTextDocument: vscode.window.showTextDocument,
              showQuickPick: vscode.window.showQuickPick,
              getFileSearchMaxResults: () =>
                vscode.workspace
                  .getConfiguration("portaterm.fileSearch")
                  .get<number>("maxResults", DEFAULT_FIND_FILES_MAX_RESULTS),
            });
          }
          break;

        case "requestFilePreview":
          if (isValidPreviewRequest(message)) {
            void this.handleRequestFilePreview(message, webviewView.webview);
          }
          break;

        case "request-read-directory":
        case "request-open-folder":
        case "request-file-tree-search":
        case "cancel-file-tree-search":
        case "request-subscribe-fs-changes":
        case "request-unsubscribe-fs-changes":
        case "file-tree-reveal-in-os":
        case "file-tree-copy-path":
        case "file-tree-copy-relative-path":
        case "file-tree-delete":
          // File-tree messages are dispatched by FileTreeHost so the
          // sidebar / panel / editor providers share one wiring. See
          // providers/fileTreeHost.ts.
          this.fileTreeHost.handleMessage(message, (response) => this.safePostMessage(webviewView.webview, response));
          break;

        case "paneEvidence":
          // Deliberately NOT gated on worktree-view visibility: presence is
          // window state, and evidence about a pane is just as true while the
          // user is looking at the sessions body. The store validates the
          // payload and ignores ids it holds no pane for, so the surface it
          // arrived from stops mattering here.
          this.paneEvidence?.report(message);
          break;

        case "presentedPanes":
          if (Array.isArray(message.paneIds) && message.paneIds.every((id) => typeof id === "string")) {
            signalPanesPresented(this.getViewId(), new Set(message.paneIds));
          }
          break;

        case "updateHoverPreviewSetting":
          // Webview-driven setting update (e.g. footer toggle). Persist into
          // vscode's user-scope configuration; the change fires
          // onDidChangeConfiguration which re-posts `hoverPreviewSettings` back
          // to the webview. See: design.md D17.
          if (
            typeof (message as { key?: unknown }).key === "string" &&
            (typeof (message as { value?: unknown }).value === "boolean" ||
              typeof (message as { value?: unknown }).value === "number")
          ) {
            void updateHoverPreviewSetting(
              (message as { key: string }).key as Parameters<typeof updateHoverPreviewSetting>[0],
              (message as { value: boolean | number }).value,
            ).catch((err) => {
              console.warn("[Portaterm] updateHoverPreviewSetting failed:", err);
            });
          }
          break;

        default:
          // Silently ignore unknown message types
          break;
      }
    } catch (err) {
      console.error(`[Portaterm] Error handling message ${message.type}:`, err);
      // Don't rethrow — isolated error shouldn't crash the provider
    }
  }

  /**
   * Handle the 'ready' message from the webview.
   * On first creation: creates a session via SessionManager and sends 'init'.
   * On re-creation: restores existing sessions with scrollback data.
   *
   * See: specs/ipc-wiring/spec.md#Ready-Handshake-Wiring
   * See: specs/view-lifecycle-resilience/spec.md#Scrollback-Cache-Replay-on-Webview-Re-creation
   */
  /**
   * Re-send the row-activation setting after `init` went out. `_ready` flips
   * before init is delivered and the webview builds its worktree controller only
   * when init arrives, so a configuration change landing in between is posted to
   * a controller that does not exist yet and then overwritten by the value init
   * captured earlier. Re-sending closes that window; the message is idempotent.
   */
  private postRowActivation(webview: vscode.Webview): void {
    this.safePostMessage(webview, { type: "worktreeRowActivation", activation: readWorktreeRowActivation() });
  }

  private async onReady(webviewView: vscode.WebviewView): Promise<void> {
    // Mark webview as ready — gates outbound messages
    this._ready = true;
    signalSurfaceReady((message) => this.safePostMessage(webviewView.webview, message));

    // Post the initial theme so the hover-preview renderer can pick the
    // correct Shiki theme before the first hover. Subsequent changes flow
    // through the onDidChangeActiveColorTheme subscription wired in
    // resolveWebviewView.
    this.safePostMessage(webviewView.webview, {
      type: "themeChanged",
      kind: themeKindFor(vscode.window.activeColorTheme.kind),
    } satisfies ThemeChangedMessage);

    // Post initial hover-preview settings so the controller picks up the
    // user's `delay` / `enabled` / `blockSensitive` before the first hover.
    // Subsequent edits flow through the onDidChangeConfiguration subscription
    // wired in resolveWebviewView.
    this.safePostMessage(webviewView.webview, {
      type: "hoverPreviewSettings",
      settings: readHoverPreviewSettings(),
    });

    try {
      const viewId = this.getViewId();
      const existingSessions = this.sessionManager.getAllSessionsForView(viewId);

      if (existingSessions.length > 0) {
        // Re-creation scenario: sessions already exist for this view
        // Update webview references for all existing sessions
        this.sessionManager.updateWebviewForView(viewId, webviewView.webview);

        // Send 'init' message with all existing sessions (roots + splits, see
        // restore-terminal-sessions design.md D12) — splits MUST be present so
        // the webview can recreate every xterm referenced by `tabLayouts`.
        //
        // Await delivery before posting `restore` payloads. Same race as
        // round-2 [W4] on Phase B: if `safeSendWithRetry`'s first attempt
        // fails, it schedules a 50ms retry — a synchronous post-loop would
        // enqueue `restore` first, the webview would look up `store.terminals`
        // for a tabId that doesn't exist yet (no init processed), and the
        // restore payload would be silently dropped. User-visible: tab strip
        // populated, terminal content blank. See `restore` handler in main.ts.
        const initDelivered = await this.safeSendWithRetry(webviewView.webview, {
          type: "init",
          tabs: existingSessions,
          config: readTerminalConfig(),
          ...this.fileTreeHost.initPayload(),
          ...(this.worktreeHost?.initPayload() ?? { worktreeHasRepo: false }),
          // Read here, not in the host: this is VS Code configuration, and the
          // host deliberately holds no window API. Initial value only — a later
          // change arrives as its own message, and one that raced this send is
          // re-sent below rather than lost (design.md D5, round-1 W2).
          worktreeRowActivation: readWorktreeRowActivation(),
          vaultActionsAvailable: true,
          // Phase A in-memory re-resolve: live sessions survived, so the chosen scope stands.
          navigationBootstrap: "live",
          navigationHint:
            this._activeNavigation === undefined
              ? undefined
              : this._activeNavigation === null
                ? { activeTabId: null, activePaneId: null }
                : {
                    activeTabId: this._activeNavigation.tabId,
                    activePaneId: this._activeNavigation.paneId,
                  },
        });
        this.postRowActivation(webviewView.webview);
        if (initDelivered) {
          this.fileTreeHost.notifyInitDelivered();
        }
        if (!initDelivered) {
          console.error("[Portaterm] init delivery failed during reload — skipping restore posts.");
          this.sessionManager.resumeOutputForView(viewId);
          return;
        }

        // Send 'restore' messages with scrollback data for each session
        for (const session of existingSessions) {
          const scrollbackData = this.sessionManager.getScrollbackData(session.id);
          if (scrollbackData) {
            this.safePostMessage(webviewView.webview, {
              type: "restore",
              tabId: session.id,
              data: scrollbackData,
            });
          }
        }

        // Resume output flushing for the view
        this.sessionManager.resumeOutputForView(viewId);
      } else if (this.sessionManager.hasSnapshotsForLocation(this.location)) {
        // Cross-restart restore: this.location has persisted snapshots staged
        // by `hydrateFromSnapshots`. See: restore-terminal-sessions design.md D7, D12.
        const settings = readTerminalSettings();
        const snaps = this.sessionManager.consumeSnapshotsForLocation(this.location);
        for (const snap of snaps) {
          this.sessionManager.createSession(viewId, webviewView.webview, {
            shell: settings.shell,
            shellArgs: settings.shellArgs,
            cwd: settings.cwd,
            restoreFrom: snap,
          });
        }
        const restoredSessions = this.sessionManager.getAllSessionsForView(viewId);
        // Await init delivery before posting restoreFromSnapshot. If
        // safeSendWithRetry's first attempt fails and schedules a 50ms retry,
        // a synchronous post-loop would enqueue restoreFromSnapshot first —
        // the webview would then see the snapshot before the tab even exists
        // and fall into the deferOpen path, reintroducing the W4 mis-wrap.
        // See round-2 [W4].
        const initDelivered = await this.safeSendWithRetry(webviewView.webview, {
          type: "init",
          tabs: restoredSessions,
          config: readTerminalConfig(),
          ...this.fileTreeHost.initPayload(),
          ...(this.worktreeHost?.initPayload() ?? { worktreeHasRepo: false }),
          // Read here, not in the host: this is VS Code configuration, and the
          // host deliberately holds no window API. Initial value only — a later
          // change arrives as its own message, and one that raced this send is
          // re-sent below rather than lost (design.md D5, round-1 W2).
          worktreeRowActivation: readWorktreeRowActivation(),
          vaultActionsAvailable: true,
          // Cross-restart: a fresh open, so the surface lands on All.
          navigationBootstrap: "cold",
        });
        this.postRowActivation(webviewView.webview);
        if (initDelivered) {
          this.fileTreeHost.notifyInitDelivered();
        }
        if (!initDelivered) {
          // All retries failed — the webview channel is unhealthy. Posting
          // restoreFromSnapshot now would arrive at a webview that never
          // processed init, falling into the same deferOpen mis-wrap W4 was
          // closing. Log and skip the restore loop; the persisted snapshots
          // remain on disk and will be retried on the next activate. Output
          // resume still fires so the fresh PTY isn't permanently paused.
          console.error("[Portaterm] init delivery failed during restore — skipping restoreFromSnapshot posts.");
          this.sessionManager.resumeOutputForView(viewId);
          return;
        }
        for (const snap of snaps) {
          this.safePostMessage(webviewView.webview, {
            type: "restoreFromSnapshot",
            tabId: snap.metadata.sessionId,
            serializedBuffer: snap.buffer,
            cols: snap.metadata.cols,
            rows: snap.metadata.rows,
            snapshotAt: snap.metadata.snapshotAt,
            shellExited: snap.metadata.shellExited,
            exitCode: snap.metadata.exitCode,
            isSplitPane: snap.metadata.isSplitPane,
            worktreeId: snap.metadata.worktreeId,
          });
        }
        // Resume output flushing for sessions paused by createSession({restoreFrom}).
        // Order is now: init → restoreFromSnapshot (per session) → buffered PTY
        // output flush. See round-1 B3.
        this.sessionManager.resumeOutputForView(viewId);
      } else {
        // First-time creation: create initial session with resolved settings
        const settings = readTerminalSettings();
        this.sessionManager.createSession(viewId, webviewView.webview, {
          shell: settings.shell,
          shellArgs: settings.shellArgs,
          cwd: settings.cwd,
        });

        // Get tabs for the init message
        const tabs = this.sessionManager.getTabsForView(viewId);

        // Send 'init' message to the webview with resolved config (with retry)
        // Await delivery before the activation post: an activation that overtakes
        // init reaches a webview with no controller yet and is dropped, and the
        // reloaded and restored branches already await for exactly that reason
        // (.reviews/round-2.md W2).
        const initDelivered = await this.safeSendWithRetry(webviewView.webview, {
          type: "init",
          tabs,
          config: readTerminalConfig(),
          ...this.fileTreeHost.initPayload(),
          ...(this.worktreeHost?.initPayload() ?? { worktreeHasRepo: false }),
          // Read here, not in the host: this is VS Code configuration, and the
          // host deliberately holds no window API. Initial value only — a later
          // change arrives as its own message, and one that raced this send is
          // re-sent below rather than lost (design.md D5, round-1 W2).
          worktreeRowActivation: readWorktreeRowActivation(),
          vaultActionsAvailable: true,
          // First-time: no scope to preserve; All is the first-run state anyway.
          navigationBootstrap: "cold",
        });
        // Await delivery before the activation post, as the reloaded and restored
        // branches already do. An activation that overtakes init reaches a webview
        // with no controller yet and is dropped, and the retried init then settles
        // the surface on a value read before it (.reviews/round-2.md W2).
        if (initDelivered) {
          this.fileTreeHost.notifyInitDelivered();
          this.postRowActivation(webviewView.webview);
        }
      }
    } catch (err) {
      // Spawn failure: send error message (with retry for transient failures)
      console.error("[Portaterm] Failed to initialize terminal:", err);

      void this.safeSendWithRetry(webviewView.webview, {
        type: "error",
        message: err instanceof Error ? err.message : "Failed to initialize terminal",
        severity: "error",
      });
    }
  }

  /**
   * Safely post a message to the webview, handling both sync throws and async rejections.
   * Returns void — fire-and-forget with error logging.
   */
  /**
   * Typed, not `unknown`. `init` does NOT come through here — it goes through
   * `safeSendWithRetry`, which is where round-1 B3 lived and where round-2 V0
   * found the narrowing still missing. Typed all the same, so the two senders
   * cannot drift apart again.
   */
  private safePostMessage(webview: vscode.Webview, message: ExtensionToWebViewMessage): void {
    postOnce(webview, message);
  }

  /**
   * Post a message with retry logic for transient postMessage failures.
   * Retries up to `maxRetries` times with a 50ms delay between attempts.
   * Returns true if the message was delivered, false if all attempts failed.
   * Used for critical messages (init, tabCreated, splitPaneCreated, error).
   */
  /**
   * `ExtensionToWebViewMessage`, not `unknown`. THIS is the sender every `init`
   * goes through, and while it took `unknown` a REQUIRED init field missing from
   * all three of this provider's branches type-checked clean (round-1 B3, and
   * still after the first fix — round-2 V0).
   */
  private rollbackPendingSplitChild(requestId: string): void {
    const pending = this.pendingSplitChildren.get(requestId);
    if (!pending) {
      return;
    }
    this.pendingSplitChildren.delete(requestId);
    this.sessionManager.destroySession(pending.sessionId);
  }

  private rollbackPendingSplitChildrenForSource(sourcePaneId: string): void {
    for (const [requestId, pending] of this.pendingSplitChildren) {
      if (pending.sourcePaneId === sourcePaneId) {
        this.rollbackPendingSplitChild(requestId);
      }
    }
  }

  private rollbackAllPendingSplitChildren(): void {
    for (const requestId of [...this.pendingSplitChildren.keys()]) {
      this.rollbackPendingSplitChild(requestId);
    }
  }

  private async safeSendWithRetry(
    webview: vscode.Webview,
    message: ExtensionToWebViewMessage,
    maxRetries = 2,
    shouldAbort?: () => boolean,
  ): Promise<boolean> {
    return postWithRetry(webview, message, maxRetries, shouldAbort);
  }

  /**
   * Get the view ID for session tracking.
   */
  getViewId(): string {
    return this.location === "sidebar" ? TerminalViewProvider.sidebarViewType : TerminalViewProvider.panelViewType;
  }

  /**
   * Get the active session ID for this view.
   *
   * Uses the webview's last validated navigation echo for split-pane routing,
   * then falls back to SessionManager until the first echo arrives.
   */
  getActiveSessionId(): string | undefined {
    if (this._activeNavigation === null) {
      return undefined;
    }
    if (this._activeNavigation && this.sessionManager.getSession(this._activeNavigation.paneId)) {
      return this._activeNavigation.paneId;
    }
    return this.sessionManager.getTabsForView(this.getViewId()).find((tab) => tab.isActive)?.id;
  }

  /**
   * Get the **root tab** id for the active tab in this view — distinct from
   * `getActiveSessionId()` which prefers a split-pane session id when active.
   * Rename always targets the root tab, never a split pane (see
   * add-tab-rename design.md D5).
   *
   * Returns undefined when this view has no sessions or no active tab.
   */
  getActiveTabId(): string | undefined {
    if (this._activeNavigation === null) {
      return undefined;
    }
    if (this._activeNavigation && this.sessionManager.getSession(this._activeNavigation.paneId)) {
      return this._activeNavigation.tabId;
    }
    return this.sessionManager.getTabsForView(this.getViewId()).find((tab) => tab.isActive)?.id;
  }

  /**
   * Returns the most recently focused TerminalViewProvider whose webview is
   * still visible. Walks providers in focus-recency order so when the most
   * recently focused provider is hidden (e.g. user collapsed the panel after
   * focusing it), we fall back to the next-most-recent visible provider —
   * typically the sidebar that's still on screen. See `.reviews/round-1.md` W2.
   *
   * "Focused" is tracked via the webview's `focus` IPC message — see
   * `_focusOrder` update site inside `markFocused`.
   */
  static getLastFocusedProvider(): TerminalViewProvider | undefined {
    for (const p of TerminalViewProvider._focusOrder) {
      if (p._view?.visible) {
        return p;
      }
    }
    return undefined;
  }

  /**
   * Most-recently-focused providers, in descending recency order (index 0 is
   * most recent). Cleared per-instance on dispose so the array doesn't pin
   * stale providers in memory.
   */
  private static _focusOrder: TerminalViewProvider[] = [];

  /** Test-only hook: clear the recency stack (e.g. between tests). */
  static _resetLastFocused(): void {
    TerminalViewProvider._focusOrder = [];
  }

  /**
   * Internal: hoist this provider to the front of the recency stack. Called on
   * every `focus` IPC message from this provider's webview.
   */
  private markFocused(): void {
    const order = TerminalViewProvider._focusOrder;
    const i = order.indexOf(this);
    if (i === 0) {
      return; // already most recent
    }
    if (i > 0) {
      order.splice(i, 1);
    }
    order.unshift(this);
  }

  /** Internal: remove this provider from the recency stack (called on dispose). */
  private unmarkFocused(): void {
    const order = TerminalViewProvider._focusOrder;
    const i = order.indexOf(this);
    if (i !== -1) {
      order.splice(i, 1);
    }
  }
}
