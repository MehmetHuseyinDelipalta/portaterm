// src/webview/worktree/worktreeView/actionNotices.ts — Turning an action result
// into the notice the user reads, and taking it away again.
//
// Extracted from `WorktreeView` by change `decompose-worktree-webview`
// (design.md D1, task 1_3). The `autoDismiss` map came with it, and so did the
// clearing `dispose` used to do inline — a timer whose owner moved but whose
// disposal did not is exactly the leak OBL-3 is about.
//
// `infoFor` came too: `placeResults` is its only caller.

import type { WorktreeViewData, WorktreeViewDeps } from "../WorktreeView";
import { branchLabel } from "../worktreeFormat";
import { type NoticeSpec, renderNotice } from "../worktreeTreeView";
import type { WorktreeActionResult, WorktreeInfo, WorktreeRemoveReport, WorktreeRepo } from "../worktreeViewTypes";
import { portSummary, provisionSummary, setupSummary } from "./actionNotices/summaries";

export interface ActionNoticesDeps {
  /** Read, not captured: the view replaces its data on every push. */
  data(): WorktreeViewData;
  element(): HTMLElement;
  disposed(): boolean;
  /** The view's own deps, for the callbacks a notice's buttons invoke. */
  view: WorktreeViewDeps;
  repoOf(info: WorktreeInfo): WorktreeRepo | undefined;
  repoAnchors: Map<string, HTMLElement>;
  renderedWorktreeRows(): Map<string, HTMLElement>;
  openRemoveReport(info: WorktreeInfo, report: WorktreeRemoveReport): void;
}

export interface ActionNotices {
  placeResults(): void;
  /** Clear every armed timer. The view's `dispose` calls this and nothing else. */
  dispose(): void;
  /** Test seam: which results still hold a timer. */
  armedKeys(): readonly string[];
}

export function createActionNotices(deps: ActionNoticesDeps): ActionNotices {
  const autoDismiss = new Map<string, ReturnType<typeof setTimeout> | "held">();

  /**
   * The ONE place a result becomes a notice. Deliberately blind to every display
   * rule: it asks the DOM which rows were actually drawn rather than re-deciding
   * what `shownWorktrees` decided. Three earlier attempts each put this judgement
   * inside a branch that decides what to DRAW — the lead loop, the folded tail,
   * the cap — and each left a different hole. A rule added later cannot open a
   * new one here, because this pass never learns the rules exist.
   */
  function placeResults(): void {
    const results = deps.data().actionResults ?? [];
    pruneAutoDismiss(results);
    if (results.length === 0) {
      return;
    }
    const drawn = deps.renderedWorktreeRows();
    // Several results can share one anchor, so each insert walks the cursor
    // forward; appending them all `after` the same node would reverse them.
    const cursors = new Map<HTMLElement, HTMLElement>();
    for (const result of results) {
      const row = result.worktreeId === undefined ? undefined : drawn.get(result.worktreeId);
      const info = result.worktreeId === undefined ? undefined : infoFor(result.worktreeId);
      // A drawn row already says which worktree this is about, directly above.
      const notice = buildActionNotice(result, info, row ? undefined : nameFor(result, info));
      armAutoDismiss(result, notice);
      const anchor = row ? groupEndFor(row) : repoAnchorFor(result, info);
      // Unreachable as written — the map is cleared with the DOM, so every anchor in
      // it was recorded after that same `replaceChildren`. Kept because `after()` on
      // a detached node is a SILENT no-op: this turns a future regression into a
      // notice in the wrong place rather than no notice at all, which is the one
      // outcome this pass exists to prevent.
      if (anchor === undefined || !deps.element().contains(anchor)) {
        deps.element().appendChild(notice);
        continue;
      }
      const at = cursors.get(anchor) ?? anchor;
      at.after(notice);
      cursors.set(anchor, notice);
    }
  }

  /**
   * A mutation that STANDS reports itself and then gets out of the way — the
   * tree behind the notice is what the user actually asked for, and a create
   * whose setup step failed is still a create that succeeded. Only `ok` results
   * expire: an error, an unreadable subject or a partly-applied action is a
   * question the user still has to answer, so it waits for them.
   */
  function armAutoDismiss(result: WorktreeActionResult, notice: HTMLElement): void {
    const dismiss = deps.view.onDismissActionResult;
    // A create only. Every other action's `ok` notice keeps the lifecycle it
    // was designed with — a scope-cleared statement in particular answers to no
    // row and is replaced rather than expired.
    if (dismiss === undefined || result.action !== "create" || result.outcome !== "ok") {
      return;
    }
    const key = resultKey(result);
    if (!autoDismiss.has(key)) {
      autoDismiss.set(
        key,
        setTimeout(() => {
          if (autoDismiss.get(key) === "held") {
            return;
          }
          autoDismiss.delete(key);
          if (deps.disposed()) {
            return;
          }
          // The LIVE result carrying this key, never the object the timer was
          // armed with: the controller dismisses by object identity, and every
          // tree reconciliation rebuilds an attached result into an equal but
          // different object. Handing back the captured one dismissed nothing
          // and retired the countdown, leaving the notice up for good.
          const live = (deps.data().actionResults ?? []).find((r) => resultKey(r) === key);
          if (live !== undefined) {
            dismiss(live);
          }
        }, AUTO_DISMISS_MS),
      );
    }
    // Reaching the notice is the user reading it, and "View output" and "Retry
    // setup" must not vanish under the cursor on the way to a click. The hold
    // is permanent: someone who looked at a notice closes it themselves.
    const hold = (): void => {
      const timer = autoDismiss.get(key);
      if (timer !== undefined && timer !== "held") {
        clearTimeout(timer);
      }
      autoDismiss.set(key, "held");
    };
    notice.addEventListener("mouseenter", hold);
    notice.addEventListener("focusin", hold);
  }

  /** Drop countdowns for results that are already gone, so a long session does
   *  not accumulate one entry per notice it ever drew. */
  function pruneAutoDismiss(results: readonly WorktreeActionResult[]): void {
    if (autoDismiss.size === 0) {
      return;
    }
    const live = new Set(results.map(resultKey));
    for (const [key, timer] of autoDismiss) {
      if (!live.has(key)) {
        if (timer !== "held") {
          clearTimeout(timer);
        }
        autoDismiss.delete(key);
      }
    }
  }

  /** The last node belonging to a row: its group when it has one, else its pill. */
  function groupEndFor(row: HTMLElement): HTMLElement {
    // `.wt-group`, not `.wt-card`: the card is a selection mark now and an
    // expanded-but-unselected worktree carries only the group.
    const card = row.closest<HTMLElement>(".wt-group");
    if (card) {
      return card;
    }
    const next = row.nextElementSibling;
    return next instanceof HTMLElement && next.classList.contains("wt-presence") ? next : row;
  }

  /** Where a result with no drawn row goes: with its repository when we can place
   *  it there, else at the end, which is the only honest place left. */
  function repoAnchorFor(result: WorktreeActionResult, info?: WorktreeInfo): HTMLElement | undefined {
    const repoId = result.repoId ?? (info ? deps.repoOf(info)?.repoId : undefined);
    return repoId === undefined ? undefined : deps.repoAnchors.get(repoId);
  }

  function infoFor(worktreeId: string): WorktreeInfo | undefined {
    for (const repo of deps.data().tree?.repos ?? []) {
      const found = repo.worktrees.find((w) => w.id === worktreeId);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  /**
   * What to call a worktree whose row is not on screen. A row label alone does
   * not identify one — `main`, `bare`, `(no branch)` and a short sha all repeat,
   * across repositories especially — so a label shared with another worktree the
   * panel holds is qualified until it separates them.
   */
  function nameFor(result: WorktreeActionResult, info?: WorktreeInfo): string | undefined {
    if (result.worktreeId === undefined) {
      return undefined;
    }
    if (!info) {
      // Left the tree: the last thing the panel knew of it, reconstructed by the
      // controller rather than supplied by the host, so it is a fallback and not
      // an authority.
      return result.orphanedLabel;
    }
    const label = branchLabel(info).text;
    const shared = (deps.data().tree?.repos ?? []).some((repo) =>
      repo.worktrees.some((w) => w.id !== info.id && branchLabel(w).text === label),
    );
    return shared ? `${label} — ${info.displayPath}` : label;
  }

  /**
   * An indeterminate result is NOT an error: it says the repository changed and
   * names what was observed, so the user knows there is state to resolve. Rendering
   * it as a failure would tell them nothing happened, which is the false claim.
   */
  function buildActionNotice(result: WorktreeActionResult, info?: WorktreeInfo, name?: string): HTMLElement {
    const dismiss = deps.view.onDismissActionResult ? () => deps.view.onDismissActionResult?.(result) : undefined;
    // A notice re-scoped to its repository has no row above it to say what it
    // is about, so it says so itself.
    const about = name ?? result.orphanedLabel;
    const withAbout = (body?: string): string | undefined =>
      about === undefined ? body : body === undefined ? about : `${about} — ${body}`;
    if (result.action === "scope") {
      // Not a mutation: nothing failed and nothing was done to the worktree. It
      // left the tree, and the surface that was filtered by it says so rather
      // than quietly showing every tab again.
      return renderNotice({
        tone: "neutral",
        live: "status",
        title: "Scope cleared.",
        body: `${about ?? "The scoped worktree"} is no longer in this tree, so every tab is shown again.`,
        onDismiss: dismiss,
      });
    }
    if (result.outcome === "ok") {
      const brought = provisionSummary(result.provisioned, result.provisionContests);
      const ported = portSummary(result.ports, result.portWarnings);
      const migrationDetail =
        result.migrationIndeterminate === undefined
          ? undefined
          : `Unverified Git integration detail: ${result.migrationIndeterminate}`;
      const setup = setupSummary(result.setup);
      const setupActions = [
        ...(result.setupOutputId === undefined || deps.view.onViewSetupOutput === undefined
          ? []
          : [{ label: "View output", onClick: () => deps.view.onViewSetupOutput?.(result) }]),
        ...(result.worktreeId === undefined || result.setupRetryId === undefined || deps.view.onRetrySetup === undefined
          ? []
          : [{ label: "Retry setup", onClick: () => deps.view.onRetrySetup?.(result) }]),
      ];
      // Stated, not implied: the tree refreshing underneath is not a report,
      // and a user who started a mutation is owed its result either way.
      // Still a success — the worktree exists — but the notice says plainly
      // what did not happen afterwards, rather than a second notice replacing
      // this one (round-4 W7).
      return renderNotice({
        // A create that succeeded while some of its material did not arrive is
        // still a success and still needs saying — the same rule the launch
        // failure above follows (round-4 W7). A refused branch delete is the
        // same shape: the removal still succeeded, but "done" alone would
        // hide that the opt-in did not go through.
        tone:
          result.openFailed === undefined &&
          result.migrationIndeterminate === undefined &&
          result.branchDelete?.kind !== "refused" &&
          brought?.tone !== "warn" &&
          ported?.tone !== "warn" &&
          setup?.tone !== "warn" &&
          result.manifestWarning === undefined
            ? "neutral"
            : "warn",
        live: "status",
        title: `${titleForAction(result.action)} done.`,
        body: withAbout(
          [
            result.migrationIndeterminate === undefined
              ? undefined
              : "Migration may be partial, so no provisioning, port allocation, opening, or launch ran afterwards. Inspect the source worktree, destination worktree, and Git stashes.",
            result.openFailed === undefined ? undefined : "It could not be opened afterwards.",
            branchDeleteLine(result.branchDelete),
            brought?.body,
            ported?.body,
            setup?.body,
            result.manifestWarning,
          ]
            .filter((line) => line !== undefined)
            .join(" ") || undefined,
        ),
        reason:
          [
            migrationDetail,
            result.openFailed,
            branchDeleteReason(result.branchDelete),
            brought?.reason,
            ported?.reason,
            setup?.reason,
          ]
            .filter((line) => line !== undefined)
            .join("\n") || undefined,
        actions: setupActions.length === 0 ? undefined : setupActions,
        onDismiss: dismiss,
      });
    }
    if (result.outcome === "unavailable") {
      // NOT a failure and NOT unclear: nothing was attempted, because what the
      // action would affect could not be read. That is the one outcome a retry
      // can actually change, so it is the only one that offers one.
      // Offered only where it can act. A re-scoped result has lost the
      // worktreeId the re-ask needs, and a button that does nothing is worse
      // than no button (round-4 W4).
      const retry = result.worktreeId === undefined ? undefined : deps.view.onRetryAction;
      return renderNotice({
        tone: "warn",
        live: "alert",
        title: `Couldn't check what this would affect.`,
        body: withAbout("Nothing was changed. These reads failed:"),
        reason: (result.unreadable ?? []).join(", "),
        actions: retry ? [{ label: "Retry", onClick: () => retry(result) }] : undefined,
        onDismiss: dismiss,
      });
    }
    if (result.outcome === "indeterminate") {
      const repoId = result.repoId;
      const spec: NoticeSpec = {
        tone: "warn",
        live: "alert",
        title: `${titleForAction(result.action)} partly applied.`,
        body: withAbout("The repository changed. Check what was observed before retrying."),
        reason: result.observed,
        onDismiss: dismiss,
        actions:
          deps.view.onPrune && repoId ? [{ label: "Prune", onClick: () => deps.view.onPrune?.(repoId) }] : undefined,
      };
      return renderNotice(spec);
    }
    const actions: NonNullable<NoticeSpec["actions"]> = [];
    // A blocked destructive action reopens the confirmation rather than reporting
    // a dead end — the blocker set is what the user has to answer.
    if (result.needsConfirm && info) {
      const report = result.needsConfirm;
      actions.push({
        label: "Force remove…",
        onClick: () => deps.openRemoveReport(info, report),
      });
    }
    return renderNotice({
      tone: "error",
      live: "alert",
      title: `Couldn't ${result.action} this worktree.`,
      body: withAbout(),
      reason: result.error,
      actions: actions.length > 0 ? actions : undefined,
      onDismiss: dismiss,
    });
  }
  return {
    placeResults,
    dispose() {
      for (const timer of autoDismiss.values()) {
        if (timer !== "held") {
          clearTimeout(timer);
        }
      }
      autoDismiss.clear();
    },
    armedKeys: () => [...autoDismiss.keys()],
  };
}

/** Long enough to read a two-line result, short enough that it is not furniture. */
const AUTO_DISMISS_MS = 10_000;

/** What the notice says happened to the opted-in branch, apart from the removal itself. */
function branchDeleteLine(outcome: WorktreeActionResult["branchDelete"]): string | undefined {
  if (outcome === undefined) {
    return undefined;
  }
  return outcome.kind === "deleted" ? `The branch ${outcome.branch} was also deleted.` : "The branch was not deleted.";
}

/** Which guard refused the branch delete, in the user's terms — never a bare "refused". */
function branchDeleteReason(outcome: WorktreeActionResult["branchDelete"]): string | undefined {
  if (outcome === undefined || outcome.kind !== "refused") {
    return undefined;
  }
  switch (outcome.reason) {
    case "branch-in-use":
      return "It is checked out in another worktree.";
    case "default-branch":
      return "It is the default branch.";
    case "holders-unavailable":
      return "The branch deletion could not be safely authorized or completed.";
    case "refs-moved":
      return "It moved since it was checked.";
    default:
      return undefined;
  }
}

function titleForAction(action: WorktreeActionResult["action"]): string {
  switch (action) {
    case "remove":
      return "Remove";
    case "create":
      return "Create";
    case "lock":
      return "Lock";
    case "unlock":
      return "Unlock";
    case "prune":
      return "Prune";
    case "scope":
      return "Scope";
    default:
      return "Launch";
  }
}

/**
 * The part of a provisioning report that decides whether the notice redraws.
 *
 * Every outcome, in order — a run where one entry turned from `copied` to
 * `refused` must not compare equal to the run before it.
 */
function provisionKey(result: WorktreeActionResult): string {
  // Structural, over exactly what the provisioning summaries and actions read.
  return JSON.stringify([
    result.provisioned ?? [],
    result.provisionContests ?? [],
    result.ports ?? [],
    result.portWarnings ?? [],
    result.setup ?? [],
    result.setupOutputId ?? null,
    result.setupRetryId ?? null,
    result.manifestWarning ?? null,
  ]);
}

/**
 * The part of a result that decides whether its notice redraws — and, because it
 * is stable across redraws of an unchanged result, the identity its auto-dismiss
 * countdown is keyed on.
 *
 * The blocker fingerprint is part of the key: it decides whether the notice
 * offers Force remove at all, and WHICH blocker set that confirmation would
 * authorize. Provisioning lands as a SECOND message folded onto the same notice,
 * so its summary is part of the key — without it the merged result is
 * byte-different and renders identically.
 */
export function resultKey(r: WorktreeActionResult): string {
  return `${r.action}:${r.worktreeId ?? r.repoId ?? ""}:${r.orphanedLabel ?? ""}:${r.outcome}:${r.openFailed ?? ""}:${r.migrationIndeterminate ?? ""}:${r.error ?? ""}${r.observed ?? ""}:${r.needsConfirm?.fingerprint ?? ""}:${provisionKey(r)}:${r.branchDelete ? `${r.branchDelete.kind}:${r.branchDelete.kind === "deleted" ? r.branchDelete.branch : r.branchDelete.reason}` : ""}`;
}
