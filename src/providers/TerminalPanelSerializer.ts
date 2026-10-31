// WebviewPanelSerializer for editor-area terminals. Registered for view type
// `portaterm.editor` in `extension.activate`. On window reload, VS Code
// invokes `deserializeWebviewPanel(panel, state)` for every serialized panel.
//
// Sequence (mirrors VS Code's markdown-preview pattern + design.md D2/D3/D7):
//   1. Resolve panelId from state.panelId (fallback: fresh UUID for legacy panels).
//   2. Cancel the grace-period destroy scheduled by the prior provider instance.
//   3. Consume any pending restore snapshots that were rehydrated on activate.
//   4. Construct a new TerminalEditorProvider that takes over the panel.

import * as crypto from "node:crypto";
import type * as vscode from "vscode";
import type { PaneEvidenceStore } from "../session/PaneEvidenceStore";
import type { SessionManager } from "../session/SessionManager";
import type { ResolvedPathMemo } from "../utils/resolvedPathMemo";
import type { VaultService } from "../vault/VaultService";
import type { WatcherPool } from "./fsWatcherPool";
import type { GitDecorationProvider } from "./gitDecorationProvider";
import { TerminalEditorProvider } from "./TerminalEditorProvider";
import type { WorktreeHost } from "./WorktreeHost";

export class TerminalPanelSerializer implements vscode.WebviewPanelSerializer<{ panelId?: string }> {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly sessionManager: SessionManager,
    private readonly gitDecorationProvider: GitDecorationProvider | null,
    private readonly watcherPool: WatcherPool | null,
    private readonly worktreeHost: WorktreeHost | null = null,
    /**
     * Threaded through for the same reason `worktreeHost` is: a panel revived
     * here never passes through `createPanel`, so a store wired only there
     * would leave every restored editor reporting into nothing.
     */
    private readonly paneEvidence: PaneEvidenceStore | null = null,
    /** Threaded through for the same reason `worktreeHost` is — a revived panel
     *  never passes through `createPanel`, and its worktree rows offer preview. */
    private readonly vaultService: VaultService | null = null,
    /** Threaded through for the same reason `worktreeHost` is — a revived panel
     *  never passes through `createPanel` (round-2 B1). */
    private readonly pathMemo: ResolvedPathMemo | null = null,
  ) {}

  async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: { panelId?: string } | null): Promise<void> {
    const stateMissing = !state?.panelId;
    const panelId = state?.panelId ?? crypto.randomUUID();
    const viewId = `editor-${panelId}`;

    if (stateMissing) {
      // No panelId in state: this revival cannot be matched to a prior
      // identity, so it gets a fresh viewId and fresh sessions. Nothing is
      // cancelled. Every pending `editor-*` destroy belongs to a viewId this
      // panel will never adopt — cancelling one (as this branch once did for
      // all of them) left its sessions running with no panel that could ever
      // show them, and broke the undo of a panel the user had just closed
      // (`reopen` claims the grace window by cancelling exactly that timer).
      // The prior instance's own sessions are unreachable under the lost id;
      // its timer reaping them is the correct outcome.
      console.warn(
        "[Portaterm] Editor panel revived without prior panelId state — starting fresh; " +
          "the prior instance's sessions are reaped by their own grace timer, and its " +
          "persisted snapshot stays orphaned until the next activate's hydrate sweeps it.",
      );
    } else {
      // Cancel the grace-period destroy BEFORE constructing the new provider so
      // surviving PTYs from the prior instance aren't killed mid-revive.
      this.sessionManager.cancelScheduledDestroy(viewId);
    }

    // Pull any persisted snapshots that hydrate-on-activate has staged for
    // this panel. Empty array on Phase A reloads (sessions survive in memory)
    // or when state was missing (fresh UUID can't match anything).
    const snapshots = this.sessionManager.consumeSnapshotsForPanel(panelId);

    TerminalEditorProvider.revive(
      this.context,
      this.sessionManager,
      panel,
      panelId,
      snapshots,
      this.gitDecorationProvider,
      this.watcherPool,
      this.worktreeHost,
      this.paneEvidence,
      this.vaultService,
      this.pathMemo,
    );
  }
}
