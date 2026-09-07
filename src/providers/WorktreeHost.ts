// src/providers/WorktreeHost.ts — The window's owner of worktree freshness.
// See: docs/design/worktree-rpc.md § 1, § 2,
//      asimov/changes/cache-and-broadcast-worktree-tree/design.md D1, D6, D7
//
// One host per window, constructed beside the watcher pool. Surfaces attach to
// it; attaching costs no git command and no watcher, so a second panel showing
// the same tree is free.

import type {
  ExtensionToWebViewMessage,
  ProvisionEntry,
  ProvisionModel,
  ResolvedDisposition,
  WebViewToExtensionMessage,
  WorktreeActionMessage,
  WorktreeSubscriptionLevel,
} from "../types/messages";
import { SETUP_STEP_ADDED_SOURCE } from "../types/messages";
import { isResolvedPathInside } from "../utils/resolvedPathBoundary";
import { sanitizeBranchForPath } from "../worktree/branchSlug";
import { resolveCreateRoot, suggestFreePath } from "../worktree/createPath";
import { classifyDestination } from "../worktree/debrisClassification";
import { hasGitRepo } from "../worktree/hasGitRepo";
import type { IgnoredMaterial } from "../worktree/ignoredMaterial";
import type { MigrationOfferEvidence, MigrationRepositoryBinding } from "../worktree/migrateChanges";
import type {
  DelegationRoster,
  PresenceDegradation,
  WorktreeAgentRow,
  WorktreePresence,
} from "../worktree/presenceTypes";
import { ACTIVITY_EVIDENCE } from "../worktree/presenceTypes";
import { createProvisionOfferStore } from "../worktree/provisioning/offerStore";
import { conflictsWithProvisionDestination, MAX_MODEL_ROWS, rowsOf } from "../worktree/provisioning/providerKit";
import type { HeldProvisionSource } from "../worktree/provisioning/provisionMaterial";
import { createRebuildGate } from "../worktree/rebuildGate";
import type { WorktreeInfo, WorktreeRepo } from "../worktree/types";
import { createWorktreeCache } from "../worktree/WorktreeCache";
import {
  buildWorktreeTreeDetailed,
  listRegisteredRepoWorktrees,
  type WorktreeTreeDeps,
} from "../worktree/WorktreeDiscovery";
import { evaluateRemoval } from "../worktree/worktreeBlockers";
import { type WorktreeWatch, watchRepoStructure } from "../worktree/worktreeWatchTargets";
import { createCreateActions } from "./worktreeHost/actions/create";
import { createProvisionActions } from "./worktreeHost/actions/provision";
import { createRemovalActions } from "./worktreeHost/actions/removal";
import { createShellActions } from "./worktreeHost/actions/shell";
import type {
  LaunchTargetRecord,
  Opening,
  PickedCopyFile,
  WorktreeActions,
  WorktreeSurface,
} from "./worktreeHost/hostTypes";
import { createLaunchAdmission } from "./worktreeHost/launchAdmission";
import { createOpeningLifecycle } from "./worktreeHost/openingLifecycle";

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

/** What one projection request wants. */
interface ProjectionRequest {
  /** Skip the pane pass — the poll's mode (design.md D6). */
  external?: boolean;
  /**
   * Join a run already in flight rather than marking it dirty. A caller with no
   * new pane evidence wants an envelope, not a second projection.
   */
  join?: boolean;
}

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
  const currentMigrationRegistration = (repoId: string): MigrationRepositoryBinding["registration"] | undefined => {
    const generation = cache.readRepo(repoId)?.generation;
    return generation === undefined ? undefined : cache.registrationFor(repoId, generation);
  };
  const surfaces = new Map<WorktreeSurface, SurfaceState>();
  const watches = new Map<string, WorktreeWatch>();
  const projector = options.projector;
  let built = false;
  let disposed = false;
  /** Last projection produced, and the tree version it describes. */
  let projected: WorktreePresence | undefined;
  let projectedVersion = -1;
  /**
   * The only thing any surface is ever shown.
   *
   * Committing the two halves together is what makes the envelope contract
   * true: `rebuild()` mutates the cache before it can project, and a cached
   * tree request, a surface becoming displayed, or a watch-failure write inside
   * that window would otherwise deliver the new tree beside the previous
   * presence (.reviews/round-2.md B1).
   */
  let published: { tree: ReturnType<typeof cache.read>; presence: WorktreePresence } | undefined;

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
  const previewProvisioning = async (repo: WorktreeRepo, model: ProvisionModel): Promise<ProvisionModel> => {
    const preview = options.previewProvisioningPorts;
    if (preview === undefined) {
      return model;
    }
    try {
      return {
        ...model,
        ports: await preview(
          model.ports,
          repo.worktrees.map((worktree) => worktree.displayPath),
        ),
      };
    } catch {
      return {
        ...model,
        ports: model.ports.map(({ port: _preview, ...item }) => item),
      };
    }
  };
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
  let migrationSequence = 0;
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
   * Setup steps the user typed into THIS form, per opening, in the order added.
   *
   * Scripts only — no ids. Every offer the form is issued is built through
   * `withAdded`, which appends one marker row per script and lets the store mint
   * the ids, so an added step is spent exactly the way a provider-declared one
   * is: by offer id plus item id, against the model the host holds (design.md
   * D3). Same slot as `provisionBaseline`, swept with it by `retireOpening`, so
   * a step dies with the form that typed it.
   */
  const addedSteps = new Map<string, readonly string[]>();
  const MAX_ADDED_STEPS = 32;
  const addedCopyFiles = new Map<string, readonly PickedCopyFile[]>();
  const MAX_ADDED_COPY_FILES = 32;
  const ADDED_COPY_SOURCE = "Added for this create";
  /**
   * The model as the provider read gave it: marker rows and the host's own
   * withholding problem stripped.
   *
   * The ask handler builds from `offers.current`, which already carries the
   * previous answer's rows, and appending onto that duplicated the record on
   * every ask (plan attack F1) — and would have stacked the withholding problem
   * on every cancel (round 2 plan attack 6). Setup rows retain their existing
   * host marker; picked rows are removed only by the current offer's private
   * sidecar ids, never by presentation fields.
   */
  const withoutAdded = (model: ProvisionModel, heldIds: ReadonlySet<string> = new Set()): ProvisionModel => ({
    ...model,
    entries: model.entries.filter((entry) => !heldIds.has(entry.id)),
    setup: model.setup.filter((step) => step.source !== SETUP_STEP_ADDED_SOURCE),
    problems: model.problems.filter((problem) => problem.file !== SETUP_STEP_ADDED_SOURCE),
  });

  const privateIdsFor = (offerKey: { surface: string; repoId: string }, model: ProvisionModel): ReadonlySet<string> => {
    const current = offers.current(offerKey);
    if (current?.model !== model) {
      return new Set();
    }
    return new Set(offers.redeem(offerKey, current.offerId)?.heldFiles.keys());
  };

  const withAdded = (
    offerKey: { surface: string; repoId: string },
    slot: string,
    model: ProvisionModel,
    copyRecord: readonly PickedCopyFile[] = addedCopyFiles.get(slot) ?? [],
    setupRecord: readonly string[] = addedSteps.get(slot) ?? [],
  ): { readonly model: ProvisionModel; readonly heldFiles: ReadonlyMap<ProvisionEntry, HeldProvisionSource> } => {
    const base = withoutAdded(model, privateIdsFor(offerKey, model));
    const occupied: ProvisionEntry[] = [...base.entries, ...base.excluded];
    const heldFiles = new Map<ProvisionEntry, HeldProvisionSource>();
    const candidateCopies: Array<{ entry: ProvisionEntry; source: PickedCopyFile }> = [];
    const usedIds = new Set([...base.entries, ...base.excluded, ...base.setup, ...base.ports].map((row) => row.id));
    for (const [index, source] of copyRecord.entries()) {
      let id = `added-copy-${index}`;
      while (usedIds.has(id)) {
        id = `_${id}`;
      }
      usedIds.add(id);
      const entry: ProvisionEntry = {
        id,
        path: source.path,
        mode: "copy",
        source: ADDED_COPY_SOURCE,
        suggestion: "May contain secrets.",
        addedForCreate: true,
      };
      if (conflictsWithProvisionDestination(occupied, entry)) {
        break;
      }
      candidateCopies.push({ entry, source });
      occupied.push(entry);
    }

    const room = MAX_MODEL_ROWS - rowsOf(base);
    const conflictWithheld = copyRecord.length - candidateCopies.length;
    const totalAdded = candidateCopies.length + setupRecord.length;
    const needsStatement = conflictWithheld > 0 || totalAdded > room;
    const usable = needsStatement ? Math.max(0, room - 1) : room;
    const shownCopies = Math.min(candidateCopies.length, usable);
    const shownSetup = Math.min(setupRecord.length, Math.max(0, usable - shownCopies));
    for (const { entry, source } of candidateCopies.slice(0, shownCopies)) {
      heldFiles.set(entry, { canonicalPath: source.canonicalPath, file: source.file });
    }
    const withheldCopies = copyRecord.length - shownCopies;
    const withheldSetup = setupRecord.length - shownSetup;
    const withheld: string[] = [];
    if (withheldCopies > 0) {
      withheld.push(`${withheldCopies} added file${withheldCopies === 1 ? "" : "s"}`);
    }
    if (withheldSetup > 0) {
      withheld.push(`${withheldSetup} added setup step${withheldSetup === 1 ? "" : "s"}`);
    }
    const statement = withheld.join(" and ");
    return {
      model: {
        ...base,
        entries: [...base.entries, ...candidateCopies.slice(0, shownCopies).map(({ entry }) => entry)],
        setup: [
          ...base.setup,
          ...setupRecord.slice(0, shownSetup).map((script, index) => ({
            id: `added-${index}`,
            kind: "shell" as const,
            script,
            source: SETUP_STEP_ADDED_SOURCE,
          })),
        ],
        problems:
          statement.length === 0 || room <= 0
            ? base.problems
            : [
                ...base.problems,
                {
                  file: SETUP_STEP_ADDED_SOURCE,
                  reason: "malformed" as const,
                  detail: `${statement} not offered: this source leaves no room or has a conflicting destination.`,
                },
              ],
      },
      heldFiles,
    };
  };

  const roomForOneMoreSetup = (
    offerKey: { surface: string; repoId: string },
    slot: string,
    model: ProvisionModel,
    record: readonly string[],
  ): boolean => {
    const next = [...record, ""];
    const composed = withAdded(offerKey, slot, model, addedCopyFiles.get(slot) ?? [], next);
    return composed.model.setup.filter((step) => step.source === SETUP_STEP_ADDED_SOURCE).length === next.length;
  };

  const issueWithAdded = (offerKey: { surface: string; repoId: string }, slot: string, model: ProvisionModel) => {
    const composed = withAdded(offerKey, slot, model);
    return offers.issue(offerKey, composed.model, composed.heldFiles);
  };

  const retireOpening = (key: string): void => {
    lifecycle.close(key);
    const reading = `${key} `;
    for (const slot of [...provisionReading.keys()]) {
      if (slot.startsWith(reading)) {
        provisionReading.delete(slot);
      }
    }
    for (const slot of [...provisionSwitch.keys()]) {
      if (slot.startsWith(reading)) {
        provisionSwitch.delete(slot);
      }
    }
    for (const slot of [...provisionBaseline.keys()]) {
      if (slot.startsWith(reading)) {
        provisionBaseline.delete(slot);
      }
    }
    for (const slot of [...addedSteps.keys()]) {
      if (slot.startsWith(reading)) {
        addedSteps.delete(slot);
      }
    }
    for (const slot of [...addedCopyFiles.keys()]) {
      if (!slot.startsWith(reading)) {
        continue;
      }
      for (const added of addedCopyFiles.get(slot) ?? []) {
        added.file.dispose();
      }
      addedCopyFiles.delete(slot);
    }
    offers.forgetSurface(key);
    const migrationPrefix = `${key}::`;
    for (const slot of [...migrationReading.keys()]) {
      if (slot.startsWith(migrationPrefix)) {
        migrationReading.delete(slot);
      }
    }
    for (const [offerId, offer] of migrationOffers) {
      if (offer.surface === key) {
        migrationOffers.delete(offerId);
      }
    }
    // And the per-repository enumeration records, which are what
    // `worktreeCreateProbe` and `worktreeAuthorizeDebris` read to decide whether
    // a request belongs to a live form. Retiring only the provisioning half left
    // a cancelled form still able to publish discovery replies and — the part
    // that matters — still able to mint a DEBRIS AUTHORIZATION, which is
    // deletion authority (.reviews/round-1.md B2, design.md D5).
    //
    // The carve-out's own rule is untouched: a deletion still requires an
    // explicit authorization naming a fingerprint. What changes is that a form
    // the user cancelled can no longer be the thing that names one.
    const enumerated = `${key}\u0000`;
    for (const slot of [...openings.keys()]) {
      if (slot.startsWith(enumerated)) {
        openings.delete(slot);
      }
    }
  };
  /** Drop a surface's opening history too. Only detach may do this. */
  const forgetSurfaceOpenings = (key: string): void => {
    retireOpening(key);
    lifecycle.detach(key);
  };

  /**
   * Assessment admission, one lane per REPOSITORY (design.md D1).
   *
   * A removal assessment runs inside `coordinator.run`, so every one of them is
   * a job on that repository's mutation queue, ahead of any lock, unlock,
   * remove, prune or create queued behind it. The queue is deliberately
   * non-coalescing (`keyedSerialQueue.ts`), so the bound has to live here.
   *
   * Keyed by repository because that is what the queue is keyed by. A slot per
   * `(surface, repository)` was drafted and refuted: detaching a surface
   * deletes its record but cannot retract a job already appended, so attach →
   * ask → detach repeated N times left N jobs queued with nothing attached.
   *
   * At most ONE job per repository exists at a time. Further requests rewrite
   * `pending` and enqueue nothing; the job re-enqueues itself while anything is
   * still owed. Service is round-robin over `rotation`, not newest-first: two
   * panels asking continuously must each be answered.
   */
  type PendingAssess =
    | {
        kind: "assessment";
        surface: WorktreeSurface;
        worktreeId: string;
        token: string;
      }
    | {
        kind: "rawRemoval";
        surface: WorktreeSurface;
        worktreeId: string;
      };
  interface AssessLane {
    /** The latest unanswered request per surface, keyed by `surfaceKey`. */
    pending: Map<string, PendingAssess>;
    /** Service order. A key joins when it first has a request and cycles when served. */
    rotation: string[];
    /** A job for this repository is enqueued or running. */
    outstanding: boolean;
  }
  type AssessCapability = NonNullable<WorktreeActions["assessRemovalReport"]>;
  const assessLanes = new Map<string, AssessLane>();

  /** Replace this surface's pending report request and enqueue at most one repository job. */
  function admitAssess(repoId: string, request: PendingAssess): void {
    const laneKey = surfaceKey(request.surface);
    const fresh: AssessLane = { pending: new Map(), rotation: [], outstanding: false };
    const lane = assessLanes.get(repoId) ?? fresh;
    assessLanes.set(repoId, lane);
    // Against the ROTATION, not against `pending`: a surface being served has
    // already had its pending entry taken, so testing `pending` here re-appends
    // its key on every re-ask and grows the rotation without bound.
    if (!lane.rotation.includes(laneKey)) {
      lane.rotation.push(laneKey);
    }
    lane.pending.set(laneKey, request);
    if (lane.outstanding) {
      return;
    }
    lane.outstanding = true;
    void runAssessLane(repoId);
  }

  /** Everything one surface has pending, dropped when it detaches. */
  const forgetSurfaceAssessments = (key: string): void => {
    for (const [repoId, lane] of [...assessLanes]) {
      lane.pending.delete(key);
      const at = lane.rotation.indexOf(key);
      if (at !== -1) {
        lane.rotation.splice(at, 1);
      }
      if (!lane.outstanding && lane.pending.size === 0) {
        assessLanes.delete(repoId);
      }
    }
  };

  /**
   * The next request this lane owes, taken from the rotation rather than from
   * arrival order. Bounded by the rotation's length, so a lane holding only
   * departed surfaces terminates rather than spinning.
   */
  function takeNextAssess(lane: AssessLane): PendingAssess | undefined {
    for (let guard = lane.rotation.length; guard > 0; guard -= 1) {
      const key = lane.rotation.shift();
      if (key === undefined) {
        break;
      }
      const request = lane.pending.get(key);
      // Nothing owed under this key any more, so it leaves the rotation.
      if (request === undefined) {
        continue;
      }
      lane.pending.delete(key);
      // A detached surface cannot be answered, and its request must not cost a
      // job. Dropped WITHOUT rejoining the rotation.
      if (!surfaces.has(request.surface)) {
        continue;
      }
      lane.rotation.push(key);
      return request;
    }
    return undefined;
  }

  async function runAssessLane(repoId: string): Promise<void> {
    const lane = assessLanes.get(repoId);
    if (lane === undefined) {
      return;
    }
    try {
      const request = takeNextAssess(lane);
      if (request !== undefined) {
        await serveAssess(repoId, request);
      }
    } finally {
      // Synchronous, in one block: the flag falls and the re-enqueue decision
      // is taken together, so a request that arrived during the job cannot land
      // in a window where nothing is outstanding and nothing is queued — a lost
      // wakeup leaves it owed forever (design.md D6).
      lane.outstanding = false;
      if (lane.pending.size > 0) {
        lane.outstanding = true;
        void runAssessLane(repoId);
      } else if (assessLanes.get(repoId) === lane) {
        assessLanes.delete(repoId);
      }
    }
  }

  /** Serve one report-producing request while its surface remains attached. */
  async function serveAssess(repoId: string, request: PendingAssess): Promise<void> {
    const { surface: origin, worktreeId } = request;
    if (request.kind === "rawRemoval") {
      const remove = options.actions?.removeWorktree;
      if (remove === undefined) {
        return;
      }
      try {
        await remove({ repoId, worktreeId, origin }, undefined);
      } catch (err) {
        console.warn(`${LOG_PREFIX} worktree action failed`, err);
      }
      return;
    }

    const { token } = request;
    const unavailable = (unreadable: readonly string[]): void => {
      if (surfaces.has(origin)) {
        origin.post({
          type: "worktreeRemoveAssessment",
          worktreeId,
          token,
          result: { kind: "unavailable", unreadable },
        });
      }
    };
    // Re-checked HERE as well as at admission: a request waits its turn in the
    // lane, and the registration can leave while it does.
    if (actionPath(worktreeId, true) === undefined) {
      unavailable(["the worktree is no longer registered"]);
      return;
    }
    const assess = options.actions?.assessRemovalReport;
    if (assess === undefined) {
      unavailable(["the assessment"]);
      return;
    }
    let result: Awaited<ReturnType<AssessCapability>>;
    try {
      result = await assess({ repoId, worktreeId, origin });
    } catch {
      // Inventing an empty report would render a worktree of unknown risk as
      // one with none — but silence made an explicit destructive request look
      // inert, with no retry. The `unavailable` arm D8 already defines is the
      // honest third answer (D12).
      //
      // Scoped to the assessment alone. Chaining it after the success handler
      // would report a failure to DELIVER a report as a failure to produce one.
      unavailable(["the assessment"]);
      return;
    }
    // Re-checked after the await, like every other read here: the surface may
    // have gone, and this answer carries a fingerprint.
    if (!surfaces.has(origin)) {
      return;
    }
    if (result === null) {
      unavailable(["the worktree is no longer registered"]);
      return;
    }
    origin.post({ type: "worktreeRemoveAssessment", worktreeId, token, result });
  }
  /**
   * The branch enumeration each repository's open dialog is riding.
   *
   * Bounded by the number of repositories in the workspace, and each entry is
   * replaced rather than accumulated: a repository has one open create dialog
   * at a time, and its latest ask is the only one anything reads.
   */
  const openings = new Map<string, Opening>();
  const surfaceKeys = new WeakMap<WorktreeSurface, string>();
  let surfaceSeq = 0;
  /**
   * One enumeration belongs to one surface's one opening of one repository.
   *
   * Keyed by repository alone, a second attached surface's `requestWorktreeRefs`
   * replaced the promise the first surface's probe was about to consume, so a
   * dialog could classify against an enumeration it was never shown (round-1 W2).
   */
  const openingKey = (s: WorktreeSurface, repoId: string): string => `${surfaceKey(s)}\u0000${repoId}`;

  /** The opening this message belongs to, or nothing if a newer one replaced it. */
  const openingFor = (s: WorktreeSurface, repoId: string, token: number): Opening | undefined => {
    const held = openings.get(openingKey(s, repoId));
    return held?.token === token ? held : undefined;
  };

  /** Retire every per-repository form capability the rebuilt tree no longer carries. */
  const forgetDepartedRepos = (departed: ReadonlySet<string>): void => {
    if (departed.size === 0) {
      return;
    }
    const repositoryOfProvisionSlot = (slot: string): string | undefined => {
      const surfaceAt = slot.indexOf(" ");
      const openingAt = slot.lastIndexOf(" ");
      return surfaceAt >= 0 && openingAt > surfaceAt ? slot.slice(surfaceAt + 1, openingAt) : undefined;
    };
    for (const reading of [...provisionReading.keys()]) {
      const surfaceAt = reading.indexOf(" ");
      if (surfaceAt >= 0 && departed.has(reading.slice(surfaceAt + 1))) {
        provisionReading.delete(reading);
      }
    }
    for (const slot of [...provisionSwitch.keys()]) {
      if (departed.has(repositoryOfProvisionSlot(slot) ?? "")) {
        provisionSwitch.delete(slot);
      }
    }
    for (const slot of [...provisionBaseline.keys()]) {
      if (departed.has(repositoryOfProvisionSlot(slot) ?? "")) {
        provisionBaseline.delete(slot);
      }
    }
    for (const slot of [...addedSteps.keys()]) {
      if (departed.has(repositoryOfProvisionSlot(slot) ?? "")) {
        addedSteps.delete(slot);
      }
    }
    for (const slot of [...addedCopyFiles.keys()]) {
      if (!departed.has(repositoryOfProvisionSlot(slot) ?? "")) {
        continue;
      }
      for (const added of addedCopyFiles.get(slot) ?? []) {
        added.file.dispose();
      }
      addedCopyFiles.delete(slot);
    }
    for (const key of [...openings.keys()]) {
      const repoAt = key.indexOf("\u0000");
      if (repoAt >= 0 && departed.has(key.slice(repoAt + 1))) {
        openings.delete(key);
      }
    }
    for (const slot of [...migrationReading.keys()]) {
      if (departed.has(migrationReading.get(slot)?.repoId ?? "")) {
        migrationReading.delete(slot);
      }
    }
    for (const offerId of [...migrationOffers.keys()]) {
      if (departed.has(migrationOffers.get(offerId)?.repoId ?? "")) {
        migrationOffers.delete(offerId);
      }
    }
    for (const surface of surfaces.keys()) {
      const key = surfaceKeys.get(surface);
      if (key === undefined) {
        continue;
      }
      for (const repoId of departed) {
        offers.forget({ surface: key, repoId });
      }
    }
  };

  const surfaceKey = (s: WorktreeSurface): string => {
    const held = surfaceKeys.get(s);
    if (held !== undefined) {
      return held;
    }
    surfaceSeq += 1;
    const minted = `surface-${surfaceSeq}`;
    surfaceKeys.set(s, minted);
    return minted;
  };
  /**
   * Bumped by every write to the cached tree — never by a delivery attempt.
   *
   * A projection describes the tree it read, so what invalidates it is that
   * tree moving. Versioning delivery instead made a broadcast that posted to
   * nobody supersede real work, and made two broadcasts of the same tree look
   * like two different trees (.reviews/round-1.md B1).
   */
  let treeVersion = 0;
  /** The projection currently in flight. One at a time: the projector is stateful. */
  let projectionRun: Promise<void> | undefined;
  let projectionDirty = false;
  let capHandle: unknown;
  /** The external-scan timer, armed only while some surface is showing the view. */
  let scanHandle: unknown;
  /** Whether the next projection iteration may skip the pane pass. */
  let nextExternalOnly = false;
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
  let paneEvidenceApplied = 0;
  /**
   * The rank revision the cached ORDER was built from.
   *
   * Advanced at exactly one site — after `cache.reorder`, the only cache-wide
   * ordering operation. A rebuild's write must not acknowledge it: `applyRepo`
   * orders one repository and rebuilds are serialized per scope, and `merge`
   * retains the stored worktree array for a degraded listing, so neither write
   * establishes the ranking it captured (design.md D12).
   */
  let appliedRankRevision = projector?.rankRevision() ?? 0;
  /**
   * Whether the projection behind `projected` ran per-row enrichment. A window
   * whose only subscribers were presence-only publishes a deliberately bare
   * envelope, and rebroadcasting that to a rail that just reopened would draw
   * rows with no title and no preview until the next scan (round-2 W1).
   */
  let projectedEnriched = true;
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

  function armCap(fn: () => void): unknown {
    return arm(fn, PRESENCE_MAX_LATENCY_MS);
  }

  function arm(fn: () => void, ms: number): unknown {
    return options.clock ? options.clock.setTimeout(fn, ms) : setTimeout(fn, ms);
  }

  function cancelCap(handle: unknown): void {
    if (options.clock) {
      options.clock.clearTimeout(handle);
    } else {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    }
  }

  /**
   * The ordering key the listing sorts by. Read through the projector on every
   * assembly rather than snapshotted, so a rebuild orders by the presence that
   * is current when it runs (design.md D12).
   */
  const discoveryDeps: WorktreeTreeDeps = projector
    ? { ...options.deps, rank: (id: string) => projector.rank(id) }
    : options.deps;

  /** Presence with no projector is the empty envelope this host always sent. */
  function presence(): WorktreePresence {
    return projected ?? { rowsByWorktreeId: {}, scannedAt: now(), degradedSources: [] };
  }

  /** `\0` cannot occur in a row id or an entry id, so the join is unambiguous. */
  function rosterKey(rowId: string, entryId: string): string {
    return `${rowId}\u0000${entryId}`;
  }

  function parentIsLive(row: WorktreeAgentRow, degraded: ReadonlySet<PresenceDegradation["source"]>): boolean {
    if (row.activity !== "running" && row.activity !== "waiting") {
      return false;
    }
    const evidence = ACTIVITY_EVIDENCE[row.activitySource];
    // `none` proves nothing, so the parent's own liveness is unevidenced too.
    return evidence !== undefined && !degraded.has(evidence);
  }

  /**
   * A child's `running` does not outlive its parent's freshness (design.md D11).
   *
   * The transcript's recorded status is what the mapper hands over; whether it
   * may still be PUBLISHED is decided here, in the same pass that publishes the
   * parent — which is what makes the two incapable of disagreeing.
   */
  function decay(
    roster: DelegationRoster,
    parent: WorktreeAgentRow,
    degraded: ReadonlySet<PresenceDegradation["source"]>,
  ): DelegationRoster {
    if (roster.kind !== "ok" || parentIsLive(parent, degraded)) {
      return roster;
    }
    if (!roster.rows.some((child) => child.status === "running")) {
      return roster;
    }
    return {
      ...roster,
      rows: roster.rows.map((child) => (child.status === "running" ? { ...child, status: "unknown" as const } : child)),
    };
  }

  /**
   * Attach every roster to the row it was read for, and drop the rest.
   *
   * The rows here are the projector's own retained objects — a replay hands
   * them straight back — so each is COPIED rather than written through, or the
   * roster would end up inside the projector's replay state (design.md D3).
   * Eviction runs against the rows actually published, so a closed pane, or a
   * pane that started a new session, takes its roster with it.
   */
  function withDelegations(source: WorktreePresence): WorktreePresence {
    if (rosters.size === 0) {
      return source;
    }
    const degraded = new Set(source.degradedSources.map((entry) => entry.source));
    const kept = new Set<string>();
    const rowsByWorktreeId: Record<string, WorktreeAgentRow[]> = {};
    for (const [worktreeId, rows] of Object.entries(source.rowsByWorktreeId)) {
      rowsByWorktreeId[worktreeId] = rows.map((row) => {
        const key = row.entryId === undefined ? undefined : rosterKey(row.rowId, row.entryId);
        const roster = key === undefined ? undefined : rosters.get(key);
        if (key === undefined || roster === undefined) {
          return row;
        }
        // A roster the agent reported for itself is the better evidence and is
        // already gone if its report went stale. Overwriting it with a cached
        // transcript read would replace live work with its own history.
        if (row.delegations?.kind === "ok" && row.delegations.reported) {
          kept.add(key);
          return row;
        }
        kept.add(key);
        return { ...row, delegations: decay(roster, row, degraded) };
      });
    }
    for (const key of rosters.keys()) {
      if (!kept.has(key)) {
        rosters.delete(key);
      }
    }
    return { ...source, rowsByWorktreeId };
  }

  /** The row `rowId` names in the envelope this host last published, if any. */
  function publishedRow(rowId: string): WorktreeAgentRow | undefined {
    if (!published) {
      return undefined;
    }
    for (const rows of Object.values(published.presence.rowsByWorktreeId)) {
      const found = rows.find((row) => row.rowId === rowId);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  /** The worktree `worktreeId` names in the tree this host currently holds. */
  function cachedWorktree(worktreeId: string): WorktreeInfo | undefined {
    for (const repo of cache.read().repos) {
      const found = repo.worktrees.find((wt) => wt.id === worktreeId);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  /**
   * Which repository holds this worktree, derived rather than accepted.
   *
   * The inbound messages carry only a `worktreeId`, and that is the right
   * shape: a webview-supplied `repoId` would let one repo's panel name
   * another's queue, and the id it names is the only thing a mutation is
   * entitled to act on. Resolved here for the queue key only — the TARGET is
   * re-resolved from the id on the far side of the rebuild (round-1 B2).
   */
  function repoIdOf(worktreeId: string): string | undefined {
    for (const repo of cache.read().repos) {
      if (repo.worktrees.some((wt) => wt.id === worktreeId)) {
        return repo.repoId;
      }
    }
    return undefined;
  }

  /**
   * The registration a repository publishes when the host OBSERVED its listing.
   *
   * Absent when the cache RETAINED the listing rather than reading it, and
   * absent for every repository while git itself is unusable — a retained
   * listing is right for DISPLAY (three worktrees marked degraded beats none)
   * and wrong for authority, because admitting on it would mint fresh authority
   * over registrations discovery just failed to verify (round-5 B7).
   *
   * Present for a repository nobody can watch: its listing WAS read, it may
   * just go stale unnoticed, and refusing there would disable launches and
   * removals on every host without file watching (D11).
   *
   * A launch and a removal ask this and nothing else (design.md D12). Nobody
   * re-derives it from `degraded`, which is the composed line shown to the user
   * and also carries the watch claim (round-7 W8).
   */
  function observationOf(repo: WorktreeRepo | undefined): number | undefined {
    return repo?.generation;
  }

  function repoById(repoId: string): WorktreeRepo | undefined {
    return cache.read().repos.find((r) => r.repoId === repoId);
  }

  /**
   * The path to act on for a worktree request, or undefined to do nothing.
   *
   * A `missing` worktree resolves for a copy and for nothing else: copying the
   * path is how a user goes and looks at what happened to a directory that is
   * gone, but opening, revealing or spawning a terminal in one would act on a
   * path that is not there (design.md D3).
   */
  /**
   * Which observation of this worktree's registration the host currently holds,
   * or `undefined` when it holds none.
   *
   * "Something is there" and "the same thing is there" are different questions,
   * and remove-then-recreate at the same normalized id answers yes to the first.
   * Nothing git reports answers the second: the same branch at the same commit
   * lists identically, and git reuses `.git/worktrees/<name>` after a deletion
   * (`worktreeFingerprint.ts`). So the answer is the cache's own — it advances
   * the number whenever it re-observes a repository, because re-observing is
   * exactly when it stops being able to prove continuity (design.md D10).
   *
   * Per repository, never the global `treeVersion`: a sibling repository
   * rebuilding must not refuse this launch.
   */
  function launchTarget(worktreeId: string): LaunchTargetRecord | undefined {
    for (const repo of cache.read().repos) {
      const found = repo.worktrees.find((wt) => wt.id === worktreeId);
      if (found === undefined) {
        continue;
      }
      const observed = observationOf(repo);
      if (found.missing === true || observed === undefined) {
        return undefined;
      }
      // git's own display string, never the normalized id.
      return { path: found.displayPath, generation: observed };
    }
    return undefined;
  }

  function actionPath(worktreeId: string, allowMissing: boolean): string | undefined {
    const wt = cachedWorktree(worktreeId);
    if (!wt || (wt.missing && !allowMissing)) {
      return undefined;
    }
    return wt.displayPath;
  }

  /**
   * The published row this request names, only if the value it carried still
   * matches the host's own.
   *
   * The carried id is an expected-version token, never an argument: a surface
   * whose last envelope was skipped still shows the previous session under a
   * stable row id, and acting on the id it sent would act on the wrong session
   * (D3). Returning the row rather than a boolean is what makes it impossible to
   * check one value and then act on another.
   */
  function matchedRow(rowId: string, field: "paneId" | "entryId", carried: string): WorktreeAgentRow | undefined {
    const row = publishedRow(rowId);
    const own = row?.[field];
    return own !== undefined && own === carried ? row : undefined;
  }

  /**
   * What this window will let a surface start, and whether the request in hand
   * quoted the offer it was chosen from (task 2_2). Holds the offer sequence, so
   * every id it hands out is minted in one place (OBL-7).
   */
  const { admissibleLaunch, admittedTarget, publishLaunchTargets, launchOpts } = createLaunchAdmission({
    actions: () => options.actions,
    launchTarget: (worktreeId) => launchTarget(worktreeId),
  });

  /** Run one capability, keeping a rejection out of the message loop. */
  function perform(run: () => Promise<void>): void {
    void run().catch((err) => {
      console.warn(`${LOG_PREFIX} worktree action failed`, err);
    });
  }

  /** The configured create root for one repository. */
  function createRootFor(repo: WorktreeRepo): string {
    return resolveCreateRoot({
      configured: options.createRoot?.() ?? { value: undefined, explicitlySet: false },
      linkedWorktrees: repo.worktrees.filter((w) => w.id !== repo.mainPath).map((w) => w.id),
      mainWorktree: repo.mainPath,
    });
  }

  /**
   * A destination override the probe may act on, or `undefined`.
   *
   * Resolved rather than lexical containment: the answer authorizes
   * `options.exists`, which follows symlinks, so a path spelled beneath the
   * root that traverses a link out of it would turn the resolution into an
   * existence oracle for the filesystem (round-3 B8).
   */
  async function vettedOverride(candidate: string | undefined, repo: WorktreeRepo): Promise<string | undefined> {
    if (candidate === undefined) {
      return undefined;
    }
    const inside = await isResolvedPathInside(candidate, createRootFor(repo), options.resolvedPathDeps).catch(
      () => false,
    );
    return inside ? candidate : undefined;
  }

  /**
   * Where a create for this branch would go, and what it stepped over.
   *
   * ONE derivation for both answers. The probe and `worktreeCreateDefaults`
   * each derived root, taken paths, slug, base and free suffix separately, so
   * the destination the resolution named and the one the defaults reply named
   * could drift apart (round-1 W4).
   */
  /**
   * A registered worktree is not debris, and neither is an unregistered
   * directory holding a `.git` — `classifyDestination` reads for one rather than
   * inferring from the listing (design.md D1). Runs only for a candidate the
   * suffixing already skipped, so the common path still adds no I/O.
   */
  function dispositionOf(candidatePath: string, isRegistered: boolean): ResolvedDisposition {
    return classifyDestination(candidatePath, isRegistered, options.probeGitEntry);
  }

  function resolveDestination(
    repo: WorktreeRepo,
    branch: string,
    /** A destination override ALREADY proven to resolve inside the create root. */
    override?: string,
    /**
     * Derive inside THIS folder instead of the configured root.
     *
     * Already resolved, and resolved by the host's own dialog rather than named
     * by any message — the caller passes `Opening.chosenRoot`, never a value a
     * probe carried (design.md D4, D5).
     */
    chosen?: string,
  ): {
    root: string;
    /** The directory NAME the candidate is built from, not a path to it. */
    base: string;
    bare: string;
    freePath: string;
    occupiedCandidate?: { path: string; disposition: ResolvedDisposition };
  } {
    const root = chosen ?? createRootFor(repo);
    const registered = new Set(repo.worktrees.map((w) => w.id));
    // Registrations AND the filesystem: a directory nobody registered still
    // makes `git worktree add` fail, so proving a path free against the listing
    // alone proves the wrong thing (round-3 B12).
    const taken = (candidate: string): boolean => registered.has(candidate) || (options.exists?.(candidate) ?? false);
    const slug = sanitizeBranchForPath(branch);
    const base = slug.length > 0 ? `${repo.label}-${slug}` : repo.label;
    // An override is honoured only inside the configured root — vetted by the
    // caller through RESOLVED containment, because the answer states whether a
    // path is occupied and lexical containment would let a link out of the root
    // turn the probe into an existence oracle for the filesystem (round-3 B8).
    const inRoot = override;
    const bare = inRoot ?? suggestFreePath(root, base, () => false);
    const freePath = taken(bare) ? suggestFreePath(root, base, taken) : bare;
    return {
      root,
      base,
      bare,
      freePath,
      // Present only when the suffixing actually skipped something. `debris` is
      // the directory nobody registered — a registered worktree is not debris,
      // and nothing here mints an authorization to delete either (D4).
      ...(freePath === bare
        ? {}
        : { occupiedCandidate: { path: bare, disposition: dispositionOf(bare, registered.has(bare)) } }),
    };
  }

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
    bumpMigrationSequence: () => ++migrationSequence,
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

  function handleAction(surface: WorktreeSurface, msg: WorktreeActionMessage): void {
    const actions = options.actions;
    if (!actions || disposed) {
      return;
    }
    switch (msg.type) {
      case "worktreeOpenFolder":
        shell.worktreeOpenFolder(surface, msg, actions);
        return;
      case "worktreeCreate":
        create.worktreeCreate(surface, msg, actions);
        return;
      case "worktreeSetupRetry":
        create.worktreeSetupRetry(surface, msg, actions);
        return;
      case "worktreeSetupViewOutput":
        shell.worktreeSetupViewOutput(surface, msg, actions);
        return;
      case "worktreeRemoveAssess":
        removal.worktreeRemoveAssess(surface, msg, actions);
        return;
      case "worktreeRemove":
        removal.worktreeRemove(surface, msg, actions);
        return;
      case "worktreeLock":
        removal.worktreeLock(surface, msg, actions);
        return;
      case "worktreeUnlock":
        removal.worktreeUnlock(surface, msg, actions);
        return;
      case "worktreePickDestination":
        create.worktreePickDestination(surface, msg, actions);
        return;
      case "worktreeCreateProbe":
        create.worktreeCreateProbe(surface, msg, actions);
        return;
      case "worktreeAuthorizeDebris":
        create.worktreeAuthorizeDebris(surface, msg, actions);
        return;
      case "worktreeProvisionSwitch":
        provision.worktreeProvisionSwitch(surface, msg);
        return;
      case "worktreeCopyFileAsk":
        provision.worktreeCopyFileAsk(surface, msg);
        return;
      case "worktreeSetupStepAsk":
        provision.worktreeSetupStepAsk(surface, msg);
        return;
      case "worktreeProvisionSave":
        provision.worktreeProvisionSave(surface, msg);
        return;
      case "worktreeCreateClosed":
        create.worktreeCreateClosed(surface, msg, actions);
        return;
      case "requestWorktreeCreateDefaults":
        create.requestWorktreeCreateDefaults(surface, msg, actions);
        return;
      case "requestWorktreeRefs":
        create.requestWorktreeRefs(surface, msg, actions);
        return;
      case "worktreePrune":
        removal.worktreePrune(surface, msg, actions);
        return;
      case "worktreeRevealInOS":
        shell.worktreeRevealInOS(surface, msg, actions);
        return;
      case "worktreeCopyPath":
        shell.worktreeCopyPath(surface, msg, actions);
        return;
      case "worktreeOpenTerminal":
        shell.worktreeOpenTerminal(surface, msg, actions);
        return;
      case "worktreeFocusPane":
        shell.worktreeFocusPane(surface, msg, actions);
        return;
      case "worktreeOpenPreview":
        shell.worktreeOpenPreview(surface, msg, actions);
        return;
      case "worktreeCopyResumeCommand":
        shell.worktreeCopyResumeCommand(surface, msg, actions);
        return;
      case "worktreeRevealAgentCwd":
        shell.worktreeRevealAgentCwd(surface, msg, actions);
        return;
      case "worktreeCopyAgentPath":
        shell.worktreeCopyAgentPath(surface, msg, actions);
        return;
      case "worktreeLaunchAgent":
        shell.worktreeLaunchAgent(surface, msg, actions);
        return;
      case "worktreeResumeHere":
        shell.worktreeResumeHere(surface, msg, actions);
        return;
    }
  }

  /**
   * Read what one row's session delegated — at most once per row per session.
   *
   * The request's entry id is an expected-version token, never an argument: the
   * read uses the published row's OWN id, so a stale or forged one reads
   * nothing rather than the wrong transcript (design.md D1). A second request
   * while the first is in flight joins it; one already answered re-reads
   * nothing (D8).
   */
  function requestDelegations(rowId: string, entryId: string): void {
    const reader = options.readDelegations;
    if (!reader || disposed) {
      return;
    }
    const row = publishedRow(rowId);
    const session = row?.entryId;
    if (session === undefined || session !== entryId) {
      return;
    }
    const key = rosterKey(rowId, session);
    if (rosters.has(key) || rosterReads.has(key)) {
      return;
    }
    const read = (async () => {
      let roster: DelegationRoster;
      try {
        roster = await reader(session);
      } catch (err) {
        roster = { kind: "failed", reason: err instanceof Error ? err.message : String(err) };
      }
      if (disposed) {
        return;
      }
      rosterReads.delete(key);
      rosters.set(key, roster);
      commitAndBroadcast();
    })();
    rosterReads.set(key, read);
  }

  /**
   * Freeze the current tree beside the presence that describes it.
   *
   * Refuses when the projection is behind the cache: half an envelope is worse
   * than a late one, and the coordinator is about to produce the other half.
   */
  function commit(): boolean {
    if (projector && projectedVersion !== treeVersion) {
      return false;
    }
    // Ordering is baked into the cache at `assembleRepo` time, from the rank the
    // projector held then. A presence-only projection never re-reads git, so
    // re-applying the rank here is the only thing that moves a worktree which
    // just gained — or just lost — an agent (design.md D8). Asked of the
    // projector rather than assumed: the 5-second poll is the caller, and the
    // poll that moved nothing is the common case (.reviews/round-2.md W2).
    const revision = projector?.rankRevision();
    if (revision !== undefined && revision !== appliedRankRevision) {
      cache.reorder(discoveryDeps.rank);
      appliedRankRevision = revision;
    }
    published = { tree: cache.read(), presence: withDelegations(presence()) };
    return true;
  }

  function worktreeIds(): string[] {
    return cache.read().repos.flatMap((repo) => repo.worktrees.map((worktree) => worktree.id));
  }

  /**
   * Project once, committing only if the tree it read is still the tree we hold.
   *
   * A projection that raced a rebuild is not discarded — it is marked for a
   * re-run. Dropping it is how a pane transition disappears until some later,
   * unrelated evidence event happens to trigger another projection.
   */
  async function projectOnce(externalOnly: boolean): Promise<void> {
    if (!projector || disposed) {
      return;
    }
    const at = treeVersion;
    // Read at call time, not captured: a rail can open or collapse while a
    // projection is in flight, and the NEXT pass is the one that should react.
    const enrich = anyDrawingRows();
    const next = await projector.project(worktreeIds(), { external: externalOnly, enrich });
    if (disposed) {
      return;
    }
    if (treeVersion !== at) {
      projectionDirty = true;
      return;
    }
    projected = next;
    projectedVersion = at;
    // Remembered so a surface promoted to rows can tell whether what is
    // published is worth redoing (round-2 W1).
    projectedEnriched = enrich;
  }

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
  function requestProjection(request: ProjectionRequest = {}): Promise<void> {
    if (disposed) {
      return Promise.resolve();
    }
    if (!projector) {
      // No projection to wait for; the tree is the whole envelope.
      commitAndBroadcast();
      return Promise.resolve();
    }
    if (projectionRun) {
      if (request.join === true) {
        // The poll wants an envelope, not fresh pane work. Dirtying the run in
        // flight would buy a second projection to answer a scan the first one
        // is already performing.
        return projectionRun;
      }
      // Everything else carries pane evidence, and the run in flight may be an
      // external-only pass that is skipping exactly those panes.
      projectionDirty = true;
      // New pane evidence: the re-run has to look at the panes.
      nextExternalOnly = false;
      return projectionRun;
    }
    nextExternalOnly = request.external === true;
    const run = (async () => {
      let clean = true;
      let applied = paneEvidenceApplied;
      // Remembered so a run whose projection REJECTS can put back what its passes
      // took. A pass that threw left `projectedEnriched` holding what the
      // cut-short pass requested, so an un-restored obligation reads as satisfied
      // and the missing line waits for the next external scan (D1a).
      let discharged = false;
      try {
        do {
          projectionDirty = false;
          const externalOnly = nextExternalOnly;
          nextExternalOnly = false;
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
          if (anyDrawingRows()) {
            enrichmentPending = false;
            discharged = true;
          }
          // Captured BEFORE the pass reads the panes, so an event arriving
          // during it stays outstanding. The failure this chooses is one
          // redundant full pass; the other choice loses the transition (D11).
          const evidenceAt = paneEvidence;
          await projectOnce(externalOnly);
          // Captured BEFORE the enrichment obligation below can touch it. Dirty
          // means this pass was INVALIDATED — by a tree that moved under it, or
          // by pane evidence that arrived after it read the panes — and that is
          // a different claim from "run again", which is what enrichment wants.
          const wasInvalidated = projectionDirty;
          // Dirty means this pass was invalidated. Either way it applied
          // nothing. Defence in depth today: a dirty iteration always forces a
          // FULL rerun, whose own capture is at least this one, so no test can
          // reach it. It is what keeps D11 true if that ever stops holding.
          if (!externalOnly && !wasInvalidated) {
            applied = Math.max(applied, evidenceAt);
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
          if (!wasInvalidated && enrichmentOwed()) {
            projectionDirty = true;
            nextExternalOnly = true;
          }
        } while (projectionDirty && !disposed);
      } catch (err) {
        clean = false;
        if (discharged) {
          enrichmentPending = true;
        }
        console.warn(`${LOG_PREFIX} presence projection threw — nothing published`, err);
      }
      // Cleared and published with no await between, so a caller arriving now
      // either joined this cycle already or starts the next one — it cannot
      // mark a cycle dirty that has stopped looking.
      projectionRun = undefined;
      if (clean) {
        paneEvidenceApplied = Math.max(paneEvidenceApplied, applied);
      }
      if (disposed) {
        return;
      }
      if (clean) {
        commitAndBroadcast();
      } else if (projectionDirty) {
        // Someone joined the run that failed. Their work is not done just
        // because this promise resolved, so it is re-run rather than dropped
        // (.reviews/round-3.md W5).
        void requestProjection();
      }
    })();
    projectionRun = run;
    return run;
  }

  /**
   * The one publication point.
   *
   * Callers request work; they never attach a broadcast to it. Two of them
   * joining one cycle used to publish its single result twice — single-flight
   * projection is not single-flight publication (.reviews/round-2.md W3).
   */
  /**
   * Make sure an envelope will exist, without asking for fresh work.
   *
   * A caller that only wants to be served is not a caller with new evidence:
   * routing it through `requestProjection` would dirty the run already in
   * flight and buy a second projection to answer a cached request.
   */
  function ensureProjection(): void {
    if (!projectionRun) {
      void requestProjection();
    }
  }

  function commitAndBroadcast(): void {
    if (commit()) {
      broadcast();
    }
  }

  /**
   * Arm or clear the scan against one window-level fact: is any attached surface
   * showing the view right now?
   *
   * Read live rather than from `state.showing`, which stays false after a post
   * that was skipped or threw and so is not a safe predicate for this.
   */
  function reconcileScan(): void {
    const wanted = !disposed && projector !== undefined && anyShowing();
    if (wanted === (scanHandle !== undefined)) {
      return;
    }
    if (!wanted) {
      cancelCap(scanHandle);
      scanHandle = undefined;
      return;
    }
    armScan();
  }

  function anyShowing(): boolean {
    for (const state of surfaces.values()) {
      if (state.visible && state.displayed) {
        return true;
      }
    }
    return false;
  }

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
  function anyDrawingRows(): boolean {
    for (const state of surfaces.values()) {
      if (state.visible && state.displayed && state.level === "rows") {
        return true;
      }
    }
    return false;
  }

  /**
   * Is this window drawing rows against an envelope that was built WITHOUT
   * enrichment?
   *
   * The one join of those two facts. `anyDrawingRows()` alone is not the
   * question — a drawing window whose envelope is already enriched is owed
   * nothing — and spelling the conjunction inline at each site is how it came to
   * be checked at one boundary and missed at two (design.md D1).
   */
  function enrichmentOwed(): boolean {
    return anyDrawingRows() && (!projectedEnriched || enrichmentPending);
  }

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
  function reconcileRowDrawing(): void {
    // The falling direction, which had no owner anywhere: the projector's turn
    // order holds exactly the ids being drawn, and the only thing that
    // reconciles it is an enriched projection — which is exactly what stops
    // arriving once nothing is drawing rows. Left unsaid, the order survives
    // hide, detach and the drop to presence-only, and a reopened window grants
    // by pre-hide position (round-4 B1, design.md D10).
    if (!anyDrawingRows()) {
      projector?.forgetDrawOrder();
      // Only while a projection is in flight: that is the pass whose preview half
      // the projector's fence skips. A falling edge with none running skips
      // nothing, and recording here unconditionally is what moved 19 cases — this
      // reconcile is deliberately a state settle, so it runs on EVERY mutation
      // while nothing draws (D2). The edge records; the rise spends it.
      if (projectionRun !== undefined) {
        enrichmentPending = true;
      }
      return;
    }
    if (enrichmentOwed()) {
      void requestProjection({ external: true, join: true });
    }
  }

  function armScan(): void {
    scanHandle = arm(() => {
      scanHandle = undefined;
      // A pending cap means pane evidence is waiting to be projected. Absorbing
      // it is only honest if this projection actually looks at the panes — the
      // external-only pass is precisely the one that does not, so absorbing into
      // it would drop that evidence for good (.reviews/round-1.md B1).
      if (capHandle !== undefined) {
        cancelCap(capHandle);
        capHandle = undefined;
      }
      void requestProjection(paneEvidence !== paneEvidenceApplied ? {} : { external: true, join: true });
      reconcileScan();
    }, EXTERNAL_SCAN_INTERVAL_MS);
  }

  function onPaneChange(): void {
    // Nothing to attribute a pane to yet; the first build projects for itself.
    if (disposed || !projector || !built) {
      return;
    }
    paneEvidence += 1;
    if (capHandle !== undefined) {
      return;
    }
    capHandle = armCap(() => {
      capHandle = undefined;
      void requestProjection();
    });
  }

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
    return published !== undefined || !projector;
  }

  function currentMessage(): ExtensionToWebViewMessage {
    // Never the live cache: an uncommitted tree has no presence to pair with.
    const envelope = published ?? { tree: cache.read(), presence: presence() };
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

  /**
   * Bring the watch set in line with the repositories the cache now holds. An
   * already-watched repository keeps its subscriptions, so neither a rebuild
   * nor a second surface creates another watcher.
   */
  function reconcileWatches(): void {
    const wanted = new Set(cache.roots().map((root) => root.repoId));
    for (const [repoId, watch] of watches) {
      if (!wanted.has(repoId)) {
        watch.dispose();
        watches.delete(repoId);
      }
    }
    for (const repoId of wanted) {
      if (!watches.has(repoId)) {
        watches.set(
          repoId,
          watchRepoStructure(repoId, options.pool, () => {
            // `signal`: git state moved, so a rebuild already running cannot
            // answer this one — it may have read git before the move.
            void gate.request(repoId, { signal: true });
          }),
        );
      }
    }
    for (const [repoId, watch] of watches) {
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
      cache.markUnwatched(repoId, reason);
      // A cache write is a tree move, wherever it comes from. Delivery waits
      // for the projection that describes it.
      treeVersion += 1;
    }
  }

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

  /** The repo record holding `worktreeId`, paired with the worktree itself. */
  function locate(worktreeId: string): { repo: WorktreeRepo; wt: WorktreeInfo } | null {
    for (const repo of cache.read().repos) {
      const wt = repo.worktrees.find((w) => w.id === worktreeId);
      if (wt) {
        return { repo, wt };
      }
    }
    return null;
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
      if (capHandle !== undefined) {
        cancelCap(capHandle);
        capHandle = undefined;
      }
      if (scanHandle !== undefined) {
        cancelCap(scanHandle);
        scanHandle = undefined;
      }
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
