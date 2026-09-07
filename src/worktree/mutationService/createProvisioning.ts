// src/worktree/mutationService/createProvisioning.ts — What a newly created
// worktree is then given: migration, exclusions, files, ports, setup and launch.
//
// Extracted from `worktreeMutationService.ts` by change
// `decompose-mutation-service` (design.md D1, task 4_2). The settle → manifest →
// retry-staging → outcome sequence is one machine: splitting it earlier severs
// eight values the outcome reads and creates a mutable state carrier worse than
// the block it replaces.
//
// `writtenExclusions` is one set here. A second set across the two exclusion
// paths would write the same pattern twice.

import type {
  ProvisionPortResult,
  ProvisionPortWarning,
  ProvisionStepResult,
  WorktreeCreateMode,
} from "../../types/messages";
import type { AuthorizedDirectory } from "../../utils/authorizedDirectory";
import { normalizePathForCompare } from "../../utils/pathBoundary";
import { messageOf } from "../errorMessage";
import { excludePatternFor } from "../gitExclude";
import type { MigrationSourceEvidence } from "../migrateChanges";
import { provisionEntryOf } from "../provisioning/provisionMaterial";
import type {
  MutationOutcome,
  MutationServiceDeps,
  SetupExecutionOutcome,
  WorktreeMutationService,
} from "./serviceTypes";
import type { createSetupExecution, PendingSetupRetry } from "./setupExecution";

type CreateRequest = Parameters<WorktreeMutationService["createWorktree"]>[0];
type Setup = Pick<
  ReturnType<typeof createSetupExecution>,
  "executeSetup" | "writeManifest" | "failedSetup" | "portEnvironment"
>;

export interface CreateProvisioningDeps {
  service: Pick<
    MutationServiceDeps,
    | "addToGitExclude"
    | "afterCreate"
    | "applyPorts"
    | "applyProvision"
    | "authorizeDirectory"
    | "captureMigrationDestination"
    | "gitExcludeDirFor"
    | "migrateChanges"
    | "migrationGitExcludeDirFor"
    | "normalizeWorktreeId"
    | "provisionUnavailable"
  >;
  setup: Setup;
}

export interface ProvisionCreatedInput {
  request: CreateRequest;
  repoPath: string;
  worktreePath: string;
  setPendingSetupRetry(retry: PendingSetupRetry): void;
}

export interface CreateProvisioning {
  provisionCreated(input: ProvisionCreatedInput): Promise<MutationOutcome>;
}

function migrationReasonOf(error: unknown): string {
  try {
    const text = error instanceof Error ? error.message : String(error);
    return text.trim().slice(0, 1_000) || "the Git integration did not complete the migration";
  } catch {
    return "the Git integration did not complete the migration";
  }
}

function setupBranch(mode: WorktreeCreateMode): string {
  switch (mode.kind) {
    case "fresh":
    case "reuse":
      return mode.branch;
    case "fresh-detached":
      return mode.baseRef;
    case "reattach":
      return mode.branch;
    case "adopt":
      return mode.branch;
  }
}

interface CreateProvisionState {
  readonly wanted: NonNullable<CreateRequest["provision"]>;
  readonly wantedEntries: ReturnType<typeof provisionEntryOf>[];
  readonly wantedPorts: NonNullable<CreateRequest["ports"]>;
  readonly wantedSetup: NonNullable<CreateRequest["setup"]>;
  sourceAuthorization: AuthorizedDirectory | undefined;
  destinationAuthorization: AuthorizedDirectory | undefined;
  provisioned: readonly ProvisionStepResult[] | undefined;
  allocatedPorts: readonly ProvisionPortResult[] | undefined;
  setupOutcome: SetupExecutionOutcome | undefined;
  portWarnings: readonly ProvisionPortWarning[];
  manifestWarning: string | undefined;
  provisionedAt: string | undefined;
  openFailure: string | null;
}

async function prepareMigration(
  deps: CreateProvisioningDeps,
  input: ProvisionCreatedInput,
): Promise<MutationOutcome | undefined> {
  const migrationIndeterminate = async (reason: string): Promise<MutationOutcome> => ({
    kind: "ok",
    verb: "create",
    repoId: input.request.repoId,
    worktreeId: (await deps.service.normalizeWorktreeId?.(input.worktreePath).catch(() => null)) ?? input.worktreePath,
    migrationIndeterminate: reason.slice(0, 1_000),
  });
  let destinationEvidence: MigrationSourceEvidence | undefined;
  if (input.request.migration !== undefined) {
    if (deps.service.captureMigrationDestination === undefined) {
      return migrationIndeterminate("migration destination authorization is unavailable in this window");
    }
    try {
      destinationEvidence = await deps.service.captureMigrationDestination(
        input.request.repoId,
        input.worktreePath,
        input.request.migration.binding.registration,
      );
    } catch (error) {
      return migrationIndeterminate(
        `the migration destination registration could not be verified: ${migrationReasonOf(error)}`,
      );
    }
    if (destinationEvidence === undefined) {
      return migrationIndeterminate("the migration destination registration could not be verified");
    }
  }

  const writtenExclusions = new Set<string>();
  const writeExclusion = async (
    exclusion: { gitDir: string; relativePath: string } | null,
    critical: boolean,
  ): Promise<MutationOutcome | undefined> => {
    if (exclusion === null) {
      return undefined;
    }
    const pattern = excludePatternFor(exclusion.relativePath);
    const key = `${normalizePathForCompare(exclusion.gitDir)}\0${pattern}`;
    if (writtenExclusions.has(key)) {
      return undefined;
    }
    try {
      await deps.service.addToGitExclude(exclusion.gitDir, pattern);
      writtenExclusions.add(key);
      return undefined;
    } catch (error) {
      return critical
        ? migrationIndeterminate(
            `the selected-source destination exclusion could not be established: ${migrationReasonOf(error)}`,
          )
        : undefined;
    }
  };

  if (input.request.migration !== undefined) {
    const exclusionFailure = await writeExclusion(
      deps.service.migrationGitExcludeDirFor(
        input.request.repoId,
        input.request.migration.sourcePath,
        input.worktreePath,
      ),
      true,
    );
    if (exclusionFailure !== undefined) {
      return exclusionFailure;
    }
  }
  await writeExclusion(deps.service.gitExcludeDirFor(input.request.repoId, input.repoPath, input.worktreePath), false);

  if (input.request.migration !== undefined && destinationEvidence !== undefined) {
    const migration =
      deps.service.migrateChanges === undefined
        ? ({ kind: "indeterminate", reason: "migration is unavailable in this window" } as const)
        : await deps.service
            .migrateChanges({
              sourcePath: input.request.migration.sourcePath,
              destinationPath: input.worktreePath,
              source: input.request.migration.source,
              destination: destinationEvidence,
              snapshot: input.request.migration.snapshot,
              binding: input.request.migration.binding,
            })
            .catch((error) => ({ kind: "indeterminate" as const, reason: migrationReasonOf(error) }));
    if (migration.kind === "indeterminate") {
      return migrationIndeterminate(migration.reason);
    }
  }
  return undefined;
}

async function applyMaterials(
  deps: CreateProvisioningDeps,
  input: ProvisionCreatedInput,
  state: CreateProvisionState,
): Promise<void> {
  if (state.wanted.length > 0) {
    [state.sourceAuthorization, state.destinationAuthorization] = await Promise.all([
      deps.service.authorizeDirectory(input.repoPath).catch(() => undefined),
      deps.service.authorizeDirectory(input.worktreePath).catch(() => undefined),
    ]);
  } else {
    state.destinationAuthorization = await deps.service.authorizeDirectory(input.worktreePath).catch(() => undefined);
  }
  // BEFORE afterCreate, which launches an agent or a terminal INTO
  // this worktree: the whole point of copying `.env` is that whatever
  // starts here can read it (design.md D1).
  //
  // Inside its own catch, exactly like afterCreate's below. Without
  // one, a rejection reaches this body's outer arm and reports a
  // SUCCESSFUL git create as a create error — the defect the plan
  // attack found by reading that arm rather than this line.
  if (state.wanted.length > 0) {
    const failed = (reason: string): readonly ProvisionStepResult[] =>
      state.wantedEntries.map((entry) => ({
        id: entry.id,
        path: entry.path,
        outcome: { kind: "failed" as const, reason },
      }));
    const unavailableReason =
      state.destinationAuthorization === undefined
        ? "the worktree could not be read after it was created"
        : "the main checkout could not be read after the worktree was created";
    state.provisioned =
      state.sourceAuthorization === undefined || state.destinationAuthorization === undefined
        ? (deps.service.provisionUnavailable?.(input.worktreePath, state.wantedEntries, unavailableReason) ??
          failed(unavailableReason))
        : deps.service.applyProvision === undefined
          ? // A host with no binding cannot provision, but it CAN say so.
            // Dropping the selection produced an outcome byte-identical
            // to "the user selected nothing", which is the one answer
            // nobody can tell from the truth (round-1 F009).
            failed("this window cannot bring files over")
          : await deps.service
              .applyProvision(input.repoPath, input.worktreePath, state.wanted, {
                source: state.sourceAuthorization,
                destination: state.destinationAuthorization,
              })
              .catch((error) => failed(messageOf(error)));
  }
  if (state.wantedPorts.length > 0) {
    const failed = (reason: string): readonly ProvisionPortResult[] =>
      state.wantedPorts.map((port) => ({
        id: port.id,
        name: port.name,
        ...(port.port === undefined ? {} : { preview: port.port }),
        outcome: { kind: "failed" as const, reason },
      }));
    const applied =
      state.destinationAuthorization === undefined
        ? { ports: failed("the worktree identity could not be verified after creation"), warnings: [] }
        : deps.service.applyPorts === undefined
          ? { ports: failed("this window cannot allocate ports"), warnings: [] }
          : await deps.service
              .applyPorts({
                repoId: input.request.repoId,
                repoPath: input.repoPath,
                worktreePath: input.worktreePath,
                ports: state.wantedPorts,
                authorization: state.destinationAuthorization,
              })
              .catch((error) => ({ ports: failed(messageOf(error)), warnings: [] }));
    state.allocatedPorts = applied.ports;
    state.portWarnings = applied.warnings;
  }
  // Every fresh create owns a manifest, including a truthful empty one.
  // Use the id the tree will key this worktree on, not the path git was handed.
  state.provisionedAt =
    (await deps.service.normalizeWorktreeId?.(input.worktreePath).catch(() => null)) ?? input.worktreePath;
}

async function runSetupAndLaunch(
  deps: CreateProvisioningDeps,
  input: ProvisionCreatedInput,
  state: CreateProvisionState,
): Promise<void> {
  const launch = async (): Promise<void> => {
    await deps.service
      .afterCreate(input.worktreePath, input.request.afterCreate, input.request.origin)
      .catch((error: unknown) => {
        const reason = messageOf(error);
        state.openFailure = input.request.afterCreate.kind === "agent" ? `Agent did not start: ${reason}` : reason;
      });
  };

  if (state.wantedSetup.length > 0) {
    const run =
      state.destinationAuthorization !== undefined && state.provisionedAt !== undefined
        ? deps.setup.executeSetup(
            {
              repoId: input.request.repoId,
              mainPath: input.repoPath,
              worktreeId: state.provisionedAt,
              worktreePath: input.worktreePath,
              branch: setupBranch(input.request.mode),
              steps: state.wantedSetup,
              asimovEnvironment: input.request.asimovEnvironment ?? false,
              ports: deps.setup.portEnvironment(state.allocatedPorts ?? []),
              authorization: state.destinationAuthorization,
            },
            input.request.origin,
          )
        : Promise.resolve({
            steps: deps.setup.failedSetup(
              state.wantedSetup,
              "the worktree identity could not be verified after creation",
            ),
            succeeded: false,
          });
    if (input.request.afterCreate.kind === "agent" && input.request.afterCreate.waitForSetup) {
      // The choice is ORDER, not permission: "wait for setup to finish
      // before starting the agent" is what the checkbox says, and a
      // failed step is exactly when the user wants the agent there to
      // look at it. Gating the launch on success stranded the create
      // with nothing running in it and no way forward but a retry.
      state.setupOutcome = await run;
      await launch();
    } else {
      const launchPromise = launch();
      state.setupOutcome = await run;
      await launchPromise;
    }
  } else {
    await launch();
  }
}

async function settleProvisioning(
  deps: CreateProvisioningDeps,
  input: ProvisionCreatedInput,
  state: CreateProvisionState,
): Promise<MutationOutcome> {
  const setupResults = state.setupOutcome?.steps ?? [];
  if (state.provisionedAt !== undefined) {
    state.manifestWarning = await deps.setup.writeManifest(
      input.worktreePath,
      state.provisioned ?? [],
      state.allocatedPorts ?? [],
      setupResults,
    );
    if (
      !state.setupOutcome?.succeeded &&
      state.destinationAuthorization !== undefined &&
      state.wantedSetup.length > 0
    ) {
      input.setPendingSetupRetry({
        repoId: input.request.repoId,
        worktreeId: state.provisionedAt,
        worktreePath: input.worktreePath,
        mainPath: input.repoPath,
        branch: setupBranch(input.request.mode),
        steps: state.wantedSetup,
        asimovEnvironment: input.request.asimovEnvironment ?? false,
        ports: deps.setup.portEnvironment(state.allocatedPorts ?? []),
        authorization: state.destinationAuthorization,
        materialized: state.provisioned ?? [],
        portResults: state.allocatedPorts ?? [],
      });
    }
  }
  return {
    kind: "ok",
    verb: "create",
    repoId: input.request.repoId,
    ...(state.openFailure === null ? {} : { openFailed: state.openFailure }),
    // A repair provisions nothing, so this rides the create branch only:
    // a reattach rewrites a link to a directory git already registered.
    //
    // The id travels WITH the steps, on one outcome. Without it the
    // create notice carried no `worktreeId` at all, so the merge key
    // the provisioning message arrives under matched nothing and every
    // real create grew a second, invented notice (round-2 F017).
    ...(state.provisionedAt === undefined
      ? {}
      : {
          worktreeId: state.provisionedAt,
          provision: {
            path: state.provisionedAt,
            steps: state.provisioned ?? [],
            ports: state.allocatedPorts ?? [],
            ...(state.portWarnings.length === 0 ? {} : { portWarnings: state.portWarnings }),
            ...(state.setupOutcome === undefined ? {} : { setup: state.setupOutcome.steps }),
            ...(state.setupOutcome?.outputId === undefined ? {} : { setupOutputId: state.setupOutcome.outputId }),
            ...(state.manifestWarning === undefined ? {} : { manifestWarning: state.manifestWarning }),
          },
        }),
    // Only a SURFACE can open a terminal — it needs a view id and a
    // webview (D2). The host performs it on the origin.
    ...(input.request.afterCreate.kind === "terminal" ? { openTerminalAt: input.worktreePath } : {}),
  };
}

async function provisionCreated(deps: CreateProvisioningDeps, input: ProvisionCreatedInput): Promise<MutationOutcome> {
  const wanted = input.request.provision ?? [];
  const state: CreateProvisionState = {
    wanted,
    wantedEntries: wanted.map(provisionEntryOf),
    wantedPorts: input.request.ports ?? [],
    wantedSetup: input.request.setup ?? [],
    sourceAuthorization: undefined,
    destinationAuthorization: undefined,
    provisioned: undefined,
    allocatedPorts: undefined,
    setupOutcome: undefined,
    portWarnings: [],
    manifestWarning: undefined,
    provisionedAt: undefined,
    // Reported after the create's own outcome, never in place of it: the
    // worktree exists whether or not a window opened (round-3 W7).
    openFailure: null,
  };
  const migrationFailure = await prepareMigration(deps, input);
  if (migrationFailure !== undefined) {
    return migrationFailure;
  }
  await applyMaterials(deps, input, state);
  await runSetupAndLaunch(deps, input, state);
  return settleProvisioning(deps, input, state);
}

export function createCreateProvisioning(deps: CreateProvisioningDeps): CreateProvisioning {
  return {
    provisionCreated: (input) => provisionCreated(deps, input),
  };
}
