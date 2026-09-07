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
  branchLabel,
  compactAge,
  displayedRows,
  groupPresenceByActivity,
  presentedActivity,
  strongestActivity,
} from "./worktreeFormat";
import { agentRowFields, worktreeFields, worktreeSignature } from "./worktreeRenderSignature";
import { RosterRequests, rosterKey } from "./worktreeRosterRequests";
import {
  confidenceHint,
  renderAgentRow,
  renderAgentsHeader,
  renderIdleDisclosure,
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
import { type ActionNotices, createActionNotices, resultKey } from "./worktreeView/actionNotices";
import { type CeilingClock, createCeilingClock } from "./worktreeView/ceilingClock";
import { createFoldState, type FoldRepoInput, type FoldState } from "./worktreeView/foldState";
import { createKeyboardNav, type KeyboardNav } from "./worktreeView/keyboardNav";
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
  WorktreeTree,
} from "./worktreeViewTypes";

/** Worktrees rendered per repo before the cap offers "Show all" (§ 8). The cap
 *  exists so a repo with hundreds of worktrees does not stall the render; it is a
 *  visible affordance, never a silent truncation. */
export const MAX_WORKTREES_PER_REPO = 20;

/** Below this many agentless worktrees, a disclosure hides less than it costs (§ 3.6). */
export const IDLE_FOLD_THRESHOLD = 4;

/** A repository that has been cloned but never branched out — one worktree, the main one. */
function isUnbranched(repo: WorktreeRepo): boolean {
  return repo.degraded === undefined && repo.worktrees.length === 1 && repo.worktrees[0]?.kind === "main";
}

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
  private signature: string | null = null;
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
      renderedWorktreeRows: () => this.renderedWorktreeRows(),
      openRemoveReport: (info, report) => this.openRemoveReport(info, report),
    });
    this.ceilingClock = createCeilingClock({
      ...(deps.now === undefined ? {} : { clock: deps.now }),
      disposed: () => this.disposed,
      degradedSources: () => this.degradedSources(),
      renderedWorktreeIds: () => this.renderedWorktreeIds(),
      presentWorktreeIds: () => Object.keys(this.data.presence?.rowsByWorktreeId ?? {}),
      rowsFor: (worktreeId) => this.rowsFor(worktreeId),
      applyAt: (now) => {
        this.applyAt(now);
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
        this.repaint();
      },
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
      repaint: () => this.repaint(),
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
    this.applyAt(this.ceilingClock.now());
  }

  /**
   * Render if anything moved, then schedule the next moment something can move
   * on its own.
   *
   * ONE reading of the clock serves all three of the signature, what it renders,
   * and the next deadline. Reading it again between them would let a row be drawn
   * against one moment and scheduled against another, which is how a crossing
   * gets skipped by a millisecond.
   */
  private applyAt(now: number): void {
    const { tree, presence, loading, refreshing, noFolder, actionResults } = this.data;
    const stateKey = [
      worktreeSignature(tree, presence, now),
      loading ? "1" : "0",
      refreshing ? "1" : "0",
      noFolder ? "1" : "0",
      (actionResults ?? []).map(resultKey).join("|"),
      // The capabilities the ROWS draw, not just the ones the menu resolves at
      // click time. `actions` is a record the host mutates in place, so a launch
      // target arriving moves no field above it — and the row's launch control
      // is built at paint. Without this the button appears only if some
      // unrelated tree or presence delta happens to force a repaint later
      // (.reviews/round-1.md B3, re-found on the row toolbar).
      this.deps.actions?.launchAgentHere ? "1" : "0",
    ].join(String.fromCharCode(4));
    if (stateKey !== this.signature) {
      this.signature = stateKey;
      // Expansion state for a worktree that disappeared is dropped, not resurrected.
      this.pruneStaleState(this.data);
      try {
        this.render(now);
      } catch (err) {
        // The key above already claims this envelope is drawn. A render that
        // threw part-way — in practice a roster dispatch the host refused —
        // leaves `RosterRequests` correctly holding the rows it could not send,
        // behind a guard that turns the next identical envelope into a no-op, so
        // nothing ever asks again (.reviews/round-3.md W4).
        this.signature = null;
        throw err;
      }
    }
    this.ceilingClock.armCeiling(now);
  }

  /**
   * A repaint forced by an interaction rather than by data — collapsing a repo,
   * lifting the display cap, expanding a row. `applyAt` cannot serve these: the
   * signature covers the DATA, and none of this moves it, so the render would be
   * skipped. Still one reading of the clock, and still re-armed, because what is
   * drawn is what can cross.
   */
  private repaint(): void {
    // `dispose()` tears down the tooltip delegates, so a rebuild after it produces
    // a tree whose hints are permanently dead — a half-live view is worse than a
    // stale one. Guarding only the arming left the DOM work happening anyway.
    if (this.disposed) {
      return;
    }
    const now = this.ceilingClock.now();
    this.render(now);
    this.ceilingClock.armCeiling(now);
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
    this.repaint();
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

  // -- Render --------------------------------------------------------------

  private render(now: number): void {
    const scrollTop = this.element.scrollTop;
    // `renderListing` keeps its early exits — a skeleton and an empty state have
    // no tree to lay out — but placement must not sit behind any of them, so it
    // runs here, once, on every path.
    // Read once, here, and handed down: every path below has to know whether the
    // user was inside this tree when it was torn down, including the empty states
    // that return no key at all (.reviews/round-2.md B6).
    const focusWasInside = this.element.contains(document.activeElement);
    const restoreFocusTo = this.renderListing(now, focusWasInside);
    this.notices.placeResults();
    this.restoreFocus(restoreFocusTo, focusWasInside, scrollTop);
    // Last, and after focus is back: this is the only step here that reaches the
    // host, so it is the only one that can throw — and a throw before the restore
    // above would leave the user on `<body>` (.reviews/round-3.md W4). Never from
    // inside the loop that queued them either: a dep answering synchronously
    // re-enters `renderListing`, which replaces the half-built tree and places
    // every notice twice. Runs on every path, including the empty states — a
    // queued request is owed either way.
    this.flushRosterRequests();
  }

  /** Put the user back where they were, or at least back inside the tree. */
  private restoreFocus(restoreFocusTo: string | null | undefined, focusWasInside: boolean, scrollTop: number): void {
    if (restoreFocusTo === undefined) {
      // A skeleton or an empty state. It replaced the children like any other
      // render, so a user who was inside is now on `<body>` — the top of the
      // whole document — unless the tree takes them back.
      if (focusWasInside) {
        this.element.focus();
      }
      return;
    }
    this.element.scrollTop = scrollTop;
    this.nav.syncRovingTabindex();
    if (restoreFocusTo !== null) {
      const rows = this.nav.navRows();
      // The row can have left in this very render — a worktree removed, a query
      // typed. `syncRovingTabindex` above has already moved the tab stop to a row
      // that exists, so that is where focus belongs; with no rows at all the tree
      // itself is the last thing standing between the user and `<body>`.
      const target =
        rows.find((r) => this.nav.keyOf(r) === restoreFocusTo) ??
        rows.find((r) => this.nav.keyOf(r) === this.nav.focusedKey());
      if (target === undefined) {
        this.element.focus();
        return;
      }
      target.focus();
    }
  }

  /**
   * Draws the tree. Returns the focus key to restore, or `undefined` when there was
   * no tree to lay out. Returned rather than parked on the instance so the key
   * belongs to the render that computed it.
   *
   * This does NOT make the render re-entrant, and no longer needs to: subagent
   * rosters are QUEUED from inside the repo loop and dispatched by `render` once
   * this has returned, so a dep that answers synchronously can no longer replace
   * the half-built DOM or make `placeResults` run twice over `repoAnchors`. The
   * shipped host answers over `postMessage`, so nothing reaches it synchronously
   * today — the ordering is a rule so that a caller which did could not break it.
   */
  private renderListing(now: number, focusWasInside: boolean): string | null | undefined {
    try {
      return this.renderListingInner(now, focusWasInside);
    } finally {
      // On EVERY exit, not only the one that walked the repos: the loading and
      // empty states return early with nothing on screen, and a memo that kept
      // the last listing's detached rows (and their listener closures) across
      // them would retain an uncapped tree for as long as the state lasted.
      for (const id of [...this.rowMemo.keys()]) {
        if (!this.rowMemoSeen.has(id)) {
          this.rowMemo.delete(id);
        }
      }
    }
  }

  private renderListingInner(now: number, focusWasInside: boolean): string | null | undefined {
    // `replaceChildren` detaches the focused row, and focus falls to <body> — a
    // keyboard user loses their place on every disclosure toggle. Restored by
    // `render` from this key, which is why subagent rows had to gain one.
    const restoreFocusTo = focusWasInside ? this.nav.focusedKey() : null;
    // Cleared with the DOM it describes, never later: every anchor in it points at
    // a node this call is about to detach, and `placeResults` runs on paths that
    // never reach the repo loop. An anchor map outliving its nodes is a drawing
    // artifact deciding what gets reported — the exact coupling this change removes.
    this.repoAnchors.clear();
    this.rowMemoSeen.clear();
    this.element.replaceChildren();
    const { tree, presence, loading, refreshing, noFolder } = this.data;

    if (loading && !tree) {
      this.element.setAttribute("aria-busy", "true");
      this.element.appendChild(renderSkeleton());
      return undefined;
    }
    this.element.removeAttribute("aria-busy");

    if (noFolder) {
      this.element.appendChild(worktreeEmptyState("noFolder"));
      return undefined;
    }
    // Only when nothing was retained: an unusable git with a last good listing
    // is a stale tree, not an empty one, and hiding it behind this state was
    // what made the cache's retention invisible.
    if (tree && !tree.gitAvailable && tree.repos.length === 0) {
      this.element.appendChild(worktreeEmptyState("gitMissing"));
      return undefined;
    }
    if (!tree || tree.repos.length === 0) {
      this.element.appendChild(worktreeEmptyState("noRepo"));
      return undefined;
    }

    // A refresh that already holds a tree keeps it and marks itself quietly (§ 5).
    if (refreshing) {
      this.element.appendChild(renderRefreshingMarker());
    }

    // Staleness the user did not cause is a status, not an alert: nothing here
    // needs acting on, and the tree below it is still worth reading.
    if (!tree.gitAvailable) {
      this.element.appendChild(
        renderNotice({
          tone: "warn",
          live: "status",
          title: "Git is unavailable.",
          body: "Showing the last known worktrees.",
          reason: tree.unreadable.reasons.join("\n"),
        }),
      );
    }

    // Presence sources that failed are named on the whole tree — they are not
    // scoped to one repo. An EMPTY result that is genuinely empty is not degraded
    // and gets no affordance at all (§ 4.5).
    for (const degradation of presence?.degradedSources ?? []) {
      this.element.appendChild(
        renderNotice({
          tone: "warn",
          title: "Agent list may be stale.",
          reason: `${degradation.source}: ${degradation.reason}`,
        }),
      );
    }
    // Suppressed while git is unavailable: the notice above already carries
    // every reason, and saying it twice reads as two separate problems.
    if (tree.gitAvailable && tree.unreadable.count > 0) {
      this.element.appendChild(
        renderNotice({
          tone: "warn",
          // `count` is occurrences and `reasons` is deduplicated for display, so
          // the two numbers deliberately differ and each is shown as what it is.
          title: `${tree.unreadable.count} path${tree.unreadable.count === 1 ? "" : "s"} could not be read.`,
          reason: tree.unreadable.reasons.join("\n"),
        }),
      );
    }

    // A group header per repo, but ONLY when the tree holds more than one (§ 3.1).
    const multiRepo = tree.repos.length > 1;
    let rendered = 0;
    for (const repo of tree.repos) {
      // Where this repo's section ends, so a repo-scoped result still lands with
      // its repository. Recorded here rather than inside `renderRepo` because that
      // method has an early return of its own, and an anchor missing for exactly
      // the collapsed case is how the collapsed hole opened.
      const before = this.element.childElementCount;
      rendered += this.renderRepo(repo, multiRepo, now);
      const last = this.element.lastElementChild;
      // ONLY when this repository actually drew something. A filter can empty one
      // entirely, and then the last element belongs to the repository before it —
      // a repo-scoped notice carries no name, so nothing on screen would contradict
      // the wrong attribution.
      if (this.element.childElementCount > before && last instanceof HTMLElement) {
        this.repoAnchors.set(repo.repoId, last);
      }
    }
    if (rendered === 0 && this.filter.query()) {
      this.element.appendChild(worktreeEmptyState("noMatch"));
    }
    this.nav.stampLevels(multiRepo);
    return restoreFocusTo;
  }

  /**
   * Every worktree id currently on screen, read back OUT OF THE DOM rather than
   * re-derived. `armCeiling` always runs after `render`, so the rows are already
   * there to be counted.
   *
   * The previous version restated the render's own predicate, and the restatement
   * drifted twice: once on `gitAvailable`, which drew a retained listing no
   * crossing could repaint, and once on `noFolder`. There is no third term to miss
   * — a row is here because it was drawn, which is the actual question.
   */
  private renderedWorktreeIds(): Set<string> {
    return new Set(this.renderedWorktreeRows().keys());
  }

  /** The drawn rows by worktree id. One implementation behind both the ceiling
   *  scheduler and result placement — two copies of this selector drifted twice
   *  before. They still scan separately, at the different moments each needs. */
  private renderedWorktreeRows(): Map<string, HTMLElement> {
    const rows = new Map<string, HTMLElement>();
    for (const el of this.element.querySelectorAll<HTMLElement>("[data-worktree-id]")) {
      const id = el.dataset.worktreeId;
      if (id !== undefined && !rows.has(id)) {
        rows.set(id, el);
      }
    }
    return rows;
  }

  /** Returns how many worktree rows this repo contributed (0 → filtered away). */
  private renderRepo(repo: WorktreeRepo, multiRepo: boolean, now: number): number {
    const visible = repo.worktrees.filter((w) => this.filter.matches(w));
    if (visible.length === 0 && !repo.degraded) {
      return 0;
    }
    // Only a rendered header can reopen a repo, so a single repo is never honoured
    // as collapsed — a persisted id from a two-repo session would otherwise blank
    // the view with no control to recover it.
    const collapsed = multiRepo && this.fold.isCollapsed(repo.repoId);
    if (multiRepo) {
      this.element.appendChild(
        renderRepoHeader(
          repo,
          visible.length,
          collapsed,
          () => this.toggleCollapsed(repo.repoId),
          this.deps.onCreateForRepo ? () => this.deps.onCreateForRepo?.(repo.repoId) : undefined,
        ),
      );
    }
    if (collapsed) {
      return visible.length;
    }

    // Degraded is scoped to the repo that failed, and names the source and reason.
    if (repo.degraded) {
      this.element.appendChild(
        renderNotice({
          tone: "warn",
          title: "Worktree list may be stale.",
          reason: repo.degraded,
          actions: this.deps.onRetryRepo
            ? [{ label: "Retry", onClick: () => this.deps.onRetryRepo?.(repo.repoId) }]
            : undefined,
        }),
      );
    }

    const shown = this.filter.shownWorktrees(repo, multiRepo);
    const tail = shown.filter((w) => this.filter.isIdle(w));
    // A filter reveals the tail, so there is nothing left for a disclosure to
    // disclose — and one that hides zero rows is not merely useless, it is a trap:
    // `expandOrDescend` treats any row carrying `aria-expanded` as expandable, so
    // Left enters the toggle branch and returns before `parentOf` ever runs. The
    // row cannot be left. Not rendering it is what keeps the tail climbable.
    const folds = tail.length >= IDLE_FOLD_THRESHOLD && !this.filter.query();
    const folded = folds && this.filter.idleTailFolded(repo.repoId);
    for (const info of shown) {
      if (folds && this.filter.isIdle(info)) {
        continue;
      }
      this.renderWorktree(info, now, false);
    }
    if (folds) {
      this.element.appendChild(
        renderIdleDisclosure(repo.repoId, tail.length, folded, () => this.filter.toggleIdleTail(repo.repoId)),
        // levels are stamped after the whole tree is drawn — see `stampLevels`.
      );
      if (!folded) {
        for (const info of tail) {
          // Notices travel with the row they concern wherever it is drawn: a
          // worktree does not stop reporting what an action did to it because
          // it happens to be quiet enough to sit under the disclosure.
          this.renderWorktree(info, now, true);
        }
      }
    }
    // Read off the REPOSITORY, never off what got drawn. A degraded listing
    // carries zero worktrees, and a filter, the cap, and the fold each reduce the
    // rows without saying anything about what the repository holds — deciding
    // from visible rows would call four different things unbranched.
    if (isUnbranched(repo)) {
      this.element.appendChild(
        worktreeEmptyState(
          "unbranched",
          this.deps.onCreateForRepo ? () => this.deps.onCreateForRepo?.(repo.repoId) : undefined,
        ),
      );
    }
    if (shown.length < visible.length) {
      this.element.appendChild(
        renderShowAll(visible.length, () => {
          this.filter.uncap(repo.repoId);
          this.repaint();
        }),
      );
    }
    return visible.length;
  }

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
              this.repaint();
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
