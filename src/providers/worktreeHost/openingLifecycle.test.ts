// src/providers/worktreeHost/openingLifecycle.test.ts — OBL-5: the three invalid
// live/high-water combinations the two maps admitted are unrepresentable here,
// and every one of the five transitions still lands where it did.

import { describe, expect, it } from "vitest";
import {
  createOpeningLifecycle,
  highWaterOf,
  isLiveAt,
  type OpeningState,
  PRISTINE,
  reduceOpening,
} from "./openingLifecycle";

/**
 * The invariant the two maps could not hold: a served token IS the high-water.
 *
 * Each of D5's three invalid combinations breaks it — live with no high-water
 * (high-water 0 under a positive token), live below its high-water, live above
 * it — so one predicate rules out all three.
 */
function servedTokenIsTheHighWater(state: OpeningState): boolean {
  return state.phase !== "live" || highWaterOf(state) === state.token;
}

describe("the opening reducer", () => {
  it("admits the first open and serves it", () => {
    const out = reduceOpening(PRISTINE, { kind: "open", token: 4 });
    expect(out.admitted).toBe(true);
    expect(out.supersedes).toBe(true);
    expect(out.state).toEqual({ phase: "live", token: 4 });
  });

  it("admits a repeat of the token being served, and supersedes nothing", () => {
    const live: OpeningState = { phase: "live", token: 4 };
    const out = reduceOpening(live, { kind: "open", token: 4 });
    expect(out.admitted).toBe(true);
    expect(out.supersedes).toBe(false);
    expect(out.state).toBe(live);
  });

  it("supersedes on a higher token and leaves nothing of the old one live", () => {
    const out = reduceOpening({ phase: "live", token: 4 }, { kind: "open", token: 5 });
    expect(out.supersedes).toBe(true);
    expect(isLiveAt(out.state, 4)).toBe(false);
    expect(isLiveAt(out.state, 5)).toBe(true);
  });

  it("refuses a delayed predecessor rather than moving the surface backwards", () => {
    const live: OpeningState = { phase: "live", token: 5 };
    const out = reduceOpening(live, { kind: "open", token: 4 });
    expect(out.admitted).toBe(false);
    expect(out.state).toBe(live);
  });

  it("refuses a replay of a closed form, which is what the high-water is for", () => {
    const closed = reduceOpening({ phase: "live", token: 5 }, { kind: "close" }).state;
    expect(closed).toEqual({ phase: "retired", highWater: 5 });
    expect(reduceOpening(closed, { kind: "open", token: 5 }).admitted).toBe(false);
    expect(reduceOpening(closed, { kind: "open", token: 6 }).admitted).toBe(true);
  });

  it("resets the whole history on detach, so the same token opens again", () => {
    const closed = reduceOpening({ phase: "live", token: 5 }, { kind: "close" }).state;
    const reset = reduceOpening(closed, { kind: "detach" }).state;
    expect(reset).toEqual(PRISTINE);
    expect(reduceOpening(reset, { kind: "open", token: 5 }).admitted).toBe(true);
  });

  it("never reaches a state where the served token is not the high-water", () => {
    const events = [
      { kind: "open", token: 1 },
      { kind: "open", token: 1 },
      { kind: "open", token: 3 },
      { kind: "open", token: 2 },
      { kind: "close" },
      { kind: "open", token: 3 },
      { kind: "open", token: 9 },
      { kind: "detach" },
      { kind: "open", token: 1 },
      { kind: "close" },
      { kind: "close" },
    ] as const;
    let state: OpeningState = PRISTINE;
    for (const event of events) {
      state = reduceOpening(state, event).state;
      expect(servedTokenIsTheHighWater(state)).toBe(true);
    }
  });
});

describe("the lifecycle store", () => {
  it("keeps admitOpen pure, so the caller can sweep between admit and mark", () => {
    const lifecycle = createOpeningLifecycle();
    lifecycle.markOpen("s1", 4);

    const admission = lifecycle.admitOpen("s1", 5);
    expect(admission).toEqual({ admitted: true, supersedes: true });
    // Nothing moved yet: the old opening is still the one being served, which is
    // what lets `retireOpening` sweep ITS slots before the new one is committed.
    expect(lifecycle.isLive("s1", 4)).toBe(true);

    lifecycle.markOpen("s1", 5);
    expect(lifecycle.isLive("s1", 5)).toBe(true);
  });

  it("holds no row for a detached surface", () => {
    const lifecycle = createOpeningLifecycle();
    lifecycle.markOpen("s1", 4);
    lifecycle.detach("s1");
    expect(lifecycle.stateOf("s1")).toEqual(PRISTINE);
    expect(lifecycle.admitOpen("s1", 4).admitted).toBe(true);
  });

  it("keeps surfaces apart", () => {
    const lifecycle = createOpeningLifecycle();
    lifecycle.markOpen("s1", 4);
    expect(lifecycle.isLive("s2", 4)).toBe(false);
    expect(lifecycle.admitOpen("s2", 1).admitted).toBe(true);
  });
});
