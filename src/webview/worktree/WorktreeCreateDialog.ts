// src/webview/worktree/WorktreeCreateDialog.ts — The create-worktree form
// (worktree-panel-ui § 5, worktree-actions § 3.2).
//
// Presentation only in this phase: `onSubmit` receives the draft and nothing here
// spawns git. What the form DOES own is the truthfulness rules the design fixes:
//
//  - The branch name starts empty. A wrong-but-plausible suggestion is worse than
//    a blank field, so none is offered.
//  - The path is derived from the branch, and when the derived path collided the
//    form shows the FINAL suffixed path before submit — not the one that was taken.
//  - The agent picker lives inside the form, because creating a worktree in order
//    to put an agent in it is one intent.
//  - A dangerous permission posture is labelled and never preselected.
//  - The repo picker appears only once the workspace holds more than one repo.

import { sanitizeBranchForPath } from "../../worktree/branchSlug";
import { createAfterCreate } from "./createDialog/afterCreate";
import { createBranchChoices } from "./createDialog/branchChoices";
import { createBranchList } from "./createDialog/branchList";
import { createDerivePass } from "./createDialog/derivePass";
import { createDestinationField } from "./createDialog/destinationField";
import type { WorktreeCreateDialogDeps } from "./createDialog/dialogDeps";
import { type AfterChoice, createDraftModel } from "./createDialog/draftModel";
import { createFormFields, explain } from "./createDialog/formFields";
import { attachHostBindings } from "./createDialog/hostBindings";
import { createProvisionState } from "./createDialog/provisionState";
import { createProvisionView } from "./createDialog/provisionView";
import { createRecoverOffer } from "./createDialog/recoverOffer";
import { type CreateSelection, createResolutionAsks } from "./createDialog/resolutionAsks";
import { createSections, openAfterOptions } from "./createDialog/sections";
import { createSubmission } from "./createDialog/submission";
import { initialSafeAgentId } from "./worktreeAgentBox";
import { dialogTitle, field, openDialogShell, selectControl } from "./worktreeDialogShell";
import type { WorktreeCreateDefaults, WorktreeRef } from "./worktreeViewTypes";

// Re-exported where it has always been imported from: the shape of the question
// travels with the asks now (createDialog/resolutionAsks.ts), and the host deps
// and the dialog suite both name it here.
export type { CreateSelection };

export type { WorktreeCreateDialogDeps };

// Re-exported from branchSlug, the one definition the host shares, so the form
// and the host cannot disagree about what a branch turns into (round-3 B12).
export { sanitizeBranchForPath };

/** Mount the create form and return its disposer. */

export function openWorktreeCreateDialog(root: HTMLElement, deps: WorktreeCreateDialogDeps): () => void {
  const repos = deps.repos;
  const first = repos[0];
  if (!first) {
    throw new Error("openWorktreeCreateDialog requires at least one repo");
  }

  const initialRepoId = deps.initialRepoId ?? first.repoId;
  const initialRepo = repos.find((repo) => repo.repoId === initialRepoId) ?? first;
  const safeInitialAgentId = initialSafeAgentId(initialRepo.agents);
  const initialAfterChoice: AfterChoice = safeInitialAgentId === undefined ? "terminal" : "agent";
  const model = createDraftModel({ initialRepoId, initialAfterChoice });
  /** The answer itself, mutated in place by the fields that own their own value. */
  const draft = model.draft;

  const currentRepo = (): WorktreeCreateDefaults => repos.find((r) => r.repoId === draft.repoId) ?? first;

  const shell = openDialogShell(root, {
    label: "Create worktree",
    wide: true,
    dismissOnScrim: true,
    // Escape and the scrim dispose the shell from inside it, so the tooltip has
    // to be released here too — `disposeAll` is not on that path.
    onDismiss: () => {
      releaseDestTip();
      // Escape and the scrim never reach `disposeAll`, so closing the model
      // only there left the guard passing on the DOM being gone rather than on
      // the guard firing (round-2 W2).
      model.close();
      deps.onCancel?.();
    },
    // The list owns Escape only while it is open (D7). Asked by the shell
    // rather than raced with it: the shell binds Escape on `document` in the
    // capture phase before this form exists, so nothing added here could run
    // first, and two owners deciding by registration order is not a contract.
    onEscape: () => {
      return branchList.escape();
    },
  });
  const cancel = (): void => {
    deps.onCancel?.();
    disposeAll();
  };
  /** Every exit goes through here — the tooltip outlives `shell.dispose` alone. */
  const disposeAll = (restoreFocus = true): void => {
    releaseDestTip();
    // Every applier the controller still holds a reference to goes inert here.
    // The controller cannot unregister them — it learns a form closed only
    // through the view — so the form has to be the one that stops answering.
    //
    // Defensive, and honestly so: round-1 W2 named this, and the write it stops
    // is currently unobservable. A reopening rebinds before any reply can be
    // misrouted, and a reply landing between close and reopen mutates a closure
    // with no DOM left. No test can tell the two apart, so none pretends to —
    // the guard is here because writing into a disposed form is wrong, not
    // because a symptom was measured.
    model.close();
    shell.dispose(restoreFocus);
  };

  // Every element the form is built from (createDialog/formFields.ts). That
  // module takes no dependencies at all, so nothing in it can read form state:
  // the listeners, the tooltips, the collaborator factories and the appends into
  // the dialog are all below, where what they decide is visible beside them.
  const fields = createFormFields();
  // Only the elements this file still wires or appends. The nine the render
  // pass alone reads reach it through `fields` (createDialog/derivePass.ts).
  const {
    nameField,
    nameInput,
    nameError,
    listBox,
    destWrap,
    recoverField,
    recoverBox,
    recoverText,
    recoverNote,
    repoHint,
    modeField,
    detachToggle,
    baseInput,
    pathInput,
    migrationField,
  } = fields;

  shell.dialog.appendChild(dialogTitle("Create worktree", undefined, cancel));

  const branches = createBranchChoices({
    refs: () => offeredRefs(),
    repoId: () => draft.repoId,
    pullRequests: () => currentRepo().pullRequests,
  });
  /** Which row is active while the list is open; -1 when none is. */

  shell.dialog.appendChild(nameField);

  shell.dialog.appendChild(destWrap);

  let repoSelect: HTMLSelectElement | undefined;
  if (repos.length > 1) {
    const repoField = field("Repository", "wt-repo-select");
    const select = selectControl(
      "wt-repo-select",
      repos.map((r) => ({ value: r.repoId, label: r.repoLabel })),
      draft.repoId,
    );
    repoSelect = select;
    select.addEventListener("change", () => {
      draft.repoId = select.value;
      agentBox.setAgents(currentRepo().agents, initialSafeAgentId(currentRepo().agents));
      rebuildAfterOptions();
      // The branch list belongs to a repository. The same typed name can be an
      // existing branch in one and a new one in the next, and it can be held in
      // one and free in the other — both are re-answered here (B2, W1).
      asks.deriveChoice();
      branchList.refreshIfOpen();
      stateDestination({ kind: "repoChanged" });
    });
    repoField.append(select, repoHint);
    shell.dialog.appendChild(repoField);
  }

  // ── Branch source — inside the disclosure (built below) ─────────────────
  // Only `detached` lives here now. New-versus-existing is the combobox's, and
  // one wire value never takes two sources (D4): a control that also wrote
  // `branchMode` would disagree with the row the user picked.

  detachToggle.addEventListener("click", () => {
    const now = draft.branchMode !== "detached";
    draft.branchMode = now ? "detached" : "new";
    detachToggle.setAttribute("aria-pressed", now ? "true" : "false");
    if (now) {
      // Detached SURRENDERS the pull request as the source: it creates at a ref
      // and mints no branch, so `pr/<n>` is no longer what this create is about.
      // Withdrawn here rather than hidden by the guard, because leaving detached
      // re-derives the still-present text as an ordinary branch and would
      // otherwise resurrect a statement nobody re-selected (.reviews/round-2.md
      // B2).
      branches.clearForkHead();
    }
    // Leaving detached hands the mode back to the box, which has to re-ask the
    // question: refs may have landed while detached was on, and `choice` was
    // not being maintained under it.
    if (!now) {
      asks.deriveChoice();
    }
    branchList.close();
    syncDerived(true);
  });
  modeField.appendChild(detachToggle);
  explain(
    detachToggle,
    "Detaching checks the worktree out at a commit without creating a branch. Work there belongs to no branch until you make one, so it is for looking at a past state rather than building on it.",
  );

  // The same rule the base ref carries, for the same reason: a mode whose
  // target is not the user's to choose says so rather than accepting a value it
  // will not use. A repair acts on the registration's own directory, and an
  // override here displayed one path while the request carried another
  // (round-4 B3).

  shell.dialog.appendChild(migrationField);

  // Everything the form has asked the host to do to the provisioning offer, and
  // everything the user has ticked (createDialog/provisionState.ts). The split
  // against the drawing below is state versus DOM: `settle` decides which
  // pending ask an arriving offer answers and what the selection becomes, and
  // hands back a verdict this file draws.
  const bring = createProvisionState({
    repoId: () => draft.repoId,
    pickAsking: () => destination.pickAsking(),
    canSave: deps.onProvisionSave !== undefined,
    canAskStep: deps.onSetupStepAsk !== undefined,
    canAskCopy: deps.onCopyFileAsk !== undefined,
    onProvisionSave: deps.onProvisionSave,
    onProvisionSwitch: deps.onProvisionSwitch,
    onSetupStepAsk: deps.onSetupStepAsk,
    onCopyFileAsk: deps.onCopyFileAsk,
  });

  // The section on screen (createDialog/provisionView.ts). Built HERE, where
  // its construction stood, because the dialog's field order is the order of the
  // appends — and `waitField` is attached inside this field a little below.
  const bringView = createProvisionView({
    dialog: shell.dialog,
    bring,
    repoSelect: () => repoSelect,
    pickAsking: () => destination.pickAsking(),
    canAskStep: deps.onSetupStepAsk !== undefined,
    canAskCopy: deps.onCopyFileAsk !== undefined,
    syncDerived: () => syncDerived(),
    syncWaitForSetup: () => syncWaitForSetup(),
  });

  // Where the worktree goes, and which pick is being waited on
  // (createDialog/destinationField.ts). Built HERE, where the pick button's
  // append into `pathRow` stood: the field order is the order of the appends.
  const destination = createDestinationField({
    fields,
    model,
    bring,
    bringView,
    onPickDestination: deps.onPickDestination,
    canBindPicked: deps.bindDestinationPicked !== undefined,
    currentRepo,
    syncDerived: (settled) => syncDerived(settled),
    destExact: () => derive.destExact(),
  });
  const { stateDestination, pickDestination } = destination;
  const ensureDestTip = (): void => {
    destination.ensureDestTip();
  };
  const releaseDestTip = (): void => {
    destination.releaseDestTip();
  };

  // Everything below the branch, in the order it appears on screen
  // (createDialog/sections.ts). Late-bound both ways: it builds `createBtn`,
  // which the submit reads, and calls the submit the button performs.
  const sections = createSections({
    dialog: shell.dialog,
    actions: shell.actions,
    fields,
    model,
    bring,
    bringField: bringView.field,
    safeInitialAgentId,
    currentRepo,
    syncOpenAfter: () => syncOpenAfter(),
    syncDerived: () => syncDerived(),
    refreshFocusTrap: () => shell.refreshFocusTrap(),
    cancel: () => cancel(),
    submit: () => submit(),
  });
  const { afterSelect, afterNote, folderField, agentBox, waitBox, disabledReason, createBtn } = sections;
  const syncWaitForSetup = sections.syncWaitForSetup;

  const asks = createResolutionAsks({
    nameInput,
    baseInput,
    draft,
    branches,
    offeredRefs,
    destinationCandidate: () => model.destinationCandidate(),
    // Late-bound on purpose: `recover` is built from `asks` just below, and a
    // withdrawal only ever happens once both exist.
    withdrawRecover: () => recover.withdraw(),
    onSelectionChange: deps.onSelectionChange,
    canResolve: deps.bindResolution !== undefined,
    syncDerived: (settled) => syncDerived(settled),
  });

  const recover = createRecoverOffer({
    recoverField,
    recoverBox,
    recoverText,
    recoverNote,
    draft,
    resolution: () => asks.resolution(),
    targetOf: (resolution) => asks.targetOf(resolution),
    onAuthorizeDebris: deps.onAuthorizeDebris,
    canAnswer: deps.onAuthorizeDebris !== undefined && deps.bindDebrisAuthorization !== undefined,
    syncDerived: (settled) => syncDerived(settled),
  });

  /** The refs the current repository was told about; empty until it is told. */
  function offeredRefs(): readonly WorktreeRef[] {
    return currentRepo().refs?.list ?? [];
  }

  const branchList = createBranchList({
    listBox,
    nameInput,
    nameError,
    baseInput,
    branches,
    draft,
    refreshFocusTrap: () => shell.refreshFocusTrap(),
    syncDerived: (settled) => syncDerived(settled),
  });

  // What happens once the worktree exists (createDialog/afterCreate.ts), and the
  // whole render pass (createDialog/derivePass.ts). Each is late-bound to the
  // other: the choice drives a re-derive, and the re-derive restates the hint
  // under the choice.
  const afterCreate = createAfterCreate({
    model,
    afterSelect,
    afterNote,
    folderField,
    agentBox,
    canLaunch: () => currentRepo().agents.length > 0,
    agents: () => currentRepo().agents,
    syncDerived: () => syncDerived(),
    openAfterOptions,
  });
  // What a create carries, and whether a field's emptiness is the user's answer
  // (createDialog/submission.ts). Built here rather than where `migrationField`
  // is appended, because it reads every collaborator's settled answer and they
  // are all above it — the append stays in the field order it belongs to.
  const submission = createSubmission({
    fields,
    model,
    asks,
    recover,
    bring,
    agentBox,
    createBtn,
    waitForSetup: () => waitBox.checked,
    syncDerived: (settled) => syncDerived(settled),
    onSubmit: deps.onSubmit,
    close: () => disposeAll(),
  });
  const syncMigration = submission.syncMigration;
  const submit = (): void => {
    submission.submit();
  };
  const derive = createDerivePass({
    fields,
    model,
    asks,
    bring,
    bringView,
    recover,
    branches,
    createBtn,
    disabledReason,
    agentBox,
    pickDestination,
    currentRepo,
    nameLeft: () => submission.nameLeft(),
    baseLeft: () => submission.baseLeft(),
    pickAsking: () => destination.pickAsking(),
    ensureDestTip,
    releaseDestTip,
    syncMigration,
    syncAfterHint: () => afterCreate.syncAfterHint(),
    syncWaitForSetup,
    refreshFocusTrap: () => shell.refreshFocusTrap(),
    openAfterOptions,
  });
  function syncDerived(settled = false): void {
    derive.sync(settled);
  }
  function syncOpenAfter(): void {
    afterCreate.syncOpenAfter();
  }
  function rebuildAfterOptions(): void {
    afterCreate.rebuildAfterOptions();
  }

  /**
   * Re-derive the path and its hint from the branch, and re-validate. The hint
   * names the collided path AND the suffixed one the create will actually use —
   * showing only the pretty default would be a claim the form cannot keep.
   */

  // `change` rather than `input`: asking the host on every keystroke would be a
  // request per character. `input` still re-renders locally, so the field never
  // feels laggy — only the authoritative destination waits for the edit to settle.
  const edited = (): void => {
    syncDerived(true);
  };
  nameInput.addEventListener("input", () => {
    submission.nameTyped();
    // Typing re-decides what the text MEANS, on the same rule the ordering
    // states: an exact match is the branch the user named, anything else is a
    // branch they are about to create.
    asks.deriveChoice();
    branchList.open();
    syncDerived();
  });
  nameInput.addEventListener("change", edited);
  nameInput.addEventListener("blur", () => {
    branchList.close();
    // Leaving a field the user actually used is what turns its emptiness into
    // their answer. Leaving the one the form focused for them says nothing.
    submission.nameBlurred();
    syncDerived(true);
  });
  nameInput.addEventListener("keydown", (ev) => {
    branchList.onNameKeyDown(ev);
  });
  baseInput.addEventListener("input", () => {
    submission.baseTyped();
    syncDerived();
  });
  baseInput.addEventListener("change", edited);
  baseInput.addEventListener("blur", () => {
    submission.baseBlurred();
    syncDerived(true);
  });
  pathInput.addEventListener("change", edited);
  pathInput.addEventListener("input", () => stateDestination({ kind: "typed", path: pathInput.value }, true));
  shell.dialog.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) {
      ev.preventDefault();
      submit();
    }
  });

  attachHostBindings({
    model,
    asks,
    bring,
    bringView,
    recover,
    branchList,
    repos,
    pickAsked: () => destination.pickAsked(),
    clearPickAsked: () => {
      destination.clearPickAsked();
    },
    stateDestination,
    syncDerived,
    syncMigration,
    // The dialog's own deps object IS the channel set — passing it whole is
    // what keeps a channel from being silently dropped on the way through.
    bind: deps,
  });

  syncOpenAfter();
  shell.focusInitial(nameInput);

  return disposeAll;
}
