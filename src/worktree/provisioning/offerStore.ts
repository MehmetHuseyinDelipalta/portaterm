// src/worktree/provisioning/offerStore.ts — What the user was shown, kept by
// the host (worktree-provisioning.md § 4.0).
//
// The safety property is *nothing executes that the user has not seen*. That is
// only a property of the system if the host keeps the model it displayed and
// executes from THAT — re-reading the provider files after Create is pressed is
// exactly the window an untrusted checked-in file needs.
//
// So the webview gets display material plus an opaque id, and answers with the
// id. This module owns the id → host-held offer map. Nothing here executes anything;
// WT-012.2 is the first redeemer.

import type { ProvisionEntry, ProvisionModel } from "../../types/messages";
import type { HeldProvisionSource } from "./provisionMaterial";

export interface ProvisionOffer {
  readonly offerId: string;
  readonly model: ProvisionModel;
}

export interface RedeemedProvisionOffer extends ProvisionOffer {
  readonly heldFiles: ReadonlyMap<string, HeldProvisionSource>;
}

/**
 * Which form an offer belongs to.
 *
 * A surface and a repository, never a bare string: the surface is the window
 * that was shown the model, and admission has to be able to ask "was THIS
 * surface shown THIS offer" rather than "does this id exist somewhere"
 * (.reviews/round-1.md B3).
 *
 * Kept as a pair and held in nested maps rather than joined into one string.
 * `repoId` is a filesystem path, so any separator chosen for a flat key is a
 * character some repository is entitled to contain.
 */
export interface ProvisionOfferKey {
  readonly surface: string;
  readonly repoId: string;
}

export interface ProvisionOfferStore {
  /**
   * Record a model and mint the id that names it, superseding whatever this key
   * held before.
   *
   * Superseding EVICTS rather than keeping both. Two live offers for one form
   * means a submission can name the older, and the older is by definition the
   * model the user is no longer looking at.
   */
  issue(
    key: ProvisionOfferKey,
    model: ProvisionModel,
    heldFiles?: ReadonlyMap<ProvisionEntry, HeldProvisionSource>,
  ): ProvisionOffer;
  /** The offer this key currently holds, or `undefined` before one is issued. */
  current(key: ProvisionOfferKey): ProvisionOffer | undefined;
  /** The current offer and its host-private reminted held-file associations. */
  redeem(key: ProvisionOfferKey, offerId: string): RedeemedProvisionOffer | undefined;
  /** Drop what one form holds. Its offers can never be submitted again. */
  forget(key: ProvisionOfferKey): void;
  /**
   * Drop everything a surface holds, across every repository.
   *
   * A detached surface takes its offers with it. Without this the store grows
   * with every window that has ever been open, and a read completing after a
   * detach could still publish into it (round-1 B6).
   */
  forgetSurface(surface: string): void;
}

/**
 * Re-mint every selectable id so they are unique within THIS offer.
 *
 * Each adapter mints from its own counter starting at the same value, so two
 * adapters read for one create both produce `i1` and a merged offer would carry
 * an ambiguous id (.reviews/round-2.md W4). `issue` is where that is fixable
 * without guessing anything: it receives the completed model, so it needs no
 * provider registry, no detection order and no merge algorithm — which is what
 * made this look like a later task's job.
 *
 * Ids stay opaque and non-derived. Not a path and not a hash of one: an id that
 * encoded a path would be a path the webview could read back out, and an id from
 * a superseded offer must resolve to nothing rather than name whatever now
 * occupies that slot (worktree-provisioning.md § 4.0).
 */
function remint(
  model: ProvisionModel,
  seq: () => string,
  heldFiles: ReadonlyMap<ProvisionEntry, HeldProvisionSource>,
): { readonly model: ProvisionModel; readonly heldFiles: ReadonlyMap<string, HeldProvisionSource> } {
  const reminted = new Map<string, string>();
  const remintedHeldFiles = new Map<string, HeldProvisionSource>();
  const entries = model.entries.map((e) => {
    const id = seq();
    reminted.set(e.id, id);
    const held = heldFiles.get(e);
    if (held !== undefined) {
      remintedHeldFiles.set(id, held);
    }
    return { ...e, id };
  });
  return {
    model: {
      ...model,
      entries,
      ports: model.ports.map((p) => ({ ...p, id: seq() })),
      setup: model.setup.map((s) => ({ ...s, id: seq() })),
      // Groups name entry ids, and every entry id just changed. Carrying them
      // through untranslated would leave each group pointing at ids nobody holds.
      contenders: model.contenders.map((group) => {
        const translate = (ids: readonly string[]) =>
          ids.flatMap((id) => {
            const next = reminted.get(id);
            return next === undefined ? [] : [next];
          });
        return { members: translate(group.members), natives: translate(group.natives) };
      }),
    },
    heldFiles: remintedHeldFiles,
  };
}

interface StoredProvisionOffer {
  readonly public: ProvisionOffer;
  readonly redeemed: RedeemedProvisionOffer;
}

export function createProvisionOfferStore(): ProvisionOfferStore {
  const bySurface = new Map<string, Map<string, StoredProvisionOffer>>();
  let sequence = 0;
  /** Never restarts, so no two offers from this store share an item id. */
  let itemSequence = 0;

  return {
    issue(key, model, heldFiles = new Map()) {
      let repos = bySurface.get(key.surface);
      if (repos === undefined) {
        repos = new Map();
        bySurface.set(key.surface, repos);
      }
      sequence += 1;
      // Monotonic and never reused, so a resubmission of a superseded id cannot
      // land on a later offer that happens to occupy the same slot. The `set`
      // below evicts the previous offer for this form by construction.
      const reminted = remint(
        model,
        () => {
          itemSequence += 1;
          return `item-${itemSequence}`;
        },
        heldFiles,
      );
      const offer: ProvisionOffer = { offerId: `provision-${sequence}`, model: reminted.model };
      repos.set(key.repoId, {
        public: offer,
        redeemed: { ...offer, heldFiles: reminted.heldFiles },
      });
      return offer;
    },
    current(key) {
      return bySurface.get(key.surface)?.get(key.repoId)?.public;
    },
    redeem(key, offerId) {
      const held = bySurface.get(key.surface)?.get(key.repoId)?.redeemed;
      return held?.offerId === offerId ? held : undefined;
    },
    forget(key) {
      const repos = bySurface.get(key.surface);
      repos?.delete(key.repoId);
      if (repos?.size === 0) {
        bySurface.delete(key.surface);
      }
    },
    forgetSurface(surface) {
      bySurface.delete(surface);
    },
  };
}
