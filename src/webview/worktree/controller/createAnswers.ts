// src/webview/worktree/controller/createAnswers.ts — Every answer one create
// opening waits on, the caches they land in, and the form's seed built from
// them.
//
// Extracted from `WorktreeController` by change `decompose-worktree-view`
// (design.md D1, task 3_5), then split from `createFlow.ts` in the same task:
// the openers and the answers together came to 585 lines, over the Boundary.
// This half is the contract — the deps, the state and what an answer does to
// it — and `createFlow.ts` imports it, never the other way.
//
// Every handler drops what does not carry the live opening. That is one rule
// spelled nine times on purpose: `repoId` cannot separate two openings of the
// same repository, and each answer has its own token field to compare.
//
// Three of the six answer caches stay controller FIELDS — `createDefaults`,
// `provisionOffers` and `repoRefs`, which five suites read off the instance
// (D5) — and this module reads and clears them through accessors.

import type {
  WebViewToExtensionMessage,
  WorktreeCreateDefaultsMessage,
  WorktreeCreateResolutionMessage,
  WorktreeDebrisAuthorizedMessage,
  WorktreeDestinationPickedMessage,
  WorktreeMigrationOfferMessage,
  WorktreeProvisionOfferMessage,
  WorktreePullRequestsMessage,
  WorktreeRefsMessage,
} from "../../../types/messages";
import type {
  WorktreeActionResult,
  WorktreeCreateDefaults,
  WorktreeInfo,
  WorktreeLaunchAgent,
  WorktreePullRequestOffer,
  WorktreeTree,
} from "../worktreeViewTypes";
import type { createDialogChannels } from "./dialogChannels";

/**
 * The wire answer as the form holds it (W2).
 *
 * One conversion, used by both the live route and the snapshot the form is
 * opened from. Two copies of it were what let the two disagree about what
 * `available: false` carries.
 */
export function pullRequestOffer(msg: WorktreePullRequestsMessage): WorktreePullRequestOffer {
  return msg.available ? { available: true, list: msg.pullRequests, truncated: msg.truncated } : { available: false };
}

/** The row source for one create opening, absent for repository and toolbar doors. */
export interface CreateSource {
  repoId: string;
  worktreeId: string;
  generation?: number;
}

/**
 * The create waiting on the host, and the repositories it has yet to hear
 * from. A set rather than one id because an unscoped create asks every
 * repository: the form builds its picker once, from the seed it opened with,
 * so opening on the first reply would offer one repository as the workspace.
 */
export interface PendingCreate {
  asked: string[];
  outstanding: Set<string>;
  initialRepoId?: string;
}

export interface CreateFlowDeps {
  postMessage(msg: WebViewToExtensionMessage): void;
  /** The tree these repositories are read from. Owned by `treeReconcile`. */
  tree(): WorktreeTree | null;
  repoFor(info: WorktreeInfo): { repoId: string; prunableCount: number } | undefined;
  /** The three caches D5 pins to the controller, reached rather than held. */
  createDefaults(): Map<string, WorktreeCreateDefaultsMessage>;
  provisionOffers(): Map<string, WorktreeProvisionOfferMessage>;
  repoRefs(): Map<string, WorktreeRefsMessage>;
  /** The form's answer channels. A controller field for the same reason (D5). */
  dialogChannels(): ReturnType<typeof createDialogChannels>;
  /** What the launch half of the form is seeded with. Owned by `agentActions`. */
  launchAgents(): WorktreeLaunchAgent[];
  launchOfferId(): string | undefined;
  /** The notice list, which stays a controller field (D5). */
  actionResults(): WorktreeActionResult[];
  setActionResults(next: WorktreeActionResult[]): void;
  openCreateDialog(initialRepoId?: string): void;
  push(): void;
}

/** Everything one create opening amounts to, and the answers it is holding. */
export interface CreateState {
  /**
   * Minted per probe, so two asks for one query inside one opening can be told
   * apart. `token` separates openings; nothing else separates these (D1).
   */
  probeSeq: number;
  /**
   * Which opening of the create dialog the refs conversation belongs to.
   *
   * Bumped per open, echoed by the host, and compared on the way back — the
   * only thing that tells a reopening's answer from its predecessor's, since
   * `repoId` is the same on both (round-2 W2).
   */
  refsToken: number;
  createSource: CreateSource | null;
  pendingCreate: PendingCreate | null;
  /** The source snapshot move offer, held separately from per-keystroke defaults. */
  migrationOffers: Map<string, WorktreeMigrationOfferMessage>;
  /**
   * The forge's answer per repository, held on the same terms as `repoRefs`.
   *
   * Its own map rather than a field on that one: the two answers arrive
   * independently and either can be absent while the other is present, which is
   * the property the separate message exists to give the form.
   */
  repoPullRequests: Map<string, WorktreePullRequestsMessage>;
  /**
   * The host's answer to the last settled selection, per repository.
   *
   * Kept beside `repoRefs` and cleared on the same terms: a resolution seeded
   * from the previous form describes a repository state that may have moved.
   */
  createResolutions: Map<string, WorktreeCreateResolutionMessage>;
  /** The offer the open create form was rendered against. */
  frozenCreateOffer: { offerId?: string } | null;
}

export function createRepos(deps: CreateFlowDeps, state: CreateState): WorktreeCreateDefaults[] {
  const repos: WorktreeCreateDefaults[] = [];
  for (const repo of deps.tree()?.repos ?? []) {
    const answer = deps.createDefaults().get(repo.repoId);
    if (answer === undefined) {
      continue;
    }
    const offer = deps.provisionOffers().get(repo.repoId);
    const migration = state.migrationOffers.get(repo.repoId);
    const refs = deps.repoRefs().get(repo.repoId);
    const prs = state.repoPullRequests.get(repo.repoId);
    repos.push({
      repoId: repo.repoId,
      repoLabel: repo.label,
      mainPath: repo.mainPath,
      pathParent: answer.root,
      pathPrefix: answer.prefix,
      // ALWAYS the host's path: it is the destination the create will take,
      // and the form is required to name that one rather than its own guess.
      // `collidedWith` is narrower — it marks the candidate that was occupied,
      // so the hint can say why the destination is not the obvious name.
      resolvedPath: answer.path,
      ...(answer.branch === undefined ? {} : { answersBranch: answer.branch }),
      ...(answer.collidedWith === undefined ? {} : { collidedWith: answer.collidedWith }),
      // WT-005.3 owns launches; an option that resolves to nothing is worse
      // than no option at all.
      agents: deps.launchAgents(),
      // Absent until the offer arrives, which the form renders as "not told
      // yet" rather than as "nothing to bring over".
      ...(offer === undefined ? {} : { provisioning: { offerId: offer.offerId, model: offer.model } }),
      ...(migration === undefined ? {} : { migration: { offerId: migration.offerId, count: migration.count } }),
      // Same terms as the offer: absent renders as "not told yet", never as
      // "this repository has no branches".
      ...(refs === undefined ? {} : { refs: { list: refs.refs, truncated: refs.truncated } }),
      // Absent stays absent: "not asked yet" is not the unavailable row, and
      // the form is what decides how each of those reads.
      ...(prs === undefined ? {} : { pullRequests: pullRequestOffer(prs) }),
    });
  }
  return repos;
}

export function handleMigrationOffer(
  deps: CreateFlowDeps,
  state: CreateState,
  msg: WorktreeMigrationOfferMessage,
): void {
  const source = state.createSource;
  if (
    msg.opening !== state.refsToken ||
    source === null ||
    source.repoId !== msg.repoId ||
    source.worktreeId !== msg.sourceWorktreeId ||
    msg.offerId.length === 0 ||
    !Number.isSafeInteger(msg.count) ||
    msg.count <= 0
  ) {
    return;
  }
  state.migrationOffers.set(msg.repoId, msg);
  deps.dialogChannels().migration.push(msg.repoId, { offerId: msg.offerId, count: msg.count });
}

/**
 * The host's provisioning offer for one repo.
 *
 * Stored and pushed into an open form. Superseding is the HOST's decision —
 * it issues one offer per form and evicts the previous id when it does — so
 * this simply takes the latest, and never keeps two.
 */
export function handleProvisionOffer(
  deps: CreateFlowDeps,
  state: CreateState,
  msg: WorktreeProvisionOfferMessage,
): void {
  // The rule `handleRefs` already applies, at the site that had none. Without
  // it this cached whatever arrived, so a predecessor's read landing after a
  // reopening published its model into a form that never asked for it
  // (design.md D2).
  if (msg.opening !== state.refsToken) {
    return;
  }
  deps.provisionOffers().set(msg.repoId, msg);
  // Only the repository that changed, and only the offer. Rebuilding every
  // repository's record to update one was O(repos²) across a workspace's
  // replies (round-1 S1), and sending it down the destination's channel is
  // what B4 was.
  deps.dialogChannels().provisioning.push(msg.repoId, { offerId: msg.offerId, model: msg.model });
}

/**
 * The host's branch list for one repo.
 *
 * Stored and pushed into an open form. An answer that outlived its OPENING is
 * dropped on the token, which `repoId` alone cannot do: a reopening on the
 * same repository is asking the same question twice (round-2 W2).
 */
export function handleRefs(deps: CreateFlowDeps, state: CreateState, msg: WorktreeRefsMessage): void {
  if (msg.token !== state.refsToken) {
    // An answer to a PREVIOUS opening. Dropped rather than applied: the form
    // it was asked for is gone, and its successor's list would otherwise be
    // overwritten with a predecessor's — permanently, if the successor's own
    // read fails (round-2 W2).
    return;
  }
  deps.repoRefs().set(msg.repoId, msg);
  deps.dialogChannels().refs.push(msg.repoId, { list: msg.refs, truncated: msg.truncated });
}

/**
 * The host's pull-request answer for one repo.
 *
 * Dropped on the same token as `handleRefs`, and for the same reason: both
 * are answers to one opening's `requestWorktreeRefs`, so an answer that
 * outlived its opening would otherwise seed a successor form with rows read
 * for a form the user has already closed.
 */
export function handlePullRequests(deps: CreateFlowDeps, state: CreateState, msg: WorktreePullRequestsMessage): void {
  if (msg.token !== state.refsToken) {
    return;
  }
  state.repoPullRequests.set(msg.repoId, msg);
  deps.dialogChannels().pullRequests.push(msg.repoId, pullRequestOffer(msg));
}

/**
 * What the host says a create against the settled selection would do.
 *
 * Dropped on the token for the same reason `handleRefs` drops on it: a dialog
 * reopened on the same repository has the same `repoId` and may have the same
 * `query` on the wire twice, so neither can separate two openings. `query`
 * echoes for staleness WITHIN one opening, which the form applies.
 */
export function handleCreateResolution(
  deps: CreateFlowDeps,
  state: CreateState,
  msg: WorktreeCreateResolutionMessage,
): void {
  if (msg.token !== state.refsToken) {
    return;
  }
  // `token` separates two OPENINGS and `query` separates two edits, but an
  // A → B → A edit sequence puts two answers on the wire identical in both.
  //
  // Against the latest QUESTION, not the latest answer. `appliedSeq` alone
  // let an answer for base A land after base B had been asked — newer than
  // anything applied, older than the question on screen — and clear the gate
  // with A's verdict on B, which the form cannot detect because the branch is
  // identical (round-4 B9).
  if (msg.seq !== state.probeSeq) {
    return;
  }
  state.createResolutions.set(msg.repoId, msg);
  deps.dialogChannels().resolution.push(msg);
}

/**
 * The host's answer to the form's request to clear a directory.
 *
 * Dropped on the token like every other create-dialog answer: an answer to a
 * PREVIOUS opening authorizes nothing in this one. Not stored — an
 * authorization is spent by the create that redeems it, so keeping a copy
 * here would outlive the form that asked for it.
 */
export function handleDebrisAuthorized(
  deps: CreateFlowDeps,
  state: CreateState,
  msg: WorktreeDebrisAuthorizedMessage,
): void {
  if (msg.token !== state.refsToken) {
    return;
  }
  deps.dialogChannels().debrisAuthorization.push(msg);
}

/**
 * The folder the user picked in the host's dialog.
 *
 * Dropped on the token like every other create-dialog answer: a folder picked
 * for a PREVIOUS opening states nothing in this one. This is the only place
 * that decides whether an answer belongs to the live form — the dialog
 * applies whatever reaches it.
 */
export function handleDestinationPicked(
  deps: CreateFlowDeps,
  state: CreateState,
  msg: WorktreeDestinationPickedMessage,
): void {
  // Both, and they are different questions: the token says the answer is not
  // for a retired opening, and the binding says the form on screen is the one
  // that asked. A successor's token passes the first on its own, which is how
  // a form that never opened the picker was told a folder (round-1 F002).
  if (msg.token !== state.refsToken) {
    return;
  }
  deps.dialogChannels().destinationPicked.pushWhenOpening(msg.token, msg);
}

/**
 * The resolution currently held for a repository, if one has landed.
 *
 * Held for the ANSWER's own lifecycle — supersession and the reopen that
 * clears it — and read by nothing that builds a request: the submission
 * carries the classification the form was showing (round-3 B3).
 */
export function resolutionFor(state: CreateState, repoId: string): WorktreeCreateResolutionMessage | undefined {
  return state.createResolutions.get(repoId);
}

/** The host's create destination for one repo, and the form it was asked for. */
export function handleCreateDefaults(
  deps: CreateFlowDeps,
  state: CreateState,
  msg: WorktreeCreateDefaultsMessage,
): void {
  // Before the branch-versus-branch-less distinction below, because that one
  // tells a superseded ask's leftovers from a current answer WITHIN one
  // opening. It cannot tell two openings apart at all: both ask branch-less
  // first, so a predecessor's opening answer is shaped exactly like the live
  // one's (design.md D2).
  if (msg.opening !== state.refsToken) {
    return;
  }
  deps.createDefaults().set(msg.repoId, msg);
  const pending = state.pendingCreate;
  if (pending === null || !pending.outstanding.has(msg.repoId)) {
    // The two conversations are told apart by what they carry, not by what is
    // outstanding: an OPEN form always asks with a branch and an opening ask
    // never does, and the host echoes the branch it was given. A superseded
    // ask's leftovers are therefore branch-less, and the form's own staleness
    // guard compares branches — so it could not have caught them, and one
    // cleared the wait for a branch the user had already typed (round-1 B1).
    if (msg.branch !== undefined) {
      const seed = createRepos(deps, state).find((r) => r.repoId === msg.repoId);
      if (seed !== undefined) {
        deps.dialogChannels().defaults.push(seed);
      }
    }
    return;
  }
  pending.outstanding.delete(msg.repoId);
  if (pending.outstanding.size > 0) {
    return;
  }
  openPendingCreate(deps, state, pending);
}

/**
 * Open the form the completed ask was for. Both completion paths end here —
 * the last answer, and a reconcile that dropped the last repository still
 * outstanding.
 */
/** A repo's label if the tree still holds it, else the id it was asked under. */
export function labelForRepo(deps: CreateFlowDeps, repoId: string): string {
  return deps.tree()?.repos.find((r) => r.repoId === repoId)?.label ?? repoId;
}

export function openPendingCreate(
  deps: CreateFlowDeps,
  state: CreateState,
  pending: { asked: string[]; outstanding: Set<string>; initialRepoId?: string },
): void {
  state.pendingCreate = null;
  // Frozen only for a form that actually opens: `openCreateDialog` returns on
  // an empty seed, and a standing offer for a form that never opened is a
  // claim about a dialog that is not there (round-1 S2).
  if (createRepos(deps, state).length === 0) {
    // And SAID, not merely skipped (round-2 W10). Nothing was attempted
    // because what the create would have acted in could no longer be read —
    // the repositories it asked about are not the ones the tree now holds.
    // Silence here is a "+" that does nothing when pressed.
    deps.setActionResults([
      ...deps.actionResults().filter((r) => r.action !== "create" || r.outcome !== "unavailable"),
      {
        action: "create",
        outcome: "unavailable",
        unreadable: pending.asked.map((repoId) => labelForRepo(deps, repoId)),
      },
    ]);
    deps.push();
    return;
  }
  const launchOfferId = deps.launchOfferId();
  state.frozenCreateOffer = { ...(launchOfferId === undefined ? {} : { offerId: launchOfferId }) };
  deps.openCreateDialog(pending.initialRepoId);
}
