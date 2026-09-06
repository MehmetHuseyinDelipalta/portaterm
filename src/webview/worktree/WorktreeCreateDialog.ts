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
  DebrisAuthorization,
  ProbeBase,
  ResolvedMode,
  WorktreeCreateResolutionMessage,
  WorktreeDebrisAuthorizedMessage,
  WorktreeDestinationPickedMessage,
  WorktreeSetupStepAskMessage,
} from "../../types/messages";
import { SETUP_STEP_ADDED_SOURCE } from "../../types/messages";
import { sanitizeBranchForPath } from "../../worktree/branchSlug";
import { attachTooltip } from "../ui/Tooltip";
import { ICON_CHEVRON_DOWN, ICON_FOLDER } from "../vault/icons";
import { CREATE_ROW_LABEL, createBranchChoices, partialListText } from "./createDialog/branchChoices";
import { bothOrAll, claimingPerGroup } from "./createDialog/bringContention";
import { bringProblem, bringRow, switchRow } from "./createDialog/bringRowView";
import { bringRows, bringSummary, carryForward } from "./createDialog/bringSummaries";
import { type AfterChoice, createDraftModel, type DestinationEdit } from "./createDialog/draftModel";
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

/**
 * The destination, shortened for reading. Two trailing segments: one is not
 * enough to tell `…/anywhere-terminal-feat-x` in one root from the same name in
 * another, and the exact value is a focus or a hover away regardless.
 */
function segments(path: string): string[] {
  // Both separators. The host builds these with `node:path`, which produces `\\`
  // on Windows — splitting on `/` alone leaves such a path whole, so the line
  // renders unshortened and the collision note restates it in full: the two
  // things this form exists to stop doing. Same idiom the file-tree panel and
  // its data source already use, both module-private to their own files.
  return path.split(/[/\\]/).filter(Boolean);
}

function shortPath(path: string): string {
  const parts = segments(path);
  return parts.length <= 2 ? path : `…/${parts.slice(-2).join("/")}`;
}

function lastSegment(path: string): string {
  return segments(path).at(-1) ?? path;
}

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

/** Everything the host needs to say what a submit of this form would do. */
export interface CreateSelection {
  repoId: string;
  /** The branch being named, or the ref being detached at. */
  branch: string;
  /** Absent where the mode refuses a base, so no verdict is asked for one. */
  base?: ProbeBase;
  /** Present only where the user typed over the derived destination. */
  candidatePath?: string;
  /** Present only where the host still holds a folder this form chose. */
  useChosenFolder?: true;
}

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
  /** How many picks this form has opened. Minted like `recoverAsks` (D7). */
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
      if (!listOpen) {
        return false;
      }
      closeList();
      return true;
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

  shell.dialog.appendChild(dialogTitle("Create worktree", undefined, cancel));

  // ── Branch name — the lead input, with nothing above it ──────────────────
  // It is the one thing only the user can supply; everything else on this form
  // is derived, defaulted, or advanced (worktree-actions § 3.2.1).
  const nameField = field("Branch name", "wt-branch");
  const nameInput = document.createElement("input");
  nameInput.className = "wt-input";
  nameInput.id = "wt-branch";
  nameInput.type = "text";
  nameInput.placeholder = "feat/…";
  const nameError = document.createElement("span");
  nameError.className = "wt-ferror";
  nameError.hidden = true;

  // ── The branch list — one box, refs and create-new together ─────────────
  // Plain listbox markup rather than the vendored virtualized widget: the list
  // is capped host-side, and the widget brings its own focus and keyboard model
  // into a dialog that already owns a focus trap and an Escape contract (D6).
  nameInput.setAttribute("role", "combobox");
  nameInput.setAttribute("aria-autocomplete", "list");
  nameInput.setAttribute("aria-expanded", "false");
  nameInput.setAttribute("aria-controls", "wt-branch-list");
  // Described by the notice, so the "this list is partial" claim reaches a
  // reader who never sees it rendered (round-1 S1).
  nameInput.setAttribute("aria-describedby", "wt-branch-partial");
  nameInput.autocomplete = "off";

  const listBox = document.createElement("ul");
  listBox.className = "wt-branch-list";
  listBox.id = "wt-branch-list";
  listBox.setAttribute("role", "listbox");
  listBox.setAttribute("aria-label", "Branches");
  listBox.hidden = true;

  const partialNote = document.createElement("span");
  partialNote.className = "wt-fhint";
  partialNote.id = "wt-branch-partial";
  partialNote.hidden = true;

  const branches = createBranchChoices({
    refs: () => offeredRefs(),
    repoId: () => draft.repoId,
    pullRequests: () => currentRepo().pullRequests,
  });
  /** Which row is active while the list is open; -1 when none is. */
  let activeAt = -1;
  let listOpen = false;

  // The popup is positioned against this field, so the field is the containing
  // block. Scoped to a class rather than `.wt-field` — every other field on the
  // form would inherit a positioning context it has no use for.
  nameField.classList.add("wt-field--combo");
  nameField.append(nameInput, listBox, partialNote, nameError);
  shell.dialog.appendChild(nameField);

  // ── Destination — one derived line, not a field ─────────────────────────
  // Stated once, shortened. `aria-label` and the tooltip carry the exact value,
  // so shortening costs nothing: the safety property is that the user sees where
  // the write lands before authorizing it, not that they read it in full.
  const destWrap = document.createElement("div");
  destWrap.className = "wt-dest-wrap";
  const dest = document.createElement("div");
  dest.className = "wt-dest";
  // `attachTooltip` exposes its target on focus, but does not make it focusable.
  // Without this the exact value is a mouse-only affordance.
  dest.tabIndex = 0;
  /** The shortened text, which is for reading and not for announcing. */
  const destShort = document.createElement("span");
  destShort.setAttribute("aria-hidden", "true");
  /**
   * The exact value, for assistive tech only. NOT `aria-label` on `dest`: its
   * implicit role is `generic`, which prohibits naming, so the attribute is
   * simply not exposed — the attribute stays for tests and for anything reading
   * the DOM, but this element is what actually announces the path.
   */
  const destExactText = document.createElement("span");
  destExactText.className = "wt-visually-hidden";
  dest.append(destShort, destExactText);
  const destNote = document.createElement("div");
  destNote.className = "wt-dest-note";
  destNote.hidden = true;
  /**
   * What the create would DO, stated where the destination is.
   *
   * The spec requires the form to say which of create / check out / repair the
   * create performs, and the base-ref rule to be legible. Both lived inside the
   * collapsed Advanced body, so neither was discoverable without expanding
   * unrelated content (round-1 B3, W6).
   */
  const actionNote = document.createElement("div");
  actionNote.className = "wt-dest-note";
  actionNote.id = "wt-action-note";
  actionNote.hidden = true;
  /**
   * The recover offer: a destination the suffixing skipped because a directory
   * with no `.git` sits there (worktree-create.md § 2.2).
   *
   * A checkbox rather than a bare statement, because accepting it is what asks
   * the host for the authorization — the offer is the question, and Create is
   * the authorization. It sits with the destination because it CHANGES the
   * destination: recovered, the create takes the skipped path, not the suffix.
   */
  /**
   * The fork remote, stated before the create is authorized (§ 5, D5).
   *
   * With the destination rather than in the list, because it describes what the
   * create would DO to the repository — configuring a remote is a
   * repository-level side effect, and § 5 requires it to be legible while the
   * create can still be abandoned rather than reported after it.
   */
  const forkNote = document.createElement("div");
  forkNote.className = "wt-dest-note";
  forkNote.id = "wt-fork-note";
  forkNote.hidden = true;
  /**
   * What an adoption cannot restore, stated before it is authorized (D8).
   *
   * A fixed list rather than a probe result: the directory that held the
   * evidence is exactly what was deleted, so none of the five can be checked
   * after the fact — and a check that cannot fail is worse than a stated
   * limitation (worktree-create.md § 2.4).
   */
  const adoptLosses = document.createElement("p");
  adoptLosses.className = "wt-fhint";
  adoptLosses.id = "wt-adopt-losses";
  adoptLosses.hidden = true;
  const recoverField = document.createElement("div");
  recoverField.className = "wt-recover";
  recoverField.id = "wt-recover";
  recoverField.hidden = true;
  const recoverLabel = document.createElement("label");
  recoverLabel.className = "wt-recover-label";
  recoverLabel.htmlFor = "wt-recover-accept";
  const recoverBox = document.createElement("input");
  recoverBox.type = "checkbox";
  recoverBox.id = "wt-recover-accept";
  const recoverText = document.createElement("span");
  recoverLabel.append(recoverBox, recoverText);
  /** What is there, or why it will not be cleared. Never a claim about a path this create left behind. */
  const recoverNote = document.createElement("p");
  recoverNote.className = "wt-fhint";
  recoverNote.id = "wt-recover-note";
  recoverNote.hidden = true;
  recoverField.append(recoverLabel, recoverNote);
  destWrap.append(dest, destNote, actionNote, forkNote, adoptLosses, recoverField);
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

  // ── Repository (only with more than one) ────────────────────────────────
  // Below the destination it derives, never above the lead input.
  const repoHint = document.createElement("span");
  repoHint.className = "wt-fhint";
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
      deriveChoice();
      if (listOpen) {
        renderList();
      }
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

  const modeField = field("Branch source");
  const detachToggle = document.createElement("button");
  detachToggle.type = "button";
  detachToggle.className = "vault-segmented";
  detachToggle.id = "wt-detached";
  detachToggle.dataset.mode = "detached";
  detachToggle.setAttribute("aria-pressed", "false");
  detachToggle.textContent = "Detach at a ref instead";
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
      deriveChoice();
    }
    closeList();
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
    syncStepControls();
    syncDerived(!fromInput);
  };

  const baseField = field("Base ref", "wt-base", true);
  const baseInput = document.createElement("input");
  baseInput.className = "wt-input wt-input--mono";
  baseInput.id = "wt-base";
  baseInput.type = "text";
  baseInput.placeholder = "HEAD";
  baseField.appendChild(baseInput);
  explain(
    labelOf(baseField),
    "The base ref is the commit the new branch starts from — a branch name, a tag, or a commit id. Left empty it starts from HEAD, the commit this repository is on now.",
  );
  // Disabled, never hidden (D5): a field that vanishes when the mode changes
  // reads as a bug, and a base ref silently ignored is what § 2.1 forbids.
  const baseNote = document.createElement("p");
  baseNote.className = "wt-fhint";
  baseNote.id = "wt-base-note";
  baseNote.hidden = true;
  baseInput.setAttribute("aria-describedby", "wt-base-note");
  baseField.appendChild(baseNote);

  // The override, which is a different thing from a statement of where the
  // worktree will go — hence its home here rather than on the form's face.
  const pathField = field("Destination override", "wt-path", true);
  const pathInput = document.createElement("input");
  pathInput.className = "wt-input wt-input--mono";
  pathInput.id = "wt-path";
  pathInput.type = "text";
  // The input and the action sit on one line: the action states a destination
  // into that field, so putting it anywhere else would read as a second way to
  // say a different thing.
  const pathRow = document.createElement("div");
  pathRow.className = "wt-path-row";
  pathRow.appendChild(pathInput);
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
      if (anyAsking()) {
        return;
      }
      // Minted here, like `recoverAsks` above: `token` separates two openings
      // and this separates two picks inside one, so an answer to an earlier
      // pick cannot be mistaken for an answer to this one (design.md D7).
      pickAsks += 1;
      pickAsked = pickAsks;
      deps.onPickDestination?.({ repoId: currentRepo().repoId, ask: pickAsks });
      syncStepControls();
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
  const pathNote = document.createElement("p");
  pathNote.className = "wt-fhint";
  pathNote.id = "wt-path-note";
  pathNote.hidden = true;
  pathInput.setAttribute("aria-describedby", "wt-path-note");
  pathField.appendChild(pathNote);

  const migrationField = field("Uncommitted work", "wt-migrate-changes");
  migrationField.classList.add("wt-migration");
  migrationField.hidden = true;
  const migrationRow = document.createElement("label");
  migrationRow.className = "wt-check-row";
  const migrationBox = document.createElement("input");
  migrationBox.type = "checkbox";
  migrationBox.id = "wt-migrate-changes";
  const migrationText = document.createElement("span");
  migrationRow.append(migrationBox, migrationText);
  migrationField.appendChild(migrationRow);
  shell.dialog.appendChild(migrationField);

  // ── Bring over — what the new worktree will NOT inherit ─────────────────
  // Below the destination and above the after-create choice, because it
  // describes the worktree being made rather than what happens once it exists.
  // The section is never a gate: a repository that declares nothing, and one
  // whose provider file cannot be read, both still submit.
  const bringField = field("Bring over");
  bringField.classList.add("wt-bring");
  const bringSum = document.createElement("span");
  bringSum.className = "wt-bring-sum";
  bringField.firstChild?.appendChild(bringSum);
  const bringBox = document.createElement("div");
  bringBox.className = "wt-bring-box";
  // Not an empty list. "This repository needs nothing brought over" and "we did
  // not look" are different statements, and an empty box says neither — so the
  // empty case is the sentence, naming what the worktree will actually lack.
  const bringEmpty = document.createElement("div");
  bringEmpty.className = "wt-bring-empty";
  // A finding, not a guess: naming `.env` as absent was a claim about a file
  // that, when present, the fallback detector now offers as a suggestion.
  bringEmpty.textContent = "No configured items or supported repository-root suggestions were found.";
  bringField.append(bringBox, bringEmpty);
  shell.dialog.appendChild(bringField);

  // Attached only while an offer is drawn, and removed rather than disabled
  // when one is not: a save pressed before the host has answered would
  // record the empty selection as "bring nothing over", which is a statement
  // the user never made.
  const saveRow = document.createElement("div");
  saveRow.className = "wt-bring-save-row";
  const saveButton = document.createElement("button");
  // Explicitly a button, like the switch rows: a default-type button inside the
  // form SUBMITS, and a create started by pressing Save is the one thing
  // this must never do.
  saveButton.type = "button";
  saveButton.className = "wt-bring-save";
  saveButton.textContent = "Save current choices as defaults";
  // What the repository will NOT keep, said before the save rather than after
  // it. Setup steps and ports are the two choices the configuration has no
  // vocabulary for — § 7 forbids persisting a pre-ticked command, and an
  // unallocated port has no path for `exclude` to match (design.md D6).
  const saveNote = document.createElement("span");
  saveNote.className = "wt-bring-save-note";
  saveNote.id = "wt-bring-save-note";
  // Only the half the label does not already carry. "Save current choices as
  // defaults" says what the press records; what it cannot say is what it leaves
  // out, and that is the whole note now.
  saveNote.textContent = "Added files, setup steps and ports apply to this create only.";
  // The note states what pressing this does NOT record. A sighted user reads it
  // beside the button; without the association a screen reader announces the
  // button alone, which is the half of the sentence that sounds complete
  // (.reviews/round-1.md F014).
  saveButton.setAttribute("aria-describedby", saveNote.id);
  saveRow.append(saveButton, saveNote);
  saveButton.addEventListener("click", () => {
    // Resolved at event time, never captured: item ids are offer-local, so a
    // handler closing over one redraw's set would write into an offer the form
    // no longer holds (round-2 W5).
    if (
      drawnOfferId === null ||
      drawnModel === null ||
      pendingSwitch.has(draft.repoId) ||
      pendingSave.has(draft.repoId) ||
      anyAsking()
    ) {
      return;
    }
    const ticked = checkedByOffer.get(drawnOfferId);
    if (ticked === undefined) {
      return;
    }
    switchSeq += 1;
    // The model too, not just the ids: the answering offer mints new ones, and
    // matching the two requires knowing what each old id stood for (F018).
    pendingSave.set(draft.repoId, { offerId: drawnOfferId, model: drawnModel, kept: new Set(ticked) });
    saveButton.disabled = true;
    deps.onProvisionSave?.({
      repoId: draft.repoId,
      switch: switchSeq,
      offerId: drawnOfferId,
      kept: [...ticked],
    });
  });

  // ── Add a file to copy for this create ──────────────────────────────────
  // The pathname never enters this form. The extension owns the picker and
  // answers with a fresh opaque offer carrying display material only.
  const addCopyRow = document.createElement("div");
  addCopyRow.className = "wt-bring-add";
  const addCopyButton = document.createElement("button");
  addCopyButton.type = "button";
  addCopyButton.className = "wt-bring-add-action wt-bring-add-copy";
  addCopyButton.textContent = "Add file to copy…";
  addCopyRow.appendChild(addCopyButton);
  addCopyButton.addEventListener("click", () => {
    if (
      drawnOfferId === null ||
      drawnModel === null ||
      pendingSwitch.has(draft.repoId) ||
      pendingSave.has(draft.repoId) ||
      anyAsking() ||
      pickAsked !== null
    ) {
      return;
    }
    const ticked = checkedByOffer.get(drawnOfferId);
    if (ticked === undefined) {
      return;
    }
    switchSeq += 1;
    pendingCopy.set(draft.repoId, {
      offerId: drawnOfferId,
      model: drawnModel,
      kept: new Set(ticked),
      restoreFocus: document.activeElement === addCopyButton,
    });
    deps.onCopyFileAsk?.({ repoId: draft.repoId, switch: switchSeq });
    syncStepControls();
    syncDerived();
  });

  // ── Add a setup step for this create ────────────────────────────────────
  // Rendered last inside the box, only while an offer is drawn, and only where
  // an ask can be posted. The text is typed into the HOST's input, not here.
  const addStepRow = document.createElement("div");
  addStepRow.className = "wt-bring-add";
  const addStepButton = document.createElement("button");
  addStepButton.type = "button";
  addStepButton.className = "wt-bring-add-action wt-bring-add-step wt-bring-add-setup";
  addStepButton.textContent = "Add setup step…";
  addStepButton.title = "Run a command in the new worktree after files are brought over. Applies to this create only.";
  addStepRow.appendChild(addStepButton);
  const askStep = (op: WorktreeSetupStepAskMessage["op"], pressed?: HTMLElement): void => {
    if (
      drawnOfferId === null ||
      drawnModel === null ||
      pendingSwitch.has(draft.repoId) ||
      pendingSave.has(draft.repoId) ||
      anyAsking() ||
      pickAsked !== null
    ) {
      return;
    }
    const ticked = checkedByOffer.get(drawnOfferId);
    if (ticked === undefined) {
      return;
    }
    let removing: number | undefined;
    let ordinal = addedOf(drawnModel).length;
    if (op.kind !== "add") {
      ordinal = addedOf(drawnModel).findIndex((step) => step.id === op.itemId);
      if (ordinal < 0) {
        return;
      }
      if (op.kind === "remove") {
        removing = ordinal;
      }
    }
    switchSeq += 1;
    const pressedControl = pressed ?? addStepButton;
    pendingStep.set(draft.repoId, {
      offerId: drawnOfferId,
      model: drawnModel,
      kept: new Set(ticked),
      pressed: { kind: op.kind, ordinal },
      restoreFocus: document.activeElement === pressedControl,
      ...(removing === undefined ? {} : { removing }),
    });
    deps.onSetupStepAsk?.({ repoId: draft.repoId, switch: switchSeq, op });
    // Create is withheld from this moment; the gate is only read on a derive.
    syncStepControls();
    syncDerived();
  };
  addStepButton.addEventListener("click", () => askStep({ kind: "add" }, addStepButton));
  // A user who moved on while the input was open is not pulled back (D5).
  shell.dialog.addEventListener("focusin", (ev) => {
    if (!(ev.target instanceof HTMLElement) || ev.target === document.body) {
      return;
    }
    const stepping = pendingStep.get(draft.repoId);
    if (stepping !== undefined) {
      stepping.restoreFocus = false;
    }
    const copying = pendingCopy.get(draft.repoId);
    if (copying !== undefined) {
      copying.restoreFocus = false;
    }
  });
  /** Enablement of every control an in-flight ask must hold, derived, never toggled. */
  function syncStepControls(): void {
    const asking = anyAsking();
    const busy = asking || pendingSwitch.has(draft.repoId) || pendingSave.has(draft.repoId) || pickAsked !== null;
    if (repoSelect !== undefined) {
      // The input belongs to the form, and changing repository would let
      // every gate below read a repository that never asked (round 1 F002).
      repoSelect.disabled = asking;
    }
    addCopyButton.disabled = busy;
    addStepButton.disabled = busy;
    for (const checkbox of bringBox.querySelectorAll<HTMLInputElement>(".wt-brow-cb")) {
      checkbox.disabled = asking;
    }
    for (const button of bringBox.querySelectorAll<HTMLButtonElement>(".wt-brow-step")) {
      button.disabled = busy;
    }
    // A switch is latest-wins and may be taken over an in-flight switch or
    // save; only an open input holds it, since its answer would land in a
    // source the user had moved on from (design.md D5).
    for (const b of bringBox.querySelectorAll<HTMLButtonElement>(".wt-bring-switch-take")) {
      b.disabled = asking;
    }
    saveButton.disabled = pendingSave.has(draft.repoId) || asking;
  }

  let drawnMigrationOfferId: string | null = null;

  function migrationAllowed(): boolean {
    return (
      draft.branchMode === "detached" ||
      (draft.branchMode !== "reattach" && effective?.mode.kind !== "reattach" && effective?.mode.kind !== "adopt")
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

  /** The offer currently drawn, so an unchanged one is not redrawn. */
  let drawnOfferId: string | null = null;
  /**
   * Per repository, the offer a switch was taken AGAINST and not yet answered for.
   *
   * The offer on screen is superseded the moment a source is taken, so a save
   * pressed before the replacement arrives would record the SUPERSEDED source —
   * and, because it mints the higher sequence, would make the switch fail its
   * own re-check and vanish with no report. The control is removed for exactly
   * as long as that is true, which is the same statement its absence already
   * makes when no offer has arrived: there is nothing here this save can
   * honestly be about (design.md D15).
   *
   * Keyed by repository, and holding the offer id rather than a boolean, because
   * one form-wide flag could not survive the repo picker: moving away and back
   * re-supplies the SAME cached offer, and a flag cleared by any redraw restored
   * the control with the switch still in flight (.reviews/round-2.md F020). The
   * answer is an offer id that DIFFERS from the one the switch was taken
   * against; the same one again is a redraw.
   */
  const pendingSwitch = new Map<string, string>();
  /**
   * Per repository, a save this form posted and has not been answered for.
   *
   * Nothing on screen distinguished "sent" from "not pressed", so a second press
   * posted a second save: the lock serializes them, the later one raises the
   * host's ceiling, and the first answer is dropped — the user sees one result
   * for two writes (.reviews/round-1.md F014).
   *
   * It holds the offer the save went out against, that offer's model, and the
   * selection at the moment of the press, because the answer arrives as a FRESH
   * offer whose item ids are all new. Keyed by repository for the same reason
   * `pendingSwitch` is: a form-wide flag was cleared by an unrelated
   * repository's offer and by the repo picker re-delivering a cached one.
   */
  const pendingSave = new Map<
    string,
    { offerId: string; model: WorktreeProvisionOffer["model"]; kept: ReadonlySet<string> }
  >();
  /**
   * Per repository, a setup-step ask this form posted and has not been
   * answered for, keyed like `pendingSwitch` and `pendingSave` and for the same
   * reasons. Holds what the answer must be reconciled against: the offer it
   * went out against and its model, the selection at the press, and — for an
   * edit — which added row (by ordinal among added rows) was being edited, so
   * its tick can follow it onto the answering offer, where its script has
   * changed and no descriptor matches (design.md D5).
   */
  interface PendingStep {
    offerId: string;
    model: WorktreeProvisionOffer["model"];
    kept: ReadonlySet<string>;
    /** What was pressed, so the answer can put focus back where it was (D5). */
    pressed: { kind: WorktreeSetupStepAskMessage["op"]["kind"]; ordinal: number };
    /**
     * Whether the pressed control held focus at the press. Read THEN, because
     * the control is disabled a moment later and a disabled control cannot
     * hold focus; withdrawn by a `focusin` elsewhere in the dialog.
     */
    restoreFocus: boolean;
    /** For a remove: which ordinal the answer will have spliced out. */
    removing?: number;
  }
  const pendingStep = new Map<string, PendingStep>();
  interface PendingCopy {
    offerId: string;
    model: WorktreeProvisionOffer["model"];
    kept: ReadonlySet<string>;
    /** Restore only when the user had focused the action and did not move on. */
    restoreFocus: boolean;
  }
  const pendingCopy = new Map<string, PendingCopy>();
  /** Any host-owned input still out: each one holds the whole form. */
  const anyStepAsking = (): boolean => pendingStep.size > 0;
  const anyCopyAsking = (): boolean => pendingCopy.size > 0;
  const anyAsking = (): boolean => anyStepAsking() || anyCopyAsking();
  /**
   * Every added step's tick, per repository, by RECORD ordinal.
   *
   * Written on each toggle and applied to every answering offer, whatever
   * answered it. Ordinal, not descriptor: two added rows may carry the same
   * script, and a descriptor moved the first one's tick onto the second on a
   * remove (round 1 F001). One vector for the whole record, not a snapshot of
   * the rows shown: a denser source shows only a prefix of the record
   * (design.md D3), and a snapshot of that prefix forgot every hidden step's
   * tick, which came back at its default on the switch back (round 2 plan
   * attack 3). The shown rows are a prefix, so the shown ordinal IS the record
   * ordinal. A step past the vector's end is new and takes its default, ON.
   */
  const addedTickRecord = new Map<string, boolean[]>();
  const addedOf = (model: WorktreeProvisionOffer["model"]) =>
    model.setup.filter((step) => step.source === SETUP_STEP_ADDED_SOURCE);
  const applyAddedTicksFor = (repoId: string, model: WorktreeProvisionOffer["model"], into: Set<string>): void => {
    const ticks = addedTickRecord.get(repoId) ?? [];
    addedOf(model).forEach((step, i) => {
      if (ticks[i] ?? true) {
        into.add(step.id);
      } else {
        into.delete(step.id);
      }
    });
  };
  const addedCopyTickRecord = new Map<string, boolean[]>();
  const addedCopiesOf = (model: WorktreeProvisionOffer["model"]) =>
    model.entries.filter((entry) => entry.addedForCreate === true);
  const applyAddedCopyTicksFor = (repoId: string, model: WorktreeProvisionOffer["model"], into: Set<string>): void => {
    const ticks = addedCopyTickRecord.get(repoId) ?? [];
    addedCopiesOf(model).forEach((entry, index) => {
      if (ticks[index] ?? true) {
        into.add(entry.id);
      } else {
        into.delete(entry.id);
      }
    });
  };
  const applyAddedTicks = (model: WorktreeProvisionOffer["model"], into: Set<string>): void => {
    applyAddedTicksFor(draft.repoId, model, into);
    applyAddedCopyTicksFor(draft.repoId, model, into);
  };
  const recordOrdinalTick = (
    itemId: string,
    on: boolean,
    items: readonly { id: string }[],
    records: Map<string, boolean[]>,
  ): void => {
    const ordinal = items.findIndex((item) => item.id === itemId);
    if (ordinal < 0) {
      return;
    }
    const ticks = records.get(draft.repoId) ?? [];
    while (ticks.length <= ordinal) {
      ticks.push(true);
    }
    ticks[ordinal] = on;
    records.set(draft.repoId, ticks);
  };
  const recordAddedTick = (itemId: string, on: boolean): void => {
    if (drawnModel === null) {
      return;
    }
    recordOrdinalTick(itemId, on, addedOf(drawnModel), addedTickRecord);
    recordOrdinalTick(itemId, on, addedCopiesOf(drawnModel), addedCopyTickRecord);
  };
  // The model behind `drawnOfferId`, so the toggle handler can restate the
  // summary without a redraw — redrawing on a tick is what W2 forbids.
  let drawnModel: WorktreeProvisionOffer["model"] | null = null;
  /**
   * What the user has ticked, per offer.
   *
   * Kept outside the DOM because the section is rebuilt when a new offer
   * supersedes the old one and when the repo picker moves. Nothing reads this
   * yet — WT-012.2 owns redemption — but losing a choice silently is a defect
   * whether or not anything acts on it (.reviews/round-1.md W2).
   */
  const checkedByOffer = new Map<string, Set<string>>();

  // Registered ONCE. Inside the redraw it added a handler per rebuild, each
  // closing over that redraw's own set — and item ids are offer-local, so a
  // stale handler wrote into an offer the form no longer holds
  // (.reviews/round-2.md W5). The set is resolved at event time instead of
  // captured.
  bringBox.addEventListener("change", (ev) => {
    const cb = ev.target;
    if (!(cb instanceof HTMLInputElement) || !cb.classList.contains("wt-brow-cb") || drawnOfferId === null) {
      return;
    }
    const ticked = checkedByOffer.get(drawnOfferId);
    if (cb.checked) {
      ticked?.add(cb.value);
    } else {
      ticked?.delete(cb.value);
    }
    recordAddedTick(cb.value, cb.checked);
    // The counts and the yielding notes are claims about what this create will
    // bring over, so they are restated from the selection that just changed
    // rather than left at whatever the first render computed (round-1 F001).
    // Text and one hidden flag: no row is rebuilt, so no checkbox is reset.
    if (drawnModel !== null && ticked !== undefined) {
      bringSum.textContent = bringSummary(drawnModel, ticked);
      syncYieldNotes(ticked);
    }
    syncWaitForSetup();
  });

  /**
   * Show each yielding note only while the declaration it names is selected.
   *
   * The note states a condition, so it is displayed exactly when the condition
   * holds. Unticking the favoured member leaves the other one uncontested — the
   * apply recomputes its contests from what was submitted and finds no favoured
   * member — so the refusal it warns about is no longer the one that will
   * happen (round-1 F001).
   */
  function syncYieldNotes(ticked: ReadonlySet<string>): void {
    if (drawnModel === null) {
      return;
    }
    const pathOf = new Map(drawnModel.entries.map((e) => [e.id, e.path] as const));
    // Once per GROUP, not once per note. Every note pointing at a group asks the
    // same question of the same list, and a group is every entry sharing one
    // fold key, so it can hold every row the cap allows: reading it per note
    // made one checked-in file quadratic in its own rows
    // (.reviews/round-8.md F019).
    const claiming = claimingPerGroup(drawnModel, ticked).map((ids) =>
      ids.flatMap((id) => {
        const path = pathOf.get(id);
        return path === undefined ? [] : [path];
      }),
    );
    for (const note of bringBox.querySelectorAll<HTMLElement>(".wt-brow-yield")) {
      const held = claiming[Number(note.dataset.group)] ?? [];
      // Exactly one, which is D3c's favoured case. None leaves nothing claiming
      // priority and the apply applies the group, so there is no refusal to
      // warn about; more than one refuses it entire, which the note below owns.
      note.hidden = held.length !== 1;
      if (held[0] !== undefined) {
        note.textContent = `refused while ${held[0]} is selected`;
      }
    }
    for (const note of bringBox.querySelectorAll<HTMLElement>(".wt-brow-contested")) {
      const held = claiming[Number(note.dataset.group)] ?? [];
      note.hidden = held.length < 2;
      if (held.length >= 2) {
        note.textContent = `refused while ${bothOrAll(held)} — the repository declares this destination more than once`;
      }
    }
  }

  /**
   * Monotonic per dialog, minted here.
   *
   * The host orders answers by it, so it must increase across every switch this
   * form takes — including switches for different repositories, which is why it
   * is one counter and not one per repo.
   */
  let switchSeq = 0;

  /** Redraw the section from the repo's offer. Called on every derive. */
  /**
   * The selection an answered ask leaves behind. Provider rows carry by
   * script descriptor. Added rows carry by ORDINAL, for every operation: two
   * of them may carry the same script, and a descriptor cannot tell those
   * apart — removing the first moved its tick onto the second (round 1 F001,
   * design.md D5). An add leaves the snapshot as is and the new last row takes
   * its default; an edit changes neither count nor order; a remove splices
   * its ordinal out.
   */
  /**
   * Where focus goes once the answer has redrawn the section: the same row's
   * same action, the successor row's after a remove, the Add control when no
   * row is left or after an add. `replaceChildren` otherwise dropped the
   * focused button and left focus nowhere (round 2 F007).
   */
  function restoreStepFocus(stepped: PendingStep, model: WorktreeProvisionOffer["model"]): void {
    const { kind, ordinal } = stepped.pressed;
    const rows = Array.from(bringBox.querySelectorAll<HTMLElement>(".wt-brow")).filter((row) =>
      (row.querySelector(".wt-brow-src")?.textContent ?? "").includes(SETUP_STEP_ADDED_SOURCE),
    );
    const count = addedOf(model).length;
    const at = kind === "add" ? -1 : Math.min(ordinal, count - 1);
    const row = at < 0 ? undefined : rows[at];
    const target = row?.querySelector<HTMLButtonElement>(
      kind === "edit" ? ".wt-brow-step-edit" : ".wt-brow-step-remove",
    );
    (target ?? addStepButton).focus();
  }

  function settleStep(stepped: PendingStep, model: WorktreeProvisionOffer["model"], repoId: string): Set<string> {
    const ticked = carryForward(stepped.model, stepped.kept, bringRows(model), model);
    if (stepped.removing !== undefined) {
      const ticks = addedTickRecord.get(repoId);
      if (ticks !== undefined && stepped.removing < ticks.length) {
        ticks.splice(stepped.removing, 1);
      }
    }
    applyAddedTicksFor(repoId, model, ticked);
    applyAddedCopyTicksFor(repoId, model, ticked);
    return ticked;
  }

  function settleCopy(copied: PendingCopy, model: WorktreeProvisionOffer["model"], repoId: string): Set<string> {
    const ticked = carryForward(copied.model, copied.kept, bringRows(model), model);
    applyAddedTicksFor(repoId, model, ticked);
    applyAddedCopyTicksFor(repoId, model, ticked);
    return ticked;
  }

  function syncBringOver(offer: WorktreeProvisionOffer | undefined): void {
    if (offer === undefined) {
      // No offer has arrived. Saying nothing is right here and only here: the
      // form has not been told what this repository needs, and an empty section
      // would claim it needs nothing.
      bringField.hidden = true;
      bringSum.textContent = "";
      bringBox.replaceChildren();
      saveRow.remove();
      drawnOfferId = null;
      drawnModel = null;
      syncWaitForSetup();
      return;
    }
    // `syncDerived` runs on every keystroke, and rebuilding there reset every
    // checkbox — so unticking Run setup and typing one more character silently
    // put it back (W2). The offer is the only thing this section renders, so its
    // id is the only thing that can require a redraw.
    if (drawnOfferId === offer.offerId) {
      return;
    }
    drawnOfferId = offer.offerId;
    drawnModel = offer.model;
    bringField.hidden = false;
    // A DIFFERENT offer id is the answer the removed control was waiting for.
    // The same id again is this form being redrawn — through the repo picker,
    // most of all — and a redraw is not an answer.
    const switched = pendingSwitch.get(draft.repoId);
    const saved = pendingSave.get(draft.repoId);
    const stepped = pendingStep.get(draft.repoId);
    const copied = pendingCopy.get(draft.repoId);
    if (switched !== offer.offerId) {
      pendingSwitch.delete(draft.repoId);
    }
    // A DIFFERENT id answers the ask; the same id is a redraw, exactly as for
    // a switch. The answer reconciles below through `carryForward`, so the
    // superseded offer's selection is dead state once that has run.
    const stepAnswered = stepped !== undefined && stepped.offerId !== offer.offerId;
    if (stepAnswered) {
      pendingStep.delete(draft.repoId);
      checkedByOffer.delete(stepped.offerId);
    }
    const copyAnswered = copied !== undefined && copied.offerId !== offer.offerId;
    if (copyAnswered) {
      pendingCopy.delete(draft.repoId);
      checkedByOffer.delete(copied.offerId);
    }
    // The switched-FROM offer's selection, dropped the same way a save answer
    // drops its own. Only save answers were evicting, so repeated switches left
    // one unreachable set per superseded offer for the dialog's lifetime
    // (.reviews/round-3.md F023).
    if (switched !== undefined && switched !== offer.offerId) {
      checkedByOffer.delete(switched);
    }
    // A save is answered only by an offer that is neither the one it went out
    // against nor the answer to a switch taken after it. A switch replaces the
    // source, so the selection it was taken under is about rows this offer no
    // longer claims to have — that reseeds from the new model's defaults.
    const answering = saved !== undefined && saved.offerId !== offer.offerId && switched === undefined;
    if (saved !== undefined && saved.offerId !== offer.offerId) {
      pendingSave.delete(draft.repoId);
      // The superseded offer can never be submitted again, and its selection is
      // either carried below or deliberately dropped. Either way it is dead
      // state keyed by an id nothing will name.
      checkedByOffer.delete(saved.offerId);
    }
    // DERIVED, never toggled. The record is per repository and the button is
    // one control shared by all of them, so a `disabled = false` on any redraw
    // re-enabled a button whose handler then silently returned — the busy state
    // the F014 fix exists to show, showing the wrong thing after a trip through
    // the repo picker (.reviews/round-3.md F014).
    saveButton.disabled = pendingSave.has(draft.repoId);
    // And only where a save can actually be made: a control whose press the
    // host would never hear is the same nothing as a control with no offer
    // behind it (.reviews/round-1.md F009).
    if (deps.onProvisionSave !== undefined && !pendingSwitch.has(draft.repoId)) {
      bringField.appendChild(saveRow);
    }
    let ticked = checkedByOffer.get(offer.offerId);
    if (ticked === undefined) {
      const fresh = bringRows(offer.model);
      if (stepAnswered && stepped !== undefined) {
        ticked = settleStep(stepped, offer.model, draft.repoId);
      } else if (copyAnswered && copied !== undefined) {
        ticked = settleCopy(copied, offer.model, draft.repoId);
      } else {
        ticked =
          answering && saved !== undefined
            ? carryForward(saved.model, saved.kept, fresh, offer.model)
            : new Set(fresh.filter((r) => r.checked).map((r) => r.id));
        // Whatever answered — a switch reseeding from defaults, a save carrying
        // by descriptor — the added rows take the record's ticks (D5).
        applyAddedTicks(offer.model, ticked);
      }
      checkedByOffer.set(offer.offerId, ticked);
    }
    // After the selection exists, never before: the counts are read off it.
    bringSum.textContent = bringSummary(offer.model, ticked);
    const held = ticked;
    const rows = bringRows(offer.model).map((row) => ({ ...row, checked: held.has(row.id) }));
    // Every source the host detected and did not choose. `active` is the host's
    // word for which one supplied the rows above.
    const inactive = offer.model.providers.filter((p) => !p.active);
    // Problems sit inside the box beside the rows, not instead of them: an
    // unknown key does not discard the keys that parsed, and reporting only the
    // problem would understate what the create is about to do.
    // Replaced, never appended: a redrawn offer that added its switch rows to
    // the previous offer's would grow a row per switch taken.
    const onStep =
      deps.onSetupStepAsk === undefined
        ? undefined
        : (kind: "edit" | "remove", itemId: string, control?: HTMLElement) =>
            askStep({ kind, offerId: offer.offerId, itemId }, control);
    let addedSeen = 0;
    bringBox.replaceChildren(
      ...rows.map((row, i) => bringRow(row, i, onStep, row.added === true ? addedSeen++ : 0)),
      ...offer.model.problems.map((problem) => bringProblem(problem)),
      ...inactive.map((provider) =>
        switchRow(provider, () => {
          if (anyAsking()) {
            return;
          }
          switchSeq += 1;
          pendingSwitch.set(draft.repoId, offer.offerId);
          saveRow.remove();
          deps.onProvisionSwitch?.({ repoId: draft.repoId, switch: switchSeq, provider: provider.id });
          syncStepControls();
        }),
      ),
      ...(deps.onCopyFileAsk === undefined ? [] : [addCopyRow]),
      ...(deps.onSetupStepAsk === undefined ? [] : [addStepRow]),
    );
    syncStepControls();
    if (stepAnswered && stepped !== undefined && stepped.restoreFocus) {
      restoreStepFocus(stepped, offer.model);
    }
    if (
      copyAnswered &&
      copied !== undefined &&
      copied.restoreFocus &&
      addCopyButton.isConnected &&
      !addCopyButton.disabled
    ) {
      addCopyButton.focus();
    }
    syncYieldNotes(held);
    bringBox.hidden = bringBox.childElementCount === 0;
    // The sentence stands in only where there is genuinely nothing to list. A
    // file that failed to parse has a problem row, which is a different answer,
    // and a switch row is an offer rather than something this worktree gets —
    // so a present source declaring nothing still says what the worktree lacks.
    bringEmpty.hidden = rows.length + offer.model.problems.length > 0;
    // A replacement offer starts a fresh ticked set (or reuses a prior visit's),
    // never the superseded offer's — so a replacement that selects no setup step
    // must re-disable the wait control rather than leave it armed for a
    // selection that no longer exists.
    syncWaitForSetup();
  }

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
  bringField.appendChild(waitField);

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
  function hasSelectedSetup(): boolean {
    if (drawnOfferId === null || drawnModel === null) {
      return false;
    }
    const ticked = checkedByOffer.get(drawnOfferId);
    return ticked !== undefined && drawnModel.setup.some((step) => ticked.has(step.id));
  }

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
    waitField.hidden = model.afterChoice() !== "agent" || drawnModel === null || drawnModel.setup.length === 0;
    const selected = hasSelectedSetup();
    waitBox.disabled = !selected || anyAsking();
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
    if (drawnOfferId === null) {
      return undefined;
    }
    return { offerId: drawnOfferId, itemIds: [...(checkedByOffer.get(drawnOfferId) ?? [])] };
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
    if (createBtn.disabled || heldBranch() !== undefined) {
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
    const carried = draft.branchMode === "detached" ? null : effective;
    // The grant, only where it still covers the destination this form is
    // showing. Absent, the create is an ordinary one against a free path — the
    // form never asks for a removal it cannot name the authorization for.
    const disposition = settledDisposition();
    // The last hop. `checkedByOffer` has held this since WT-012.1 and nothing
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

  /** The repo AND branch the last host request was made for, so edits do not
   *  re-ask — and so a repo switch is not mistaken for the same question. The
   *  request is repo-scoped; a key that is not reuses one repo's answer for
   *  another, and the destination line is what states that answer. */
  let askedFor: string | null = null;
  /**
   * The repo and branch of the same request, kept separately because the
   * DEFAULTS reply can only echo those two — a base or destination edit changes
   * `askedFor` without changing the question that reply is answering.
   */
  let defaultsAskedFor: string | null = null;
  /**
   * The whole selection, so an edit to the base or the destination re-asks.
   * Keyed on the same value the request carries — anything the key drops is a
   * field the form could change without the host ever hearing about it.
   */
  const askKey = (s: CreateSelection): string =>
    JSON.stringify([s.repoId, s.branch, s.base ?? null, s.candidatePath ?? null, s.useChosenFolder ?? false]);

  /** True while a destination request has no answer yet. Submit waits for it. */
  let outstanding = false;
  /**
   * The ONE resolution this form is acting on (D8).
   *
   * Mode, the stated action and the guards all read this rather than each
   * interpreting the answer for themselves — two interpretations of one answer
   * is how a repair could act on a different path from the one on screen.
   */
  let effective: WorktreeCreateResolutionMessage | null = null;
  /**
   * True while the classification for the typed selection has not landed.
   *
   * Submit waits for it as well as the destination. Without this the form could
   * submit an existing branch as fresh while its own classification was still in
   * flight — the failure-after-submit this change exists to remove (round-1 B2).
   */
  let resolutionOutstanding = false;

  /** The user accepted the recover offer. Withdrawn by any change of selection. */
  let recoverWanted = false;
  /** The authorization the host issued, and the entries it was digested over. */
  let recoverGrant: { path: string; authorization: DebrisAuthorization; entries: readonly string[] } | null = null;
  /**
   * Which request is outstanding, or null.
   *
   * A generation rather than a flag: an answer that arrives after the offer was
   * withdrawn names the same path and would otherwise be kept, so a later
   * re-acceptance reused a reading that acceptance never made (round-1 W2).
   */
  let recoverAsked: number | null = null;
  let recoverAsks = 0;
  /** Why the host refused, stated where the offer was — a refusal is an answer, not silence. */
  let recoverRefused: string | null = null;

  /**
   * The directory this form would offer to clear, or null where it offers none.
   *
   * Only a candidate the suffixing SKIPPED, only where the resolution classified
   * it as debris, and only where the create would actually take that path once
   * it is cleared: under `reattach` the create acts on the registration's own
   * path, so the skipped candidate is a directory this create never touches, and
   * offering to delete it would be the round-3 B3 defect with a delete attached.
   */
  function debrisOffer(): string | null {
    if (deps.onAuthorizeDebris === undefined || deps.bindDebrisAuthorization === undefined) {
      // Nothing can answer the request, so the offer would be a control that
      // cannot be acted on.
      return null;
    }
    if (effective === null) {
      return null;
    }
    const occupied = effective.occupiedCandidate;
    if (occupied === undefined || occupied.disposition.kind !== "debris") {
      return null;
    }
    // The MODE, said outright. Comparing `targetOf` against `freePath` was a
    // proxy for it, and the two coincide whenever a stale registration's own
    // path is also the first free candidate — which armed a clearance the
    // service's repair branch never performs (round-1 B7).
    // Adopt joins `reattach`, and more strongly: a repair's skipped candidate is
    // merely a directory this create never touches, while an adoption's IS the
    // directory being re-registered — so the offer would be to delete the work.
    if (draft.branchMode !== "detached" && (effective.mode.kind === "reattach" || effective.mode.kind === "adopt")) {
      return null;
    }
    return targetOf(effective) === effective.freePath ? occupied.path : null;
  }

  /** The disposition the form settled on — `debris` only under a grant for the path on screen. */
  function settledDisposition(): { kind: "debris"; authorization: DebrisAuthorization } | undefined {
    const offer = debrisOffer();
    if (!recoverWanted || offer === null || recoverGrant === null || recoverGrant.path !== offer) {
      return undefined;
    }
    return { kind: "debris", authorization: recoverGrant.authorization };
  }

  /** Forget an acceptance and its grant. The authorization binds one path and one content. */
  function withdrawRecover(): void {
    recoverWanted = false;
    recoverGrant = null;
    recoverAsked = null;
    recoverRefused = null;
    recoverBox.checked = false;
  }

  recoverBox.addEventListener("change", () => {
    const offer = debrisOffer();
    if (offer === null) {
      recoverBox.checked = false;
      return;
    }
    if (!recoverBox.checked) {
      withdrawRecover();
      syncDerived();
      return;
    }
    recoverWanted = true;
    recoverRefused = null;
    if (recoverGrant?.path !== offer) {
      // A grant for a different directory authorizes nothing here.
      recoverGrant = null;
      recoverAsks += 1;
      recoverAsked = recoverAsks;
      deps.onAuthorizeDebris?.({ repoId: draft.repoId, ask: recoverAsked, path: offer });
    }
    syncDerived();
  });

  /** What the form would start a new branch from, where the mode takes one. */
  function probeBase(): ProbeBase | undefined {
    // The toggle and the field, and nothing the ANSWER set: `branchMode` also
    // carries `existing` and `reattach`, which the resolution writes back, so
    // reading those here would change the question every time it was answered.
    // Which modes refuse a base is the HOST's to decide — it withholds the
    // verdict itself (D7).
    if (draft.branchMode === "detached") {
      return { kind: "detached" };
    }
    const ref = draft.baseRef.trim();
    return ref.length === 0 ? undefined : { kind: "ref", ref };
  }

  /** The selection as the host would be told it. */
  function selection(): CreateSelection {
    const base = probeBase();
    return {
      repoId: draft.repoId,
      branch: draft.branchMode === "detached" ? draft.baseRef : draft.branchName,
      ...(base === undefined ? {} : { base }),
      ...model.destinationCandidate(),
    };
  }

  /**
   * The directory this resolution's create would act on.
   *
   * A repair acts on the registration's OWN path; `freePath` is the free suffix
   * the create would have taken instead, and stating that beside a checkout
   * already sitting there described a directory this create will never touch
   * (round-3 B3).
   */
  function targetOf(resolution: WorktreeCreateResolutionMessage): string {
    // The mode the FORM holds, not the one the answer carried: under detached
    // the classification is discarded (D5), so a repair path it named is not a
    // directory this create will ever act on.
    const mode = resolution.mode;
    if (draft.branchMode === "detached") {
      return resolution.freePath;
    }
    if (mode.kind === "reattach") {
      return mode.repairPath;
    }
    // An adoption's own directory, on the same rule: `freePath` is the suffix
    // the create would have taken INSTEAD, and stating it beside the checkout
    // being re-registered describes a directory this create never touches.
    return mode.kind === "adopt" ? mode.adoptPath : resolution.freePath;
  }

  /** Ask the host what this selection would do, at most once each. */
  function askForDestination(): void {
    const now = selection();
    // There is nothing to resolve for a create with no target. Asking anyway got
    // back a full plan for the empty name — a free suffixed path, the collision
    // it stepped around, an offer to clear a folder — and the form drew all of it
    // under a field nobody had typed in. The seeded destination line already says
    // what the form knows at this point, and says it as a template rather than as
    // a decision (260906-at-create-dialog-resolves-an-empty-name).
    const target = draft.branchMode === "detached" ? draft.baseRef : now.branch;
    if (target.trim().length === 0) {
      return;
    }
    const key = askKey(now);
    if (key === askedFor) {
      return;
    }
    askedFor = key;
    defaultsAskedFor = `${now.repoId}\u0000${now.branch}`;
    if (deps.onSelectionChange !== undefined) {
      // EVERY changed selection, the destination override included. Exempting
      // it — on the reasoning that an override changes which path is reported
      // on rather than what the create does — left the override submittable
      // against an answer that was never about it, and under `reattach` left
      // the form showing the override while the request carried the repair
      // target (round-4 B3).
      outstanding = true;
      // A new question invalidates the old answer immediately, rather than
      // leaving the previous classification readable until the reply lands.
      effective = null;
      // And with it the acceptance: an authorization is issued over ONE path and
      // what was in it, so carrying it across a changed selection would submit a
      // token for a directory this create is no longer aimed at.
      withdrawRecover();
      // Only where an answer is actually coming. With no resolver bound none
      // ever arrives, and gating on it would leave Create permanently disabled
      // rather than waiting for something.
      resolutionOutstanding = deps.bindResolution !== undefined;
      deps.onSelectionChange(now);
    }
  }

  /**
   * The directory holding the branch this form would submit, if one does.
   *
   * The guard, stated once and read in two places: `syncDerived` to disable
   * Create, and `submit` to refuse a route that reached it without re-deriving.
   */
  function heldBranch(): string | undefined {
    if (draft.branchMode === "detached") {
      return undefined;
    }
    // A repair is not blocked by the registration it repairs. `heldBy` comes
    // from the listing, which reports a prunable holder exactly like a live
    // one; the resolution is what told these apart, and it says `blockedBy`
    // when a LIVE worktree holds the branch and `reattach` when the holder is
    // the stale registration this create would fix (design.md D3).
    if (draft.branchMode === "reattach") {
      return undefined;
    }
    // The RESOLUTION when there is one. It is the answer that told a live
    // holder from the stale registration a repair would fix, so re-deriving the
    // holder from the listing here was a second interpretation of it
    // (round-3 B3).
    if (effective !== null) {
      return effective.blockedBy?.ownerPath;
    }
    // Otherwise from the typed NAME against the current repository's list, not
    // from `choice`. Committing the create-new row deliberately sets `choice`
    // to `new` while leaving the typed text alone, so a guard reading `choice`
    // stops seeing the holder and submits a branch another worktree holds
    // (round-2 B4).
    //
    // Still the current repository's list and nothing else: the round-1 W1
    // fallback to a standing selection is not restored, because it could not
    // tell "this repo has the ref and it is free" from "this repo does not
    // have it".
    const typed = nameInput.value.trim();
    return typed.length === 0 ? undefined : offeredRefs().find((ref) => ref.name === typed)?.heldBy;
  }

  /**
   * Re-decide what the typed text means, against the repository the form is on
   * NOW. The single source D4 claims: mode is derived here and nowhere else.
   *
   * Two-way on purpose. Only ever upgrading to `existing` left a branch that
   * exists in one repository still submitting as `existing` after a switch to
   * one where it does not (round-1 B2).
   */
  function deriveChoice(): void {
    const typed = nameInput.value.trim();
    branches.derive(typed);
    if (draft.branchMode === "detached") {
      return;
    }
    // A RESOLVED mode is the host's answer about a directory, and this local
    // derivation only ever knows the ref list — which can be truncated, and
    // which arrives on its own schedule. Letting it demote `adopt` or
    // `reattach` left the form stating it would re-register a fixed directory
    // while the controls were enabled for a different mode, and the submitted
    // mode still adopt (round-1 F008). It only holds while the typed branch is
    // the one that answer was about; anything else re-derives as before.
    if ((draft.branchMode === "adopt" || draft.branchMode === "reattach") && effective?.query.trim() === typed) {
      return;
    }
    draft.branchMode = branches.mode();
  }

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

  function setActive(next: number): void {
    activeAt = next;
    const rows = Array.from(listBox.children) as HTMLElement[];
    rows.forEach((row, at) => {
      row.classList.toggle("is-active", at === activeAt);
      row.setAttribute("aria-selected", at === activeAt ? "true" : "false");
    });
    const active = activeAt >= 0 ? rows[activeAt] : undefined;
    if (active === undefined) {
      nameInput.removeAttribute("aria-activedescendant");
    } else {
      nameInput.setAttribute("aria-activedescendant", active.id);
      // The popup scrolls, so past its visible rows Enter would otherwise
      // commit an option the user cannot see (round-2 B1). Guarded because
      // jsdom does not implement it.
      active.scrollIntoView?.({ block: "nearest" });
    }
  }

  /** Redraw the rows for the text currently typed. Does not open or close. */
  function renderList(): void {
    const offered = branches.offer(nameInput.value);
    listBox.replaceChildren();
    offered.forEach((c, at) => {
      const row = document.createElement("li");
      row.id = `wt-branch-opt-${at}`;
      row.className = "wt-branch-opt";
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", "false");
      if (c.kind === "new") {
        row.dataset.kind = "new";
        const typed = nameInput.value.trim();
        row.textContent = typed.length > 0 ? `${CREATE_ROW_LABEL} “${typed}”` : CREATE_ROW_LABEL;
      } else if (c.kind === "prsUnavailable") {
        // A statement, not an offer: announced and reachable, never selectable.
        // Same reason the held-by row stays — saying nothing would leave the
        // user thinking the repository has no pull requests (§ 5).
        row.dataset.kind = "prs-unavailable";
        row.setAttribute("aria-disabled", "true");
        row.textContent = "Pull requests unavailable";
      } else if (c.kind === "pr") {
        row.dataset.kind = "pr";
        row.dataset.branch = `pr-${c.pr.number}`;
        row.dataset.pr = String(c.pr.number);
        row.textContent = `#${c.pr.number} ${c.pr.title}`;
      } else {
        row.dataset.kind = "existing";
        row.dataset.branch = c.ref.name;
        row.textContent = c.ref.name;
        if (c.ref.heldBy !== undefined) {
          // `aria-disabled`, never `disabled`: the row's whole purpose is to say
          // WHY the branch is unavailable and which directory has it, so it has
          // to stay reachable and announced. Removing it would put the name back
          // to looking free, which is the failure this task deletes (D5).
          row.setAttribute("aria-disabled", "true");
          row.dataset.heldBy = c.ref.heldBy;
          const badge = document.createElement("span");
          badge.className = "wt-branch-held";
          // A NAME, never a path — the badge is the narrowest slot in the form
          // and the host already applied the shortening (D2, § 4.2).
          badge.textContent = `in ${c.ref.heldBy}`;
          row.appendChild(badge);
        }
      }
      row.addEventListener("mousedown", (ev) => {
        // `mousedown`, not `click`: the input blurs first otherwise and the
        // blur handler closes the list out from under the pointer.
        ev.preventDefault();
        commit(at);
      });
      listBox.appendChild(row);
    });
    setActive(Math.min(activeAt, offered.length - 1));
  }

  function openList(): void {
    listOpen = true;
    renderList();
    listBox.hidden = false;
    nameInput.setAttribute("aria-expanded", "true");
    measureRoom();
    shell.refreshFocusTrap();
  }

  /**
   * Publish the room actually below the input, for the popup's ceiling.
   *
   * CSS alone cannot express this: a `calc` against `100%` resolves to the
   * FIELD's height, not to where the field sits in the viewport, so the round-2
   * attempt read as a measurement and was not one (round-3 S3). The element is
   * the only thing that knows its own position, so it hands the number over.
   */
  function measureRoom(): void {
    const room = nameInput.getBoundingClientRect?.();
    if (room === undefined) {
      return; // jsdom, or a detached node — the stylesheet's own floor applies
    }
    const below = Math.round(window.innerHeight - room.bottom - 12);
    listBox.style.setProperty("--wt-branch-room", `${Math.max(below, 0)}px`);
  }

  function closeList(): void {
    listOpen = false;
    listBox.hidden = true;
    nameInput.setAttribute("aria-expanded", "false");
    nameInput.removeAttribute("aria-activedescendant");
    activeAt = -1;
    shell.refreshFocusTrap();
  }

  /** Take row `at` as the selection, close the list, and re-derive. */
  function commit(at: number): void {
    const decided = branches.commit(at);
    if (decided.kind === "ignored") {
      return;
    }
    if (decided.kind === "refused") {
      nameError.textContent = decided.message;
      nameError.hidden = false;
      return;
    }
    // `syncDerived` reads both fields back into the draft, so stating them here
    // is the whole of what feeds the existing path — there is no second
    // resolution for pull requests.
    if (decided.branchName !== undefined) {
      nameInput.value = decided.branchName;
    }
    if (decided.baseRef !== undefined) {
      baseInput.value = decided.baseRef;
    }
    if (draft.branchMode !== "detached") {
      draft.branchMode = branches.mode();
    }
    closeList();
    nameInput.focus();
    // Picking a row settles the name in one action — there is no keystroke
    // after it for a `change` event to ride.
    syncDerived(true);
  }

  /** How many entries the note names before it summarises the rest. */
  const RECOVER_ENTRY_CAP = 6;

  /**
   * State the offer, and what accepting it would remove.
   *
   * The list is the one the AUTHORIZATION was digested over, so what is shown
   * and what is bound cannot differ — a list read separately for display would
   * be a second answer to the question the token already answered.
   */
  function renderRecover(): void {
    const offer = debrisOffer();
    if (offer === null) {
      recoverField.hidden = true;
      recoverNote.hidden = true;
      recoverNote.textContent = "";
      recoverBox.checked = false;
      return;
    }
    recoverField.hidden = false;
    recoverBox.checked = recoverWanted;
    recoverText.textContent = `Clear existing folder and create here: ${lastSegment(offer)}`;
    const note =
      recoverRefused ??
      (recoverAsked !== null
        ? "Reading what is there…"
        : recoverGrant !== null && recoverGrant.path === offer
          ? recoverGrant.entries.length === 0
            ? `Removes ${offer}, which is empty.`
            : `Removes ${recoverGrant.entries.length} item(s) from ${offer}: ${listed(recoverGrant.entries)}`
          : `${offer} is not a git checkout. Accepting clears it before the worktree is created.`);
    recoverNote.hidden = false;
    // `textContent`, not markup: these are directory names off the user's disk.
    recoverNote.textContent = note;
  }

  /** The first few names, and a count for the rest — a capped list never reads as the whole set. */
  function listed(entries: readonly string[]): string {
    const shown = entries.slice(0, RECOVER_ENTRY_CAP).join(", ");
    const rest = entries.length - RECOVER_ENTRY_CAP;
    return rest > 0 ? `${shown} and ${rest} more.` : `${shown}.`;
  }

  /**
   * Re-derive the path and its hint from the branch, and re-validate. The hint
   * names the collided path AND the suffixed one the create will actually use —
   * showing only the pretty default would be a claim the form cannot keep.
   */
  /**
   * Emptying the field retracts the question, and everything it armed with it.
   *
   * Run on EVERY pass rather than from `askForDestination`, which only runs on a
   * settled edit: deleting a name without leaving the field is an ordinary
   * `input`, so the retirement never ran and the deleted name's own destination,
   * collision, refusal and destructive recovery offer stayed on screen for as
   * long as the caret did (round-2 F001). Requests stay settled-only; it is the
   * retirement that has to keep up with the text.
   *
   * Before anything derived is read, for the same reason: a pass that retires
   * after rendering has already drawn the answer it is about to discard.
   *
   * Idempotent, and guarded so a form sitting empty does not call
   * `withdrawRecover` on every keystroke elsewhere.
   */
  function withdrawTarget(): void {
    if (askedFor === null && !outstanding && !resolutionOutstanding && effective === null) {
      return;
    }
    askedFor = null;
    defaultsAskedFor = null;
    effective = null;
    outstanding = false;
    resolutionOutstanding = false;
    withdrawRecover();
  }

  function syncDerived(settled = false): void {
    const repo = currentRepo();
    // From the INPUTS, not from `draft`. The draft's copies are written far
    // below (`draft.branchName = nameInput.value`), so reading them here saw the
    // previous render's text: the withdrawal and the seed rule both ran one
    // keystroke behind the field they are about.
    const activeTarget = (draft.branchMode === "detached" ? baseInput.value : nameInput.value).trim();
    if (activeTarget.length === 0) {
      withdrawTarget();
    }
    repoHint.textContent = repo.mainPath;
    syncBringOver(repo.provisioning);
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
      pickDestination.disabled = destRefused !== undefined || pickAsked !== null || anyAsking();
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
    const verdict = baseRefused === undefined ? effective?.baseValid : undefined;
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
        : effective === null
          ? undefined
          : ACTION_BY_MODE[effective.mode.kind];
    actionNote.hidden = actionText === undefined;
    actionNote.textContent = actionText ?? "";
    actionNote.classList.toggle("wt-dest-note--error", baseUnresolvable);
    // Named here rather than only in a confirmation step, so the losses are on
    // screen while the create can still be abandoned — the rule the fork note
    // beside it already follows (§ 5).
    const adopting = !detached && effective?.mode.kind === "adopt" ? effective.mode : undefined;
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
    const recovered = settledDisposition() === undefined ? undefined : recoverGrant?.path;
    const answered = recovered ?? (effective === null ? undefined : targetOf(effective));
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
        : effective === null
          ? model.pathIsDerived() && seedAnswers
            ? repo.collidedWith
            : ""
          : lastSegment(effective.occupiedCandidate?.path ?? "");
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

    renderRecover();

    const heldBy = heldBranch();
    // git's own answer about the name on screen. `effective` is nulled on every
    // new ask and only set for an answer whose `query` matches the field, so a
    // verdict for a name the user has typed past cannot speak here.
    //
    // Read as an ERROR rather than as a reason for the disabled action: the
    // field already has the vocabulary for a refusal, and `blockedBy` reads
    // `error` first, so a refused name never reads as one still being checked.
    const branchRefused = !detached && effective?.branchValid?.ok === false ? effective.branchValid.reason : undefined;
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
      askForDestination();
    }
    // The selection on screen is not the one the host answered about. Between a
    // keystroke and the edit settling that is the normal state, and submitting
    // in it would submit against a classification for different text.
    const unasked = deps.onSelectionChange !== undefined && askKey(selection()) !== askedFor;

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
          : resolutionOutstanding
            ? "Checking whether the branch is new, reusable, or repairable."
            : draft.path.trim().length === 0
              ? "Waiting for a destination."
              : outstanding || pickAsked !== null
                ? "Checking the destination."
                : anyCopyAsking()
                  ? "Waiting for the file picker."
                  : anyStepAsking()
                    ? "Waiting for the setup step."
                    : recoverAsked !== null
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
    deriveChoice();
    openList();
    syncDerived();
  });
  nameInput.addEventListener("change", edited);
  nameInput.addEventListener("blur", () => {
    closeList();
    // Leaving a field the user actually used is what turns its emptiness into
    // their answer. Leaving the one the form focused for them says nothing.
    nameLeft = nameLeft || nameTyped || nameInput.value.trim().length > 0;
    syncDerived(true);
  });
  nameInput.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      if (!listOpen) {
        openList();
      }
      if (branches.rows().length > 0) {
        const step = ev.key === "ArrowDown" ? 1 : -1;
        setActive((activeAt + step + branches.rows().length) % branches.rows().length);
      }
      return;
    }
    // Enter takes the ACTIVE row while the list is open, and otherwise falls
    // through to the form — a listbox that swallowed Enter with nothing active
    // would make the keyboard path unable to submit at all.
    if (ev.key === "Enter" && listOpen && activeAt >= 0) {
      ev.preventDefault();
      commit(activeAt);
    }
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
    if (next.answersBranch !== undefined && `${next.repoId}\u0000${next.answersBranch}` !== defaultsAskedFor) {
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
    outstanding = false;
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
      const wasPending = anyAsking();
      syncBringOver(offer);
      // The gate is only read on a derive, and an answered ask is what
      // re-arms Create — the same reason the pick re-derives on its answer.
      if (wasPending && !anyAsking()) {
        syncDerived();
      }
      return;
    }
    // The hold is form-wide, so an answer for a repository the picker has
    // since left must still release it (round 1 F002) — and still settle that
    // repository's selection, so returning to it finds the ticks it left
    // rather than the model's defaults.
    const stepped = pendingStep.get(repoId);
    const copied = pendingCopy.get(repoId);
    const stepAnswered = stepped !== undefined && stepped.offerId !== offer.offerId;
    const copyAnswered = copied !== undefined && copied.offerId !== offer.offerId;
    if (!stepAnswered && !copyAnswered) {
      return;
    }
    if (stepAnswered && stepped !== undefined) {
      pendingStep.delete(repoId);
      checkedByOffer.delete(stepped.offerId);
    }
    if (copyAnswered && copied !== undefined) {
      pendingCopy.delete(repoId);
      checkedByOffer.delete(copied.offerId);
    }
    if (!checkedByOffer.has(offer.offerId)) {
      const ticked =
        stepAnswered && stepped !== undefined
          ? settleStep(stepped, offer.model, repoId)
          : copyAnswered && copied !== undefined
            ? settleCopy(copied, offer.model, repoId)
            : undefined;
      if (ticked !== undefined) {
        checkedByOffer.set(offer.offerId, ticked);
      }
    }
    syncStepControls();
    if (!anyAsking()) {
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
    if (listOpen) {
      renderList();
    }
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
    deriveChoice();
    if (listOpen) {
      renderList();
    }
    syncDerived();
  });

  // What the create would DO, on its own channel — and, since the resolution
  // now owns the destination it names, an answer to the same question the
  // defaults reply answers (round-3 B3).
  deps.bindResolution?.((resolution) => {
    if (model.closed() || resolution.repoId !== draft.repoId) {
      return;
    }
    // An answer the user has typed past describes a selection that is gone.
    // This is what `query` echoes for — the token separates two OPENINGS, and
    // only this separates two edits within one (design.md D1).
    // Under detached the selection's branch is the REF, so that is what the echo
    // is compared against — the branch field is not what was asked about.
    const detached = draft.branchMode === "detached";
    if (resolution.query.trim() !== (detached ? baseInput.value : nameInput.value).trim()) {
      return;
    }
    // And only where the question still stands. A reply that outlives a
    // withdrawal can match the query again the moment the user retypes the same
    // name, and would then answer a question this form has not asked yet — the
    // text matching is not identity, it is only a cheap first test (round-2 F001).
    if (askedFor === null) {
      return;
    }
    // Every mode, not only `reattach`. Dropping the others left `fresh`,
    // `reuse` and `adopt` on whatever the local text derivation last guessed,
    // so a declined corroboration kept the form armed for a repair the host had
    // just withdrawn (round-1 B3).
    effective = resolution;
    resolutionOutstanding = false;
    // It carries `freePath`, which is the destination the form states and
    // submits, so this answer settles the destination question too.
    outstanding = false;
    // Detached is the user's own toggle and outranks a classification of the
    // typed text: the resolution answers "what is this branch name", and under
    // detached the field is not a branch name at all. It outranks the MODE and
    // nothing else — the answer's destination is no less true for the toggle
    // being on, and discarding it wholesale left a detached create offered
    // against a destination nobody had resolved (D5, round-5 B10).
    switch (detached ? "detached" : resolution.mode.kind) {
      case "detached":
        break;
      case "reattach":
        draft.branchMode = "reattach";
        break;
      case "reuse":
        draft.branchMode = "existing";
        break;
      case "adopt":
        draft.branchMode = "adopt";
        break;
      case "fresh":
        draft.branchMode = "new";
        break;
    }
    // Settled, because applying a resolution can CHANGE the selection: a mode
    // that refuses the destination withdraws the override, and the form must
    // ask about the selection it now holds rather than sit behind a gate for a
    // question nobody will ask. It converges — the second answer withdraws
    // nothing further, so the key is stable (round-4 B3).
    syncDerived(true);
  });

  // The answer to the ONE request the acceptance sent. Anything about another
  // directory is dropped rather than applied: an authorization is bound to a
  // path, and applying one issued for a different path is exactly the confusion
  // the fingerprint exists to stop.
  deps.bindDebrisAuthorization?.((answer) => {
    if (model.closed() || answer.repoId !== draft.repoId) {
      return;
    }
    const offer = debrisOffer();
    // THIS request, not merely some request for this path. Accept, withdraw and
    // accept again asks twice inside one opening, and the first answer arriving
    // late would otherwise satisfy the second with a reading that request never
    // made (round-1 W2, round-2 W2).
    if (offer === null || recoverAsked === null || answer.ask !== recoverAsked || answer.path !== offer) {
      return;
    }
    recoverAsked = null;
    if (answer.granted) {
      recoverGrant = { path: answer.path, authorization: answer.authorization, entries: answer.entries };
      recoverRefused = null;
    } else {
      // Not debris, or unreadable — either way there is nothing to authorize,
      // so the acceptance is withdrawn and the create falls back to the suffix.
      recoverGrant = null;
      recoverWanted = false;
      recoverRefused =
        answer.because === "notDebris"
          ? "That directory holds a repository, so it will not be cleared."
          : "That directory could not be read, so it will not be cleared.";
    }
    syncDerived();
  });

  syncOpenAfter();
  shell.focusInitial(nameInput);

  return disposeAll;
}
