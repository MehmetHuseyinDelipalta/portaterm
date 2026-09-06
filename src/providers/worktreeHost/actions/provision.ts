// src/providers/worktreeHost/actions/provision.ts — The setup-offer conversation.
//
// Extracted from `handleAction` by change `decompose-worktree-host-controller`
// (design.md D1, task 2_3). Switching provider, asking for a file or a step, and
// saving what the user kept: the four arms that read and write the per-opening
// provisioning state.
//
// Every map arrives by reference and is never copied here. A copy would let
// cleanup clear the host's map while these arms read a stale one, which is how a
// detach-and-reattach on the same opening reports a source the user never took
// (design.md OBL-4).

import type {
  ExtensionToWebViewMessage,
  ProvisionEntry,
  ProvisionModel,
  ProvisionProblem,
  ProvisionWriteOutcome,
  WorktreeActionMessage,
} from "../../../types/messages";
import { MAX_SETUP_STEP_CHARS, SETUP_STEP_ADDED_SOURCE } from "../../../types/messages";
import { NATIVE_PROVIDER_FILE } from "../../../worktree/provisioning/nativeProvider";
import type { ProvisionOffer, ProvisionOfferStore } from "../../../worktree/provisioning/offerStore";
import {
  conflictsWithProvisionDestination,
  identityOf,
  MAX_MODEL_ROWS,
  rowsOf,
} from "../../../worktree/provisioning/providerKit";
import type { HeldProvisionSource } from "../../../worktree/provisioning/provisionMaterial";
import type { NativeConfigRefusal } from "../../../worktree/provisioning/writeNativeConfig";
import { divergenceOf } from "../../../worktree/provisioning/writeNativeConfig";
import type { WorktreeRepo } from "../../../worktree/types";
import type { WorktreeHostOptions } from "../../WorktreeHost";
import type { PickedCopyFile, WorktreeSurface } from "../hostTypes";
import { isKnownCopyFileAsk, isKnownSave, isKnownStepAsk, isKnownSwitch } from "../messageGuards";

/**
 * A save that did not happen, said on the model the section is already showing.
 *
 * The refusals map onto two problem reasons: `malformed` is the file's own
 * state, the one refusal that IS a statement about its content, and everything
 * else is `unsaved` — the write could not be made, said in the vocabulary of
 * writing rather than as a failure to read a file that read fine (design.md
 * D9, D13). Create stays enabled either way — a configuration that could not be
 * saved is not a reason to refuse to make a worktree
 * (worktree-provisioning.md § 9).
 */
/**
 * The problems the SAVE path put on a model, as opposed to the ones a read found.
 *
 * A failed reread republishes the model already shown, which carries the previous
 * save's report — so appending stacks two answers about one file and the summary
 * reads the older one (round-2 F004). Identity is the only workable key: a
 * `malformed` refusal is posted under the same reason a READ produces, so
 * filtering by reason or filename would eat a genuine read problem.
 *
 * Weak, because the entries live exactly as long as the model holding them.
 */
const postedBySave = new WeakSet<ProvisionProblem>();

/**
 * Apply ONE attempt's reports, replacing whatever the last attempt left.
 *
 * All of an attempt's reports at once, because a refusal and a lock are two
 * reports from the SAME attempt: applied one after another, the second call
 * filtered out the first and the row saying why the save did not happen went
 * with it. Called even with nothing to post, so a clean save after a failed
 * refresh clears the previous attempt's refusal rather than leaving it standing.
 */
function withSaveReports(model: ProvisionModel, posts: readonly ProvisionProblem[]): ProvisionModel {
  const kept = model.problems.filter((p) => !postedBySave.has(p));
  for (const p of posts) {
    postedBySave.add(p);
  }
  return { ...model, problems: [...kept, ...posts] };
}

function refusedSave(reason: NativeConfigRefusal): ProvisionProblem {
  const detail: Record<NativeConfigRefusal, string> = {
    unavailable: "Another process is holding it, or the folder could not be created.",
    outside: "It does not resolve inside this repository.",
    malformed: "It could not be edited without rewriting parts this did not change.",
    unwritable: "The replacement could not be put in place.",
    unnamed: "The source it builds on could not be read.",
  };
  return {
    file: NATIVE_PROVIDER_FILE,
    reason: reason === "malformed" ? "malformed" : "unsaved",
    detail: `\`${NATIVE_PROVIDER_FILE}\` was not saved. ${detail[reason]}`,
  };
}

/**
 * The save landed, or was refused, and the lock it took may still be there.
 *
 * `locked` rather than `unsaved` because the file WAS written in the common
 * case, and the summary folds an all-`unsaved` set into "Not saved". No pathname:
 * the wire carries no identity and the user acts on this long afterwards, so a
 * name here would be a deletion instruction that can go stale
 * (say-which-lock-a-save-left-behind design.md D1, D4).
 */
const LOCK_WORDING: Record<ProvisionWriteOutcome, string> = {
  written: "was saved, but it may still be locked",
  unchanged: "already had what you asked for, and may still be locked",
  refused: "may still be locked",
};

/**
 * The lock report, carrying what the save actually did.
 *
 * Not a boolean. A lock outlives a write that landed, a write that had nothing
 * to do, and a refusal alike, and calling the middle one saved is what the spec
 * forbids — "A save that wrote NOTHING SHALL NOT be described as written"
 * (design.md D4). It names no lock, deliberately (D1).
 */
function leftLocked(writeOutcome: ProvisionWriteOutcome): ProvisionProblem {
  return {
    file: NATIVE_PROVIDER_FILE,
    reason: "locked",
    writeOutcome,
    detail: `\`${NATIVE_PROVIDER_FILE}\` ${LOCK_WORDING[writeOutcome]}. Saving it again may not work until the lock clears.`,
  };
}

/** An offer's identity: which surface holds it, and for which repository. */
interface OfferKey {
  readonly surface: string;
  readonly repoId: string;
}

/** What `withAdded` composes: the model to show, and the sources behind its rows. */
interface ComposedProvision {
  readonly model: ProvisionModel;
  readonly heldFiles: ReadonlyMap<ProvisionEntry, HeldProvisionSource>;
}

/**
 * What the provisioning arms need from the host.
 *
 * Every map arrives by REFERENCE. Copying one here would give the arms a private
 * view of state the host keeps mutating, so a surface that detached and came back
 * would read the baseline recorded before it left (design.md OBL-4).
 */
export interface ProvisionDeps {
  readonly ADDED_COPY_SOURCE: string;
  readonly MAX_ADDED_COPY_FILES: number;
  readonly MAX_ADDED_STEPS: number;
  readonly addedCopyFiles: Map<string, readonly PickedCopyFile[]>;
  readonly addedSteps: Map<string, readonly string[]>;
  readonly provisionBaseline: Map<string, string>;
  readonly provisionSwitch: Map<string, number>;
  readonly liveOpening: Map<string, number>;
  readonly offers: ProvisionOfferStore;
  readonly cache: { read(): { repos: readonly WorktreeRepo[] } };
  readonly options: Pick<WorktreeHostOptions, "actions" | "readProvisioning" | "writeNativeConfig">;
  deliver(surface: WorktreeSurface, message: ExtensionToWebViewMessage): boolean;
  /** A getter, not a snapshot: `disposed` is a `let` the host flips after the factory runs. */
  disposed(): boolean;
  hasSurface(surface: WorktreeSurface): boolean;
  surfaceKey(surface: WorktreeSurface): string;
  previewProvisioning(repo: WorktreeRepo, model: ProvisionModel): Promise<ProvisionModel>;
  withAdded(
    offerKey: OfferKey,
    slot: string,
    model: ProvisionModel,
    copyRecord?: readonly PickedCopyFile[],
    setupRecord?: readonly string[],
  ): ComposedProvision;
  withoutAdded(model: ProvisionModel, heldIds?: ReadonlySet<string>): ProvisionModel;
  privateIdsFor(offerKey: OfferKey, model: ProvisionModel): ReadonlySet<string>;
  issueWithAdded(offerKey: OfferKey, slot: string, model: ProvisionModel): ProvisionOffer;
  roomForOneMoreSetup(offerKey: OfferKey, slot: string, model: ProvisionModel, record: readonly string[]): boolean;
}

/**
 * One provisioning arm.
 *
 * No `actions` parameter, unlike the shell and removal arms: these four reach
 * their capabilities through `options.actions?.…` with their own presence checks,
 * exactly as they did inside the switch.
 */
type Arm<T extends WorktreeActionMessage["type"]> = (
  surface: WorktreeSurface,
  msg: Extract<WorktreeActionMessage, { type: T }>,
) => void;

export function createProvisionActions(deps: ProvisionDeps) {
  const {
    ADDED_COPY_SOURCE,
    MAX_ADDED_COPY_FILES,
    MAX_ADDED_STEPS,
    addedCopyFiles,
    addedSteps,
    cache,
    deliver,
    disposed,
    hasSurface,
    issueWithAdded,
    liveOpening,
    offers,
    options,
    previewProvisioning,
    privateIdsFor,
    provisionBaseline,
    provisionSwitch,
    roomForOneMoreSetup,
    surfaceKey,
    withAdded,
    withoutAdded,
  } = deps;

  const worktreeProvisionSwitch: Arm<"worktreeProvisionSwitch"> = (surface, msg) => {
    // A NEW request with its own identity. It deliberately does NOT consult
    // `provisionReading`: that marker admits one read per (repo, opening)
    // and is held until the opening retires, so riding it would either join
    // a finished read and do nothing, or clear a marker that exists to stop
    // exactly that (design.md D5).
    if (!isKnownSwitch(msg)) {
      return;
    }
    const key = surfaceKey(surface);
    // A retired or never-seen opening has no authority to spend. Nothing is
    // read and nothing is published for a form the user has closed.
    if (liveOpening.get(key) !== msg.opening) {
      return;
    }
    const offerKey = { surface: key, repoId: msg.repoId };
    // The webview names a provider; it never supplies one. The only ids
    // honoured are the ones THIS host put in the model it last offered for
    // this form, so a switch cannot reach a source the host did not detect.
    const shown = offers.current(offerKey)?.model;
    if (shown === undefined || !shown.providers.some((p) => p.id === msg.provider)) {
      return;
    }
    const repo = cache.read().repos.find((r) => r.repoId === msg.repoId);
    if (repo === undefined || options.readProvisioning === undefined) {
      return;
    }
    const slot = `${key} ${msg.repoId} ${msg.opening}`;
    // Synchronously, before the read starts. A later switch raises the
    // ceiling immediately, so an earlier read already in flight can never
    // find itself still highest when it lands.
    if (msg.switch <= (provisionSwitch.get(slot) ?? 0)) {
      return;
    }
    provisionSwitch.set(slot, msg.switch);
    const mine = msg.switch;
    void options
      .readProvisioning(repo.mainPath, msg.provider)
      .then(async (model) => {
        if (disposed() || !hasSurface(surface)) {
          return;
        }
        // Latest-wins. Two switches whose reads resolve in the opposite
        // order would otherwise leave the EARLIER choice on screen, and the
        // opening check cannot tell them apart — both carry this opening.
        //
        // The opening is re-checked too, and that half is belt-and-braces:
        // retiring an opening sweeps the sequence map, so the first
        // condition already refuses a read whose form has closed. It is
        // written out because "publish only for the opening still being
        // served" is the invariant, and a future change to the sweep must
        // not silently remove it.
        if (provisionSwitch.get(slot) !== mine || liveOpening.get(key) !== msg.opening) {
          return;
        }
        const previewed = await previewProvisioning(repo, model);
        if (
          disposed() ||
          !hasSurface(surface) ||
          provisionSwitch.get(slot) !== mine ||
          liveOpening.get(key) !== msg.opening
        ) {
          return;
        }
        // A fresh id, and the old one evicted with it: a submission naming
        // the superseded offer would name the model the user is no longer
        // looking at.
        const offer = issueWithAdded(offerKey, slot, previewed);
        deliver(surface, {
          type: "worktreeProvisionOffer",
          repoId: msg.repoId,
          opening: msg.opening,
          offerId: offer.offerId,
          model: offer.model,
        });
      })
      // The section is not the create: a source that will not resolve leaves
      // the form exactly as it was.
      //
      // The ceiling is NOT released. It looked like housekeeping — the read
      // failed, so let the user try again — and it re-admitted every
      // sequence below the one already seen: switch 1 pending, switch 2
      // fails and clears the slot, and a delayed or replayed switch 1 then
      // passes the guard above and publishes a choice the user had moved on
      // from. Nothing needed the release either, because the dialog mints
      // `switch` strictly increasing, so a retry already outranks whatever
      // is held here. The map is swept by `retireOpening`, which is what
      // bounds it (.reviews/round-1.md F001).
      .catch(() => {});
    return;
  };

  const worktreeCopyFileAsk: Arm<"worktreeCopyFileAsk"> = (surface, msg) => {
    if (!isKnownCopyFileAsk(msg)) {
      return;
    }
    const key = surfaceKey(surface);
    if (liveOpening.get(key) !== msg.opening) {
      return;
    }
    const offerKey = { surface: key, repoId: msg.repoId };
    const shown = offers.current(offerKey);
    const repo = cache.read().repos.find((candidate) => candidate.repoId === msg.repoId);
    if (shown === undefined || repo === undefined) {
      return;
    }
    const slot = `${key} ${msg.repoId} ${msg.opening}`;
    if (msg.switch <= (provisionSwitch.get(slot) ?? 0)) {
      return;
    }
    provisionSwitch.set(slot, msg.switch);
    const mine = msg.switch;
    const stillMine = (): boolean =>
      !disposed() &&
      hasSurface(surface) &&
      provisionSwitch.get(slot) === mine &&
      liveOpening.get(key) === msg.opening &&
      cache.read().repos.some((current) => current.repoId === repo.repoId && current.mainPath === repo.mainPath);
    const publish = (): void => {
      if (!stillMine()) {
        return;
      }
      const current = offers.current(offerKey)?.model ?? shown.model;
      const offer = issueWithAdded(offerKey, slot, current);
      deliver(surface, {
        type: "worktreeProvisionOffer",
        repoId: msg.repoId,
        opening: msg.opening,
        offerId: offer.offerId,
        model: offer.model,
      });
    };
    const record = addedCopyFiles.get(slot) ?? [];
    const composedCurrent = withAdded(offerKey, slot, shown.model, record);
    const current = composedCurrent.model;
    const shownRecord = composedCurrent.heldFiles.size;
    if (
      record.length >= MAX_ADDED_COPY_FILES ||
      shownRecord !== record.length ||
      rowsOf(current) >= MAX_MODEL_ROWS ||
      options.actions?.pickCopyFile === undefined
    ) {
      publish();
      return;
    }
    void options.actions
      .pickCopyFile(repo.mainPath)
      .then((picked) => {
        if (!stillMine()) {
          picked?.file.dispose();
          return;
        }
        if (picked === undefined) {
          publish();
          return;
        }
        const base = withoutAdded(shown.model, privateIdsFor(offerKey, shown.model));
        const occupied = [...base.entries, ...base.excluded];
        const probe: ProvisionEntry = {
          id: "added-copy-probe",
          path: picked.path,
          mode: "copy",
          source: ADDED_COPY_SOURCE,
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
        const composed = withAdded(offerKey, slot, shown.model, next);
        if (composed.heldFiles.size !== next.length) {
          picked.file.dispose();
          publish();
          return;
        }
        addedCopyFiles.set(slot, next);
        publish();
      })
      .catch(() => publish());
    return;
  };

  const worktreeSetupStepAsk: Arm<"worktreeSetupStepAsk"> = (surface, msg) => {
    if (!isKnownStepAsk(msg)) {
      return;
    }
    const key = surfaceKey(surface);
    // A retired or never-seen opening has no authority to spend: no input
    // is opened and nothing is published for a form the user has closed.
    if (liveOpening.get(key) !== msg.opening) {
      return;
    }
    const offerKey = { surface: key, repoId: msg.repoId };
    // No offer means no form has been told what it may add to. The ask is
    // dropped, not answered — there is no offer id to release it with, and
    // the dialog offers the control only while an offer is drawn.
    const shown = offers.current(offerKey);
    if (shown === undefined || cache.read().repos.every((r) => r.repoId !== msg.repoId)) {
      return;
    }
    // THE SAME slot the switch and the save use, taken synchronously
    // before the input opens, so the three order against each other and a
    // later switch outranks this ask the moment it arrives (design.md D2).
    const slot = `${key} ${msg.repoId} ${msg.opening}`;
    if (msg.switch <= (provisionSwitch.get(slot) ?? 0)) {
      return;
    }
    provisionSwitch.set(slot, msg.switch);
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
      !disposed() && hasSurface(surface) && provisionSwitch.get(slot) === mine && liveOpening.get(key) === msg.opening;
    void (async () => {
      const record = addedSteps.get(slot) ?? [];
      let next = record;
      if (op.kind === "remove") {
        if (ordinal !== undefined) {
          next = record.filter((_, i) => i !== ordinal);
        }
      } else if (
        op.kind === "add"
          ? record.length < MAX_ADDED_STEPS && roomForOneMoreSetup(offerKey, slot, shown.model, record)
          : ordinal !== undefined
      ) {
        const prompt = options.actions?.promptSetupStep;
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
        addedSteps.set(slot, next);
      }
      // Every admitted ask is answered, changed or not: the offer id is
      // what releases the form (design.md D4). The model is the one the
      // host holds now — already previewed when it was issued.
      const current = offers.current(offerKey)?.model ?? shown.model;
      const offer = issueWithAdded(offerKey, slot, current);
      deliver(surface, {
        type: "worktreeProvisionOffer",
        repoId: msg.repoId,
        opening: msg.opening,
        offerId: offer.offerId,
        model: offer.model,
      });
    })();
    return;
  };

  const worktreeProvisionSave: Arm<"worktreeProvisionSave"> = (surface, msg) => {
    if (!isKnownSave(msg)) {
      return;
    }
    const key = surfaceKey(surface);
    // A retired or never-seen opening has no authority to spend, exactly as
    // for a switch: nothing is written and nothing is published for a form
    // the user has closed.
    if (liveOpening.get(key) !== msg.opening) {
      return;
    }
    const offerKey = { surface: key, repoId: msg.repoId };
    if (options.readProvisioning === undefined || options.writeNativeConfig === undefined) {
      return;
    }
    // `msg.repoId` selects a record; it never becomes a destination. The
    // root the write is given is the host's own, which is what keeps a path
    // the webview spelled out of the file.
    const repo = cache.read().repos.find((r) => r.repoId === msg.repoId);
    if (repo === undefined) {
      return;
    }
    // The model the user was LOOKING at, resolved by the host. An unknown,
    // expired or foreign id writes nothing (design.md D1).
    const redeemed = offers.redeem(offerKey, msg.offerId);
    const heldIds = new Set(redeemed?.heldFiles.keys());
    const shown = redeemed === undefined ? undefined : withoutAdded(redeemed.model, heldIds);
    // THE SAME slot the switch uses, so the two order against each other.
    // Taken synchronously, before the write starts, so a later switch
    // raises the ceiling immediately and this save can never find itself
    // still highest when it lands (design.md D8).
    const slot = `${key} ${msg.repoId} ${msg.opening}`;
    if (msg.switch <= (provisionSwitch.get(slot) ?? 0)) {
      return;
    }
    provisionSwitch.set(slot, msg.switch);
    const mine = msg.switch;
    const publish = async (model: ProvisionModel): Promise<void> => {
      // Checked AGAIN, after whatever this save did. A save is slower than a
      // switch and this is the window D8 exists for.
      if (provisionSwitch.get(slot) !== mine || liveOpening.get(key) !== msg.opening) {
        return;
      }
      const previewed = await previewProvisioning(repo, model);
      if (
        disposed() ||
        !hasSurface(surface) ||
        provisionSwitch.get(slot) !== mine ||
        liveOpening.get(key) !== msg.opening
      ) {
        return;
      }
      const offer = issueWithAdded(offerKey, slot, previewed);
      deliver(surface, {
        type: "worktreeProvisionOffer",
        repoId: msg.repoId,
        opening: msg.opening,
        offerId: offer.offerId,
        model: offer.model,
      });
    };
    if (shown === undefined) {
      // D1 says an unknown, expired or foreign id writes nothing AND
      // re-offers; only the first half was implemented, so a form holding a
      // stale id got no correction and a button that looked inert.
      //
      // Here and not for a repository the host does not know or a reader it
      // does not have: those have no form state to refresh, and answering
      // them with a read would be inventing one (.reviews/round-1.md F007).
      void options
        .readProvisioning(repo.mainPath)
        .then((model) => {
          if (disposed() || !hasSurface(surface)) {
            return;
          }
          return publish(model);
        })
        .catch(() => {});
      return;
    }
    // Whether this opening took a different source, derived from the
    // baseline the first offer recorded — never asserted by the form
    // (design.md D18). No baseline means no first offer was ever delivered
    // for this opening, and a take cannot be shown from nothing.
    const started = provisionBaseline.get(slot);
    const active = shown.providers.find((p) => p.active)?.id ?? "";
    const tookSource = started !== undefined && started !== active;
    void options
      .writeNativeConfig(
        repo.mainPath,
        divergenceOf(shown, new Set(msg.kept.filter((id) => !heldIds.has(id))), tookSource),
      )
      .then(async (written) => {
        if (disposed() || !hasSurface(surface)) {
          return;
        }
        // Re-read whatever happened: a refusal is reported ON the model, so
        // the section that shows it is the section the user is reading.
        // Plain precedence, with no provider preferred. The write just made
        // the native file the thing to read, and preferring the source it
        // extends would answer with the view from BEFORE the write.
        // What the write said is known BEFORE the reread, so a reread that
        // fails must not be able to swallow it — it used to, through the
        // early return and the outer catch (round-3 F004). The pre-save view
        // is the fallback: stale entries plus a true statement beats silence.
        let reread: ProvisionModel | undefined;
        try {
          reread = await options.readProvisioning?.(repo.mainPath);
        } catch {
          reread = undefined;
        }
        if (disposed() || !hasSurface(surface)) {
          return;
        }
        const base = reread ?? shown;
        // The writer's answer, not a boolean collapse of it: `ok && wrote`
        // merged a refusal with a no-op and lost the distinction the summary
        // needs (round-1 F002).
        const did: ProvisionWriteOutcome = !written.ok ? "refused" : written.wrote ? "written" : "unchanged";
        const posts: ProvisionProblem[] = [];
        if (!written.ok) {
          posts.push(refusedSave(written.reason));
        }
        if (written.mayStillBeLocked === true) {
          posts.push(leftLocked(did));
        }
        publish(withSaveReports(base, posts));
      })
      // A save that throws leaves the form exactly as it was, and the
      // ceiling is NOT released — for the reason the switch records above.
      .catch(() => {});
    return;
  };

  return {
    worktreeProvisionSwitch,
    worktreeCopyFileAsk,
    worktreeSetupStepAsk,
    worktreeProvisionSave,
  };
}
