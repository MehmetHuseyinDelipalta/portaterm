// src/providers/worktreeHost/actions/create.ts — Everything the create form asks for.
//
// Extracted from `handleAction` by change `decompose-worktree-host-controller`
// (design.md D1, task 2_4): the eight create arms plus the ten helpers only they
// called. Defaults, refs, probe, destination, debris and the submit itself share
// one opening, one set of maps and one notion of which token is live, which is
// why they cut as a unit rather than one arm at a time.

import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type {
  ExtensionToWebViewMessage,
  ProvisionEntry,
  ProvisionModel,
  ProvisionPort,
  ProvisionSetupStep,
  ResolvedDisposition,
  WorktreeActionMessage,
} from "../../../types/messages";
import type { MigrationOfferEvidence, MigrationRepositoryBinding } from "../../../worktree/migrateChanges";
import type { ProvisionOfferStore } from "../../../worktree/provisioning/offerStore";
import type { HeldProvisionSource } from "../../../worktree/provisioning/provisionMaterial";
import { claimProvisionMaterials, disposeProvisionMaterials } from "../../../worktree/provisioning/provisionMaterial";
import type { PullRequestsRead } from "../../../worktree/repoPullRequests";
import type { WorktreeRepo } from "../../../worktree/types";
import type { createWorktreeCache } from "../../../worktree/WorktreeCache";
import type { WorktreeHostOptions } from "../../WorktreeHost";
import type { Opening, WorktreeActions, WorktreeSurface } from "../hostTypes";
import {
  isKnownAfterCreate,
  isKnownCreateMode,
  isKnownDisposition,
  isKnownMigration,
  isKnownProvision,
  isKnownSetupRetry,
  namedOpening,
} from "../messageGuards";
import type { OpeningLifecycle } from "../openingLifecycle";
import { answerDebrisAuthorization } from "./create/debris";
import { handlePickDestination } from "./create/destinationPick";
import { answerCreateProbe, isWellFormedProbe, matchesPublished } from "./create/probes";

/** One arm, once the dispatcher has proved `actions` is there. */
type Arm<T extends WorktreeActionMessage["type"]> = (
  surface: WorktreeSurface,
  msg: Extract<WorktreeActionMessage, { type: T }>,
  actions: WorktreeActions,
) => void;

/** What one repository's migration offer holds, keyed by its own sequence. */
interface MigrationOffer {
  surface: string;
  opening: number;
  repoId: string;
  sourceWorktreeId: string;
  sourcePath: string;
  binding: MigrationRepositoryBinding;
  evidence: MigrationOfferEvidence;
}

/**
 * What the create arms need from the host.
 *
 * Maps and the offer store cross by REFERENCE — the host keeps writing to them
 * while a form is open, and a copy would freeze this module's view at wiring
 * time (design.md D4, OBL-4). `disposed` and `bumpMigrationSequence` are
 * accessors because a `let` binding cannot be shared through an object field.
 */
export interface CreateDeps {
  readonly cache: ReturnType<typeof createWorktreeCache>;
  readonly lifecycle: OpeningLifecycle;
  readonly openings: Map<string, Opening>;
  readonly migrationOffers: Map<string, MigrationOffer>;
  readonly migrationReading: Map<
    string,
    { sequence: number; repoId: string; sourceWorktreeId: string; sourceGeneration: number }
  >;
  readonly offers: ProvisionOfferStore;
  readonly provisionBaseline: Map<string, string>;
  readonly provisionReading: Map<string, number>;
  readonly options: WorktreeHostOptions;
  hasSurface(surface: WorktreeSurface): boolean;
  actionPath(worktreeId: string, allowMissing: boolean): string | undefined;
  admissibleLaunch(surface: WorktreeSurface, fields: unknown): boolean;
  currentMigrationRegistration(repoId: string): MigrationRepositoryBinding["registration"] | undefined;
  deliver(surface: WorktreeSurface, message: ExtensionToWebViewMessage): boolean;
  disposed(): boolean;
  bumpMigrationSequence(): number;
  issueWithAdded(
    offerKey: { surface: string; repoId: string },
    slot: string,
    model: ProvisionModel,
  ): { readonly offerId: string; readonly model: ProvisionModel };
  openingFor(s: WorktreeSurface, repoId: string, token: number): Opening | undefined;
  openingKey(s: WorktreeSurface, repoId: string): string;
  perform(run: () => Promise<void>): void;
  previewProvisioning(repo: WorktreeRepo, model: ProvisionModel): Promise<ProvisionModel>;
  repoIdOf(worktreeId: string): string | undefined;
  resolveDestination(
    repo: WorktreeRepo,
    branch: string,
    override?: string,
    chosen?: string,
  ): {
    root: string;
    base: string;
    bare: string;
    freePath: string;
    occupiedCandidate?: { path: string; disposition: ResolvedDisposition };
  };
  retireOpening(key: string): void;
  surfaceKey(s: WorktreeSurface): string;
  vettedOverride(candidate: string | undefined, repo: WorktreeRepo): Promise<string | undefined>;
}

export function createCreateActions(deps: CreateDeps) {
  const {
    actionPath,
    admissibleLaunch,
    bumpMigrationSequence,
    cache,
    currentMigrationRegistration,
    deliver,
    disposed,
    issueWithAdded,
    lifecycle,
    migrationOffers,
    migrationReading,
    offers,
    openingFor,
    openingKey,
    openings,
    options,
    perform,
    previewProvisioning,
    provisionBaseline,
    provisionReading,
    repoIdOf,
    resolveDestination,
    retireOpening,
    surfaceKey,
    hasSurface,
  } = deps;

  const worktreeCreate: Arm<"worktreeCreate"> = (surface, msg, actions) => {
    const create = actions.createWorktree;
    // The last door outside the one-opening contract (round-5 W1): a form
    // the user closed cannot still be asking for a worktree.
    //
    // Equality, not consumption. The panel posts the submit before the
    // retirement on one ordered channel, so the legitimate one is still
    // live when it lands; spending the opening here would be a new rule
    // about how many submits an opening is worth. `namedOpening` is the
    // same defence in depth as at the refs door, unkillable alone.
    if (!namedOpening(msg.opening) || !lifecycle.isLive(surfaceKey(surface), msg.opening)) {
      return;
    }
    // Validated at RUNTIME, not merely typed. The unions make a bad request
    // unrepresentable in our own code, which is what stops us writing one —
    // but this message arrives from the webview, and a type erases at the
    // boundary. worktree-rpc.md § 4 asks for the check on every inbound
    // message, so an unknown discriminant fails closed here rather than
    // reaching a `switch` that has no arm for it.
    if (!isKnownCreateMode(msg.mode) || !isKnownAfterCreate(msg.afterCreate) || !isKnownDisposition(msg.disposition)) {
      return;
    }
    // The authorization names the directory it authorizes, and this create
    // names the directory it will take. A create whose disposition
    // authorizes a DIFFERENT path is not a create the panel composed.
    if (msg.disposition.kind === "debris" && msg.disposition.authorization.path !== msg.path) {
      return;
    }
    // A repair runs on the host's own resolution or not at all. Refused OUT
    // LOUD, like a stale provisioning offer: a Create button that silently
    // does nothing leaves the user no way to learn that reopening the
    // dialog is the recovery (round-1 F001).
    if (
      (msg.mode.kind === "adopt" || msg.mode.kind === "reattach") &&
      !matchesPublished(openingFor(surface, msg.repoId, msg.opening)?.publishedRepair, msg.mode, msg.path)
    ) {
      surface.post({
        type: "worktreeMutationResult",
        verb: "create",
        repoId: msg.repoId,
        result: {
          kind: "error",
          message:
            "the directory this create was resolved against has changed — close and reopen the dialog, then create again",
        },
      });
      return;
    }
    // The selection names ITEMS; the host holds the model. Resolved here,
    // from the offer this surface was shown, so nothing the webview spelled
    // reaches the filesystem — the property offerStore.ts exists for
    // (worktree-rpc.md § 2.4, design.md D2).
    //
    // An id the store no longer holds means NO CREATE: § 2.4 requires a
    // fresh model and a second submission, and honouring a stale offer
    // would provision from a model the user is not looking at. The other
    // half of that rule — resolving and re-presenting the fresh model — is
    // a named follow-up, so the user's recovery today is to reopen the
    // dialog.
    let selectedEntries: readonly ProvisionEntry[] | undefined;
    let selectedHeldFiles: ReadonlyMap<string, HeldProvisionSource> | undefined;
    let selectedPorts: readonly ProvisionPort[] | undefined;
    let migrationOffer: ReturnType<typeof migrationOffers.get>;
    let selectedSetup: readonly ProvisionSetupStep[] | undefined;
    let asimovEnvironment: boolean | undefined;
    if (msg.provision !== undefined) {
      // Checked at RUNTIME like its three neighbours above. It was the one
      // field that got only a `!== undefined` before `.offerId` and
      // `new Set(.itemIds)` were read off it — and the worktree dispatch at
      // `TerminalViewProvider.ts:1024-1031` returns BEFORE its `try`, so a
      // malformed message escaped into VS Code's callback instead of
      // failing closed (round-1 F006).
      if (!isKnownProvision(msg.provision)) {
        return;
      }
      const offered = offers.redeem({ surface: surfaceKey(surface), repoId: msg.repoId }, msg.provision.offerId);
      if (offered === undefined) {
        // Refused OUT LOUD. D3 says a stale offer refuses the create "with
        // a stated reason, on the existing error arm"; returning bare left
        // the user with a Create button that did nothing and no way to
        // learn that reopening the dialog is the recovery (round-1 F001).
        surface.post({
          type: "worktreeMutationResult",
          verb: "create",
          repoId: msg.repoId,
          result: {
            kind: "error",
            message: "the list of files to bring over is out of date — close and reopen the dialog, then create again",
          },
        });
        return;
      }
      const wanted = new Set(msg.provision.itemIds);
      selectedEntries = offered.model.entries.filter((entry) => wanted.has(entry.id));
      selectedHeldFiles = offered.heldFiles;
      selectedPorts = offered.model.ports.filter((port) => wanted.has(port.id));
      selectedSetup = offered.model.setup.filter((step) => wanted.has(step.id));
      asimovEnvironment = offered.model.providers.some((provider) => provider.id === "asimov" && provider.active);
    }
    if (msg.migrateChanges !== undefined) {
      if (
        !isKnownMigration(msg.migrateChanges) ||
        (msg.mode.kind !== "fresh" && msg.mode.kind !== "fresh-detached" && msg.mode.kind !== "reuse")
      ) {
        return;
      }
      const offered = migrationOffers.get(msg.migrateChanges.offerId);
      const source = cache
        .read()
        .repos.find((repo) => repo.repoId === msg.repoId)
        ?.worktrees.find(
          (row) =>
            row.id === offered?.sourceWorktreeId &&
            row.kind === offered?.binding.sourceKind &&
            !row.bare &&
            !row.missing &&
            !row.prunable,
        );
      if (
        offered === undefined ||
        offered.surface !== surfaceKey(surface) ||
        offered.opening !== msg.opening ||
        offered.repoId !== msg.repoId ||
        !isDeepStrictEqual(currentMigrationRegistration(msg.repoId), offered.binding.registration) ||
        !lifecycle.isLive(surfaceKey(surface), msg.opening) ||
        source === undefined ||
        options.probeMigrationSource === undefined
      ) {
        return;
      }
      migrationOffers.delete(msg.migrateChanges.offerId);
      migrationOffer = offered;
    }
    if (create && typeof msg.path === "string" && msg.path.length > 0 && msg.repoId.length > 0) {
      if (msg.afterCreate.kind === "agent" && !admissibleLaunch(surface, msg.afterCreate)) {
        return;
      }
      const selected =
        selectedEntries === undefined
          ? undefined
          : claimProvisionMaterials(selectedEntries, selectedHeldFiles ?? new Map());
      if (selectedEntries !== undefined && selected === undefined) {
        surface.post({
          type: "worktreeMutationResult",
          verb: "create",
          repoId: msg.repoId,
          result: {
            kind: "error",
            message: "one of the files selected for this create is no longer available — reopen the dialog",
          },
        });
        return;
      }
      const request = {
        repoId: msg.repoId,
        path: msg.path,
        mode: msg.mode,
        disposition: msg.disposition,
        afterCreate: msg.afterCreate,
        ...(selected === undefined ? {} : { provision: selected }),
        ...(selectedPorts === undefined ? {} : { ports: selectedPorts }),
        ...(selectedSetup === undefined ? {} : { setup: selectedSetup }),
        ...(asimovEnvironment === undefined ? {} : { asimovEnvironment }),
        origin: surface,
      };
      const runCreate = async (): Promise<void> => {
        try {
          if (migrationOffer === undefined) {
            await create(request);
            return;
          }
          const current = await options
            .probeMigrationSource?.(migrationOffer.sourcePath, migrationOffer.binding)
            .catch(() => undefined);
          const source = cache
            .read()
            .repos.find((repo) => repo.repoId === migrationOffer.repoId)
            ?.worktrees.find(
              (row) =>
                row.id === migrationOffer.sourceWorktreeId &&
                row.kind === migrationOffer.binding.sourceKind &&
                !row.bare &&
                !row.missing &&
                !row.prunable,
            );
          if (
            source === undefined ||
            current === undefined ||
            !isDeepStrictEqual(
              currentMigrationRegistration(migrationOffer.repoId),
              migrationOffer.binding.registration,
            ) ||
            !isDeepStrictEqual(current, migrationOffer.evidence)
          ) {
            surface.post({
              type: "worktreeMutationResult",
              verb: "create",
              repoId: msg.repoId,
              result: {
                kind: "error",
                message: "the source work changed — close and reopen the dialog, then create again",
              },
            });
            return;
          }
          await create({
            ...request,
            migration: {
              sourcePath: migrationOffer.sourcePath,
              source: migrationOffer.evidence.source,
              snapshot: migrationOffer.evidence.snapshot,
              binding: migrationOffer.binding,
            },
          });
        } finally {
          disposeProvisionMaterials(selected ?? []);
        }
      };
      perform(runCreate);
    }
    return;
  };

  const worktreeSetupRetry: Arm<"worktreeSetupRetry"> = (surface, msg, actions) => {
    if (!isKnownSetupRetry(msg)) {
      return;
    }
    const repoId = repoIdOf(msg.worktreeId);
    const retry = actions.retrySetup;
    if (retry !== undefined && repoId !== undefined && actionPath(msg.worktreeId, false) !== undefined) {
      perform(() => retry({ repoId, worktreeId: msg.worktreeId, origin: surface }, msg.retryId));
    }
    return;
  };

  const worktreePickDestination: Arm<"worktreePickDestination"> = (surface, msg, _actions) => {
    handlePickDestination(deps, surface, msg);
  };

  const worktreeCreateProbe: Arm<"worktreeCreateProbe"> = (surface, msg, _actions) => {
    // The discriminant alone is not the payload. Every field crosses a
    // trust boundary and then enters async logic, where a wrong type is an
    // unhandled rejection rather than a refusal (round-3 W1).
    if (!isWellFormedProbe(msg)) {
      return;
    }
    const repo = cache.read().repos.find((r) => r.repoId === msg.repoId);
    if (repo === undefined) {
      return;
    }
    // Marked BEFORE the await, which is the whole point: recording it after
    // would leave the window every superseded continuation resumes inside.
    // A probe whose token is not the opening's is unowned — a superseded
    // opening, or a token nobody minted — and must not create sequence
    // state for one (round-4 B7).
    const opening = openingFor(surface, msg.repoId, msg.token);
    if (opening === undefined || opening.latestSeq >= msg.seq) {
      return;
    }
    opening.latestSeq = msg.seq;
    // WITHDRAWN here, not when the new answer lands. Between admitting a
    // newer probe and posting its answer the previous candidate stayed
    // authorizable, which is the whole window a user's edit was supposed to
    // close (round-2 B1).
    opening.debrisCandidate = null;
    // WITHDRAWN with it, and for the same reason: between admitting a newer
    // probe and posting its answer, the previous repair stayed submittable.
    opening.publishedRepair = null;
    void answerCreateProbe(deps, surface, msg, repo, opening);
    return;
  };

  const worktreeAuthorizeDebris: Arm<"worktreeAuthorizeDebris"> = (surface, msg, _actions) => {
    if (
      typeof msg.path !== "string" ||
      msg.path.length === 0 ||
      typeof msg.token !== "number" ||
      typeof msg.ask !== "number"
    ) {
      return;
    }
    const repo = cache.read().repos.find((r) => r.repoId === msg.repoId);
    if (repo === undefined) {
      return;
    }
    const opening = openingFor(surface, msg.repoId, msg.token);
    // The path this opening's latest answer PUBLISHED as debris, and no
    // other. A request naming any other directory is not the request the
    // panel makes, and answering it would hand out a delete for a
    // destination the user was never shown (round-1 B1).
    if (opening === undefined || opening.debrisCandidate !== msg.path) {
      return;
    }
    void answerDebrisAuthorization(deps, surface, msg);
    return;
  };

  const worktreeCreateClosed: Arm<"worktreeCreateClosed"> = (surface, msg, _actions) => {
    // The only signal that a create conversation ENDED. Closure cannot be
    // inferred from the next opening: a form cancelled and never reopened
    // is exactly the case such a rule would never reach, and it is the case
    // that matters most — its read keeps the right to mint host authority
    // for a form the user dismissed (design.md D3).
    const key = surfaceKey(surface);
    // Retirement spends the same authority an answer does. A close naming
    // an opening this surface no longer holds is a late or replayed message
    // from a form already replaced; honouring it would let it silence the
    // form the user is looking at now (D2).
    //
    // The shape check is defensive and honestly so: a live opening is
    // always a positive integer, so the comparison already refuses every
    // malformed value, and no test can tell the two apart. It is here
    // because reading an unvalidated field as an identity is wrong, not
    // because a symptom was measured.
    if (!namedOpening(msg.opening) || !lifecycle.isLive(key, msg.opening)) {
      return;
    }
    // What the opening issued goes with it (D5). A create citing an evicted
    // id needs no new refusal path: § 2.4 already requires no create, no
    // provisioning, a freshly resolved model, and a second submission.
    retireOpening(key);
    return;
  };

  const requestWorktreeCreateDefaults: Arm<"requestWorktreeCreateDefaults"> = (surface, msg, _actions) => {
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
    const repo = cache.read().repos.find((r) => r.repoId === msg.repoId);
    if (repo === undefined) {
      return;
    }
    // The repo's own name is the base a branch is appended to, so the form's
    // placeholder and the destination it opens on describe one scheme. With
    // a branch, the base is what the form would have shown for it — the
    // host resolves the collision on THAT, not on the bare default. Through
    // the SAME resolver the probe answers with, so the destination the
    // resolution names and the one this reply names cannot drift (W4).
    const { root, base, bare, freePath: path } = resolveDestination(repo, msg.branch ?? "");
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
    const offerKey = { surface: surfaceKey(surface), repoId: msg.repoId };
    const reading = `${offerKey.surface} ${msg.repoId}`;
    const key = surfaceKey(surface);
    // Synchronously, before anything awaits. An opening ask ADOPTS the
    // opening the panel named; any other request must already be riding one
    // this surface holds, or it is answered with nothing — a retired or
    // never-seen opening has no authority to spend (D2).
    if (opening) {
      // An opening ask may only REPEAT the one being served or ADVANCE past
      // everything this surface has ever named. Anything else is a replay of
      // a spent form or a delayed predecessor, and adopting either put the
      // host back onto a conversation the user had already ended (B1).
      const admission = lifecycle.admitOpen(key, msg.opening);
      if (!admission.admitted) {
        return;
      }
      // A DIFFERENT opening retires the last one whole — every read slot it
      // holds and every offer it issued, not just the ones this new opening
      // happens to re-ask about. Rewriting only the slots it touches left a
      // read for another repository still holding its predecessor, and that
      // read published an offer for a form that no longer existed.
      if (admission.supersedes) {
        retireOpening(key);
      }
      lifecycle.markOpen(key, msg.opening);
    } else if (!lifecycle.isLive(key, msg.opening)) {
      return;
    }
    if (
      opening &&
      msg.sourceWorktreeId !== undefined &&
      Number.isSafeInteger(msg.sourceGeneration) &&
      (msg.sourceGeneration as number) > 0 &&
      options.probeMigrationSource !== undefined
    ) {
      const slot = `${key}::${msg.opening}`;
      const reading = migrationReading.get(slot);
      if (reading === undefined) {
        const sourceGeneration = msg.sourceGeneration as number;
        const mine = {
          sequence: bumpMigrationSequence(),
          repoId: msg.repoId,
          sourceWorktreeId: msg.sourceWorktreeId,
          sourceGeneration,
        };
        migrationReading.set(slot, mine);
        const source = repo.worktrees.find(
          (row) => row.id === msg.sourceWorktreeId && !row.bare && !row.missing && !row.prunable,
        );
        const registration = cache.registrationFor(msg.repoId, sourceGeneration);
        if (source !== undefined && registration !== undefined) {
          const sourcePath = source.id;
          const binding = { registration, sourceKind: source.kind };
          void options
            .probeMigrationSource(sourcePath, binding)
            .then((evidence) => {
              const currentReading = migrationReading.get(slot);
              const currentSource = cache
                .read()
                .repos.find((candidate) => candidate.repoId === msg.repoId)
                ?.worktrees.find(
                  (row) =>
                    row.id === source.id && row.kind === source.kind && !row.bare && !row.missing && !row.prunable,
                );
              if (
                disposed() ||
                !hasSurface(surface) ||
                !lifecycle.isLive(key, msg.opening) ||
                currentReading?.sequence !== mine.sequence ||
                currentReading.sourceWorktreeId !== mine.sourceWorktreeId ||
                currentReading.sourceGeneration !== mine.sourceGeneration ||
                !isDeepStrictEqual(currentMigrationRegistration(msg.repoId), registration) ||
                currentSource === undefined ||
                evidence === undefined ||
                !Number.isSafeInteger(evidence.snapshot.count) ||
                evidence.snapshot.count <= 0
              ) {
                return;
              }
              const offerId = (options.migrationOfferId ?? randomUUID)();
              if (migrationOffers.has(offerId)) {
                return;
              }
              migrationOffers.set(offerId, {
                surface: key,
                opening: msg.opening,
                repoId: msg.repoId,
                sourceWorktreeId: source.id,
                sourcePath,
                binding,
                evidence,
              });
              deliver(surface, {
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
    // A DIFFERENT opening supersedes: it starts its own read and retires the
    // previous one's right to publish. A repeat of the one already reading
    // JOINS it — starting a second would let a duplicated message suppress
    // the legitimate answer and grow reads without bound (D4). Only the READ
    // joins: the destination reply below is cheap and idempotent, and
    // withholding it would make a duplicate message cost the form its
    // destination.
    const joins = provisionReading.get(reading) === msg.opening;
    if (options.readProvisioning && opening && !joins) {
      const mine = msg.opening;
      provisionReading.set(reading, mine);
      void options
        .readProvisioning(repo.mainPath)
        .then(async (model) => {
          // The surface may have detached while the file was being read. A
          // post to a dead surface is at best wasted and at worst revives an
          // offer the detach was supposed to forget (B6).
          if (disposed() || !hasSurface(surface)) {
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
          if (provisionReading.get(reading) !== mine || !lifecycle.isLive(key, mine)) {
            return;
          }
          // The source this opening starts on, recorded once, from the first
          // offer it is given. A later offer is a source the user chose or a
          // save's own re-read, and neither is where the form began
          // (design.md D18).
          const start = `${key} ${msg.repoId} ${msg.opening}`;
          if (!provisionBaseline.has(start)) {
            provisionBaseline.set(start, model.providers.find((p) => p.active)?.id ?? "");
          }
          const previewed = await previewProvisioning(repo, model);
          if (
            disposed() ||
            !hasSurface(surface) ||
            provisionReading.get(reading) !== mine ||
            !lifecycle.isLive(key, mine)
          ) {
            return;
          }
          const offer = issueWithAdded(offerKey, start, previewed);
          deliver(surface, {
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
          if (provisionReading.get(reading) === mine) {
            provisionReading.delete(reading);
          }
        });
    }
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
  };

  const requestWorktreeRefs: Arm<"requestWorktreeRefs"> = (surface, msg, _actions) => {
    // One group, not a snapshot of the workspace. This runs once per
    // repository when the dialog opens, so `cache.read()` here made the
    // open cost R × O(R + W) in copying alone (round-1 B3).
    // This is the message that SEEDS the record probe and debris
    // authorization are gated on, so it is an authority door and has to be
    // guarded like one. Retirement swept the records and this writer put one
    // straight back: replaying a retired token here recreated the entry, and
    // the probe-then-authorize pair then reached `issueDebrisAuthorization`
    // exactly as it would have before the close (.reviews/round-3.md B2).
    // Closing the sweep without closing the writer left D5's own sentence —
    // retirement withdraws every channel the opening carries — false.
    //
    // Equality, not the defaults ask's repeat-or-advance rule: refs never
    // ESTABLISHES an opening. The branch-less defaults ask is the only door
    // that does, and the panel always sends it first, so a legitimate refs
    // ask is always riding an opening this surface already holds. Letting
    // refs advance the mark too would give a second message the power to
    // mint a form's identity.
    //
    // `namedOpening` here is defence in depth and no test can kill it on its
    // own: the lifecycle only ever serves tokens that already passed it on the
    // defaults channel, so the equality alone rejects `0`, a fraction and a
    // string too. Kept because the shape check is what makes the equality's
    // guarantee legible at this door rather than three hundred lines away —
    // the same call the close-side guard makes.
    const refsKey = surfaceKey(surface);
    if (!namedOpening(msg.token) || !lifecycle.isLive(refsKey, msg.token)) {
      return;
    }
    /** Still the opening this read belongs to, checked after every await. */
    const refsLive = (): boolean => lifecycle.isLive(refsKey, msg.token);
    const repo = cache.readRepo(msg.repoId);
    if (repo === undefined) {
      return;
    }
    // Started here because one gesture opens the form, and resolved on its
    // own promise posting its own message: a forge that is slow, absent or
    // unauthenticated must not delay the local list underneath it
    // (worktree-create.md § 4.1, design.md D3). There is deliberately no
    // code path on which the refs answer awaits this one.
    const forge = options.readPullRequests;
    if (forge !== undefined) {
      const unavailable = {
        type: "worktreePullRequests",
        token: msg.token,
        repoId: msg.repoId,
        available: false,
      } as const;
      const postForge = (answer: PullRequestsRead | undefined): void => {
        if (disposed() || !hasSurface(surface)) {
          return;
        }
        // The form may have closed while the forge was answering. A reply
        // for a retired opening is a reply for a conversation that ended.
        if (!refsLive()) {
          return;
        }
        // Unavailable is POSTED rather than withheld: the form has a row
        // to render for it, and silence would leave "not asked yet" and
        // "asked and there are none to be had" indistinguishable.
        surface.post(
          answer?.ok === true
            ? {
                type: "worktreePullRequests",
                token: msg.token,
                repoId: msg.repoId,
                pullRequests: answer.pullRequests,
                truncated: answer.truncated,
                available: true,
              }
            : unavailable,
        );
      };
      void forge({ cwd: repo.mainPath })
        .then(postForge)
        // Discovery, never the create. A reader that throws must not take
        // the destination reply — or the refs answer — down with it. It also
        // must not leave the form waiting forever: a rejection is one more
        // way the forge did not answer, so it POSTS the unavailable row
        // rather than being swallowed (.reviews/round-1.md W1).
        .catch(() => {
          postForge(undefined);
        });
    }
    const read = options.readRefs;
    if (read === undefined) {
      return;
    }
    // Kept so the probe can classify against it instead of asking git a
    // second time for an answer the dialog's opening already paid for
    // (design.md D2). The PROMISE rather than its value: a settle that
    // lands before the read resolves joins this one rather than starting
    // another. One entry per repository, replaced on every ask.
    const inFlight = read({ cwd: repo.mainPath, worktrees: repo.worktrees });
    // This ask IS the new opening: the record is REPLACED, so the previous
    // one is gone without anything having to go looking for it (B7, W8).
    openings.set(openingKey(surface, msg.repoId), {
      token: msg.token,
      read: inFlight,
      latestSeq: Number.NEGATIVE_INFINITY,
      debrisCandidate: null,
      publishedRepair: null,
      // A fresh opening was offered no folder. This is also what a REPLAY of
      // this request costs a form that had one: the record is dropped, which
      // narrows the honoured area to the configured root and can never widen
      // it (design.md D4).
      chosenRoot: null,
      // A fresh opening has confirmed nothing, so a pick still suspended on
      // the opening this one replaced can never match it.
      pickGeneration: 0,
    });
    void inFlight
      .then((answer) => {
        // The surface may have detached while git was answering. Posting to
        // a dead one is at best wasted, and the form it described is gone.
        if (disposed() || !hasSurface(surface)) {
          return;
        }
        // A failed read posts nothing: the form treats absent as "not told
        // yet", which is honest, and the create-new row is never gated on
        // this. Saying `refs: []` would state that the repository has no
        // branches — a claim git declined to make.
        if (answer.ok !== true) {
          return;
        }
        // Same rule as the forge continuation above: retirement outranks a
        // read that was already running when it happened.
        if (!refsLive()) {
          return;
        }
        surface.post({
          type: "worktreeRefs",
          token: msg.token,
          repoId: msg.repoId,
          refs: answer.refs,
          truncated: answer.truncated,
        });
      })
      // The list is discovery, never the create. A reader that throws must
      // not take the destination reply down with it.
      .catch(() => {});
    return;
  };

  return {
    worktreeCreate,
    worktreeSetupRetry,
    worktreePickDestination,
    worktreeCreateProbe,
    worktreeAuthorizeDebris,
    worktreeCreateClosed,
    requestWorktreeCreateDefaults,
    requestWorktreeRefs,
  };
}
