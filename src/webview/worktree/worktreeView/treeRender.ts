// src/webview/worktree/worktreeView/treeRender.ts — One render pass: what
// decides to draw, what gets drawn, and where the focus lands afterwards.
//
// Extracted from `WorktreeView` by change `decompose-worktree-view` (design.md
// D1, task 3_11). The signature guard, the pass it gates, the ordering rules
// inside that pass — placement after the listing, focus after placement, roster
// dispatch last — and the memo sweep that has to run on every exit were spread
// across 350 lines of the class with nothing naming them as one thing.
//
// `rowMemo` and `rowMemoSeen` stay FIELDS on `WorktreeView` and arrive here by
// reference: a suite reads both on the empty-listing and the dispose path (D5,
// OBL-1). The row builder itself is `worktreeRow.ts` (task 3_13).

import { worktreeSignature } from "../worktreeRenderSignature";
import {
  renderIdleDisclosure,
  renderNotice,
  renderRefreshingMarker,
  renderRepoHeader,
  renderShowAll,
  renderSkeleton,
  worktreeEmptyState,
} from "../worktreeTreeView";
import type { WorktreeInfo, WorktreeRepo } from "../worktreeViewTypes";
import { resultKey } from "./actionNotices";
import type { FoldState } from "./foldState";
import type { KeyboardNav } from "./keyboardNav";
import type { ViewFilter } from "./viewFilter";
import type { WorktreeViewData, WorktreeViewDeps } from "./viewTypes";

/** Below this many agentless worktrees, a disclosure hides less than it costs (§ 3.6). */
export const IDLE_FOLD_THRESHOLD = 4;

/** A repository that has been cloned but never branched out — one worktree, the main one. */
function isUnbranched(repo: WorktreeRepo): boolean {
  return repo.degraded === undefined && repo.worktrees.length === 1 && repo.worktrees[0]?.kind === "main";
}

export interface TreeRenderDeps {
  view: WorktreeViewDeps;
  element(): HTMLElement;
  data(): WorktreeViewData;
  disposed(): boolean;
  now(): number;
  armCeiling(now: number): void;
  /** Built after this module, so all four arrive as accessors. */
  nav(): KeyboardNav;
  fold(): Pick<FoldState, "isCollapsed">;
  filter(): ViewFilter;
  /** Expansion state for a worktree that disappeared is dropped, not resurrected. */
  pruneStaleState(data: WorktreeViewData): void;
  placeResults(): void;
  flushRosterRequests(): void;
  toggleCollapsed(id: string): void;
  /** One worktree's subtree, memo and all (task 3_13). */
  renderWorktree(info: WorktreeInfo, now: number, inTail?: boolean): void;
  /** Held by the class, swept here: the memo and the ids this pass touched. */
  rowMemo: Map<string, { key: string; nodes: Node[] }>;
  rowMemoSeen: Set<string>;
  /** Where each repository's section ends, for repo-scoped notices. */
  repoAnchors: Map<string, HTMLElement>;
}

export interface TreeRender {
  /**
   * Draw this envelope if it says anything new, and re-arm the ceiling either
   * way. The one entry point for data-driven renders.
   */
  applyAt(now: number): void;

  /**
   * A repaint forced by an interaction rather than by data — collapsing a repo,
   * lifting the display cap, expanding a row.
   */
  repaint(): void;

  /**
   * Every worktree id currently on screen, read back OUT OF THE DOM rather than
   * re-derived.
   */
  renderedWorktreeIds(): Set<string>;

  /** The drawn rows by worktree id. */
  renderedWorktreeRows(): Map<string, HTMLElement>;
}

export function createTreeRender(deps: TreeRenderDeps): TreeRender {
  /** The envelope the DOM on screen was drawn from. `null` re-renders anything. */
  let signature: string | null = null;

  /**
   * Render if anything moved, then schedule the next moment something can move
   * on its own.
   *
   * ONE reading of the clock serves all three of the signature, what it renders,
   * and the next deadline. Reading it again between them would let a row be drawn
   * against one moment and scheduled against another, which is how a crossing
   * gets skipped by a millisecond.
   */
  function applyAt(now: number): void {
    const { tree, presence, loading, refreshing, noFolder, actionResults } = deps.data();
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
      deps.view.actions?.launchAgentHere ? "1" : "0",
    ].join(String.fromCharCode(4));
    if (stateKey !== signature) {
      signature = stateKey;
      // Expansion state for a worktree that disappeared is dropped, not resurrected.
      deps.pruneStaleState(deps.data());
      try {
        render(now);
      } catch (err) {
        // The key above already claims this envelope is drawn. A render that
        // threw part-way — in practice a roster dispatch the host refused —
        // leaves `RosterRequests` correctly holding the rows it could not send,
        // behind a guard that turns the next identical envelope into a no-op, so
        // nothing ever asks again (.reviews/round-3.md W4).
        signature = null;
        throw err;
      }
    }
    deps.armCeiling(now);
  }

  /**
   * A repaint forced by an interaction rather than by data — collapsing a repo,
   * lifting the display cap, expanding a row. `applyAt` cannot serve these: the
   * signature covers the DATA, and none of this moves it, so the render would be
   * skipped. Still one reading of the clock, and still re-armed, because what is
   * drawn is what can cross.
   */
  function repaint(): void {
    // `dispose()` tears down the tooltip delegates, so a rebuild after it produces
    // a tree whose hints are permanently dead — a half-live view is worse than a
    // stale one. Guarding only the arming left the DOM work happening anyway.
    if (deps.disposed()) {
      return;
    }
    const now = deps.now();
    render(now);
    deps.armCeiling(now);
  }

  // -- Render --------------------------------------------------------------

  function render(now: number): void {
    const scrollTop = deps.element().scrollTop;
    // `renderListing` keeps its early exits — a skeleton and an empty state have
    // no tree to lay out — but placement must not sit behind any of them, so it
    // runs here, once, on every path.
    // Read once, here, and handed down: every path below has to know whether the
    // user was inside this tree when it was torn down, including the empty states
    // that return no key at all (.reviews/round-2.md B6).
    const focusWasInside = deps.element().contains(document.activeElement);
    const restoreFocusTo = renderListing(now, focusWasInside);
    deps.placeResults();
    restoreFocus(restoreFocusTo, focusWasInside, scrollTop);
    // Last, and after focus is back: this is the only step here that reaches the
    // host, so it is the only one that can throw — and a throw before the restore
    // above would leave the user on `<body>` (.reviews/round-3.md W4). Never from
    // inside the loop that queued them either: a dep answering synchronously
    // re-enters `renderListing`, which replaces the half-built tree and places
    // every notice twice. Runs on every path, including the empty states — a
    // queued request is owed either way.
    deps.flushRosterRequests();
  }

  /** Put the user back where they were, or at least back inside the tree. */
  function restoreFocus(restoreFocusTo: string | null | undefined, focusWasInside: boolean, scrollTop: number): void {
    if (restoreFocusTo === undefined) {
      // A skeleton or an empty state. It replaced the children like any other
      // render, so a user who was inside is now on `<body>` — the top of the
      // whole document — unless the tree takes them back.
      if (focusWasInside) {
        deps.element().focus();
      }
      return;
    }
    deps.element().scrollTop = scrollTop;
    deps.nav().syncRovingTabindex();
    if (restoreFocusTo !== null) {
      const rows = deps.nav().navRows();
      // The row can have left in this very render — a worktree removed, a query
      // typed. `syncRovingTabindex` above has already moved the tab stop to a row
      // that exists, so that is where focus belongs; with no rows at all the tree
      // itself is the last thing standing between the user and `<body>`.
      const target =
        rows.find((r) => deps.nav().keyOf(r) === restoreFocusTo) ??
        rows.find((r) => deps.nav().keyOf(r) === deps.nav().focusedKey());
      if (target === undefined) {
        deps.element().focus();
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
  function renderListing(now: number, focusWasInside: boolean): string | null | undefined {
    try {
      return renderListingInner(now, focusWasInside);
    } finally {
      // On EVERY exit, not only the one that walked the repos: the loading and
      // empty states return early with nothing on screen, and a memo that kept
      // the last listing's detached rows (and their listener closures) across
      // them would retain an uncapped tree for as long as the state lasted.
      for (const id of [...deps.rowMemo.keys()]) {
        if (!deps.rowMemoSeen.has(id)) {
          deps.rowMemo.delete(id);
        }
      }
    }
  }

  function renderListingInner(now: number, focusWasInside: boolean): string | null | undefined {
    // `replaceChildren` detaches the focused row, and focus falls to <body> — a
    // keyboard user loses their place on every disclosure toggle. Restored by
    // `render` from this key, which is why subagent rows had to gain one.
    const restoreFocusTo = focusWasInside ? deps.nav().focusedKey() : null;
    // Cleared with the DOM it describes, never later: every anchor in it points at
    // a node this call is about to detach, and `placeResults` runs on paths that
    // never reach the repo loop. An anchor map outliving its nodes is a drawing
    // artifact deciding what gets reported — the exact coupling this change removes.
    deps.repoAnchors.clear();
    deps.rowMemoSeen.clear();
    deps.element().replaceChildren();
    const { tree, presence, loading, refreshing, noFolder } = deps.data();

    if (loading && !tree) {
      deps.element().setAttribute("aria-busy", "true");
      deps.element().appendChild(renderSkeleton());
      return undefined;
    }
    deps.element().removeAttribute("aria-busy");

    if (noFolder) {
      deps.element().appendChild(worktreeEmptyState("noFolder"));
      return undefined;
    }
    // Only when nothing was retained: an unusable git with a last good listing
    // is a stale tree, not an empty one, and hiding it behind this state was
    // what made the cache's retention invisible.
    if (tree && !tree.gitAvailable && tree.repos.length === 0) {
      deps.element().appendChild(worktreeEmptyState("gitMissing"));
      return undefined;
    }
    if (!tree || tree.repos.length === 0) {
      deps.element().appendChild(worktreeEmptyState("noRepo"));
      return undefined;
    }

    // A refresh that already holds a tree keeps it and marks itself quietly (§ 5).
    if (refreshing) {
      deps.element().appendChild(renderRefreshingMarker());
    }

    // Staleness the user did not cause is a status, not an alert: nothing here
    // needs acting on, and the tree below it is still worth reading.
    if (!tree.gitAvailable) {
      deps.element().appendChild(
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
      deps.element().appendChild(
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
      deps.element().appendChild(
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
      const before = deps.element().childElementCount;
      rendered += renderRepo(repo, multiRepo, now);
      const last = deps.element().lastElementChild;
      // ONLY when this repository actually drew something. A filter can empty one
      // entirely, and then the last element belongs to the repository before it —
      // a repo-scoped notice carries no name, so nothing on screen would contradict
      // the wrong attribution.
      if (deps.element().childElementCount > before && last instanceof HTMLElement) {
        deps.repoAnchors.set(repo.repoId, last);
      }
    }
    if (rendered === 0 && deps.filter().query()) {
      deps.element().appendChild(worktreeEmptyState("noMatch"));
    }
    deps.nav().stampLevels(multiRepo);
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
  function renderedWorktreeIds(): Set<string> {
    return new Set(renderedWorktreeRows().keys());
  }

  /** The drawn rows by worktree id. One implementation behind both the ceiling
   *  scheduler and result placement — two copies of this selector drifted twice
   *  before. They still scan separately, at the different moments each needs. */
  function renderedWorktreeRows(): Map<string, HTMLElement> {
    const rows = new Map<string, HTMLElement>();
    for (const el of deps.element().querySelectorAll<HTMLElement>("[data-worktree-id]")) {
      const id = el.dataset.worktreeId;
      if (id !== undefined && !rows.has(id)) {
        rows.set(id, el);
      }
    }
    return rows;
  }

  /** Returns how many worktree rows this repo contributed (0 → filtered away). */
  function renderRepo(repo: WorktreeRepo, multiRepo: boolean, now: number): number {
    const visible = repo.worktrees.filter((w) => deps.filter().matches(w));
    if (visible.length === 0 && !repo.degraded) {
      return 0;
    }
    // Only a rendered header can reopen a repo, so a single repo is never honoured
    // as collapsed — a persisted id from a two-repo session would otherwise blank
    // the view with no control to recover it.
    const collapsed = multiRepo && deps.fold().isCollapsed(repo.repoId);
    if (multiRepo) {
      deps
        .element()
        .appendChild(
          renderRepoHeader(
            repo,
            visible.length,
            collapsed,
            () => deps.toggleCollapsed(repo.repoId),
            deps.view.onCreateForRepo ? () => deps.view.onCreateForRepo?.(repo.repoId) : undefined,
          ),
        );
    }
    if (collapsed) {
      return visible.length;
    }

    // Degraded is scoped to the repo that failed, and names the source and reason.
    if (repo.degraded) {
      deps.element().appendChild(
        renderNotice({
          tone: "warn",
          title: "Worktree list may be stale.",
          reason: repo.degraded,
          actions: deps.view.onRetryRepo
            ? [{ label: "Retry", onClick: () => deps.view.onRetryRepo?.(repo.repoId) }]
            : undefined,
        }),
      );
    }

    const shown = deps.filter().shownWorktrees(repo, multiRepo);
    const tail = shown.filter((w) => deps.filter().isIdle(w));
    // A filter reveals the tail, so there is nothing left for a disclosure to
    // disclose — and one that hides zero rows is not merely useless, it is a trap:
    // `expandOrDescend` treats any row carrying `aria-expanded` as expandable, so
    // Left enters the toggle branch and returns before `parentOf` ever runs. The
    // row cannot be left. Not rendering it is what keeps the tail climbable.
    const folds = tail.length >= IDLE_FOLD_THRESHOLD && !deps.filter().query();
    const folded = folds && deps.filter().idleTailFolded(repo.repoId);
    for (const info of shown) {
      if (folds && deps.filter().isIdle(info)) {
        continue;
      }
      deps.renderWorktree(info, now, false);
    }
    if (folds) {
      deps.element().appendChild(
        renderIdleDisclosure(repo.repoId, tail.length, folded, () => deps.filter().toggleIdleTail(repo.repoId)),
        // levels are stamped after the whole tree is drawn — see `stampLevels`.
      );
      if (!folded) {
        for (const info of tail) {
          // Notices travel with the row they concern wherever it is drawn: a
          // worktree does not stop reporting what an action did to it because
          // it happens to be quiet enough to sit under the disclosure.
          deps.renderWorktree(info, now, true);
        }
      }
    }
    // Read off the REPOSITORY, never off what got drawn. A degraded listing
    // carries zero worktrees, and a filter, the cap, and the fold each reduce the
    // rows without saying anything about what the repository holds — deciding
    // from visible rows would call four different things unbranched.
    if (isUnbranched(repo)) {
      deps
        .element()
        .appendChild(
          worktreeEmptyState(
            "unbranched",
            deps.view.onCreateForRepo ? () => deps.view.onCreateForRepo?.(repo.repoId) : undefined,
          ),
        );
    }
    if (shown.length < visible.length) {
      deps.element().appendChild(
        renderShowAll(visible.length, () => {
          deps.filter().uncap(repo.repoId);
          repaint();
        }),
      );
    }
    return visible.length;
  }

  return {
    applyAt,
    repaint,
    renderedWorktreeIds,
    renderedWorktreeRows,
  };
}
