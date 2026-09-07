// src/providers/worktreeHost/actions/provision/asks.ts — The two asks that ADD
// to a provisioning offer: one more file to copy, one more setup step to run.
//
// Extracted from `createProvisionActions` by change `decompose-worktree-host`
// (design.md D1, task 2_18). Both arms do the same four things in the same
// order — check the ask is well-formed and live, check there is room under the
// two caps, record the addition in the per-opening slot, and re-issue the offer
// through `withAdded` — so they read as one subject and drift apart when kept
// apart.

import type { ProvisionEntry, WorktreeActionMessage } from "../../../../types/messages";
import { MAX_SETUP_STEP_CHARS, SETUP_STEP_ADDED_SOURCE } from "../../../../types/messages";
import {
  conflictsWithProvisionDestination,
  identityOf,
  MAX_MODEL_ROWS,
  rowsOf,
} from "../../../../worktree/provisioning/providerKit";
import type { PickedCopyFile, WorktreeSurface } from "../../hostTypes";
import { isKnownCopyFileAsk, isKnownStepAsk } from "../../messageGuards";
import type { ProvisionDeps } from "../provision";

/**
 * Take the file the picker returned into this ask's record, or drop it.
 *
 * Every path disposes the handle it does not keep: a picked file the offer
 * cannot hold is an OS handle nobody will close otherwise.
 */
function takePickedCopy(
  deps: ProvisionDeps,
  offerKey: { surface: string; repoId: string },
  slot: string,
  shownModel: Parameters<ProvisionDeps["withoutAdded"]>[0],
  record: readonly PickedCopyFile[],
  picked: PickedCopyFile | undefined,
  stillMine: () => boolean,
  publish: () => void,
): void {
  if (!stillMine()) {
    picked?.file.dispose();
    return;
  }
  if (picked === undefined) {
    publish();
    return;
  }
  const base = deps.withoutAdded(shownModel, deps.privateIdsFor(offerKey, shownModel));
  const occupied = [...base.entries, ...base.excluded];
  const probe: ProvisionEntry = {
    id: "added-copy-probe",
    path: picked.path,
    mode: "copy",
    source: deps.ADDED_COPY_SOURCE,
  };
  if (
    record.some((entry) => identityOf(entry.path) === identityOf(picked.path)) ||
    conflictsWithProvisionDestination(occupied, probe)
  ) {
    picked.file.dispose();
    publish();
    return;
  }
  const next = [...record, picked];
  const composed = deps.withAdded(offerKey, slot, shownModel, next);
  if (composed.heldFiles.size !== next.length) {
    picked.file.dispose();
    publish();
    return;
  }
  deps.addedCopyFiles.set(slot, next);
  publish();
}

export function handleCopyFileAsk(
  deps: ProvisionDeps,
  surface: WorktreeSurface,
  msg: Extract<WorktreeActionMessage, { type: "worktreeCopyFileAsk" }>,
): void {
  if (!isKnownCopyFileAsk(msg)) {
    return;
  }
  const key = deps.surfaceKey(surface);
  if (!deps.lifecycle.isLive(key, msg.opening)) {
    return;
  }
  const offerKey = { surface: key, repoId: msg.repoId };
  const shown = deps.offers.current(offerKey);
  const repo = deps.cache.read().repos.find((candidate) => candidate.repoId === msg.repoId);
  if (shown === undefined || repo === undefined) {
    return;
  }
  const slot = `${key} ${msg.repoId} ${msg.opening}`;
  if (msg.switch <= (deps.provisionSwitch.get(slot) ?? 0)) {
    return;
  }
  deps.provisionSwitch.set(slot, msg.switch);
  const mine = msg.switch;
  const stillMine = (): boolean =>
    !deps.disposed() &&
    deps.hasSurface(surface) &&
    deps.provisionSwitch.get(slot) === mine &&
    deps.lifecycle.isLive(key, msg.opening) &&
    deps.cache.read().repos.some((current) => current.repoId === repo.repoId && current.mainPath === repo.mainPath);
  const publish = (): void => {
    if (!stillMine()) {
      return;
    }
    const current = deps.offers.current(offerKey)?.model ?? shown.model;
    const offer = deps.issueWithAdded(offerKey, slot, current);
    deps.deliver(surface, {
      type: "worktreeProvisionOffer",
      repoId: msg.repoId,
      opening: msg.opening,
      offerId: offer.offerId,
      model: offer.model,
    });
  };
  const record = deps.addedCopyFiles.get(slot) ?? [];
  const composedCurrent = deps.withAdded(offerKey, slot, shown.model, record);
  const current = composedCurrent.model;
  const shownRecord = composedCurrent.heldFiles.size;
  if (
    record.length >= deps.MAX_ADDED_COPY_FILES ||
    shownRecord !== record.length ||
    rowsOf(current) >= MAX_MODEL_ROWS ||
    deps.options.actions?.pickCopyFile === undefined
  ) {
    publish();
    return;
  }
  void deps.options.actions
    .pickCopyFile(repo.mainPath)
    .then((picked) => {
      takePickedCopy(deps, offerKey, slot, shown.model, record, picked, stillMine, publish);
    })
    .catch(() => publish());
  return;
}

/**
 * Open the input, record what the user typed, and answer the form.
 *
 * Everything here happens AFTER an await, so the ask's ownership is re-checked
 * before the record is touched: an ask a later switch outranked commits nothing
 * and publishes nothing (design.md D3).
 */
async function applyStepAsk(
  deps: ProvisionDeps,
  surface: WorktreeSurface,
  msg: Extract<WorktreeActionMessage, { type: "worktreeSetupStepAsk" }>,
  offerKey: { surface: string; repoId: string },
  slot: string,
  shown: NonNullable<ReturnType<ProvisionDeps["offers"]["current"]>>,
  ordinal: number | undefined,
  stillMine: () => boolean,
): Promise<void> {
  const op = msg.op;
  const record = deps.addedSteps.get(slot) ?? [];
  let next = record;
  if (op.kind === "remove") {
    if (ordinal !== undefined) {
      next = record.filter((_, i) => i !== ordinal);
    }
  } else if (
    op.kind === "add"
      ? record.length < deps.MAX_ADDED_STEPS && deps.roomForOneMoreSetup(offerKey, slot, shown.model, record)
      : ordinal !== undefined
  ) {
    const prompt = deps.options.actions?.promptSetupStep;
    let typed: string | undefined;
    if (prompt !== undefined) {
      // A rejection is a dismissal. Caught HERE so the form is still
      // answered below; `perform`'s wrapper only logs (design.md D4).
      try {
        typed = await prompt(op.kind === "edit" ? record[ordinal ?? -1] : undefined);
      } catch {
        typed = undefined;
      }
    }
    // Bounded by the host whatever the input said (design.md D3).
    if (typed !== undefined && typed.trim().length > 0 && typed.length <= MAX_SETUP_STEP_CHARS) {
      const script = typed;
      next = op.kind === "add" ? [...record, script] : record.map((s, i) => (i === ordinal ? script : s));
    }
  }
  // Re-checked AFTER the input and BEFORE the record is touched. An
  // ask a later switch outranked commits nothing and publishes
  // nothing: the step the user was typing goes with the ask that
  // carried it, rather than resurfacing in a source they moved on
  // from (design.md D3).
  if (!stillMine()) {
    return;
  }
  if (next !== record) {
    deps.addedSteps.set(slot, next);
  }
  // Every admitted ask is answered, changed or not: the offer id is
  // what releases the form (design.md D4). The model is the one the
  // host holds now — already previewed when it was issued.
  const current = deps.offers.current(offerKey)?.model ?? shown.model;
  const offer = deps.issueWithAdded(offerKey, slot, current);
  deps.deliver(surface, {
    type: "worktreeProvisionOffer",
    repoId: msg.repoId,
    opening: msg.opening,
    offerId: offer.offerId,
    model: offer.model,
  });
}

export function handleSetupStepAsk(
  deps: ProvisionDeps,
  surface: WorktreeSurface,
  msg: Extract<WorktreeActionMessage, { type: "worktreeSetupStepAsk" }>,
): void {
  if (!isKnownStepAsk(msg)) {
    return;
  }
  const key = deps.surfaceKey(surface);
  // A retired or never-seen opening has no authority to spend: no input
  // is opened and nothing is published for a form the user has closed.
  if (!deps.lifecycle.isLive(key, msg.opening)) {
    return;
  }
  const offerKey = { surface: key, repoId: msg.repoId };
  // No offer means no form has been told what it may add to. The ask is
  // dropped, not answered — there is no offer id to release it with, and
  // the dialog offers the control only while an offer is drawn.
  const shown = deps.offers.current(offerKey);
  if (shown === undefined || deps.cache.read().repos.every((r) => r.repoId !== msg.repoId)) {
    return;
  }
  // THE SAME slot the switch and the save use, taken synchronously
  // before the input opens, so the three order against each other and a
  // later switch outranks this ask the moment it arrives (design.md D2).
  const slot = `${key} ${msg.repoId} ${msg.opening}`;
  if (msg.switch <= (deps.provisionSwitch.get(slot) ?? 0)) {
    return;
  }
  deps.provisionSwitch.set(slot, msg.switch);
  const mine = msg.switch;
  const op = msg.op;
  // The target is resolved against the offer the form was LOOKING at,
  // before the input opens. Only a row this host marked as added is
  // reachable; a provider row named here is answered with the offer
  // unchanged and no input is opened (design.md D3).
  let ordinal: number | undefined;
  if (op.kind !== "add" && op.offerId === shown.offerId) {
    const at = shown.model.setup
      .filter((step) => step.source === SETUP_STEP_ADDED_SOURCE)
      .findIndex((step) => step.id === op.itemId);
    ordinal = at < 0 ? undefined : at;
  }
  const stillMine = (): boolean =>
    !deps.disposed() &&
    deps.hasSurface(surface) &&
    deps.provisionSwitch.get(slot) === mine &&
    deps.lifecycle.isLive(key, msg.opening);
  void applyStepAsk(deps, surface, msg, offerKey, slot, shown, ordinal, stillMine);
  return;
}
