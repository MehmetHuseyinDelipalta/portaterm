// src/webview/worktree/controller/dialogChannels.ts — The create form's answer sinks.
//
// Extracted from `WorktreeController` by change `decompose-worktree-host-controller`
// (design.md D1). One owner for the eight bind/push pairs the open create form
// registers, which were eight `private apply*` fields correlated by hand.
//
// Deliberately NO `clear`: the controller never set those fields back to null, so
// a closed form's sink stays bound and an answer that outlived its dialog is
// dropped by the TOKEN GUARD in the caller, not by unbinding here. Adding a clear
// would be new behaviour, not a move.
//
// Deliberately NOT here: the seven outbound request builders. Four send the live
// `refsToken` and three send the opening captured at compose time, and that
// asymmetry is load-bearing (design.md D1 § What cluster 2 does not touch).

import type {
  WorktreeCreateResolutionMessage,
  WorktreeDebrisAuthorizedMessage,
  WorktreeDestinationPickedMessage,
} from "../../../types/messages";
import type {
  WorktreeCreateDefaults,
  WorktreeMigrationOffer,
  WorktreeProvisionOffer,
  WorktreePullRequestOffer,
  WorktreeRefOffer,
} from "../worktreeViewTypes";

/** A sink the open form registers, and the host answers it receives. */
export interface Channel<A extends unknown[]> {
  /** Register the open form's receiver, replacing any predecessor's. */
  bind(sink: (...args: A) => void): void;
  /** Deliver an answer. No sink yet — no form has ever opened — drops it. */
  push(...args: A): void;
  /**
   * Has any form ever bound here?
   *
   * Not used in production — nothing branches on it. It exists so a test that
   * measures a DROP can first prove a sink was bound, which is the difference
   * between "the answer went nowhere" and an assertion that could not fail.
   */
  bound(): boolean;
}

/**
 * A sink held WITH the opening that composed it.
 *
 * The opening travels beside the callback rather than being read when an answer
 * lands: a form stays interactive until its successor's defaults arrive, so
 * between `openCreate` and that render the controller's current opening is the
 * SUCCESSOR's while the bound form is the predecessor (round-1 F002).
 */
export interface OpeningChannel<A extends unknown[]> {
  bind(opening: number, sink: (...args: A) => void): void;
  /** Deliver only when the answer names the opening the bound form asked in. */
  pushWhenOpening(opening: number, ...args: A): void;
}

function channel<A extends unknown[]>(): Channel<A> {
  let sink: ((...args: A) => void) | null = null;
  return {
    bind: (next) => {
      sink = next;
    },
    push: (...args) => sink?.(...args),
    bound: () => sink !== null,
  };
}

function openingChannel<A extends unknown[]>(): OpeningChannel<A> {
  let held: { opening: number; sink: (...args: A) => void } | null = null;
  return {
    bind: (opening, sink) => {
      held = { opening, sink };
    },
    pushWhenOpening: (opening, ...args) => {
      if (held !== null && held.opening === opening) {
        held.sink(...args);
      }
    },
  };
}

/** Every answer channel one open create form holds. */
export interface DialogChannels {
  /** Carries the DESTINATION. Provisioning has its own channel because the form
   * clears its pending gate on any answer through this one, and routing
   * provisioning here enabled Create on a stale path (.reviews/round-1.md B4). */
  readonly defaults: Channel<[WorktreeCreateDefaults]>;
  readonly provisioning: Channel<[string, WorktreeProvisionOffer]>;
  readonly migration: Channel<[string, WorktreeMigrationOffer | undefined]>;
  readonly refs: Channel<[string, WorktreeRefOffer]>;
  readonly pullRequests: Channel<[string, WorktreePullRequestOffer]>;
  readonly resolution: Channel<[WorktreeCreateResolutionMessage]>;
  readonly debrisAuthorization: Channel<[WorktreeDebrisAuthorizedMessage]>;
  readonly destinationPicked: OpeningChannel<[WorktreeDestinationPickedMessage]>;
}

export function createDialogChannels(): DialogChannels {
  return {
    defaults: channel(),
    provisioning: channel(),
    migration: channel(),
    refs: channel(),
    pullRequests: channel(),
    resolution: channel(),
    debrisAuthorization: channel(),
    destinationPicked: openingChannel(),
  };
}
