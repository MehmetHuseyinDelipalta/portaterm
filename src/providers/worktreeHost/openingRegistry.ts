// src/providers/worktreeHost/openingRegistry.ts — Which surface asked, which
// opening of which repository the question belonged to, and everything that
// gets dropped when one of those goes away.
//
// Extracted from `createWorktreeHost` by change `decompose-worktree-host`
// (design.md D1, task 2_7). The key format `surface\0repoId` and the two sweeps
// that parse it sat 150 lines apart, so retiring an opening and retiring a
// departed repository could disagree about what a slot key means without
// anything failing.
//
// The slot maps themselves belong to the provisioning cluster (task 2_8) and
// arrive as deps, narrowed to the operations these sweeps actually perform —
// prefix scan and delete — so a map this module must not read cannot be read.

import type { Opening, WorktreeSurface } from "./hostTypes";
import type { createOpeningLifecycle } from "./openingLifecycle";

/** A keyed slot map, narrowed to the prefix sweep these routines perform. */
export interface SweptSlots {
  keys(): Iterable<string>;
  delete(key: string): boolean;
}

/** The same, where the sweep also has to dispose what the slot holds. */
export interface SweptCopyFiles extends SweptSlots {
  get(key: string): readonly { file: { dispose(): void } }[] | undefined;
}

export interface OpeningRegistryDeps {
  lifecycle: ReturnType<typeof createOpeningLifecycle>;
  /** The provisioning offer store, forgotten per surface and per repository. */
  offers: {
    forgetSurface(key: string): void;
    forget(offerKey: { surface: string; repoId: string }): void;
  };
  provisionReading: SweptSlots;
  provisionSwitch: SweptSlots;
  provisionBaseline: SweptSlots;
  addedSteps: SweptSlots;
  addedCopyFiles: SweptCopyFiles;
  migrationReading: SweptSlots & { get(key: string): { repoId: string } | undefined };
  migrationOffers: SweptSlots &
    Iterable<[string, { surface: string; repoId: string }]> & {
      get(key: string): { repoId: string } | undefined;
    };
  /** The surfaces currently attached, for the per-repository offer sweep. */
  attachedSurfaces(): Iterable<WorktreeSurface>;
}

export interface OpeningRegistry {
  /**
   * The branch enumeration each repository's open dialog is riding.
   *
   * Bounded by the number of repositories in the workspace, and each entry is
   * replaced rather than accumulated: a repository has one open create dialog
   * at a time, and its latest ask is the only one anything reads.
   *
   * Exposed as the map because the create actions write it; the KEY FORMAT is
   * this module's, and both sweeps that parse it live here.
   */
  readonly openings: Map<string, Opening>;

  /** This host's stable name for one surface, minted on first sight. */
  surfaceKey(s: WorktreeSurface): string;

  /**
   * One enumeration belongs to one surface's one opening of one repository.
   *
   * Keyed by repository alone, a second attached surface's `requestWorktreeRefs`
   * replaced the promise the first surface's probe was about to consume, so a
   * dialog could classify against an enumeration it was never shown (round-1 W2).
   */
  openingKey(s: WorktreeSurface, repoId: string): string;

  /** The opening this message belongs to, or nothing if a newer one replaced it. */
  openingFor(s: WorktreeSurface, repoId: string, token: number): Opening | undefined;

  /**
   * Everything one surface's create form holds, dropped together.
   *
   * Close, supersede and detach are the same event told three ways, and having
   * only `worktreeCreateClosed` do the sweep left the other two leaking: a
   * supersede retired only the read slots the new opening happened to re-ask
   * about, and a detach retired nothing at all (round-1 B2, W1).
   */
  retireOpening(key: string): void;

  /** Drop a surface's opening history too. Only detach may do this. */
  forgetSurfaceOpenings(key: string): void;

  /** Retire every per-repository form capability the rebuilt tree no longer carries. */
  forgetDepartedRepos(departed: ReadonlySet<string>): void;
}

/**
 * Everything one surface's create form holds, dropped together (round-1 B2, W1).
 */
/** Drop every slot the predicate names. */
function sweep(slots: SweptSlots, drop: (slot: string) => boolean): void {
  for (const slot of [...slots.keys()]) {
    if (drop(slot)) {
      slots.delete(slot);
    }
  }
}

/**
 * The same, disposing what each dropped slot holds. Copy files are the only
 * slot whose value owns an OS handle, so it is the only sweep that can leak.
 */
function sweepCopyFiles(slots: SweptCopyFiles, drop: (slot: string) => boolean): void {
  for (const slot of [...slots.keys()]) {
    if (!drop(slot)) {
      continue;
    }
    for (const added of slots.get(slot) ?? []) {
      added.file.dispose();
    }
    slots.delete(slot);
  }
}

function retireOpening(deps: OpeningRegistryDeps, openings: Map<string, Opening>, key: string): void {
  deps.lifecycle.close(key);
  const reading = `${key} `;
  const owned = (slot: string): boolean => slot.startsWith(reading);
  sweep(deps.provisionReading, owned);
  sweep(deps.provisionSwitch, owned);
  sweep(deps.provisionBaseline, owned);
  sweep(deps.addedSteps, owned);
  sweepCopyFiles(deps.addedCopyFiles, owned);
  deps.offers.forgetSurface(key);
  const migrationPrefix = `${key}::`;
  sweep(deps.migrationReading, (slot) => slot.startsWith(migrationPrefix));
  for (const [offerId, offer] of deps.migrationOffers) {
    if (offer.surface === key) {
      deps.migrationOffers.delete(offerId);
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
  sweep(openings, (slot) => slot.startsWith(enumerated));
}

function forgetDepartedRepos(
  deps: OpeningRegistryDeps,
  openings: Map<string, Opening>,
  surfaceKeys: WeakMap<WorktreeSurface, string>,
  departed: ReadonlySet<string>,
): void {
  if (departed.size === 0) {
    return;
  }
  const repositoryOfProvisionSlot = (slot: string): string | undefined => {
    const surfaceAt = slot.indexOf(" ");
    const openingAt = slot.lastIndexOf(" ");
    return surfaceAt >= 0 && openingAt > surfaceAt ? slot.slice(surfaceAt + 1, openingAt) : undefined;
  };
  const gone = (slot: string): boolean => departed.has(repositoryOfProvisionSlot(slot) ?? "");
  // `provisionReading` is keyed by surface and repository with no opening, so
  // the repository is everything after the first separator — not the middle
  // field the other four carry.
  sweep(deps.provisionReading, (slot) => {
    const surfaceAt = slot.indexOf(" ");
    return surfaceAt >= 0 && departed.has(slot.slice(surfaceAt + 1));
  });
  sweep(deps.provisionSwitch, gone);
  sweep(deps.provisionBaseline, gone);
  sweep(deps.addedSteps, gone);
  sweepCopyFiles(deps.addedCopyFiles, gone);
  sweep(openings, (key) => {
    const repoAt = key.indexOf("\u0000");
    return repoAt >= 0 && departed.has(key.slice(repoAt + 1));
  });
  sweep(deps.migrationReading, (slot) => departed.has(deps.migrationReading.get(slot)?.repoId ?? ""));
  sweep(deps.migrationOffers, (offerId) => departed.has(deps.migrationOffers.get(offerId)?.repoId ?? ""));
  for (const surface of deps.attachedSurfaces()) {
    const key = surfaceKeys.get(surface);
    if (key === undefined) {
      continue;
    }
    for (const repoId of departed) {
      deps.offers.forget({ surface: key, repoId });
    }
  }
}

export function createOpeningRegistry(deps: OpeningRegistryDeps): OpeningRegistry {
  const openings = new Map<string, Opening>();
  const surfaceKeys = new WeakMap<WorktreeSurface, string>();
  let surfaceSeq = 0;

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

  const openingKey = (s: WorktreeSurface, repoId: string): string => `${surfaceKey(s)}\u0000${repoId}`;

  return {
    openings,
    surfaceKey,
    openingKey,

    retireOpening(key) {
      retireOpening(deps, openings, key);
    },

    openingFor(s, repoId, token) {
      const held = openings.get(openingKey(s, repoId));
      return held?.token === token ? held : undefined;
    },

    forgetSurfaceOpenings(key) {
      retireOpening(deps, openings, key);
      deps.lifecycle.detach(key);
    },

    forgetDepartedRepos(departed) {
      forgetDepartedRepos(deps, openings, surfaceKeys, departed);
    },
  };
}
