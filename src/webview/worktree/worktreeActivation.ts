// src/webview/worktree/worktreeActivation.ts — What activating an agent row does.
//
// One decision, held apart from the renderer that draws the row. It has two
// clauses a per-surface copy kept losing: an external row has no pane in THIS
// window to focus, and a row with no session has no transcript to preview.
// Missing either one turns a working row into a dead click (.reviews/round-1.md B4).

import type { WorktreeAgentRow, WorktreeRowActivation } from "./worktreeViewTypes";

/**
 * `setting` is the user's `rowActivation` preference. It is consulted last and
 * only where both outcomes are actually reachable — the two clauses above are not
 * the setting being overridden, they are cases where it is never read (D5).
 */
export function activationFor(row: WorktreeAgentRow, setting: WorktreeRowActivation): WorktreeRowActivation {
  if (row.scope === "external") {
    return "preview";
  }
  if (row.entryId === undefined) {
    return "focus";
  }
  return setting;
}
