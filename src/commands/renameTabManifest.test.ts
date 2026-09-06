import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const RENAME_TAB = "anywhereTerminal.renameTab";
const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  activationEvents: string[];
  contributes: {
    commands: Array<{ command: string; title: string; category?: string }>;
    keybindings?: Array<{ command: string }>;
    menus: Record<string, Array<{ command: string; when?: string; group?: string }>>;
  };
};

describe("rename-tab manifest contract", () => {
  it("contributes one discoverable palette command", () => {
    expect(manifest.contributes.commands.filter(({ command }) => command === RENAME_TAB)).toEqual([
      { command: RENAME_TAB, title: "Rename Tab…", category: "AnyWhere Terminal" },
    ]);
  });

  it("offers the command only from a terminal-tab webview context", () => {
    expect(manifest.contributes.menus["webview/context"].filter(({ command }) => command === RENAME_TAB)).toEqual([
      { command: RENAME_TAB, when: "webviewSection == 'terminalTab'", group: "tab@1" },
    ]);
  });

  it("activates on cold command invocation without shipping a default keybinding", () => {
    expect(manifest.activationEvents).toContain(`onCommand:${RENAME_TAB}`);
    expect(manifest.contributes.keybindings?.some(({ command }) => command === RENAME_TAB)).toBe(false);
  });
});
