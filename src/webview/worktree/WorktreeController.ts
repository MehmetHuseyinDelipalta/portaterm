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
  ResolvedMode,
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
  WorktreeCreateMode,
  WorktreeInfo,
  WorktreeOpenAfter,
  WorktreeProvisionOffer,
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

/**
 * The create the form resolved onto a directory that already exists, or nothing
 * where it resolved something else.
 *
 * Both modes that act on a surviving directory, because the fallback below is
 * `reuse` — which would check the branch out somewhere ELSE and leave the
 * directory the form named untouched.
 */
function repairOf(resolved: ResolvedMode | undefined, branch: string): WorktreeCreateMode | undefined {
  if (resolved?.kind === "reattach") {
    return { kind: "reattach", branch, repairPath: resolved.repairPath, expectedOid: resolved.expectedOid };
  }
  if (resolved?.kind === "adopt") {
    return { kind: "adopt", branch, adoptPath: resolved.adoptPath, expectedBranchOid: resolved.expectedBranchOid };
  }
  return undefined;
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
    this.view = new WorktreeView({
      host: deps.host,
      // Both launch items start absent: nothing here can launch until the host
      // has answered which agents can, and an item that opens an empty picker
      // is the inert rendering the panel spec forbids.
      actions: this.menuActions,
      // The header door. Supplied unconditionally: unlike the launch items, a
      // create is always performable where a repository exists, and the header
      // it hangs on is only rendered where one does.
      onCreateForRepo: (repoId) => this.openCreateForRepo(repoId),
      // The form's seed is the HOST's answer, never a path derived here: the
      // spec says a create names the destination it will actually use, and only
      // the host knows the configured root and which candidates are free.
      createDialogDeps: () => {
        const opening = this.createFlow.refsToken();
        return {
          // Snapshotted where the form is COMPOSED, not read where a callback
          // fires. `openCreate` advances the opening before the successor dialog
          // exists and the predecessor stays live until its defaults land, so a
          // callback reading the current opening at click time names the
          // successor — the same trap `onCreateClosed` already avoids by taking
          // the opening from the view (round-1 B3, round-1 F002).
          repos: this.createRepos(),
          // The destination depends on the branch, so every settled branch edit
          // re-asks and the answer replaces the seed in place (round-3 B12).
          onSelectionChange: (selection) => {
            const source = this.createFlow.createSource();
            deps.postMessage({
              type: "requestWorktreeCreateDefaults",
              repoId: selection.repoId,
              opening: this.createFlow.refsToken(),
              branch: selection.branch,
              ...(source?.repoId === selection.repoId
                ? {
                    sourceWorktreeId: source.worktreeId,
                    ...(source.generation === undefined ? {} : { sourceGeneration: source.generation }),
                  }
                : {}),
            });
            // The same settled edit, asked as the other question: the defaults
            // answer where a create would GO, and this one answers what it would
            // DO. Both ride the opening's token, because `repoId` names a
            // repository and not an opening (design.md D1).
            //
            // The WHOLE selection, forwarded field for field. A base or a
            // destination the form holds but never posts is a field the host's
            // answer cannot be about, and `baseValid` would then only ever exist
            // in tests that inject it (round-3 B4).
            deps.postMessage({
              type: "worktreeCreateProbe",
              repoId: selection.repoId,
              token: this.createFlow.refsToken(),
              seq: this.createFlow.nextProbeSeq(),
              query: selection.branch,
              ...(selection.base === undefined ? {} : { base: selection.base }),
              ...(selection.candidatePath === undefined ? {} : { candidatePath: selection.candidatePath }),
              ...(selection.useChosenFolder === undefined ? {} : { useChosenFolder: selection.useChosenFolder }),
            });
          },
          bindDefaults: (apply) => {
            this.dialogChannels.defaults.bind(apply);
          },
          bindProvisioning: (apply) => {
            this.dialogChannels.provisioning.bind(apply);
          },
          bindMigration: (apply) => {
            this.dialogChannels.migration.bind(apply);
          },
          // A source the HOST detected, named by id. The message carries no file,
          // no path and no model — the host re-resolves that provider itself, and
          // the fresh offer comes back through `bindProvisioning` (design.md D5).
          onProvisionSwitch: (request) => {
            deps.postMessage({
              type: "worktreeProvisionSwitch",
              repoId: request.repoId,
              // The opening this form was composed in, the same one every other
              // request from it rides. A switch naming a retired opening is not
              // honoured, which is what stops a dismissed form redrawing.
              opening: this.createFlow.refsToken(),
              switch: request.switch,
              provider: request.provider as WorktreeProvisionOffer["model"]["providers"][number]["id"],
            });
          },
          // Pathless by contract: the host owns both the system picker and the
          // safely held file it returns. Capture this form's opening here rather
          // than reading the successor's token when the callback fires.
          onCopyFileAsk: (request) => {
            deps.postMessage({
              type: "worktreeCopyFileAsk",
              repoId: request.repoId,
              opening,
              switch: request.switch,
            });
          },
          // An operation and the host's own ids, never text: the command is
          // typed into the host's input and comes back inside a fresh offer
          // through `bindProvisioning` (add-a-setup-step-for-this-create-only D1).
          onSetupStepAsk: (request) => {
            deps.postMessage({
              type: "worktreeSetupStepAsk",
              repoId: request.repoId,
              // The compose-time opening, like every other request from this
              // form; a predecessor reading the current token would name its
              // successor (design.md D5).
              opening,
              switch: request.switch,
              op: request.op,
            });
          },
          // The user's selection, named by the host's own ids against the offer
          // that issued them. No path and no key: the host derives the file it
          // writes and the root it writes under from its own cache, and the
          // message's `repoId` selects a record rather than becoming a
          // destination (design.md D1).
          onProvisionSave: (request) => {
            deps.postMessage({
              type: "worktreeProvisionSave",
              repoId: request.repoId,
              // The opening this form was composed in, like every other request
              // from it. A save naming a retired opening is not honoured, which
              // is what stops a dismissed form writing.
              opening: this.createFlow.refsToken(),
              switch: request.switch,
              offerId: request.offerId,
              kept: request.kept,
            });
          },
          bindPullRequests: (apply) => {
            this.dialogChannels.pullRequests.bind(apply);
          },
          bindRefs: (apply) => {
            this.dialogChannels.refs.bind(apply);
          },
          bindResolution: (apply) => {
            this.dialogChannels.resolution.bind(apply);
          },
          // Its own request, sent only when the user accepts the recover offer —
          // the probe is answered per settled edit, so a token riding it would be
          // one nobody asked for (design.md D6).
          onAuthorizeDebris: ({ repoId, ask, path }) => {
            deps.postMessage({
              type: "worktreeAuthorizeDebris",
              repoId,
              token: this.createFlow.refsToken(),
              ask,
              path,
            });
          },
          bindDebrisAuthorization: (apply) => {
            this.dialogChannels.debrisAuthorization.bind(apply);
          },
          // The opening rides here the way every other create request's does, so
          // the form states no identity of its own (design.md D2).
          onPickDestination: ({ repoId, ask }) => {
            // The form's own ask, forwarded the way `probeSeq` is: which pick
            // this is belongs to the form that opened it, not to this controller.
            deps.postMessage({ type: "worktreePickDestination", repoId, token: opening, ask });
          },
          bindDestinationPicked: (apply) => {
            this.dialogChannels.destinationPicked.bind(opening, apply);
          },
        };
      },
      onLaunchSubmit: (request) => {
        const frozen = this.agentActions.frozenLaunch();
        if (frozen === null) {
          return;
        }
        deps.postMessage({
          type: "worktreeLaunchAgent",
          worktreeId: frozen.worktreeId,
          ...request,
          ...(frozen.offerId === undefined ? {} : { offerId: frozen.offerId }),
          ...(frozen.generation === undefined ? {} : { generation: frozen.generation }),
        });
        this.agentActions.clearFrozenLaunch();
      },
      onDismissActionResult: (result) => {
        this.actionResults = this.actionResults.filter((r) => r !== result);
        this.push();
      },
      onForceRemove: (info, fingerprint, deleteBranch) => {
        deps.postMessage({
          type: "worktreeRemove",
          worktreeId: info.id,
          fingerprint,
          ...(deleteBranch === undefined ? {} : { deleteBranch }),
        });
      },
      onPrune: (repoId) => this.confirmPrune(repoId),
      // Only `unavailable` reaches here — the read failed, so asking again is
      // the whole remedy. It re-ASKS: retrying with a removal would be a second
      // door onto the very deletion D6 closed, reached from the one outcome
      // where nothing about the worktree's risk is known at all.
      onRetryAction: (result) => {
        if (result.worktreeId !== undefined) {
          this.mutationResults.askRemoval(result.worktreeId);
        }
      },
      onRetrySetup: (result) => {
        if (result.worktreeId !== undefined && result.setupRetryId !== undefined) {
          deps.postMessage({ type: "worktreeSetupRetry", worktreeId: result.worktreeId, retryId: result.setupRetryId });
        }
      },
      onViewSetupOutput: (result) => {
        if (result.setupOutputId !== undefined) {
          deps.postMessage({ type: "worktreeSetupViewOutput", outputId: result.setupOutputId });
        }
      },
      // Any dialog opening retires the outstanding assess: what the user is
      // looking at now is the answer to a newer question, and the view's own
      // blocked-notice opener is why this cannot be a controller-local guard
      // (D11).
      onDialogOpened: () => {
        this.mutationResults.retireAssess();
      },
      /** The opening the form being opened right now will ride (D1). */
      createOpening: () => this.createFlow.refsToken(),
      // Every door of the create form, and the only signal the host has that
      // the conversation ended. The opening comes from the view, which captured
      // it when the form opened — reading `refsToken` here instead named
      // whatever opening had been asked for most recently, which during the
      // window between asking for a new form and that form arriving is the
      // SUCCESSOR (round-1 B3).
      onCreateClosed: (opening: number) => {
        this.deps.postMessage({ type: "worktreeCreateClosed", opening });
        // Posting the retirement is not the same as ceasing to honour the
        // opening. A reply the host had already sent when the close reached it
        // still carries the retired number, and a token comparison alone let it
        // into a cache for a form that no longer exists (.reviews/round-1.md
        // B6). Advancing the counter is what makes every EXISTING guard reject
        // it — refs, resolutions, probe and debris as well as the two this
        // change added, which is the panel's half of D5's one-token-one-
        // retirement rule. No second predicate to keep in step, and the number
        // stays monotonic, which is what the host's high-water mark relies on.
        //
        // Only when the form that closed is the one still being served. A
        // superseded form is torn down AFTER its successor's requests have gone
        // out — the panel asks for the new opening, and the old dialog is
        // replaced when the answer arrives — so advancing on its teardown would
        // retire the successor and drop the live form's replies. The same guard
        // the host applies to a close naming an opening it no longer holds.
        this.createFlow.retireOpening(opening);
      },
      // Create's shipped entry path. The dialog has existed since WT-002.1 and
      // nothing ever submitted it anywhere (round-1 B1); this is where the
      // draft becomes the request the host validates.
      onCreateSubmit: (draft) => {
        // An agent mode with nothing behind it would ask the host for a launch
        // it must refuse, so the mode is dropped rather than posted.
        if (draft.openAfter === "agent" && draft.agentId === undefined) {
          return;
        }
        // An OPTIONAL field left blank must be absent, not empty: git reads an
        // explicit "" as a ref and fails with `fatal: invalid reference:`, so
        // the ordinary new-branch create would never have worked (round-3 B11).
        const baseRef = draft.baseRef.trim();
        const branch = draft.branchName.trim();
        if (draft.branchMode !== "detached" && branch.length === 0) {
          return;
        }
        // The form has always known which of its three branch modes the user
        // picked; until the mode union it had nowhere on the wire to say so,
        // and the host inferred it from which optional fields were filled in.
        const mode: WorktreeCreateMode =
          draft.branchMode === "detached"
            ? // `fresh-detached` requires the ref, so the default lands here
              // rather than in the host — the type is what insists on it.
              { kind: "fresh-detached", baseRef: baseRef.length > 0 ? baseRef : "HEAD" }
            : draft.branchMode === "new"
              ? { kind: "fresh", branch, ...(baseRef.length > 0 ? { baseRef } : {}) }
              : // The classification the FORM was showing, carried on the draft.
                // Re-reading this controller's own map was a second
                // interpretation of one answer, and the two could name
                // different paths (round-3 B3).
                (repairOf(draft.resolved, branch) ?? { kind: "reuse", branch });
        deps.postMessage({
          type: "worktreeCreate",
          repoId: draft.repoId,
          // The opening this form was composed in. Posted BEFORE the retirement
          // that `onCreateClosed` sends, on the same ordered channel, so the one
          // legitimate submit still passes the host's equality check.
          opening: this.createFlow.refsToken(),
          path: draft.path,
          mode,
          // The disposition the FORM settled on, carried on the draft for the
          // same reason the mode is: re-deriving it here would be a second
          // interpretation of one answer, and this one authorizes a delete.
          // Absent means free — a recover the user never accepted is not one.
          disposition: draft.disposition ?? { kind: "free" },
          // Ids only, resolved host-side against the model it displayed.
          ...(draft.provision === undefined ? {} : { provision: draft.provision }),
          ...(draft.migrateChanges === undefined ? {} : { migrateChanges: draft.migrateChanges }),
          // The launch details travel with the agent variant and with no other —
          // the union is what makes any other pairing unrepresentable.
          afterCreate:
            draft.openAfter === "agent" && draft.agentId !== undefined
              ? {
                  kind: "agent",
                  waitForSetup: draft.waitForSetup ?? false,
                  agent: draft.agentId,
                  ...(draft.permissionChoiceId === undefined ? {} : { permissionChoiceId: draft.permissionChoiceId }),
                  ...(draft.prompt === undefined ? {} : { prompt: draft.prompt }),
                  ...(this.createFlow.frozenCreateOffer()?.offerId === undefined
                    ? {}
                    : { offerId: this.createFlow.frozenCreateOffer()?.offerId }),
                }
              : { kind: draft.openAfter as Exclude<WorktreeOpenAfter, "agent"> },
        });
      },
      getInitialCollapsed: () => deps.store.getState().worktreeCollapsed,
      persistCollapsed: (ids) => deps.store.updateState({ worktreeCollapsed: ids }),
      getInitialExpandedRows: () => deps.store.getState().worktreeExpandedRows ?? [],
      persistExpandedRows: (ids) => deps.store.updateState({ worktreeExpandedRows: ids }),
      getInitialIdleSeeded: () => deps.store.getState().worktreeIdleTailSeeded ?? [],
      persistIdleSeeded: (ids) => deps.store.updateState({ worktreeIdleTailSeeded: ids }),
      // The reply is the next tree+presence envelope, carrying the roster on the
      // row itself — there is no response message to correlate here.
      onRequestSubagents: (row) => this.agentActions.requestRoster(row),
      // Ids only — the host resolves them against its own tree and presence, so
      // a path or session the view guessed can never reach an action (D2).
      onActivateAgent: (row, activation) => this.agentActions.activateAgent(row, activation),
      // A subagent has no pane of its own, so its activation is the PARENT's —
      // sending the user anywhere else would be a dead click (design.md D9).
      onActivateSubagent: (_subagent, parent) => this.agentActions.activateSubagentParent(parent),
      // A getter, not a value: the setting is live, and re-reading it at the
      // click is what lets an update reach a view already painted.
      rowActivation: () => this.rowActivation,
      // Forwarded, not mirrored: the view owns the selection because the view is
      // what marks it, and a second copy here is a second thing to keep right.
      onSelectWorktree: (worktreeId) => this.deps.onSelectWorktree?.(worktreeId),
      now: deps.now,
    });
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
