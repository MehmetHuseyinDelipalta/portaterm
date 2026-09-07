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
  WebViewToExtensionMessage,
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
import { type AgentActions, createAgentActions } from "./controller/agentActions";
import { buildViewDeps } from "./controller/composeViewDeps";
import type { WorktreeControllerDeps } from "./controller/controllerTypes";
import { type CreateFlow, createCreateFlow } from "./controller/createFlow";
import { createDialogChannels } from "./controller/dialogChannels";
import { createMutationResults, type MutationResults } from "./controller/mutationResults";
import { createTreeReconcile, type TreeReconcile } from "./controller/treeReconcile";
import { createVisibility, type Visibility } from "./controller/visibility";
import type { WorktreeMenuActions } from "./WorktreeContextMenu";
import { WorktreeView } from "./WorktreeView";
import type {
  WorktreeActionResult,
  WorktreeAgentRow,
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

  /**
   * Display paths of rows that have LEFT the tree, so a result arriving after
   * the rebuild that removed its row can still say what it was about.
   *
   * This exists because of the order production actually produces: the

  /** The repository holding `info`, from the tree this controller last rendered. */
  private repoFor(info: WorktreeInfo): { repoId: string; prunableCount: number } | undefined {
    return this.treeReconcile.repoFor(info);
  }

  static mount(deps: WorktreeControllerDeps): WorktreeController {
    return new WorktreeController(deps);
  }

  private constructor(deps: WorktreeControllerDeps) {
    this.deps = deps;
    // No folder means no tree is ever coming, so the skeleton would be a promise
    // the workspace cannot keep.
    this.treeReconcile = createTreeReconcile(
      {
        postMessage: (msg) => deps.postMessage(msg),
        setData: (data) => {
          this.view.setData(data);
        },
        bodyShown: () => this.visibility.bodyShown(),
        emitAttribution: () => {
          this.agentActions.emitAttribution();
        },
        createDefaults: () => this.createDefaults,
        provisionOffers: () => this.provisionOffers,
        repoRefs: () => this.repoRefs,
        dialogChannels: () => this.dialogChannels,
        createFlow: () => this.createFlow,
        actionResults: () => this.actionResults,
        setActionResults: (next) => {
          this.actionResults = next;
        },
        rescope: (result, present) => this.mutationResults.rescope(result, present),
        onCreateAvailability: (available) => deps.onCreateAvailability?.(available),
        noFolder: () => deps.init.workspaceRoot === null,
      },
      deps.init.workspaceRoot !== null,
    );
    this.createFlow = createCreateFlow({
      postMessage: (msg) => deps.postMessage(msg),
      tree: () => this.treeReconcile.tree(),
      repoFor: (info) => this.repoFor(info),
      createDefaults: () => this.createDefaults,
      provisionOffers: () => this.provisionOffers,
      repoRefs: () => this.repoRefs,
      dialogChannels: () => this.dialogChannels,
      launchAgents: () => this.agentActions.launchAgents(),
      launchOfferId: () => this.agentActions.launchOfferId(),
      actionResults: () => this.actionResults,
      setActionResults: (next) => {
        this.actionResults = next;
      },
      openCreateDialog: (initialRepoId) => {
        this.view.openCreateDialog(initialRepoId);
      },
      push: () => {
        this.push();
      },
    });
    this.mutationResults = createMutationResults({
      postMessage: (msg) => deps.postMessage(msg),
      actionResults: () => this.actionResults,
      setActionResults: (next) => {
        this.actionResults = next;
      },
      tree: () => this.treeReconcile.tree(),
      departed: () => this.treeReconcile.departed(),
      infoOf: (worktreeId) => this.infoOf(worktreeId),
      repoFor: (info) => this.repoFor(info),
      openPruneDialog: (seed, onConfirm) => {
        this.view.openPruneDialog(seed, onConfirm);
      },
      openRemoveReport: (info, report) => {
        this.view.openRemoveReport(info, report);
      },
      push: () => {
        this.push();
      },
    });
    this.agentActions = createAgentActions({
      postMessage: (msg) => deps.postMessage(msg),
      onAttribution: (report) => deps.onAttribution?.(report),
      presence: () => this.treeReconcile.presence(),
      infoOf: (worktreeId) => this.infoOf(worktreeId),
      generationOf: (worktreeId) => this.generationOf(worktreeId),
      openLaunchDialog: (title, agents) => {
        this.view.openLaunchDialog(title, agents);
      },
      menuActions: () => this.menuActions,
      push: () => {
        this.push();
      },
    });
    this.visibility = createVisibility({
      postMessage: (msg) => deps.postMessage(msg),
      presenceNeeded: () => deps.presenceNeeded?.(),
      clearPendingCreate: () => {
        this.createFlow.clearPendingCreate();
      },
      refreshing: () => this.treeReconcile.refreshing(),
      abandonRefresh: () => {
        this.treeReconcile.abandonRefresh();
      },
      push: () => {
        this.push();
      },
      awaitingLaunchTargets: () => this.agentActions.awaitingLaunchTargets(),
      noteAwaitingLaunchTargets: () => {
        this.agentActions.noteAwaitingLaunchTargets();
      },
    });
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
        view: () => this.view,
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

  /** Drop the panel's selection — the tab bar's chip clearing its own scope. */
  clearSelection(): void {
    this.view.clearSelection();
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
