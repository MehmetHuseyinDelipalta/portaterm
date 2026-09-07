// src/webview/worktree/worktreeView/composeViewCollaborators.ts — The eight
// collaborators the view is made of, and the wiring that joins them.
//
// Extracted from `WorktreeView` by change `decompose-worktree-view` (design.md
// D1, task 3_13). Each responsibility had moved to its own module, but their
// mutual wiring still filled a quarter of the facade's constructor.
//
// They are built into one record each one reads through lazy callbacks. That is
// the cycle already present in the class — fold repaints through tree, tree asks
// row to build, row reads fold — made explicit at one composition boundary.

import type { WorktreeContextMenu } from "../WorktreeContextMenu";
import type {
  PresenceDegradation,
  WorktreeAgentRow,
  WorktreeInfo,
  WorktreeRemoveReport,
  WorktreeRepo,
  WorktreeRowActivation,
} from "../worktreeViewTypes";
import { type ActionNotices, createActionNotices } from "./actionNotices";
import { type CeilingClock, createCeilingClock } from "./ceilingClock";
import { createFoldState, type FoldState } from "./foldState";
import { createKeyboardNav, type KeyboardNav } from "./keyboardNav";
import { createTreeRender, IDLE_FOLD_THRESHOLD, type TreeRender } from "./treeRender";
import { createViewDialogs, type ViewDialogs } from "./viewDialogs";
import { createViewFilter, type ViewFilter } from "./viewFilter";
import type { WorktreeViewData, WorktreeViewDeps } from "./viewTypes";
import { createWorktreeRow, type WorktreeRowRenderer } from "./worktreeRow";

export interface ViewCollaborators {
  notices: ActionNotices;
  ceilingClock: CeilingClock;
  dialogs: ViewDialogs;
  filter: ViewFilter;
  row: WorktreeRowRenderer;
  tree: TreeRender;
  nav: KeyboardNav;
  fold: FoldState;
}

export interface ViewCollaboratorSeam {
  view: WorktreeViewDeps;
  renderCap: number;
  element(): HTMLElement;
  menu(): WorktreeContextMenu | null;
  data(): WorktreeViewData;
  disposed(): boolean;
  repoOf(info: WorktreeInfo): WorktreeRepo | undefined;
  repoAnchors: Map<string, HTMLElement>;
  rowMemo: Map<string, { key: string; nodes: Node[] }>;
  openRemoveReport(info: WorktreeInfo, report: WorktreeRemoveReport): void;
  displayRows(data: WorktreeViewData, worktreeId: string): WorktreeAgentRow[];
  rowsFor(worktreeId: string): WorktreeAgentRow[];
  degradedSources(): readonly PresenceDegradation[];
  isExpanded(info: WorktreeInfo): boolean;
  selectedWorktreeId(): string | null;
  requestSubagents(row: WorktreeAgentRow): void;
  select(worktreeId: string): boolean;
  openRowMenu(info: WorktreeInfo, ev: MouseEvent, row: HTMLElement): void;
  toggleCollapsed(id: string): void;
  toggleRow(rowId: string): void;
  activationFor(row: WorktreeAgentRow): WorktreeRowActivation;
  pruneStaleState(data: WorktreeViewData): void;
  flushRosterRequests(): void;
}

export function createViewCollaborators(seam: ViewCollaboratorSeam): ViewCollaborators {
  const deps = seam.view;
  // Filled below and read only through callbacks, after this factory returns.
  const built = {} as ViewCollaborators;
  const rowMemoSeen = new Set<string>();
  const repaint = (): void => {
    built.tree.repaint();
  };

  built.notices = createActionNotices({
    data: seam.data,
    element: seam.element,
    disposed: seam.disposed,
    view: deps,
    repoOf: seam.repoOf,
    repoAnchors: seam.repoAnchors,
    renderedWorktreeRows: () => built.tree.renderedWorktreeRows(),
    openRemoveReport: seam.openRemoveReport,
  });

  built.ceilingClock = createCeilingClock({
    ...(deps.now === undefined ? {} : { clock: deps.now }),
    disposed: seam.disposed,
    degradedSources: seam.degradedSources,
    renderedWorktreeIds: () => built.tree.renderedWorktreeIds(),
    presentWorktreeIds: () => Object.keys(seam.data().presence?.rowsByWorktreeId ?? {}),
    rowsFor: seam.rowsFor,
    applyAt: (now) => {
      built.tree.applyAt(now);
    },
  });

  built.dialogs = createViewDialogs({
    view: deps,
    now: () => built.ceilingClock.now(),
    rowsFor: seam.rowsFor,
    degradedSources: seam.degradedSources,
  });

  built.filter = createViewFilter({
    fold: () => built.fold,
    data: seam.data,
    displayRows: seam.displayRows,
    rowsFor: seam.rowsFor,
    cap: seam.renderCap,
    repaint,
  });

  built.row = createWorktreeRow({
    view: deps,
    element: seam.element,
    menu: seam.menu,
    fold: () => built.fold,
    filter: () => built.filter,
    degradedSources: seam.degradedSources,
    strongestConfidenceTip: (rows, now) => built.ceilingClock.strongestConfidenceTip(rows, now),
    rowsFor: seam.rowsFor,
    isExpanded: seam.isExpanded,
    selectedWorktreeId: seam.selectedWorktreeId,
    requestSubagents: seam.requestSubagents,
    repaint,
    select: seam.select,
    openRowMenu: seam.openRowMenu,
    toggleCollapsed: seam.toggleCollapsed,
    toggleRow: seam.toggleRow,
    activationFor: seam.activationFor,
    rowMemo: seam.rowMemo,
    rowMemoSeen,
  });

  built.tree = createTreeRender({
    view: deps,
    element: seam.element,
    data: seam.data,
    disposed: seam.disposed,
    now: () => built.ceilingClock.now(),
    armCeiling: (now) => {
      built.ceilingClock.armCeiling(now);
    },
    nav: () => built.nav,
    fold: () => built.fold,
    filter: () => built.filter,
    pruneStaleState: seam.pruneStaleState,
    placeResults: () => {
      built.notices.placeResults();
    },
    flushRosterRequests: seam.flushRosterRequests,
    toggleCollapsed: seam.toggleCollapsed,
    renderWorktree: (info, now, inTail) => {
      built.row.renderWorktree(info, now, inTail);
    },
    rowMemo: seam.rowMemo,
    rowMemoSeen,
    repoAnchors: seam.repoAnchors,
  });

  built.nav = createKeyboardNav({
    element: seam.element,
    toggleCollapsed: seam.toggleCollapsed,
    toggleIdleTail: (repoId) => built.filter.toggleIdleTail(repoId),
    toggleRow: seam.toggleRow,
  });

  built.fold = createFoldState({
    persisted: deps.getInitialCollapsed?.(),
    initialExpandedRows: deps.getInitialExpandedRows?.() ?? [],
    initialIdleSeeded: deps.getInitialIdleSeeded?.() ?? [],
    idleFoldThreshold: IDLE_FOLD_THRESHOLD,
    persistCollapsed: (keys) => deps.persistCollapsed?.([...keys]),
    persistExpandedRows: (ids) => deps.persistExpandedRows?.([...ids]),
    persistIdleSeeded: (ids) => deps.persistIdleSeeded?.([...ids]),
    query: () => built.filter.query(),
    repaint,
  });

  return built;
}
