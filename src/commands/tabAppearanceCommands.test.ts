import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import { TAB_COLORS, TAB_ICONS, type TabColorId, type TabIconId } from "../shared/tabAppearance";
import {
  createTabAppearanceCommands,
  TAB_APPEARANCE_COMMAND_IDS,
  type TabAppearanceCommandDeps,
  type TabAppearancePickItem,
} from "./tabAppearanceCommands";

type Worn = { tabColor?: TabColorId; tabIcon?: TabIconId };

/** Commands over one tab, "t1", wearing `worn`; `choose` picks from what the QuickPick is shown. */
function harness(
  worn: Worn | undefined,
  choose: (items: TabAppearancePickItem<string>[]) => TabAppearancePickItem<string> | undefined,
) {
  const shown: Array<{ items: TabAppearancePickItem<string>[]; placeHolder: string }> = [];
  const deps = {
    resolveTabId: vi.fn((ctx?: { tabId?: string }) => ctx?.tabId ?? "focused"),
    current: vi.fn((tabId: string) => (tabId === "t1" || tabId === "focused" ? worn : undefined)),
    apply: vi.fn(),
    pick: vi.fn(async (items: TabAppearancePickItem<string>[], placeHolder: string) => {
      shown.push({ items, placeHolder });
      return choose(items);
    }),
    themeIcon: (id: string) => ({ id }) as unknown as vscode.ThemeIcon,
    colorSwatch: (color: string) => ({ swatch: color }) as unknown as vscode.Uri,
  };
  const commands = createTabAppearanceCommands(deps as unknown as TabAppearanceCommandDeps);
  return { commands, deps, shown };
}

const byLabel = (label: string) => (items: TabAppearancePickItem<string>[]) => items.find((i) => i.label === label);

describe("Change Tab Color…", () => {
  it("offers every color as its swatch, then No Color, marking the one worn", async () => {
    const h = harness({ tabColor: "green" }, () => undefined);
    await h.commands["portaterm.setTabColor"]({ tabId: "t1" });

    const [{ items, placeHolder }] = h.shown;
    expect(placeHolder).toBe("Select a color for the tab");
    expect(items.map((i) => [i.label, i.value, i.iconPath, i.description])).toEqual([
      ...TAB_COLORS.map((c) => [c.label, c.id, { swatch: c.id }, c.id === "green" ? "current" : undefined]),
      ["No Color", null, { id: "circle-slash" }, undefined],
    ]);
  });

  it("marks No Color when the tab wears none", async () => {
    const h = harness({}, () => undefined);
    await h.commands["portaterm.setTabColor"]({ tabId: "t1" });
    const marked = h.shown[0].items.filter((i) => i.description === "current").map((i) => i.label);
    expect(marked).toEqual(["No Color"]);
  });

  it("writes a choice, and No Color clears", async () => {
    const h = harness({ tabColor: "green" }, byLabel("Magenta"));
    await h.commands["portaterm.setTabColor"]({ tabId: "t1" });
    expect(h.deps.apply).toHaveBeenCalledWith("t1", { tabColor: "magenta" });

    const cleared = harness({ tabColor: "green" }, byLabel("No Color"));
    await cleared.commands["portaterm.setTabColor"]({ tabId: "t1" });
    expect(cleared.deps.apply).toHaveBeenCalledWith("t1", { tabColor: null });
  });

  it("writes nothing when the pick is dismissed", async () => {
    const h = harness({ tabColor: "green" }, () => undefined);
    await h.commands["portaterm.setTabColor"]({ tabId: "t1" });
    expect(h.deps.apply).not.toHaveBeenCalled();
  });
});

describe("Change Tab Icon…", () => {
  it("offers every icon by its codicon, then No Icon, marking the one worn", async () => {
    const h = harness({ tabIcon: "rocket" }, () => undefined);
    await h.commands["portaterm.setTabIcon"]({ tabId: "t1" });

    const [{ items, placeHolder }] = h.shown;
    expect(placeHolder).toBe("Select an icon for the tab");
    expect(items.map((i) => [i.label, i.value, i.iconPath, i.description])).toEqual([
      ...TAB_ICONS.map((icon) => [
        icon.label,
        icon.id,
        { id: icon.codicon },
        icon.id === "rocket" ? "current" : undefined,
      ]),
      ["No Icon", null, { id: "circle-slash" }, undefined],
    ]);
  });

  it("writes a choice, No Icon clears, and a dismissal writes nothing", async () => {
    const h = harness({}, byLabel("Branch"));
    await h.commands["portaterm.setTabIcon"]({ tabId: "t1" });
    expect(h.deps.apply).toHaveBeenCalledWith("t1", { tabIcon: "branch" });
    expect(h.shown[0].items.filter((i) => i.description === "current").map((i) => i.label)).toEqual(["No Icon"]);

    const cleared = harness({ tabIcon: "bug" }, byLabel("No Icon"));
    await cleared.commands["portaterm.setTabIcon"]({ tabId: "t1" });
    expect(cleared.deps.apply).toHaveBeenCalledWith("t1", { tabIcon: null });

    const dismissed = harness({ tabIcon: "bug" }, () => undefined);
    await dismissed.commands["portaterm.setTabIcon"]({ tabId: "t1" });
    expect(dismissed.deps.apply).not.toHaveBeenCalled();
  });
});

describe("tab appearance targets", () => {
  it("acts on the tab the resolver names — the right-clicked one, else the focused one", async () => {
    const h = harness({}, byLabel("Red"));
    await h.commands["portaterm.setTabColor"](undefined);
    expect(h.deps.resolveTabId).toHaveBeenCalledWith(undefined);
    expect(h.deps.apply).toHaveBeenCalledWith("focused", { tabColor: "red" });
  });

  it("shows nothing when there is no tab, or it is not a root tab", async () => {
    for (const id of TAB_APPEARANCE_COMMAND_IDS) {
      const none = harness({}, byLabel("Red"));
      none.deps.resolveTabId.mockReturnValue(undefined as never);
      await none.commands[id](undefined);
      expect(none.deps.pick).not.toHaveBeenCalled();

      const gone = harness({}, byLabel("Red"));
      await gone.commands[id]({ tabId: "split-pane" });
      expect(gone.deps.pick).not.toHaveBeenCalled();
      expect(gone.deps.apply).not.toHaveBeenCalled();
    }
  });
});
