// src/providers/WorktreeHost.ts — The window's owner of worktree freshness.
// See: docs/design/worktree-rpc.md § 1, § 2,
//      asimov/changes/cache-and-broadcast-worktree-tree/design.md D1, D6, D7
//
// One host per window, constructed beside the watcher pool. Surfaces attach to
// it; attaching costs no git command and no watcher, so a second panel showing
// the same tree is free.

import type {
  ExtensionToWebViewMessage,
  WebViewToExtensionMessage,
  WorktreeSubscriptionLevel,
} from "../types/messages";
import { hasGitRepo } from "../worktree/hasGitRepo";
import type { IgnoredMaterial } from "../worktree/ignoredMaterial";
import type { MigrationOfferEvidence, MigrationRepositoryBinding } from "../worktree/migrateChanges";
import type { DelegationRoster } from "../worktree/presenceTypes";
import { createProvisionOfferStore } from "../worktree/provisioning/offerStore";
import { createRebuildGate } from "../worktree/rebuildGate";
import { createWorktreeCache } from "../worktree/WorktreeCache";
import {
  buildWorktreeTreeDetailed,
  listRegisteredRepoWorktrees,
  type WorktreeTreeDeps,
} from "../worktree/WorktreeDiscovery";
import { evaluateRemoval } from "../worktree/worktreeBlockers";
import type { WorktreeWatch } from "../worktree/worktreeWatchTargets";
import { createActionRouting } from "./worktreeHost/actionRouting";
import { createCreateActions } from "./worktreeHost/actions/create";
import { createProvisionActions } from "./worktreeHost/actions/provision";
import { createRemovalActions } from "./worktreeHost/actions/removal";
import { createShellActions } from "./worktreeHost/actions/shell";
import { createAssessLanes } from "./worktreeHost/assessLanes";
import { createDestinationResolve } from "./worktreeHost/destinationResolve";
import { createHostLookups, observationOf } from "./worktreeHost/hostLookups";
import type { WorktreeSurface } from "./worktreeHost/hostTypes";
import { createLaunchAdmission } from "./worktreeHost/launchAdmission";
import { createOpeningLifecycle } from "./worktreeHost/openingLifecycle";
import { createOpeningRegistry } from "./worktreeHost/openingRegistry";
import { createPresenceProjection } from "./worktreeHost/presenceProjection";
import { createProjectionLoop } from "./worktreeHost/projectionLoop";
import {
  ADDED_COPY_SOURCE,
  createProvisionOffers,
  MAX_ADDED_COPY_FILES,
  MAX_ADDED_STEPS,
} from "./worktreeHost/provisionOffers";
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

import { isKnownSetupOutput } from "./worktreeHost/messageGuards";

const LOG_PREFIX = "[worktree-host]";

/** The two cadences this host paces itself by, re-exported so no test moved. */
export { EXTERNAL_SCAN_INTERVAL_MS, PRESENCE_MAX_LATENCY_MS } from "./worktreeHost/scanReconcile";

/** The gate scope that rebuilds every repository; any other scope is a repoId. */
export const WHOLE_TREE_SCOPE = "*";

import type { WorktreeAttachment, WorktreeHost, WorktreeHostOptions } from "./worktreeHost/hostOptions";

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

interface SurfaceState {
  /**
   * False until the surface says otherwise. All three surfaces retain their DOM
   * while hidden, so a default of true would post into panels that have never
   * shown the view — the cost this gate exists to avoid.
   */
  visible: boolean;
  /**
   * The window is displaying this surface. Independent of `visible`, and false
   * for the same reason: `retainContextWhenHidden` means a surface that stopped
   * being displayed still holds — and still means — its last declaration.
   */
  displayed: boolean;
  /** Last computed `visible && displayed`, so the transition is edge-triggered. */
  showing: boolean;
  /**
   * What this surface draws from presence while subscribed. Only `"rows"` needs
   * per-row title and preview enrichment; a `"presence"` subscriber is drawing a
   * scope's chip, escape control and count, none of which read either.
   *
   * Meaningless while `visible` is false, and deliberately not reset there: a
   * surface that stops and restarts keeps its last declaration until it sends a
   * new one, exactly as `visible` and `displayed` already do.
   */
  level: WorktreeSubscriptionLevel;
}

export function createWorktreeHost(options: WorktreeHostOptions): WorktreeHost {
  const now = options.now ?? Date.now;
  const cache = createWorktreeCache();
  const surfaces = new Map<WorktreeSurface, SurfaceState>();
  const watches = new Map<string, WorktreeWatch>();
  const projector = options.projector;
  let built = false;
  let disposed = false;

  /**
   * The provisioning models this host has shown, and a stable name per surface
   * to key them by.
   *
   * The store itself is keyed by string rather than by surface so its own suite
   * needs no surface; the identity mapping lives here, where surfaces do. A
   * detached surface loses its key with the WeakMap, and its offers become
   * unreachable — which is the same answer as an expired id.
   */
  const offers = createProvisionOfferStore();

  /**
   * What a create form is offered for one repository: the provider's model with
   * this form's own additions composed in, and the withholding statement when
   * they do not all fit (task 2_8).
   */
  const {
    addedSteps,
    addedCopyFiles,
    currentMigrationRegistration,
    bumpMigrationSequence,
    previewProvisioning,
    withoutAdded,
    privateIdsFor,
    withAdded,
    roomForOneMoreSetup,
    issueWithAdded,
  } = createProvisionOffers({ cache, offers, options });
  /**
   * Provider reads in flight, marked BEFORE the await.
   *
   * `offers.current()` stays empty until a read RESOLVES, so guarding on it let
   * every keystroke's defaults request start another read and issue another
   * offer — each superseding the last (.reviews/round-1.md B5). The unit that
   * closes the guard has to be the pass in flight, not the pass that finished.
   */
  const provisionReading = new Map<string, number>();
  const migrationReading = new Map<
    string,
    { sequence: number; repoId: string; sourceWorktreeId: string; sourceGeneration: number }
  >();
  const migrationOffers = new Map<
    string,
    {
      surface: string;
      opening: number;
      repoId: string;
      sourceWorktreeId: string;
      sourcePath: string;
      binding: MigrationRepositoryBinding;
      evidence: MigrationOfferEvidence;
    }
  >();
  /**
   * The OPENING each surface's create form is currently on, as the PANEL named
   * it.
   *
   * Replaces the host-local generation this had before. A generation minted
   * when the host processed a request could not be bound to the panel's live
   * opening: the panel's reopening is not observable here until its message
   * arrives, and in that window a predecessor's read resolved and published
   * into a form that had already been replaced (design.md D2).
   *
   * Written synchronously inside the handler turn, before any await — the
   * property the round-1 provisioning guard got wrong, kept explicit here.
   * `pristine` means this surface holds no live opening, and a request naming
   * one is answered with nothing rather than adopting it.
   *
   * One store rather than the liveness and high-water maps it replaces: those
   * two answered different questions ("which is being served", "which are
   * spent") and could disagree, so the union holds both in one value and the
   * three ways they used to disagree are unrepresentable (design.md D5).
   */
  const lifecycle = createOpeningLifecycle();
  /**
   * An `opening` the host is willing to reason about at all.
   *
   * The forwarding boundary checks the discriminator and nothing else
   * (`isWorktreeMessage`), so shape validation has to happen here. Without it
   * `undefined` collapsed three states into one: absent, malformed and retired
   * all compared equal to a missing map entry, so a malformed message acquired
   * authority and kept it across a close (.reviews/round-1.md B1).
   *
   * Zero is refused with the rest. The panel pre-increments before its first
   * ask, so zero only ever appears on an ask made before any form opened —
   * which was already answered with nothing.
   */
  /**
   * Everything one surface's create form holds, dropped together.
   *
   * Close, supersede and detach are the same event told three ways, and having
   * only `worktreeCreateClosed` do the sweep left the other two leaking: a
   * supersede retired only the read slots the new opening happened to re-ask
   * about, and a detach retired nothing at all (round-1 B2, W1).
   *
   * The read slots are per surface AND repository because one opening asks
   * about every repository in the workspace, so retiring by surface alone is
   * the only sweep that covers them.
   */
  /**
   * The highest switch sequence each form has seen.
   *
   * Keyed by surface, repository AND opening, so a new opening starts from
   * nothing rather than inheriting a predecessor's ceiling and refusing the new
   * dialog's first switch. Latest-wins is decided here and nowhere else: the
   * opening cannot decide it, because every switch of one dialog carries the
   * same opening (design.md D5).
   *
   * Retirement also sweeps this map, so the opening in the key is redundant with
   * that sweep and mutating either alone is NOT caught by the suite — the same
   * overlap `provisionReading` carries above, and stated for the same reason:
   * the sweep bounds the map, and the key states the invariant.
   */
  const provisionSwitch = new Map<string, number>();
  /**
   * The source each opening STARTED on, keyed like `provisionSwitch`.
   *
   * "Did the user take a different source" is answered here and never on the
   * wire: a form-minted boolean is forgeable in both directions, and it is not a
   * form-only fact anyway — the host admits every switch itself. Comparing the
   * baseline with the source active at save time also answers it for NET intent,
   * so a form that went to another source and came back is what it looks like:
   * unchanged (design.md D18).
   *
   * The empty string is "no source was active", which is a baseline like any
   * other — a repository that had none and now has one took a source.
   */
  const provisionBaseline = new Map<string, string>();
  /**
   * Which surface asked, which opening of which repository the question
   * belonged to, and everything dropped when one of those goes away (task 2_7).
   * The key format `surface\u0000repoId` and both sweeps that parse it are
   * this module's; the slot maps it sweeps are not.
   */
  const { openings, surfaceKey, openingKey, openingFor, retireOpening, forgetSurfaceOpenings, forgetDepartedRepos } =
    createOpeningRegistry({
      lifecycle,
      offers,
      provisionReading,
      provisionSwitch,
      provisionBaseline,
      addedSteps,
      addedCopyFiles,
      migrationReading,
      migrationOffers,
      attachedSurfaces: () => surfaces.keys(),
    });

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
    built: () => built,
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
      broadcast();
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
  const { worktreeIds, requestProjection, ensureProjection, commitAndBroadcast } = loop;

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
  const { repoIdOf, repoById, launchTarget, actionPath, matchedRow, locate } = createHostLookups({
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
   * Where a create for this branch would go, and what it stepped over.
   *
   * ONE derivation for both answers. The probe and `worktreeCreateDefaults`
   * each derived root, taken paths, slug, base and free suffix separately, so
   * the destination the resolution named and the one the defaults reply named
   * could drift apart (round-1 W4).
   */
  const { vettedOverride, resolveDestination } = createDestinationResolve(options);

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

  const provision = createProvisionActions({
    ADDED_COPY_SOURCE,
    MAX_ADDED_COPY_FILES,
    MAX_ADDED_STEPS,
    addedCopyFiles,
    addedSteps,
    provisionBaseline,
    provisionSwitch,
    lifecycle,
    offers,
    cache,
    options,
    deliver,
    disposed: () => disposed,
    hasSurface: (surface) => surfaces.has(surface),
    surfaceKey,
    previewProvisioning,
    withAdded,
    withoutAdded,
    privateIdsFor,
    issueWithAdded,
    roomForOneMoreSetup,
  });

  const create = createCreateActions({
    cache,
    lifecycle,
    openings,
    migrationOffers,
    migrationReading,
    offers,
    provisionBaseline,
    provisionReading,
    options,
    hasSurface: (surface) => surfaces.has(surface),
    actionPath,
    admissibleLaunch,
    currentMigrationRegistration,
    deliver,
    disposed: () => disposed,
    bumpMigrationSequence,
    issueWithAdded,
    openingFor,
    openingKey,
    perform,
    previewProvisioning,
    repoIdOf,
    resolveDestination,
    retireOpening,
    surfaceKey,
    vettedOverride,
  });

  /**
   * Is there anything honest to send?
   *
   * `built` turns true when the first rebuild writes the cache, which is before
   * its projection can have committed. Delivering in that window paired the
   * live tree with a synthetic empty presence — every agent row missing, then
   * appearing a moment later (.reviews/round-3.md B1). A host with no projector
   * has no second half to wait for, so it is deliverable from its first build.
   */
  function deliverable(): boolean {
    return loop.published() !== undefined || !projector;
  }

  function currentMessage(): ExtensionToWebViewMessage {
    // Never the live cache: an uncommitted tree has no presence to pair with.
    const envelope = loop.published() ?? { tree: cache.read(), presence: presence() };
    return { type: "worktreeTreeResponse", tree: envelope.tree, presence: envelope.presence };
  }

  /**
   * Deliver to one surface, or skip it. The gate lives here alone so a broadcast
   * and a single-surface delivery cannot come to different answers about who may
   * receive a push.
   */
  function postTo(surface: WorktreeSurface, state: SurfaceState, message: ExtensionToWebViewMessage): boolean {
    if (!state.visible || !state.displayed || !surface.isReady()) {
      return false;
    }
    return deliver(surface, message);
  }

  /**
   * Post to one surface, containing a throw rather than abandoning the caller
   * mid-way.
   *
   * The delivery gate is deliberately NOT here: a broadcast skips a surface that
   * cannot receive a push, but an answer to a form the user has open is not a
   * push, and applying the gate to it would drop the reply the form is waiting
   * for. `postTo` adds the gate for the broadcast case (design.md D19).
   *
   * A dropped offer is not stranded: the offer store has already re-minted the
   * id, so the form's next save names an id the host no longer knows and is
   * answered with a fresh offer.
   */
  function deliver(surface: WorktreeSurface, message: ExtensionToWebViewMessage): boolean {
    try {
      surface.post(message);
      return true;
    } catch (err) {
      console.warn(`${LOG_PREFIX} surface post threw — continuing`, err);
      return false;
    }
  }

  function broadcast(): void {
    if (disposed || !deliverable()) {
      return;
    }
    const message = currentMessage();
    for (const [surface, state] of surfaces) {
      postTo(surface, state, message);
    }
  }

  /**
   * Serve a surface that has just begun showing the view. Edge-triggered on both
   * facts together, so a repeated report from either one is a no-op, and served
   * from the cache: the watches ran while the surface was away, so a rebuild
   * would re-read git for what is already held — and would push it to everyone.
   *
   * `serveOnRise` is false for the webview's own declaration, which arrives with
   * a tree request behind it — serving that edge as well would post twice. The
   * window displaying a surface again is the edge with no requester, which is
   * the gap this exists to close.
   */
  function reconcileShowing(surface: WorktreeSurface, state: SurfaceState, serveOnRise: boolean): void {
    const showing = state.visible && state.displayed;
    if (showing === state.showing) {
      return;
    }
    if (!showing) {
      state.showing = false;
      return;
    }
    if (disposed || !serveOnRise) {
      state.showing = true;
      return;
    }
    if (!built) {
      // Nothing to serve yet; the build's own broadcast reaches this surface.
      state.showing = true;
      void gate.request(WHOLE_TREE_SCOPE, {});
      return;
    }
    if (!deliverable()) {
      // Built, but the first projection has not committed. The commit
      // broadcasts to every showing surface, and this one now is.
      state.showing = true;
      return;
    }
    // Recorded only once it actually reached the surface. A post that was
    // skipped as not-ready, or that threw, must not consume the edge — the next
    // report would find nothing to do and the surface would stay stale.
    state.showing = postTo(surface, state, currentMessage());
  }

  /**
   * One rebuild, then one push. Broadcasting from inside the gate's run — not
   * from each caller after awaiting — is what makes two concurrent requests
   * produce a single push rather than one each.
   */
  async function rebuild(scope: string): Promise<void> {
    if (disposed) {
      return;
    }
    if (scope === WHOLE_TREE_SCOPE) {
      const before = new Set(cache.read().repos.map((repo) => repo.repoId));
      cache.applyBuild(await buildWorktreeTreeDetailed(options.workspaceFolders(), discoveryDeps));
      built = true;
      treeVersion += 1;
      reconcileWatches();
      const live = new Set(cache.read().repos.map((repo) => repo.repoId));
      forgetDepartedRepos(new Set([...before].filter((repoId) => !live.has(repoId))));
    } else {
      const root = cache.rootFor(scope);
      if (root) {
        cache.applyRepo(scope, await listRegisteredRepoWorktrees(root, discoveryDeps), discoveryDeps.rank);
        treeVersion += 1;
      }
    }
    // Every authoritative rebuild is an observation of what still exists, and
    // D15 turns a confirmation off on exactly that observation. Doing it only
    // in the removal path left a token alive for a worktree deleted any other
    // way — by another window, or by hand (round-3 B5).
    options.actions?.reconcileFingerprints?.(worktreeIds());
    // The coordinator commits the envelope and publishes it — once.
    await requestProjection();
  }

  const gate = createRebuildGate(rebuild, options.clock);

  const paneSub = options.onPaneChange?.(onPaneChange);

  const folderSub = options.onDidChangeWorkspaceFolders?.(() => {
    // Forced: the folder set moved, so the cached tree is known wrong. The
    // floor bounds signal noise, not a change the user just made.
    void gate.request(WHOLE_TREE_SCOPE, { force: true });
  });

  function attach(surface: WorktreeSurface): WorktreeAttachment {
    surfaces.set(surface, { visible: false, displayed: false, showing: false, level: "rows" });
    return {
      dispose: () => {
        surfaces.delete(surface);
        // The models this surface was shown go with it, and so does the
        // opening that was shown them. Nothing else evicts either, so without
        // this the store grows with every window ever opened, a stale id stays
        // resolvable (.reviews/round-1.md B6), and the opening record outlives
        // the window that held it (round-1 W1).
        // A detached surface's openings can never be answered, and their
        // enumerations would otherwise be retained for the life of the host.
        // One routine for all three lifecycles now, so a channel added to
        // retirement cannot reach close and miss detach.
        forgetSurfaceOpenings(surfaceKey(surface));
        // The assessments it was still owed go with it too. Kept beside rather
        // than inside `forgetSurfaceOpenings`: that routine is the create
        // form's three lifecycles, and a create form closing must not retire a
        // removal assessment the user is waiting on.
        //
        // PROMPTNESS, not correctness, and deliberately not dressed as more:
        // `pending` is non-empty only while a job is outstanding, and
        // `takeNextAssess` already drops the entry of a departed surface, so
        // removing this line changes no assertion in the suite. What it buys is
        // releasing the surface reference now rather than holding it across an
        // assessment that can run for the length of a git status timeout.
        forgetSurfaceAssessments(surfaceKey(surface));
        // Detaching is a falling edge too: the last showing surface going away
        // this way would otherwise leave the scan armed for the window's life,
        // and the last ROW-DRAWING surface would leave a turn order standing
        // over identities nothing is drawing (design.md D10).
        reconcileScan();
        reconcileRowDrawing();
      },
      setDisplayed: (displayed: boolean) => {
        const state = surfaces.get(surface);
        if (state) {
          state.displayed = displayed;
          reconcileShowing(surface, state, true);
          reconcileScan();
          reconcileRowDrawing();
        }
      },
    };
  }

  function handleMessage(surface: WorktreeSurface, msg: WebViewToExtensionMessage): void {
    const state = surfaces.get(surface);
    if (disposed || !state) {
      return;
    }
    switch (msg.type) {
      case "worktreeViewVisibility": {
        state.visible = msg.visible;
        // Absent means `"rows"`: the field is additive and a sender that predates
        // it is declaring what it always declared.
        state.level = msg.level ?? "rows";
        reconcileShowing(surface, state, false);
        reconcileScan();
        reconcileRowDrawing();
        return;
      }
      case "requestWorktreeSubagents":
        requestDelegations(msg.rowId, msg.entryId);
        return;
      case "worktreeOpenFolder":
      case "worktreeRevealInOS":
      case "worktreeCopyPath":
      case "worktreeOpenTerminal":
      case "worktreeFocusPane":
      case "worktreeOpenPreview":
      case "worktreeCopyResumeCommand":
      case "worktreeRevealAgentCwd":
      case "worktreeCopyAgentPath":
      case "worktreeLaunchAgent":
      case "worktreeResumeHere":
      case "worktreeCreate":
      case "worktreeRemove":
      case "worktreeRemoveAssess":
      case "worktreeLock":
      case "worktreeUnlock":
      case "worktreePrune":
      case "requestWorktreeCreateDefaults":
      case "worktreeCreateClosed":
      case "worktreeProvisionSwitch":
      case "worktreeProvisionSave":
      case "worktreeCopyFileAsk":
      case "worktreeSetupStepAsk":
      case "worktreeSetupRetry":
      case "worktreeSetupViewOutput":
      case "requestWorktreeRefs":
      case "worktreeCreateProbe":
      case "worktreePickDestination":
      case "worktreeAuthorizeDebris":
        handleAction(surface, msg);
        return;
      case "requestWorktreeTree":
        // Nothing to serve before the first build, whatever the caller asked for.
        if (msg.force === true || !built) {
          void gate.request(WHOLE_TREE_SCOPE, { force: msg.force === true });
          return;
        }
        if (!deliverable()) {
          // Built but never committed — wait for the missing half rather than
          // answering with a tree whose presence does not exist yet.
          ensureProjection();
          return;
        }
        broadcast();
        return;
      default:
        return;
    }
  }

  return {
    // Folders are read here, not captured: a window that gained one since the
    // last init answers for the folder set the surface is booting against.
    initPayload: () => ({ worktreeHasRepo: hasGitRepo(options.workspaceFolders(), options.exists) }),
    attach,
    handleMessage,
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
        void report.origin?.openTerminal?.(report.openTerminalAt);
      }
    },

    reportProvisioning: (origin, outcome) => {
      if (!disposed) {
        origin?.post(outcome);
      }
    },

    mutationBindings: () => ({
      forceRebuild: async (repoId) => {
        await gate.request(repoId, { force: true });
      },
      resolve: (target) => {
        const found = locate(target.worktreeId);
        if (found === null || found.repo.repoId !== target.repoId) {
          return null;
        }
        return {
          repoPath: found.repo.mainPath,
          // git's own string, never the normalized id.
          worktreePath: found.wt.displayPath,
          // The head this registration is on. It is not a perfect incarnation
          // marker — a recreate onto the same commit repeats it — but it is the
          // strongest one a listing carries, and it is strictly better than the
          // path alone that B5 found (worktree-model.md).
          incarnation: `${found.wt.head ?? ""}:${found.wt.branch ?? ""}`,
          locked: found.wt.locked === true,
          wasRegistered: true,
          existedOnDisk: found.wt.missing !== true,
        };
      },
      repoPath: (repoId) => cache.read().repos.find((r) => r.repoId === repoId)?.mainPath ?? null,
      migrationRegistration: currentMigrationRegistration,
      // The claim a launch is admitted against, published as its value and
      // never derived from `degraded` (round-2 B7, round-7 W8, design.md D12).
      observation: (repoId) => observationOf(repoById(repoId)),
      createContext: (repoId) => {
        const repo = cache.read().repos.find((r) => r.repoId === repoId);
        if (repo === undefined) {
          return null;
        }
        return {
          mainWorktree: repo.mainPath,
          // LINKED only — a path inside main is where the default root lives.
          linkedWorktrees: repo.worktrees.filter((w) => w.id !== repo.mainPath).map((w) => w.id),
        };
      },
      assessRemoval: async (target) => {
        const found = locate(target.worktreeId);
        const facts = options.removalFacts;
        if (found === null || found.repo.repoId !== target.repoId || facts === undefined) {
          return null;
        }
        const observed = observationOf(found.repo);
        // Run in the worktree itself, not the repo: `--porcelain` is what names
        // the files a force would destroy, and that is per worktree.
        //
        // Not run at all when the directory is gone. Asking an absent cwd for
        // its status fails every time, which D16 correctly reported as
        // `unavailable` — permanently, on the one worktree state whose ONLY
        // remedy is the removal that prunes its registration (round-3 B8).
        // All four TOGETHER, not one after another. They are independent, and
        // each serial await is another moment a rebuild can land and replace the
        // listing everything below is derived from — the window round-9 B8
        // closed. Awaiting them as one suspension point is what kept adding the
        // ignored walk from widening it (round-1 B2 fix round).
        //
        // Neither the status nor the ignored walk runs when the directory is
        // gone. Asking an absent cwd for its status fails every time, which D16
        // correctly reported as `unavailable` — permanently, on the one worktree
        // state whose ONLY remedy is the removal that prunes its registration
        // (round-3 B8). A measured zero is the honest answer for the walk: there
        // is no directory, so there is no ignored material to delete.
        // Held so the proofs can await the SAME read rather than take their
        // own. Both entries below join one `Promise.all`, so this adds a read
        // to the assessment and not a suspension point (design.md D7).
        const sessionsRead = facts.sessions();
        const [status, ignored, sessions, panes, claimedByPane, proofs] = await Promise.all([
          // Run in the worktree itself, not the repo: `--porcelain` is what
          // names the files a force would destroy, and that is per worktree.
          found.wt.missing
            ? Promise.resolve(null)
            : options.deps.runner.run(["status", "--porcelain"], found.wt.displayPath),
          found.wt.missing
            ? Promise.resolve<IgnoredMaterial>({ kind: "measured", entries: 0, bytes: 0 })
            : facts.ignored(found.wt.displayPath),
          sessionsRead,
          facts.panes(),
          facts.claimedByPane(),
          // A missing worktree is answered without touching the disk: no
          // directory means no lock file and no branch to compare, so only the
          // ownership proof is answered — from the registry read taken anyway.
          facts.proofs(
            found.wt.missing
              ? { path: found.wt.id, locked: false }
              : {
                  path: found.wt.id,
                  locked: found.wt.locked,
                  ...(found.wt.branch === undefined ? {} : { branch: found.wt.branch }),
                },
            sessionsRead,
          ),
        ]);
        // Round-9 B8: those two reads take real time, and a rebuild landing in
        // between replaces the listing everything below is derived from — the
        // siblings, and the target itself. An assessment spanning two
        // observations belongs to neither, so it reports the listing unreadable
        // rather than answering from a mixture of them.
        const stillObserved = observed !== undefined && observationOf(repoById(target.repoId)) === observed;
        return evaluateRemoval({
          target: found.wt,
          siblings: found.repo.worktrees,
          panes,
          rows: presence().rowsByWorktreeId[target.worktreeId] ?? [],
          // Every read that can fail is carried as a read, not as its benign
          // fallback. A failed status is not a clean worktree (round-2 B6).
          sessions,
          claimedByPane,
          proofs,
          ignored,
          porcelain:
            status === null
              ? { ok: "notApplicable" }
              : status.code === 0 && !status.timedOut
                ? { ok: true, value: status.stdout.toString("utf8") }
                : { ok: false },
          // The same claim `observeAfter` asks after the attempt, so a removal
          // cannot be authorized under one reading and classified under another.
          listingDegraded: !stillObserved,
        });
      },
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
