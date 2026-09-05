// src/commands/closeCommands.ts — the four destructive terminal commands, as a
// factory rather than closures inside `activate()`.
//
// `closeGates.ts` owns the order (confirm, then destroy the id that was
// weighed). What lives here is RESOLUTION: which session a command targets and
// which surface hears about it. That is where all three routing defects of this
// cycle were — a door that skipped the gate, a door that weighed one pane and
// let the webview destroy another, and a door that posted to the focused
// sidebar for a pane an editor owned. None of them was reachable by a test
// while the doors were closures in a 2200-line activate().
//
// Mirrors `exportCommands.ts`: the seams come in, `activate()` does nothing but
// register what comes out.

import { type CloseGateDeps, closePaneGated, killTerminalGated } from "../session/closeGates";
import type { KillConfirmationUi, KillEvidenceReader } from "../session/killConfirmation";

/** What a context-menu command is handed by the webview's right-click. */
export interface CloseCommandContext {
  paneSessionId?: string;
}

export interface CloseCommandDeps {
  evidence: KillEvidenceReader | null;
  ui: KillConfirmationUi;
  /** Every session closing this tab destroys — the host's own answer. */
  panesOfTab(tabId: string): string[];
  isSplitPane(sessionId: string): boolean;
  destroySession(sessionId: string): void;
  /**
   * Post to the surface that HOLDS this session — sidebar, panel or editor.
   * Addressing by session rather than by provider is what stops a confirmed
   * close in an editor from acting on an unrelated sidebar terminal.
   */
  postToSession(sessionId: string, message: unknown): void;
  /** The focused surface's active session — the keybinding doors' target. */
  focusedActiveSession(): string | undefined;
  /** The active session of the surface a context command was raised on. */
  ctxActiveSession(ctx: CloseCommandContext | undefined): string | undefined;
}

/**
 * Every command id that can destroy a terminal.
 *
 * Asserted by the tests, so a sixth door cannot be added to `activate()` without
 * either coming through here or failing the inventory.
 */
export const CLOSE_COMMAND_IDS = [
  "anywhereTerminal.killTerminal",
  "anywhereTerminal.closeSplitPane",
  "anywhereTerminal.ctx.killTerminal",
  "anywhereTerminal.ctx.closePane",
] as const;

export interface CloseCommands {
  /** The window-wide destructive commands, keyed by the id they register under. */
  byId: Record<(typeof CLOSE_COMMAND_IDS)[number], (ctx?: CloseCommandContext) => void>;
  /**
   * A kill bound to one surface rather than to whichever is focused — the
   * per-location `killTerminal.{sidebar,panel}` commands. It goes through the
   * same gate; only the target resolution differs, which is the whole reason
   * this factory takes resolution as a seam.
   */
  killTerminalFor(resolveTarget: () => string | undefined): () => void;
}

export function createCloseCommands(deps: CloseCommandDeps): CloseCommands {
  const gates: CloseGateDeps = {
    evidence: deps.evidence,
    ui: deps.ui,
    panesOfTab: deps.panesOfTab,
    isSplitPane: deps.isSplitPane,
    destroySession: deps.destroySession,
    postTabRemoved: (sessionId) => deps.postToSession(sessionId, { type: "tabRemoved", tabId: sessionId }),
    postClosePane: (sessionId) => deps.postToSession(sessionId, { type: "closeSplitPaneById", sessionId }),
  };

  const killFor = (resolveTarget: () => string | undefined) => (): void => {
    const target = resolveTarget();
    if (target) {
      void killTerminalGated(target, gates);
    }
  };

  const byId = {
    "anywhereTerminal.killTerminal": killFor(deps.focusedActiveSession),
    // Gated at the COMMAND rather than on the `requestCloseSplitPane` that comes
    // back: the webview disposes the pane before it posts that, so by then there
    // is nothing left to decline.
    "anywhereTerminal.closeSplitPane": () => {
      const target = deps.focusedActiveSession();
      if (target) {
        void closePaneGated(target, gates);
      }
    },
    "anywhereTerminal.ctx.killTerminal": (ctx?: CloseCommandContext) =>
      killFor(() => ctx?.paneSessionId ?? deps.ctxActiveSession(ctx))(),
    "anywhereTerminal.ctx.closePane": (ctx?: CloseCommandContext) => {
      // This command names its pane outright, so there is nothing to fall back
      // to: acting on the focused surface's pane instead would be acting on a
      // different pane than the one right-clicked.
      if (ctx?.paneSessionId) {
        void closePaneGated(ctx.paneSessionId, gates);
      }
    },
  };

  return { byId, killTerminalFor: killFor };
}
