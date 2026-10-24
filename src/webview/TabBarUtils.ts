// src/webview/TabBarUtils.ts — Tab bar rendering utility
//
// Extracted for testability. Pure DOM rendering function with dependency injection.
// See: docs/design/flow-multi-tab.md#Data-Routing-Architecture

import { stripDecorations } from "../shared/titleDecorations";
import { getAllSessionIds, type SplitNode } from "./SplitModel";
import type { TerminalInstance } from "./state/WebviewStateStore";
import { attachTooltip } from "./ui/Tooltip";
import { ICON_BRANCH } from "./worktree/worktreeIcons";

/** Minimal terminal info needed for tab bar rendering. */
const scopeTooltipDisposers = new WeakMap<HTMLElement, () => void>();
const scopeResizeObservers = new WeakMap<HTMLElement, ResizeObserver>();

type ScopeDensity = "full" | "kind" | "icon";

export function chooseScopeDensity(
  availableWidth: number,
  widths: { full: number; kind: number; icon: number },
): ScopeDensity {
  if (availableWidth >= widths.full) {
    return "full";
  }
  if (availableWidth >= widths.kind) {
    return "kind";
  }
  return "icon";
}

function syncScopeDensity(tabBarEl: HTMLElement): void {
  const scope = tabBarEl.querySelector<HTMLElement>(":scope > .tab-scope");
  if (!scope) {
    return;
  }
  // JSDOM and detached callers have no layout. Full is the honest fallback;
  // the browser re-runs this through ResizeObserver once a real width exists.
  if (tabBarEl.clientWidth <= 0) {
    scope.dataset.density = "full";
    return;
  }
  const occupied = Array.from(tabBarEl.children)
    .filter((child) => child !== scope)
    .reduce((total, child) => total + (child as HTMLElement).offsetWidth, 0);
  const available = Math.max(0, tabBarEl.clientWidth - occupied);
  const closeReserve = 0;
  const measure = (density: ScopeDensity): number => {
    scope.dataset.density = density;
    return scope.scrollWidth + closeReserve;
  };
  const widths = {
    full: measure("full"),
    kind: measure("kind"),
    icon: measure("icon"),
  };
  scope.dataset.density = chooseScopeDensity(available, widths);
}

function observeScopeDensity(tabBarEl: HTMLElement): void {
  if (scopeResizeObservers.has(tabBarEl) || typeof ResizeObserver === "undefined") {
    return;
  }
  const observer = new ResizeObserver(() => {
    syncScopeDensity(tabBarEl);
    syncTabOverflow(tabBarEl);
  });
  observer.observe(tabBarEl);
  scopeResizeObservers.set(tabBarEl, observer);
}

// ─── Overflow: keep the active tab on screen, count what is past the edge ───

/** The active tab id the bar last scrolled into view, per bar. */
const revealedActiveTab = new WeakMap<HTMLElement, string | null>();
const overflowScrollListeners = new WeakSet<HTMLElement>();

/**
 * How many tabs end past the visible right edge, `reserve` px of which is
 * covered by the sticky controls. A tab cut off part-way counts: its name is
 * what the user cannot read.
 */
export function countTabsPastRightEdge(tabRights: readonly number[], visibleWidth: number, reserve: number): number {
  const edge = visibleWidth - reserve;
  return tabRights.filter((right) => right > edge + 1).length;
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Width the sticky right-edge controls (overflow count, scope chip) cover over the tabs. */
function stickyReserve(tabBarEl: HTMLElement): number {
  const chip = tabBarEl.querySelector<HTMLElement>(":scope > .tab-scope");
  const overflow = tabBarEl.querySelector<HTMLElement>(":scope > .tab-overflow");
  return (chip?.offsetWidth ?? 0) + (overflow && !overflow.hidden ? overflow.offsetWidth : 0);
}

/**
 * Scroll the bar just enough that `tab` is fully visible beside the sticky
 * controls. Done by hand rather than `scrollIntoView`, which would also scroll
 * the `overflow: hidden` ancestors and shove the whole layout sideways.
 */
function scrollTabIntoView(tabBarEl: HTMLElement, tab: HTMLElement): void {
  if (tabBarEl.clientWidth <= 0) {
    return;
  }
  const barLeft = tabBarEl.getBoundingClientRect().left;
  const rect = tab.getBoundingClientRect();
  const left = rect.left - barLeft;
  const right = rect.right - barLeft;
  const visibleWidth = tabBarEl.clientWidth - stickyReserve(tabBarEl);
  let delta = 0;
  if (left < 0) {
    delta = left;
  } else if (right > visibleWidth) {
    // A tab wider than the visible strip keeps its start (status + name) in view.
    delta = Math.min(right - visibleWidth, left);
  }
  if (delta === 0) {
    return;
  }
  const target = tabBarEl.scrollLeft + delta;
  if (typeof tabBarEl.scrollTo === "function") {
    tabBarEl.scrollTo({ left: target, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  } else {
    tabBarEl.scrollLeft = target;
  }
}

/**
 * Bring the active tab into view. `renderTabBar` does this on its own whenever
 * the active tab changes; callers use it when a pane was brought forward on
 * purpose (a vault resume, a worktree row) and the tab may already have been the
 * active one, scrolled out of sight.
 */
export function revealActiveTab(tabBarEl: HTMLElement): void {
  const active = tabBarEl.querySelector<HTMLElement>(":scope > .tab-item.active");
  if (active) {
    scrollTabIntoView(tabBarEl, active);
  }
}

/**
 * Bring the tab `tabId` into view. For a tab that moved without the active tab
 * changing — pinning or unpinning re-sorts it to the other end of the strip.
 */
export function revealTab(tabBarEl: HTMLElement, tabId: string): void {
  const tab = Array.from(tabBarEl.querySelectorAll<HTMLElement>(":scope > .tab-item")).find(
    (el) => el.dataset.tabId === tabId,
  );
  if (tab) {
    scrollTabIntoView(tabBarEl, tab);
  }
}

/**
 * Draw the `+N` mark for tabs past the right edge, or remove it when there are
 * none. Absent rather than hidden when unused, so the bar's child list is only
 * tabs, `+` and the scope chip on a surface that fits.
 */
function syncTabOverflow(tabBarEl: HTMLElement): void {
  let mark = tabBarEl.querySelector<HTMLButtonElement>(":scope > .tab-overflow") ?? undefined;
  // JSDOM and detached callers have no layout, so nothing can be past an edge.
  if (tabBarEl.clientWidth <= 0) {
    mark?.remove();
    return;
  }
  const chip = tabBarEl.querySelector<HTMLElement>(":scope > .tab-scope");
  const chipWidth = chip?.offsetWidth ?? 0;
  const barLeft = tabBarEl.getBoundingClientRect().left;
  const tabs = Array.from(tabBarEl.querySelectorAll<HTMLElement>(":scope > .tab-item"));
  const rights = tabs.map((tab) => tab.getBoundingClientRect().right - barLeft);
  if (countTabsPastRightEdge(rights, tabBarEl.clientWidth, chipWidth) === 0) {
    mark?.remove();
    return;
  }
  if (!mark) {
    mark = document.createElement("button");
    mark.type = "button";
    mark.className = "tab-overflow";
    mark.addEventListener("click", () => {
      // Reveal the first tab past the edge; the next click reveals the one after.
      const reserve = stickyReserve(tabBarEl);
      const left = tabBarEl.getBoundingClientRect().left;
      const next = Array.from(tabBarEl.querySelectorAll<HTMLElement>(":scope > .tab-item")).find(
        (tab) => tab.getBoundingClientRect().right - left > tabBarEl.clientWidth - reserve + 1,
      );
      if (next) {
        scrollTabIntoView(tabBarEl, next);
      }
    });
    tabBarEl.insertBefore(mark, chip);
  }
  mark.style.right = `${chipWidth}px`;
  // Measured with the mark in place: it covers tabs too, and its own width
  // depends on the digits it shows.
  mark.textContent = `+${countTabsPastRightEdge(rights, tabBarEl.clientWidth, chipWidth)}`;
  const edge = tabBarEl.clientWidth - chipWidth - mark.offsetWidth;
  const hidden = tabs.filter((_tab, i) => (rights[i] ?? 0) > edge + 1);
  mark.textContent = `+${hidden.length}`;
  const waiting = hidden.some((tab) => tab.dataset.status === "waiting");
  mark.classList.toggle("tab-overflow-waiting", waiting);
  const noun = hidden.length === 1 ? "tab" : "tabs";
  const label = `${hidden.length} more ${noun} to the right${waiting ? ", one needs you" : ""}`;
  mark.title = label;
  mark.setAttribute("aria-label", label);
}

function observeTabOverflow(tabBarEl: HTMLElement): void {
  if (overflowScrollListeners.has(tabBarEl)) {
    return;
  }
  tabBarEl.addEventListener("scroll", () => syncTabOverflow(tabBarEl), { passive: true });
  overflowScrollListeners.add(tabBarEl);
}

/** Pin glyph for a pinned tab — stroked with `currentColor` to follow the tab's text color. */
const PIN_ICON =
  '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M10 1.75 14.25 6l-2.5 1-3.5 3.5-.5 3L3.5 9.25l3-.5 3.5-3.5z"/><path d="M5.75 10.25 1.75 14.25"/></svg>';

export interface TabInfo {
  /** Auto-derived name (default "Terminal N"; mutated by OSC title events). */
  name: string;
  /** User-supplied name; when non-null wins over `name` in the rendered label. */
  customName?: string | null;
  /** Pinned tabs render first, with a pin mark in place of the close button. */
  pinned?: boolean;
  /** Stable linked-worktree owner. Absent means main. */
  worktreeId?: string;
  /** Whether the terminal process has exited. */
  exited?: boolean;
  /** Recent PTY output activity for the status indicator. */
  activityStatus?: "idle" | "running" | "waiting";
}

/** Minimal store interface for buildTabBarData — avoids importing full WebviewStateStore. */
export interface TabBarDataSource {
  tabLayouts: Map<string, SplitNode>;
  tabActivePaneIds: Map<string, string>;
  terminals: Map<string, TerminalInstance>;
}

/** Linked-owner filter projected from the total active owner. Main is absent. */
export interface TabBarScope {
  worktreeId: string;
  /** Presence decorates hidden waiting counts; it never decides membership. */
  waiting?: ReadonlySet<string>;
}

/** Main is the absence of a linked owner; linked membership matches one stable id. */
export function inScope(scope: TabBarScope | undefined, _paneId: string, stableOwner?: string): boolean {
  return scope ? stableOwner === scope.worktreeId : stableOwner === undefined;
}

function ownerOf(store: TabBarDataSource, paneId: string): string | undefined {
  return store.terminals.get(paneId)?.worktreeId;
}

/**
 * Build a filtered terminals map for tab bar rendering.
 * Only includes "root" tabs (those with a tabLayout entry).
 * For split tabs, uses the active pane's name.
 */
/**
 * A pane's auto-derived label, falling back to the `Terminal N` it started with
 * when the program cleared its title. Resolved here rather than at each render
 * site so root tabs and split tabs cannot disagree about it, and so nothing
 * downstream has to know that an empty `name` is a real state
 * (process-title-tracking § "OSC Title Change Handling").
 */
function labelFor(instance: TerminalInstance | undefined): string | undefined {
  if (!instance) {
    return undefined;
  }
  return instance.name === "" ? instance.defaultName : instance.name;
}

/**
 * What the bar draws, and what it is holding back.
 *
 * One return rather than a map plus a second query: the count is over exactly the
 * tabs this pass DROPPED, so there is only ever one definition of "hidden". A
 * separate counter would be a second implementation of the filter, and the two
 * would drift into a badge naming panes the bar does not agree are missing.
 */
export interface TabBarData {
  tabs: Map<string, TabInfo>;
  /** Hidden tabs holding a waiting pane. `0` renders no mark at all, never a zero. */
  hiddenWaiting: number;
}

/**
 * Whether any pane of a hidden tab needs a human, by EITHER source.
 *
 * An exited pane is excluded the way the split aggregation already excludes it —
 * a finished process is not waiting on anybody. The unit is the TAB: a split with
 * two waiting panes is one hidden thing and counts once (worktree-scope.md § 4.2).
 */
function tabIsWaiting(paneIds: readonly string[], store: TabBarDataSource, waiting: ReadonlySet<string>): boolean {
  return paneIds.some((paneId) => {
    const instance = store.terminals.get(paneId);
    if (instance?.exited) {
      return false;
    }
    return instance?.activityStatus === "waiting" || waiting.has(paneId);
  });
}

export function buildTabBarData(store: TabBarDataSource, scope?: TabBarScope): TabBarData {
  const tabTerminals = new Map<string, TabInfo>();
  const waiting = scope?.waiting ?? new Set<string>();
  let hiddenWaiting = 0;
  for (const [tabId, layout] of store.tabLayouts) {
    if (layout.type === "branch") {
      // Split tab — show active pane's name and exited state. Custom name lives
      // on the root tab and wins over per-pane process names (see add-tab-rename
      // design.md D5 + split-focus-management spec). Activity aggregates across
      // panes: any non-exited leaf still producing output lights the tab.
      const activePaneId = store.tabActivePaneIds.get(tabId) ?? tabId;
      const activeInstance = store.terminals.get(activePaneId);
      const rootInstance = store.terminals.get(tabId);
      // Split children inherit their source owner's stable id. Membership is
      // still checked per live leaf so collapsed layouts keep their owner.
      const sessionIds = getAllSessionIds(layout);
      if (!sessionIds.some((sid) => inScope(scope, sid, ownerOf(store, sid)))) {
        // Counted HERE, at the drop, which is why a split can never be presented
        // and counted at once.
        if (tabIsWaiting(sessionIds, store, waiting)) {
          hiddenWaiting += 1;
        }
        continue;
      }
      const leaves = sessionIds.map((sid) => store.terminals.get(sid));
      const anyWaiting = leaves.some((inst) => inst?.activityStatus === "waiting" && !inst.exited);
      const anyRunning = leaves.some((inst) => inst?.activityStatus === "running" && !inst.exited);
      tabTerminals.set(tabId, {
        name: labelFor(activeInstance) ?? labelFor(rootInstance) ?? tabId,
        customName: rootInstance?.customName ?? null,
        pinned: rootInstance?.pinned === true,
        exited: (activeInstance ?? rootInstance)?.exited,
        activityStatus: anyWaiting ? "waiting" : anyRunning ? "running" : "idle",
        worktreeId: activeInstance?.worktreeId ?? rootInstance?.worktreeId,
      });
    } else {
      // Single pane tab. The scope decision is keyed by the LEAF's session id, not
      // the tab id: collapsing a split leaves the tab keyed by its original pane
      // while the surviving leaf carries another, and judging the dead id hid the
      // live pane from the filter entirely (round-2 W3). The name lookup below is
      // pre-existing and stays keyed by the tab.
      const paneId = layout.sessionId;
      const instance = store.terminals.get(tabId);
      const presented = inScope(scope, paneId, ownerOf(store, paneId));
      if (instance && presented) {
        tabTerminals.set(tabId, {
          name: labelFor(instance) ?? tabId,
          customName: instance.customName,
          pinned: instance.pinned === true,
          exited: instance.exited,
          activityStatus: instance.activityStatus,
          worktreeId: instance.worktreeId,
        });
      } else if (!presented && tabIsWaiting([paneId], store, waiting)) {
        // Gated on HIDDENNESS, not on holding an instance: the split branch counts
        // a pane on presence evidence alone, and a leaf the surface has not built
        // an instance for yet is the same hidden waiting thing (round-1 W5).
        hiddenWaiting += 1;
      }
    }
  }
  return { tabs: pinnedFirst(tabTerminals), hiddenWaiting };
}

/** Pinned tabs first, each group keeping its own order (a stable partition). */
function pinnedFirst(tabs: Map<string, TabInfo>): Map<string, TabInfo> {
  const entries = [...tabs];
  if (!entries.some(([, tab]) => tab.pinned)) {
    return tabs;
  }
  return new Map([...entries.filter(([, tab]) => tab.pinned), ...entries.filter(([, tab]) => !tab.pinned)]);
}

interface TabHandlers {
  id: string;
  pinned: boolean;
  onTabClick: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onTabRename?: (tabId: string, tabEl: HTMLElement) => void;
  onTabReorder?: (tabId: string, targetTabId: string, placement: "before" | "after") => void;
}

const tabHandlers = new WeakMap<HTMLElement, TabHandlers>();

/** Marks a drag as a Portaterm tab, so a file or text drag is never taken for one. */
export const TAB_DRAG_MIME = "application/x-portaterm-tab";

/**
 * The tab being dragged. `dataTransfer` is unreadable during `dragover`, and the
 * drop target has to know the source's pin group to accept or refuse the drop.
 */
let draggedTab: { el: HTMLElement; id: string; pinned: boolean } | null = null;

function clearDropMarks(tabBarEl: Element | null): void {
  for (const el of tabBarEl?.querySelectorAll(".tab-drop-before, .tab-drop-after") ?? []) {
    el.classList.remove("tab-drop-before", "tab-drop-after");
  }
}

/**
 * A drop target for `draggedTab`, or null. Pinned tabs always render first, so a
 * drop is only accepted inside the source's own pin group: anything else would
 * be undone by the next render's pinned-first partition.
 */
function dropTargetFor(tab: HTMLElement): TabHandlers | null {
  const target = tabHandlers.get(tab);
  if (!draggedTab || !target?.onTabReorder || target.id === draggedTab.id || target.pinned !== draggedTab.pinned) {
    return null;
  }
  return target;
}

function placementFor(tab: HTMLElement, clientX: number): "before" | "after" {
  const rect = tab.getBoundingClientRect();
  return clientX < rect.left + rect.width / 2 ? "before" : "after";
}

function attachTabDragHandlers(tab: HTMLElement): void {
  tab.addEventListener("dragstart", (event) => {
    const handlers = tabHandlers.get(tab);
    if (!handlers?.onTabReorder || !event.dataTransfer) {
      event.preventDefault();
      return;
    }
    draggedTab = { el: tab, id: handlers.id, pinned: handlers.pinned };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(TAB_DRAG_MIME, handlers.id);
    tab.classList.add("tab-dragging");
  });
  tab.addEventListener("dragend", () => {
    tab.classList.remove("tab-dragging");
    clearDropMarks(tab.parentElement);
    draggedTab = null;
  });
  tab.addEventListener("dragover", (event) => {
    if (!dropTargetFor(tab)) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    const placement = placementFor(tab, event.clientX);
    clearDropMarks(tab.parentElement);
    tab.classList.add(placement === "before" ? "tab-drop-before" : "tab-drop-after");
  });
  tab.addEventListener("dragleave", (event) => {
    if (!(event.relatedTarget instanceof Node && tab.contains(event.relatedTarget))) {
      tab.classList.remove("tab-drop-before", "tab-drop-after");
    }
  });
  tab.addEventListener("drop", (event) => {
    const target = dropTargetFor(tab);
    const source = draggedTab;
    clearDropMarks(tab.parentElement);
    if (!target || !source) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    target.onTabReorder?.(source.id, target.id, placementFor(tab, event.clientX));
  });
}

/** Dependencies for renderTabBar — injected for testability. */
export interface RenderTabBarDeps {
  tabBarEl: HTMLElement;
  terminals: Map<string, TabInfo>;
  activeTabId: string | null;
  onTabClick: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  /** Create in the scoped worktree when one is selected; otherwise use defaults. */
  onAddClick: (worktreeId?: string) => void;
  /**
   * Double-click on a tab triggers inline rename. Receives the tab id and the
   * tab element so the caller can spawn an overlay anchored to it.
   * Optional so tests not exercising rename can omit it.
   */
  onTabRename?: (tabId: string, tabEl: HTMLElement) => void;
  /**
   * A tab was dragged onto another tab of its pin group. Tabs are draggable only
   * while this is set; the caller owns the order and re-renders.
   */
  onTabReorder?: (tabId: string, targetTabId: string, placement: "before" | "after") => void;
  /**
   * Hook called at the tail of renderTabBar — used by callers to reposition
   * an active inline-rename overlay over the (possibly re-rendered) tab DOM.
   */
  onAfterRender?: () => void;
  /**
   * Present exactly while this surface is scoped, which is why it is ONE field
   * rather than a boolean beside a label: the chip is the only thing on screen
   * saying the list is a subset, and a filter without it is the invisible filter
   * the whole change exists to avoid. It is also the SECOND, independent reason
   * for the bar to be visible — not a reinterpretation of the tab count — so a
   * scope filtering down to one tab cannot hide its own escape hatch (D3, D4).
   */
  scope?: {
    worktreeId: string;
    label: string;
    /**
     * Hidden tabs holding a waiting pane. `0` or absent renders NO mark — a badge
     * that is always there is a badge nobody reads (worktree-scope.md § 4.2).
     */
    hiddenWaiting?: number;
  };
}

/**
 * Render the tab bar UI inside the given element.
 *
 * - Reconciles tab elements by ID so in-flight pointer events survive updates
 * - Updates tab name, status, active state, and close button in place
 * - Appends "+" add button
 * - Always shows the tab bar, whatever the tab count or scope
 */
export function renderTabBar(deps: RenderTabBarDeps): void {
  const {
    tabBarEl,
    terminals,
    activeTabId,
    onTabClick,
    onTabClose,
    onAddClick,
    onTabRename,
    onTabReorder,
    onAfterRender,
    scope,
  } = deps;

  if (scope) {
    tabBarEl.dataset.worktreeScope = "active";
  } else {
    delete tabBarEl.dataset.worktreeScope;
  }

  const existingTabs = new Map<string, HTMLDivElement>();
  for (const child of Array.from(tabBarEl.children)) {
    if (child instanceof HTMLDivElement && child.classList.contains("tab-item") && child.dataset.tabId) {
      existingTabs.set(child.dataset.tabId, child);
    }
  }

  // The scope control shares the reconciled child list with tabs and "+", but
  // stays at the right edge so terminal identity still reads left-to-right.
  let chip = tabBarEl.querySelector<HTMLDivElement>(":scope > .tab-scope") ?? undefined;
  if (scope) {
    if (!chip) {
      chip = document.createElement("div");
      chip.className = "tab-scope";
      // A generic div carries no role, and an `aria-label` on one is not a
      // dependable accessible name — a screen reader would reach the branch and
      // the clear button without ever being told the list is filtered.
      chip.setAttribute("role", "group");
      const content = document.createElement("span");
      content.className = "tab-scope-chip";
      const icon = document.createElement("span");
      icon.className = "tab-scope-icon";
      icon.innerHTML = ICON_BRANCH;
      icon.setAttribute("aria-hidden", "true");
      const kind = document.createElement("span");
      kind.className = "tab-scope-kind";
      kind.textContent = "Worktree";
      const name = document.createElement("span");
      name.className = "tab-scope-name";
      content.append(icon, kind, name);
      chip.appendChild(content);
    }
    const name = chip.querySelector<HTMLElement>(".tab-scope-name");
    if (name && name.textContent !== scope.label) {
      name.textContent = scope.label;
    }
    // Said, not implied by a visual mark: the bar looks complete either way, so
    // the only thing distinguishing a subset from the whole list is this sentence.
    chip.dataset.scopeLabel = `Worktree: ${scope.label}`;
    chip.setAttribute("aria-label", `Showing only tabs in ${scope.label}`);
    if (!scopeTooltipDisposers.has(chip)) {
      scopeTooltipDisposers.set(chip, attachTooltip(chip, { getText: () => chip?.dataset.scopeLabel ?? "" }));
    }
    const hidden = scope.hiddenWaiting ?? 0;
    const content = chip.querySelector<HTMLElement>(".tab-scope-chip");
    let badge = content?.querySelector<HTMLSpanElement>(".tab-scope-badge") ?? undefined;
    if (hidden > 0 && content) {
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "tab-scope-badge";
        content.appendChild(badge);
      }
      badge.textContent = String(hidden);
      chip.setAttribute(
        "aria-label",
        `Showing terminals in ${scope.label}; ${hidden} hidden ${hidden === 1 ? "tab needs" : "tabs need"} you`,
      );
    } else {
      badge?.remove();
    }
  } else if (chip) {
    scopeTooltipDisposers.get(chip)?.();
    scopeTooltipDisposers.delete(chip);
    chip.remove();
    chip = undefined;
  }

  const orderedTabs: HTMLDivElement[] = [];
  for (const [id, instance] of terminals) {
    let tab = existingTabs.get(id);
    if (!tab) {
      tab = document.createElement("div");
      const statusSpan = document.createElement("span");
      statusSpan.className = "tab-status";
      statusSpan.setAttribute("aria-hidden", "true");
      tab.appendChild(statusSpan);

      const nameSpan = document.createElement("span");
      nameSpan.className = "tab-name";
      tab.appendChild(nameSpan);

      const closeBtn = document.createElement("button");
      closeBtn.className = "tab-close";
      closeBtn.textContent = "\u00d7";
      closeBtn.type = "button";
      closeBtn.setAttribute("aria-label", "Close terminal tab");
      closeBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        const handlers = tabHandlers.get(tab!);
        if (handlers) {
          handlers.onTabClose(handlers.id);
        }
      });
      closeBtn.addEventListener("dblclick", (event) => event.stopPropagation());
      tab.appendChild(closeBtn);

      // Shown in the close button's place while pinned. A mark, not a control:
      // pinning and unpinning go through the tab's context menu.
      const pinMark = document.createElement("span");
      pinMark.className = "tab-pin";
      pinMark.innerHTML = PIN_ICON;
      pinMark.title = "Pinned — right-click to unpin";
      pinMark.hidden = true;
      tab.appendChild(pinMark);

      tab.addEventListener("click", (event) => {
        // The second click of a native double-click is followed by `dblclick`.
        // Skip only that click; unlike the old timestamp heuristic, this cannot
        // consume a later click after a keyboard/programmatic tab switch.
        if (event.detail > 1) {
          return;
        }
        const handlers = tabHandlers.get(tab!);
        if (handlers) {
          handlers.onTabClick(handlers.id);
        }
      });
      tab.addEventListener("dblclick", (event) => {
        event.preventDefault();
        const handlers = tabHandlers.get(tab!);
        handlers?.onTabRename?.(handlers.id, tab!);
      });
      attachTabDragHandlers(tab);
    }
    existingTabs.delete(id);
    orderedTabs.push(tab);
    const pinned = instance.pinned === true;
    tabHandlers.set(tab, { id, pinned, onTabClick, onTabClose, onTabRename, onTabReorder });
    tab.draggable = onTabReorder !== undefined;

    // Rebuilt from scratch each render, so the drag marks are carried over: a
    // re-render mid-drag (PTY activity, a title change) must not drop them.
    const dragMarks = ["tab-dragging", "tab-drop-before", "tab-drop-after"].filter((c) => tab!.classList.contains(c));
    tab.className = `tab-item${id === activeTabId ? " active" : ""}${instance.exited ? " tab-exited" : ""}${pinned ? " tab-pinned" : ""}`;
    tab.classList.add(...dragMarks);
    tab.querySelector<HTMLElement>(".tab-close")!.hidden = pinned;
    tab.querySelector<HTMLElement>(".tab-pin")!.hidden = !pinned;
    tab.dataset.tabId = id;

    // Custom name takes priority over the auto-derived (OSC-mutated) `name`.
    // See add-tab-rename design.md D1.
    const displayName = instance.customName ?? instance.name;

    // VS Code native context menu support — `webviewSection == 'terminalTab'`
    // gates the `Rename Tab…` entry. The tabId is read by the command handler.
    // `tabPinned` picks Pin Tab or Unpin Tab in the context menu. `tabLabel` is
    // what the tab shows, frame glyphs stripped: only the webview knows the OSC
    // title (and, for a split, which pane's), so the rename InputBox is seeded
    // from here rather than from the host's creation-time "Terminal N".
    tab.dataset.vscodeContext = JSON.stringify({
      webviewSection: "terminalTab",
      tabId: id,
      tabPinned: pinned,
      tabLabel: stripDecorations(displayName),
    });
    const nameSpan = tab.querySelector<HTMLElement>(".tab-name")!;
    const renderedName = instance.exited ? `${displayName} (exited)` : displayName;
    if (nameSpan.textContent !== renderedName) {
      nameSpan.textContent = renderedName;
    }

    const status = instance.exited ? "exited" : (instance.activityStatus ?? "idle");
    const statusSpan = tab.querySelector<HTMLElement>(".tab-status")!;
    statusSpan.className = `tab-status tab-status-${status}`;
    statusSpan.title =
      status === "waiting"
        ? "Cursor approval required"
        : status === "running"
          ? "Terminal is producing output"
          : status === "exited"
            ? "Terminal exited"
            : "Terminal idle";
    tab.setAttribute("aria-label", status === "waiting" ? `${renderedName}: Cursor approval required` : renderedName);
    tab.dataset.status = status;
  }

  for (const staleTab of existingTabs.values()) {
    staleTab.remove();
  }

  let addBtn = Array.from(tabBarEl.children).find((child) => child.classList.contains("tab-add")) as
    | HTMLButtonElement
    | undefined;
  if (!addBtn) {
    addBtn = document.createElement("button");
    addBtn.className = "tab-add";
    addBtn.textContent = "+";
    addBtn.type = "button";
    addBtn.setAttribute("aria-label", "Create terminal tab");
  }
  addBtn.onclick = () => onAddClick(scope?.worktreeId);

  // Preserve nodes that are already in the right position. Avoiding even a
  // same-parent remove/reinsert is what keeps pointerdown/up targeting stable.
  let cursor = tabBarEl.firstElementChild;
  for (const tab of orderedTabs) {
    if (tab !== cursor) {
      tabBarEl.insertBefore(tab, cursor);
    }
    cursor = tab.nextElementSibling;
  }
  if (addBtn !== cursor) {
    tabBarEl.insertBefore(addBtn, cursor);
  }
  cursor = addBtn.nextElementSibling;
  // Kept across renders (created and dropped by syncTabOverflow), so PTY-driven
  // re-renders do not flicker it.
  const overflow = tabBarEl.querySelector<HTMLElement>(":scope > .tab-overflow");
  if (overflow) {
    if (overflow !== cursor) {
      tabBarEl.insertBefore(overflow, cursor);
    }
    cursor = overflow.nextElementSibling;
  }
  if (chip) {
    if (chip !== cursor) {
      tabBarEl.insertBefore(chip, cursor);
    }
    cursor = chip.nextElementSibling;
  }
  while (cursor) {
    const next = cursor.nextElementSibling;
    cursor.remove();
    cursor = next;
  }

  // Always visible (Portaterm): a lone terminal still shows its "Terminal 1" tab, the
  // "+" button and the rename/close affordances, exactly as a scoped surface does.
  // Upstream hid the bar below two tabs on unscoped surfaces.
  tabBarEl.classList.add("visible");
  syncScopeDensity(tabBarEl);
  observeScopeDensity(tabBarEl);
  syncTabOverflow(tabBarEl);
  observeTabOverflow(tabBarEl);
  // Only on a CHANGE of active tab: renders also come from PTY activity, and
  // re-revealing on each would yank back a bar the user scrolled by hand.
  if (revealedActiveTab.get(tabBarEl) !== activeTabId) {
    revealedActiveTab.set(tabBarEl, activeTabId);
    revealActiveTab(tabBarEl);
  }

  // After-render hook (e.g. reposition the inline-rename overlay so it stays
  // anchored to the target tab across re-renders). See add-tab-rename D4.
  if (onAfterRender) {
    onAfterRender();
  }
}

/** Dependencies for tab keyboard shortcut handler. */
export interface TabKeyboardDeps {
  terminals: Map<string, TabInfo>;
  activeTabId: string | null;
  switchTab: (tabId: string) => void;
}

/**
 * Handle Ctrl+Tab / Ctrl+Shift+Tab keyboard events for tab cycling.
 * Returns true if the event was handled (caller should preventDefault).
 *
 * See: docs/design/flow-multi-tab.md#Keyboard-Shortcut
 */
export function handleTabKeyboardShortcut(
  e: { ctrlKey: boolean; shiftKey: boolean; key: string },
  deps: TabKeyboardDeps,
): boolean {
  if (!e.ctrlKey || e.key !== "Tab") {
    return false;
  }

  const tabIds = Array.from(deps.terminals.keys());
  if (tabIds.length <= 1) {
    return true; // Handled but no-op (single tab)
  }

  const currentIndex = deps.activeTabId ? tabIds.indexOf(deps.activeTabId) : -1;
  if (currentIndex === -1) {
    return true;
  }

  let nextIndex: number;
  if (e.shiftKey) {
    // Ctrl+Shift+Tab: cycle backward with wrap-around
    nextIndex = (currentIndex - 1 + tabIds.length) % tabIds.length;
  } else {
    // Ctrl+Tab: cycle forward with wrap-around
    nextIndex = (currentIndex + 1) % tabIds.length;
  }

  deps.switchTab(tabIds[nextIndex]);
  return true;
}

/**
 * Cmd+W on macOS, Ctrl+Shift+W elsewhere: close the active tab (or the focused
 * split pane). Caught inside the webview because a manifest keybinding never
 * wins here — focus in a webview view does not reach `focusedView`, so VS Code
 * resolved the key to its own Close Editor and closed an unrelated file.
 * Plain Ctrl+W is left alone off macOS: in a shell it deletes the previous word.
 */
export function isCloseTabShortcut(
  e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; key: string },
  isMac: boolean,
): boolean {
  if (e.key.toLowerCase() !== "w" || e.altKey) {
    return false;
  }
  return isMac ? e.metaKey && !e.ctrlKey && !e.shiftKey : e.ctrlKey && e.shiftKey && !e.metaKey;
}
