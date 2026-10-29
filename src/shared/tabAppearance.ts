// src/shared/tabAppearance.ts — The colors and icons a tab can wear.
//
// Shared by the host (QuickPick entries, validation, persistence) and the
// webview (rendering). Only ids cross the wire and reach the snapshot; each side
// maps an id to what it draws, so an id this build does not know reads as unset.

/**
 * Tab colors, as the terminal ANSI theme colors VS Code's own terminal tabs use:
 * they follow the color theme, and the webview reads them as `--vscode-*` vars.
 * `fallback` is the Dark+ value, for a theme that does not define the color.
 */
export const TAB_COLORS = [
  { id: "red", label: "Red", themeColor: "terminal.ansiRed", fallback: "#cd3131" },
  { id: "green", label: "Green", themeColor: "terminal.ansiGreen", fallback: "#0dbc79" },
  { id: "yellow", label: "Yellow", themeColor: "terminal.ansiYellow", fallback: "#e5e510" },
  { id: "blue", label: "Blue", themeColor: "terminal.ansiBlue", fallback: "#2472c8" },
  { id: "magenta", label: "Magenta", themeColor: "terminal.ansiMagenta", fallback: "#bc3fbc" },
  { id: "cyan", label: "Cyan", themeColor: "terminal.ansiCyan", fallback: "#11a8cd" },
] as const;

export type TabColorId = (typeof TAB_COLORS)[number]["id"];

/**
 * Tab icons. `codicon` is the glyph the host's QuickPick shows for the entry;
 * the webview has no codicon font and draws its own SVG per id (tabIcons.ts).
 */
export const TAB_ICONS = [
  { id: "terminal", label: "Terminal", codicon: "terminal" },
  { id: "code", label: "Code", codicon: "code" },
  { id: "server", label: "Server", codicon: "server" },
  { id: "database", label: "Database", codicon: "database" },
  { id: "globe", label: "Globe", codicon: "globe" },
  { id: "bug", label: "Bug", codicon: "bug" },
  { id: "beaker", label: "Beaker", codicon: "beaker" },
  { id: "rocket", label: "Rocket", codicon: "rocket" },
  { id: "gear", label: "Gear", codicon: "gear" },
  { id: "branch", label: "Branch", codicon: "git-branch" },
] as const;

export type TabIconId = (typeof TAB_ICONS)[number]["id"];

/** A known color id, else undefined — for values read from a message or a snapshot. */
export function toTabColor(value: unknown): TabColorId | undefined {
  return TAB_COLORS.find((color) => color.id === value)?.id;
}

/** A known icon id, else undefined — for values read from a message or a snapshot. */
export function toTabIcon(value: unknown): TabIconId | undefined {
  return TAB_ICONS.find((icon) => icon.id === value)?.id;
}

/** The CSS color a tab of this color is drawn in: the theme's value, else Dark+'s. */
export function tabColorCss(id: TabColorId): string {
  const color = TAB_COLORS.find((c) => c.id === id)!;
  return `var(--vscode-${color.themeColor.replace(".", "-")}, ${color.fallback})`;
}
