// src/providers/worktreeHost/provisionOffers.ts — What a create form is OFFERED
// for one repository: the provider's model with this form's own additions
// composed in, and the withholding statement when they do not all fit.
//
// Extracted from `createWorktreeHost` by change `decompose-worktree-host`
// (design.md D1, task 2_8). The composition rule and the two caps it enforces
// sat 250 lines apart in the closure, so "what does this form see when it adds
// a 33rd step" could only be asked through a whole host and a message round.
//
// `offerSeq` did NOT come, though it is declared among this state: only
// `publishLaunchTargets` mints from it, and a binding belongs to its writer
// (task 2_2, OBL-7).

import type { ProvisionEntry, ProvisionModel } from "../../types/messages";
import { SETUP_STEP_ADDED_SOURCE } from "../../types/messages";
import type { ProvisionOfferStore } from "../../worktree/provisioning/offerStore";
import { conflictsWithProvisionDestination, MAX_MODEL_ROWS, rowsOf } from "../../worktree/provisioning/providerKit";
import type { HeldProvisionSource } from "../../worktree/provisioning/provisionMaterial";
import type { ResolvedRepo } from "../../worktree/repoRoots";
import type { WorktreeRepo } from "../../worktree/types";
import type { WorktreeCache } from "../../worktree/WorktreeCache";
import type { WorktreeHostOptions } from "./hostOptions";
import type { PickedCopyFile } from "./hostTypes";

export const MAX_ADDED_STEPS = 32;
export const MAX_ADDED_COPY_FILES = 32;
export const ADDED_COPY_SOURCE = "Added for this create";

/** One offer belongs to one surface's view of one repository. */
export interface OfferKey {
  surface: string;
  repoId: string;
}

/** A model composed with this form's additions, and the files it now holds. */
export interface ComposedOffer {
  readonly model: ProvisionModel;
  readonly heldFiles: ReadonlyMap<ProvisionEntry, HeldProvisionSource>;
}

export interface ProvisionOffersDeps {
  cache: Pick<WorktreeCache, "readRepo" | "registrationFor">;
  offers: ProvisionOfferStore;
  options: Pick<WorktreeHostOptions, "previewProvisioningPorts">;
}

export interface ProvisionOffers {
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
  readonly addedSteps: Map<string, readonly string[]>;
  readonly addedCopyFiles: Map<string, readonly PickedCopyFile[]>;

  /** The registration this repository publishes at the generation now cached. */
  currentMigrationRegistration(repoId: string): ResolvedRepo["registration"];

  /** The next migration sequence number. Monotonic within one host. */
  bumpMigrationSequence(): number;

  previewProvisioning(repo: WorktreeRepo, model: ProvisionModel): Promise<ProvisionModel>;

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
  withoutAdded(model: ProvisionModel, heldIds?: ReadonlySet<string>): ProvisionModel;

  privateIdsFor(offerKey: OfferKey, model: ProvisionModel): ReadonlySet<string>;

  withAdded(
    offerKey: OfferKey,
    slot: string,
    model: ProvisionModel,
    copyRecord?: readonly PickedCopyFile[],
    setupRecord?: readonly string[],
  ): ComposedOffer;

  roomForOneMoreSetup(offerKey: OfferKey, slot: string, model: ProvisionModel, record: readonly string[]): boolean;

  issueWithAdded(offerKey: OfferKey, slot: string, model: ProvisionModel): ReturnType<ProvisionOfferStore["issue"]>;
}

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
export function withoutAdded(model: ProvisionModel, heldIds: ReadonlySet<string> = new Set()): ProvisionModel {
  return {
    ...model,
    entries: model.entries.filter((entry) => !heldIds.has(entry.id)),
    setup: model.setup.filter((step) => step.source !== SETUP_STEP_ADDED_SOURCE),
    problems: model.problems.filter((problem) => problem.file !== SETUP_STEP_ADDED_SOURCE),
  };
}

/**
 * Copy rows this form could add, stopping at the first that would land on a
 * destination the model already occupies. Ids are minted against the rows
 * already in the model, never against the record's own index alone.
 */
function candidateCopies(
  base: ProvisionModel,
  copyRecord: readonly PickedCopyFile[],
): Array<{ entry: ProvisionEntry; source: PickedCopyFile }> {
  const occupied: ProvisionEntry[] = [...base.entries, ...base.excluded];
  const usedIds = new Set([...base.entries, ...base.excluded, ...base.setup, ...base.ports].map((row) => row.id));
  const candidates: Array<{ entry: ProvisionEntry; source: PickedCopyFile }> = [];
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
    candidates.push({ entry, source });
    occupied.push(entry);
  }
  return candidates;
}

/** What was left out, in the sentence the form shows. Empty when nothing was. */
function withholdingStatement(withheldCopies: number, withheldSetup: number): string {
  const withheld: string[] = [];
  if (withheldCopies > 0) {
    withheld.push(`${withheldCopies} added file${withheldCopies === 1 ? "" : "s"}`);
  }
  if (withheldSetup > 0) {
    withheld.push(`${withheldSetup} added setup step${withheldSetup === 1 ? "" : "s"}`);
  }
  return withheld.join(" and ");
}

/**
 * The composition rule itself, with the private ids already resolved: what this
 * form adds, how much of it fits, and what the row cap left out.
 */
function composeOffer(
  model: ProvisionModel,
  heldIds: ReadonlySet<string>,
  copyRecord: readonly PickedCopyFile[],
  setupRecord: readonly string[],
): ComposedOffer {
  const base = withoutAdded(model, heldIds);
  const candidates = candidateCopies(base, copyRecord);
  const room = MAX_MODEL_ROWS - rowsOf(base);
  const conflictWithheld = copyRecord.length - candidates.length;
  const totalAdded = candidates.length + setupRecord.length;
  const needsStatement = conflictWithheld > 0 || totalAdded > room;
  const usable = needsStatement ? Math.max(0, room - 1) : room;
  const shownCopies = Math.min(candidates.length, usable);
  const shownSetup = Math.min(setupRecord.length, Math.max(0, usable - shownCopies));
  const heldFiles = new Map<ProvisionEntry, HeldProvisionSource>();
  for (const { entry, source } of candidates.slice(0, shownCopies)) {
    heldFiles.set(entry, { canonicalPath: source.canonicalPath, file: source.file });
  }
  const statement = withholdingStatement(copyRecord.length - shownCopies, setupRecord.length - shownSetup);
  return {
    model: {
      ...base,
      entries: [...base.entries, ...candidates.slice(0, shownCopies).map(({ entry }) => entry)],
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
}

export function createProvisionOffers(deps: ProvisionOffersDeps): ProvisionOffers {
  const addedSteps = new Map<string, readonly string[]>();
  const addedCopyFiles = new Map<string, readonly PickedCopyFile[]>();
  let migrationSequence = 0;

  const privateIdsFor = (offerKey: OfferKey, model: ProvisionModel): ReadonlySet<string> => {
    const current = deps.offers.current(offerKey);
    if (current?.model !== model) {
      return new Set();
    }
    return new Set(deps.offers.redeem(offerKey, current.offerId)?.heldFiles.keys());
  };

  const withAdded = (
    offerKey: OfferKey,
    slot: string,
    model: ProvisionModel,
    copyRecord: readonly PickedCopyFile[] = addedCopyFiles.get(slot) ?? [],
    setupRecord: readonly string[] = addedSteps.get(slot) ?? [],
  ): ComposedOffer => composeOffer(model, privateIdsFor(offerKey, model), copyRecord, setupRecord);

  return {
    addedSteps,
    addedCopyFiles,
    withoutAdded,
    privateIdsFor,
    withAdded,

    currentMigrationRegistration(repoId) {
      const generation = deps.cache.readRepo(repoId)?.generation;
      return generation === undefined ? undefined : deps.cache.registrationFor(repoId, generation);
    },

    bumpMigrationSequence() {
      migrationSequence += 1;
      return migrationSequence;
    },

    async previewProvisioning(repo, model) {
      const preview = deps.options.previewProvisioningPorts;
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
    },

    roomForOneMoreSetup(offerKey, slot, model, record) {
      const next = [...record, ""];
      const composed = withAdded(offerKey, slot, model, addedCopyFiles.get(slot) ?? [], next);
      return composed.model.setup.filter((step) => step.source === SETUP_STEP_ADDED_SOURCE).length === next.length;
    },

    issueWithAdded(offerKey, slot, model) {
      const composed = withAdded(offerKey, slot, model);
      return deps.offers.issue(offerKey, composed.model, composed.heldFiles);
    },
  };
}
