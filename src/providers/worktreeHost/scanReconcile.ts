// src/providers/worktreeHost/scanReconcile.ts — Every timer this host arms, and
// the window-level facts that decide whether one should be armed at all.
//
// Extracted from `createWorktreeHost` by change `decompose-worktree-host`
// (design.md D1, task 2_10). The two handles, the three predicates over them
// and the two reconcilers sat 400 lines apart, so "is a timer left running
// after the last surface hid" had no single place to be answered.
//
// Both handles live here and `dispose()` clears both, which is what OBL-1
// asks: a host that is gone arms nothing and holds nothing armed.

import type { PresenceProjector } from "../../worktree/presenceProjector";
import type { WorktreeCache } from "../../worktree/WorktreeCache";
import type { WorktreeWatch } from "../../worktree/worktreeWatchTargets";
import { watchRepoStructure } from "../../worktree/worktreeWatchTargets";
import type { WorktreeHostOptions } from "./hostOptions";

/**
 * How long presence may lag the evidence behind it.
 *
 * A max-latency cap, NOT a resettable debounce: an agent producing output for a
 * minute would push a debounce out for that whole minute and the row would
 * never move. The first change arms this; later ones ride it (design.md D3.1).
 */
export const PRESENCE_MAX_LATENCY_MS = 150;

/**
 * How often the running-session registry is scanned for agents outside this
 * window. Flat, because the registry emits no events and the scan is a readdir,
 * a JSON parse per entry and a liveness probe — tiered cadences would be more
 * machinery than the thing being paced.
 */
export const EXTERNAL_SCAN_INTERVAL_MS = 5_000;

/** The three surface facts these predicates read, and nothing else. */
export interface DrawingState {
  visible: boolean;
  displayed: boolean;
  level: string;
}

export interface ScanReconcileDeps {
  options: Pick<WorktreeHostOptions, "clock" | "pool">;
  projector: PresenceProjector | undefined;
  cache: Pick<WorktreeCache, "roots" | "markUnwatched">;
  watches: Map<string, WorktreeWatch>;
  /** The rebuild gate, read at call time: it is constructed after this module. */
  gate(): { request(repoId: string, opts: { signal?: boolean }): unknown };
  /** The attached surfaces' drawing state. */
  surfaceStates(): Iterable<DrawingState>;
  disposed(): boolean;
  /** False until the first rebuild writes the cache. */
  built(): boolean;
  /** The projection currently in flight, if any (task 2_11). */
  projectionRun(): Promise<void> | undefined;
  requestProjection(request?: { external?: boolean; join?: boolean }): Promise<void>;
  /** Pane events counted, and the count the last full projection applied. */
  paneEvidence(): number;
  notePaneEvidence(): void;
  paneEvidenceApplied(): number;
  /** Whether the projection behind the current envelope ran per-row enrichment. */
  projectedEnriched(): boolean;
  enrichmentPending(): boolean;
  notePendingEnrichment(): void;
  /** A cache write is a tree move, wherever it comes from. */
  bumpTreeVersion(): void;
}

export interface ScanReconcile {
  /**
   * Arm or clear the scan against one window-level fact: is any attached surface
   * showing the view right now?
   *
   * Read live rather than from `state.showing`, which stays false after a post
   * that was skipped or threw and so is not a safe predicate for this.
   */
  reconcileScan(): void;

  /**
   * Is any surface actually drawing agent rows right now?
   *
   * Narrower than `anyShowing`, and deliberately a separate question. Presence
   * is what arms the scan, because a scope's count is built from it and that
   * count outlives the rail. Titles and previews are drawn on rows or not at
   * all, so a window where every subscriber is presence-only pays the registry
   * pass and skips roughly one preview lookup and stat per live external
   * session per poll (design.md D2).
   */
  anyDrawingRows(): boolean;

  /**
   * Is this window drawing rows against an envelope that was built WITHOUT
   * enrichment?
   *
   * The one join of those two facts. `anyDrawingRows()` alone is not the
   * question — a drawing window whose envelope is already enriched is owed
   * nothing — and spelling the conjunction inline at each site is how it came to
   * be checked at one boundary and missed at two (design.md D1).
   */
  enrichmentOwed(): boolean;

  /**
   * Settle the row-drawing state after any change to `visible`, `level` or
   * `displayed` — the three inputs to the predicate — exactly as
   * `reconcileScan` settles the scan.
   *
   * Deliberately NOT an edge check. "Did this call change it" is a different
   * question from "what is owed now", and only the second one matters: a call
   * that changed nothing while the window sits on a bare envelope should still
   * ask for the pass, and one that changed nothing while nothing is drawing
   * should still leave no turn order standing. It also removes the `wasDrawing`
   * snapshot that every mutation site would otherwise have to remember to take.
   *
   * `join: true` because this re-runs the projection and re-reads no git; a poll
   * already in flight is the right thing to join (design.md D2).
   */
  reconcileRowDrawing(): void;

  onPaneChange(): void;

  /**
   * Bring the watch set in line with the repositories the cache now holds. An
   * already-watched repository keeps its subscriptions, so neither a rebuild
   * nor a second surface creates another watcher.
   */
  reconcileWatches(): void;

  /** Cancel both handles. Called from the host's own `dispose` (OBL-1). */
  dispose(): void;
}

type Clock = ScanReconcileDeps["options"]["clock"];

/** Arm `fn` after `ms`, through the injected clock when there is one. */
function arm(clock: Clock, fn: () => void, ms: number): unknown {
  return clock ? clock.setTimeout(fn, ms) : setTimeout(fn, ms);
}

function cancelCap(clock: Clock, handle: unknown): void {
  if (clock) {
    clock.clearTimeout(handle);
  } else {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  }
}

function anyShowing(states: Iterable<DrawingState>): boolean {
  for (const state of states) {
    if (state.visible && state.displayed) {
      return true;
    }
  }
  return false;
}

function anyDrawingRows(states: Iterable<DrawingState>): boolean {
  for (const state of states) {
    if (state.visible && state.displayed && state.level === "rows") {
      return true;
    }
  }
  return false;
}

/**
 * Bring the watch set in line with the repositories the cache now holds. An
 * already-watched repository keeps its subscriptions, so neither a rebuild nor
 * a second surface creates another watcher.
 */
function reconcileWatches(deps: ScanReconcileDeps): void {
  const wanted = new Set(deps.cache.roots().map((root) => root.repoId));
  for (const [repoId, watch] of deps.watches) {
    if (!wanted.has(repoId)) {
      watch.dispose();
      deps.watches.delete(repoId);
    }
  }
  for (const repoId of wanted) {
    if (!deps.watches.has(repoId)) {
      deps.watches.set(
        repoId,
        watchRepoStructure(repoId, deps.options.pool, () => {
          // `signal`: git state moved, so a rebuild already running cannot
          // answer this one — it may have read git before the move.
          void deps.gate().request(repoId, { signal: true });
        }),
      );
    }
  }
  for (const [repoId, watch] of deps.watches) {
    // An unestablished watch means the listing this repo produced can go stale
    // unnoticed. Saying so is the difference between a stale tree and a tree
    // KNOWN to be stale — which is the condition D11's launch authority rests
    // on, so it has to survive every rebuild rather than be re-asserted after
    // some of them (round-7 W8).
    //
    // Reported in both directions: a watcher that came back must clear the
    // warning, or the panel keeps telling the user about a limitation that is
    // over. Annotated, not re-listed — an unwatched repository's worktrees
    // were still observed by the rebuild that just ran, so this must not
    // travel the retain path and withdraw their registration token.
    const reason =
      watch.failureReason === undefined
        ? undefined
        : `This repository is not being watched, so its worktrees may be out of date: ${watch.failureReason}`;
    deps.cache.markUnwatched(repoId, reason);
    // A cache write is a tree move, wherever it comes from. Delivery waits
    // for the projection that describes it.
    deps.bumpTreeVersion();
  }
}

/**
 * Is this window drawing rows against an envelope that was built WITHOUT
 * enrichment?
 *
 * The one join of those two facts. `anyDrawingRows()` alone is not the question
 * — a drawing window whose envelope is already enriched is owed nothing — and
 * spelling the conjunction inline at each site is how it came to be checked at
 * one boundary and missed at two (design.md D1).
 */
function enrichmentOwed(deps: ScanReconcileDeps): boolean {
  return anyDrawingRows(deps.surfaceStates()) && (!deps.projectedEnriched() || deps.enrichmentPending());
}

/**
 * Settle the row-drawing state after any change to `visible`, `level` or
 * `displayed` — the three inputs to the predicate — exactly as `reconcileScan`
 * settles the scan.
 *
 * Deliberately NOT an edge check. "Did this call change it" is a different
 * question from "what is owed now", and only the second one matters: a call
 * that changed nothing while the window sits on a bare envelope should still
 * ask for the pass, and one that changed nothing while nothing is drawing
 * should still leave no turn order standing.
 */
function reconcileRowDrawing(deps: ScanReconcileDeps): void {
  // The falling direction, which had no owner anywhere: the projector's turn
  // order holds exactly the ids being drawn, and the only thing that
  // reconciles it is an enriched projection — which is exactly what stops
  // arriving once nothing is drawing rows. Left unsaid, the order survives
  // hide, detach and the drop to presence-only, and a reopened window grants
  // by pre-hide position (round-4 B1, design.md D10).
  if (!anyDrawingRows(deps.surfaceStates())) {
    deps.projector?.forgetDrawOrder();
    // Only while a projection is in flight: that is the pass whose preview half
    // the projector's fence skips. A falling edge with none running skips
    // nothing, and recording here unconditionally is what moved 19 cases — this
    // reconcile is deliberately a state settle, so it runs on EVERY mutation
    // while nothing draws (D2). The edge records; the rise spends it.
    if (deps.projectionRun() !== undefined) {
      deps.notePendingEnrichment();
    }
    return;
  }
  if (enrichmentOwed(deps)) {
    void deps.requestProjection({ external: true, join: true });
  }
}

export function createScanReconcile(deps: ScanReconcileDeps): ScanReconcile {
  let capHandle: unknown;
  /** The external-scan timer, armed only while some surface is showing the view. */
  let scanHandle: unknown;

  const clock = deps.options.clock;

  function armScan(): void {
    scanHandle = arm(
      clock,
      () => {
        scanHandle = undefined;
        // A pending cap means pane evidence is waiting to be projected. Absorbing
        // it is only honest if this projection actually looks at the panes — the
        // external-only pass is precisely the one that does not, so absorbing into
        // it would drop that evidence for good (.reviews/round-1.md B1).
        if (capHandle !== undefined) {
          cancelCap(clock, capHandle);
          capHandle = undefined;
        }
        void deps.requestProjection(
          deps.paneEvidence() !== deps.paneEvidenceApplied() ? {} : { external: true, join: true },
        );
        reconcileScan();
      },
      EXTERNAL_SCAN_INTERVAL_MS,
    );
  }

  function reconcileScan(): void {
    const wanted = !deps.disposed() && deps.projector !== undefined && anyShowing(deps.surfaceStates());
    if (wanted === (scanHandle !== undefined)) {
      return;
    }
    if (!wanted) {
      cancelCap(clock, scanHandle);
      scanHandle = undefined;
      return;
    }
    armScan();
  }

  return {
    reconcileScan,

    anyDrawingRows: () => anyDrawingRows(deps.surfaceStates()),
    enrichmentOwed: () => enrichmentOwed(deps),

    reconcileWatches() {
      reconcileWatches(deps);
    },

    reconcileRowDrawing() {
      reconcileRowDrawing(deps);
    },

    onPaneChange() {
      // Nothing to attribute a pane to yet; the first build projects for itself.
      if (deps.disposed() || !deps.projector || !deps.built()) {
        return;
      }
      deps.notePaneEvidence();
      if (capHandle !== undefined) {
        return;
      }
      capHandle = arm(
        clock,
        () => {
          capHandle = undefined;
          void deps.requestProjection();
        },
        PRESENCE_MAX_LATENCY_MS,
      );
    },

    dispose() {
      if (capHandle !== undefined) {
        cancelCap(clock, capHandle);
        capHandle = undefined;
      }
      if (scanHandle !== undefined) {
        cancelCap(clock, scanHandle);
        scanHandle = undefined;
      }
    },
  };
}
