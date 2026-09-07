// src/providers/worktreeHost/projectionLoop.ts — The single-flight run that
// asks the projector for presence, and the envelope it freezes when the answer
// still describes the tree the host holds.
//
// Extracted from `createWorktreeHost` by change `decompose-worktree-host`
// (design.md D1, task 2_11). The run, the dirty flag it re-enters on and the
// four values it is the only writer of moved together: a flag left behind is a
// loop that re-enters, and a value left behind is a writer with no owner.
//
// `treeVersion` did NOT come. Three clusters write it — a rebuild, a watch
// reconcile and the cache-write path — so it stays in the composition root and
// arrives here as a read.
//
// `enrichmentPending` did not come either, for the same reason: the scan
// reconciler writes it on the falling edge and this run writes it on the
// rising one.

import type { PresenceProjector } from "../../worktree/presenceProjector";
import type { WorktreePresence } from "../../worktree/presenceTypes";
import type { WorktreeRepo } from "../../worktree/types";
import type { WorktreeCache } from "../../worktree/WorktreeCache";
import type { WorktreeTreeDeps } from "../../worktree/WorktreeDiscovery";

/** What one projection request wants. */
export interface ProjectionRequest {
  /** Skip the pane pass — the poll's mode (design.md D6). */
  external?: boolean;
  /**
   * Join a run already in flight rather than marking it dirty. A caller with no
   * new pane evidence wants an envelope, not a second projection.
   */
  join?: boolean;
}

/** The only thing any surface is ever shown. */
export interface Envelope {
  tree: ReturnType<WorktreeCache["read"]>;
  presence: WorktreePresence;
}

export interface ProjectionLoopDeps {
  projector: PresenceProjector | undefined;
  cache: Pick<WorktreeCache, "read" | "reorder">;
  /**
   * The ordering key the listing sorts by, read through the projector. An
   * accessor because the host builds it after this module — and because
   * `undefined` is a meaningful value here, so it must arrive as itself.
   */
  rank(): WorktreeTreeDeps["rank"];
  /** Presence as it stands, and the same with every roster attached (task 2_6). */
  presence(): WorktreePresence;
  withDelegations(source: WorktreePresence): WorktreePresence;
  /** Publish the committed envelope to every subscribed surface. */
  broadcast(): void;
  /** The two window-level predicates the run reads (task 2_10). */
  anyDrawingRows(): boolean;
  enrichmentOwed(): boolean;
  disposed(): boolean;
  /** The version the cache is on. Written by three clusters, so read only. */
  treeVersion(): number;
  /** Pane events counted so far (task 2_10 owns the counter). */
  paneEvidence(): number;
  /** Enrichment a projection was asked for but did not deliver. Two writers. */
  enrichmentPending(): boolean;
  setEnrichmentPending(pending: boolean): void;
  /** `console.warn` under the window's own log prefix. */
  logWarn(message: string, err: unknown): void;
}

export interface ProjectionLoop {
  /**
   * Freeze the current tree beside the presence that describes it.
   *
   * Refuses when the projection is behind the cache: half an envelope is worse
   * than a late one, and the coordinator is about to produce the other half.
   */
  commit(): boolean;

  /**
   * The one publication point.
   *
   * Callers request work; they never attach a broadcast to it. Two of them
   * joining one cycle used to publish its single result twice — single-flight
   * projection is not single-flight publication (.reviews/round-2.md W3).
   */
  commitAndBroadcast(): void;

  worktreeIds(): string[];

  /**
   * The single entry into the projector, for the pane path and the rebuild path
   * alike.
   *
   * The projector holds per-pane resolution slots and per-row timestamps, so
   * two concurrent `project()` calls interleave writes to the same maps and the
   * older result can commit last. Everything funnels through here, and a caller
   * arriving mid-flight joins the run in progress rather than starting a second
   * (.reviews/round-1.md B1).
   */
  requestProjection(request?: ProjectionRequest): Promise<void>;

  /**
   * Make sure an envelope will exist, without asking for fresh work.
   *
   * A caller that only wants to be served is not a caller with new evidence:
   * routing it through `requestProjection` would dirty the run already in
   * flight and buy a second projection to answer a cached request.
   */
  ensureProjection(): void;

  /** The last projection produced, or `undefined` before the first one. */
  projected(): WorktreePresence | undefined;
  /** Whether that projection ran per-row enrichment (round-2 W1). */
  projectedEnriched(): boolean;
  /** The projection currently in flight. One at a time: the projector is stateful. */
  projectionRun(): Promise<void> | undefined;
  /** The pane-evidence count the last full projection actually applied. */
  paneEvidenceApplied(): number;
  /**
   * The envelope this host last committed.
   *
   * Committing the two halves together is what makes the envelope contract
   * true: `rebuild()` mutates the cache before it can project, and a cached
   * tree request, a surface becoming displayed, or a watch-failure write inside
   * that window would otherwise deliver the new tree beside the previous
   * presence (.reviews/round-2.md B1).
   */
  published(): Envelope | undefined;
}

/**
 * Everything this loop mutates, in one record.
 *
 * The commit, the run and the pass are each writers of an overlapping subset,
 * so the subset they share is the one thing worth naming — and naming it is
 * what lets all three be module-scope functions instead of another hundred
 * lines inside the factory (`long-function`, task 2_11).
 */
interface LoopState {
  /** Last projection produced, and the tree version it describes. */
  projected: WorktreePresence | undefined;
  projectedVersion: number;
  projectedEnriched: boolean;
  published: Envelope | undefined;
  run: Promise<void> | undefined;
  dirty: boolean;
  /** Whether the next projection iteration may skip the pane pass. */
  nextExternalOnly: boolean;
  paneEvidenceApplied: number;
  /**
   * The rank revision the cached ORDER was built from.
   *
   * Advanced at exactly one site — after `cache.reorder`, the only cache-wide
   * ordering operation. A rebuild's write must not acknowledge it: `applyRepo`
   * orders one repository and rebuilds are serialized per scope, and `merge`
   * retains the stored worktree array for a degraded listing, so neither write
   * establishes the ranking it captured (design.md D12).
   */
  appliedRankRevision: number;
}

/** What one pass of the run accumulates across the whole run. */
interface RunTally {
  /** The highest pane-evidence count a full, uninvalidated pass has applied. */
  applied: number;
  /**
   * Whether some pass cleared the enrichment obligation.
   *
   * Remembered so a run whose projection REJECTS can put back what its passes
   * took. A pass that threw left `projectedEnriched` holding what the cut-short
   * pass requested, so an un-restored obligation reads as satisfied and the
   * missing line waits for the next external scan (D1a).
   */
  discharged: boolean;
}

function commit(deps: ProjectionLoopDeps, state: LoopState): boolean {
  if (deps.projector && state.projectedVersion !== deps.treeVersion()) {
    return false;
  }
  // Ordering is baked into the cache at `assembleRepo` time, from the rank the
  // projector held then. A presence-only projection never re-reads git, so
  // re-applying the rank here is the only thing that moves a worktree which
  // just gained — or just lost — an agent (design.md D8). Asked of the
  // projector rather than assumed: the 5-second poll is the caller, and the
  // poll that moved nothing is the common case (.reviews/round-2.md W2).
  const revision = deps.projector?.rankRevision();
  if (revision !== undefined && revision !== state.appliedRankRevision) {
    deps.cache.reorder(deps.rank());
    state.appliedRankRevision = revision;
  }
  state.published = { tree: deps.cache.read(), presence: deps.withDelegations(deps.presence()) };
  return true;
}

function commitAndBroadcast(deps: ProjectionLoopDeps, state: LoopState): void {
  if (commit(deps, state)) {
    deps.broadcast();
  }
}

function worktreeIds(deps: ProjectionLoopDeps): string[] {
  return deps.cache.read().repos.flatMap((repo: WorktreeRepo) => repo.worktrees.map((worktree) => worktree.id));
}

/**
 * Project once, committing only if the tree it read is still the tree we hold.
 *
 * A projection that raced a rebuild is not discarded — it is marked for a
 * re-run. Dropping it is how a pane transition disappears until some later,
 * unrelated evidence event happens to trigger another projection.
 */
async function projectOnce(deps: ProjectionLoopDeps, state: LoopState, externalOnly: boolean): Promise<void> {
  const projector = deps.projector;
  if (!projector || deps.disposed()) {
    return;
  }
  const at = deps.treeVersion();
  // Read at call time, not captured: a rail can open or collapse while a
  // projection is in flight, and the NEXT pass is the one that should react.
  const enrich = deps.anyDrawingRows();
  const next = await projector.project(worktreeIds(deps), { external: externalOnly, enrich });
  // The guard OBL-6 asks for: a read resolving after dispose writes nothing.
  if (deps.disposed()) {
    return;
  }
  if (deps.treeVersion() !== at) {
    state.dirty = true;
    return;
  }
  state.projected = next;
  state.projectedVersion = at;
  // Remembered so a surface promoted to rows can tell whether what is
  // published is worth redoing (round-2 W1).
  state.projectedEnriched = enrich;
}

/** One iteration of the run: discharge, read the panes, and decide the re-run. */
async function runPass(deps: ProjectionLoopDeps, state: LoopState, tally: RunTally): Promise<void> {
  state.dirty = false;
  const externalOnly = state.nextExternalOnly;
  state.nextExternalOnly = false;
  // The PASS discharges the obligation, not the run. A run is the wrong
  // unit: it can hold any number of passes, and a surface reopening
  // mid-run joins it above without ever reaching a run-level clear — the
  // joined pass then finds the obligation still standing and dirties
  // itself forever, publishing nothing (D1a).
  //
  // Only a pass that is going to ENRICH may clear it; one that is not
  // cannot satisfy an enrichment obligation and has to leave it for the
  // next rise. This and `projectOnce`'s own `anyDrawingRows()` read are
  // one synchronous span — an await inserted between them lets the two
  // disagree, clearing an obligation the pass then declines to satisfy.
  //
  // Defence in depth today: a non-enriching pass that COMPLETES records
  // `projectedEnriched = false`, and the owed predicate's other disjunct
  // catches it, so no test reaches this guard. It is what keeps the rule
  // true for a pass that clears and then never records — invalidated, or
  // disposed — if the self-healing rerun that covers those stops holding.
  if (deps.anyDrawingRows()) {
    deps.setEnrichmentPending(false);
    tally.discharged = true;
  }
  // Captured BEFORE the pass reads the panes, so an event arriving
  // during it stays outstanding. The failure this chooses is one
  // redundant full pass; the other choice loses the transition (D11).
  const evidenceAt = deps.paneEvidence();
  await projectOnce(deps, state, externalOnly);
  // Captured BEFORE the enrichment obligation below can touch it. Dirty
  // means this pass was INVALIDATED — by a tree that moved under it, or
  // by pane evidence that arrived after it read the panes — and that is
  // a different claim from "run again", which is what enrichment wants.
  const wasInvalidated = state.dirty;
  // Dirty means this pass was invalidated. Either way it applied
  // nothing. Defence in depth today: a dirty iteration always forces a
  // FULL rerun, whose own capture is at least this one, so no test can
  // reach it. It is what keeps D11 true if that ever stops holding.
  if (!externalOnly && !wasInvalidated) {
    tally.applied = Math.max(tally.applied, evidenceAt);
  }
  // A promotion that landed mid-pass joined this run without dirtying it
  // — deliberately, so a polled scan does not buy a second projection —
  // so the run is what has to notice it is finishing while enrichment is
  // owed, and schedule exactly one more pass (design.md D3).
  //
  // Only when the pass was otherwise CLEAN. An invalidated pass reruns
  // regardless and re-reads the predicate for itself, and forcing it
  // external-only here would override the stronger full-rerun that new
  // pane evidence just asked for — the rerun would skip the very panes
  // it exists to read.
  if (!wasInvalidated && deps.enrichmentOwed()) {
    state.dirty = true;
    state.nextExternalOnly = true;
  }
}

function requestProjection(deps: ProjectionLoopDeps, state: LoopState, request: ProjectionRequest = {}): Promise<void> {
  if (deps.disposed()) {
    return Promise.resolve();
  }
  if (!deps.projector) {
    // No projection to wait for; the tree is the whole envelope.
    commitAndBroadcast(deps, state);
    return Promise.resolve();
  }
  if (state.run) {
    if (request.join === true) {
      // The poll wants an envelope, not fresh pane work. Dirtying the run in
      // flight would buy a second projection to answer a scan the first one
      // is already performing.
      return state.run;
    }
    // Everything else carries pane evidence, and the run in flight may be an
    // external-only pass that is skipping exactly those panes.
    state.dirty = true;
    // New pane evidence: the re-run has to look at the panes.
    state.nextExternalOnly = false;
    return state.run;
  }
  state.nextExternalOnly = request.external === true;
  const run = (async () => {
    let clean = true;
    const tally: RunTally = { applied: state.paneEvidenceApplied, discharged: false };
    try {
      do {
        await runPass(deps, state, tally);
      } while (state.dirty && !deps.disposed());
    } catch (err) {
      clean = false;
      if (tally.discharged) {
        deps.setEnrichmentPending(true);
      }
      deps.logWarn("presence projection threw — nothing published", err);
    }
    // Cleared and published with no await between, so a caller arriving now
    // either joined this cycle already or starts the next one — it cannot
    // mark a cycle dirty that has stopped looking.
    state.run = undefined;
    if (clean) {
      state.paneEvidenceApplied = Math.max(state.paneEvidenceApplied, tally.applied);
    }
    if (deps.disposed()) {
      return;
    }
    if (clean) {
      commitAndBroadcast(deps, state);
    } else if (state.dirty) {
      // Someone joined the run that failed. Their work is not done just
      // because this promise resolved, so it is re-run rather than dropped
      // (.reviews/round-3.md W5).
      void requestProjection(deps, state);
    }
  })();
  state.run = run;
  return run;
}

export function createProjectionLoop(deps: ProjectionLoopDeps): ProjectionLoop {
  const state: LoopState = {
    projected: undefined,
    projectedVersion: -1,
    projectedEnriched: true,
    published: undefined,
    run: undefined,
    dirty: false,
    nextExternalOnly: false,
    paneEvidenceApplied: 0,
    appliedRankRevision: deps.projector?.rankRevision() ?? 0,
  };

  return {
    commit: () => commit(deps, state),
    commitAndBroadcast: () => {
      commitAndBroadcast(deps, state);
    },
    worktreeIds: () => worktreeIds(deps),
    requestProjection: (request) => requestProjection(deps, state, request),

    ensureProjection() {
      if (!state.run) {
        void requestProjection(deps, state);
      }
    },

    projected: () => state.projected,
    projectedEnriched: () => state.projectedEnriched,
    projectionRun: () => state.run,
    paneEvidenceApplied: () => state.paneEvidenceApplied,
    published: () => state.published,
  };
}
