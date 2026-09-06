// src/webview/worktree/createDialog/hostBindings.ts — The eight channels the
// host answers on, and the guards that decide whether an answer still describes
// this form.
//
// Extracted from `openWorktreeCreateDialog` by change `decompose-create-dialog`
// (design.md D1, task 1_10). Every one of these is a reply racing the typing
// that produced it, so what they share is a shape rather than a subject: check
// that the dialog is still open, that the answer names the repository on screen,
// and that it answers the question this form actually asked — then hand it to
// whichever collaborator owns it and re-derive.
//
// The collaborators own the reconciliation; this file owns only the guards.
// `recover.applyAnswer`, `asks.applyResolution` and `bring.settleAway` each keep
// their own half, which is why those handlers are three lines here and were
// thirty before tasks 1_5, 1_6 and 1_7.
//
// No suite beside this file (design.md D2): the 386-case dialog suite drives
// every channel, and a stale answer for each — a repository the picker has left,
// a branch the user has typed past, an opening that is over.

import type { WorktreeCreateDefaults, WorktreeMigrationOffer } from "../worktreeViewTypes";
import type { WorktreeCreateDialogDeps } from "./dialogDeps";
import type { DraftModel } from "./draftModel";
import type { ProvisionState } from "./provisionState";
import type { ProvisionView } from "./provisionView";
import type { RecoverOffer } from "./recoverOffer";
import type { ResolutionAsks } from "./resolutionAsks";

export interface HostBindingsDeps {
  readonly model: DraftModel;
  readonly asks: ResolutionAsks;
  readonly bring: ProvisionState;
  readonly bringView: ProvisionView;
  readonly recover: RecoverOffer;
  readonly branchList: { refreshIfOpen(): void };
  /** The dialog's own copy, spliced in place as answers land. */
  readonly repos: WorktreeCreateDefaults[];
  /** The pick this form is still waiting on, or null. */
  pickAsked(): number | null;
  clearPickAsked(): void;
  stateDestination(next: { kind: "chosen" } | { kind: "typed"; path: string }): void;
  syncDerived(settled?: boolean): void;
  syncMigration(offer: WorktreeMigrationOffer | undefined): void;
  /** The dialog's own deps object, passed whole: a channel dropped on the way
   *  through would be a host answer nobody applies. */
  bind: WorktreeCreateDialogDeps;
}

/** Attach every channel. Called once, at the end of the dialog's construction. */
export function attachHostBindings(deps: HostBindingsDeps): void {
  const { asks, branchList, bring, bringView, model, recover, repos, stateDestination, syncMigration } = deps;
  const draft = model.draft;
  const syncDerived = deps.syncDerived;
  const pickAsked = (): number | null => deps.pickAsked();

  // A fresh answer replaces the repo's seed and re-renders. Only the path the
  // user has not typed over moves — an edited path is theirs.
  // One transition, not a second one: the picked folder is stated exactly as a
  // typed one is. The controller has already dropped an answer for any opening
  // but this form's, so there is no second place deciding that here.
  deps.bind.bindDestinationPicked?.((answer) => {
    // Only the pick this form is still waiting on. The controller drops an
    // answer for another OPENING; this drops one for another PICK, which is the
    // case a user who picked, then typed, then saw the first answer land would
    // otherwise lose their typed path to (design.md D7).
    if (answer.ask !== pickAsked()) {
      return;
    }
    deps.clearPickAsked();
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

  deps.bind.bindDefaults?.((next) => {
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
  deps.bind.bindProvisioning?.((repoId, offer) => {
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

  deps.bind.bindMigration?.((repoId, offer) => {
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
  deps.bind.bindPullRequests?.((repoId, offer) => {
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
  deps.bind.bindRefs?.((repoId, refs) => {
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
  deps.bind.bindResolution?.((resolution) => {
    if (model.closed() || resolution.repoId !== draft.repoId) {
      return;
    }
    asks.applyResolution(resolution);
  });

  // The answer to the ONE request the acceptance sent. Anything about another
  // directory is dropped rather than applied: an authorization is bound to a
  // path, and applying one issued for a different path is exactly the confusion
  // the fingerprint exists to stop.
  deps.bind.bindDebrisAuthorization?.((answer) => {
    if (model.closed() || answer.repoId !== draft.repoId) {
      return;
    }
    recover.applyAnswer(answer);
  });
}
