// src/commands/broadcastCommands.ts — the broadcast-input commands, as a factory.
//
// The state is the webview's (`src/webview/broadcastInput.ts`); the host only
// decides which surface hears the command and which pane names the tab. That
// resolution is the part worth testing, so it lives here rather than as
// closures inside `activate()` — the same split as `closeCommands.ts`.

/** What a context-menu command is handed by the webview's right-click. */
export interface BroadcastCommandContext {
  paneSessionId?: string;
}

export interface BroadcastCommandDeps {
  /** Post to the surface that HOLDS this session — sidebar, panel or editor. */
  postToSession(sessionId: string, message: unknown): void;
  /** The focused terminal's tab — the palette door's target. */
  focusedTabId(): string | undefined;
}

export const BROADCAST_COMMAND_IDS = [
  "portaterm.toggleBroadcastInput",
  "portaterm.ctx.startBroadcastInput",
  "portaterm.ctx.stopBroadcastInput",
] as const;

export type BroadcastCommands = Record<(typeof BROADCAST_COMMAND_IDS)[number], (ctx?: BroadcastCommandContext) => void>;

export function createBroadcastCommands(deps: BroadcastCommandDeps): BroadcastCommands {
  const post = (sessionId: string | undefined, enabled?: boolean): void => {
    if (sessionId) {
      deps.postToSession(sessionId, { type: "setBroadcastInput", sessionId, enabled });
    }
  };
  // A right-click names its pane outright. Falling back to the focused tab
  // would switch broadcasting on in a different tab than the one clicked.
  const paneOf = (ctx: BroadcastCommandContext | undefined): string | undefined =>
    typeof ctx?.paneSessionId === "string" ? ctx.paneSessionId : undefined;

  return {
    "portaterm.toggleBroadcastInput": () => post(deps.focusedTabId()),
    "portaterm.ctx.startBroadcastInput": (ctx) => post(paneOf(ctx), true),
    "portaterm.ctx.stopBroadcastInput": (ctx) => post(paneOf(ctx), false),
  };
}
