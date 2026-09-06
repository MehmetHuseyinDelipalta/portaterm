// src/worktree/mutationService/setupExecution.ts — Running provision setup, and
// the rotating one-shot authority that lets it be run again.
//
// Extracted from `createWorktreeMutationService` by change
// `decompose-worktree-mutation-service` (design.md D1, D3, task 1_1).
//
// The retry authority is one-shot because `retrySetup` ROTATES it before
// queueing: a double click cannot enqueue the same authority twice. That
// property is the conjunction of three things — the map, the key function and
// the id minting — so all three live here and the facade holds none of them.
//
// The first draft of this cut moved only the map. It was unexecutable: the map
// is written from three sites outside `retrySetup` — the reconciliation, and
// create-proper's delete-then-mint-and-insert. Two of those are why `register`
// and `forgetAbsent` exist below; create-proper stays in the facade and mints
// through `register`, so the id is always minted where the map is.

import type { WorktreeMutationTarget, WorktreeSurface } from "../../providers/WorktreeHost";
import type {
  ProvisionPortResult,
  ProvisionSetupResult,
  ProvisionSetupStep,
  ProvisionStepResult,
  WorktreeProvisionResultMessage,
} from "../../types/messages";
import type { AuthorizedDirectory } from "../../utils/authorizedDirectory";
import { normalizePathForCompare } from "../../utils/pathBoundary";
import { messageOf } from "../errorMessage";
import type { MutationCoordinator } from "../mutationCoordinator";
import type { ResolvedTarget, SetupExecutionInput, SetupExecutionOutcome } from "../worktreeMutationService";

/** One live retry authority, and everything re-running setup needs. */
export interface SetupRetryRecord {
  readonly repoId: string;
  readonly worktreeId: string;
  readonly worktreePath: string;
  readonly incarnation: string;
  readonly mainPath: string;
  readonly branch: string;
  readonly steps: readonly ProvisionSetupStep[];
  readonly asimovEnvironment: boolean;
  readonly ports: Readonly<Record<string, number>>;
  readonly authorization: AuthorizedDirectory;
  readonly materialized: readonly ProvisionStepResult[];
  readonly portResults: readonly ProvisionPortResult[];
  retryId: string;
}

/** What create-proper stages before it knows the incarnation to bind it to. */
export interface PendingSetupRetry extends Omit<SetupRetryRecord, "incarnation" | "retryId"> {}

export interface SetupExecutionDeps {
  readonly coordinator: MutationCoordinator;
  newSetupRetryId(): string;
  resolve(target: WorktreeMutationTarget): ResolvedTarget | null;
  runSetup?(input: SetupExecutionInput, origin?: WorktreeSurface): Promise<SetupExecutionOutcome>;
  writeProvisionManifest?(
    worktreePath: string,
    steps: readonly ProvisionStepResult[],
    ports: readonly ProvisionPortResult[],
    setup: readonly ProvisionSetupResult[],
  ): Promise<{ readonly warning?: string }>;
  retireSetupOutput?(worktreeId: string): void;
  reportProvisioning?(message: WorktreeProvisionResultMessage, origin?: WorktreeSurface): void;
}

export interface SetupExecution {
  /** Every step reported failed, or skipped behind the first that failed. */
  failedSetup(steps: readonly ProvisionSetupStep[], reason: string): readonly ProvisionSetupResult[];
  portEnvironment(ports: readonly ProvisionPortResult[]): Readonly<Record<string, number>>;
  executeSetup(input: SetupExecutionInput, origin?: WorktreeSurface): Promise<SetupExecutionOutcome>;
  writeManifest(
    worktreePath: string,
    steps: readonly ProvisionStepResult[],
    ports: readonly ProvisionPortResult[],
    setup: readonly ProvisionSetupResult[],
  ): Promise<string | undefined>;

  /**
   * Publish a retry authority for a create that just finished, and return the id
   * it minted — or `null` where the worktree that came back is not the one the
   * setup ran against.
   *
   * One call rather than a delete and an insert the caller sequences: minting
   * belongs where the map is (D3), so a caller cannot hold an id this module
   * never recorded.
   */
  register(repoId: string, worktreeId: string, pending: PendingSetupRetry | undefined): string | null;

  /** Spend one authority to repeat setup for the same live worktree. */
  retrySetup(target: WorktreeMutationTarget, retryId: string): Promise<void>;

  /** The setup half of the service's reconciliation (D1b). */
  forgetAbsent(present: ReadonlySet<string>): void;

  /** Test seam: the keys currently holding an authority. */
  heldKeys(): readonly string[];
}

/**
 * Namespaced by BOTH ids. A key that carried only the worktree would let an
 * authority issued for one repository be spent against another — no existing
 * case in the service suite uses two repositories, so nothing there would move.
 */
export function retryKey(repoId: string, worktreeId: string): string {
  return JSON.stringify([repoId, worktreeId]);
}

export function createSetupExecution(deps: SetupExecutionDeps): SetupExecution {
  const setupRetries = new Map<string, SetupRetryRecord>();

  const failedSetup = (steps: readonly ProvisionSetupStep[], reason: string): readonly ProvisionSetupResult[] =>
    steps.map((step, index) => ({
      id: step.id,
      source: step.source,
      script: step.script,
      outcome:
        index === 0
          ? { kind: "failed" as const, reason }
          : { kind: "skipped" as const, reason: "previous setup step failed" },
    }));

  const portEnvironment = (ports: readonly ProvisionPortResult[]): Readonly<Record<string, number>> => {
    const environment: Record<string, number> = Object.create(null);
    for (const port of ports) {
      if (port.outcome.kind === "allocated" || port.outcome.kind === "reused") {
        environment[port.name] = port.outcome.port;
      }
    }
    return environment;
  };

  const executeSetup = async (input: SetupExecutionInput, origin?: WorktreeSurface): Promise<SetupExecutionOutcome> => {
    if (deps.runSetup === undefined) {
      return { steps: failedSetup(input.steps, "this window cannot run setup"), succeeded: false };
    }
    return deps.runSetup(input, origin).catch((error: unknown) => ({
      steps: failedSetup(input.steps, messageOf(error)),
      succeeded: false,
    }));
  };

  const writeManifest = async (
    worktreePath: string,
    steps: readonly ProvisionStepResult[],
    ports: readonly ProvisionPortResult[],
    setup: readonly ProvisionSetupResult[],
  ): Promise<string | undefined> => {
    if (deps.writeProvisionManifest === undefined) {
      return undefined;
    }
    try {
      return (await deps.writeProvisionManifest(worktreePath, steps, ports, setup)).warning;
    } catch (error) {
      return `the provisioning manifest could not be written: ${messageOf(error)}`;
    }
  };

  return {
    failedSetup,
    portEnvironment,
    executeSetup,
    writeManifest,

    register(repoId, worktreeId, pending) {
      const key = retryKey(repoId, worktreeId);
      setupRetries.delete(key);
      if (pending === undefined) {
        return null;
      }
      const current = deps.resolve({ repoId, worktreeId });
      if (
        current === null ||
        normalizePathForCompare(current.worktreePath) !== normalizePathForCompare(pending.worktreePath)
      ) {
        return null;
      }
      const retryId = deps.newSetupRetryId();
      setupRetries.set(key, { ...pending, incarnation: current.incarnation, retryId });
      return retryId;
    },

    retrySetup(target, retryId) {
      const key = retryKey(target.repoId, target.worktreeId);
      const held = setupRetries.get(key);
      if (held === undefined || held.retryId !== retryId) {
        return Promise.resolve();
      }
      // Spend before queueing, so a double click cannot enqueue the same authority twice.
      held.retryId = deps.newSetupRetryId();
      deps.retireSetupOutput?.(held.worktreeId);
      return deps.coordinator
        .run<ResolvedTarget, WorktreeProvisionResultMessage | null>(target.repoId, {
          resolve: async () => deps.resolve(target),
          missing: async () => null,
          body: async (resolved) => {
            if (
              resolved.incarnation !== held.incarnation ||
              normalizePathForCompare(resolved.worktreePath) !== normalizePathForCompare(held.worktreePath)
            ) {
              return null;
            }
            const setup = await executeSetup(
              {
                repoId: held.repoId,
                mainPath: held.mainPath,
                worktreeId: held.worktreeId,
                worktreePath: held.worktreePath,
                branch: held.branch,
                steps: held.steps,
                asimovEnvironment: held.asimovEnvironment,
                ports: held.ports,
                authorization: held.authorization,
              },
              target.origin,
            );
            const manifestWarning = await writeManifest(
              held.worktreePath,
              held.materialized,
              held.portResults,
              setup.steps,
            );
            if (setup.succeeded) {
              setupRetries.delete(key);
            }
            return {
              type: "worktreeProvisionResult",
              worktreeId: held.worktreeId,
              setup: setup.steps,
              ...(setup.outputId === undefined ? {} : { setupOutputId: setup.outputId }),
              ...(setup.succeeded ? {} : { setupRetryId: held.retryId }),
              ...(manifestWarning === undefined ? {} : { manifestWarning }),
            };
          },
        })
        .then(
          (outcome) => {
            if (outcome === null) {
              setupRetries.delete(key);
              deps.reportProvisioning?.(
                {
                  type: "worktreeProvisionResult",
                  worktreeId: held.worktreeId,
                  setup: failedSetup(held.steps, "the worktree identity changed before setup retry"),
                },
                target.origin,
              );
              return;
            }
            deps.reportProvisioning?.(outcome, target.origin);
          },
          (error: unknown) => {
            setupRetries.delete(key);
            deps.reportProvisioning?.(
              {
                type: "worktreeProvisionResult",
                worktreeId: held.worktreeId,
                setup: failedSetup(held.steps, messageOf(error)),
              },
              target.origin,
            );
          },
        );
    },

    forgetAbsent(present) {
      for (const [key, retry] of setupRetries) {
        if (!present.has(retry.worktreeId)) {
          setupRetries.delete(key);
        }
      }
    },

    heldKeys: () => [...setupRetries.keys()],
  };
}
