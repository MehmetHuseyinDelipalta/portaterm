// src/commands/paneZoomCommands.ts — the pane-zoom commands, as a factory.
//
// The state is the webview's (`src/webview/paneZoom.ts`); the host only decides
// which surface hears the command and which pane it names. That resolution is
// the part worth testing, so it lives here rather than as closures inside
// `activate()` — the same split as `broadcastCommands.ts`.

/** What a context-menu command is handed by the webview's right-click. */
export interface PaneZoomCommandContext {
  paneSessionId?: string;
}

export interface PaneZoomCommandDeps {
  /** Post to the surface that HOLDS this session — sidebar, panel or editor. */
  postToSession(sessionId: string, message: unknown): void;
  /** The focused terminal's active pane — the palette and keybinding door's target. */
  focusedPaneId(): string | undefined;
}

export const PANE_ZOOM_COMMAND_IDS = [
  "portaterm.togglePaneZoom",
  "portaterm.ctx.zoomPane",
  "portaterm.ctx.unzoomPane",
] as const;

export type PaneZoomCommands = Record<(typeof PANE_ZOOM_COMMAND_IDS)[number], (ctx?: PaneZoomCommandContext) => void>;

export function createPaneZoomCommands(deps: PaneZoomCommandDeps): PaneZoomCommands {
  const post = (sessionId: string | undefined, zoomed?: boolean): void => {
    if (sessionId) {
      deps.postToSession(sessionId, { type: "setPaneZoom", sessionId, zoomed });
    }
  };
  // A right-click names its pane outright. Falling back to the focused pane
  // would zoom a different pane than the one clicked.
  const paneOf = (ctx: PaneZoomCommandContext | undefined): string | undefined =>
    typeof ctx?.paneSessionId === "string" ? ctx.paneSessionId : undefined;

  return {
    "portaterm.togglePaneZoom": () => post(deps.focusedPaneId()),
    "portaterm.ctx.zoomPane": (ctx) => post(paneOf(ctx), true),
    "portaterm.ctx.unzoomPane": (ctx) => post(paneOf(ctx), false),
  };
}
