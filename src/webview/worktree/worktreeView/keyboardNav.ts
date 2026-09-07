// src/webview/worktree/worktreeView/keyboardNav.ts — Roving tabindex and tree
// traversal over the rendered rows.
//
// Extracted from `WorktreeView` by change `decompose-worktree-webview`
// (design.md D1, task 1_2). It reads no `WorktreeViewData`: everything it needs
// is on the DOM the view just wrote, which is why it lifts cleanly.
//
// `navRows()` is re-read at every event rather than captured. A row list taken
// once goes stale the moment a repaint replaces the children, and focus then
// lands on a detached node (design.md OBL-2).

import { idleTailKey } from "./foldState";

/** Every row kind that takes part in traversal. */
const NAV_ROWS = ".wt-repo, .wt-idle, .wt-row, .wt-arow, .wt-srow";

/**
 * One tab stop for the tree, and one more inside the row that owns it: a row's
 * own action control joins the tab order only while that row is the stop, so
 * tabbing from a focused row reaches its actions and tabbing again leaves.
 */
export function setRowTabStop(row: HTMLElement, isStop: boolean): void {
  row.tabIndex = isStop ? 0 : -1;
  for (const action of row.querySelectorAll<HTMLElement>(".wt-rowaction, .wt-at-badge")) {
    action.tabIndex = isStop ? 0 : -1;
  }
}

export interface KeyboardNavDeps {
  /** Read, never captured: the host's children are replaced on every repaint. */
  element(): HTMLElement;
  toggleCollapsed(id: string): void;
  toggleIdleTail(repoId: string): void;
  toggleRow(rowId: string): void;
}

export interface KeyboardNav {
  navRows(): HTMLElement[];
  keyOf(row: HTMLElement): string;
  syncRovingTabindex(): void;
  stampLevels(multiRepo: boolean): void;
  focusRow(row: HTMLElement | undefined): void;
  onKeyDown(ev: KeyboardEvent): void;
  /** The host's `focusin` delegate: the tab stop follows focus that arrived by pointer. */
  onFocusIn(ev: Event): void;
  /**
   * The key of the row focus is on, or `null`. The view restores through this.
   *
   * Read-only on purpose. A setter would let a caller move the focused key
   * without the tab-stop pass `focusRow` and `syncRovingTabindex` always run
   * with it — the split ownership of roving focus this collaborator exists to
   * end (.reviews/round-1.md F001).
   */
  focusedKey(): string | null;
}

export function createKeyboardNav(deps: KeyboardNavDeps): KeyboardNav {
  let focusedKey: string | null = null;

  /** Every focusable row, in visual order. The presence pill and the agents header
   *  are excluded: both duplicate the worktree row's own toggle, and both are hidden
   *  from assistive tech because neither is a valid child of `role="tree"`. */
  function navRows(): HTMLElement[] {
    return Array.from(deps.element().querySelectorAll<HTMLElement>(NAV_ROWS));
  }

  /** One tab stop for the whole tree; arrows move within it. */
  function syncRovingTabindex(): void {
    const rows = navRows();
    let focused = rows.find((r) => keyOf(r) === focusedKey);
    if (!focused) {
      focused = rows[0];
      focusedKey = focused ? keyOf(focused) : null;
    }
    for (const row of rows) {
      setRowTabStop(row, row === focused);
    }
  }

  function keyOf(row: HTMLElement): string {
    // The disclosure's `idleKey` IS its repo's id, byte-identical to the header's
    // `repoId` — two row kinds, one string. Namespacing the navigation key the same
    // way the collapse key is namespaced is what keeps them apart; without it the
    // header renders first and wins every lookup, so focus and the tab stop land
    // on the repository instead of the tail.
    const idleKey = row.dataset.idleKey;
    if (idleKey !== undefined) {
      return idleTailKey(idleKey);
    }
    return row.dataset.worktreeId ?? row.dataset.repoId ?? row.dataset.rowId ?? row.dataset.subKey ?? "";
  }

  /**
   * `aria-level` on every navigable row, from the one depth model. A flat
   * `role="tree"` carries no structure of its own, so a level declared on some
   * kinds and left implicit on others is worse than none: the disclosure would
   * announce as a sibling of the header it sits under. `depthOf` is zero-based and
   * the header only exists multi-repo, hence the offset.
   */
  function stampLevels(multiRepo: boolean): void {
    const offset = multiRepo ? 1 : 0;
    for (const row of navRows()) {
      row.setAttribute("aria-level", String(depthOf(row) + offset));
    }
  }

  /** Depth in the declared tree, from the row's own class. */
  function depthOf(row: HTMLElement): number {
    if (row.classList.contains("wt-repo")) {
      return 0;
    }
    if (row.classList.contains("wt-idle")) {
      return 1;
    }
    if (row.classList.contains("wt-row")) {
      // A row inside the tail sits UNDER the disclosure, so Right can descend into
      // it and Left can climb back out.
      return row.classList.contains("wt-row--in-tail") ? 2 : 1;
    }
    return row.classList.contains("wt-arow") ? 2 : 3;
  }

  /** The nearest preceding row one level up — the parent every tree keyboard
   *  model needs and a flat NodeList does not carry. */
  function parentOf(rows: HTMLElement[], index: number): HTMLElement | undefined {
    const target = rows[index];
    if (!target) {
      return undefined;
    }
    const depth = depthOf(target);
    for (let i = index - 1; i >= 0; i--) {
      const candidate = rows[i];
      if (candidate && depthOf(candidate) < depth) {
        return candidate;
      }
    }
    return undefined;
  }

  function focusRow(row: HTMLElement | undefined): void {
    if (!row) {
      return;
    }
    // The stops are written here and NOT again by the delegate `focus()` fires:
    // `focusedKey` already names this row, and the delegate returns early on
    // that. Two full-tree passes per arrow keypress was the cost otherwise.
    for (const other of navRows()) {
      setRowTabStop(other, other === row);
    }
    focusedKey = keyOf(row);
    row.focus();
  }

  function onKeyDown(ev: KeyboardEvent): void {
    const rows = navRows();
    if (rows.length === 0) {
      return;
    }
    // A row's action control can hold focus, and it is not a row. Resolving it
    // to its owner first is what keeps every arrow working from there: indexing
    // the control itself yields -1, which sends both vertical arrows to the top
    // of the tree and hands the horizontal pair something that is not a row.
    const target = document.activeElement as HTMLElement | null;
    const active = target?.closest<HTMLElement>(NAV_ROWS) ?? null;
    const index = active ? rows.indexOf(active) : -1;
    switch (ev.key) {
      case "ArrowDown":
        ev.preventDefault();
        focusRow(rows[Math.min(rows.length - 1, index + 1)] ?? rows[0]);
        return;
      case "ArrowUp":
        ev.preventDefault();
        focusRow(index <= 0 ? rows[0] : rows[index - 1]);
        return;
      case "Home":
        ev.preventDefault();
        focusRow(rows[0]);
        return;
      case "End":
        ev.preventDefault();
        focusRow(rows[rows.length - 1]);
        return;
      case "ArrowRight":
      case "ArrowLeft": {
        if (!active) {
          return;
        }
        ev.preventDefault();
        expandOrDescend(active, ev.key === "ArrowRight", rows, index);
        return;
      }
      default:
    }
  }

  /**
   * Right opens a closed node, then descends into an open one, and does nothing on
   * a leaf. Left closes an open node, then ascends to the PARENT — not the previous
   * visual row, which on a nested row is a sibling and takes the user sideways.
   */
  function expandOrDescend(active: HTMLElement, forward: boolean, rows: HTMLElement[], index: number): void {
    const expandable = active.hasAttribute("aria-expanded");
    const isOpen = expandable && active.getAttribute("aria-expanded") === "true";

    if (expandable && forward !== isOpen) {
      const treeId = active.dataset.worktreeId ?? active.dataset.repoId;
      const idleKey = active.dataset.idleKey;
      const rowId = active.dataset.rowId;
      if (idleKey) {
        deps.toggleIdleTail(idleKey);
        const key = idleTailKey(idleKey);
        focusRow(navRows().find((r) => keyOf(r) === key));
        return;
      }
      if (treeId) {
        deps.toggleCollapsed(treeId);
      } else if (rowId) {
        deps.toggleRow(rowId);
      } else {
        return;
      }
      const key = treeId ?? rowId;
      focusRow(navRows().find((r) => keyOf(r) === key));
      return;
    }

    if (forward) {
      // Descend only into a child. A leaf stays put rather than sliding to the
      // next branch, which would read as navigation the tree did not offer.
      const next = rows[index + 1];
      if (isOpen && next && depthOf(next) > depthOf(active)) {
        focusRow(next);
      }
      return;
    }
    focusRow(parentOf(rows, index));
  }
  /**
   * Written here, where focus actually arrives, rather than in each toggle path:
   * a pointer press moves focus without going through `focusRow`, and the stop
   * has to move with it or the pressed row's action is unreachable by the Tab
   * that follows.
   */
  function onFocusIn(ev: Event): void {
    const row = (ev.target as HTMLElement | null)?.closest<HTMLElement>(NAV_ROWS);
    if (row === undefined || row === null) {
      return;
    }
    const key = keyOf(row);
    if (key === focusedKey) {
      // Already the stop — `focusRow` writes them before it focuses, so this is
      // that focus arriving. Repeating the pass here doubled the DOM work of
      // every arrow keypress (round-1 W4).
      return;
    }
    focusedKey = key;
    for (const other of navRows()) {
      setRowTabStop(other, other === row);
    }
  }

  return {
    navRows,
    onFocusIn,
    keyOf,
    syncRovingTabindex,
    stampLevels,
    focusRow,
    onKeyDown,
    focusedKey: () => focusedKey,
  };
}
