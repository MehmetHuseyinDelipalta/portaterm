// src/providers/worktreeHost/actions/create/refsArm.ts — The branch enumeration
// a create form rides, and the pull requests offered beside it.
//
// Extracted from `createCreateActions` by change `decompose-worktree-host`
// (design.md D1, task 2_17). Planned to sit beside the defaults arm in one
// file; the two together came to 498 lines and `asm refactor shape` still
// fired, so the arm that ESTABLISHES nothing was cut from the arm that mints
// the opening.
//
// This is the message the probe and the debris authorization are gated on, so
// it is an authority door: it may only ride an opening this surface already
// holds, never advance one (.reviews/round-3.md B2, design.md D5).

import type { WorktreeActionMessage } from "../../../../types/messages";
import type { PullRequestsRead } from "../../../../worktree/repoPullRequests";
import type { createWorktreeCache } from "../../../../worktree/WorktreeCache";
import type { WorktreeHostOptions } from "../../../WorktreeHost";
import type { Opening, WorktreeSurface } from "../../hostTypes";
import { namedOpening } from "../../messageGuards";
import type { OpeningLifecycle } from "../../openingLifecycle";

/** What answering a refs ask needs from the host. A subset of `CreateDeps`. */
export interface RefsDeps {
  readonly cache: ReturnType<typeof createWorktreeCache>;
  readonly lifecycle: OpeningLifecycle;
  readonly openings: Map<string, Opening>;
  readonly options: WorktreeHostOptions;
  disposed(): boolean;
  hasSurface(surface: WorktreeSurface): boolean;
  openingKey(s: WorktreeSurface, repoId: string): string;
  surfaceKey(s: WorktreeSurface): string;
}

/**
 * Ask the forge for this repository's open pull requests, on its own promise.
 *
 * Started when the form opens and resolved separately: a forge that is slow,
 * absent or unauthenticated must not delay the local branch list underneath it
 * (worktree-create.md § 4.1, design.md D3). There is deliberately no code path
 * on which the refs answer awaits this one.
 */
function offerPullRequests(
  deps: RefsDeps,
  surface: WorktreeSurface,
  msg: Extract<WorktreeActionMessage, { type: "requestWorktreeRefs" }>,
  repo: { mainPath: string },
  refsLive: () => boolean,
): void {
  const forge = deps.options.readPullRequests;
  if (forge === undefined) {
    return;
  }
  const unavailable = {
    type: "worktreePullRequests",
    token: msg.token,
    repoId: msg.repoId,
    available: false,
  } as const;
  const postForge = (answer: PullRequestsRead | undefined): void => {
    if (deps.disposed() || !deps.hasSurface(surface)) {
      return;
    }
    // The form may have closed while the forge was answering. A reply
    // for a retired opening is a reply for a conversation that ended.
    if (!refsLive()) {
      return;
    }
    // Unavailable is POSTED rather than withheld: the form has a row
    // to render for it, and silence would leave "not asked yet" and
    // "asked and there are none to be had" indistinguishable.
    surface.post(
      answer?.ok === true
        ? {
            type: "worktreePullRequests",
            token: msg.token,
            repoId: msg.repoId,
            pullRequests: answer.pullRequests,
            truncated: answer.truncated,
            available: true,
          }
        : unavailable,
    );
  };
  void forge({ cwd: repo.mainPath })
    .then(postForge)
    // Discovery, never the create. A reader that throws must not take
    // the destination reply — or the refs answer — down with it. It also
    // must not leave the form waiting forever: a rejection is one more
    // way the forge did not answer, so it POSTS the unavailable row
    // rather than being swallowed (.reviews/round-1.md W1).
    .catch(() => {
      postForge(undefined);
    });
}

/**
 * Post the enumeration when it lands, if the form that asked is still there.
 *
 * A failed read posts nothing: the form treats absent as "not told yet", which
 * is honest, and the create-new row is never gated on this. Saying `refs: []`
 * would state that the repository has no branches — a claim git declined to
 * make.
 */
function postRefs(
  deps: RefsDeps,
  surface: WorktreeSurface,
  msg: Extract<WorktreeActionMessage, { type: "requestWorktreeRefs" }>,
  refsLive: () => boolean,
  inFlight: ReturnType<NonNullable<WorktreeHostOptions["readRefs"]>>,
): void {
  void inFlight
    .then((answer) => {
      // The surface may have detached while git was answering. Posting to
      // a dead one is at best wasted, and the form it described is gone.
      if (deps.disposed() || !deps.hasSurface(surface)) {
        return;
      }
      // A failed read posts nothing: the form treats absent as "not told
      // yet", which is honest, and the create-new row is never gated on
      // this. Saying `refs: []` would state that the repository has no
      // branches — a claim git declined to make.
      if (answer.ok !== true) {
        return;
      }
      // Same rule as the forge continuation above: retirement outranks a
      // read that was already running when it happened.
      if (!refsLive()) {
        return;
      }
      surface.post({
        type: "worktreeRefs",
        token: msg.token,
        repoId: msg.repoId,
        refs: answer.refs,
        truncated: answer.truncated,
      });
    })
    // The list is discovery, never the create. A reader that throws must
    // not take the destination reply down with it.
    .catch(() => {});
}

export function handleWorktreeRefs(
  deps: RefsDeps,
  surface: WorktreeSurface,
  msg: Extract<WorktreeActionMessage, { type: "requestWorktreeRefs" }>,
): void {
  // One group, not a snapshot of the workspace. This runs once per
  // repository when the dialog opens, so `deps.cache.read()` here made the
  // open cost R × O(R + W) in copying alone (round-1 B3).
  // This is the message that SEEDS the record probe and debris
  // authorization are gated on, so it is an authority door and has to be
  // guarded like one. Retirement swept the records and this writer put one
  // straight back: replaying a retired token here recreated the entry, and
  // the probe-then-authorize pair then reached `issueDebrisAuthorization`
  // exactly as it would have before the close (.reviews/round-3.md B2).
  // Closing the sweep without closing the writer left D5's own sentence —
  // retirement withdraws every channel the opening carries — false.
  //
  // Equality, not the defaults ask's repeat-or-advance rule: refs never
  // ESTABLISHES an opening. The branch-less defaults ask is the only door
  // that does, and the panel always sends it first, so a legitimate refs
  // ask is always riding an opening this surface already holds. Letting
  // refs advance the mark too would give a second message the power to
  // mint a form's identity.
  //
  // `namedOpening` here is defence in depth and no test can kill it on its
  // own: the deps.lifecycle only ever serves tokens that already passed it on the
  // defaults channel, so the equality alone rejects `0`, a fraction and a
  // string too. Kept because the shape check is what makes the equality's
  // guarantee legible at this door rather than three hundred lines away —
  // the same call the close-side guard makes.
  const refsKey = deps.surfaceKey(surface);
  if (!namedOpening(msg.token) || !deps.lifecycle.isLive(refsKey, msg.token)) {
    return;
  }
  /** Still the opening this read belongs to, checked after every await. */
  const refsLive = (): boolean => deps.lifecycle.isLive(refsKey, msg.token);
  const repo = deps.cache.readRepo(msg.repoId);
  if (repo === undefined) {
    return;
  }
  // Started here because one gesture opens the form, and resolved on its
  // own promise posting its own message: a forge that is slow, absent or
  // unauthenticated must not delay the local list underneath it
  // (worktree-create.md § 4.1, design.md D3). There is deliberately no
  // code path on which the refs answer awaits this one.
  offerPullRequests(deps, surface, msg, repo, refsLive);
  const read = deps.options.readRefs;
  if (read === undefined) {
    return;
  }
  // Kept so the probe can classify against it instead of asking git a
  // second time for an answer the dialog's opening already paid for
  // (design.md D2). The PROMISE rather than its value: a settle that
  // lands before the read resolves joins this one rather than starting
  // another. One entry per repository, replaced on every ask.
  const inFlight = read({ cwd: repo.mainPath, worktrees: repo.worktrees });
  // This ask IS the new opening: the record is REPLACED, so the previous
  // one is gone without anything having to go looking for it (B7, W8).
  deps.openings.set(deps.openingKey(surface, msg.repoId), {
    token: msg.token,
    read: inFlight,
    latestSeq: Number.NEGATIVE_INFINITY,
    debrisCandidate: null,
    publishedRepair: null,
    // A fresh opening was offered no folder. This is also what a REPLAY of
    // this request costs a form that had one: the record is dropped, which
    // narrows the honoured area to the configured root and can never widen
    // it (design.md D4).
    chosenRoot: null,
    // A fresh opening has confirmed nothing, so a pick still suspended on
    // the opening this one replaced can never match it.
    pickGeneration: 0,
  });
  postRefs(deps, surface, msg, refsLive, inFlight);
  return;
}
