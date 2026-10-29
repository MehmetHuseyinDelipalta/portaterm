// src/commands/paneZoomCommands.test.ts — which surface and pane a zoom command reaches,
// and that package.json offers each door where it should.

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createPaneZoomCommands, PANE_ZOOM_COMMAND_IDS } from "./paneZoomCommands";

function setup(focusedPaneId: string | undefined) {
  const postToSession = vi.fn();
  const commands = createPaneZoomCommands({ postToSession, focusedPaneId: () => focusedPaneId });
  return { commands, postToSession };
}

describe("createPaneZoomCommands", () => {
  it("toggle addresses the focused pane with no explicit state", () => {
    const { commands, postToSession } = setup("pane-3");
    commands["portaterm.togglePaneZoom"]();
    expect(postToSession).toHaveBeenCalledWith("pane-3", {
      type: "setPaneZoom",
      sessionId: "pane-3",
      zoomed: undefined,
    });
  });

  it("toggle does nothing with no focused terminal", () => {
    const { commands, postToSession } = setup(undefined);
    commands["portaterm.togglePaneZoom"]();
    expect(postToSession).not.toHaveBeenCalled();
  });

  it("context-menu zoom and unzoom address the right-clicked pane, explicitly", () => {
    const { commands, postToSession } = setup("other-pane");
    commands["portaterm.ctx.zoomPane"]({ paneSessionId: "pane-7" });
    commands["portaterm.ctx.unzoomPane"]({ paneSessionId: "pane-7" });
    expect(postToSession.mock.calls).toEqual([
      ["pane-7", { type: "setPaneZoom", sessionId: "pane-7", zoomed: true }],
      ["pane-7", { type: "setPaneZoom", sessionId: "pane-7", zoomed: false }],
    ]);
  });

  it("context-menu doors never fall back to the focused pane", () => {
    const { commands, postToSession } = setup("pane-1");
    commands["portaterm.ctx.zoomPane"]();
    commands["portaterm.ctx.unzoomPane"]({});
    commands["portaterm.ctx.zoomPane"]({ paneSessionId: 42 as unknown as string });
    expect(postToSession).not.toHaveBeenCalled();
  });
});

describe("package.json contributions", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../../package.json"), "utf8"));
  const contributed = new Set(manifest.contributes.commands.map((c: { command: string }) => c.command));
  const webviewMenu: Array<{ command: string; when: string }> = manifest.contributes.menus["webview/context"];
  const palette: Array<{ command: string; when: string }> = manifest.contributes.menus.commandPalette;
  const keybindings: Array<{ command: string; key: string; mac?: string; when: string }> =
    manifest.contributes.keybindings;

  it("contributes every registered id", () => {
    for (const id of PANE_ZOOM_COMMAND_IDS) {
      expect(contributed.has(id)).toBe(true);
    }
  });

  it("offers Zoom on a split pane that is not zoomed and Unzoom on one that is", () => {
    expect(webviewMenu.find((m) => m.command === "portaterm.ctx.zoomPane")?.when).toBe(
      "webviewSection == 'splitPane' && paneSplit && !paneZoomed",
    );
    expect(webviewMenu.find((m) => m.command === "portaterm.ctx.unzoomPane")?.when).toBe(
      "webviewSection == 'splitPane' && paneZoomed",
    );
  });

  it("hides the context-menu doors from the palette and keeps the toggle in it", () => {
    for (const id of ["portaterm.ctx.zoomPane", "portaterm.ctx.unzoomPane"]) {
      expect(palette.find((m) => m.command === id)?.when).toBe("false");
    }
    expect(palette.find((m) => m.command === "portaterm.togglePaneZoom")).toBeUndefined();
  });

  it("binds the toggle in every Portaterm surface and nowhere else", () => {
    const binding = keybindings.find((k) => k.command === "portaterm.togglePaneZoom");
    expect(binding).toEqual({
      command: "portaterm.togglePaneZoom",
      key: "ctrl+shift+enter",
      mac: "cmd+shift+enter",
      when: "focusedView == portaterm.sidebar || focusedView == portaterm.panel || activeWebviewPanelId == 'portaterm.editor'",
    });
  });
});
