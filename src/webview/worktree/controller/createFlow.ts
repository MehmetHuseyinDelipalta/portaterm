// src/webview/worktree/controller/createFlow.ts — Opening a create: which
// repositories are asked, what the previous opening's answers are cleared of,
// and the token every reply is then measured against.
//
// Extracted from `WorktreeController` by change `decompose-worktree-view`
// (design.md D1, task 3_5). The three doors — a row, a repository header and
// the toolbar — differ only in which repository the form opens ON, and every
// one of them asks every repository. That rule had no single place to live.
//
// The answers themselves are `createAnswers.ts`, split out in this same task
// when the two halves together came to 585 lines. This file imports that one.
//
// `pendingCreate` is MOVED, not copied. Its two outside writers — visibility on
// a hide, and tree reconciliation on a departure — reach it through this
// module's accessors, because two records is exactly OBL-3's defeater.

import type {
  WorktreeCreateDefaultsMessage,
  WorktreeCreateResolutionMessage,
  WorktreeDebrisAuthorizedMessage,
  WorktreeDestinationPickedMessage,
  WorktreeMigrationOfferMessage,
  WorktreeProvisionOfferMessage,
  WorktreePullRequestsMessage,
  WorktreeRefsMessage,
} from "../../../types/messages";
import type { WorktreeCreateDefaults, WorktreeInfo } from "../worktreeViewTypes";
import {
  type CreateFlowDeps,
  type CreateSource,
  type CreateState,
  createRepos,
  handleCreateDefaults,
  handleCreateResolution,
  handleDebrisAuthorized,
  handleDestinationPicked,
  handleMigrationOffer,
  handleProvisionOffer,
  handlePullRequests,
  handleRefs,
  openPendingCreate,
  type PendingCreate,
  resolutionFor,
} from "./createAnswers";

export type { CreateFlowDeps, CreateSource, PendingCreate } from "./createAnswers";

/**
 * Ask the host where a create would go, then open the form on its answer.
 * Nothing opens until the answer arrives: a form seeded with a guess would
 * name a destination the create could refuse.
 */
function openCreateFor(deps: CreateFlowDeps, state: CreateState, info: WorktreeInfo): void {
  const repo = deps.repoFor(info);
  if (repo === undefined) {
    return;
  }
  openCreateForRepo(deps, state, repo.repoId, info.id);
}

/**
 * Ask where a create would go, then open the form on the answer. With a
 * repository, that one; without, every repository in the tree — a door that
 * names none must offer them all rather than pick one for the user.
 */
function openCreateForRepo(deps: CreateFlowDeps, state: CreateState, repoId?: string, sourceWorktreeId?: string): void {
  // EVERY door asks every repository. The picker is built from the answers the
  // seed holds, so a door that asked about one would offer one — and the doors
  // are required to differ only in which repository the form opens ON.
  const repos = deps.tree()?.repos ?? [];
  const targets = repos.map((repo) => repo.repoId);
  if (targets.length === 0 || (repoId !== undefined && !targets.includes(repoId))) {
    return;
  }
  const sourceRepo = repoId === undefined ? undefined : repos.find((repo) => repo.repoId === repoId);
  const source =
    sourceWorktreeId === undefined
      ? null
      : sourceRepo?.worktrees.some((row) => row.id === sourceWorktreeId)
        ? {
            repoId: sourceRepo.repoId,
            worktreeId: sourceWorktreeId,
            ...(sourceRepo.generation === undefined ? {} : { generation: sourceRepo.generation }),
          }
        : undefined;
  if (source === undefined) {
    return;
  }
  state.createSource = source;
  // A new form starts with no provisioning. Seeding it from the previous
  // form's offer meant a fresh read that FAILED left the old model on screen,
  // still resolvable, attributed to a form that had closed
  // (.reviews/round-2.md B6). Absent renders as "not told yet", which is the
  // honest state until the host answers.
  deps.provisionOffers().clear();
  for (const migrationRepoId of state.migrationOffers.keys()) {
    deps.dialogChannels().migration.push(migrationRepoId, undefined);
  }
  state.migrationOffers.clear();
  // Cleared on the same terms as the offer: a list seeded from the previous
  // form describes a repository state that may have moved, and the honest
  // opening state is "not told yet".
  deps.repoRefs().clear();
  state.repoPullRequests.clear();
  state.createResolutions.clear();
  state.probeSeq = 0;
  state.refsToken += 1;
  state.pendingCreate = {
    // Kept so a create that cannot open can name what it was waiting on: the
    // outstanding set is empty by the time that is known.
    asked: [...targets],
    outstanding: new Set(targets),
    ...(repoId === undefined ? {} : { initialRepoId: repoId }),
  };
  for (const target of targets) {
    deps.postMessage({
      type: "requestWorktreeCreateDefaults",
      repoId: target,
      opening: state.refsToken,
      ...(source?.repoId === target
        ? {
            sourceWorktreeId: source.worktreeId,
            ...(source.generation === undefined ? {} : { sourceGeneration: source.generation }),
          }
        : {}),
    });
    // Not awaited by `pendingCreate`: the form opens on the destination alone
    // and gains the list when it lands, so a repository whose enumeration is
    // slow or fails never holds the dialog shut.
    deps.postMessage({ type: "requestWorktreeRefs", repoId: target, token: state.refsToken });
  }
}

/** The toolbar door, which names no repository. */
function openCreate(deps: CreateFlowDeps, state: CreateState): void {
  openCreateForRepo(deps, state);
}
export interface CreateFlow {
  /** The opening every answer below is compared against. */
  refsToken(): number;
  /**
   * Retire the opening `opening` names, if it is still the live one. A close
   * that names an earlier opening retires nothing — its successor is live.
   */
  retireOpening(opening: number): void;
  /** A fresh probe number within this opening. */
  nextProbeSeq(): number;
  createSource(): CreateSource | null;
  clearCreateSource(): void;
  /** The migration offers held for this opening, reconciled by the tree. */
  migrationOffers(): Map<string, WorktreeMigrationOfferMessage>;
  frozenCreateOffer(): { offerId?: string } | null;
  pendingCreate(): PendingCreate | null;
  clearPendingCreate(): void;
  /** Open the form the completed ask was for. */
  openPendingCreate(pending: PendingCreate): void;
  /** Every repo the host has answered for, as the form's seed. */
  createRepos(): WorktreeCreateDefaults[];
  openCreateFor(info: WorktreeInfo): void;
  openCreateForRepo(repoId?: string, sourceWorktreeId?: string): void;
  openCreate(): void;
  handleMigrationOffer(msg: WorktreeMigrationOfferMessage): void;
  handleProvisionOffer(msg: WorktreeProvisionOfferMessage): void;
  handleRefs(msg: WorktreeRefsMessage): void;
  handlePullRequests(msg: WorktreePullRequestsMessage): void;
  handleCreateResolution(msg: WorktreeCreateResolutionMessage): void;
  handleDebrisAuthorized(msg: WorktreeDebrisAuthorizedMessage): void;
  handleDestinationPicked(msg: WorktreeDestinationPickedMessage): void;
  handleCreateDefaults(msg: WorktreeCreateDefaultsMessage): void;
  resolutionFor(repoId: string): WorktreeCreateResolutionMessage | undefined;
}

export function createCreateFlow(deps: CreateFlowDeps): CreateFlow {
  const state: CreateState = {
    probeSeq: 0,
    refsToken: 0,
    createSource: null,
    pendingCreate: null,
    migrationOffers: new Map(),
    repoPullRequests: new Map(),
    createResolutions: new Map(),
    frozenCreateOffer: null,
  };

  return {
    refsToken: () => state.refsToken,
    retireOpening(opening) {
      if (opening === state.refsToken) {
        state.refsToken += 1;
      }
    },
    nextProbeSeq() {
      state.probeSeq += 1;
      return state.probeSeq;
    },
    createSource: () => state.createSource,
    clearCreateSource() {
      state.createSource = null;
    },
    migrationOffers: () => state.migrationOffers,
    frozenCreateOffer: () => state.frozenCreateOffer,
    pendingCreate: () => state.pendingCreate,
    clearPendingCreate() {
      state.pendingCreate = null;
    },
    openPendingCreate: (pending) => {
      openPendingCreate(deps, state, pending);
    },
    createRepos: () => createRepos(deps, state),
    openCreateFor: (info) => {
      openCreateFor(deps, state, info);
    },
    openCreateForRepo: (repoId, sourceWorktreeId) => {
      openCreateForRepo(deps, state, repoId, sourceWorktreeId);
    },
    openCreate: () => {
      openCreate(deps, state);
    },
    handleMigrationOffer: (msg) => {
      handleMigrationOffer(deps, state, msg);
    },
    handleProvisionOffer: (msg) => {
      handleProvisionOffer(deps, state, msg);
    },
    handleRefs: (msg) => {
      handleRefs(deps, state, msg);
    },
    handlePullRequests: (msg) => {
      handlePullRequests(deps, state, msg);
    },
    handleCreateResolution: (msg) => {
      handleCreateResolution(deps, state, msg);
    },
    handleDebrisAuthorized: (msg) => {
      handleDebrisAuthorized(deps, state, msg);
    },
    handleDestinationPicked: (msg) => {
      handleDestinationPicked(deps, state, msg);
    },
    handleCreateDefaults: (msg) => {
      handleCreateDefaults(deps, state, msg);
    },
    resolutionFor: (repoId) => resolutionFor(state, repoId),
  };
}
