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

import type {
  ResolvedMode,
  WorktreeCreateResolutionMessage,
  WorktreeDebrisAuthorizedMessage,
  WorktreeDestinationPickedMessage,
  WorktreeSetupStepAskMessage,
} from "../../types/messages";
import { sanitizeBranchForPath } from "../../worktree/branchSlug";
import { attachTooltip } from "../ui/Tooltip";
import { ICON_CHEVRON_DOWN, ICON_FOLDER } from "../vault/icons";
import { createBranchChoices, partialListText } from "./createDialog/branchChoices";
import { createBranchList } from "./createDialog/branchList";
import { type AfterChoice, createDraftModel, type DestinationEdit } from "./createDialog/draftModel";
import { createFormFields } from "./createDialog/formFields";
import { lastSegment, shortPath } from "./createDialog/paths";
import { createProvisionState } from "./createDialog/provisionState";
import { createProvisionView } from "./createDialog/provisionView";
import { createRecoverOffer } from "./createDialog/recoverOffer";
import { type CreateSelection, createResolutionAsks } from "./createDialog/resolutionAsks";
import { createWorktreeAgentBox, initialSafeAgentId } from "./worktreeAgentBox";
import { dialogTitle, field, keyHint, openDialogShell, selectControl, textButton } from "./worktreeDialogShell";
import type {
  WorktreeBranchMode,
  WorktreeCreateDefaults,
  WorktreeCreateDraft,
  WorktreeMigrationOffer,
  WorktreeOpenAfter,
  WorktreeProvisionOffer,
  WorktreePullRequestOffer,
  WorktreeRef,
  WorktreeRefOffer,
} from "./worktreeViewTypes";

// `AfterChoice` is the form's own vocabulary and lives with the answer it names
// (createDialog/draftModel.ts). Opening the folder is one intent with two
// destinations, and listing them as two peers of "Nothing" made the choice read
// as four ways to open something. The pair is reached through a secondary
// control instead; no wire value becomes unreachable.

const AFTER_CHOICES: readonly { value: AfterChoice; label: string }[] = [
  { value: "none", label: "Nothing" },
  { value: "terminal", label: "Open a terminal here" },
  { value: "agent", label: "Start an agent" },
  { value: "folder", label: "Open the folder" },
];

/** The two the folder choice resolves to. Adding to the workspace leads: opening
 *  a second window on a folder the user is already in is the disruptive one. */
const FOLDER_MODES: readonly { value: WorktreeOpenAfter; label: string }[] = [
  { value: "addToWorkspace", label: "Add to this workspace" },
  { value: "newWindow", label: "Open in a new window" },
];

/**
 * `agent` is offered only where something can perform it — the option is built
 * from the repo's own agent list, so a host that reported none leaves it absent
 * rather than selectable-and-refused. The folder choice is always performable.
 */
function openAfterOptions(canLaunch: boolean): { value: AfterChoice; label: string }[] {
  return AFTER_CHOICES.filter((o) => o.value !== "agent" || canLaunch);
}

// Re-exported where it has always been imported from: the shape of the question
// travels with the asks now (createDialog/resolutionAsks.ts), and the host deps
// and the dialog suite both name it here.
export type { CreateSelection };

export interface WorktreeCreateDialogDeps {
  /** One entry per repo; a single entry suppresses the picker entirely (§ 3.2). */
  repos: WorktreeCreateDefaults[];
  /** Which repo the create was invoked from. */
  initialRepoId?: string;
  /**
   * The selection changed, so what a create would do has to be resolved again —
   * only the host can say which path is free and whether the base names a
   * commit. Called on every SETTLED edit, and it carries the whole selection
   * rather than just the branch: a base or a destination the host is never told
   * about is a field the resolution cannot be about (round-3 B4).
   */
  onSelectionChange?: (selection: CreateSelection) => void;
  /**
   * Receive the function that applies a fresh answer from the host. Kept as a
   * callback rather than a return value so the form stays a single expression
   * for every caller that does not need to update it.
   */
  bindDefaults?: (apply: (next: WorktreeCreateDefaults) => void) => void;
  /**
   * Receive the function that applies a fresh provisioning offer.
   *
   * Separate from `bindDefaults` on purpose. The destination is answered per
   * keystroke and the form gates Create on that answer being current; this
   * channel answers the opening and its source/save/input operations without
   * touching the destination gate. Routing an offer through the destination's
   * callback let it clear that gate, so Create went live on the path resolved
   * for the opening ask (.reviews/round-1.md B4).
   */
  bindProvisioning?: (apply: (repoId: string, offer: WorktreeProvisionOffer) => void) => void;
  /** Receive the function that replaces the current source-snapshot move offer. */
  bindMigration?: (apply: (repoId: string, offer: WorktreeMigrationOffer | undefined) => void) => void;
  /**
   * Receive the function that applies the repository's branch list.
   *
   * Its own channel for the same reason as `bindProvisioning`: this answers
   * once per form and gates nothing, while the destination is answered per
   * settled edit and Create waits on it. Routing one through the other's
   * callback is what B4 was.
   */
  bindRefs?: (apply: (repoId: string, refs: WorktreeRefOffer) => void) => void;
  /**
   * Populate the section from a source that was detected but did not win.
   *
   * Carries the provider's ID and a sequence this form mints, and nothing else.
   * A dep that could carry a file, a path or a model would make the webview the
   * authority on what the host reads (design.md D5). Taking it submits nothing:
   * the host answers with a fresh offer, which arrives through
   * `bindProvisioning` like any other.
   */
  onProvisionSwitch?: (request: { repoId: string; switch: number; provider: string }) => void;
  /**
   * Record the current selection in the repository's own configuration.
   *
   * Carries the host's opaque item ids, the offer that named them, and the
   * ordering fields — no path, no key, no file text. A dep that could carry any
   * of those would make the webview the authority on what the repository's
   * configuration SAYS, which is the same rule `onProvisionSwitch` obeys one
   * hop earlier (design.md D1).
   *
   * `switch` comes from the same sequence the switch mints, so a save and a
   * source change order against each other rather than racing (design.md D8).
   */
  onProvisionSave?: (request: { repoId: string; switch: number; offerId: string; kept: readonly string[] }) => void;
  /**
   * Ask the host to open its system picker for one file to copy in this create.
   *
   * The form sends only the repository and shared ordering sequence. The host
   * owns the picker, path, holder and fresh offer that answers this ask.
   */
  onCopyFileAsk?: (request: { repoId: string; switch: number }) => void;
  /**
   * Ask the host to open ITS input for a setup step that applies to this
   * create only, or to edit or remove one it already holds.
   *
   * Carries an operation and, for edit and remove, the host's own ids — never
   * the text. What the user types exists first in the extension host and comes
   * back as display material inside a fresh offer through `bindProvisioning`,
   * the same way every provider-declared script already arrives
   * (add-a-setup-step-for-this-create-only/design.md D1, D2).
   *
   * `switch` comes from the same sequence the switch and the save mint, so the
   * three order against each other.
   */
  onSetupStepAsk?: (request: { repoId: string; switch: number; op: WorktreeSetupStepAskMessage["op"] }) => void;
  /** The forge's answer, on its own channel — it must never gate `bindRefs`. */
  bindPullRequests?: (apply: (repoId: string, offer: WorktreePullRequestOffer) => void) => void;
  /**
   * What a create against the settled selection would actually do.
   *
   * The form applies an answer only while `query` still matches what is typed:
   * a resolution the user has typed past describes a selection that is gone,
   * and applying it would state a mode nobody chose (design.md D1).
   */
  bindResolution?: (apply: (resolution: WorktreeCreateResolutionMessage) => void) => void;
  /**
   * Ask the host to authorize clearing this directory.
   *
   * Its own request, sent only when the user ACCEPTS the offer. The resolution
   * carries no authorization because it is answered on every settled edit, and
   * a token minted per keystroke is one nobody asked for (design.md D6).
   */
  onAuthorizeDebris?: (request: { repoId: string; ask: number; path: string }) => void;
  /**
   * Receive the function that applies the host's answer to that request.
   *
   * Paired with `onAuthorizeDebris`: without both, no answer can ever arrive,
   * and an offer that cannot be authorized is a control that does nothing — so
   * the offer is not rendered at all.
   */
  bindDebrisAuthorization?: (apply: (answer: WorktreeDebrisAuthorizedMessage) => void) => void;
  /**
   * Ask the host to open the system folder picker for this form.
   *
   * Carries the repository and nothing else: the opening is the owner's, added
   * where every other create request's is, so this form states no identity of
   * its own and no second place decides whether an answer belongs here
   * (design.md D2).
   */
  onPickDestination?: (request: { repoId: string; ask: number }) => void;
  /**
   * Receive the function that applies a picked folder.
   *
   * Paired with `onPickDestination` for the same reason `bindDebrisAuthorization`
   * is paired with `onAuthorizeDebris`: without both, no answer can arrive, and
   * an action that cannot be answered is a control that does nothing — so it is
   * not rendered at all.
   */
  bindDestinationPicked?: (apply: (answer: WorktreeDestinationPickedMessage) => void) => void;
  onSubmit: (draft: WorktreeCreateDraft) => void;
  onCancel?: () => void;
}

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
  /** How many picks this form has opened. Minted like `recoverAsks` in createDialog/recoverOffer.ts (D7). */
  let pickAsks = 0;
  /**
   * Which pick this form is waiting on, or null.
   *
   * Its OWN gate, deliberately not the `outstanding` flag the destination probe
   * uses. Nothing disables Choose while a probe is in flight, so a pick can open
   * on top of one; that probe's answer is still current and clears `outstanding`,
   * after which Create would be offered again — at the destination from BEFORE
   * the pick. One boolean cannot hold two independent waits (design.md D7).
   */
  let pickAsked: number | null = null;

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
  const {
    nameField,
    nameInput,
    nameError,
    listBox,
    partialNote,
    destWrap,
    dest,
    destShort,
    destExactText,
    destNote,
    actionNote,
    forkNote,
    adoptLosses,
    recoverField,
    recoverBox,
    recoverText,
    recoverNote,
    repoHint,
    modeField,
    detachToggle,
    baseField,
    baseInput,
    baseNote,
    pathField,
    pathInput,
    pathRow,
    pathNote,
    migrationField,
    migrationBox,
    migrationText,
  } = createFormFields();

  shell.dialog.appendChild(dialogTitle("Create worktree", undefined, cancel));

  const branches = createBranchChoices({
    refs: () => offeredRefs(),
    repoId: () => draft.repoId,
    pullRequests: () => currentRepo().pullRequests,
  });
  /** Which row is active while the list is open; -1 when none is. */

  shell.dialog.appendChild(nameField);

  shell.dialog.appendChild(destWrap);
  /** The exact path the line is currently shortening; read on every show. */
  let destExact = "";
  /**
   * Attached the first time there IS a destination, not at construction.
   * `attachTooltip` resolves its text once at attach and returns a no-op when it
   * is empty — and at construction `destExact` is "", so attaching here bound
   * nothing at all and every release path below released nothing.
   */
  let disposeDestTip: (() => void) | null = null;
  const ensureDestTip = (): void => {
    if (disposeDestTip === null && destExact !== "") {
      disposeDestTip = attachTooltip(dest, { getText: () => destExact });
    }
  };
  const releaseDestTip = (): void => {
    disposeDestTip?.();
    disposeDestTip = null;
  };

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
  /**
   * A git term of art, explained where it is used. `title` is the hover; the
   * same words go on `aria-description` because a screen reader announces
   * `title` only for a control it can focus, and two of these three sit on a
   * plain `<label>`.
   */
  const explain = (el: HTMLElement | null, text: string): void => {
    if (!el) {
      return;
    }
    el.setAttribute("title", text);
    el.setAttribute("aria-description", text);
  };
  const labelOf = (wrap: HTMLElement): HTMLElement | null => wrap.querySelector(".wt-flabel");

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

  /**
   * The one place a stated destination becomes form state.
   *
   * Three states and every edge between them (design.md D6): the destination is
   * derived under the configured root, derived inside a folder the host offered
   * this form, or typed. `pathIsDerived` stays true in the middle one — the
   * destination IS derived, just from a different root — so the field keeps
   * showing the host's answer.
   *
   * What the form submits is NOT read from the input: `selection()` reads
   * `pathIsDerived`, `supplied` and `usingChosen`, and `syncDerived` re-derives
   * over the input whenever the caret is elsewhere — which after a picker it
   * always is. So a caller that assigned `pathInput.value` would be silently
   * overwritten and would compose a create stating nothing at all.
   *
   * Clearing the field is not an override of "nowhere" — it is withdrawing the
   * override.
   */
  const stateDestination = (next: DestinationEdit, fromInput = false): void => {
    // The user replacing the destination withdraws any pick they were waiting
    // on — typed, cleared (the `typed` branch with empty text), or the
    // repository switched. An answer to a withdrawn ask changes nothing, which
    // is what stops a late pick wiping a newer typed path or marking a
    // repository chosen that was never offered a folder (design.md D7).
    //
    // Scoped to those three and claimed no wider: `stateDestination` is not the
    // only writer of destination state — `syncDerived`'s withdrawal arm and the
    // resolution application both write it — but those are not the user
    // replacing anything.
    if (next.kind !== "chosen") {
      pickAsked = null;
    }
    // The three states and their edges are the model's; this half is the field.
    model.stateDestination(next);
    if (next.kind === "typed" && !fromInput) {
      pathInput.value = next.path;
    }
    // Typing is settled by the field's own `change`; a chosen folder and a
    // repository switch have no such event and nothing more is coming, so each
    // IS the settled edit. Left unsettled, the host is never asked and Create
    // stays disabled waiting for an answer nobody requested.
    bringView.syncControls();
    syncDerived(!fromInput);
  };

  explain(
    labelOf(baseField),
    "The base ref is the commit the new branch starts from — a branch name, a tag, or a commit id. Left empty it starts from HEAD, the commit this repository is on now.",
  );

  // Rendered only when it can be answered. `onPickDestination` without
  // `bindDestinationPicked` is a button whose reply reaches nobody.
  const pickDestination =
    deps.onPickDestination !== undefined && deps.bindDestinationPicked !== undefined
      ? document.createElement("button")
      : undefined;
  if (pickDestination !== undefined) {
    pickDestination.type = "button";
    pickDestination.className = "wt-path-pick";
    // An icon on the line, a name for everything that reads one: the word was
    // the widest thing beside the field and said nothing the folder does not.
    pickDestination.innerHTML = ICON_FOLDER;
    pickDestination.setAttribute("aria-label", "Choose…");
    pickDestination.title = "Pick the folder this worktree is created in.";
    pickDestination.addEventListener("click", () => {
      if (bring.anyAsking()) {
        return;
      }
      // Minted here, like `recoverAsks` in createDialog/recoverOffer.ts: `token` separates two openings
      // and this separates two picks inside one, so an answer to an earlier
      // pick cannot be mistaken for an answer to this one (design.md D7).
      pickAsks += 1;
      pickAsked = pickAsks;
      deps.onPickDestination?.({ repoId: currentRepo().repoId, ask: pickAsks });
      bringView.syncControls();
      // The gate is only read while the form re-renders, and a click is not one
      // of the events that already does — so Create would stay armed at the
      // pre-pick destination until something else moved.
      syncDerived();
    });
    pathRow.appendChild(pickDestination);
  }
  pathField.appendChild(pathRow);
  explain(
    labelOf(pathField),
    "The folder this worktree is created in. Left empty it goes to the location shown above, derived from the branch name; a value here overrides that for this create only.",
  );
  // The same rule the base ref carries, for the same reason: a mode whose
  // target is not the user's to choose says so rather than accepting a value it
  // will not use. A repair acts on the registration's own directory, and an
  // override here displayed one path while the request carried another
  // (round-4 B3).

  shell.dialog.appendChild(migrationField);

  let drawnMigrationOfferId: string | null = null;

  function migrationAllowed(): boolean {
    return (
      draft.branchMode === "detached" ||
      (draft.branchMode !== "reattach" &&
        asks.resolution()?.mode.kind !== "reattach" &&
        asks.resolution()?.mode.kind !== "adopt")
    );
  }

  function syncMigration(offer: WorktreeMigrationOffer | undefined): void {
    if (offer === undefined || !migrationAllowed()) {
      migrationField.hidden = true;
      migrationBox.checked = false;
      migrationText.textContent = "";
      drawnMigrationOfferId = null;
      return;
    }
    if (drawnMigrationOfferId !== offer.offerId) {
      migrationBox.checked = false;
      drawnMigrationOfferId = offer.offerId;
    }
    migrationField.hidden = false;
    migrationText.textContent = `Move ${offer.count} ${offer.count === 1 ? "change" : "changes"} (current snapshot). Git moves the source's uncommitted work present when Create runs.`;
  }

  function settledMigration(): { offerId: string } | undefined {
    return migrationField.hidden || !migrationBox.checked || drawnMigrationOfferId === null
      ? undefined
      : { offerId: drawnMigrationOfferId };
  }

  // Everything the form has asked the host to do to the provisioning offer, and
  // everything the user has ticked (createDialog/provisionState.ts). The split
  // against the drawing below is state versus DOM: `settle` decides which
  // pending ask an arriving offer answers and what the selection becomes, and
  // hands back a verdict this file draws.
  const bring = createProvisionState({
    repoId: () => draft.repoId,
    pickAsking: () => pickAsked !== null,
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
    pickAsking: () => pickAsked !== null,
    canAskStep: deps.onSetupStepAsk !== undefined,
    canAskCopy: deps.onCopyFileAsk !== undefined,
    syncDerived: () => syncDerived(),
    syncWaitForSetup: () => syncWaitForSetup(),
  });

  // ── After creating ──────────────────────────────────────────────────────
  const afterField = field("After creating", "wt-after");
  const afterSelect = selectControl(
    "wt-after",
    openAfterOptions(currentRepo().agents.length > 0).map((o) => ({ value: o.value, label: o.label })),
    model.afterChoice(),
  );
  afterSelect.addEventListener("change", () => {
    model.setAfterChoice(afterSelect.value as AfterChoice);
    syncOpenAfter();
  });
  const afterNote = document.createElement("span");
  afterNote.className = "wt-fhint wt-after-note";
  afterField.append(afterSelect, afterNote);

  // The secondary control on the folder choice, revealed by it the same way the
  // agent block is revealed by the agent choice.
  const folderField = field("Where", "wt-folder-mode");
  folderField.classList.add("wt-folder-mode");
  const folderSelect = selectControl("wt-folder-mode", [...FOLDER_MODES], model.folderMode());
  folderSelect.addEventListener("change", () => {
    model.setFolderMode(folderSelect.value as WorktreeOpenAfter);
    syncOpenAfter();
  });
  folderField.appendChild(folderSelect);
  folderField.hidden = true;
  shell.dialog.append(afterField, folderField);

  // ── Agent box — shown only for `openAfter: "agent"` ─────────────────────
  // The block itself is shared with the standalone launch dialog, so create-then-
  // launch and launch-here collect the same thing rather than two things that
  // happen to look alike (design.md D7).
  const agentBox = createWorktreeAgentBox(currentRepo().agents, () => syncDerived(), safeInitialAgentId);
  agentBox.setVisible(model.afterChoice() === "agent");
  shell.dialog.appendChild(agentBox.element);

  // ── Wait-for-setup — under the setup rows it gates, never in the agent box ─
  // Its own control, not a field on `agentBox`: it is about SETUP sequencing,
  // not about the agent's own posture, and the two must stay two facts
  // (design.md D6). Shown only while an agent launch is chosen AND the offer
  // carries a setup step; disabled while it carries one that is not ticked
  // (spec `agent-startup-honours-the-setup-wait-choice`). Off by default and
  // never pre-ticked — this never touches a setup row's own default-unchecked
  // state.
  const waitField = document.createElement("div");
  waitField.className = "wt-wait-setup";
  waitField.hidden = true;
  const waitLabel = document.createElement("label");
  waitLabel.htmlFor = "wt-wait-setup";
  const waitBox = document.createElement("input");
  waitBox.type = "checkbox";
  waitBox.id = "wt-wait-setup";
  const waitText = document.createElement("span");
  waitText.textContent = "Wait for setup to finish before starting the agent";
  waitLabel.append(waitBox, waitText);
  waitField.appendChild(waitLabel);
  // The order the current state produces, said rather than left to be inferred
  // from a checkbox: an agent that starts into a half-installed tree is the
  // confusion this recommendation exists to prevent.
  const waitNote = document.createElement("span");
  waitNote.className = "wt-fhint wt-wait-note";
  waitField.appendChild(waitNote);
  // The last line of the bring-over section: what it gates is the rows above
  // it. `saveRow` is attached after it whenever an offer is drawn.
  bringView.field.appendChild(waitField);

  /**
   * What the user set the wait to themselves, or `undefined` while untouched.
   *
   * The VALUE rather than a touched flag, because the box is forced off
   * whenever no setup is selected: a flag alone remembers that a choice was
   * made and loses which one, so an explicit ON came back off the next time
   * there was something to wait for. The recommendation is a default, not a
   * policy — an armed box and an explicitly ticked one are the same DOM state,
   * and only the untouched one may be re-decided by the selection.
   */
  let waitChoice: boolean | undefined;
  waitBox.addEventListener("change", () => {
    waitChoice = waitBox.checked;
    syncWaitForSetup();
  });

  /** The setup steps currently selected in the drawn offer, if any. */
  /**
   * Re-decide visibility and enablement from the agent choice and the current
   * setup selection. Called wherever either can have changed: the after-choice
   * toggle, a full re-derive (repo switch, offer replacement), and a tick
   * inside the bring-over section.
   *
   * Unchecked along with disabled, not merely disabled-and-stale: a wait this
   * control cannot be seen to be armed for must not silently keep armed.
   */
  function syncWaitForSetup(): void {
    // Hidden where there is nothing it could ever gate; disabled where there
    // is something and it is not ticked — that absence is a consequence of the
    // row above it, and hiding it there would read as a layout change.
    const drawn = bring.drawnModel();
    waitField.hidden = model.afterChoice() !== "agent" || drawn === null || drawn.setup.length === 0;
    const selected = bring.hasSelectedSetup();
    waitBox.disabled = !selected || bring.anyAsking();
    if (!selected) {
      // Nothing to wait for is not a gate. The user's own choice is kept for
      // the next time there IS something, but the box cannot stay armed for
      // steps that are no longer selected.
      waitBox.checked = false;
    } else {
      // Recommended, because setup usually installs what the agent is about to
      // read — but only while untouched. An explicit choice owns the box from
      // then on, in both directions.
      waitBox.checked = waitChoice ?? true;
    }
    // Nothing while nothing is selected: the disabled box already says it.
    waitNote.textContent = !selected
      ? ""
      : waitBox.checked
        ? "The agent starts after the selected setup finishes."
        : "The agent starts while the selected setup is still running.";
  }

  // ── Advanced — collapsed, and out of the focus order while it is ────────
  // The same reveal idiom the agent block uses: a toggle carrying `aria-expanded`
  // over a region carrying `hidden`. `openDialogShell`'s focus trap already
  // filters on `[hidden]`, so nothing inside reaches Tab until it opens — which a
  // native `<details>` would not have given us without widening that filter.
  const advanced = document.createElement("div");
  advanced.className = "wt-advanced";
  const advToggle = document.createElement("button");
  advToggle.type = "button";
  advToggle.className = "wt-advanced-toggle";
  advToggle.id = "wt-advanced-toggle";
  advToggle.setAttribute("aria-expanded", "false");
  advToggle.setAttribute("aria-controls", "wt-advanced-body");
  // "Advanced" says who the contents are for, not what they are, so a user has
  // to open it to find out whether it holds anything they wanted. Naming the
  // three inputs lets them decide without opening it. The chevron is the
  // tree's own (`worktreeTreeView.ts`), turned by `aria-expanded` below, so the
  // line reads as something that opens and not as a heading.
  const advChev = document.createElement("span");
  advChev.className = "wt-chev";
  advChev.innerHTML = ICON_CHEVRON_DOWN;
  advChev.setAttribute("aria-hidden", "true");
  const advLabel = document.createElement("span");
  advLabel.textContent = "Branch source, base ref, and location";
  advToggle.append(advChev, advLabel);
  const advBody = document.createElement("div");
  advBody.className = "wt-advanced-body";
  advBody.id = "wt-advanced-body";
  advBody.hidden = true;
  advBody.append(modeField, baseField, pathField);
  advToggle.addEventListener("click", () => {
    advBody.hidden = !advBody.hidden;
    advToggle.setAttribute("aria-expanded", advBody.hidden ? "false" : "true");
    shell.refreshFocusTrap();
  });
  advanced.append(advToggle, advBody);
  shell.dialog.appendChild(advanced);

  // ── Actions ─────────────────────────────────────────────────────────────
  const disabledReason = document.createElement("span");
  disabledReason.className = "wt-create-disabled-reason";
  disabledReason.id = "wt-create-disabled-reason";
  disabledReason.setAttribute("role", "status");
  disabledReason.setAttribute("aria-live", "polite");
  shell.actions.appendChild(disabledReason);
  const cancelBtn = textButton("Cancel", "plain", cancel);
  const createBtn = textButton("Create worktree", "primary", () => submit());
  createBtn.appendChild(keyHint("⌘↵"));
  shell.actions.append(cancelBtn, createBtn);
  shell.dialog.appendChild(shell.actions);

  /**
   * The offer on screen and what is ticked in it, or nothing.
   *
   * Nothing in two cases that are NOT the same: no offer ever arrived, so the
   * form was never told what this repository needs; or an offer arrived and the
   * user unticked every row, which is a decision and travels as an empty list.
   * Collapsing the second into the first would let a host that provisions by
   * default provision against a user who said no.
   */
  function settledProvision(): { offerId: string; itemIds: readonly string[] } | undefined {
    return bring.settledProvision();
  }

  /**
   * Has the user been in the field the form would refuse, and left it?
   *
   * A form that opens already saying "Enter a branch name." is scolding someone
   * for not having typed yet — the emptiness is the form's own opening state,
   * not their answer. Leaving the field, or asking to create, is what makes it
   * theirs. Only the EMPTY-field prompt waits on this: a name the host actually
   * refused is a verdict about text the user did type, and says so at once.
   */
  let nameLeft = false;
  let baseLeft = false;
  /**
   * Has the user put anything in the field, ever?
   *
   * The form focuses the branch field when it opens, so the FIRST click anywhere
   * in the dialog blurs it. Blur alone therefore cannot mean "the user left this
   * empty": the caret was never theirs to begin with, and treating it as an
   * answer is what painted git's refusal of `""` under a field nobody had typed
   * in. Typing is what makes the field theirs; after that, leaving it empty is a
   * real answer and is refused like any other.
   */
  let nameTyped = false;
  let baseTyped = false;

  function submit(): void {
    if (createBtn.disabled || asks.heldBranch() !== undefined) {
      // Asking to create IS the moment the user has answered, so a form that
      // was staying quiet now says what it is waiting for rather than sitting
      // inert under a disabled button (⌘↵ reaches here; the button cannot).
      if (!nameLeft || !baseLeft) {
        nameLeft = true;
        baseLeft = true;
        syncDerived(true);
      }
      return;
    }
    const launch = model.afterChoice() === "agent" ? agentBox.read() : {};
    // The classification travels WITH the submission, so the owner builds the
    // request from the answer this form was showing rather than from its own
    // second copy of it (round-3 B3).
    // The mode the toggle discarded does not travel either: the owner builds the
    // request from it, so sending a classification of text that is not a branch
    // name would turn a detached create into the repair the form refused.
    const carried = draft.branchMode === "detached" ? null : asks.resolution();
    // The grant, only where it still covers the destination this form is
    // showing. Absent, the create is an ordinary one against a free path — the
    // form never asks for a removal it cannot name the authorization for.
    const disposition = recover.disposition();
    // The last hop. The tick set has been held since WT-012.1 and nothing
    // read it, so every tick the user made was discarded at the submit and the
    // whole provisioning flow was inert end to end (.reviews/round-1.md F005).
    const provision = settledProvision();
    const migrateChanges = settledMigration();
    deps.onSubmit({
      ...draft,
      ...launch,
      ...(carried === null ? {} : { resolved: carried.mode }),
      ...(disposition === undefined ? {} : { disposition }),
      ...(provision === undefined ? {} : { provision }),
      ...(migrateChanges === undefined ? {} : { migrateChanges }),
      // Only where the control was actually offered — a non-agent create never
      // showed this choice, so nothing here is carried for it.
      ...(model.afterChoice() === "agent" ? { waitForSetup: waitBox.checked } : {}),
    });
    disposeAll();
  }

  /**
   * The one place the offered choice becomes a wire value, and the one place the
   * two reveals it drives are applied. Two different questions, and the agent box
   * keeps them apart: "this create is not launching" is ours, "there is nothing
   * to launch" is its own.
   */
  function syncAfterHint(): void {
    if (model.afterChoice() === "none") {
      afterNote.textContent = "No terminal, folder, or agent opens after creation.";
    } else if (model.afterChoice() === "terminal") {
      afterNote.textContent = "Opens a terminal in the worktree.";
    } else if (model.afterChoice() === "folder") {
      afterNote.textContent =
        model.folderMode() === "addToWorkspace"
          ? "Adds the worktree folder to this workspace."
          : "Opens the worktree folder in a separate window.";
    } else {
      const selected = agentBox.read().agentId;
      const label = currentRepo().agents.find((agent) => agent.id === selected)?.label ?? "the selected agent";
      afterNote.textContent = `Starts ${label} in the worktree.`;
    }
  }

  function syncOpenAfter(): void {
    model.applyOpenAfter();
    agentBox.setVisible(model.afterChoice() === "agent");
    syncAfterHint();
    folderField.hidden = model.afterChoice() !== "folder";
    // The submit gate reads the revealed block, so revealing one has to re-ask
    // it. `syncDerived` does not call back here, so this does not recurse.
    syncDerived();
  }

  /** A repo switch can withdraw the launch — the mode goes with it, not just the box. */
  function rebuildAfterOptions(): void {
    const offered = openAfterOptions(currentRepo().agents.length > 0);
    // Only a choice the rebuild actually withdrew is reset. The folder choice is
    // always offered, so a repo switch that drops the agent one must leave it —
    // and its secondary selection — exactly where the user put them.
    model.retargetAfterChoice(
      offered.map((o) => o.value),
      initialSafeAgentId(currentRepo().agents) === undefined ? "terminal" : "agent",
    );
    afterSelect.replaceChildren(
      ...offered.map((o) => {
        const opt = document.createElement("option");
        opt.value = o.value;
        opt.textContent = o.label;
        return opt;
      }),
    );
    afterSelect.value = model.afterChoice();
    syncOpenAfter();
  }

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

  /**
   * Why the base ref is unavailable, per mode. Absent means it applies.
   *
   * A total map rather than a condition, so a mode added later has to answer
   * the question rather than inherit an answer nobody wrote for it.
   */
  /**
   * What the create will do, in the user's terms.
   *
   * The spec requires the form to state which of create / check out / repair the
   * create would perform, before submit rather than as a failure after it.
   */
  const DETACHED_ACTION = "Creates a detached worktree at the commit this ref names.";

  const ACTION_BY_MODE: Record<ResolvedMode["kind"], string> = {
    fresh: "Creates a new branch here.",
    reuse: "Checks out the branch that already exists.",
    reattach: "Repairs the stale registration of the checkout already on disk.",
    adopt: "Re-registers the checkout already on disk, whose administrative entry is gone.",
  };

  /**
   * Why the destination override is unavailable, per mode. Absent means it
   * applies. Total, for the same reason `BASE_REFUSED_BY` is.
   */
  const DEST_REFUSED_BY: Record<WorktreeBranchMode, string | undefined> = {
    new: undefined,
    detached: undefined,
    existing: undefined,
    reattach: "This repairs a checkout that is already on disk, so it keeps the directory it is in.",
    adopt: "This re-registers a checkout that is already on disk, so it keeps the directory it is in.",
  };

  const BASE_REFUSED_BY: Record<WorktreeBranchMode, string | undefined> = {
    new: undefined,
    detached: undefined,
    existing: "This branch already exists, so it starts where it already is.",
    reattach: "This repairs a checkout that is already on disk, so it keeps the commit it is on.",
    adopt: "This re-registers a checkout that is already on disk, so it keeps the commit it is on.",
  };

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

  /**
   * Re-derive the path and its hint from the branch, and re-validate. The hint
   * names the collided path AND the suffixed one the create will actually use —
   * showing only the pretty default would be a claim the form cannot keep.
   */

  function syncDerived(settled = false): void {
    const repo = currentRepo();
    // From the INPUTS, not from `draft`. The draft's copies are written far
    // below (`draft.branchName = nameInput.value`), so reading them here saw the
    // previous render's text: the withdrawal and the seed rule both ran one
    // keystroke behind the field they are about.
    const activeTarget = (draft.branchMode === "detached" ? baseInput.value : nameInput.value).trim();
    if (activeTarget.length === 0) {
      asks.withdraw();
    }
    // Read ONCE, after the retirement above and before the ask below — both of
    // them null it, and a pass that re-read it between would draw half its
    // answer from the resolution it just discarded.
    const resolved = asks.resolution();
    repoHint.textContent = repo.mainPath;
    bringView.sync(repo.provisioning);
    syncMigration(repo.migration);
    syncWaitForSetup();

    const detached = draft.branchMode === "detached";
    nameInput.disabled = detached;
    nameInput.placeholder = draft.branchMode === "existing" ? "existing-branch" : "feat/…";
    baseInput.placeholder = detached ? "a ref to detach at" : "HEAD";
    // From `draft.branchMode` ALONE (D5), the same single-source rule the name
    // field already applies. The destination's disposition deliberately does
    // not enter into it: clearing the ground does not change where a new
    // branch starts (§ 2.1).
    const baseRefused = BASE_REFUSED_BY[draft.branchMode];
    baseInput.disabled = baseRefused !== undefined;
    baseNote.hidden = baseRefused === undefined;
    baseNote.textContent = baseRefused ?? "";
    const destRefused = DEST_REFUSED_BY[draft.branchMode];
    pathInput.disabled = destRefused !== undefined;
    // The action shares the override's own availability. `reattach` and `adopt`
    // withdraw the override because those modes do not let the user choose a
    // target, and an action that stayed live there would offer a destination
    // the form has withdrawn (design.md D1).
    if (pickDestination !== undefined) {
      // And refused while one pick is still unanswered. The form holds ONE
      // outstanding ask, so a second click overwrites it — and the second
      // pick's cancel then released a wait the first still owned, discarding a
      // folder the user had confirmed (round-4 F005). Closed where it starts:
      // there is never a second pick to lose the first to.
      //
      // Safe only under the amended D3. With every opened picker answered, this
      // control is given back by an answer that always comes; under the rule
      // that let a cancel go quiet it would have been unrecoverable.
      pickDestination.disabled = destRefused !== undefined || pickAsked !== null || bring.anyAsking();
    }
    pathNote.hidden = destRefused === undefined;
    pathNote.textContent = destRefused ?? "";
    if (destRefused !== undefined) {
      // WITHDRAWN, not merely ignored. Leaving the override standing would keep
      // it in `draft.path` and in the ask key, which is the split itself: the
      // form would submit the override while the mode carried the repair
      // target. The derivation below then refills the field with that target,
      // so the disabled control shows the directory actually being used.
      // The folder goes with it. A typed override is withdrawn for good — the
      // selection reads `pathIsDerived`, so it never returns — and a chosen
      // folder that merely went quiet and came back would give the form two
      // meanings of "withdrawn" and make the destination depend on history the
      // user cannot see (round-1 F004).
      model.withdrawDestination();
    }
    // The host's verdict on the base, which only applies where a base applies.
    // Reported BEFORE submit rather than as a git failure after it (D7).
    const verdict = baseRefused === undefined ? resolved?.baseValid : undefined;
    const baseUnresolvable = verdict !== undefined && verdict.ok === false;
    // Stated where the destination is, so it is legible without expanding the
    // Advanced body the base field lives in (round-1 W6).
    const actionText = baseUnresolvable
      ? (verdict as { ok: false; reason: string }).reason
      : detached
        ? // The mode the form will EXECUTE, not the one the answer carried. The
          // toggle discards the classification (D5), and the action note is a
          // statement of mode — leaving it on the answer's said a repair would
          // run while a detached create was submitted (round-6 B11).
          DETACHED_ACTION
        : resolved === null
          ? undefined
          : ACTION_BY_MODE[resolved.mode.kind];
    actionNote.hidden = actionText === undefined;
    actionNote.textContent = actionText ?? "";
    actionNote.classList.toggle("wt-dest-note--error", baseUnresolvable);
    // Named here rather than only in a confirmation step, so the losses are on
    // screen while the create can still be abandoned — the rule the fork note
    // beside it already follows (§ 5).
    const adopting = !detached && resolved?.mode.kind === "adopt" ? resolved.mode : undefined;
    adoptLosses.hidden = adopting === undefined;
    adoptLosses.textContent =
      adopting === undefined
        ? ""
        : `Re-registers ${adopting.adoptPath} on ${nameInput.value.trim()}. These did not survive and are not recovered: staged changes; an in-progress rebase, merge, bisect or cherry-pick; the worktree's own refs and reflog; its per-worktree configuration; its locked state.`;
    // Said, rather than left to look complete: a capped list presented as the
    // repository's whole set is the one claim this control must not make. Both
    // lists are capped independently, and the pull requests were silent about it
    // (.reviews/round-1.md B3).
    const refsPartial = repo.refs?.truncated === true;
    const prsPartial = repo.pullRequests?.available === true && repo.pullRequests.truncated;
    partialNote.hidden = !refsPartial && !prsPartial;
    partialNote.textContent = partialListText(refsPartial, prsPartial);

    draft.branchName = nameInput.value;
    draft.baseRef = baseInput.value;

    const forkStated = branches.forkStated(nameInput.value, draft.branchMode);
    forkNote.hidden = forkStated === null;
    // What is TRUE, not what would be convenient. Configuring the remote is a
    // repository-level write no part of this create performs (D5), and a
    // statement made to earn an authorization has to describe the create being
    // authorized (.reviews/round-1.md B1). So it states the requirement the fork
    // head carries and says plainly that this create does not meet it.
    forkNote.textContent =
      forkStated === null
        ? ""
        : `This pull request's head is on ${forkStated.owner}'s fork, so fetching that head requires a remote for ${forkStated.owner}. This create does not configure one.`;

    const slug = sanitizeBranchForPath(detached ? draft.baseRef : draft.branchName);
    // The HOST's answer wins whenever it has given one. The locally derived
    // path is the placeholder shape only — it is what the form would guess, and
    // guessing is exactly what the spec forbids: a create names the destination
    // it will actually use, and only the host knows which candidates are free
    // (round-3 B12).
    // The RESOLUTION's own path first: it answered the whole selection, and the
    // defaults reply answered only the branch (round-3 B3).
    // An accepted recover replaces it: clearing the ground is what makes the
    // skipped candidate available, so that — not the suffix — is where this
    // create lands, and the line has to say so before Create authorizes it.
    const recovered = recover.grantedPath();
    const answered = recovered ?? (resolved === null ? undefined : asks.targetOf(resolved));
    // The opening seed is the host's answer for `msg.branch ?? ""` — a concrete
    // free path, suffixed around whatever already occupies the bare candidate.
    // That is a decision about a create nobody has named yet, so while there is
    // no target the line falls back to the template `derived` builds from the
    // repository's own prefix (round-1 F002).
    const unnamed = activeTarget.length === 0;
    // The seed answers exactly one question — the opening request, which carries
    // no branch — so it may only speak where that question is this one. Keying it
    // on "the field is non-empty" put the empty name's suffixed path and its
    // collision under a branch the user had typed but not yet settled, which is
    // the same wrong-target statement as drawing them under no branch at all
    // (round-2 F002). `answersBranch` absent means the seed does not say what it
    // answered, and an answer that cannot identify its own question cannot claim
    // to be about this one.
    const seedAnswers = !unnamed && (repo.answersBranch ?? "").trim() === activeTarget;
    const resolvedPath = answered ?? (seedAnswers ? repo.resolvedPath : undefined);
    const derived = resolvedPath ?? (slug ? `${repo.pathParent}/${repo.pathPrefix}-${slug}` : "");
    if (model.pathIsDerived()) {
      // Whoever owns the caret owns the text. Guarding the CALLERS was the
      // round-2 fix and it left the other eight unguarded by construction — the
      // answer callback arrives on the host's schedule, so it is the one that can
      // land while the user is mid-edit, and the characters they type next append
      // to a value they cannot see. The rule belongs at the write.
      if (document.activeElement !== pathInput) {
        pathInput.value = derived;
      }
    }
    pathInput.placeholder = `…/${repo.pathPrefix}-<branch>`;

    // The answer owns the destination once it lands, override or not: a supplied
    // path is the candidate the probe carried, and what the form states and
    // submits is what came back about it (D8). Before any answer there is only
    // the candidate, or the derived shape.
    //
    // A TYPED override is stated exactly even while nothing is named, and is the
    // deliberate exception to the rule above it. What the unnamed create must
    // not show is a DECISION nobody asked for — a suffix around a collision the
    // host worked out for the empty name. An override is not one of those: it is
    // the user's own text, and echoing it back as a template would be the form
    // editing what they typed (round-2 F004).
    const stated = answered ?? (model.pathIsDerived() ? derived : model.supplied());
    // ONE value, read by the line and by the submission — the split between them
    // is what let a create display one directory and hand git another.
    model.statePath(stated);
    if (stated) {
      destExact = stated;
      dest.setAttribute("aria-label", stated);
      destShort.textContent = shortPath(stated);
      destExactText.textContent = stated;
      dest.classList.remove("wt-dest--pending");
      ensureDestTip();
    } else {
      // Nothing is resolved yet, so nothing is claimed. The default SHAPE is not
      // a destination and is not shortened as though it were one.
      destExact = "";
      dest.removeAttribute("aria-label");
      destShort.textContent = `Defaults to …/${repo.pathPrefix}-<branch>`;
      destExactText.textContent = "";
      dest.classList.add("wt-dest--pending");
    }

    // One line, and it names the RESULT. The destination above already carries
    // the path, so repeating it in full here is the second statement the form
    // exists to stop making. An override retires the note with the derived path
    // it described.
    destNote.hidden = true;
    destNote.replaceChildren();
    // The candidate the suffixing SKIPPED, from the resolution that skipped it.
    // `collidedWith` is the defaults reply's answer to the narrower question,
    // and kept only until a resolution has spoken (round-3 B3).
    // Before any answer an override retires it: the defaults reply answered the
    // branch, and it knows nothing about the path the user then typed. Once the
    // answer lands the note is the whole point of an override — it is what says
    // the candidate was occupied and names what the create took instead.
    // An accepted recover retires it: the candidate is not being skipped any
    // more, and "so this is created as <suffix>" would name a path this create
    // no longer takes.
    const skipped =
      recovered !== undefined
        ? ""
        : resolved === null
          ? model.pathIsDerived() && seedAnswers
            ? repo.collidedWith
            : ""
          : lastSegment(resolved.occupiedCandidate?.path ?? "");
    if (skipped) {
      destNote.hidden = false;
      const taken = document.createElement("b");
      taken.textContent = skipped;
      // No leading `…`. The host sends a directory name, so there is nothing
      // elided to mark — and when this field still carried a whole path, the
      // marker shortened none of it (worktree-create.md § 4.2).
      destNote.append(taken, document.createTextNode(" already exists"));
      if (resolvedPath) {
        const final = document.createElement("b");
        final.textContent = lastSegment(resolvedPath);
        destNote.append(document.createTextNode(", so this is created as "), final, document.createTextNode("."));
      } else {
        destNote.append(document.createTextNode("; a free suffix is chosen when the worktree is created."));
      }
    }

    recover.render();

    const heldBy = asks.heldBranch();
    // git's own answer about the name on screen. The resolution is nulled on every
    // new ask and only set for an answer whose `query` matches the field, so a
    // verdict for a name the user has typed past cannot speak here.
    //
    // Read as an ERROR rather than as a reason for the disabled action: the
    // field already has the vocabulary for a refusal, and `blockedBy` reads
    // `error` first, so a refused name never reads as one still being checked.
    const branchRefused = !detached && resolved?.branchValid?.ok === false ? resolved.branchValid.reason : undefined;
    // An empty field the user has not answered yet is not a name they got wrong.
    // Every refusal below is ABOUT the branch name, so one guard covers them.
    const unanswered = !detached && !nameLeft && draft.branchName.trim().length === 0;
    const error = unanswered
      ? undefined
      : heldBy !== undefined
        ? `${draft.branchName.trim()} is checked out in ${heldBy}`
        : detached
          ? undefined
          : branchRefused;
    nameError.textContent = error ?? "";
    nameError.hidden = !error;
    nameInput.classList.toggle("is-invalid", Boolean(error));
    if (error) {
      nameInput.setAttribute("aria-invalid", "true");
    } else {
      nameInput.removeAttribute("aria-invalid");
    }

    // Asked here, before the button state below reads `outstanding` — a request
    // raised after it would leave Create enabled for one render on a path the
    // host has not resolved yet.
    //
    // Only on a SETTLED edit. `syncDerived` runs per keystroke to keep the form
    // responsive, and asking from there made this a request per character
    // despite the comment on `edited` promising otherwise (round-3 B6). The
    // drift guard below is what makes waiting safe.
    if (settled) {
      asks.ask();
    }
    // The selection on screen is not the one the host answered about. Between a
    // keystroke and the edit settling that is the normal state, and submitting
    // in it would submit against a classification for different text.
    const unasked = asks.unasked();

    // A create with no target is not offered — the button is disabled, not a
    // dialog that fails after the click.
    const named = detached ? draft.baseRef.trim().length > 0 : draft.branchName.trim().length > 0;
    // `outstanding`: the destination on screen is not yet the one the host
    // resolved for this branch, so submitting now submits a stale path.
    // A revealed posture list with nothing selected is an unmade choice, not a
    // default — submitting here would launch under a posture the user never
    // picked, which is the whole point of never preselecting one.
    const postureMissing = model.afterChoice() === "agent" && agentBox.needsPosture();
    // Blocked either way — Create is never offered without a target. What waits
    // is only the SENTENCE: naming the empty field before the user has been in
    // it is the scold, not the disabled button.
    const unprompted = detached ? !baseLeft : !nameLeft;
    const blockedBy =
      error ??
      (!named
        ? unprompted
          ? ""
          : detached
            ? "Enter a ref to detach at."
            : "Enter a branch name."
        : unasked
          ? "Waiting to check this selection."
          : asks.classifying()
            ? "Checking whether the branch is new, reusable, or repairable."
            : draft.path.trim().length === 0
              ? "Waiting for a destination."
              : asks.outstanding() || pickAsked !== null
                ? "Checking the destination."
                : bring.anyCopyAsking()
                  ? "Waiting for the file picker."
                  : bring.anyStepAsking()
                    ? "Waiting for the setup step."
                    : recover.asking()
                      ? "Reading the existing folder before it can be cleared."
                      : baseUnresolvable
                        ? (verdict as { ok: false; reason: string }).reason
                        : postureMissing
                          ? "Choose a permission mode before starting the agent."
                          : undefined);
    createBtn.disabled = blockedBy !== undefined;
    // An empty reason is still a reason to disable — it is the one the form is
    // deliberately not stating yet — so it must not be drawn as a blank line.
    disabledReason.hidden = !blockedBy;
    disabledReason.textContent = blockedBy ?? "";
    if (!blockedBy) {
      createBtn.removeAttribute("aria-describedby");
    } else {
      createBtn.setAttribute("aria-describedby", disabledReason.id);
    }
    syncAfterHint();
    shell.refreshFocusTrap();
  }

  // `change` rather than `input`: asking the host on every keystroke would be a
  // request per character. `input` still re-renders locally, so the field never
  // feels laggy — only the authoritative destination waits for the edit to settle.
  const edited = (): void => {
    syncDerived(true);
  };
  nameInput.addEventListener("input", () => {
    nameTyped = true;
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
    nameLeft = nameLeft || nameTyped || nameInput.value.trim().length > 0;
    syncDerived(true);
  });
  nameInput.addEventListener("keydown", (ev) => {
    branchList.onNameKeyDown(ev);
  });
  baseInput.addEventListener("input", () => {
    baseTyped = true;
    syncDerived();
  });
  baseInput.addEventListener("change", edited);
  baseInput.addEventListener("blur", () => {
    baseLeft = baseLeft || baseTyped || baseInput.value.trim().length > 0;
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

  // A fresh answer replaces the repo's seed and re-renders. Only the path the
  // user has not typed over moves — an edited path is theirs.
  // One transition, not a second one: the picked folder is stated exactly as a
  // typed one is. The controller has already dropped an answer for any opening
  // but this form's, so there is no second place deciding that here.
  deps.bindDestinationPicked?.((answer) => {
    // Only the pick this form is still waiting on. The controller drops an
    // answer for another OPENING; this drops one for another PICK, which is the
    // case a user who picked, then typed, then saw the first answer land would
    // otherwise lose their typed path to (design.md D7).
    if (answer.ask !== pickAsked) {
      return;
    }
    pickAsked = null;
    // PRESENCE, not value. Absent means the pick ended without a folder — a
    // cancel, a failure, an unwired capability, a pick a newer one superseded —
    // and the wait above is all that had to end. The path itself is never read:
    // it is the host's own folder coming back, and the host is what derives
    // inside it, so taking it here would put a webview-composed destination on
    // the wire (design.md D1, D5).
    if (answer.path === undefined) {
      syncDerived();
      return;
    }
    stateDestination({ kind: "chosen" });
  });

  deps.bindDefaults?.((next) => {
    // Replies race the typing that produced them. An answer for a branch the
    // form has already moved past would put a destination on screen that no
    // longer matches the name beside it (round-4 B12).
    // Compared against the key the question was asked under, so an answer for the
    // right branch but the wrong repository is discarded like any other stale one.
    if (!asks.answersOurDefaults(next)) {
      return;
    }
    const at = repos.findIndex((r) => r.repoId === next.repoId);
    if (at >= 0) {
      // The DESTINATION is what was asked for, and the only part of the answer
      // this dialog may take. `createRepos()` stamps the panel's live agent list
      // into every answer, and the host answers per keystroke — splicing the
      // record wholesale would relabel the user's choice as they type, and
      // `A launch is submitted as the offer it was shown` says a dialog submits
      // what it was OPENED against. An earlier fix here took the whole record
      // and did exactly that; keeping the agents is what makes the refresh safe.
      const opened = repos[at];
      repos[at] = opened === undefined ? next : { ...next, agents: opened.agents };
    } else {
      repos.push(next);
    }
    asks.settleDestination();
    syncDerived();
  });

  // The offer's own channel. It redraws the section and touches nothing else —
  // in particular not `outstanding`, which is the destination's gate (B4).
  deps.bindProvisioning?.((repoId, offer) => {
    const at = repos.findIndex((r) => r.repoId === repoId);
    const opened = repos[at];
    if (at < 0 || opened === undefined) {
      return;
    }
    repos[at] = { ...opened, provisioning: offer };
    if (repoId === draft.repoId) {
      const wasPending = bring.anyAsking();
      bringView.sync(offer);
      // The gate is only read on a derive, and an answered ask is what
      // re-arms Create — the same reason the pick re-derives on its answer.
      if (wasPending && !bring.anyAsking()) {
        syncDerived();
      }
      return;
    }
    // The hold is form-wide, so an answer for a repository the picker has
    // since left must still release it (round 1 F002) — and still settle that
    // repository's selection, so returning to it finds the ticks it left
    // rather than the model's defaults.
    if (!bring.settleAway(repoId, offer)) {
      return;
    }
    bringView.syncControls();
    if (!bring.anyAsking()) {
      syncDerived();
    }
  });

  deps.bindMigration?.((repoId, offer) => {
    const at = repos.findIndex((repo) => repo.repoId === repoId);
    const opened = repos[at];
    if (at < 0 || opened === undefined) {
      return;
    }
    const next = { ...opened, migration: offer };
    if (offer === undefined) {
      delete next.migration;
    }
    repos[at] = next;
    if (repoId === draft.repoId) {
      syncMigration(offer);
    }
  });

  // The branch list's own channel, on the same terms: it touches `outstanding`
  // no more than the offer does. Stored here and rendered by the combobox.
  // Indexed once. A linear scan per reply is O(repos²) across a workspace's
  // answers — the shape round-1 S1 named on the destination channel (W3).
  const repoAt = new Map(repos.map((r, at) => [r.repoId, at]));
  // Its own channel, and deliberately not folded into `bindRefs`: the whole
  // point of the separate message is that the local list never waits for the
  // forge (§ 4.1), and one binding would put them back on one arrival.
  deps.bindPullRequests?.((repoId, offer) => {
    if (model.closed()) {
      return;
    }
    const at = repoAt.get(repoId);
    const opened = at === undefined ? undefined : repos[at];
    if (at === undefined || opened === undefined) {
      return;
    }
    repos[at] = { ...opened, pullRequests: offer };
    if (repoId !== draft.repoId) {
      return;
    }
    branchList.refreshIfOpen();
    // The partial notice has exactly one writer, and this is the path the forge
    // actually takes — the seeded offer was the only one that ever reached it
    // (.reviews/round-2.md B3). Unsettled, as `bindRefs` leaves it: an answer
    // arriving is not the user finishing an edit, and the destination gate is
    // not this callback's to arm.
    syncDerived();
  });
  deps.bindRefs?.((repoId, refs) => {
    if (model.closed()) {
      return;
    }
    const at = repoAt.get(repoId);
    const opened = at === undefined ? undefined : repos[at];
    if (at === undefined || opened === undefined) {
      return;
    }
    repos[at] = { ...opened, refs };
    if (repoId !== draft.repoId) {
      return;
    }
    // A list that lands while the user has already typed re-decides what the
    // typed text means — in both directions, which is why it goes through the
    // one derivation rather than upgrading in place (B2).
    asks.deriveChoice();
    branchList.refreshIfOpen();
    syncDerived();
  });

  // What the create would DO, on its own channel — and, since the resolution
  // now owns the destination it names, an answer to the same question the
  // defaults reply answers (round-3 B3).
  deps.bindResolution?.((resolution) => {
    if (model.closed() || resolution.repoId !== draft.repoId) {
      return;
    }
    asks.applyResolution(resolution);
  });

  // The answer to the ONE request the acceptance sent. Anything about another
  // directory is dropped rather than applied: an authorization is bound to a
  // path, and applying one issued for a different path is exactly the confusion
  // the fingerprint exists to stop.
  deps.bindDebrisAuthorization?.((answer) => {
    if (model.closed() || answer.repoId !== draft.repoId) {
      return;
    }
    recover.applyAnswer(answer);
  });

  syncOpenAfter();
  shell.focusInitial(nameInput);

  return disposeAll;
}
