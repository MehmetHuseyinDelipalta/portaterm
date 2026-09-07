// src/webview/worktree/worktreeView/ceilingClock.ts — When a drawn row will
// next outlive the evidence behind it, and the one timer that waits for it.
//
// Extracted from `WorktreeView` by change `decompose-worktree-view` (design.md
// D1, task 3_8). The handle, the derivation that decides whether to arm one,
// the clamp that keeps it from looping, and the tip that reads the same
// crossing for the collapsed row sat 600 lines apart in the class.
//
// The handle lives here and `dispose()` clears it, which is what the view's own
// `dispose` now calls: a view that is gone arms nothing and holds nothing armed.

import { CONFIRMATION_CEILING_MS, presentedActivity, strongestActivity } from "../worktreeFormat";
import { confidenceHint } from "../worktreeTreeView";
import type { PresenceDegradation, WorktreeAgentRow } from "../worktreeViewTypes";

/** setTimeout's delay is a signed 32-bit int; anything larger wraps and fires now. */
const MAX_TIMEOUT_MS = 2_147_483_647;

export interface CeilingClockDeps {
  /** Injected in tests so ages are deterministic. */
  clock?: () => number;
  disposed(): boolean;
  degradedSources(): readonly PresenceDegradation[];
  /** Worktree ids the last render actually drew — the scope of every crossing. */
  renderedWorktreeIds(): Set<string>;
  /** Every worktree presence knows about, drawn or not. */
  presentWorktreeIds(): readonly string[];
  rowsFor(worktreeId: string): readonly WorktreeAgentRow[];
  applyAt(now: number): void;
}

export interface CeilingClock {
  now(): number;

  /**
   * One deadline timer at the earliest crossing — never an interval, and no timer
   * at all when no row can cross. Re-armed after it fires as well as on every
   * push, or a second crossing behind the first would never be drawn.
   */
  armCeiling(now: number): void;

  /**
   * When the earliest still-confirmed claim will outlive its evidence, or
   * undefined if none can. A row already presented as something else — crossed,
   * or `unknown` because its source failed — has nothing left to cross.
   */
  nextCeilingCrossing(now: number): number | undefined;

  /**
   * What the worktree row's own glyph is qualified BY: the hint belonging to the
   * first agent row presented as the state the worktree is showing. Undefined when
   * that state needs no qualification.
   */
  strongestConfidenceTip(rows: readonly WorktreeAgentRow[], now: number): string | undefined;

  /** Cancel the handle. Called from the view's own `dispose`. */
  dispose(): void;
}

function nextCeilingCrossing(deps: CeilingClockDeps, now: number): number | undefined {
  const degraded = deps.degradedSources();
  // Scoped to what is drawn. `render` opens with `replaceChildren()`, so waking
  // for a row behind a collapsed repo, a filtered-out worktree, or one past the
  // display cap would tear the whole list down to change nothing a user can see.
  const drawn = deps.renderedWorktreeIds();
  let soonest: number | undefined;
  for (const worktreeId of deps.presentWorktreeIds()) {
    if (!drawn.has(worktreeId)) {
      continue;
    }
    // Same reason the loop skips an undrawn worktree: a row this view does not
    // draw cannot cross anything a user can see, and waking for it tears the
    // whole list down to change nothing (round-1 F001).
    for (const row of deps.rowsFor(worktreeId)) {
      if (row.stateStartedAt === undefined || presentedActivity(row, degraded, now) !== "running") {
        continue;
      }
      if (row.activitySource !== "output") {
        continue;
      }
      const at = row.stateStartedAt + CONFIRMATION_CEILING_MS;
      if (at > now && (soonest === undefined || at < soonest)) {
        soonest = at;
      }
    }
  }
  return soonest;
}

function strongestConfidenceTip(
  deps: CeilingClockDeps,
  rows: readonly WorktreeAgentRow[],
  now: number,
): string | undefined {
  const degraded = deps.degradedSources();
  const strongest = strongestActivity(rows, degraded, now);
  if (strongest !== "running-unconfirmed" && strongest !== "unknown") {
    return undefined;
  }
  // The LONGEST-standing match, not the first: `rowsByWorktreeId` order is not a
  // contract, and taking whichever came first made the collapsed worktree's
  // elapsed figure depend on it. The oldest claim is also the truthful bound —
  // it is the one that has stood unchanged the longest.
  let source: WorktreeAgentRow | undefined;
  for (const row of rows) {
    if (presentedActivity(row, degraded, now) !== strongest) {
      continue;
    }
    if (
      source === undefined ||
      (row.stateStartedAt ?? Number.POSITIVE_INFINITY) < (source.stateStartedAt ?? Number.POSITIVE_INFINITY)
    ) {
      source = row;
    }
  }
  return source ? confidenceHint(source, strongest, now) : undefined;
}

export function createCeilingClock(deps: CeilingClockDeps): CeilingClock {
  let ceilingTimer: ReturnType<typeof setTimeout> | undefined;

  const now = (): number => deps.clock?.() ?? Date.now();

  const clear = (): void => {
    if (ceilingTimer !== undefined) {
      clearTimeout(ceilingTimer);
      ceilingTimer = undefined;
    }
  };

  return {
    now,

    nextCeilingCrossing: (at) => nextCeilingCrossing(deps, at),
    strongestConfidenceTip: (rows, at) => strongestConfidenceTip(deps, rows, at),

    armCeiling(from) {
      clear();
      // Guarding `setData` alone left `repaint()` — every interaction handler still
      // bound to live DOM — free to plant one after disposal. This is the single
      // place a timer is created, so it is the only place the check holds.
      if (deps.disposed()) {
        return;
      }
      const at = nextCeilingCrossing(deps, from);
      if (at === undefined) {
        return;
      }
      ceilingTimer = setTimeout(
        () => {
          ceilingTimer = undefined;
          deps.applyAt(now());
        },
        // Clamped, because a `stateStartedAt` in the future is CONFIRMED — an
        // impossible clock must not manufacture staleness — which is exactly what
        // makes such a row an accepted crossing candidate. Unbounded, `at - now`
        // overflows setTimeout's 32-bit delay past ~24.8 days and fires at once,
        // re-deriving the same crossing and re-arming: a tight loop. Clamping ends
        // it — the wake-up re-derives and arms the remainder, which terminates.
        Math.min(Math.max(0, at - from), MAX_TIMEOUT_MS),
      );
    },

    dispose: clear,
  };
}
