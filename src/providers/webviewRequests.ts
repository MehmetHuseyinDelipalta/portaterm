// src/providers/webviewRequests.ts — the preview/vault request mechanics shared
// by TerminalEditorProvider and TerminalViewProvider
// (share-provider-request-mechanics D1).
//
// The webview is a parameter rather than provider state: the editor provider
// owns one fixed `_panel.webview`, the view provider is handed one per call, and
// that was the only difference between their copies of the posting primitives.

import * as vscode from "vscode";
import type { SessionManager } from "../session/SessionManager";
import type { ExtensionToWebViewMessage, WebViewToExtensionMessage } from "../types/messages";
import type { VaultService } from "../vault/VaultService";
import { readHoverPreviewSettings } from "./hoverPreviewSettings";
import { previewFileLink } from "./previewFileLink";
import { readBytesBounded } from "./readBytesBounded";

/** One attempt, fire-and-forget. Swallows both a sync throw and an async
 *  rejection — either just means the webview is already disposed. */
export function postOnce(webview: vscode.Webview, message: ExtensionToWebViewMessage): void {
  try {
    void (webview.postMessage(message) as Thenable<boolean>).then(undefined, () => {
      // Async rejection — webview may be disposed
    });
  } catch {
    // Sync throw — webview may be disposed
  }
}

/**
 * Up to `maxRetries` extra attempts, 50 ms apart.
 *
 * `shouldAbort` is re-checked before EVERY attempt, not once before the loop: a
 * newer request can arrive during the 50 ms sleep, and a late retry of the now
 * stale payload would otherwise overwrite it in the webview (D5 OBL-3).
 */
export async function postWithRetry(
  webview: vscode.Webview,
  message: ExtensionToWebViewMessage,
  maxRetries = 2,
  shouldAbort?: () => boolean,
): Promise<boolean> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (shouldAbort?.()) {
      return false;
    }
    try {
      const result = await (webview.postMessage(message) as Thenable<boolean>);
      if (result) {
        return true;
      }
    } catch {
      // Sync or async failure — will retry
    }
    if (attempt < maxRetries) {
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
  }
  return false;
}

/**
 * The per-session preview cancellation sources.
 *
 * `cancel` deliberately does NOT dispose: disposal belongs to the owning
 * request's `finally`, so a superseded-but-still-running request can keep
 * reading `isCancellationRequested` (D5 OBL-2).
 */
export class PreviewTokenRegistry {
  private readonly tokens = new Map<string, vscode.CancellationTokenSource>();

  /** Cancel and forget any prior request for this session. */
  cancel(sessionId: string): void {
    const prior = this.tokens.get(sessionId);
    if (prior) {
      try {
        prior.cancel();
      } catch {
        // Best-effort.
      }
      this.tokens.delete(sessionId);
    }
  }

  /** Cancel every in-flight request. The key list is copied first, as both
   *  providers do today, so the set cancelled is the one present on entry. */
  cancelAll(): void {
    for (const sessionId of [...this.tokens.keys()]) {
      this.cancel(sessionId);
    }
  }

  /** Supersede any prior request for this session and install a fresh source. */
  begin(sessionId: string, source: vscode.CancellationTokenSource): void {
    this.cancel(sessionId);
    this.tokens.set(sessionId, source);
  }

  /** Drop the entry only if it is STILL ours — a supersession may have replaced
   *  the map value while this request was in flight (D5 OBL-1). */
  end(sessionId: string, source: vscode.CancellationTokenSource): void {
    if (this.tokens.get(sessionId) === source) {
      this.tokens.delete(sessionId);
    }
  }
}

/**
 * Handle a hover-preview request. Supersedes any prior in-flight request for
 * the same session via the cancellation-token registry.
 *
 * `logSuffix` is the only thing that differed between the two providers'
 * copies: the editor tags its warning `(editor)`, the view tags nothing.
 *
 * See: asimov/changes/add-hover-file-preview/design.md D9
 */
export async function handleFilePreviewRequest(
  message: Extract<WebViewToExtensionMessage, { type: "requestFilePreview" }>,
  ctx: {
    webview: vscode.Webview;
    sessionManager: SessionManager;
    tokens: PreviewTokenRegistry;
    logSuffix: string;
  },
): Promise<void> {
  const { webview, sessionManager, tokens, logSuffix } = ctx;
  // Reject unknown sessionId BEFORE any resolution work. Without this, a
  // forged or stale id reaches `previewFileLink` where `trustBasesFor`
  // returns an empty list — historically that meant the trust check was
  // skipped entirely. Round-2 W3 plugs that hole on the host side too.
  if (!sessionManager.getSession(message.sessionId)) {
    return;
  }
  const source = new vscode.CancellationTokenSource();
  // Supersede: cancel any prior request for this session, then install ours.
  tokens.begin(message.sessionId, source);

  try {
    const allSettings = readHoverPreviewSettings();
    const result = await previewFileLink(
      message,
      {
        getInitialCwd: (id) => sessionManager.getInitialCwd(id),
        getCurrentCwd: (id) => sessionManager.getCurrentCwd(id),
        getLiveCwd: (id) => sessionManager.getLiveCwd(id),
        workspaceFolders: vscode.workspace.workspaceFolders,
        fs: {
          stat: (uri) => vscode.workspace.fs.stat(uri),
          readFile: (uri) => vscode.workspace.fs.readFile(uri),
          readBytes: (uri, maxBytes) => readBytesBounded(uri, maxBytes),
        },
        findFiles: (include, exclude, maxResults, token) =>
          vscode.workspace.findFiles(include, exclude, maxResults, token),
        uriFactory: { file: vscode.Uri.file },
        createCancellationTokenSource: () => new vscode.CancellationTokenSource(),
        directoryFileType: vscode.FileType.Directory,
        symbolicLinkFileType: vscode.FileType.SymbolicLink,
        relativePatternFactory: (base, glob) => new vscode.RelativePattern(base, glob),
        settings: { blockSensitive: allSettings.blockSensitive },
      },
      source.token,
    );
    // Drop the result if cancelled — webview already invalidated its requestId.
    if (result && !source.token.isCancellationRequested) {
      postOnce(webview, result);
    }
  } catch (err) {
    console.warn(`[AnyWhere Terminal] requestFilePreview failed${logSuffix}:`, err);
  } finally {
    tokens.end(message.sessionId, source);
    // ALWAYS dispose our own source — this finally owns `source` exclusively.
    // Deferred from `cancel` (review round-1 W6) so the token stays accessible
    // to in-flight `isCancellationRequested` checks.
    try {
      source.dispose();
    } catch {
      // Best-effort.
    }
  }
}

/**
 * Serve the vault list with stale-while-revalidate (cache-vault-load D1): post
 * the persisted cache immediately (when present) for an instant render, then
 * refresh the agents' on-disk stores incrementally and post the reconciled
 * list. The on-disk stores remain the source of truth — the cache is only an
 * accelerator. A refresh superseded by a newer request is dropped (D7).
 *
 * The sequence counter stays on the provider — the view's rename push drives
 * the same one (D5 OBL-6) — so this takes `isCurrent()` and never a token.
 */
export async function handleVaultSessionsRequest(ctx: {
  webview: vscode.Webview;
  vaultService: VaultService;
  isCurrent: () => boolean;
  logSuffix: string;
}): Promise<void> {
  const { webview, vaultService, isCurrent, logSuffix } = ctx;

  // Phase 1 — instant render from cache (no store scan). Absent on the first
  // ever open; then the panel paints immediately on every subsequent open.
  // Best-effort (NOT retried): a retried cache post could land AFTER the fresh
  // response and make a stale list win. If the webview isn't ready yet, the
  // authoritative fresh response below still populates it.
  const cached = vaultService.listCached();
  if (cached) {
    postOnce(webview, { type: "vaultSessionsResponse", result: cached, fromCache: true });
  }

  // Phase 2 — incremental refresh against the on-disk source of truth.
  try {
    const result = await vaultService.refresh();
    if (!isCurrent()) {
      return; // a newer request owns the list now — drop this stale refresh.
    }
    // Re-check supersession before EACH delivery attempt (not just here): a
    // newer request can arrive during the 50ms retry sleep, and a late retry of
    // this now-stale list would otherwise overwrite the newer one in the
    // webview (review round-2 F4).
    void postWithRetry(webview, { type: "vaultSessionsResponse", result, fromCache: false }, 2, () => !isCurrent());
  } catch (err) {
    console.error(`[AnyWhere Terminal] Failed to list vault sessions${logSuffix}:`, err);
    // Don't clobber a successfully-rendered cache with an error notice; only
    // surface the error when there was nothing to show.
    if (!cached) {
      void postWithRetry(webview, {
        type: "error",
        message: err instanceof Error ? err.message : "Failed to list AI vault sessions",
        severity: "error",
      });
    }
  }
}

/**
 * On-demand session detail for the preview overlay. The webview sends the
 * entry id ONLY; `getDetail` resolves the session by id within the agent's
 * store (no full list, no cache — D3). The reply echoes `entryId` so the
 * webview can drop a stale response (D3 stale-render guard).
 */
export async function handleVaultSessionDetailRequest(ctx: {
  webview: vscode.Webview;
  vaultService: VaultService;
  entryId: string;
  limit?: number;
  requestId?: string;
}): Promise<void> {
  const { webview, vaultService, entryId, limit, requestId } = ctx;
  // Echoed verbatim on every reply path — reads complete out of order, so the
  // webview correlates a nested reply by this token, not by entry id (W15).
  const echo = requestId !== undefined ? { requestId } : {};
  try {
    const detail = await vaultService.getDetail(entryId, limit);
    void postWithRetry(
      webview,
      detail
        ? { type: "vaultSessionDetailResponse", entryId, detail, ...echo }
        : // Two outcomes the reader cannot tell apart here: a session that is
          // not in the store, and one whose read could not be completed (a
          // bounded query whose proof failed returns nothing rather than
          // guessing). Asserting the first states what this branch never
          // established, and the preview shows the words verbatim.
          {
            type: "vaultSessionDetailResponse",
            entryId,
            error: "Session not found or could not be read.",
            ...echo,
          },
    );
  } catch (err) {
    void postWithRetry(webview, {
      type: "vaultSessionDetailResponse",
      entryId,
      error: err instanceof Error ? err.message : "Failed to read session detail",
      ...echo,
    });
  }
}
