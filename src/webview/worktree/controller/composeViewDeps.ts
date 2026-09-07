// src/webview/worktree/controller/composeViewDeps.ts — The object
// `WorktreeController` hands `WorktreeView`, built in one place.
//
// Extracted from the constructor by change `decompose-worktree-view` (task
// 3_14), and split from `composeCreateDialogDeps.ts` in the same task when the
// two halves together came to over 500 lines.
//
// The object graph is unchanged: `view.deps` holds one object with the same
// fields, which is what five suites read through the instance (D5).

import type { ResolvedMode } from "../../../types/messages";
import type { WorktreeViewDeps } from "../WorktreeView";
import type { WorktreeCreateMode, WorktreeOpenAfter } from "../worktreeViewTypes";
import { buildCreateDialogDeps, type ViewDepsSeam } from "./composeCreateDialogDeps";

export type { ViewDepsSeam } from "./composeCreateDialogDeps";

/**
 * The create the form resolved onto a directory that already exists, or nothing
 * where it resolved something else.
 *
 * Both modes that act on a surviving directory, because the fallback below is
 * `reuse` — which would check the branch out somewhere ELSE and leave the
 * directory the form named untouched.
 */
function repairOf(resolved: ResolvedMode | undefined, branch: string): WorktreeCreateMode | undefined {
  if (resolved?.kind === "reattach") {
    return { kind: "reattach", branch, repairPath: resolved.repairPath, expectedOid: resolved.expectedOid };
  }
  if (resolved?.kind === "adopt") {
    return { kind: "adopt", branch, adoptPath: resolved.adoptPath, expectedBranchOid: resolved.expectedBranchOid };
  }
  return undefined;
}

export function buildViewDeps(seam: ViewDepsSeam): WorktreeViewDeps {
  return {
    host: seam.host,
    // Both launch items start absent: nothing here can launch until the host
    // has answered which agents can, and an item that opens an empty picker
    // is the inert rendering the panel spec forbids.
    actions: seam.menuActions,
    // The header door. Supplied unconditionally: unlike the launch items, a
    // create is always performable where a repository exists, and the header
    // it hangs on is only rendered where one does.
    onCreateForRepo: (repoId) => seam.openCreateForRepo(repoId),
    // The form's seed is the HOST's answer, never a path derived here: the
    // spec says a create names the destination it will actually use, and only
    // the host knows the configured root and which candidates are free.
    createDialogDeps: () => buildCreateDialogDeps(seam),
    onLaunchSubmit: (request) => {
      const frozen = seam.agentActions.frozenLaunch();
      if (frozen === null) {
        return;
      }
      seam.postMessage({
        type: "worktreeLaunchAgent",
        worktreeId: frozen.worktreeId,
        ...request,
        ...(frozen.offerId === undefined ? {} : { offerId: frozen.offerId }),
        ...(frozen.generation === undefined ? {} : { generation: frozen.generation }),
      });
      seam.agentActions.clearFrozenLaunch();
    },
    onDismissActionResult: (result) => {
      seam.setActionResults(seam.actionResults().filter((r) => r !== result));
      seam.push();
    },
    onForceRemove: (info, fingerprint, deleteBranch) => {
      seam.postMessage({
        type: "worktreeRemove",
        worktreeId: info.id,
        fingerprint,
        ...(deleteBranch === undefined ? {} : { deleteBranch }),
      });
    },
    onPrune: (repoId) => seam.confirmPrune(repoId),
    // Only `unavailable` reaches here — the read failed, so asking again is
    // the whole remedy. It re-ASKS: retrying with a removal would be a second
    // door onto the very deletion D6 closed, reached from the one outcome
    // where nothing about the worktree's risk is known at all.
    onRetryAction: (result) => {
      if (result.worktreeId !== undefined) {
        seam.mutationResults.askRemoval(result.worktreeId);
      }
    },
    onRetrySetup: (result) => {
      if (result.worktreeId !== undefined && result.setupRetryId !== undefined) {
        seam.postMessage({ type: "worktreeSetupRetry", worktreeId: result.worktreeId, retryId: result.setupRetryId });
      }
    },
    onViewSetupOutput: (result) => {
      if (result.setupOutputId !== undefined) {
        seam.postMessage({ type: "worktreeSetupViewOutput", outputId: result.setupOutputId });
      }
    },
    // Any dialog opening retires the outstanding assess: what the user is
    // looking at now is the answer to a newer question, and the view's own
    // blocked-notice opener is why this cannot be a controller-local guard
    // (D11).
    onDialogOpened: () => {
      seam.mutationResults.retireAssess();
    },
    /** The opening the form being opened right now will ride (D1). */
    createOpening: () => seam.createFlow.refsToken(),
    // Every door of the create form, and the only signal the host has that
    // the conversation ended. The opening comes from the view, which captured
    // it when the form opened — reading `refsToken` here instead named
    // whatever opening had been asked for most recently, which during the
    // window between asking for a new form and that form arriving is the
    // SUCCESSOR (round-1 B3).
    onCreateClosed: (opening: number) => {
      seam.postMessage({ type: "worktreeCreateClosed", opening });
      // Posting the retirement is not the same as ceasing to honour the
      // opening. A reply the host had already sent when the close reached it
      // still carries the retired number, and a token comparison alone let it
      // into a cache for a form that no longer exists (.reviews/round-1.md
      // B6). Advancing the counter is what makes every EXISTING guard reject
      // it — refs, resolutions, probe and debris as well as the two this
      // change added, which is the panel's half of D5's one-token-one-
      // retirement rule. No second predicate to keep in step, and the number
      // stays monotonic, which is what the host's high-water mark relies on.
      //
      // Only when the form that closed is the one still being served. A
      // superseded form is torn down AFTER its successor's requests have gone
      // out — the panel asks for the new opening, and the old dialog is
      // replaced when the answer arrives — so advancing on its teardown would
      // retire the successor and drop the live form's replies. The same guard
      // the host applies to a close naming an opening it no longer holds.
      seam.createFlow.retireOpening(opening);
    },
    // Create's shipped entry path. The dialog has existed since WT-002.1 and
    // nothing ever submitted it anywhere (round-1 B1); this is where the
    // draft becomes the request the host validates.
    onCreateSubmit: (draft) => {
      // An agent mode with nothing behind it would ask the host for a launch
      // it must refuse, so the mode is dropped rather than posted.
      if (draft.openAfter === "agent" && draft.agentId === undefined) {
        return;
      }
      // An OPTIONAL field left blank must be absent, not empty: git reads an
      // explicit "" as a ref and fails with `fatal: invalid reference:`, so
      // the ordinary new-branch create would never have worked (round-3 B11).
      const baseRef = draft.baseRef.trim();
      const branch = draft.branchName.trim();
      if (draft.branchMode !== "detached" && branch.length === 0) {
        return;
      }
      // The form has always known which of its three branch modes the user
      // picked; until the mode union it had nowhere on the wire to say so,
      // and the host inferred it from which optional fields were filled in.
      const mode: WorktreeCreateMode =
        draft.branchMode === "detached"
          ? // `fresh-detached` requires the ref, so the default lands here
            // rather than in the host — the type is what insists on it.
            { kind: "fresh-detached", baseRef: baseRef.length > 0 ? baseRef : "HEAD" }
          : draft.branchMode === "new"
            ? { kind: "fresh", branch, ...(baseRef.length > 0 ? { baseRef } : {}) }
            : // The classification the FORM was showing, carried on the draft.
              // Re-reading this controller's own map was a second
              // interpretation of one answer, and the two could name
              // different paths (round-3 B3).
              (repairOf(draft.resolved, branch) ?? { kind: "reuse", branch });
      seam.postMessage({
        type: "worktreeCreate",
        repoId: draft.repoId,
        // The opening this form was composed in. Posted BEFORE the retirement
        // that `onCreateClosed` sends, on the same ordered channel, so the one
        // legitimate submit still passes the host's equality check.
        opening: seam.createFlow.refsToken(),
        path: draft.path,
        mode,
        // The disposition the FORM settled on, carried on the draft for the
        // same reason the mode is: re-deriving it here would be a second
        // interpretation of one answer, and this one authorizes a delete.
        // Absent means free — a recover the user never accepted is not one.
        disposition: draft.disposition ?? { kind: "free" },
        // Ids only, resolved host-side against the model it displayed.
        ...(draft.provision === undefined ? {} : { provision: draft.provision }),
        ...(draft.migrateChanges === undefined ? {} : { migrateChanges: draft.migrateChanges }),
        // The launch details travel with the agent variant and with no other —
        // the union is what makes any other pairing unrepresentable.
        afterCreate:
          draft.openAfter === "agent" && draft.agentId !== undefined
            ? {
                kind: "agent",
                waitForSetup: draft.waitForSetup ?? false,
                agent: draft.agentId,
                ...(draft.permissionChoiceId === undefined ? {} : { permissionChoiceId: draft.permissionChoiceId }),
                ...(draft.prompt === undefined ? {} : { prompt: draft.prompt }),
                ...(seam.createFlow.frozenCreateOffer()?.offerId === undefined
                  ? {}
                  : { offerId: seam.createFlow.frozenCreateOffer()?.offerId }),
              }
            : { kind: draft.openAfter as Exclude<WorktreeOpenAfter, "agent"> },
      });
    },
    getInitialCollapsed: () => seam.store.getState().worktreeCollapsed,
    persistCollapsed: (ids) => seam.store.updateState({ worktreeCollapsed: ids }),
    getInitialExpandedRows: () => seam.store.getState().worktreeExpandedRows ?? [],
    persistExpandedRows: (ids) => seam.store.updateState({ worktreeExpandedRows: ids }),
    getInitialIdleSeeded: () => seam.store.getState().worktreeIdleTailSeeded ?? [],
    persistIdleSeeded: (ids) => seam.store.updateState({ worktreeIdleTailSeeded: ids }),
    // The reply is the next tree+presence envelope, carrying the roster on the
    // row itself — there is no response message to correlate here.
    onRequestSubagents: (row) => seam.agentActions.requestRoster(row),
    // Ids only — the host resolves them against its own tree and presence, so
    // a path or session the view guessed can never reach an action (D2).
    onActivateAgent: (row, activation) => seam.agentActions.activateAgent(row, activation),
    // A subagent has no pane of its own, so its activation is the PARENT's —
    // sending the user anywhere else would be a dead click (design.md D9).
    onActivateSubagent: (_subagent, parent) => seam.agentActions.activateSubagentParent(parent),
    // A getter, not a value: the setting is live, and re-reading it at the
    // click is what lets an update reach a view already painted.
    rowActivation: () => seam.rowActivation(),
    // Forwarded, not mirrored: the view owns the selection because the view is
    // what marks it, and a second copy here is a second thing to keep right.
    onSelectWorktree: (worktreeId) => seam.onSelectWorktree?.(worktreeId),
    now: seam.now,
  };
}
