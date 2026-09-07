// src/webview/worktree/controller/composeCollaborators.ts — The five
// collaborators the controller is made of, and the wiring that joins them.
//
// Extracted from `WorktreeController`'s constructor by change
// `decompose-worktree-view` (design.md D1, task 3_15). Each collaborator was
// cut out to its own module in tasks 3_2 through 3_6, but their ~100 lines of
// mutual wiring stayed behind, which left the facade a composition root that
// still knew every collaborator's dependency list.
//
// They are built in one pass into a record each one reads back through: the
// callbacks are all lazy, so a collaborator constructed first may still call
// one constructed after it — which is what `treeReconcile` needs from
// `createFlow`, and `createFlow` needs back from `treeReconcile`.

import type {
  WorktreeCreateDefaultsMessage,
  WorktreeProvisionOfferMessage,
  WorktreeRefsMessage,
} from "../../../types/messages";
import type { WorktreeMenuActions } from "../WorktreeContextMenu";
import type { WorktreeView } from "../WorktreeView";
import type { WorktreeActionResult, WorktreeInfo } from "../worktreeViewTypes";
import { type AgentActions, createAgentActions } from "./agentActions";
import type { WorktreeControllerDeps } from "./controllerTypes";
import { type CreateFlow, createCreateFlow } from "./createFlow";
import type { createDialogChannels } from "./dialogChannels";
import { createMutationResults, type MutationResults } from "./mutationResults";
import { createTreeReconcile, type TreeReconcile } from "./treeReconcile";
import { createVisibility, type Visibility } from "./visibility";

/** The five collaborators, in the order they are constructed. */
export interface Collaborators {
  treeReconcile: TreeReconcile;
  createFlow: CreateFlow;
  mutationResults: MutationResults;
  agentActions: AgentActions;
  visibility: Visibility;
}

/**
 * What the collaborators need from the facade that is NOT one of them: the
 * controller's own options, the state it holds, and the two things built after
 * this call — the view and the menu — which arrive as accessors for that reason.
 */
export interface CollaboratorSeam {
  options: WorktreeControllerDeps;
  /** Built from these collaborators, so read at call time, never at wiring time. */
  view(): WorktreeView;
  menuActions(): WorktreeMenuActions;
  createDefaults: Map<string, WorktreeCreateDefaultsMessage>;
  provisionOffers: Map<string, WorktreeProvisionOfferMessage>;
  repoRefs: Map<string, WorktreeRefsMessage>;
  dialogChannels: ReturnType<typeof createDialogChannels>;
  actionResults(): WorktreeActionResult[];
  setActionResults(next: WorktreeActionResult[]): void;
  infoOf(worktreeId: string): WorktreeInfo | undefined;
  generationOf(worktreeId: string): number | undefined;
  push(): void;
}

export function createCollaborators(seam: CollaboratorSeam): Collaborators {
  const deps = seam.options;
  const post = (msg: Parameters<WorktreeControllerDeps["postMessage"]>[0]): void => {
    deps.postMessage(msg);
  };
  const setActionResults = (next: WorktreeActionResult[]): void => {
    seam.setActionResults(next);
  };
  const push = (): void => {
    seam.push();
  };
  // Filled in below and read only through the closures, all of which run after
  // this function returns.
  const built = {} as Collaborators;

  // No folder means no tree is ever coming, so the skeleton would be a promise
  // the workspace cannot keep.
  built.treeReconcile = createTreeReconcile(
    {
      postMessage: post,
      setData: (data) => {
        seam.view().setData(data);
      },
      bodyShown: () => built.visibility.bodyShown(),
      emitAttribution: () => {
        built.agentActions.emitAttribution();
      },
      createDefaults: () => seam.createDefaults,
      provisionOffers: () => seam.provisionOffers,
      repoRefs: () => seam.repoRefs,
      dialogChannels: () => seam.dialogChannels,
      createFlow: () => built.createFlow,
      actionResults: () => seam.actionResults(),
      setActionResults,
      rescope: (result, present) => built.mutationResults.rescope(result, present),
      onCreateAvailability: (available) => deps.onCreateAvailability?.(available),
      noFolder: () => deps.init.workspaceRoot === null,
    },
    deps.init.workspaceRoot !== null,
  );

  built.createFlow = createCreateFlow({
    postMessage: post,
    tree: () => built.treeReconcile.tree(),
    repoFor: (info) => built.treeReconcile.repoFor(info),
    createDefaults: () => seam.createDefaults,
    provisionOffers: () => seam.provisionOffers,
    repoRefs: () => seam.repoRefs,
    dialogChannels: () => seam.dialogChannels,
    launchAgents: () => built.agentActions.launchAgents(),
    launchOfferId: () => built.agentActions.launchOfferId(),
    actionResults: () => seam.actionResults(),
    setActionResults,
    openCreateDialog: (initialRepoId) => {
      seam.view().openCreateDialog(initialRepoId);
    },
    push,
  });

  built.mutationResults = createMutationResults({
    postMessage: post,
    actionResults: () => seam.actionResults(),
    setActionResults,
    tree: () => built.treeReconcile.tree(),
    departed: () => built.treeReconcile.departed(),
    infoOf: (worktreeId) => seam.infoOf(worktreeId),
    repoFor: (info) => built.treeReconcile.repoFor(info),
    openPruneDialog: (seed, onConfirm) => {
      seam.view().openPruneDialog(seed, onConfirm);
    },
    openRemoveReport: (info, report) => {
      seam.view().openRemoveReport(info, report);
    },
    push,
  });

  built.agentActions = createAgentActions({
    postMessage: post,
    onAttribution: (report) => deps.onAttribution?.(report),
    presence: () => built.treeReconcile.presence(),
    infoOf: (worktreeId) => seam.infoOf(worktreeId),
    generationOf: (worktreeId) => seam.generationOf(worktreeId),
    openLaunchDialog: (title, agents) => {
      seam.view().openLaunchDialog(title, agents);
    },
    menuActions: () => seam.menuActions(),
    push,
  });

  built.visibility = createVisibility({
    postMessage: post,
    presenceNeeded: () => deps.presenceNeeded?.(),
    clearPendingCreate: () => {
      built.createFlow.clearPendingCreate();
    },
    refreshing: () => built.treeReconcile.refreshing(),
    abandonRefresh: () => {
      built.treeReconcile.abandonRefresh();
    },
    push,
    awaitingLaunchTargets: () => built.agentActions.awaitingLaunchTargets(),
    noteAwaitingLaunchTargets: () => {
      built.agentActions.noteAwaitingLaunchTargets();
    },
  });

  return built;
}
