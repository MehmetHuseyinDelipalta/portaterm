// src/providers/worktreeHost/actions/create/defaultsArm.ts — What a freshly
// opened create form is told, and the branch enumeration it rides.
//
// Extracted from `createCreateActions` by change `decompose-worktree-host`
// (design.md D1, task 2_17). Both arms answer the same question from opposite
// ends: `requestWorktreeCreateDefaults` MINTS the opening — its token, its
// provisioning offer, its migration offer — and `requestWorktreeRefs` refreshes
// the enumeration that opening rides. They share the opening record, the offer
// slots keyed by it, and the rule about which ask is still the live one.

import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { ExtensionToWebViewMessage, ProvisionModel, WorktreeActionMessage } from "../../../../types/messages";
import type { MigrationRepositoryBinding } from "../../../../worktree/migrateChanges";
import type { WorktreeRepo } from "../../../../worktree/types";
import type { createWorktreeCache } from "../../../../worktree/WorktreeCache";
import type { WorktreeHostOptions } from "../../../WorktreeHost";
import type { MigrationOffer, Opening, WorktreeSurface } from "../../hostTypes";
import { namedOpening } from "../../messageGuards";
import type { OpeningLifecycle } from "../../openingLifecycle";

/** What answering a freshly opened form needs from the host. */
export interface DefaultsDeps {
  readonly cache: ReturnType<typeof createWorktreeCache>;
  readonly lifecycle: OpeningLifecycle;
  readonly openings: Map<string, Opening>;
  readonly migrationOffers: Map<string, MigrationOffer>;
  readonly migrationReading: Map<
    string,
    { sequence: number; repoId: string; sourceWorktreeId: string; sourceGeneration: number }
  >;
  readonly provisionBaseline: Map<string, string>;
  readonly provisionReading: Map<string, number>;
  readonly options: WorktreeHostOptions;
  bumpMigrationSequence(): number;
  currentMigrationRegistration(repoId: string): MigrationRepositoryBinding["registration"] | undefined;
  deliver(surface: WorktreeSurface, message: ExtensionToWebViewMessage): boolean;
  disposed(): boolean;
  hasSurface(surface: WorktreeSurface): boolean;
  issueWithAdded(
    offerKey: { surface: string; repoId: string },
    slot: string,
    model: ProvisionModel,
  ): { readonly offerId: string; readonly model: ProvisionModel };
  openingKey(s: WorktreeSurface, repoId: string): string;
  previewProvisioning(repo: WorktreeRepo, model: ProvisionModel): Promise<ProvisionModel>;
  resolveDestination(
    repo: WorktreeRepo,
    branch: string,
    override?: string,
    chosen?: string,
  ): { root: string; base: string; bare: string; freePath: string };
  retireOpening(key: string): void;
  surfaceKey(s: WorktreeSurface): string;
}

/**
 * Read the source worktree this form was opened from and, if it holds work,
 * offer to carry it over.
 *
 * Only on an OPENING ask: a keystroke is not a new source. The read is slotted
 * by opening so a duplicate joins rather than starting a second, and everything
 * it proved is re-proved after the await — the surface, the opening, the
 * registration and the source row — before an offer is minted.
 */
function offerMigration(
  deps: DefaultsDeps,
  surface: WorktreeSurface,
  msg: Extract<WorktreeActionMessage, { type: "requestWorktreeCreateDefaults" }>,
  repo: WorktreeRepo,
  key: string,
): void {
  if (
    msg.sourceWorktreeId !== undefined &&
    Number.isSafeInteger(msg.sourceGeneration) &&
    (msg.sourceGeneration as number) > 0 &&
    deps.options.probeMigrationSource !== undefined
  ) {
    const slot = `${key}::${msg.opening}`;
    const reading = deps.migrationReading.get(slot);
    if (reading === undefined) {
      const sourceGeneration = msg.sourceGeneration as number;
      const mine = {
        sequence: deps.bumpMigrationSequence(),
        repoId: msg.repoId,
        sourceWorktreeId: msg.sourceWorktreeId,
        sourceGeneration,
      };
      deps.migrationReading.set(slot, mine);
      const source = repo.worktrees.find(
        (row) => row.id === msg.sourceWorktreeId && !row.bare && !row.missing && !row.prunable,
      );
      const registration = deps.cache.registrationFor(msg.repoId, sourceGeneration);
      if (source !== undefined && registration !== undefined) {
        const sourcePath = source.id;
        const binding = { registration, sourceKind: source.kind };
        void deps.options
          .probeMigrationSource(sourcePath, binding)
          .then((evidence) => {
            const currentReading = deps.migrationReading.get(slot);
            const currentSource = deps.cache
              .read()
              .repos.find((candidate) => candidate.repoId === msg.repoId)
              ?.worktrees.find(
                (row) => row.id === source.id && row.kind === source.kind && !row.bare && !row.missing && !row.prunable,
              );
            if (
              deps.disposed() ||
              !deps.hasSurface(surface) ||
              !deps.lifecycle.isLive(key, msg.opening) ||
              currentReading?.sequence !== mine.sequence ||
              currentReading.sourceWorktreeId !== mine.sourceWorktreeId ||
              currentReading.sourceGeneration !== mine.sourceGeneration ||
              !isDeepStrictEqual(deps.currentMigrationRegistration(msg.repoId), registration) ||
              currentSource === undefined ||
              evidence === undefined ||
              !Number.isSafeInteger(evidence.snapshot.count) ||
              evidence.snapshot.count <= 0
            ) {
              return;
            }
            const offerId = (deps.options.migrationOfferId ?? randomUUID)();
            if (deps.migrationOffers.has(offerId)) {
              return;
            }
            deps.migrationOffers.set(offerId, {
              surface: key,
              opening: msg.opening,
              repoId: msg.repoId,
              sourceWorktreeId: source.id,
              sourcePath,
              binding,
              evidence,
            });
            deps.deliver(surface, {
              type: "worktreeMigrationOffer",
              repoId: msg.repoId,
              opening: msg.opening,
              sourceWorktreeId: source.id,
              offerId,
              count: evidence.snapshot.count,
            });
          })
          .catch(() => {});
      }
    }
  }
}

/**
 * Read this repository's provisioning declaration and offer the model it
 * describes.
 *
 * Resolved ONCE per form, not per keystroke: a fresh offer each time would
 * churn ids under a dialog the user has not stopped looking at, and superseding
 * evicts, so a submission mid-type would name nothing (§ 4.0).
 */
function offerProvisioning(
  deps: DefaultsDeps,
  surface: WorktreeSurface,
  msg: Extract<WorktreeActionMessage, { type: "requestWorktreeCreateDefaults" }>,
  repo: WorktreeRepo,
  key: string,
  offerKey: { surface: string; repoId: string },
  reading: string,
  opening: boolean,
): void {
  // A DIFFERENT opening supersedes: it starts its own read and retires the
  // previous one's right to publish. A repeat of the one already reading
  // JOINS it — starting a second would let a duplicated message suppress
  // the legitimate answer and grow reads without bound (D4). Only the READ
  // joins: the destination reply below is cheap and idempotent, and
  // withholding it would make a duplicate message cost the form its
  // destination.
  const joins = deps.provisionReading.get(reading) === msg.opening;
  if (deps.options.readProvisioning && opening && !joins) {
    const mine = msg.opening;
    deps.provisionReading.set(reading, mine);
    void deps.options
      .readProvisioning(repo.mainPath)
      .then(async (model) => {
        // The surface may have detached while the file was being read. A
        // post to a dead surface is at best wasted and at worst revives an
        // offer the detach was supposed to forget (B6).
        if (deps.disposed() || !deps.hasSurface(surface)) {
          return;
        }
        // A later opening already took over this form. Its own read is in
        // flight or answered, and this model describes a form the user has
        // closed.
        // Both records, not just the read slot. The slot is per
        // repository and the opening is per surface, so the slot alone
        // could not see an opening superseded through a DIFFERENT
        // repository — that read kept its slot and published for a form
        // that no longer existed (.reviews/round-1.md B2).
        //
        // The supersede path now sweeps those slots as well, so either
        // half alone would refuse this. That is deliberate and each is
        // stated separately: the sweep bounds the map, and this states
        // the actual invariant — publish only for the opening still being
        // served. Mutating either alone is therefore NOT caught by the
        // suite; mutating both is.
        if (deps.provisionReading.get(reading) !== mine || !deps.lifecycle.isLive(key, mine)) {
          return;
        }
        // The source this opening starts on, recorded once, from the first
        // offer it is given. A later offer is a source the user chose or a
        // save's own re-read, and neither is where the form began
        // (design.md D18).
        const start = `${key} ${msg.repoId} ${msg.opening}`;
        if (!deps.provisionBaseline.has(start)) {
          deps.provisionBaseline.set(start, model.providers.find((p) => p.active)?.id ?? "");
        }
        const previewed = await deps.previewProvisioning(repo, model);
        if (
          deps.disposed() ||
          !deps.hasSurface(surface) ||
          deps.provisionReading.get(reading) !== mine ||
          !deps.lifecycle.isLive(key, mine)
        ) {
          return;
        }
        const offer = deps.issueWithAdded(offerKey, start, previewed);
        deps.deliver(surface, {
          type: "worktreeProvisionOffer",
          repoId: msg.repoId,
          opening: msg.opening,
          offerId: offer.offerId,
          model: offer.model,
        });
      })
      // The section is not the create. A provider layer that cannot
      // answer must not delay or refuse the destination the form needs.
      //
      // Clearing the marker is the FAILURE path's job, and only its job.
      // It used to run in a `finally`, so a read that succeeded released
      // the slot too — which bounded concurrent duplicates and nothing
      // else: a repeat delivered after the read settled found no marker,
      // read again, and rotated the offer under a dialog the user had not
      // stopped looking at (.reviews/round-1.md B4). A successful read's
      // marker is now released by retirement — close, supersede or detach.
      //
      // A FAILED read is different, and D4 says so: the marker records
      // that a read succeeded, not that one was attempted. Held through a
      // failure it would cost the user the provisioning section for the
      // life of the form, with no way back but closing and reopening it.
      //
      // Only the generation that still owns the slot clears it — a
      // superseded read failing late must not unlock the live one.
      .catch(() => {
        if (deps.provisionReading.get(reading) === mine) {
          deps.provisionReading.delete(reading);
        }
      });
  }
}

export function handleCreateDefaults(
  deps: DefaultsDeps,
  surface: WorktreeSurface,
  msg: Extract<WorktreeActionMessage, { type: "requestWorktreeCreateDefaults" }>,
): void {
  // Answered by the HOST because only it knows the configured root, the
  // repo's own layout, and which candidates are free. A panel-computed
  // path would state a destination the create might refuse.
  //
  // Before the repository read and before the destination is resolved:
  // work done for a message the host will refuse anyway is work an
  // untrusted sender chose (round-1 B1).
  if (!namedOpening(msg.opening)) {
    return;
  }
  const repo = deps.cache.read().repos.find((r) => r.repoId === msg.repoId);
  if (repo === undefined) {
    return;
  }
  // The repo's own name is the base a branch is appended to, so the form's
  // placeholder and the destination it opens on describe one scheme. With
  // a branch, the base is what the form would have shown for it — the
  // host resolves the collision on THAT, not on the bare default. Through
  // the SAME resolver the probe answers with, so the destination the
  // resolution names and the one this reply names cannot drift (W4).
  const { root, base, bare, freePath: path } = deps.resolveDestination(repo, msg.branch ?? "");
  // Resolved ONCE per form, not per keystroke. This message is re-sent
  // as the user types a branch, and a fresh offer each time would churn
  // ids under a dialog the user has not stopped looking at — and
  // superseding evicts, so a submission mid-type would name nothing.
  // § 4.0's rule is that the host keeps the model it displayed.
  //
  // A branch-less ask is a form OPENING; an ask carrying one is the user
  // typing in a form already open. That distinction already exists on this
  // path — the webview relies on it to tell a superseded ask's leftovers
  // from a current answer — so it is what decides when to resolve a fresh
  // model, and no new message is needed to learn that a form closed.
  const opening = msg.branch === undefined;
  const offerKey = { surface: deps.surfaceKey(surface), repoId: msg.repoId };
  const reading = `${offerKey.surface} ${msg.repoId}`;
  const key = deps.surfaceKey(surface);
  // Synchronously, before anything awaits. An opening ask ADOPTS the
  // opening the panel named; any other request must already be riding one
  // this surface holds, or it is answered with nothing — a retired or
  // never-seen opening has no authority to spend (D2).
  if (opening) {
    // An opening ask may only REPEAT the one being served or ADVANCE past
    // everything this surface has ever named. Anything else is a replay of
    // a spent form or a delayed predecessor, and adopting either put the
    // host back onto a conversation the user had already ended (B1).
    const admission = deps.lifecycle.admitOpen(key, msg.opening);
    if (!admission.admitted) {
      return;
    }
    // A DIFFERENT opening retires the last one whole — every read slot it
    // holds and every offer it issued, not just the ones this new opening
    // happens to re-ask about. Rewriting only the slots it touches left a
    // read for another repository still holding its predecessor, and that
    // read published an offer for a form that no longer existed.
    if (admission.supersedes) {
      deps.retireOpening(key);
    }
    deps.lifecycle.markOpen(key, msg.opening);
  } else if (!deps.lifecycle.isLive(key, msg.opening)) {
    return;
  }
  if (opening) {
    offerMigration(deps, surface, msg, repo, key);
  }
  offerProvisioning(deps, surface, msg, repo, key, offerKey, reading, opening);
  surface.post({
    type: "worktreeCreateDefaults",
    repoId: msg.repoId,
    opening: msg.opening,
    root,
    prefix: repo.label,
    path,
    // The branch this answer is FOR. Replies race the typing that caused
    // them, and a form cannot tell a current answer from a stale one
    // without it (round-4 B12).
    ...(msg.branch === undefined ? {} : { branch: msg.branch }),
    // The taken NAME, never the path to it. The destination line the form
    // draws above this already carries the path, and stating it a second
    // time is what WT-009.3's acceptance forbids (worktree-rpc.md § 2).
    // `base` is exactly that name: `bare` is `join(root, base)`, because
    // the predicate it was resolved with never reports a collision.
    ...(path === bare ? {} : { collidedWith: base }),
  });
  return;
}
