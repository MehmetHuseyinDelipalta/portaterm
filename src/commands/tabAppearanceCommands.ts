// src/commands/tabAppearanceCommands.ts — Change Tab Color… / Change Tab Icon…, as a factory.
//
// The state is the host's (`SessionManager.setTabAppearance`, persisted with the
// snapshot); the webview only draws it. What is worth testing here is the
// QuickPick each command shows and what a choice — or a dismissal — writes, so
// that lives in this factory rather than as closures inside `activate()`.

import type * as vscode from "vscode";
import { TAB_COLORS, TAB_ICONS, type TabColorId, type TabIconId } from "../shared/tabAppearance";

/** What a context-menu command is handed by the tab's right-click. */
export interface TabAppearanceCommandContext {
  tabId?: string;
}

/** One QuickPick entry. `value` null is the "none" entry, which clears. */
export interface TabAppearancePickItem<T> extends vscode.QuickPickItem {
  value: T | null;
}

export interface TabAppearanceCommandDeps {
  /** The tab a command acts on: the right-clicked one, else the focused one (the rename chain). */
  resolveTabId(ctx: TabAppearanceCommandContext | undefined): string | undefined;
  /** The tab's color and icon as they stand, or undefined for no such root tab. */
  current(tabId: string): { tabColor?: TabColorId; tabIcon?: TabIconId } | undefined;
  apply(tabId: string, change: { tabColor?: TabColorId | null; tabIcon?: TabIconId | null }): void;
  /** `vscode.window.showQuickPick`; resolves undefined when dismissed. */
  pick<T>(items: TabAppearancePickItem<T>[], placeHolder: string): Thenable<TabAppearancePickItem<T> | undefined>;
  /** `new vscode.ThemeIcon(codicon)`. */
  themeIcon(codicon: string): vscode.ThemeIcon;
  /**
   * The swatch file a color's entry shows. Not a colored ThemeIcon: Cursor's
   * QuickPick drops an extension item's ThemeIcon color, so every dot came out white.
   */
  colorSwatch(color: TabColorId): vscode.Uri;
}

export const TAB_APPEARANCE_COMMAND_IDS = ["portaterm.setTabColor", "portaterm.setTabIcon"] as const;

export type TabAppearanceCommands = Record<
  (typeof TAB_APPEARANCE_COMMAND_IDS)[number],
  (ctx?: TabAppearanceCommandContext) => Promise<void>
>;

const CURRENT = "current";

export function createTabAppearanceCommands(deps: TabAppearanceCommandDeps): TabAppearanceCommands {
  // Every choice, then "none" last; the one the tab wears now is marked. A
  // dismissal writes nothing, while "none" clears.
  const choose = async <T extends string>(
    ctx: TabAppearanceCommandContext | undefined,
    read: (current: { tabColor?: TabColorId; tabIcon?: TabIconId }) => T | undefined,
    choices: ReadonlyArray<{ id: T; label: string; iconPath: vscode.ThemeIcon | vscode.Uri }>,
    noneLabel: string,
    placeHolder: string,
    write: (tabId: string, value: T | null) => void,
  ): Promise<void> => {
    const tabId = deps.resolveTabId(ctx);
    const current = tabId === undefined ? undefined : deps.current(tabId);
    if (tabId === undefined || current === undefined) {
      return;
    }
    const worn = read(current);
    const items: TabAppearancePickItem<T>[] = [
      ...choices.map(({ id, label, iconPath }) => ({
        label,
        description: id === worn ? CURRENT : undefined,
        iconPath,
        value: id,
      })),
      {
        label: noneLabel,
        description: worn === undefined ? CURRENT : undefined,
        iconPath: deps.themeIcon("circle-slash"),
        value: null,
      },
    ];
    const choice = await deps.pick(items, placeHolder);
    if (choice) {
      write(tabId, choice.value);
    }
  };

  return {
    "portaterm.setTabColor": (ctx) =>
      choose(
        ctx,
        (current) => current.tabColor,
        TAB_COLORS.map((c) => ({ id: c.id, label: c.label, iconPath: deps.colorSwatch(c.id) })),
        "No Color",
        "Select a color for the tab",
        (tabId, tabColor) => deps.apply(tabId, { tabColor }),
      ),
    "portaterm.setTabIcon": (ctx) =>
      choose(
        ctx,
        (current) => current.tabIcon,
        TAB_ICONS.map((i) => ({ id: i.id, label: i.label, iconPath: deps.themeIcon(i.codicon) })),
        "No Icon",
        "Select an icon for the tab",
        (tabId, tabIcon) => deps.apply(tabId, { tabIcon }),
      ),
  };
}
