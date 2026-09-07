// src/webview/worktree/worktreeView/worktreeRow.ts — One worktree's subtree:
// the memo key that decides whether to rebuild it, and the build itself.
//
// Extracted from `WorktreeView` by change `decompose-worktree-view` (design.md
// D1, task 3_13). The key and the build have to move together: the key's whole
// job is to cover every field the build reads, and the two sat apart with
// nothing saying they were one contract.
//
// The key covers the clock-derived strings too. A key that narrows is a
// retained subtree that differs from what a full repaint would draw — which is
// invisible until a row shows a stale age (design.md § Obligation ledger).
//
// `rowMemo` stays a FIELD on `WorktreeView`; `rowMemoSeen` lives in the
// collaborator composition closure. Both arrive by reference; the suite reads
// `rowMemo` (D5, OBL-1).

import type { WorktreeContextMenu } from "../WorktreeContextMenu";
import {
  agentCountLabel,
  ageTimestamp,
  compactAge,
  groupPresenceByActivity,
  presentedActivity,
  strongestActivity,
} from "../worktreeFormat";
import { agentRowFields, worktreeFields } from "../worktreeRenderSignature";
import {
  confidenceHint,
  renderAgentRow,
  renderAgentsHeader,
  renderPresencePill,
  renderSubagentSection,
  renderWorktreeRow,
} from "../worktreeTreeView";
import type { PresenceDegradation, WorktreeAgentRow, WorktreeInfo, WorktreeRowActivation } from "../worktreeViewTypes";
import type { FoldState } from "./foldState";
import type { ViewFilter } from "./viewFilter";
import type { WorktreeViewDeps } from "./viewTypes";

export interface WorktreeRowDeps {
  view: WorktreeViewDeps;
  element(): HTMLElement;
  /** Absent when no actions were supplied — then no row listens for a menu. */
  menu(): WorktreeContextMenu | null;
  fold(): Pick<FoldState, "isRowExpanded">;
  filter(): Pick<ViewFilter, "isIdle">;
  degradedSources(): readonly PresenceDegradation[];
  strongestConfidenceTip(rows: readonly WorktreeAgentRow[], now: number): string | undefined;
  rowsFor(worktreeId: string): WorktreeAgentRow[];
  isExpanded(info: WorktreeInfo): boolean;
  selectedWorktreeId(): string | null;
  requestSubagents(row: WorktreeAgentRow): void;
  repaint(): void;
  select(info: WorktreeInfo): boolean;
  openRowMenu(info: WorktreeInfo, ev: MouseEvent, row: HTMLElement): void;
  toggleCollapsed(id: string): void;
  toggleRow(rowId: string): void;
  activationFor(row: WorktreeAgentRow): WorktreeRowActivation;
  /** Held by the class, read and written here (D5, OBL-1). */
  rowMemo: Map<string, { key: string; nodes: Node[] }>;
  rowMemoSeen: Set<string>;
}

export interface WorktreeRowRenderer {
  /** Draw one worktree's subtree into the tree element, memo permitting. */
  renderWorktree(info: WorktreeInfo, now: number, inTail?: boolean): void;
}

/**
 * PERF PROTOTYPE — the memo key for one worktree's subtree. Covers every field
 * the row + its agent rows + subagent sections read, INCLUDING the clock-derived
 * strings, so a key match means a repaint would produce identical DOM.
 */
function worktreeMemoKey(
  deps: WorktreeRowDeps,
  info: WorktreeInfo,
  rows: readonly WorktreeAgentRow[],
  now: number,
  inTail: boolean,
  expanded: boolean,
  selected: boolean,
): string {
  const degraded = deps.degradedSources();
  const parts: string[] = [
    worktreeFields(info),
    inTail ? "1" : "0",
    expanded ? "1" : "0",
    selected ? "1" : "0",
    deps.filter().isIdle(info) ? "1" : "0",
    strongestActivity(rows, degraded, now) ?? "",
    deps.strongestConfidenceTip(rows, now) ?? "",
    deps.view.actions?.launchAgentHere ? "1" : "0",
    deps.view.actions?.openFolderInNewWindow ? "1" : "0",
    deps.menu() ? "1" : "0",
  ];
  for (const row of rows) {
    const activity = presentedActivity(row, degraded, now);
    parts.push(
      agentRowFields(row, degraded, now),
      deps.fold().isRowExpanded(row.rowId) ? "1" : "0",
      // Clock-derived rendered strings — the only render inputs `agentRowFields`
      // does not already hold.
      compactAge(ageTimestamp(row), now),
      confidenceHint(row, activity, now) ?? "",
    );
  }
  return parts.join("\u0005");
}

function renderWorktree(deps: WorktreeRowDeps, info: WorktreeInfo, now: number, inTail = false): void {
  const rows = deps.rowsFor(info.id);
  const expanded = rows.length > 0 && deps.isExpanded(info);
  const selected = deps.selectedWorktreeId() === info.id;
  // Asked BEFORE the memo check: the roster request is owed by the render, not
  // by the repaint, and `RosterRequests` already dedupes it.
  if (expanded) {
    for (const row of rows) {
      if (deps.fold().isRowExpanded(row.rowId)) {
        deps.requestSubagents(row);
      }
    }
  }
  deps.rowMemoSeen.add(info.id);
  const memoKey = worktreeMemoKey(deps, info, rows, now, inTail, expanded, selected);
  const hit = deps.rowMemo.get(info.id);
  if (hit !== undefined && hit.key === memoKey) {
    for (const node of hit.nodes) {
      deps.element().appendChild(node);
    }
    return;
  }
  const produced: Node[] = [];
  buildWorktree(deps, info, rows, now, inTail, expanded, selected, produced);
  deps.rowMemo.set(info.id, { key: memoKey, nodes: produced });
  for (const node of produced) {
    deps.element().appendChild(node);
  }
}

interface NodeSink {
  appendChild(node: Node): void;
}

function buildAgentChildren(
  deps: WorktreeRowDeps,
  container: NodeSink,
  info: WorktreeInfo,
  rows: readonly WorktreeAgentRow[],
  now: number,
  expanded: boolean,
): void {
  if (rows.length === 0) {
    return;
  }
  if (!expanded) {
    container.appendChild(
      renderPresencePill(groupPresenceByActivity(rows, deps.degradedSources(), now), () =>
        deps.toggleCollapsed(info.id),
      ),
    );
    return;
  }

  container.appendChild(renderAgentsHeader(rows.length, () => deps.toggleCollapsed(info.id)));
  for (const row of rows) {
    const rowExpanded = deps.fold().isRowExpanded(row.rowId);
    if (rowExpanded) {
      // Asked from the render rather than the click, so a row restored into
      // the expanded set on open asks too — otherwise it would sit on
      // "Reading…" forever, having never been toggled.
      deps.requestSubagents(row);
    }
    container.appendChild(
      renderAgentRow(
        row,
        {
          activity: presentedActivity(row, deps.degradedSources(), now),
          expanded: rowExpanded,
          now,
        },
        {
          onActivate: (r) => deps.view.onActivateAgent?.(r, deps.activationFor(r)),
          onContextMenu: deps.menu() ? (r, ev, el) => deps.menu()?.openForAgent(r, ev, el) : undefined,
          onToggleSubagents: (r) => deps.toggleRow(r.rowId),
        },
      ),
    );
    // Always a section while the row is expanded: rendering nothing until
    // rows exist is the same picture as a session that delegated nothing
    // (design.md D10).
    if (rowExpanded) {
      container.appendChild(
        renderSubagentSection(row.delegations, row, (sub, parent) => deps.view.onActivateSubagent?.(sub, parent), now),
      );
    }
  }
}

function createNodeSink(produced: Node[], grouped: boolean, selected: boolean): NodeSink {
  // Every worktree keeps one stable block around its row and disclosure. Selection
  // changes paint only; creating this wrapper on click used to contract both rows.
  // `.wt-group` adds expanded-agent grouping, while `.wt-card` marks selection.
  //
  // Nodes are collected, not attached — `renderWorktree` owns the attach so a
  // memo hit can re-attach the very same nodes.
  const blockEl = document.createElement("div");
  blockEl.className = ["wt-block", grouped ? "wt-group" : "", selected ? "wt-card" : ""].filter(Boolean).join(" ");
  blockEl.setAttribute("role", "none");
  produced.push(blockEl);
  return {
    appendChild(node) {
      blockEl.appendChild(node);
    },
  };
}

function buildWorktree(
  deps: WorktreeRowDeps,
  info: WorktreeInfo,
  rows: readonly WorktreeAgentRow[],
  now: number,
  inTail: boolean,
  expanded: boolean,
  selected: boolean,
  produced: Node[],
): void {
  const container = createNodeSink(produced, expanded, selected);

  container.appendChild(
    renderWorktreeRow(
      info,
      {
        activity: strongestActivity(rows, deps.degradedSources(), now),
        // While collapsed this row IS the row: the pill below it is `aria-hidden`
        // with `tabIndex = -1` and is not in the arrow-key set, so a keyboard
        // user meets only this. A qualified glyph here without its qualification
        // is the claim without the caveat.
        confidenceTip: deps.strongestConfidenceTip(rows, now),
        hasAgents: rows.length > 0,
        idle: deps.filter().isIdle(info),
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
          if (deps.select(info)) {
            deps.repaint();
          }
        },
        onContextMenu: deps.menu() ? (i, ev, row) => deps.menu()?.openForWorktree(i, ev, row) : undefined,
        // The affirmative action, on the row that owns it — absent when the
        // capability was not supplied, and for a directory that is gone.
        onLaunchAgent: deps.view.actions?.launchAgentHere ? (i) => deps.view.actions?.launchAgentHere?.(i) : undefined,
        // Everything else, one press further in — the same menu the right-click
        // opens, so the two can never offer different things.
        onOverflowMenu: deps.menu() ? (i, ev, row) => deps.openRowMenu(i, ev, row) : undefined,
        // Same rule as the menu's: an affordance whose capability was not
        // supplied is absent, not present and inert (design.md D10).
        onOpenFolder: deps.view.actions?.openFolderInNewWindow
          ? (i) => deps.view.actions?.openFolderInNewWindow?.(i)
          : undefined,
      },
    ),
  );

  buildAgentChildren(deps, container, info, rows, now, expanded);
}

export function createWorktreeRow(deps: WorktreeRowDeps): WorktreeRowRenderer {
  return {
    renderWorktree: (info, now, inTail) => renderWorktree(deps, info, now, inTail),
  };
}
