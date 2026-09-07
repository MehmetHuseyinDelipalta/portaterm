// src/webview/worktree/controller/composeCreateDialogDeps.ts — What the create
// form is handed when it opens, and the seam every one of those callbacks reads
// through.
//
// Extracted from `WorktreeController`'s constructor by change
// `decompose-worktree-view` (task 3_14). After the six collaborators moved out,
// the class was still 937 lines because the `new WorktreeView({...})` literal
// was 454 of them — the residue D1's arithmetic did not carry.
//
// The OBJECT GRAPH is unchanged: `createDialogDeps()` returns the same contract
// with the same fields, and `view.deps` still holds one object. Only where the
// literal is written moved. That is what D5 pins and what this preserves.
//
// The seam lives here rather than beside `buildViewDeps` so the dependency runs
// one way: `composeViewDeps` imports this module, never the reverse.

import type { WebViewToExtensionMessage } from "../../../types/messages";
import type { TerminalOwner } from "../../navigation/TerminalNavigationState";
import type { WorktreeMenuActions } from "../WorktreeContextMenu";
import type { WorktreeCreateDialogDeps } from "../WorktreeCreateDialog";
import type {
  WorktreeActionResult,
  WorktreeCreateDefaults,
  WorktreeProvisionOffer,
  WorktreeRowActivation,
} from "../worktreeViewTypes";
import type { AgentActions } from "./agentActions";
import type { WorktreeStateStore } from "./controllerTypes";
import type { CreateFlow } from "./createFlow";
import type { createDialogChannels } from "./dialogChannels";
import type { MutationResults } from "./mutationResults";

/**
 * Everything the view's dep object reads, as accessors — never the controller
 * instance itself. A callback that could reach the whole class is a callback
 * whose real inputs nobody can enumerate.
 */
export interface ViewDepsSeam {
  host: HTMLElement;
  postMessage(msg: WebViewToExtensionMessage): void;
  store: WorktreeStateStore;
  now?(): number;
  onSelectWorktree?: (worktreeId: string | null) => void;
  activeOwner?: () => TerminalOwner;
  activePaneId?: () => string | null;
  /** Held rather than passed: the two launch items appear only once one can act. */
  menuActions: WorktreeMenuActions;
  createFlow: CreateFlow;
  dialogChannels: ReturnType<typeof createDialogChannels>;
  agentActions: AgentActions;
  mutationResults: MutationResults;
  /** The view this object is being built for. Read only inside callbacks. */
  actionResults(): WorktreeActionResult[];
  setActionResults(next: WorktreeActionResult[]): void;
  rowActivation(): WorktreeRowActivation;
  push(): void;
  openCreateForRepo(repoId?: string, sourceWorktreeId?: string): void;
  createRepos(): WorktreeCreateDefaults[];
  confirmPrune(repoId: string): void;
}

/**
 * The form's seed is the HOST's answer, never a path derived here: the spec
 * says a create names the destination it will actually use, and only the host
 * knows the configured root and which candidates are free.
 */
export function buildCreateDialogDeps(seam: ViewDepsSeam): Omit<WorktreeCreateDialogDeps, "onSubmit" | "onCancel"> {
  const opening = seam.createFlow.refsToken();
  return {
    // Snapshotted where the form is COMPOSED, not read where a callback
    // fires. `openCreate` advances the opening before the successor dialog
    // exists and the predecessor stays live until its defaults land, so a
    // callback reading the current opening at click time names the
    // successor — the same trap `onCreateClosed` already avoids by taking
    // the opening from the view (round-1 B3, round-1 F002).
    repos: seam.createRepos(),
    // The destination depends on the branch, so every settled branch edit
    // re-asks and the answer replaces the seed in place (round-3 B12).
    onSelectionChange: (selection) => {
      const source = seam.createFlow.createSource();
      seam.postMessage({
        type: "requestWorktreeCreateDefaults",
        repoId: selection.repoId,
        opening: seam.createFlow.refsToken(),
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
      seam.postMessage({
        type: "worktreeCreateProbe",
        repoId: selection.repoId,
        token: seam.createFlow.refsToken(),
        seq: seam.createFlow.nextProbeSeq(),
        query: selection.branch,
        ...(selection.base === undefined ? {} : { base: selection.base }),
        ...(selection.candidatePath === undefined ? {} : { candidatePath: selection.candidatePath }),
        ...(selection.useChosenFolder === undefined ? {} : { useChosenFolder: selection.useChosenFolder }),
      });
    },
    bindDefaults: (apply) => {
      seam.dialogChannels.defaults.bind(apply);
    },
    bindProvisioning: (apply) => {
      seam.dialogChannels.provisioning.bind(apply);
    },
    bindMigration: (apply) => {
      seam.dialogChannels.migration.bind(apply);
    },
    // A source the HOST detected, named by id. The message carries no file,
    // no path and no model — the host re-resolves that provider itself, and
    // the fresh offer comes back through `bindProvisioning` (design.md D5).
    onProvisionSwitch: (request) => {
      seam.postMessage({
        type: "worktreeProvisionSwitch",
        repoId: request.repoId,
        // The opening this form was composed in, the same one every other
        // request from it rides. A switch naming a retired opening is not
        // honoured, which is what stops a dismissed form redrawing.
        opening: seam.createFlow.refsToken(),
        switch: request.switch,
        provider: request.provider as WorktreeProvisionOffer["model"]["providers"][number]["id"],
      });
    },
    // Pathless by contract: the host owns both the system picker and the
    // safely held file it returns. Capture this form's opening here rather
    // than reading the successor's token when the callback fires.
    onCopyFileAsk: (request) => {
      seam.postMessage({
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
      seam.postMessage({
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
      seam.postMessage({
        type: "worktreeProvisionSave",
        repoId: request.repoId,
        // The opening this form was composed in, like every other request
        // from it. A save naming a retired opening is not honoured, which
        // is what stops a dismissed form writing.
        opening: seam.createFlow.refsToken(),
        switch: request.switch,
        offerId: request.offerId,
        kept: request.kept,
      });
    },
    bindPullRequests: (apply) => {
      seam.dialogChannels.pullRequests.bind(apply);
    },
    bindRefs: (apply) => {
      seam.dialogChannels.refs.bind(apply);
    },
    bindResolution: (apply) => {
      seam.dialogChannels.resolution.bind(apply);
    },
    // Its own request, sent only when the user accepts the recover offer —
    // the probe is answered per settled edit, so a token riding it would be
    // one nobody asked for (design.md D6).
    onAuthorizeDebris: ({ repoId, ask, path }) => {
      seam.postMessage({
        type: "worktreeAuthorizeDebris",
        repoId,
        token: seam.createFlow.refsToken(),
        ask,
        path,
      });
    },
    bindDebrisAuthorization: (apply) => {
      seam.dialogChannels.debrisAuthorization.bind(apply);
    },
    // The opening rides here the way every other create request's does, so
    // the form states no identity of its own (design.md D2).
    onPickDestination: ({ repoId, ask }) => {
      // The form's own ask, forwarded the way `probeSeq` is: which pick
      // this is belongs to the form that opened it, not to this controller.
      seam.postMessage({ type: "worktreePickDestination", repoId, token: opening, ask });
    },
    bindDestinationPicked: (apply) => {
      seam.dialogChannels.destinationPicked.bind(opening, apply);
    },
  };
}
