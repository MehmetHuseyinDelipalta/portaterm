// src/webview/worktree/controller/menuActions.ts — The row context menu's
// callbacks, each posting the request its label names and nothing else.
//
// Extracted from `WorktreeController` by change `decompose-worktree-view`
// (task 3_15). It never belonged to the class — it takes its capabilities as
// arguments and holds no state — and at 110 lines it was what kept the facade
// over 500 after every collaborator had moved.

import type { WebViewToExtensionMessage } from "../../../types/messages";
import type { WorktreeMenuActions } from "../WorktreeContextMenu";
import type { WorktreeAgentRow, WorktreeInfo } from "../worktreeViewTypes";

/**
 * The menu's callbacks, each posting the request its label names and nothing
 * else. Ids only: the host re-resolves them against its own tree and presence,
 * so a path the view carried could never become the path an action ran on (D2).
 *
 * Every launch capability is conditional on the host having reported something
 * to launch: `undefined` makes the item absent, which is the truthful rendering
 * of "no agent here can start a session".
 */
export function worktreeMenuActions(
  post: (msg: WebViewToExtensionMessage) => void,
  /**
   * Which repository a worktree belongs to, and how many of its registrations
   * git already flagged prunable. Only the view holds the tree that answers
   * this. Without it the prune item is ABSENT rather than posting a repo id the
   * webview guessed — a prune against the wrong repository is not recoverable
   * by re-confirming.
   */
  repoFor?: (info: WorktreeInfo) => { repoId: string; prunableCount: number } | undefined,
  /**
   * Open the create form for the repo `info` belongs to. Absent → no item: the
   * form cannot open on a destination the host has not resolved yet.
   */
  onCreate?: (info: WorktreeInfo) => void,
  /**
   * Open prune's confirmation for a repo. Absent → no prune item: the count is
   * the whole content of that confirmation, so an unconfirmed prune is not a
   * cheaper version of this action, it is a different one.
   */
  confirmPrune?: (repoId: string) => void,
  /**
   * Open the launch dialog for a worktree. Absent → no item, which is how the
   * panel says "no agent on this host can start a fresh session" rather than
   * offering a picker with nothing in it.
   */
  onLaunch?: (info: WorktreeInfo) => void,
  /**
   * Resume an agent row's session in ITS worktree. Absent for the same reason,
   * and additionally per-row: a row with no session is never offered it.
   */
  onResumeHere?: (row: WorktreeAgentRow) => void,
  /**
   * Mint the token this request will be answered under (D11). Absent → a bare
   * token that no controller is ordering answers against, which is the right
   * shape for a menu built with no controller behind it.
   */
  beginAssess?: (worktreeId: string) => string,
): WorktreeMenuActions {
  return {
    ...(onCreate === undefined ? {} : { createWorktree: onCreate }),
    ...(onLaunch === undefined ? {} : { launchAgentHere: onLaunch }),
    ...(onResumeHere === undefined ? {} : { resumeHere: onResumeHere }),
    openFolderInNewWindow: (info) => post({ type: "worktreeOpenFolder", worktreeId: info.id, mode: "newWindow" }),
    addFolderToWorkspace: (info) => post({ type: "worktreeOpenFolder", worktreeId: info.id, mode: "addToWorkspace" }),
    openTerminalHere: (info) => post({ type: "worktreeOpenTerminal", worktreeId: info.id }),
    revealWorktree: (info) => post({ type: "worktreeRevealInOS", worktreeId: info.id }),
    copyWorktreePath: (info) => post({ type: "worktreeCopyPath", worktreeId: info.id }),
    toggleLock: (info) =>
      post(
        info.locked ? { type: "worktreeUnlock", worktreeId: info.id } : { type: "worktreeLock", worktreeId: info.id },
      ),
    // Unforced, deliberately: the host answers with the blocker set rather than
    // acting, and the confirmation the user then sees is bound to that set's
    // fingerprint. The webview never decides a removal is safe.
    // ASKS what the removal would cost; it removes nothing. The unforced
    // `worktreeRemove` this used to post deleted a clean worktree outright,
    // because the host reports only from the path that already attempted the
    // deletion — the whole of round-3 B1 (design.md D6).
    removeWorktree: (info) =>
      post({
        type: "worktreeRemoveAssess",
        worktreeId: info.id,
        token: beginAssess === undefined ? "" : beginAssess(info.id),
      }),
    // Repo-scoped: a prune drops stale REGISTRATIONS, which belong to the
    // repository rather than to the worktree the menu was opened on. The count
    // is the one the confirmation named, and the host abandons the prune if it
    // has moved since (design.md D13).
    ...(repoFor === undefined || confirmPrune === undefined
      ? {}
      : {
          pruneRepo: (info: WorktreeInfo) => {
            const repo = repoFor(info);
            if (repo === undefined || repo.prunableCount <= 0) {
              return;
            }
            // Confirmed, never posted straight from the click: D13 exists so the
            // user sees the NUMBER before a repository mutation starts.
            confirmPrune(repo.repoId);
          },
        }),

    focusPane: (row) => {
      if (row.paneId !== undefined) {
        post({ type: "worktreeFocusPane", rowId: row.rowId, paneId: row.paneId });
      }
    },
    openPreview: (row) => {
      if (row.entryId !== undefined) {
        post({ type: "worktreeOpenPreview", rowId: row.rowId, entryId: row.entryId });
      }
    },
    copyResumeCommand: (row) => {
      if (row.entryId !== undefined) {
        post({ type: "worktreeCopyResumeCommand", rowId: row.rowId, entryId: row.entryId });
      }
    },
    revealAgentCwd: (row) => {
      if (row.entryId !== undefined) {
        post({ type: "worktreeRevealAgentCwd", rowId: row.rowId, entryId: row.entryId });
      }
    },
    copyAgentPath: (row) => {
      if (row.entryId !== undefined) {
        post({ type: "worktreeCopyAgentPath", rowId: row.rowId, entryId: row.entryId });
      }
    },
  };
}
