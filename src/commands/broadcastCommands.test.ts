// src/commands/broadcastCommands.test.ts — which surface and tab a broadcast command reaches,
// and that package.json offers each door where it should.

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BROADCAST_COMMAND_IDS, createBroadcastCommands } from "./broadcastCommands";

function setup(focusedTabId: string | undefined) {
  const postToSession = vi.fn();
  const commands = createBroadcastCommands({ postToSession, focusedTabId: () => focusedTabId });
  return { commands, postToSession };
}

describe("createBroadcastCommands", () => {
  it("palette toggle addresses the focused tab with no explicit state", () => {
    const { commands, postToSession } = setup("tab-1");
    commands["portaterm.toggleBroadcastInput"]();
    expect(postToSession).toHaveBeenCalledWith("tab-1", {
      type: "setBroadcastInput",
      sessionId: "tab-1",
      enabled: undefined,
    });
  });

  it("palette toggle does nothing with no focused terminal", () => {
    const { commands, postToSession } = setup(undefined);
    commands["portaterm.toggleBroadcastInput"]();
    expect(postToSession).not.toHaveBeenCalled();
  });

  it("context-menu start and stop address the right-clicked pane, explicitly", () => {
    const { commands, postToSession } = setup("other-tab");
    commands["portaterm.ctx.startBroadcastInput"]({ paneSessionId: "pane-7" });
    commands["portaterm.ctx.stopBroadcastInput"]({ paneSessionId: "pane-7" });
    expect(postToSession.mock.calls).toEqual([
      ["pane-7", { type: "setBroadcastInput", sessionId: "pane-7", enabled: true }],
      ["pane-7", { type: "setBroadcastInput", sessionId: "pane-7", enabled: false }],
    ]);
  });

  it("context-menu doors never fall back to the focused tab", () => {
    const { commands, postToSession } = setup("tab-1");
    commands["portaterm.ctx.startBroadcastInput"]();
    commands["portaterm.ctx.stopBroadcastInput"]({});
    commands["portaterm.ctx.startBroadcastInput"]({ paneSessionId: 42 as unknown as string });
    expect(postToSession).not.toHaveBeenCalled();
  });
});

describe("package.json contributions", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../../package.json"), "utf8"));
  const contributed = new Set(manifest.contributes.commands.map((c: { command: string }) => c.command));
  const webviewMenu: Array<{ command: string; when: string }> = manifest.contributes.menus["webview/context"];
  const palette: Array<{ command: string; when: string }> = manifest.contributes.menus.commandPalette;

  it("contributes every registered id", () => {
    for (const id of BROADCAST_COMMAND_IDS) {
      expect(contributed.has(id)).toBe(true);
    }
  });

  it("offers Start on a split pane that is not broadcasting and Stop on one that is", () => {
    expect(webviewMenu.find((m) => m.command === "portaterm.ctx.startBroadcastInput")?.when).toBe(
      "webviewSection == 'splitPane' && paneSplit && !broadcastInput",
    );
    expect(webviewMenu.find((m) => m.command === "portaterm.ctx.stopBroadcastInput")?.when).toBe(
      "webviewSection == 'splitPane' && broadcastInput",
    );
  });

  it("hides the context-menu doors from the palette and keeps the toggle in it", () => {
    for (const id of ["portaterm.ctx.startBroadcastInput", "portaterm.ctx.stopBroadcastInput"]) {
      expect(palette.find((m) => m.command === id)?.when).toBe("false");
    }
    expect(palette.find((m) => m.command === "portaterm.toggleBroadcastInput")).toBeUndefined();
  });
});
