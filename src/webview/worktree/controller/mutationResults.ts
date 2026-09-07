// src/webview/worktree/controller/mutationResults.ts — What a finished mutation
// says, the removal assessment asked before one runs, and the re-scoping that
// keeps a notice pointing at something the tree still holds.
//
// Extracted from `WorktreeController` by change `decompose-worktree-view`
// (design.md D1, task 3_4). `rescope` is applied at BOTH doors — an arriving
// result and an arriving tree — and it sat 300 lines from one of them.
//
// `actionResults` itself does NOT come: thirteen suite sites read it off the
// controller instance, so the list stays a field and this module reads and
// writes it through accessors (D5).

import type {
  WebViewToExtensionMessage,
  WorktreeMutationResultMessage,
  WorktreeProvisionResultMessage,
  WorktreeRemoveAssessmentMessage,
} from "../../../types/messages";
import type { WorktreeActionResult, WorktreeInfo, WorktreeRemoveReport, WorktreeTree } from "../worktreeViewTypes";

export interface MutationResultsDeps {
  postMessage(msg: WebViewToExtensionMessage): void;
  /** The notice list, which stays a controller field (D5). */
  actionResults(): WorktreeActionResult[];
  setActionResults(next: WorktreeActionResult[]): void;
  /** The tree these notices are scoped against. Owned by `treeReconcile`. */
  tree(): WorktreeTree | null;
  /** Labels of rows that have left, for a notice that outlived its row. */
  departed(): Map<string, string>;
  infoOf(worktreeId: string): WorktreeInfo | undefined;
  repoFor(info: WorktreeInfo): { repoId: string; prunableCount: number } | undefined;
  openPruneDialog(seed: { repoLabel: string; count: number }, onConfirm: (confirmed: number) => void): void;
  openRemoveReport(info: WorktreeInfo, report: WorktreeRemoveReport): void;
  push(): void;
}

/** The one assess this surface may be waiting on, and the counter behind it. */
interface AssessState {
  /**
   * The assess this surface is still waiting on, if any. At most one: a second
   * request for the same worktree is dropped rather than queued, because each
   * one holds the host's per-repo mutation queue across two forced rebuilds and
   * the reads between them (D10).
   */
  liveAssess: { token: string; worktreeId: string } | null;
  assessSeq: number;
}

/** Stable identity across attached, pending-arrival, and departed notice scopes. */
function actionResultIdentity(result: WorktreeActionResult): string | undefined {
  return result.worktreeId ?? result.canonicalId ?? result.orphanedLabel;
}

/**
 * The host's outcome as the panel renders it.
 *
 * `blocked` is not a failure: the host declined to act and handed back the
 * blocker set it assessed, so the notice reopens the confirmation bound to that
 * exact set rather than reporting a dead end. A `null` fingerprint means the
 * set is a refusal — nothing can authorize it, and the dialog says so.
 */
function toActionResult(msg: WorktreeMutationResultMessage): WorktreeActionResult {
  // A worktree-scoped result hangs on its row, a repo-scoped one on the repo —
  // `resultsFor` reads the repo branch only when no worktreeId is present. The
  // repo id rides along regardless, because the indeterminate notice's Prune
  // needs a repository to act on.
  const scope = {
    repoId: msg.repoId,
    ...(msg.worktreeId === undefined ? {} : { worktreeId: msg.worktreeId }),
  };
  switch (msg.result.kind) {
    case "ok":
      return {
        action: msg.verb,
        ...scope,
        outcome: "ok",
        ...(msg.result.openFailed === undefined ? {} : { openFailed: msg.result.openFailed }),
        ...(msg.result.migrationIndeterminate === undefined
          ? {}
          : { migrationIndeterminate: msg.result.migrationIndeterminate }),
        ...(msg.result.branchDelete === undefined ? {} : { branchDelete: msg.result.branchDelete }),
      };
    case "indeterminate":
      return { action: msg.verb, ...scope, outcome: "indeterminate", observed: msg.result.observed };
    case "unavailable":
      return { action: msg.verb, ...scope, outcome: "unavailable", unreadable: msg.result.unreadable };
    case "blocked":
      return {
        action: "remove",
        repoId: msg.repoId,
        worktreeId: msg.result.worktreeId,
        outcome: "error",
        needsConfirm: { ...msg.result.assessment, fingerprint: msg.result.fingerprint },
      };
    default:
      return { action: msg.verb, ...scope, outcome: "error", error: msg.result.message };
  }
}

/**
 * Open prune's confirmation, and post only what the user confirmed there.
 *
 * The count is re-read from the tree at the moment the dialog opens, and the
 * host re-counts authoritatively inside its queue: this number's job is to be
 * the one the user SAW, so a prune that would drop a different number is
 * abandoned rather than silently widened (D13).
 */
function confirmPrune(deps: MutationResultsDeps, repoId: string): void {
  const repo = deps.tree()?.repos.find((r) => r.repoId === repoId);
  if (repo === undefined) {
    return;
  }
  const count = repo.worktrees.filter((w) => w.prunable).length;
  if (count <= 0) {
    return;
  }
  deps.openPruneDialog({ repoLabel: repo.label, count }, (confirmed) => {
    deps.postMessage({ type: "worktreePrune", repoId, confirmedCount: confirmed });
  });
}

/**
 * What a mutation this surface started actually did. One notice per scope and
 * verb: a second attempt replaces the first rather than stacking, because the
 * older result no longer describes the tree.
 */
function handleMutationResult(deps: MutationResultsDeps, state: AssessState, msg: WorktreeMutationResultMessage): void {
  showActionResult(deps, state, toActionResult(msg));
}

/**
 * What provisioning did, folded onto the create notice that is already there.
 *
 * The host posts this immediately after the create's own result on one
 * ordered channel, so the notice exists by the time this lands. Merged rather
 * than raised separately: `showActionResult` keys notices by action, worktree
 * and repo, so a second one would REPLACE the create's rather than sit beside
 * it. If the create notice is somehow gone, this reports on its own rather
 * than being dropped — a user who is told nothing cannot tell "nothing was
 * brought over" from "nobody looked".
 */
function handleProvisionResult(
  deps: MutationResultsDeps,
  state: AssessState,
  msg: WorktreeProvisionResultMessage,
): void {
  // Matched on the id the create ARRIVED under. `rescope` drops a `worktreeId`
  // the tree does not carry yet and keeps it as the orphaned label, and a
  // worktree made a moment ago is precisely that until the next rebuild lands
  // — so the id-only key missed on every real create, which is what made the
  // service supplying an id (round-2 F017) only half the fix.
  const exact = deps
    .actionResults()
    .find((result) => result.action === "create" && actionResultIdentity(result) === msg.worktreeId);
  const departedLabel = deps.departed().get(msg.worktreeId);
  const departed =
    exact === undefined && msg.steps === undefined && departedLabel !== undefined
      ? deps
          .actionResults()
          .find(
            (result) =>
              result.action === "create" &&
              result.worktreeId === undefined &&
              result.canonicalId === undefined &&
              result.orphanedLabel === departedLabel,
          )
      : undefined;
  const existing = exact ?? departed;
  const fallback: WorktreeActionResult =
    msg.steps === undefined
      ? { action: "create", orphanedLabel: departedLabel ?? msg.worktreeId, outcome: "ok" }
      : { action: "create", worktreeId: msg.worktreeId, outcome: "ok" };
  showActionResult(deps, state, {
    ...(existing ?? fallback),
    ...(msg.steps === undefined ? {} : { provisioned: msg.steps }),
    ...(msg.ports === undefined ? {} : { ports: msg.ports }),
    ...(msg.portWarnings === undefined ? {} : { portWarnings: msg.portWarnings }),
    ...(msg.contests === undefined ? {} : { provisionContests: msg.contests }),
    setup: msg.setup,
    setupOutputId: msg.setupOutputId,
    setupRetryId: msg.setupRetryId,
    manifestWarning: msg.manifestWarning,
  });
}

/**
 * Mint the token this request will be answered under, replacing whatever was
 * live (design.md D4).
 *
 * It REFUSES NOTHING. A same-worktree repeat used to be dropped here, as the
 * bound on host work; the panel could never be that bound — it sees one
 * surface and one worktree id, so alternating rows walked past it (round-6
 * B5) — and refusing the repeat is what made a dropped reply permanent,
 * because the re-ask that would recover the row was the thing suppressed
 * (round-6 W6). Admission is the host's, per repository.
 *
 * The token orders answers and authorizes nothing: a reply carrying a stale
 * one is discarded rather than trusted for any part of itself (D11), and
 * `liveAssess` is one field, so at most one is ever live.
 */
function beginAssess(state: AssessState, worktreeId: string): string {
  state.assessSeq += 1;
  const token = `assess-${state.assessSeq}`;
  state.liveAssess = { token, worktreeId };
  return token;
}

/** Ask what a removal would cost, under a token this surface can recognise. */
function askRemoval(deps: MutationResultsDeps, state: AssessState, worktreeId: string): void {
  deps.postMessage({ type: "worktreeRemoveAssess", worktreeId, token: beginAssess(state, worktreeId) });
}

/** One notice per scope and verb, wherever the outcome came from. */
function showActionResult(deps: MutationResultsDeps, state: AssessState, raw: WorktreeActionResult): void {
  const result = rescope(deps, raw);
  // Keyed on the CANONICAL identity, not on the field that happens to hold it.
  // `rescope` moves a `worktreeId` the tree has not seen yet into
  // `orphanedLabel`, and a worktree made a moment ago is exactly that — so two
  // creates in one repository both keyed as `undefined` and the second ate the
  // first (.reviews/round-4.md F017).
  deps.setActionResults([
    ...deps
      .actionResults()
      .filter(
        (candidate) =>
          !(
            candidate.action === result.action &&
            actionResultIdentity(candidate) === actionResultIdentity(result) &&
            candidate.repoId === result.repoId
          ),
      ),
    result,
  ]);
  deps.push();
}

/**
 * What the removal WOULD cost, answered before anything is deleted (D6).
 *
 * The two arms are different questions and the discriminant is what keeps them
 * apart. `checksFor` marks the whole catalogue `unproven` for an assessment it
 * could not make, refusal-class checks included, so rendering that as a report
 * would show a worktree the host merely could not READ as a hard refusal with
 * no control at all (D8). It goes to the retry surface instead, which is where
 * the host's own `unavailable` already goes.
 */
function handleRemoveAssessment(
  deps: MutationResultsDeps,
  state: AssessState,
  msg: WorktreeRemoveAssessmentMessage,
): void {
  // Whatever its worktreeId. An id-only guard cannot order two requests for
  // the SAME worktree, and reply 1 landing after request 2 would still open
  // (D11).
  if (state.liveAssess === null || state.liveAssess.token !== msg.token) {
    return;
  }
  state.liveAssess = null;
  const info = deps.infoOf(msg.worktreeId);
  if (msg.result.kind === "unavailable") {
    const repoId = info === undefined ? undefined : deps.repoFor(info)?.repoId;
    showActionResult(deps, state, {
      action: "remove",
      worktreeId: msg.worktreeId,
      ...(repoId === undefined ? {} : { repoId }),
      outcome: "unavailable",
      unreadable: msg.result.unreadable,
    });
    return;
  }
  if (info === undefined) {
    // The row left the tree while the host was reading it. Opening a report
    // about a worktree the panel no longer shows would ask the user to
    // authorize a deletion they cannot see the target of.
    return;
  }
  deps.openRemoveReport(info, { ...msg.result.assessment, fingerprint: msg.result.fingerprint });
}

/**
 * The tab bar dropped its scope because the worktree left the tree. Reported
 * through the panel's own notice list — the one place this panel says what
 * happened — rather than a second channel the user has to learn (design.md D7).
 */
function reportScopeCleared(deps: MutationResultsDeps, state: AssessState, worktreeId: string, label: string): void {
  stageScopeCleared(deps, worktreeId, label);
  deps.push();
}

/**
 * The same statement, without the repaint. The seam stages it before handing the
 * tree over, so ONE push carries the notice and the tree that caused it — the
 * notice is never painted beside the row it contradicts, and the panel is not
 * rebuilt twice for one event (round-2 V5).
 */
function stageScopeCleared(deps: MutationResultsDeps, worktreeId: string, label: string): void {
  deps.setActionResults([
    ...deps.actionResults().filter((r) => !(r.action === "scope" && r.worktreeId === worktreeId)),
    { action: "scope", worktreeId, outcome: "ok", orphanedLabel: label },
  ]);
}

/**
 * A result whose row is not in the tree is re-scoped to its repository.
 *
 * Applied at BOTH doors — an arriving result and an arriving tree — because
 * which one comes second is not the controller's choice.
 */
function rescope(
  deps: MutationResultsDeps,
  result: WorktreeActionResult,
  present?: ReadonlySet<string>,
): WorktreeActionResult {
  const worktreeId = result.worktreeId ?? result.canonicalId;
  if (worktreeId === undefined) {
    return result;
  }
  if (present === undefined && deps.tree() === null) {
    // No tree is not an empty tree. Re-scoping here would orphan every notice
    // that arrives before the first rebuild lands.
    return result;
  }
  const rows = present ?? new Set((deps.tree()?.repos ?? []).flatMap((r) => r.worktrees.map((w) => w.id)));
  if (rows.has(worktreeId)) {
    // Both directions, because a create's notice arrives BEFORE the row it is
    // about: every real create is re-scoped first and reattached here, and a
    // one-way move left it at the repository anchor forever, still counted
    // against the orphan bound that can evict it (round-5 F017).
    const { canonicalId: _identity, orphanedLabel: _shown, ...named } = result;
    return { ...named, worktreeId };
  }
  const label = result.orphanedLabel ?? deps.departed().get(worktreeId);
  const pendingCanonical = result.worktreeId === undefined ? result.canonicalId : undefined;
  const { canonicalId: _identity, worktreeId: _gone, ...rest } = result;
  return {
    ...rest,
    // A pending create keeps its identity through any number of tree pushes
    // that still lack its row. An attached notice has `worktreeId`, so when
    // that row actually departs reconciliation strips identity instead.
    ...(pendingCanonical !== undefined
      ? { canonicalId: pendingCanonical }
      : result.action === "create" && present === undefined
        ? { canonicalId: worktreeId }
        : {}),
    orphanedLabel: label ?? worktreeId,
  };
}
export interface MutationResults {
  /** Open prune's confirmation, and post only what the user confirmed there. */
  confirmPrune(repoId: string): void;
  handleMutationResult(msg: WorktreeMutationResultMessage): void;
  handleProvisionResult(msg: WorktreeProvisionResultMessage): void;
  /** Mint the token this request will be answered under (design.md D4, D11). */
  beginAssess(worktreeId: string): string;
  /** Ask what a removal would cost, under a token this surface can recognise. */
  askRemoval(worktreeId: string): void;
  /** One notice per scope and verb, wherever the outcome came from. */
  showActionResult(raw: WorktreeActionResult): void;
  handleRemoveAssessment(msg: WorktreeRemoveAssessmentMessage): void;
  reportScopeCleared(worktreeId: string, label: string): void;
  stageScopeCleared(worktreeId: string, label: string): void;
  /** A result whose row is not in the tree is re-scoped to its repository. */
  rescope(result: WorktreeActionResult, present?: ReadonlySet<string>): WorktreeActionResult;
  /**
   * Retire the outstanding assess. Any dialog opening does this: what the user
   * is looking at now is the answer to a newer question (D11).
   */
  retireAssess(): void;
}

export function createMutationResults(deps: MutationResultsDeps): MutationResults {
  const state: AssessState = { liveAssess: null, assessSeq: 0 };

  return {
    confirmPrune: (repoId) => {
      confirmPrune(deps, repoId);
    },
    handleMutationResult: (msg) => {
      handleMutationResult(deps, state, msg);
    },
    handleProvisionResult: (msg) => {
      handleProvisionResult(deps, state, msg);
    },
    beginAssess: (worktreeId) => beginAssess(state, worktreeId),
    askRemoval: (worktreeId) => {
      askRemoval(deps, state, worktreeId);
    },
    showActionResult: (raw) => {
      showActionResult(deps, state, raw);
    },
    handleRemoveAssessment: (msg) => {
      handleRemoveAssessment(deps, state, msg);
    },
    reportScopeCleared: (worktreeId, label) => {
      reportScopeCleared(deps, state, worktreeId, label);
    },
    stageScopeCleared: (worktreeId, label) => {
      stageScopeCleared(deps, worktreeId, label);
    },
    rescope: (result, present) => rescope(deps, result, present),
    retireAssess() {
      state.liveAssess = null;
    },
  };
}
