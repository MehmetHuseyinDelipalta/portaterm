// src/webview/worktree/worktreeView/viewTypes.ts — What the Worktree body is
// GIVEN and what it is TOLD, apart from the class that consumes them.
//
// Extracted from `WorktreeView` by change `decompose-worktree-view` (design.md
// D1, task 3_7). The two interfaces are the view's whole contract with its
// controller and reading them meant scrolling past the class that implements
// them.
//
// The TYPES move; the `deps` FIELD does not. `WorktreeController.test.ts` reads
// `view.deps.actions` off the instance, so the class keeps holding it (D5).

import type { BranchDeleteRequest } from "../../../types/messages";
import type { WorktreeMenuActions } from "../WorktreeContextMenu";
import type { WorktreeCreateDialogDeps } from "../WorktreeCreateDialog";
import type { WorktreeLaunchRequest } from "../WorktreeLaunchDialog";
import type {
  WorktreeActionResult,
  WorktreeAgentRow,
  WorktreeInfo,
  WorktreePresence,
  WorktreeRowActivation,
  WorktreeSubagentRow,
  WorktreeTree,
} from "../worktreeViewTypes";

export interface WorktreeViewData {
  tree: WorktreeTree | null;
  presence: WorktreePresence | null;
  /** No tree has ever arrived — the skeleton state, not a spinner in a void. */
  loading?: boolean;
  /** A rebuild is in flight while a tree is already held — keep the tree. */
  refreshing?: boolean;
  /** True when the workspace has no folders at all. */
  noFolder?: boolean;
  /** Outcomes of mutating actions, attached to the row or repo they concern. */
  actionResults?: WorktreeActionResult[];
}

export interface WorktreeViewDeps {
  /** Panel element the dialogs and context menu are positioned within. */
  host: HTMLElement;
  /**
   * The row context menu. Absent → no menu is built and no row listens for one:
   * an action the view cannot perform is absent rather than present and inert.
   */
  actions?: WorktreeMenuActions;
  /**
   * What activating a window-scope row should do. A getter, because the setting
   * is live; absent → `focus`, the manifest default.
   */
  rowActivation?: () => WorktreeRowActivation;
  /**
   * The selection moved. `null` when the selected worktree left the tree — the
   * holder outside needs the drop as much as it needs the pick, or it goes on
   * naming a worktree that is gone.
   */
  onSelectWorktree?: (worktreeId: string | null) => void;
  /** Activating an agent row — focus its pane, or open its preview (§ 6). */
  onActivateAgent?: (row: WorktreeAgentRow, activation: WorktreeRowActivation) => void;
  /** Activating a subagent row targets the PARENT's pane; it has none of its own. */
  onActivateSubagent?: (subagent: WorktreeSubagentRow, parent: WorktreeAgentRow) => void;
  /** Rebuild this repo's listing after a degraded result. */
  onRetryRepo?: (repoId: string) => void;
  /**
   * Open the create form on one repository. Absent → no header offers create:
   * an action the view cannot perform is absent rather than present and inert.
   */
  onCreateForRepo?: (repoId: string) => void;
  /** Drop an action notice the user dismissed. */
  onDismissActionResult?: (result: WorktreeActionResult) => void;
  /** Prune the repo after an indeterminate remove. */
  onPrune?: (repoId: string) => void;
  /** Re-send a remove with `force` and the fingerprint the user was shown. */
  /**
   * The user answered the report. `fingerprint` is what that report carried and
   * nothing more: null means it authorized no force, and the caller sends the
   * ordinary removal (design.md D7).
   *
   * `deleteBranch` is present only when the dialog's opt-in checkbox was
   * ticked — its absence is how "removal only" travels (design.md D1).
   */
  onForceRemove?: (info: WorktreeInfo, fingerprint: string, deleteBranch?: BranchDeleteRequest) => void;
  /**
   * Ask again for an action whose risk could not be READ. Offered only there:
   * a failure already has its answer, and an unclear outcome has state to
   * resolve first — re-running either would be guessing.
   */
  onRetryAction?: (result: WorktreeActionResult) => void;
  onRetrySetup?: (result: WorktreeActionResult) => void;
  onViewSetupOutput?: (result: WorktreeActionResult) => void;
  /**
   * A dialog is being opened. Every opener below calls it, including the
   * blocked notice's own — a guard the controller clears is not cleared when
   * the view is what opened the dialog (round-4 W4, design.md D11).
   */
  onDialogOpened?: () => void;
  /** Seeds the create form; absent → the create affordance does nothing. */
  createDialogDeps?: () => Omit<WorktreeCreateDialogDeps, "onSubmit" | "onCancel">;
  onCreateSubmit?: WorktreeCreateDialogDeps["onSubmit"];
  /** The opening the create form is about to ride, read once as it opens. */
  createOpening?: () => number;
  /**
   * The create conversation ended, by either door.
   *
   * One dep rather than a hook on each exit: a retirement wired into cancel
   * alone leaves a submitted form's authority live, and one wired into submit
   * alone leaves a cancelled form's live forever — which is the case that
   * matters most, because nothing ever reopens to supersede it (design.md D3).
   *
   * Carries the opening rather than letting the owner read its own current one.
   * The owner's token moves when the NEXT form is asked for, and that ask goes
   * out before this form is torn down — so a close resolved at callback time
   * named the successor and retired the form the user was looking at
   * (.reviews/round-1.md B3).
   */
  onCreateClosed?: (opening: number) => void;
  /** What the launch dialog collected, for the worktree it was opened on. */
  onLaunchSubmit?: (request: WorktreeLaunchRequest) => void;
  /**
   * Collapsed repoIds + worktreeIds, restored on open (§ 2.1). `undefined` means
   * nothing was ever persisted, and is NOT the same as `[]` — an empty array is a
   * user who expanded everything, and seeding defaults over it would undo that.
   */
  getInitialCollapsed?: () => string[] | undefined;
  persistCollapsed?: (ids: string[]) => void;
  /**
   * Ask the host what this row's session delegated. Called on the first
   * expansion of each row+session and never again — the roster arrives on the
   * row itself, through the envelope that already carries presence.
   */
  onRequestSubagents?: (row: WorktreeAgentRow) => void;
  /** Expanded agent rowIds — the SECOND disclosure level, persisted separately. */
  getInitialExpandedRows?: () => string[];
  persistExpandedRows?: (ids: string[]) => void;
  getInitialIdleSeeded?: () => string[];
  persistIdleSeeded?: (ids: string[]) => void;
  /** Injected in tests so ages are deterministic. */
  now?: () => number;
}
