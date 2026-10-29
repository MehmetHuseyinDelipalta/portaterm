import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TAB_COLORS, TAB_ICONS, tabColorCss, toTabColor, toTabIcon } from "./tabAppearance";

describe("tab appearance ids", () => {
  it("accepts every listed color and icon id", () => {
    for (const { id } of TAB_COLORS) {
      expect(toTabColor(id)).toBe(id);
    }
    for (const { id } of TAB_ICONS) {
      expect(toTabIcon(id)).toBe(id);
    }
  });

  it("reads anything else — an unknown id, a non-string, nothing — as none", () => {
    for (const value of ["plaid", "", "RED", 1, null, undefined, {}]) {
      expect(toTabColor(value)).toBeUndefined();
      expect(toTabIcon(value)).toBeUndefined();
    }
  });

  it("keeps ids unique", () => {
    expect(new Set(TAB_COLORS.map((c) => c.id)).size).toBe(TAB_COLORS.length);
    expect(new Set(TAB_ICONS.map((i) => i.id)).size).toBe(TAB_ICONS.length);
  });
});

describe("tabColorCss", () => {
  it("is the theme's terminal ANSI color as a webview variable, falling back to Dark+", () => {
    expect(tabColorCss("red")).toBe("var(--vscode-terminal-ansiRed, #cd3131)");
    expect(tabColorCss("cyan")).toBe("var(--vscode-terminal-ansiCyan, #11a8cd)");
  });

  it("names a theme color VS Code defines for every entry", () => {
    for (const color of TAB_COLORS) {
      expect(color.themeColor).toMatch(/^terminal\.ansi(Red|Green|Yellow|Blue|Magenta|Cyan)$/);
      expect(color.fallback).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("QuickPick color swatches", () => {
  it("ships one per color, filled with the color's fallback", () => {
    for (const color of TAB_COLORS) {
      const svg = readFileSync(new URL(`../../media/tab-colors/${color.id}.svg`, import.meta.url), "utf8");
      expect(svg).toContain(`fill="${color.fallback}"`);
    }
  });
});
