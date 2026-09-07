// src/webview/worktree/worktreeView/viewDialogs.ts — Every modal this view puts
// over the panel, and the single handle that guarantees only one is up.
//
// Extracted from `WorktreeView` by change `decompose-worktree-view` (design.md
// D1, task 3_9). `closeDialog` is global across all five openers, and the rule
// that makes it safe — supersede retires the form it tears down, and the two
// exits are idempotent rather than exclusive — was stated at one opener and
// depended on by the other four.
//
// The handle lives here; the view's `dispose` closes through this module.

import { openWorktreeCreateDialog } from "../WorktreeCreateDialog";
import { openWorktreeLaunchDialog } from "../WorktreeLaunchDialog";
import { openWorktreePruneDialog, type PruneDialogDeps } from "../WorktreePruneDialog";
import { openWorktreeRemoveDialog, type WorktreeRemoveDialogDeps } from "../WorktreeRemoveDialog";
import type {
  PresenceDegradation,
  WorktreeAgentRow,
  WorktreeInfo,
  WorktreeLaunchAgent,
  WorktreeRemoveReport,
} from "../worktreeViewTypes";
import type { WorktreeViewDeps } from "./viewTypes";

export interface ViewDialogsDeps {
  view: WorktreeViewDeps;
  now(): number;
  rowsFor(worktreeId: string): WorktreeAgentRow[];
  degradedSources(): readonly PresenceDegradation[];
}

export interface ViewDialogs {
  /** Open the create form over the panel. No-op without `createDialogDeps`. */
  openCreateDialog(initialRepoId?: string): void;

  /**
   * Open the launch dialog over the panel. No-op without agents to offer — the
   * menu item is absent in that case too; this is the same rule at the second
   * door.
   */
  openLaunchDialog(worktreeLabel: string, agents: readonly WorktreeLaunchAgent[]): void;

  /** Open the prune confirmation. The count is the host's; the panel never guesses it. */
  openPruneDialog(args: Omit<PruneDialogDeps, "onConfirm" | "onCancel">, onConfirm: (count: number) => void): void;

  /** Open the remove confirmation — or its refusal, when nothing can authorize it. */
  openRemoveDialog(args: Omit<WorktreeRemoveDialogDeps, "onConfirm" | "onCancel" | "now">): void;

  /**
   * Open the report for one worktree, filled from this view's own presence.
   *
   * The controller holds the same presence and could look both up, but the two
   * lookups that turn it into dialog arguments belong beside the dialog: a
   * second copy is a second thing to miss when a row's rendering changes.
   */
  openRemoveReport(info: WorktreeInfo, report: WorktreeRemoveReport): void;

  /** Take down whatever is up. Called from the view's own `dispose`. */
  dispose(): void;
}

export function createViewDialogs(deps: ViewDialogsDeps): ViewDialogs {
  let closeDialog: (() => void) | null = null;

  /**
   * Retire whatever the panel was waiting on, then clear the floor for a new
   * dialog. Both halves belong together: `closeDialog` is global, so opening
   * any dialog is also what makes a still-outstanding assess obsolete (D11).
   */
  const beginDialog = (): void => {
    deps.view.onDialogOpened?.();
    closeDialog?.();
  };

  const openRemoveDialog: ViewDialogs["openRemoveDialog"] = (args) => {
    beginDialog();
    closeDialog = openWorktreeRemoveDialog(deps.view.host, {
      ...args,
      now: deps.now(),
      onConfirm: (fingerprint, deleteBranch) => {
        closeDialog = null;
        deps.view.onForceRemove?.(args.info, fingerprint, deleteBranch);
      },
      onCancel: () => {
        closeDialog = null;
      },
    });
  };

  return {
    openRemoveDialog,

    openCreateDialog(initialRepoId) {
      const seed = deps.view.createDialogDeps?.();
      if (!seed || seed.repos.length === 0) {
        return;
      }
      beginDialog();
      // Captured HERE, while this form is the one being opened. Everything below
      // closes over it, so no exit has to ask what the current opening is at the
      // moment it runs (B3).
      const opening = deps.view.createOpening?.();
      let retired = false;
      const retire = (): void => {
        if (retired || opening === undefined) {
          return;
        }
        retired = true;
        deps.view.onCreateClosed?.(opening);
      };
      const dispose = openWorktreeCreateDialog(deps.view.host, {
        ...seed,
        initialRepoId: initialRepoId ?? seed.initialRepoId,
        onSubmit: (draft) => {
          closeDialog = null;
          // The submission first, the retirement after it. The create cites the
          // provisioning offer by id and retirement evicts it, so retiring first
          // would strip the request of the model it was built from.
          deps.view.onCreateSubmit?.(draft);
          retire();
        },
        onCancel: () => {
          closeDialog = null;
          retire();
        },
      });
      // The dialog returns its raw disposer, and only its own `cancel` calls
      // `onCancel` — so a form superseded by `closeDialog?.()` at the top of
      // any other dialog's opener was torn down without ever retiring, leaving
      // its opening live on the owner for good. `retired` makes the two paths
      // idempotent rather than mutually exclusive: cancel disposes as well, and
      // one exit must not retire twice.
      closeDialog = () => {
        retire();
        dispose();
      };
    },

    openLaunchDialog(worktreeLabel, agents) {
      if (agents.length === 0) {
        return;
      }
      beginDialog();
      // Tracked like every other modal here: an untracked one stays mounted under
      // the next dialog, holding a focus trap and a document listener nothing
      // will ever release.
      closeDialog = openWorktreeLaunchDialog(deps.view.host, {
        worktreeLabel,
        agents,
        onConfirm: (request) => {
          closeDialog = null;
          deps.view.onLaunchSubmit?.(request);
        },
        onCancel: () => {
          closeDialog = null;
        },
      });
    },

    openPruneDialog(args, onConfirm) {
      beginDialog();
      openWorktreePruneDialog(deps.view.host, {
        ...args,
        onConfirm: (count) => {
          closeDialog = null;
          onConfirm(count);
        },
        onCancel: () => {
          closeDialog = null;
        },
      });
    },

    openRemoveReport(info, report) {
      openRemoveDialog({
        info,
        report,
        agentRows: deps.rowsFor(info.id),
        degradedSources: deps.degradedSources(),
      });
    },

    dispose() {
      closeDialog?.();
      closeDialog = null;
    },
  };
}
