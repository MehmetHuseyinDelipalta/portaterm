// src/worktree/mutationService/createRun.ts — The create's control flow: two
// complete path validations on opposite sides of the coordinator wait.
//
// Extracted from `worktreeMutationService.ts` by change
// `decompose-mutation-service` (design.md D1, task 4_3). Every refusal stays
// before `clearDebris`, and the clearance stays immediately before Git create:
// moving either is the destructive-ordering defeater in OBL-6.
//
// The outer wrapper that disposes provision materials deliberately does NOT
// come. It stays in the composition root, where OBL-1's witness pins it.

import * as nodePath from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { WorktreeCreateMode } from "../../types/messages";
import { type ClearDebrisDeps, clearDebris } from "../clearDebris";
import { identityOf, intentFor, validateCreatePath } from "../createPath";
import { createDebrisAuthorizationStore, type DebrisAuthorizationStore } from "../debrisAuthorization";
import { messageOf } from "../errorMessage";
import type { MutationCoordinator } from "../mutationCoordinator";
import { branchNameIsValid, type CreateSource, createWorktree } from "../worktreeMutations";
import type { CreateProvisioning } from "./createProvisioning";
import { settled } from "./outcomes";
import type { createRegisterExisting } from "./registerExisting";
import type { MutationOutcome, MutationServiceDeps, WorktreeMutationService } from "./serviceTypes";
import type { createSetupExecution, PendingSetupRetry } from "./setupExecution";

type CreateRequest = Parameters<WorktreeMutationService["createWorktree"]>[0];

export interface CreateRunDeps {
  service: Pick<
    MutationServiceDeps,
    | "createContext"
    | "debrisAuthorizations"
    | "migrationRegistration"
    | "now"
    | "pathDeps"
    | "repoPath"
    | "report"
    | "runner"
  >;
  registerExisting: Pick<ReturnType<typeof createRegisterExisting>, "adopt" | "reattach">;
  coordinator: Pick<MutationCoordinator, "run">;
  clearDebrisDeps: ClearDebrisDeps;
  provisioning: CreateProvisioning;
  setup: Pick<ReturnType<typeof createSetupExecution>, "register">;
}

export interface CreateRun {
  createWorktree: WorktreeMutationService["createWorktree"];
  issueDebrisAuthorization: WorktreeMutationService["issueDebrisAuthorization"];
}

interface CreateRuntimeDeps extends CreateRunDeps {
  debrisAuthorizations: DebrisAuthorizationStore;
}

type FailCreate = (message: string) => MutationOutcome;
type CreateIntent = ReturnType<typeof intentFor>;
type ValidCreatePath = Extract<Awaited<ReturnType<typeof validateCreatePath>>, { ok: true }>;

interface PreparedCreate {
  intent: CreateIntent;
  first: ValidCreatePath;
}

async function prepareCreate(
  deps: CreateRuntimeDeps,
  request: CreateRequest,
  fail: FailCreate,
): Promise<PreparedCreate | undefined> {
  // PHASE 1 — before the queue. D6 wants two observations with the wait
  // BETWEEN them; validating only on the far side is one observation with a
  // wait in front of it, which cannot detect a change because it never saw
  // the earlier state (round-2 B4). This is the "earlier state".
  if (request.migration !== undefined && (request.mode.kind === "reattach" || request.mode.kind === "adopt")) {
    deps.service.report(fail("Migration is available only when creating a new checkout."), request.origin);
    return undefined;
  }
  // Adopt leaves before the create-path check, for the reason reattach does
  // and one more: `validateCreatePath` refuses an occupied destination, and
  // the surviving checkout IS the destination. An adoption creates nothing —
  // it writes the administrative entry git will not write (design.md D4).
  if (request.mode.kind === "adopt") {
    await deps.registerExisting.adopt(request, request.mode, fail);
    return undefined;
  }
  // Reattach leaves before the create-path check, not inside it.
  //
  // `validateCreatePath` answers "may a worktree be CREATED here", and one
  // of its rules is that the destination is not another worktree of this
  // repository — which the stale registration still is, so every reattach
  // would be refused by the check that exists to protect creates. A repair
  // creates nothing: it rewrites the link to a directory git already
  // registered. Its guard is D3's conditions, re-established below.
  if (request.mode.kind === "reattach") {
    await deps.registerExisting.reattach(request, request.mode, fail);
    return undefined;
  }
  const before = deps.service.createContext(request.repoId);
  if (before === null) {
    deps.service.report(fail("That repository is gone."), request.origin);
    return undefined;
  }
  // Resolved ONCE and used for both observations. Deriving it separately in
  // each phase would let the two checks disagree about what the destination
  // was supposed to be, which is the one thing the two-phase check exists to
  // detect.
  const intent = intentFor(request.mode, request.disposition);
  const first = await validateCreatePath(request.path, before, deps.service.pathDeps, intent, {
    allowedContainingWorktree: request.migration?.sourcePath,
  });
  if (!first.ok) {
    deps.service.report(fail(first.reason), request.origin);
    return undefined;
  }
  return { intent, first };
}

async function clearAuthorizedDebris(
  deps: CreateRuntimeDeps,
  fail: FailCreate,
  context: NonNullable<ReturnType<MutationServiceDeps["createContext"]>>,
  check: ValidCreatePath,
  intent: CreateIntent,
  migrationAuthorityIsCurrent: () => boolean,
): Promise<MutationOutcome | undefined> {
  if (intent.kind !== "mustMatchDebrisAuthorization") {
    return undefined;
  }
  // The clearance goes LAST, after every recheck and every question
  // that can still refuse — a directory deleted before a refusal is a
  // directory deleted for nothing. `clearDebris` re-takes the identity
  // reading itself: `branchNameIsValid` above awaited, so the phase-2
  // comparison no longer describes the moment of the delete (D3).
  if (!migrationAuthorityIsCurrent()) {
    return fail("The source repository changed while the create was queued. Please try again.");
  }
  const entries = await deps.service.pathDeps.readdir(check.path);
  if (entries === null) {
    // An unreadable directory is not an empty one. Redeeming it as
    // `[]` made it a subset of every approved set, so contents
    // nobody could inspect passed the comparison (round-1 B3). The
    // authorization goes with it: it was issued over a reading that
    // can no longer be taken.
    deps.debrisAuthorizations.forget(check.path);
    return fail("That directory could not be read, so it will not be cleared.");
  }
  const identity = identityOf(await deps.service.pathDeps.lstat(check.path));
  const verdict = deps.debrisAuthorizations.redeem(
    check.path,
    intent.authorization.fingerprint,
    { entries, identity },
    deps.service.now(),
  );
  if (verdict.kind !== "proceed") {
    return fail("That directory changed since it was shown to you. Please try again.");
  }
  // The APPROVED evidence travels, not this redemption's reading of
  // the moment: the boundary re-compares, and comparing against an
  // intermediate reading refused an approved entry that had vanished
  // and come back (round-1 B4, round-2 W4).
  const approvedIdentity = verdict.approved.identity;
  const cleared = await clearDebris(
    check.path,
    context,
    approvedIdentity === null ? null : { identity: approvedIdentity, entries: verdict.approved.entries },
    deps.clearDebrisDeps,
  );
  return cleared.ok ? undefined : fail(cleared.reason);
}

function pathMoved(check: ValidCreatePath, first: ValidCreatePath, identity: string | null): boolean {
  return (
    check.recheckPath !== first.recheckPath ||
    check.mustBeEmpty !== first.mustBeEmpty ||
    identity !== first.recheckIdentity
  );
}

async function runQueuedCreate(
  deps: CreateRuntimeDeps,
  request: CreateRequest,
  fail: FailCreate,
  prepared: PreparedCreate,
  setPendingSetupRetry: (retry: PendingSetupRetry) => void,
  repoPath: string,
): Promise<MutationOutcome> {
  const context = deps.service.createContext(request.repoId);
  if (context === null) {
    return fail("That repository is gone.");
  }
  // PHASE 2 — the FULL check again, not a spot-check. Lexical walk,
  // normalization, containment, type and emptiness all re-run here,
  // because any of them can have changed during the wait.
  const check = await validateCreatePath(request.path, context, deps.service.pathDeps, prepared.intent, {
    allowedContainingWorktree: request.migration?.sourcePath,
  });
  if (!check.ok) {
    return fail(check.reason);
  }
  if (check.path !== prepared.first.path) {
    // The same input string now normalizes somewhere else, which means
    // something in the ancestry was replaced.
    return fail("That location changed while the action was queued. Please try again.");
  }
  const stat = await deps.service.pathDeps.lstat(check.recheckPath);
  if (pathMoved(check, prepared.first, identityOf(stat))) {
    return fail("That location changed while the action was queued. Please try again.");
  }
  // Emptiness is re-asked of the CURRENT observation, not inherited
  // from phase 1 — `mustBeEmpty` was never consumed a second time.
  if (check.mustBeEmpty) {
    const entries = await deps.service.pathDeps.readdir(check.recheckPath);
    if (entries === null || entries.length > 0) {
      return fail("That directory is no longer empty.");
    }
  }
  // Before anything is created: git's own answer, so an invalid name
  // fails as a name rather than as a half-finished worktree (W9).
  const named = branchOf(request.mode);
  if (named !== undefined && (await branchNameIsValid(deps.service.runner, repoPath, named)) === false) {
    return fail(`Git will not accept "${named}" as a branch name.`);
  }
  const migrationAuthorityIsCurrent = (): boolean =>
    request.migration === undefined ||
    isDeepStrictEqual(deps.service.migrationRegistration?.(request.repoId), request.migration.binding.registration);
  const clearanceFailure = await clearAuthorizedDebris(
    deps,
    fail,
    context,
    check,
    prepared.intent,
    migrationAuthorityIsCurrent,
  );
  if (clearanceFailure !== undefined) {
    return clearanceFailure;
  }
  if (!migrationAuthorityIsCurrent()) {
    return fail("The source repository changed while the create was queued. Please try again.");
  }
  const result = await createWorktree(deps.service.runner, {
    repoPath,
    worktreePath: check.path,
    source: sourceOf(request.mode),
  });
  if (!result.ok) {
    return settled("create", request.repoId, result);
  }
  return deps.provisioning.provisionCreated({
    request,
    repoPath,
    worktreePath: check.path,
    setPendingSetupRetry,
  });
}

async function runCreate(deps: CreateRuntimeDeps, request: CreateRequest): Promise<void> {
  const fail: FailCreate = (message) => ({ kind: "error", verb: "create", repoId: request.repoId, message });
  const prepared = await prepareCreate(deps, request, fail);
  if (prepared === undefined) {
    return;
  }
  let pendingSetupRetry: PendingSetupRetry | undefined;
  await deps.coordinator
    .run<string, MutationOutcome>(request.repoId, {
      resolve: async () => deps.service.repoPath(request.repoId),
      body: (repoPath) =>
        runQueuedCreate(
          deps,
          request,
          fail,
          prepared,
          (retry) => {
            pendingSetupRetry = retry;
          },
          repoPath,
        ),
    })
    .then(
      (outcome) => {
        let reported = outcome;
        if (outcome.kind === "ok" && outcome.worktreeId !== undefined && outcome.provision !== undefined) {
          // The retire and mint-and-insert are one decision where the map lives.
          const retryId = deps.setup.register(request.repoId, outcome.worktreeId, pendingSetupRetry);
          if (retryId !== null) {
            reported = { ...outcome, provision: { ...outcome.provision, setupRetryId: retryId } };
          }
        }
        deps.service.report(reported, request.origin);
      },
      (error: unknown) => deps.service.report(fail(messageOf(error)), request.origin),
    );
}

async function issueDebrisAuthorization(deps: CreateRuntimeDeps, path: string) {
  // ONE observation answers both halves: what the offer states and what the
  // token binds. Reading twice would let them disagree (design.md D6).
  const stat = await deps.service.pathDeps.lstat(path);
  const identity = identityOf(stat);
  if (stat === null || !stat.isDirectory() || identity === null) {
    return { ok: false as const, because: "unreadable" as const };
  }
  const git = deps.clearDebrisDeps.probeEntry(nodePath.join(path, ".git"));
  if (git !== "absent") {
    return { ok: false as const, because: git === "present" ? ("notDebris" as const) : ("unreadable" as const) };
  }
  const entries = await deps.service.pathDeps.readdir(path);
  if (entries === null) {
    return { ok: false as const, because: "unreadable" as const };
  }
  return {
    ok: true as const,
    fingerprint: deps.debrisAuthorizations.issue(path, { entries, identity }, deps.service.now()),
    entries,
  };
}

/** The branch this create would CREATE, or undefined. */
function branchOf(mode: WorktreeCreateMode): string | undefined {
  return mode.kind === "fresh" ? mode.branch : undefined;
}

/**
 * The wire mode, in git's own vocabulary. A TOTAL map, with no inference.
 *
 * This used to read the request's optional fields and guess: `newBranch` only
 * when `baseRef` happened to be present, `existingBranch` otherwise. The
 * new-branch and existing-branch modes were indistinguishable on the wire, so
 * the ordinary create — a new branch, no base ref — became
 * `git worktree add <path> <branch>` against a branch nobody had made, and git
 * answered `fatal: invalid reference`. There is nothing left here to guess with.
 *
 * `reattach` and `adopt` are not `git worktree add` at all; they throw rather
 * than resolve, and WT-012.15 is where they get their own commands.
 */
function sourceOf(mode: WorktreeCreateMode): CreateSource {
  switch (mode.kind) {
    case "fresh":
      return {
        kind: "newBranch",
        branch: mode.branch,
        ...(mode.baseRef === undefined ? {} : { baseRef: mode.baseRef }),
      };
    case "fresh-detached":
      return { kind: "detached", ref: mode.baseRef };
    case "reuse":
      return { kind: "existingBranch", branch: mode.branch };
    case "reattach":
    case "adopt":
      throw new Error(`"${mode.kind}" is not a git worktree add; it has no CreateSource.`);
  }
}

export function createCreateRun(deps: CreateRunDeps): CreateRun {
  const runtime: CreateRuntimeDeps = {
    ...deps,
    debrisAuthorizations: deps.service.debrisAuthorizations ?? createDebrisAuthorizationStore(),
  };
  return {
    createWorktree: (request) => runCreate(runtime, request),
    issueDebrisAuthorization: (path) => issueDebrisAuthorization(runtime, path),
  };
}
