// @vitest-environment jsdom
//
// src/webview/worktree/worktreeView/keyboardNav.test.ts — OBL-2: focus lands on a
// row that is rendered NOW, not on one the collaborator saw when it was wired.
//
// The pragma is per file. The view's own suite has one; that does not carry here.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createKeyboardNav, type KeyboardNav } from "./keyboardNav";

let host: HTMLElement;
let nav: KeyboardNav;
const toggleCollapsed = vi.fn();
const toggleIdleTail = vi.fn();
const toggleRow = vi.fn();

/** Rows as the renderer writes them: a class the selector matches, plus an identity. */
function paint(...worktreeIds: string[]): HTMLElement[] {
  host.replaceChildren();
  return worktreeIds.map((id) => {
    const row = document.createElement("div");
    row.className = "wt-row";
    row.dataset.worktreeId = id;
    row.tabIndex = -1;
    host.append(row);
    return row;
  });
}

function press(key: string): void {
  nav.onKeyDown(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.replaceChildren();
  host = document.createElement("div");
  document.body.append(host);
  nav = createKeyboardNav({
    element: () => host,
    toggleCollapsed,
    toggleIdleTail,
    toggleRow,
  });
});

describe("roving tabindex", () => {
  it("gives the tree exactly one tab stop", () => {
    const rows = paint("w1", "w2", "w3");
    nav.syncRovingTabindex();
    expect(rows.map((r) => r.tabIndex)).toEqual([0, -1, -1]);
  });

  it("moves the stop to a row focused by pointer, which never goes through focusRow", () => {
    const rows = paint("w1", "w2");
    nav.syncRovingTabindex();

    rows[1]?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    nav.onFocusIn({ target: rows[1] } as unknown as Event);

    expect(rows.map((r) => r.tabIndex)).toEqual([-1, 0]);
    expect(nav.focusedKey()).toBe("w2");
  });

  it("re-seats the stop on the first row when the focused one stops being rendered", () => {
    paint("w1", "w2");
    nav.syncRovingTabindex();
    nav.focusRow(host.querySelectorAll<HTMLElement>(".wt-row")[1]);
    expect(nav.focusedKey()).toBe("w2");

    const after = paint("w3", "w4");
    nav.syncRovingTabindex();
    expect(nav.focusedKey()).toBe("w3");
    expect(after.map((r) => r.tabIndex)).toEqual([0, -1]);
  });
});

describe("traversal reads the rows that are rendered now (OBL-2)", () => {
  it("focuses a row of the CURRENT host after a repaint replaced every row", () => {
    paint("w1", "w2");
    nav.syncRovingTabindex();
    nav.focusRow(host.querySelectorAll<HTMLElement>(".wt-row")[0]);

    // The repaint the view does on every push: same host, all new elements.
    const fresh = paint("w1", "w2");

    press("ArrowDown");

    // The top of the CURRENT paint, not the second row: the previously focused
    // element was detached by the repaint, so `document.activeElement` is no
    // longer a row and the index resets. What matters is which paint it came
    // from — a captured row list would have focused a detached node from the
    // first one, and `host.contains` would be false.
    expect(fresh).toContain(document.activeElement);
    expect(document.activeElement).toBe(fresh[0]);
    expect(host.contains(document.activeElement)).toBe(true);
  });

  it("stays on the last row at the bottom rather than wrapping", () => {
    const rows = paint("w1", "w2");
    nav.focusRow(rows[1]);
    press("ArrowDown");
    expect(document.activeElement).toBe(rows[1]);
  });

  it("Home and End jump to the ends of the current paint", () => {
    const rows = paint("w1", "w2", "w3");
    nav.focusRow(rows[1]);
    press("End");
    expect(document.activeElement).toBe(rows[2]);
    press("Home");
    expect(document.activeElement).toBe(rows[0]);
  });
});
