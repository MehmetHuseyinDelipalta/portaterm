// src/providers/worktreeHost/openingLifecycle.ts — One representation of where a
// surface's create form is in its life.
//
// Replaces the parallel `liveOpening` / `openingHighWater` maps (design.md D5).
// Those two admitted three combinations that mean nothing: a live opening with no
// high-water, a live opening below its high-water, and one above it. The union
// below cannot express any of them — `live` carries ONE number that is both the
// token being served and the highest ever named, and `retired` carries only the
// high-water, because a retired form is not being served at all.
//
// A module-level reducer, not a class: phase is derived in one place and the
// callers hold nothing but the map (design.md D5).

/**
 * Where one surface's form stands.
 *
 * - `pristine` — nothing has ever been opened here, or a detach reset it.
 * - `live` — `token` is being served, and no higher token has ever been named.
 * - `retired` — `highWater` was the last token named, and nothing is being served.
 */
export type OpeningState =
  | { readonly phase: "pristine" }
  | { readonly phase: "live"; readonly token: number }
  | { readonly phase: "retired"; readonly highWater: number };

/** The five transitions, as three events: `open` carries initial/repeat/supersede. */
export type OpeningEvent =
  | { readonly kind: "open"; readonly token: number }
  | { readonly kind: "close" }
  | { readonly kind: "detach" };

export interface OpeningOutcome {
  readonly state: OpeningState;
  /** The event was legitimate. A refused `open` leaves `state` untouched. */
  readonly admitted: boolean;
  /**
   * This `open` displaced a DIFFERENT token, so everything the old one derived
   * — read slots, switch ceilings, issued offers — is now stale.
   *
   * False for a repeat: re-asking the form being served displaces nothing, and
   * sweeping there would drop the offer the user is looking at.
   */
  readonly supersedes: boolean;
}

export const PRISTINE: OpeningState = { phase: "pristine" };

/** The highest token this surface has ever named. Zero before the first open. */
export function highWaterOf(state: OpeningState): number {
  switch (state.phase) {
    case "pristine":
      return 0;
    case "live":
      return state.token;
    case "retired":
      return state.highWater;
  }
}

/** Is this exact token the one being served? */
export function isLiveAt(state: OpeningState, token: number): boolean {
  return state.phase === "live" && state.token === token;
}

/**
 * The whole lifecycle, in one place.
 *
 * An `open` is admitted only when it REPEATS what is being served or ADVANCES
 * past everything this surface has ever named. Anything else is a replay of a
 * spent form or a delayed predecessor, and adopting either puts the host back
 * onto a conversation the user has already ended (.reviews/round-1.md B1).
 */
export function reduceOpening(state: OpeningState, event: OpeningEvent): OpeningOutcome {
  switch (event.kind) {
    case "open": {
      if (isLiveAt(state, event.token)) {
        return { state, admitted: true, supersedes: false };
      }
      if (event.token <= highWaterOf(state)) {
        return { state, admitted: false, supersedes: false };
      }
      return { state: { phase: "live", token: event.token }, admitted: true, supersedes: true };
    }
    case "close":
      return state.phase === "live"
        ? { state: { phase: "retired", highWater: state.token }, admitted: true, supersedes: false }
        : { state, admitted: false, supersedes: false };
    case "detach":
      return { state: PRISTINE, admitted: true, supersedes: false };
  }
}

/**
 * The reducer behind a map, keyed by surface.
 *
 * `admitOpen` is deliberately PURE and separate from `markOpen`: the caller has
 * to sweep the superseded opening's derived slots between the two, exactly as
 * the two maps required it to retire before it set (design.md D5).
 */
export interface OpeningLifecycle {
  stateOf(key: string): OpeningState;
  isLive(key: string, token: number): boolean;
  admitOpen(key: string, token: number): { readonly admitted: boolean; readonly supersedes: boolean };
  markOpen(key: string, token: number): void;
  close(key: string): void;
  detach(key: string): void;
}

export function createOpeningLifecycle(): OpeningLifecycle {
  const byKey = new Map<string, OpeningState>();
  const read = (key: string): OpeningState => byKey.get(key) ?? PRISTINE;
  const write = (key: string, state: OpeningState): void => {
    // `pristine` is the absence of an entry, so a detach leaves no row behind:
    // the map is bounded by live surfaces rather than by every surface ever seen.
    if (state.phase === "pristine") {
      byKey.delete(key);
    } else {
      byKey.set(key, state);
    }
  };

  return {
    stateOf: read,
    isLive: (key, token) => isLiveAt(read(key), token),
    admitOpen(key, token) {
      const { admitted, supersedes } = reduceOpening(read(key), { kind: "open", token });
      return { admitted, supersedes };
    },
    markOpen(key, token) {
      write(key, reduceOpening(read(key), { kind: "open", token }).state);
    },
    close(key) {
      write(key, reduceOpening(read(key), { kind: "close" }).state);
    },
    detach(key) {
      write(key, reduceOpening(read(key), { kind: "detach" }).state);
    },
  };
}
