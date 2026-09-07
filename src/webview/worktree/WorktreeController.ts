// src/webview/worktree/WorktreeController.ts — The Worktree view's message seam.
// See: docs/design/worktree-rpc.md § 1, § 2;
//      asimov/changes/wire-live-worktree-tree/design.md D2, D3, D4, D5
//
// Owns everything between the host's `worktreeTreeResponse` and `WorktreeView`:
// the visibility declaration that gates every push to this surface, the tree
// request, and the three render states the view cannot derive for itself.
// `main.ts` keeps only the mount call — feature wiring lives with the feature,
// as it does for FileTreeController.

import type {
  VaultLaunchTargetsMessage,
  WorktreeCreateDefaultsMessage,
  WorktreeCreateResolutionMessage,
  WorktreeDebrisAuthorizedMessage,
  WorktreeDestinationPickedMessage,
  WorktreeMigrationOfferMessage,
  WorktreeMutationResultMessage,
  WorktreeProvisionOfferMessage,
  WorktreeProvisionResultMessage,
  WorktreePullRequestsMessage,
  WorktreeRefsMessage,
  WorktreeRemoveAssessmentMessage,
  WorktreeTreeResponseMessage,
} from "../../types/messages";
import type { VaultView } from "../vault/VaultPanel";
import type { AgentActions } from "./controller/agentActions";
import { createCollaborators } from "./controller/composeCollaborators";
import { buildViewDeps } from "./controller/composeViewDeps";
import type { WorktreeControllerDeps } from "./controller/controllerTypes";
import type { CreateFlow } from "./controller/createFlow";
import { createDialogChannels } from "./controller/dialogChannels";
import { worktreeMenuActions } from "./controller/menuActions";
import type { MutationResults } from "./controller/mutationResults";
import type { TreeReconcile } from "./controller/treeReconcile";
import type { Visibility } from "./controller/visibility";
import type { WorktreeMenuActions } from "./WorktreeContextMenu";
import { WorktreeView } from "./WorktreeView";
import type {
  WorktreeActionResult,
  WorktreeCreateDefaults,
  WorktreeInfo,
  WorktreeRowActivation,
} from "./worktreeViewTypes";

// The controller's contract lives in `controller/controllerTypes.ts` (task
// 3_1 of `decompose-worktree-view`). Re-exported here so no importer moves —
// and imported too, because a re-export is not a local binding.
export type { WorktreeControllerDeps, WorktreeStateStore } from "./controller/controllerTypes";

/**
 * Which body the panel opens on (§ 2.2). A recorded choice always wins; with
 * none, a workspace holding no repository would open on a permanently empty
 * view, which reads as a broken panel rather than a default.
 *
 * The derived answer is never written back, so a workspace that later gains a
 * repository opens on the Worktree body without the user having to ask.
 */
export function resolveInitialView(persisted: VaultView | undefined, hasRepo: boolean): VaultView {
  return persisted ?? (hasRepo ? "worktree" : "sessions");
}

// The menu builder lives in `controller/menuActions.ts` (task 3_15). Re-exported
// here so `main.ts` and three suites keep their import path (D4).
export { worktreeMenuActions } from "./controller/menuActions";

export class WorktreeController {
  /** The tree element — goes into `VaultPanel`'s `worktreeBody`. */
  readonly element: HTMLElement;

  private readonly deps: WorktreeControllerDeps;
  private readonly view: WorktreeView;
  /** Whether the panel is showing this body, and what that subscribes to (3_2). */
  private readonly visibility: Visibility;
  /** The tree that arrived, what it replaced, and the push that follows (3_6). */
  private readonly treeReconcile: TreeReconcile;
  private rowActivation: WorktreeRowActivation;
  /** The host's resolved create destination, per repo. Only it can know one. */
  private readonly createDefaults = new Map<string, WorktreeCreateDefaultsMessage>();
  /**
   * The host's provisioning offer, per repo.
   *
   * Held apart from `createDefaults` because the host issues ONE offer per form
   * and answers the defaults per keystroke — folding the offer into that reply
   * would either re-mint it on every character or drop it on the second answer.
   */
  private readonly provisionOffers = new Map<string, WorktreeProvisionOfferMessage>();
  /**
   * The repository's local branches, per repo.
   *
   * Held apart from `createDefaults` for the same reason the offer is: the host
   * answers this once per form and the destination per settled edit, so folding
   * it in would either re-ship the whole list per keystroke or drop it on the
   * second answer.
   */
  private readonly repoRefs = new Map<string, WorktreeRefsMessage>();
  /** Opening a create, and the answers one form waits on (3_5). */
  private readonly createFlow: CreateFlow;
  /**
   * Every answer channel the open create form binds.
   *
   * Never unbound: an answer that outlived its dialog is dropped by the token
   * guard in each handler below, not by clearing a sink.
   */
  private readonly dialogChannels = createDialogChannels();
  /** Notices the panel is showing, newest last, one per scope+verb. */
  private actionResults: WorktreeActionResult[] = [];
  /** Launching, resuming, and where each pane is (3_3). */
  private readonly agentActions: AgentActions;

  /** Held rather than passed: the two launch items appear only once one can act. */
  private readonly menuActions: WorktreeMenuActions;

  /** What a finished mutation says, and the assess asked before one runs (3_4). */
  private readonly mutationResults: MutationResults;

  /** The repository holding `info`, from the tree this controller last rendered. */
  private repoFor(info: WorktreeInfo): { repoId: string; prunableCount: number } | undefined {
    return this.treeReconcile.repoFor(info);
  }

  static mount(deps: WorktreeControllerDeps): WorktreeController {
    return new WorktreeController(deps);
  }

  private constructor(deps: WorktreeControllerDeps) {
    this.deps = deps;
    const collaborators = createCollaborators({
      options: deps,
      view: () => this.view,
      menuActions: () => this.menuActions,
      createDefaults: this.createDefaults,
      provisionOffers: this.provisionOffers,
      repoRefs: this.repoRefs,
      dialogChannels: this.dialogChannels,
      actionResults: () => this.actionResults,
      setActionResults: (next) => {
        this.actionResults = next;
      },
      infoOf: (worktreeId) => this.infoOf(worktreeId),
      generationOf: (worktreeId) => this.generationOf(worktreeId),
      push: () => {
        this.push();
      },
    });
    this.treeReconcile = collaborators.treeReconcile;
    this.createFlow = collaborators.createFlow;
    this.mutationResults = collaborators.mutationResults;
    this.agentActions = collaborators.agentActions;
    this.visibility = collaborators.visibility;
    this.menuActions = worktreeMenuActions(
      (msg) => deps.postMessage(msg),
      (info) => this.repoFor(info),
      (info) => this.openCreateFor(info),
      (repoId) => this.confirmPrune(repoId),
      undefined,
      undefined,
      (worktreeId) => this.mutationResults.beginAssess(worktreeId),
    );
    // Always wired, unlike `resumeHere`: the capture is what makes the menu's
    // own view of the tree authoritative, and it must happen even on an open
    // that offers no resume, so a later one cannot inherit an older capture.
    this.menuActions.captureTarget = (row) => this.agentActions.captureMenuTarget(row);
    // No folder means no tree is ever coming, so the skeleton would be a promise
    // the workspace cannot keep.
    this.rowActivation = deps.init.rowActivation;
    this.view = new WorktreeView(
      buildViewDeps({
        host: deps.host,
        postMessage: (msg) => deps.postMessage(msg),
        store: deps.store,
        ...(deps.now === undefined ? {} : { now: deps.now }),
        ...(deps.onSelectWorktree === undefined ? {} : { onSelectWorktree: deps.onSelectWorktree }),
        menuActions: this.menuActions,
        createFlow: this.createFlow,
        dialogChannels: this.dialogChannels,
        agentActions: this.agentActions,
        mutationResults: this.mutationResults,
        actionResults: () => this.actionResults,
        setActionResults: (next) => {
          this.actionResults = next;
        },
        rowActivation: () => this.rowActivation,
        push: () => {
          this.push();
        },
        openCreateForRepo: (repoId, sourceWorktreeId) => {
          this.openCreateForRepo(repoId, sourceWorktreeId);
        },
        createRepos: () => this.createRepos(),
        confirmPrune: (repoId) => {
          this.confirmPrune(repoId);
        },
      }),
    );
    this.element = document.createElement("div");
    this.element.className = "wt-body";
    this.element.append(this.view.element);
    this.push();
  }

  /**
   * Declare whether this surface is showing the view, and ask for the tree on the
   * way in. The host sends nothing to a surface that has not declared it visible,
   * so this is what starts and stops the flow — nothing polls.
   */
  setVisible(visible: boolean): void {
    this.visibility.setVisible(visible);
  }

  /**
   * Recompute the subscription from the panel's request and the current scope.
   * For the edge the panel cannot see: a scope set or cleared while the rail's
   * own state has not moved.
   */
  revalidateVisibility(): void {
    this.visibility.revalidateVisibility();
  }

  /** Toolbar refresh: rebuild the listings rather than re-serve the cache. */
  requestRefresh(): void {
    this.treeReconcile.requestRefresh();
  }

  /** Filter the tree by branch, path, and agent title. */
  setQuery(query: string): void {
    this.view.setQuery(query);
  }
  /** The header door, and the row door that resolves a repository first. */
  private openCreateFor(info: WorktreeInfo): void {
    this.createFlow.openCreateFor(info);
  }

  /**
   * Ask where a create would go, then open the form on the answer. With a
   * repository, that one; without, every repository in the tree — a door that
   * names none must offer them all rather than pick one for the user.
   */
  openCreateForRepo(repoId?: string, sourceWorktreeId?: string): void {
    this.createFlow.openCreateForRepo(repoId, sourceWorktreeId);
  }

  /** The toolbar door, which names no repository. */
  openCreate(): void {
    this.createFlow.openCreate();
  }

  /** Open prune's confirmation, and post only what the user confirmed there. */
  private confirmPrune(repoId: string): void {
    this.mutationResults.confirmPrune(repoId);
  }

  /**
   * The launch offer for one worktree, or `undefined` when there is none to make.
   *
   * Gate and action are one value on purpose: a caller that has to ask whether
   * launching is possible before offering it can render the offer inert, which is
   * the one thing `syncLaunchActions` already refuses to do (design.md D4).
   */
  launchOfferFor(worktreeId: string): (() => void) | undefined {
    return this.agentActions.launchOfferFor(worktreeId);
  }

  /** The host's answer to "which agents can start a fresh session here". */
  handleLaunchTargets(msg: VaultLaunchTargetsMessage): void {
    this.agentActions.handleLaunchTargets(msg);
  }

  private infoOf(worktreeId: string): WorktreeInfo | undefined {
    return this.treeReconcile.infoOf(worktreeId);
  }

  /** The registration token the tree currently publishes for this worktree. */
  private generationOf(worktreeId: string): number | undefined {
    return this.treeReconcile.generationOf(worktreeId);
  }

  /** Every repo the host has answered for, as the form's seed. */
  private createRepos(): WorktreeCreateDefaults[] {
    return this.createFlow.createRepos();
  }

  handleMigrationOffer(msg: WorktreeMigrationOfferMessage): void {
    this.createFlow.handleMigrationOffer(msg);
  }

  /** The host's provisioning offer for one repo, stored and pushed into the form. */
  handleProvisionOffer(msg: WorktreeProvisionOfferMessage): void {
    this.createFlow.handleProvisionOffer(msg);
  }

  /** The host's branch list for one repo, stored and pushed into the form. */
  handleRefs(msg: WorktreeRefsMessage): void {
    this.createFlow.handleRefs(msg);
  }

  /** The host's pull-request answer for one repo, on the same token as the refs. */
  handlePullRequests(msg: WorktreePullRequestsMessage): void {
    this.createFlow.handlePullRequests(msg);
  }

  /** What the host says a create against the settled selection would do. */
  handleCreateResolution(msg: WorktreeCreateResolutionMessage): void {
    this.createFlow.handleCreateResolution(msg);
  }

  /** The host's answer to the form's request to clear a directory. */
  handleDebrisAuthorized(msg: WorktreeDebrisAuthorizedMessage): void {
    this.createFlow.handleDebrisAuthorized(msg);
  }

  /** The folder the user picked in the host's dialog. */
  handleDestinationPicked(msg: WorktreeDestinationPickedMessage): void {
    this.createFlow.handleDestinationPicked(msg);
  }

  /**
   * The resolution currently held for a repository, if one has landed.
   *
   * Held for the ANSWER's own lifecycle — supersession and the reopen that
   * clears it — and read by nothing that builds a request: the submission
   * carries the classification the form was showing (round-3 B3).
   */
  resolutionFor(repoId: string): WorktreeCreateResolutionMessage | undefined {
    return this.createFlow.resolutionFor(repoId);
  }

  /** The host's create destination for one repo, and the form it was asked for. */
  handleCreateDefaults(msg: WorktreeCreateDefaultsMessage): void {
    this.createFlow.handleCreateDefaults(msg);
  }

  /**
   * What a mutation this surface started actually did. One notice per scope and
   * verb: a second attempt replaces the first rather than stacking, because the
   * older result no longer describes the tree.
   */
  handleMutationResult(msg: WorktreeMutationResultMessage): void {
    this.mutationResults.handleMutationResult(msg);
  }

  /** What provisioning did, folded onto the create notice that is already there. */
  handleProvisionResult(msg: WorktreeProvisionResultMessage): void {
    this.mutationResults.handleProvisionResult(msg);
  }

  /** What the removal WOULD cost, answered before anything is deleted (D6). */
  handleRemoveAssessment(msg: WorktreeRemoveAssessmentMessage): void {
    this.mutationResults.handleRemoveAssessment(msg);
  }

  /** A reply and an unsolicited push are the same message, handled the same way. */
  handleTreeResponse(msg: WorktreeTreeResponseMessage): void {
    this.treeReconcile.handleTreeResponse(msg);
  }

  /**
   * The halves of an action the extension cannot perform, answered back here
   * (D2). Neither is a request the view raised on its own behalf: the host
   * resolved the id first, and a surface that does not hold it does nothing —
   * silently, because the surface that DOES hold it was sent the same message.
   */
  showPreview(entryId: string): void {
    this.deps.showPreview?.(entryId);
  }

  activatePane(paneId: string): void {
    this.deps.activatePane?.(paneId);
  }

  /** The setting moved after `init`. Nothing re-renders — the next click reads it. */
  setRowActivation(activation: WorktreeRowActivation): void {
    this.rowActivation = activation;
  }

  /** The worktree the panel has selected, or `null` for none. */
  selectedWorktree(): string | null {
    return this.view.selectedWorktree();
  }

  /** Drop the panel's selection. */
  clearSelection(): void {
    this.view.clearSelection();
  }

  /** Follow a newly created terminal to its stable main-or-linked owner. */
  selectTerminalOwner(worktreeId?: string): void {
    this.view.selectTerminalOwner(worktreeId);
  }

  /**
   * The tab bar dropped its scope because the worktree left the tree. Reported
   * through the panel's own notice list — the one place this panel says what
   * happened — rather than a second channel the user has to learn (design.md D7).
   */
  reportScopeCleared(worktreeId: string, label: string): void {
    this.mutationResults.reportScopeCleared(worktreeId, label);
  }

  /**
   * The same statement, without the repaint. The seam stages it before handing the
   * tree over, so ONE push carries the notice and the tree that caused it — the
   * notice is never painted beside the row it contradicts, and the panel is not
   * rebuilt twice for one event (round-2 V5).
   */
  stageScopeCleared(worktreeId: string, label: string): void {
    this.mutationResults.stageScopeCleared(worktreeId, label);
  }

  dispose(): void {
    this.view.dispose();
  }

  private push(): void {
    this.treeReconcile.push();
  }
}
