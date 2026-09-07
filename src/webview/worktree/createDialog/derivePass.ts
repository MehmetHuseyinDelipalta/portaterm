// src/webview/worktree/createDialog/derivePass.ts — The form's render pass: what
// the destination line says, what the action note claims, which refusal is on
// screen, and whether Create is allowed to be pressed.
//
// Extracted from `openWorktreeCreateDialog` by change `decompose-create-dialog`
// (task 1_9b, added at build time — design.md D1 assigned this no owner and its
// estimates predate the cuts; workflow.md Notes).
//
// The deps object is wide, and that is the honest shape rather than a sign of a
// bad cut: the pass reads everything because it RENDERS everything. What it does
// not do is decide anything a collaborator owns — the mode comes from
// `branches`, the answer from `asks`, the grant from `recover`, the selection
// from `bring`. Measured before it was written: the block has 46 free names, of
// which eighteen are elements now bundled as one `fields`, four are constants
// that came with it because nothing else reads them, and six are imports.
//
// `destExact` DID come with it: the pass is its only writer, and the tooltip
// that reads it asks for the value rather than holding it. `nameLeft`,
// `baseLeft` and `pickAsked` did not — they are written by handlers the facade
// owns, and are read here through thunks.
//
// D4's negation rule was applied at every moved site by hand. The traps here are
// `!blockedBy` and `!selected`, both of which read local values rather than
// accessors, so nothing silently became truthy.
//
// DOM throughout, so no suite beside this file (design.md D2): the 386-case
// dialog suite is a suite about this pass more than about anything else.

import type { ResolvedMode } from "../../../types/messages";
import { sanitizeBranchForPath } from "../../../worktree/branchSlug";
import type { WorktreeAgentBox } from "../worktreeAgentBox";
import type { WorktreeBranchMode, WorktreeCreateDefaults, WorktreeMigrationOffer } from "../worktreeViewTypes";
import type { BranchChoices } from "./branchChoices";
import { partialListText } from "./branchChoices";
import type { DraftModel } from "./draftModel";
import type { FormFields } from "./formFields";
import { lastSegment, shortPath } from "./paths";
import type { ProvisionState } from "./provisionState";
import type { ProvisionView } from "./provisionView";
import type { RecoverOffer } from "./recoverOffer";
import type { ResolutionAsks } from "./resolutionAsks";

export interface DerivePassDeps {
  readonly fields: FormFields;
  readonly model: DraftModel;
  readonly asks: ResolutionAsks;
  readonly bring: ProvisionState;
  readonly bringView: ProvisionView;
  readonly recover: RecoverOffer;
  readonly branches: BranchChoices;
  readonly createBtn: HTMLButtonElement;
  readonly disabledReason: HTMLElement;
  readonly agentBox: WorktreeAgentBox;
  readonly pickDestination: HTMLButtonElement | undefined;
  currentRepo(): WorktreeCreateDefaults;
  /** Written by the blur handlers the facade owns; read here. */
  nameLeft(): boolean;
  baseLeft(): boolean;
  pickAsking(): boolean;
  ensureDestTip(): void;
  syncMigration(offer: WorktreeMigrationOffer | undefined): void;
  /** The hint under the after-create choice (createDialog/afterCreate.ts). */
  syncAfterHint(): void;
  syncWaitForSetup(): void;
  refreshFocusTrap(): void;
}

export interface DerivePass {
  /** Re-derive the whole form from its collaborators. Called on every edit. */
  sync(settled?: boolean): void;
  /** The exact path the destination line is shortening; read by the tooltip. */
  destExact(): string;
}

export function createDerivePass(deps: DerivePassDeps): DerivePass {
  const { agentBox, asks, branches, bring, bringView, createBtn, disabledReason, model, recover } = deps;
  const { pickDestination } = deps;
  const draft = model.draft;
  const {
    actionNote,
    adoptLosses,
    baseInput,
    baseNote,
    dest,
    destExactText,
    destNote,
    destShort,
    forkNote,
    nameError,
    nameInput,
    partialNote,
    pathInput,
    pathNote,
    repoHint,
  } = deps.fields;

  /** The exact path the line is currently shortening; read on every show. */
  let destExact = "";

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

  function syncDerived(settled = false): void {
    const repo = deps.currentRepo();
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
    deps.syncMigration(repo.migration);
    deps.syncWaitForSetup();

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
      pickDestination.disabled = destRefused !== undefined || deps.pickAsking() || bring.anyAsking();
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
      deps.ensureDestTip();
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
    const unanswered = !detached && !deps.nameLeft() && draft.branchName.trim().length === 0;
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
    const unprompted = detached ? !deps.baseLeft() : !deps.nameLeft();
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
              : asks.outstanding() || deps.pickAsking()
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
    deps.syncAfterHint();
    deps.refreshFocusTrap();
  }
  return {
    sync: syncDerived,
    destExact: () => destExact,
  };
}
