import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TAB_APPEARANCE_COMMAND_IDS } from "./tabAppearanceCommands";

const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  activationEvents: string[];
  contributes: {
    commands: Array<{ command: string; title: string; category?: string }>;
    menus: Record<string, Array<{ command: string; when?: string; group?: string }>>;
  };
};

describe("tab color / icon manifest contract", () => {
  it("contributes both as palette commands", () => {
    const contributed = manifest.contributes.commands.filter(({ command }) =>
      (TAB_APPEARANCE_COMMAND_IDS as readonly string[]).includes(command),
    );
    expect(contributed).toEqual([
      { command: "portaterm.setTabColor", category: "Portaterm", title: "Change Tab Color…" },
      { command: "portaterm.setTabIcon", category: "Portaterm", title: "Change Tab Icon…" },
    ]);
    const hidden = manifest.contributes.menus.commandPalette.filter(({ command }) =>
      (TAB_APPEARANCE_COMMAND_IDS as readonly string[]).includes(command),
    );
    expect(hidden).toEqual([]);
  });

  it("offers both on a terminal tab's context menu, after Rename and Pin", () => {
    const tabMenu = manifest.contributes.menus["webview/context"].filter(
      ({ when }) => when?.startsWith("webviewSection == 'terminalTab'") === true,
    );
    expect(
      tabMenu.filter(({ command }) => (TAB_APPEARANCE_COMMAND_IDS as readonly string[]).includes(command)),
    ).toEqual([
      { command: "portaterm.setTabColor", when: "webviewSection == 'terminalTab'", group: "tab@3" },
      { command: "portaterm.setTabIcon", when: "webviewSection == 'terminalTab'", group: "tab@4" },
    ]);
  });

  it("activates on a cold invocation of either", () => {
    for (const id of TAB_APPEARANCE_COMMAND_IDS) {
      expect(manifest.activationEvents).toContain(`onCommand:${id}`);
    }
  });
});
