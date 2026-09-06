// src/providers/webviewRequests.ts — the preview/vault request mechanics shared
// by TerminalEditorProvider and TerminalViewProvider
// (share-provider-request-mechanics D1).
//
// The webview is a parameter rather than provider state: the editor provider
// owns one fixed `_panel.webview`, the view provider is handed one per call, and
// that was the only difference between their copies of the posting primitives.

import type * as vscode from "vscode";
import type { ExtensionToWebViewMessage } from "../types/messages";

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
