// src/providers/WorktreeHost.ts — The window's owner of worktree freshness.
// See: docs/design/worktree-rpc.md § 1, § 2,
//      asimov/changes/cache-and-broadcast-worktree-tree/design.md D1, D6, D7
//
// One host per window, constructed beside the watcher pool. Surfaces attach to
// it; attaching costs no git command and no watcher, so a second panel showing
// the same tree is free.

import { hasGitRepo } from "../worktree/hasGitRepo";
import type { DelegationRoster } from "../worktree/presenceTypes";
import { createRebuildGate } from "../worktree/rebuildGate";
import { createWorktreeCache } from "../worktree/WorktreeCache";
import type { WorktreeTreeDeps } from "../worktree/WorktreeDiscovery";
import type { WorktreeWatch } from "../worktree/worktreeWatchTargets";
import { createActionRouting } from "./worktreeHost/actionRouting";
import { createRemovalActions } from "./worktreeHost/actions/removal";
import { createShellActions } from "./worktreeHost/actions/shell";
import { createAssessLanes } from "./worktreeHost/assessLanes";
import { createHostLookups } from "./worktreeHost/hostLookups";
import type { WorktreeSurface } from "./worktreeHost/hostTypes";
import { createLaunchAdmission } from "./worktreeHost/launchAdmission";
import { createPresenceProjection } from "./worktreeHost/presenceProjection";
import { createProjectionLoop } from "./worktreeHost/projectionLoop";
import { createScanReconcile } from "./worktreeHost/scanReconcile";

// Re-exported so no existing importer moved when these types did (task 2_0).
export type {
  AdmittedLaunch,
  LaunchTargetRecord,
  PickedCopyFile,
  WorktreeActions,
  WorktreeMutationCapabilities,
  WorktreeMutationTarget,
  WorktreeSurface,
} from "./worktreeHost/hostTypes";

import { createCreateSurface } from "./worktreeHost/composeCreateSurface";
import { isKnownSetupOutput } from "./worktreeHost/messageGuards";
import { createMutationSupport } from "./worktreeHost/mutationSupport";
import { createSurfaceDelivery, type SurfaceState, WHOLE_TREE_SCOPE } from "./worktreeHost/surfaceDelivery";

const LOG_PREFIX = "[worktree-host]";

/** The two cadences this host paces itself by, re-exported so no test moved. */
export { EXTERNAL_SCAN_INTERVAL_MS, PRESENCE_MAX_LATENCY_MS } from "./worktreeHost/scanReconcile";

/** The gate scope that rebuilds every repository; any other scope is a repoId. */
export { WHOLE_TREE_SCOPE } from "./worktreeHost/surfaceDelivery";

import type { WorktreeHost, WorktreeHostOptions } from "./worktreeHost/hostOptions";

/**
 * The host's own contract — what it is constructed with, what it hands back,
 * and what it offers. Re-exported so no importer moved when it did (task 2_1).
 */
export type {
  WorktreeAttachment,
  WorktreeHost,
  WorktreeHostOptions,
  WorktreeInitPayload,
} from "./worktreeHost/hostOptions";
export type {
  ResolvedMutationTarget,
  WorktreeMutationBindings,
  WorktreeMutationReport,
} from "./worktreeHost/mutationBindings";

export function createWorktreeHost(options: WorktreeHostOptions): WorktreeHost {
  const now = options.now ?? Date.now;
  const cache = createWorktreeCache();
  const surfaces = new Map<WorktreeSurface, SurfaceState>();
  const watches = new Map<string, WorktreeWatch>();
  const projector = options.projector;
  let disposed = false;

  /**
   * The create conversation, wired once (task 2_20): the offer store, the
   * per-opening maps, the opening registry, where a create would land, and the
   * two action groups that read them.
   *
   * The root's own late values go in as functions — delivery and the router are
   * built below, and a create arm reaches them only when a message lands.
   */
  const createSurface = createCreateSurface({
    cache,
    options,
    surfaces,
    disposed: () => disposed,
    deliver: (surface, message) => delivery.deliver(surface, message),
    perform: (run) => {
      perform(run);
    },
    actionPath: (worktreeId, allowMissing) => actionPath(worktreeId, allowMissing),
    admissibleLaunch: (surface, fields) => admissibleLaunch(surface, fields),
    repoIdOf: (worktreeId) => repoIdOf(worktreeId),
  });
  const {
    openings,
    surfaceKey,
    forgetSurfaceOpenings,
    forgetDepartedRepos,
    currentMigrationRegistration,
    provision,
    create,
  } = createSurface;

  /**
   * Assessment admission, one lane per REPOSITORY, with at most one job per
   * repository in flight (design.md D1, D6).
   */
  const { admitAssess, forgetSurfaceAssessments } = createAssessLanes({
    surfaceKey: (surface) => surfaceKey(surface),
    attached: (surface) => surfaces.has(surface),
    actions: () => options.actions,
    actionPath: (worktreeId, allowMissing) => actionPath(worktreeId, allowMissing),
    logWarn: (message, err) => {
      console.warn(`${LOG_PREFIX} ${message}`, err);
    },
  });

  /**
   * Bumped by every write to the cached tree — never by a delivery attempt.
   *
   * A projection describes the tree it read, so what invalidates it is that
   * tree moving. Versioning delivery instead made a broadcast that posted to
   * nobody supersede real work, and made two broadcasts of the same tree look
   * like two different trees (.reviews/round-1.md B1).
   */
  let treeVersion = 0;
  /**
   * Pane events counted, and the count the last full projection actually
   * applied. Work is outstanding while they differ (design.md D11).
   *
   * Not a boolean, and not "is a cap armed". A boolean answers "is there
   * evidence" where the question is "has THIS pass seen it", so a pane event
   * landing while a projection is already reading panes is indistinguishable
   * from one that landed before it, and the pass clears a flag it never
   * honoured (.reviews/round-3.md B1). The cap is a latency device only: the
   * scan cancels it, which must not destroy evidence (.reviews/round-2.md B1).
   */
  let paneEvidence = 0;
  /** Enrichment a projection was asked for but did not deliver.
   *
   *  `projectedEnriched` records what was REQUESTED. A projection that loses the
   *  last row-drawing surface before it reaches preview enrichment skips that half
   *  (the projector's fence, WT-011.7 D10), and the envelope was still marked
   *  enriched — so `enrichmentOwed()` told the reopening surface nothing was owed
   *  and it drew stale second lines until the next external scan (round-6 W1). */
  let enrichmentPending = false;
  /**
   * Rosters read, and the reads still in flight, both under `(rowId, entryId)`.
   *
   * Composite, not `rowId` alone: a slow read for session A completing after a
   * fast read for session B would evict B's result under the shared key, and a
   * pane that ended one session and started another would keep the first
   * session's delegations under the second (design.md D3).
   */
  const rosters = new Map<string, DelegationRoster>();
  const rosterReads = new Map<string, Promise<void>>();

  /**
   * Every timer this host arms, and the window-level facts that decide whether
   * one should be armed at all (task 2_10). Both handles live in there, and
   * `dispose` above clears them through it.
   */
  const timers = createScanReconcile({
    options,
    projector,
    cache,
    watches,
    gate: () => gate,
    surfaceStates: () => surfaces.values(),
    disposed: () => disposed,
    built: () => delivery.built(),
    projectionRun: () => loop.projectionRun(),
    requestProjection: (request) => loop.requestProjection(request),
    paneEvidence: () => paneEvidence,
    notePaneEvidence: () => {
      paneEvidence += 1;
    },
    paneEvidenceApplied: () => loop.paneEvidenceApplied(),
    projectedEnriched: () => loop.projectedEnriched(),
    enrichmentPending: () => enrichmentPending,
    notePendingEnrichment: () => {
      enrichmentPending = true;
    },
    bumpTreeVersion: () => {
      treeVersion += 1;
    },
  });
  const { reconcileScan, anyDrawingRows, enrichmentOwed, reconcileRowDrawing, onPaneChange, reconcileWatches } = timers;

  /**
   * The single-flight run that asks the projector for presence, and the
   * envelope it freezes when the answer still describes the tree we hold
   * (task 2_11). Owns every value it is the only writer of; `treeVersion` and
   * `enrichmentPending` have other writers and stay out here.
   */
  const loop = createProjectionLoop({
    projector,
    cache,
    rank: () => discoveryDeps.rank,
    presence: () => presence(),
    withDelegations: (source) => withDelegations(source),
    broadcast: () => {
      delivery.broadcast();
    },
    anyDrawingRows: () => anyDrawingRows(),
    enrichmentOwed: () => enrichmentOwed(),
    disposed: () => disposed,
    treeVersion: () => treeVersion,
    paneEvidence: () => paneEvidence,
    enrichmentPending: () => enrichmentPending,
    setEnrichmentPending: (pending) => {
      enrichmentPending = pending;
    },
    logWarn: (message, err) => {
      console.warn(`${LOG_PREFIX} ${message}`, err);
    },
  });
  const { commitAndBroadcast } = loop;

  /**
   * The ordering key the listing sorts by. Read through the projector on every
   * assembly rather than snapshotted, so a rebuild orders by the presence that
   * is current when it runs (design.md D12).
   */
  const discoveryDeps: WorktreeTreeDeps = projector
    ? { ...options.deps, rank: (id: string) => projector.rank(id) }
    : options.deps;

  /**
   * What the presence envelope says: the empty answer a host with no projector
   * gives, the roster attached to each row, and the freshness a child's status
   * inherits from its parent (task 2_6). Derivation only — `projected` is
   * written by the projection loop and read from here.
   */
  const { presence, withDelegations, publishedRow } = createPresenceProjection({
    projected: () => loop.projected(),
    now: () => now(),
    rosters,
    published: () => loop.published(),
  });

  /**
   * Every read over the tree this host currently holds — one worktree, one
   * repository, one path, one registration, one agent row (task 2_5). Nothing
   * here writes, which is why they travel together.
   */
  const { cachedWorktree, repoIdOf, repoById, launchTarget, actionPath, matchedRow, locate } = createHostLookups({
    repos: () => cache.read().repos,
    publishedRow: (rowId) => publishedRow(rowId),
  });

  /**
   * What this window will let a surface start, and whether the request in hand
   * quoted the offer it was chosen from (task 2_2). Holds the offer sequence, so
   * every id it hands out is minted in one place (OBL-7).
   */
  const { admissibleLaunch, admittedTarget, publishLaunchTargets, launchOpts } = createLaunchAdmission({
    actions: () => options.actions,
    launchTarget: (worktreeId) => launchTarget(worktreeId),
  });

  /**
   * Which capability group answers an inbound action, and the one read the
   * router makes on its own (task 2_9). Constructed BEFORE the four groups
   * because `perform` is a dependency of the create group; the groups are read
   * back when a message arrives, which is always after construction.
   */
  const { perform, handleAction, requestDelegations } = createActionRouting({
    options,
    disposed: () => disposed,
    shell: () => shell,
    create: () => create,
    removal: () => removal,
    provision: () => provision,
    publishedRow: (rowId) => publishedRow(rowId),
    rosters,
    rosterReads,
    commitAndBroadcast: () => {
      commitAndBroadcast();
    },
    logWarn: (message, err) => {
      console.warn(`${LOG_PREFIX} ${message}`, err);
    },
  });

  /**
   * Perform one read-only action, or nothing at all.
   *
   * Every branch resolves against what the host currently holds and hands the
   * capability the host's OWN value. A request naming something the host does
   * not hold falls through to nothing — never to a nearest match, a first
   * repository, or the workspace root: an action that did something against an
   * unintended target is worse than one that did nothing (D3).
   */
  const shell = createShellActions({
    actionPath,
    terminalOwner: (worktreeId) => (cachedWorktree(worktreeId)?.kind === "linked" ? worktreeId : undefined),
    perform,
    matchedRow,
    admittedTarget,
    admissibleLaunch,
    launchOpts,
    isKnownSetupOutput,
    launchTarget,
  });

  const removal = createRemovalActions({
    actionPath,
    repoIdOf,
    admitAssess,
    perform,
    hasSurface: (surface) => surfaces.has(surface),
  });

  /**
   * What reaches an attached surface and when (task 2_12). Owns `built`, the
   * rebuild that writes it, and the one delivery gate every push goes through.
   */
  const delivery = createSurfaceDelivery({
    options,
    projector,
    cache,
    surfaces,
    discoveryDeps,
    published: () => loop.published(),
    presence: () => presence(),
    disposed: () => disposed,
    gate: () => gate,
    bumpTreeVersion: () => {
      treeVersion += 1;
    },
    reconcileWatches,
    forgetDepartedRepos,
    worktreeIds: () => loop.worktreeIds(),
    requestProjection: () => loop.requestProjection(),
    ensureProjection: () => {
      loop.ensureProjection();
    },
    surfaceKey,
    forgetSurfaceOpenings,
    forgetSurfaceAssessments,
    reconcileScan,
    reconcileRowDrawing,
    handleAction,
    requestDelegations,
    logWarn: (message, err) => {
      console.warn(`${LOG_PREFIX} ${message}`, err);
    },
  });

  const gate = createRebuildGate(delivery.rebuild, options.clock);

  const paneSub = options.onPaneChange?.(onPaneChange);

  const folderSub = options.onDidChangeWorkspaceFolders?.(() => {
    // Forced: the folder set moved, so the cached tree is known wrong. The
    // floor bounds signal noise, not a change the user just made.
    void gate.request(WHOLE_TREE_SCOPE, { force: true });
  });

  return {
    // Folders are read here, not captured: a window that gained one since the
    // last init answers for the folder set the surface is booting against.
    initPayload: () => ({ worktreeHasRepo: hasGitRepo(options.workspaceFolders(), options.exists) }),
    attach: delivery.attach,
    handleMessage: delivery.handleMessage,
    publishLaunchTargets,
    openingsHeld: () => openings.size,

    reportMutation: (report) => {
      if (disposed) {
        return;
      }
      // The OUTCOME goes back where it came from — the surface that raised the
      // dialog is the one holding the state that dialog left behind. The tree
      // itself still broadcasts to everyone, through the ordinary rebuild path,
      // because a worktree that vanished must vanish everywhere (D17).
      report.origin?.post(report.message);
      if (report.provisionResult !== undefined) {
        report.origin?.post(report.provisionResult);
      }
      if (report.openTerminalAt !== undefined) {
        void report.origin?.openTerminal?.(report.openTerminalAt, report.message.worktreeId);
      }
    },

    reportProvisioning: (origin, outcome) => {
      if (!disposed) {
        origin?.post(outcome);
      }
    },

    mutationBindings: () =>
      createMutationSupport({
        options,
        cache,
        gate,
        locate,
        repoById,
        presence: () => presence(),
        currentMigrationRegistration,
      }),
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      // Both timer handles, cleared by the module that arms them (OBL-1).
      timers.dispose();
      gate.dispose();
      paneSub?.dispose();
      folderSub?.dispose();
      for (const watch of watches.values()) {
        watch.dispose();
      }
      watches.clear();
      for (const surface of surfaces.keys()) {
        forgetSurfaceOpenings(surfaceKey(surface));
      }
      surfaces.clear();
      // A read still in flight resolves into a disposed host; clearing here is
      // what makes that completion a no-op rather than a late publication.
      rosters.clear();
      rosterReads.clear();
      // Same reason, for the per-opening state: a probe suspended on one of
      // these reads resolves into a disposed host and must find nothing.
      openings.clear();
    },
  };
}
