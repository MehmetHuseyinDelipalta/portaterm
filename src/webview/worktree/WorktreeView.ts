// src/webview/worktree/WorktreeView.ts — The Worktree body: repo → worktree →
// agent → subagent, plus its states, notices, dialogs, and keyboard model.
// See: docs/design/worktree-panel-ui.md.
//
// This is the fourth segment's BODY, not a fourth grouping mode: a worktree with
// zero agents exists and is worth acting on, so it cannot be produced by bucketing
// already-loaded sessions (§ 2). The view therefore owns its own element and is
// swapped in beside the vault list rather than replacing it.
//
// Composition mirrors VaultPanel: pure builders live in worktreeTreeView.ts, the
// derivations in worktreeFormat.ts, and this class holds only the state the DOM
// cannot — collapse sets, the focused row, the query, and the render guard.

import { attachTooltipDelegate } from "../ui/Tooltip";
import { WorktreeContextMenu } from "./WorktreeContextMenu";
import type { PruneDialogDeps } from "./WorktreePruneDialog";
import type { WorktreeRemoveDialogDeps } from "./WorktreeRemoveDialog";
import { activationFor as sharedActivationFor } from "./worktreeActivation";
import {
  agentCountLabel,
  ageTimestamp,
  compactAge,
  displayedRows,
  groupPresenceByActivity,
  presentedActivity,
  strongestActivity,
} from "./worktreeFormat";
import { agentRowFields, worktreeFields } from "./worktreeRenderSignature";
import { RosterRequests, rosterKey } from "./worktreeRosterRequests";
import {
  confidenceHint,
  renderAgentRow,
  renderAgentsHeader,
  renderNotice,
  renderPresencePill,
  renderRefreshingMarker,
  renderRepoHeader,
  renderShowAll,
  renderSkeleton,
  renderSubagentSection,
  renderWorktreeRow,
  worktreeEmptyState,
} from "./worktreeTreeView";
import { type ActionNotices, createActionNotices } from "./worktreeView/actionNotices";
import { type CeilingClock, createCeilingClock } from "./worktreeView/ceilingClock";
import { createFoldState, type FoldRepoInput, type FoldState } from "./worktreeView/foldState";
import { createKeyboardNav, type KeyboardNav } from "./worktreeView/keyboardNav";
import { createTreeRender, IDLE_FOLD_THRESHOLD, type TreeRender } from "./worktreeView/treeRender";
import { createViewDialogs, type ViewDialogs } from "./worktreeView/viewDialogs";
import { createViewFilter, type ViewFilter } from "./worktreeView/viewFilter";
import type {
  PresenceDegradation,
  WorktreeAgentRow,
  WorktreeInfo,
  WorktreeLaunchAgent,
  WorktreeRemoveReport,
  WorktreeRepo,
  WorktreeRowActivation,
} from "./worktreeViewTypes";

/** Worktrees rendered per repo before the cap offers "Show all" (§ 8). The cap
 *  exists so a repo with hundreds of worktrees does not stall the render; it is a
 *  visible affordance, never a silent truncation. */
export const MAX_WORKTREES_PER_REPO = 20;

// The fold threshold lives in `worktreeView/treeRender.ts` (task 3_11), which is
// what reads it. Re-exported here so no importer moves.
export { IDLE_FOLD_THRESHOLD } from "./worktreeView/treeRender";

// The view's contract lives in `worktreeView/viewTypes.ts` (task 3_7 of
// `decompose-worktree-view`). Re-exported here so no importer moves, and
// imported too, because a re-export is not a local binding.
export type { WorktreeViewData, WorktreeViewDeps } from "./worktreeView/viewTypes";

import type { WorktreeViewData, WorktreeViewDeps } from "./worktreeView/viewTypes";

export class WorktreeView {
  /** The scrollable tree. Appended into the panel body by the owner. */
  readonly element: HTMLElement;

  private readonly deps: WorktreeViewDeps;
  private readonly menu: WorktreeContextMenu | null;
  /** Which repos, worktrees and idle tails are folded (task 1_1). */
  private readonly fold: FoldState;
  /** When a drawn row next outlives its evidence, and the timer for it (3_8). */
  private readonly ceilingClock: CeilingClock;
  /** Every modal the view opens, and the one handle that keeps them single (3_9). */
  private readonly dialogs: ViewDialogs;
  /** The query, the idle partition and the render cap (3_10). */
  private readonly filter: ViewFilter;
  /** One render pass, and the signature that decides whether to run it (3_11). */
  private readonly tree: TreeRender;

  private data: WorktreeViewData = { tree: null, presence: null, loading: true };
  /**
   * Countdowns for notices that get out of the way on their own, keyed by the
   * SAME per-result key the render signature uses — so a redraw of an unchanged
   * result finds its own timer instead of arming a second one, and a result
   * that changed is a new notice with a fresh countdown. `"held"` is a notice
   * the user hovered or focused: it never expires again.
   */
  /** Placing, naming and dismissing action notices (task 1_3). */
  private readonly notices: ActionNotices;
  private disposed = false;
  /** Repo/worktree ids whose children are hidden. */
  /** Agent rowIds whose subagents are shown. */
  /** Worktree ids whose default collapse has already been decided once. */
  /** A persisted set was restored, so the first tree carries no defaults to seed. */
  private readonly disposeTooltips: () => void;
  /** Roving tabindex target — the row keyboard navigation last landed on. */
  /** Roving tabindex and tree traversal (task 1_2). */
  private readonly nav: KeyboardNav;
  /**
   * The worktree the user selected, or `null` for none. Never seeded: selection
   * is an act, so a first render, a reload and a push all leave it alone.
   */
  private selectedWorktreeId: string | null = null;
  /** repoId → the last node of that repository's section, so a result with no
   *  drawn row still lands with its repository. */
  private readonly repoAnchors = new Map<string, HTMLElement>();
  /**
   * Row+session pairs already asked for. Keyed by both, so re-expanding asks
   * nothing while a pane that started a NEW session asks again.
   */
  private readonly rosters = new RosterRequests();

  /**
   * PERF PROTOTYPE — per-worktree DOM memo. A render whose signature moved
   * repaints only the rows whose OWN key moved; the rest are re-attached.
   * The key covers every field the row's renderers and their listeners read,
   * including the clock-derived strings (`compactAge`, confidence hints), so a
   * retained subtree is byte-identical to the one a full repaint would build.
   */
  private rowMemo = new Map<string, { key: string; nodes: Node[] }>();
  private rowMemoSeen = new Set<string>();

  constructor(deps: WorktreeViewDeps) {
    this.deps = deps;
    // A restored set already carries the user's own decisions — including the
    // expansions it records by omission — so nothing in the first tree is reseeded.
    // Presence of the array is the signal; its length says nothing.
    this.notices = createActionNotices({
      data: () => this.data,
      element: () => this.element,
      disposed: () => this.disposed,
      view: deps,
      repoOf: (info) => this.repoOf(info),
      repoAnchors: this.repoAnchors,
      renderedWorktreeRows: () => this.tree.renderedWorktreeRows(),
      openRemoveReport: (info, report) => this.openRemoveReport(info, report),
    });
    this.ceilingClock = createCeilingClock({
      ...(deps.now === undefined ? {} : { clock: deps.now }),
      disposed: () => this.disposed,
      degradedSources: () => this.degradedSources(),
      renderedWorktreeIds: () => this.tree.renderedWorktreeIds(),
      presentWorktreeIds: () => Object.keys(this.data.presence?.rowsByWorktreeId ?? {}),
      rowsFor: (worktreeId) => this.rowsFor(worktreeId),
      applyAt: (now) => {
        this.tree.applyAt(now);
      },
    });
    this.dialogs = createViewDialogs({
      view: deps,
      now: () => this.ceilingClock.now(),
      rowsFor: (worktreeId) => this.rowsFor(worktreeId),
      degradedSources: () => this.degradedSources(),
    });
    this.filter = createViewFilter({
      fold: () => this.fold,
      data: () => this.data,
      displayRows: (data, worktreeId) => WorktreeView.displayRows(data, worktreeId),
      rowsFor: (worktreeId) => this.rowsFor(worktreeId),
      cap: MAX_WORKTREES_PER_REPO,
      repaint: () => {
        this.tree.repaint();
      },
    });
    this.tree = createTreeRender({
      view: deps,
      element: () => this.element,
      data: () => this.data,
      disposed: () => this.disposed,
      now: () => this.ceilingClock.now(),
      armCeiling: (now) => {
        this.ceilingClock.armCeiling(now);
      },
      nav: () => this.nav,
      fold: () => this.fold,
      filter: () => this.filter,
      pruneStaleState: (data) => {
        this.pruneStaleState(data);
      },
      placeResults: () => {
        this.notices.placeResults();
      },
      flushRosterRequests: () => {
        this.flushRosterRequests();
      },
      toggleCollapsed: (id) => {
        this.toggleCollapsed(id);
      },
      renderWorktree: (info, now, inTail) => {
        this.renderWorktree(info, now, inTail);
      },
      rowMemo: this.rowMemo,
      rowMemoSeen: this.rowMemoSeen,
      repoAnchors: this.repoAnchors,
    });
    this.nav = createKeyboardNav({
      element: () => this.element,
      toggleCollapsed: (id) => this.toggleCollapsed(id),
      toggleIdleTail: (repoId) => this.filter.toggleIdleTail(repoId),
      toggleRow: (rowId) => this.toggleRow(rowId),
    });
    this.fold = createFoldState({
      persisted: deps.getInitialCollapsed?.(),
      initialExpandedRows: deps.getInitialExpandedRows?.() ?? [],
      initialIdleSeeded: deps.getInitialIdleSeeded?.() ?? [],
      idleFoldThreshold: IDLE_FOLD_THRESHOLD,
      persistCollapsed: (keys) => deps.persistCollapsed?.([...keys]),
      persistExpandedRows: (ids) => deps.persistExpandedRows?.([...ids]),
      persistIdleSeeded: (ids) => deps.persistIdleSeeded?.([...ids]),
      query: () => this.filter.query(),
      repaint: () => this.tree.repaint(),
    });
    this.element = document.createElement("div");
    this.element.className = "wt-tree";
    this.element.setAttribute("role", "tree");
    this.element.setAttribute("aria-label", "Worktrees");
    // A programmatic stop, never a Tab stop: the roving row owns Tab. It exists
    // so a close with nothing drawn — every row filtered out by a query — has
    // somewhere inside the tree to land instead of `<body>`, which is the top of
    // the whole document (.reviews/round-1.md B2).
    this.element.tabIndex = -1;
    this.element.addEventListener("keydown", (ev) => this.nav.onKeyDown(ev));
    // Focus retention was written only where the KEYBOARD moves focus, so a pointer
    // press — which focuses the row it lands on without `onKeyDown` running — left the
    // roving key naming some other row, and the re-render a click causes restored focus
    // there. Written here instead, where focus actually arrives, so every row kind is
    // covered at once rather than each toggle path remembering to update the key.
    this.element.addEventListener("focusin", (ev) => this.nav.onFocusIn(ev));
    // Delegated, because render() replaces every row: rows carry `data-tip` and
    // nothing is attached or disposed per render.
    this.disposeTooltips = attachTooltipDelegate(this.element);
    this.menu = deps.actions
      ? new WorktreeContextMenu({
          host: deps.host,
          actions: deps.actions,
          // Supplied, not defaulted: the menu gates its Prune item on this, and
          // the default of `() => 0` meant the item could never render at all.
          // Only a walk from the rendered menu could see it (round-4 W11).
          prunableCount: (info) => this.repoOf(info)?.worktrees.filter((w) => w.prunable).length ?? 0,
        })
      : null;
  }

  /** The repo holding `info`, from the tree this view last rendered. */
  private repoOf(info: WorktreeInfo): WorktreeRepo | undefined {
    return this.data.tree?.repos.find((r) => r.worktrees.some((w) => w.id === info.id));
  }

  /**
   * Push new data. Re-renders only when the signature moved (§ 6.1) — a spinner
   * frame alone must not repaint the tree and destroy scroll and expansion state.
   * `refreshing` and `loading` are render inputs, so they join the key.
   */
  setData(data: WorktreeViewData): void {
    // A discarded view accepts no further work. Before the ceiling timer this was
    // harmless — a push wrote into a detached element and stopped there — but a
    // push now PLANTS a timer, which would keep repainting a view nobody holds.
    if (this.disposed) {
      return;
    }
    this.data = data;
    this.tree.applyAt(this.ceilingClock.now());
  }

  /**
   * The window's asked-once roster set.
   *
   * Exposed rather than kept private: "at most one request per row and session"
   * is a claim about the WINDOW, so any future surface that draws agent rows
   * shares this one rather than constructing a second (design.md D6).
   */
  rosterRequests(): RosterRequests {
    return this.rosters;
  }

  /**
   * Put focus on a worktree's row, or on the tree itself when that row is not
   * drawn — a filtered-out row must not leave focus on `<body>`.
   */
  focusWorktree(worktreeId: string): void {
    const rows = this.nav.navRows();
    // The tree's own tab stop is the fallback, not the container: the container
    // is not focusable, so focusing it would leave focus on `<body>` and the
    // keyboard user back at the top of the document.
    const target =
      rows.find((r) => r.dataset.worktreeId === worktreeId) ??
      rows.find((r) => this.nav.keyOf(r) === this.nav.focusedKey()) ??
      rows[0];
    if (target === undefined) {
      this.element.focus();
      return;
    }
    this.nav.focusRow(target);
  }

  /** The worktree this panel marks as selected, or `null`. The only copy there is. */
  selectedWorktree(): string | null {
    return this.selectedWorktreeId;
  }

  /**
   * Drop the selection from outside — the tab bar's chip clearing its own scope.
   * Announced exactly as a click would announce it, and repaints, because the row
   * that was marked has to stop being marked (round-1 B2).
   */
  clearSelection(): void {
    if (this.selectedWorktreeId === null) {
      return;
    }
    // Announced BEFORE the field moves, for the reason `select` gives.
    this.deps.onSelectWorktree?.(null);
    this.selectedWorktreeId = null;
    this.tree.repaint();
  }

  /**
   * Open the row's action menu from its own `…` control.
   *
   * A keyboard press reports (0, 0), which the cursor-anchored shell would take
   * literally and pin the menu to the panel's top-left corner. The control's own
   * rect is where the gesture actually happened, so that is what is passed on.
   */
  private openRowMenu(info: WorktreeInfo, ev: MouseEvent, row: HTMLElement): void {
    // The row anchors the menu and takes the open class; the control is where
    // focus goes back to. They are different elements here, and returning to the
    // row would cost a keyboard user a tab stop on every dismissal.
    const control = ev.currentTarget instanceof HTMLElement ? ev.currentTarget : undefined;
    if (ev.detail !== 0) {
      this.menu?.openForWorktree(info, ev, row, control);
      return;
    }
    const rect = control?.getBoundingClientRect();
    this.menu?.openForWorktree(
      info,
      new MouseEvent("contextmenu", { clientX: rect?.left ?? 0, clientY: rect?.bottom ?? 0 }),
      row,
      control,
    );
  }

  /**
   * Select a worktree. Returns whether the selection moved, so the caller
   * repaints once or not at all — the mark is a render input, and repainting on
   * a re-select would rebuild the tree and throw focus away for nothing.
   */
  private select(worktreeId: string): boolean {
    if (this.selectedWorktreeId === worktreeId) {
      return false;
    }
    // Announced BEFORE the field moves, and the throw is not caught. The listener
    // persists the scope, and a write that throws must not leave this panel marking
    // a row the scope never took — the equality guard above would then make the
    // very row that fixes it a no-op, so the mark would stand until a third row or
    // the chip cleared it (round-2 V1).
    this.deps.onSelectWorktree?.(worktreeId);
    this.selectedWorktreeId = worktreeId;
    return true;
  }

  /** Filter the tree by branch, path, and agent title. Ancestors of a match stay. */
  setQuery(query: string): void {
    this.filter.setQuery(query);
  }

  openCreateDialog(initialRepoId?: string): void {
    this.dialogs.openCreateDialog(initialRepoId);
  }

  openLaunchDialog(worktreeLabel: string, agents: readonly WorktreeLaunchAgent[]): void {
    this.dialogs.openLaunchDialog(worktreeLabel, agents);
  }

  openPruneDialog(args: Omit<PruneDialogDeps, "onConfirm" | "onCancel">, onConfirm: (count: number) => void): void {
    this.dialogs.openPruneDialog(args, onConfirm);
  }

  openRemoveDialog(args: Omit<WorktreeRemoveDialogDeps, "onConfirm" | "onCancel" | "now">): void {
    this.dialogs.openRemoveDialog(args);
  }

  openRemoveReport(info: WorktreeInfo, report: WorktreeRemoveReport): void {
    this.dialogs.openRemoveReport(info, report);
  }

  dispose(): void {
    this.disposed = true;
    this.rowMemo.clear();
    this.rowMemoSeen.clear();
    this.ceilingClock.dispose();
    this.notices.dispose();
    this.dialogs.dispose();
    this.menu?.close();
    this.disposeTooltips();
  }

  // -- State ---------------------------------------------------------------

  /**
   * The rows this view draws — the agents, and only the agents.
   *
   * Presence still projects a row for every pane, because activity, exit and
   * attribution are facts about panes and the rest of the model needs them.
   * This list is not that model: a pane holding no proven agent is a terminal
   * the user already has on screen, and repeating it here as a row said
   * nothing.
   *
   * Parameterized on the envelope because `isIdleIn` runs against the INCOMING
   * one. Every consumer that answers a question about what is on screen — the
   * rows, the count, the pill, navigation, idleness, the ceiling timer — reads
   * through here, so none of them can disagree with the rest about what a
   * worktree holds. The one deliberate exception is `pruneStaleState`, which
   * reconciles retained state against the presence MODEL: pruning by what is
   * drawn would discard the expansion and roster state of a pane the moment it
   * stopped proving an agent, and again on every rebuild until it did.
   */
  private static displayRows(data: WorktreeViewData, worktreeId: string): WorktreeAgentRow[] {
    return displayedRows(data.presence?.rowsByWorktreeId[worktreeId] ?? []);
  }

  private rowsFor(worktreeId: string): WorktreeAgentRow[] {
    return WorktreeView.displayRows(this.data, worktreeId);
  }

  /**
   * The presence sources currently failing, which is what turns a row's state
   * into `unknown` (§ 7.2). A repo's own `degraded` flag is deliberately not
   * here: it says the worktree listing failed, not that any agent is unreadable.
   */
  private degradedSources(): readonly PresenceDegradation[] {
    return this.data.presence?.degradedSources ?? [];
  }

  /**
   * The two disclosure levels are independent (§ 3.5): collapsing a worktree does
   * not clear any agent row's own expansion, and each persists separately.
   */
  private toggleCollapsed(id: string): void {
    this.fold.toggleCollapsed(id);
  }

  /** The one place a collapse key flips, so persistence and repaint cannot diverge
   *  between the row kinds that share the set. */
  private toggleKey(key: string): void {
    this.fold.toggleKey(key);
  }

  /** What this row's activation does — see `worktreeActivation`. */
  private activationFor(row: WorktreeAgentRow): WorktreeRowActivation {
    return sharedActivationFor(row, this.deps.rowActivation?.() ?? "focus");
  }

  /**
   * Queue a roster request. Dispatched by `flushRosterRequests` once the DOM is
   * built — never from here, because this is called from inside the render loop
   * and a dep that answered synchronously would re-enter it (see `renderListing`).
   */
  private requestSubagents(row: WorktreeAgentRow): void {
    this.rosters.want(row);
  }

  /** Send what the render queued, after `replaceChildren` has settled. */
  private flushRosterRequests(): void {
    this.rosters.flush((row) => this.deps.onRequestSubagents?.(row));
  }

  private toggleRow(rowId: string): void {
    this.fold.toggleRow(rowId);
  }

  /** The set is a real collapsed set, so this is the whole rule. */
  private isExpanded(info: WorktreeInfo): boolean {
    return this.fold.isExpanded(info.id);
  }

  /**
   * Reconcile persisted state with the tree that just arrived:
   *
   *  - ids that no longer exist are dropped, so a removed worktree's expansion is
   *    not resurrected if its path is ever reused;
   *  - a worktree seen for the FIRST time is collapsed unless it is a workspace
   *    folder. Scanning many worktrees is the default posture; the one you are
   *    working inside is the exception. Seeding once (rather than deriving the
   *    default on every render) is what keeps `collapsed` a set the user's own
   *    toggles can move in both directions.
   */
  private pruneStaleState(data: WorktreeViewData): void {
    if (!data.tree) {
      return;
    }
    const liveIds = new Set<string>();
    const liveRowIds = new Set<string>();
    const liveRosterKeys = new Set<string>();
    const sessionRowIds = new Set<string>();
    const repos: FoldRepoInput[] = [];
    for (const repo of data.tree.repos) {
      liveIds.add(repo.repoId);
      for (const wt of repo.worktrees) {
        liveIds.add(wt.id);
        for (const row of data.presence?.rowsByWorktreeId[wt.id] ?? []) {
          liveRowIds.add(row.rowId);
          const key = rosterKey(row);
          if (key !== undefined) {
            liveRosterKeys.add(key);
            sessionRowIds.add(row.rowId);
          }
        }
      }
      repos.push({
        repoId: repo.repoId,
        // Counted here rather than in the collaborator: idleness is a presence
        // question the view owns, and handing the fold state a `data` would give
        // it the display policy along with it.
        idleCount: repo.worktrees.filter((w) => this.filter.isIdleIn(data, w)).length,
        worktrees: repo.worktrees.map((wt) => ({ id: wt.id, inWorkspace: wt.inWorkspace })),
      });
    }
    // A selection whose worktree LEFT the tree is dropped, and the drop is
    // reported. A worktree reported `missing` is still in the tree and keeps it —
    // the registration exists and panes may still be attributed to it (D7).
    if (this.selectedWorktreeId !== null && !liveIds.has(this.selectedWorktreeId)) {
      this.selectedWorktreeId = null;
      this.deps.onSelectWorktree?.(null);
    }
    this.fold.prune({ repos, liveIds, liveRowIds, sessionRowIds });
    // Dropping the asked-key is what lets a row that left and returned under the
    // same identity ask again — the host evicted its roster, so a view that
    // remembers asking leaves the row on "Reading…" with nothing coming.
    this.rosters.reconcile(liveRosterKeys);
  }

  // -- Search --------------------------------------------------------------

  /**
   * PERF PROTOTYPE — the memo key for one worktree's subtree. Covers every field
   * the row + its agent rows + subagent sections read, INCLUDING the clock-derived
   * strings, so a key match means a repaint would produce identical DOM.
   */
  private worktreeMemoKey(
    info: WorktreeInfo,
    rows: readonly WorktreeAgentRow[],
    now: number,
    inTail: boolean,
    expanded: boolean,
    selected: boolean,
  ): string {
    const degraded = this.degradedSources();
    const parts: string[] = [
      worktreeFields(info),
      inTail ? "1" : "0",
      expanded ? "1" : "0",
      selected ? "1" : "0",
      this.filter.isIdle(info) ? "1" : "0",
      strongestActivity(rows, degraded, now) ?? "",
      this.ceilingClock.strongestConfidenceTip(rows, now) ?? "",
      this.deps.actions?.launchAgentHere ? "1" : "0",
      this.deps.actions?.openFolderInNewWindow ? "1" : "0",
      this.menu ? "1" : "0",
    ];
    for (const row of rows) {
      const activity = presentedActivity(row, degraded, now);
      parts.push(
        agentRowFields(row, degraded, now),
        this.fold.isRowExpanded(row.rowId) ? "1" : "0",
        // Clock-derived rendered strings — the only render inputs `agentRowFields`
        // does not already hold.
        compactAge(ageTimestamp(row), now),
        confidenceHint(row, activity, now) ?? "",
      );
    }
    return parts.join("\u0005");
  }

  private renderWorktree(info: WorktreeInfo, now: number, inTail = false): void {
    const rows = this.rowsFor(info.id);
    const expanded = rows.length > 0 && this.isExpanded(info);
    const selected = this.selectedWorktreeId === info.id;
    // Asked BEFORE the memo check: the roster request is owed by the render, not
    // by the repaint, and `RosterRequests` already dedupes it.
    if (expanded) {
      for (const row of rows) {
        if (this.fold.isRowExpanded(row.rowId)) {
          this.requestSubagents(row);
        }
      }
    }
    this.rowMemoSeen.add(info.id);
    const memoKey = this.worktreeMemoKey(info, rows, now, inTail, expanded, selected);
    const hit = this.rowMemo.get(info.id);
    if (hit !== undefined && hit.key === memoKey) {
      for (const node of hit.nodes) {
        this.element.appendChild(node);
      }
      return;
    }
    const produced: Node[] = [];
    this.buildWorktree(info, rows, now, inTail, expanded, selected, produced);
    this.rowMemo.set(info.id, { key: memoKey, nodes: produced });
    for (const node of produced) {
      this.element.appendChild(node);
    }
  }

  private buildWorktree(
    info: WorktreeInfo,
    rows: readonly WorktreeAgentRow[],
    now: number,
    inTail: boolean,
    expanded: boolean,
    selected: boolean,
    produced: Node[],
  ): void {
    // Grouping and selection are two jobs that shared one class. `.wt-card` used
    // to mean "expanded", and it is the loudest treatment in the tree — so once
    // selection exists it reads as a selection nobody made (design.md D5). The
    // card marks selection alone; `.wt-group` does the grouping.
    const grouped = expanded || selected;
    // PERF PROTOTYPE: nodes are collected, not attached — `renderWorktree` owns
    // the attach so a memo hit can re-attach the very same nodes.
    const groupEl = grouped ? document.createElement("div") : undefined;
    if (groupEl) {
      groupEl.className = selected ? "wt-group wt-card" : "wt-group";
      groupEl.setAttribute("role", "none");
      produced.push(groupEl);
    }
    const container = {
      appendChild(node: Node): void {
        if (groupEl) {
          groupEl.appendChild(node);
        } else {
          produced.push(node);
        }
      },
    };

    container.appendChild(
      renderWorktreeRow(
        info,
        {
          activity: strongestActivity(rows, this.degradedSources(), now),
          // While collapsed this row IS the row: the pill below it is `aria-hidden`
          // with `tabIndex = -1` and is not in the arrow-key set, so a keyboard
          // user meets only this. A qualified glyph here without its qualification
          // is the claim without the caveat.
          confidenceTip: this.ceilingClock.strongestConfidenceTip(rows, now),
          hasAgents: rows.length > 0,
          idle: this.filter.isIdle(info),
          inTail,
          expanded,
          selected,
          agentSummary: rows.length > 0 ? agentCountLabel(rows.length) : undefined,
        },
        {
          // Select and scope. NOTHING else: folding the agent block open from the
          // same gesture is what made one click read as three events at once, and
          // § 6 has always given disclosure to the chevron rather than the row.
          onActivate: () => {
            if (this.select(info.id)) {
              this.tree.repaint();
            }
          },
          onContextMenu: this.menu ? (i, ev, row) => this.menu?.openForWorktree(i, ev, row) : undefined,
          // The affirmative action, on the row that owns it — absent when the
          // capability was not supplied, and for a directory that is gone.
          onLaunchAgent: this.deps.actions?.launchAgentHere
            ? (i) => this.deps.actions?.launchAgentHere?.(i)
            : undefined,
          // Everything else, one press further in — the same menu the right-click
          // opens, so the two can never offer different things.
          onOverflowMenu: this.menu ? (i, ev, row) => this.openRowMenu(i, ev, row) : undefined,
          // Same rule as the menu's: an affordance whose capability was not
          // supplied is absent, not present and inert (design.md D10).
          onOpenFolder: this.deps.actions?.openFolderInNewWindow
            ? (i) => this.deps.actions?.openFolderInNewWindow?.(i)
            : undefined,
        },
      ),
    );

    if (rows.length === 0) {
      return;
    }
    if (!expanded) {
      container.appendChild(
        renderPresencePill(groupPresenceByActivity(rows, this.degradedSources(), now), () =>
          this.toggleCollapsed(info.id),
        ),
      );
      return;
    }

    container.appendChild(renderAgentsHeader(rows.length, () => this.toggleCollapsed(info.id)));
    for (const row of rows) {
      const rowExpanded = this.fold.isRowExpanded(row.rowId);
      if (rowExpanded) {
        // Asked from the render rather than the click, so a row restored into
        // the expanded set on open asks too — otherwise it would sit on
        // "Reading…" forever, having never been toggled.
        this.requestSubagents(row);
      }
      container.appendChild(
        renderAgentRow(
          row,
          {
            activity: presentedActivity(row, this.degradedSources(), now),
            expanded: rowExpanded,
            now,
          },
          {
            onActivate: (r) => this.deps.onActivateAgent?.(r, this.activationFor(r)),
            onContextMenu: this.menu ? (r, ev, el) => this.menu?.openForAgent(r, ev, el) : undefined,
            onToggleSubagents: (r) => this.toggleRow(r.rowId),
          },
        ),
      );
      // Always a section while the row is expanded: rendering nothing until
      // rows exist is the same picture as a session that delegated nothing
      // (design.md D10).
      if (rowExpanded) {
        container.appendChild(
          renderSubagentSection(
            row.delegations,
            row,
            (sub, parent) => this.deps.onActivateSubagent?.(sub, parent),
            now,
          ),
        );
      }
    }
  }
}
