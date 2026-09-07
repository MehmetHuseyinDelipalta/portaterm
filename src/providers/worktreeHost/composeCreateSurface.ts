// src/providers/worktreeHost/composeCreateSurface.ts — Everything the create
// conversation owns, wired once.
//
// Extracted from `createWorktreeHost` by change `decompose-worktree-host`
// (task 2_20). D1 kept the wiring in the composition root, and after twelve
// cuts that root was still 626 lines: each extracted module costs the root a
// `createXxx({...})` call the design's arithmetic did not carry.
//
// The seam is not size. These are the maps, the offer store, the opening
// registry and the two action groups that NO other cluster reads — a create
// form's whole conversation, from the offer it is shown to the worktree it
// submits — and every one of them is keyed by an opening the panel named.
//
// The root's own late values arrive as functions: the delivery gate and the
// router are built AFTER this module, and a create arm only reaches them when
// a message lands, which is always after construction.

import type { ExtensionToWebViewMessage } from "../../types/messages";
import type { MigrationOfferEvidence, MigrationRepositoryBinding } from "../../worktree/migrateChanges";
import { createProvisionOfferStore } from "../../worktree/provisioning/offerStore";
import { createCreateActions } from "./actions/create";
import { createProvisionActions } from "./actions/provision";
import { createDestinationResolve } from "./destinationResolve";
import type { WorktreeHostOptions } from "./hostOptions";
import type { WorktreeSurface } from "./hostTypes";
import { createOpeningLifecycle } from "./openingLifecycle";
import { createOpeningRegistry } from "./openingRegistry";
import { ADDED_COPY_SOURCE, createProvisionOffers, MAX_ADDED_COPY_FILES, MAX_ADDED_STEPS } from "./provisionOffers";

export interface CreateSurfaceDeps {
  cache: ReturnType<typeof import("../../worktree/WorktreeCache").createWorktreeCache>;
  options: WorktreeHostOptions;
  /** The attached surfaces, by reference: the root keeps writing to it. */
  surfaces: Map<WorktreeSurface, unknown>;
  disposed(): boolean;
  /** Delivery, the router's `perform`, and three lookups — all built later. */
  deliver(surface: WorktreeSurface, message: ExtensionToWebViewMessage): boolean;
  perform(run: () => Promise<void>): void;
  actionPath(worktreeId: string, allowMissing: boolean): string | undefined;
  admissibleLaunch(surface: WorktreeSurface, fields: unknown): boolean;
  repoIdOf(worktreeId: string): string | undefined;
}

export function createCreateSurface(deps: CreateSurfaceDeps) {
  /**
   * The provisioning models this host has shown, and a stable name per surface
   * to key them by.
   *
   * The store itself is keyed by string rather than by surface so its own suite
   * needs no surface; the identity mapping lives here, where deps.surfaces do. A
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
  } = createProvisionOffers({ cache: deps.cache, offers, options: deps.options });
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
      attachedSurfaces: () => deps.surfaces.keys(),
    });

  /**
   * Where a create for this branch would go, and what it stepped over.
   *
   * ONE derivation for both answers. The probe and `worktreeCreateDefaults`
   * each derived root, taken paths, slug, base and free suffix separately, so
   * the destination the resolution named and the one the defaults reply named
   * could drift apart (round-1 W4).
   */
  const { vettedOverride, resolveDestination } = createDestinationResolve(deps.options);

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
    cache: deps.cache,
    options: deps.options,
    deliver: (surface, message) => deps.deliver(surface, message),
    disposed: deps.disposed,
    hasSurface: (surface) => deps.surfaces.has(surface),
    surfaceKey,
    previewProvisioning,
    withAdded,
    withoutAdded,
    privateIdsFor,
    issueWithAdded,
    roomForOneMoreSetup,
  });

  const create = createCreateActions({
    cache: deps.cache,
    lifecycle,
    openings,
    migrationOffers,
    migrationReading,
    offers,
    provisionBaseline,
    provisionReading,
    options: deps.options,
    hasSurface: (surface) => deps.surfaces.has(surface),
    actionPath: deps.actionPath,
    admissibleLaunch: deps.admissibleLaunch,
    currentMigrationRegistration,
    deliver: (surface, message) => deps.deliver(surface, message),
    disposed: deps.disposed,
    bumpMigrationSequence,
    issueWithAdded,
    openingFor,
    openingKey,
    perform: deps.perform,
    previewProvisioning,
    repoIdOf: deps.repoIdOf,
    resolveDestination,
    retireOpening,
    surfaceKey,
    vettedOverride,
  });
  return {
    openings,
    surfaceKey,
    openingKey,
    openingFor,
    retireOpening,
    forgetSurfaceOpenings,
    forgetDepartedRepos,
    currentMigrationRegistration,
    provision,
    create,
  };
}
