// src/providers/worktreeHost/actions/create/submitArm.ts — The create itself,
// and the setup retry that follows a create whose setup failed.
//
// Extracted from `createCreateActions` by change `decompose-worktree-host`
// (design.md D1, task 2_16). This is the one arm that WRITES: it spends the
// opening, redeems the provisioning offer, claims the copy materials, spends
// the migration offer and hands the whole thing to the executor. Everything it
// checks before doing so — the published repair, the launch admission, the
// offer's own identity — is a check about this write and belongs beside it.

import { isDeepStrictEqual } from "node:util";
import type {
  ProvisionEntry,
  ProvisionPort,
  ProvisionSetupStep,
  WorktreeActionMessage,
} from "../../../../types/messages";
import type { MigrationRepositoryBinding } from "../../../../worktree/migrateChanges";
import type { ProvisionOfferStore } from "../../../../worktree/provisioning/offerStore";
import type { HeldProvisionSource } from "../../../../worktree/provisioning/provisionMaterial";
import {
  claimProvisionMaterials,
  disposeProvisionMaterials,
} from "../../../../worktree/provisioning/provisionMaterial";
import type { createWorktreeCache } from "../../../../worktree/WorktreeCache";
import type { WorktreeHostOptions } from "../../../WorktreeHost";
import type { MigrationOffer, Opening, WorktreeActions, WorktreeSurface } from "../../hostTypes";
import {
  isKnownAfterCreate,
  isKnownCreateMode,
  isKnownDisposition,
  isKnownMigration,
  isKnownProvision,
  isKnownSetupRetry,
  namedOpening,
} from "../../messageGuards";
import type { OpeningLifecycle } from "../../openingLifecycle";
import { matchesPublished } from "./probes";

/** What the submit needs from the host. A subset of `CreateDeps`. */
export interface SubmitDeps {
  readonly cache: ReturnType<typeof createWorktreeCache>;
  readonly lifecycle: OpeningLifecycle;
  readonly migrationOffers: Map<string, MigrationOffer>;
  readonly offers: ProvisionOfferStore;
  readonly options: WorktreeHostOptions;
  actionPath(worktreeId: string, allowMissing: boolean): string | undefined;
  admissibleLaunch(surface: WorktreeSurface, fields: unknown): boolean;
  currentMigrationRegistration(repoId: string): MigrationRepositoryBinding["registration"] | undefined;
  openingFor(s: WorktreeSurface, repoId: string, token: number): Opening | undefined;
  perform(run: () => Promise<void>): void;
  repoIdOf(worktreeId: string): string | undefined;
  surfaceKey(s: WorktreeSurface): string;
}

/**
 * Refuse this create OUT LOUD.
 *
 * D3 says a stale offer refuses the create "with a stated reason, on the
 * existing error arm"; returning bare left the user with a Create button that
 * did nothing and no way to learn that reopening the dialog is the recovery
 * (round-1 F001). Four different staleness checks say it, so they say it the
 * same way.
 */
function refuseCreate(surface: WorktreeSurface, repoId: string, message: string): void {
  surface.post({
    type: "worktreeMutationResult",
    verb: "create",
    repoId,
    result: { kind: "error", message },
  });
}

/** What the redeemed offer selected. Empty when the form asked for none. */
interface SelectedProvision {
  entries?: readonly ProvisionEntry[];
  heldFiles?: ReadonlyMap<string, HeldProvisionSource>;
  ports?: readonly ProvisionPort[];
  setup?: readonly ProvisionSetupStep[];
  asimovEnvironment?: boolean;
}

/**
 * Resolve the form's item ids against the offer this surface was shown.
 *
 * `null` means refuse the create: either the payload is malformed or the offer
 * is spent, and the second case has already said so on the error arm.
 */
function redeemProvision(
  deps: SubmitDeps,
  surface: WorktreeSurface,
  msg: Extract<WorktreeActionMessage, { type: "worktreeCreate" }>,
): SelectedProvision | null {
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
  if (msg.provision === undefined) {
    return {};
  }
  {
    // Checked at RUNTIME like its three neighbours above. It was the one
    // field that got only a `!== undefined` before `.offerId` and
    // `new Set(.itemIds)` were read off it — and the worktree dispatch at
    // `TerminalViewProvider.ts:1024-1031` returns BEFORE its `try`, so a
    // malformed message escaped into VS Code's callback instead of
    // failing closed (round-1 F006).
    if (!isKnownProvision(msg.provision)) {
      return null;
    }
    const offered = deps.offers.redeem(
      { surface: deps.surfaceKey(surface), repoId: msg.repoId },
      msg.provision.offerId,
    );
    if (offered === undefined) {
      // Refused OUT LOUD. D3 says a stale offer refuses the create "with
      // a stated reason, on the existing error arm"; returning bare left
      // the user with a Create button that did nothing and no way to
      // learn that reopening the dialog is the recovery (round-1 F001).
      refuseCreate(
        surface,
        msg.repoId,
        "the list of files to bring over is out of date — close and reopen the dialog, then create again",
      );
      return null;
    }
    const wanted = new Set(msg.provision.itemIds);
    return {
      entries: offered.model.entries.filter((entry) => wanted.has(entry.id)),
      heldFiles: offered.heldFiles,
      ports: offered.model.ports.filter((port) => wanted.has(port.id)),
      setup: offered.model.setup.filter((step) => wanted.has(step.id)),
      asimovEnvironment: offered.model.providers.some((provider) => provider.id === "asimov" && provider.active),
    };
  }
}

/**
 * Spend the migration offer this submit names, or refuse.
 *
 * `undefined` = none asked for; `null` = refuse. The offer is DELETED on the
 * way through: one offer, one create.
 */
function spendMigrationOffer(
  deps: SubmitDeps,
  surface: WorktreeSurface,
  msg: Extract<WorktreeActionMessage, { type: "worktreeCreate" }>,
): MigrationOffer | undefined | null {
  if (msg.migrateChanges === undefined) {
    return undefined;
  }
  {
    if (
      !isKnownMigration(msg.migrateChanges) ||
      (msg.mode.kind !== "fresh" && msg.mode.kind !== "fresh-detached" && msg.mode.kind !== "reuse")
    ) {
      return null;
    }
    const offered = deps.migrationOffers.get(msg.migrateChanges.offerId);
    const source = deps.cache
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
      offered.surface !== deps.surfaceKey(surface) ||
      offered.opening !== msg.opening ||
      offered.repoId !== msg.repoId ||
      !isDeepStrictEqual(deps.currentMigrationRegistration(msg.repoId), offered.binding.registration) ||
      !deps.lifecycle.isLive(deps.surfaceKey(surface), msg.opening) ||
      source === undefined ||
      deps.options.probeMigrationSource === undefined
    ) {
      return null;
    }
    deps.migrationOffers.delete(msg.migrateChanges.offerId);
    return offered;
  }
}

type CreateFn = NonNullable<WorktreeActions["createWorktree"]>;

/**
 * Run the create, re-proving the migration source at the moment of the write.
 *
 * The offer was minted from a read taken when the dialog opened; between then
 * and here the source can move, so the evidence is asked for again and compared
 * before the changes are carried over.
 */
async function runCreate(
  deps: SubmitDeps,
  surface: WorktreeSurface,
  msg: Extract<WorktreeActionMessage, { type: "worktreeCreate" }>,
  create: CreateFn,
  request: Parameters<CreateFn>[0],
  migrationOffer: MigrationOffer | undefined,
  selected: ReturnType<typeof claimProvisionMaterials>,
): Promise<void> {
  try {
    if (migrationOffer === undefined) {
      await create(request);
      return;
    }
    const current = await deps.options
      .probeMigrationSource?.(migrationOffer.sourcePath, migrationOffer.binding)
      .catch(() => undefined);
    const source = deps.cache
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
        deps.currentMigrationRegistration(migrationOffer.repoId),
        migrationOffer.binding.registration,
      ) ||
      !isDeepStrictEqual(current, migrationOffer.evidence)
    ) {
      refuseCreate(surface, msg.repoId, "the source work changed — close and reopen the dialog, then create again");
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
}

export function handleWorktreeCreate(
  deps: SubmitDeps,
  surface: WorktreeSurface,
  msg: Extract<WorktreeActionMessage, { type: "worktreeCreate" }>,
  actions: WorktreeActions,
): void {
  const create = actions.createWorktree;
  // The last door outside the one-opening contract (round-5 W1): a form
  // the user closed cannot still be asking for a worktree.
  //
  // Equality, not consumption. The panel posts the submit before the
  // retirement on one ordered channel, so the legitimate one is still
  // live when it lands; spending the opening here would be a new rule
  // about how many submits an opening is worth. `namedOpening` is the
  // same defence in depth as at the refs door, unkillable alone.
  if (!namedOpening(msg.opening) || !deps.lifecycle.isLive(deps.surfaceKey(surface), msg.opening)) {
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
    !matchesPublished(deps.openingFor(surface, msg.repoId, msg.opening)?.publishedRepair, msg.mode, msg.path)
  ) {
    refuseCreate(
      surface,
      msg.repoId,
      "the directory this create was resolved against has changed — close and reopen the dialog, then create again",
    );
    return;
  }
  const selection = redeemProvision(deps, surface, msg);
  if (selection === null) {
    return;
  }
  const migrationOffer = spendMigrationOffer(deps, surface, msg);
  if (migrationOffer === null) {
    return;
  }
  if (create && typeof msg.path === "string" && msg.path.length > 0 && msg.repoId.length > 0) {
    if (msg.afterCreate.kind === "agent" && !deps.admissibleLaunch(surface, msg.afterCreate)) {
      return;
    }
    const selected =
      selection.entries === undefined
        ? undefined
        : claimProvisionMaterials(selection.entries, selection.heldFiles ?? new Map());
    if (selection.entries !== undefined && selected === undefined) {
      refuseCreate(
        surface,
        msg.repoId,
        "one of the files selected for this create is no longer available — reopen the dialog",
      );
      return;
    }
    const request = {
      repoId: msg.repoId,
      path: msg.path,
      mode: msg.mode,
      disposition: msg.disposition,
      afterCreate: msg.afterCreate,
      ...(selected === undefined ? {} : { provision: selected }),
      ...(selection.ports === undefined ? {} : { ports: selection.ports }),
      ...(selection.setup === undefined ? {} : { setup: selection.setup }),
      ...(selection.asimovEnvironment === undefined ? {} : { asimovEnvironment: selection.asimovEnvironment }),
      origin: surface,
    };
    deps.perform(() => runCreate(deps, surface, msg, create, request, migrationOffer, selected));
  }
  return;
}

export function handleSetupRetry(
  deps: SubmitDeps,
  surface: WorktreeSurface,
  msg: Extract<WorktreeActionMessage, { type: "worktreeSetupRetry" }>,
  actions: WorktreeActions,
): void {
  if (!isKnownSetupRetry(msg)) {
    return;
  }
  const repoId = deps.repoIdOf(msg.worktreeId);
  const retry = actions.retrySetup;
  if (retry !== undefined && repoId !== undefined && deps.actionPath(msg.worktreeId, false) !== undefined) {
    deps.perform(() => retry({ repoId, worktreeId: msg.worktreeId, origin: surface }, msg.retryId));
  }
  return;
}
