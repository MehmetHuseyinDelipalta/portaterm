// src/providers/worktreeHost/actions/create/destinationPick.ts — The system
// folder picker one create form opened, and the single answer it is owed.
//
// Extracted from `createCreateActions` by change `decompose-worktree-host`
// (design.md D1, task 2_15). The dialog is modal to the USER but async to the
// extension, so every path out of it — confirmed, cancelled, failed,
// unresolvable, unwired, superseded — has to end in exactly one post or the
// form stays locked behind a dialog that is already gone.

import type { WorktreeActionMessage } from "../../../../types/messages";
import { prepareResolvedRoot } from "../../../../utils/resolvedPathBoundary";
import type { WorktreeHostOptions } from "../../../WorktreeHost";
import type { Opening, WorktreeSurface } from "../../hostTypes";

/** What answering a pick needs from the host. A subset of `CreateDeps`. */
export interface DestinationPickDeps {
  readonly options: WorktreeHostOptions;
  disposed(): boolean;
  hasSurface(surface: WorktreeSurface): boolean;
  openingFor(s: WorktreeSurface, repoId: string, token: number): Opening | undefined;
}

/**
 * Show the system folder picker for one create form, and answer only if that
 * form is still the one asking.
 *
 * The dialog is modal to the USER but async to the extension: they can dismiss
 * the create form, open another, and only then confirm this picker. So the
 * opening is re-read AFTER the await, the way every other post-await
 * continuation here re-reads its own ownership — a captured reference would
 * still be reachable and would answer a form that no longer exists.
 *
 * Every pick a live form opened is answered — a confirmed choice with its
 * path, and cancel, failure, an unresolvable root, an unwired capability and
 * a superseded pick with none. The form DOES gate itself while the dialog is
 * up, on both Create and the picker action, so it needs a terminal answer to
 * be released: a form locked behind an OS dialog that never returns is a form
 * the user cannot escape, which is why silence is reserved for a form that is
 * already gone (design.md D3, amended after review round 3).
 */
async function pickDestination(
  deps: DestinationPickDeps,
  surface: WorktreeSurface,
  msg: Extract<WorktreeActionMessage, { type: "worktreePickDestination" }>,
): Promise<void> {
  // The opening as an OBJECT, taken before the dialog opens, because the token
  // it rides is not identity: `requestWorktreeRefs` REPLACES the whole record
  // even for a token it already holds, and this continuation is suspended
  // across the longest await in the host. Matching on the token alone would
  // let the answer to a question asked of one record become consent held by
  // its replacement (round-1 F001). A pick naming an opening this host does
  // not hold opens no dialog at all.
  //
  // Not the same as nobody waiting, which is what this used to claim. A
  // predecessor dialog can still be on screen after its opening was retired,
  // and its click sets the form's gate and posts a token this host has moved
  // past; it is then released only by the successor opening it is already
  // waiting for. Bounded in practice, unbounded if that successor never
  // arrives — round-4 F007, carried as a residual because telling a retired
  // opening apart from a gone form is a change to what D3 means by "gone".
  const held = deps.openingFor(surface, msg.repoId, msg.token);
  if (held === undefined) {
    return;
  }
  /**
   * End this pick, one way or the other.
   *
   * Silence is for a form that is GONE, and nothing else (design.md D3). Every
   * other arm answers, carrying no path — the form cannot tell "no folder"
   * from "still waiting" without being told, and the plan attack found two
   * arms below dropping an answer while the surface and its token were still
   * live, either of which would have left the form waiting forever.
   *
   * `ask` is echoed, so releasing an older pick cannot release a newer one.
   */
  const release = (path?: string): void => {
    if (deps.disposed() || !deps.hasSurface(surface) || deps.openingFor(surface, msg.repoId, msg.token) === undefined) {
      return;
    }
    surface.post({
      type: "worktreeDestinationPicked",
      repoId: msg.repoId,
      token: msg.token,
      ask: msg.ask,
      ...(path === undefined ? {} : { path }),
    });
  };
  const pick = deps.options.actions?.pickFolder;
  if (pick === undefined) {
    // A capability nobody wired is still an answer. The form renders its
    // action on its own dependencies, not on this one, so leaving it silent
    // would hang a form the host can simply tell.
    release();
    return;
  }
  let chosen: string | undefined;
  try {
    chosen = await pick();
  } catch {
    release();
    return;
  }
  if (chosen === undefined || chosen === "") {
    release();
    return;
  }
  // Ordered by CONFIRMATION, not by resolution: the two picks race only behind
  // the dialog, and the user's second answer is the one they meant even when
  // its root resolves first (round-1 F003).
  held.pickGeneration += 1;
  const generation = held.pickGeneration;
  // Resolved HERE, once, on the answer the dialog returned. Recording the
  // spelling instead would leave it to be re-resolved when the probe uses it,
  // and a link retargeted in between would move the honoured area onto a
  // directory the user never selected (design.md D4).
  const resolved = await prepareResolvedRoot(chosen, deps.options.resolvedPathDeps).catch(() => null);
  // Re-read AFTER both awaits, not once at the top: the form can be dismissed
  // or superseded while either is suspended, and writing the record onto an
  // object the retirement already dropped is the same mistake as posting to a
  // form that is gone.
  const opening =
    deps.disposed() || !deps.hasSurface(surface) ? undefined : deps.openingFor(surface, msg.repoId, msg.token);
  if (opening === undefined || opening !== held || opening.pickGeneration !== generation || resolved === null) {
    // Not recorded — and, where a form is still there to hear it, still
    // answered. A replaced `Opening` and a superseded pick both leave the
    // surface and the token alive, so `release` finds a form and tells it.
    release();
    return;
  }
  opening.chosenRoot = resolved;
  release(chosen);
}

/**
 * The inbound arm: type-check the payload, then open the picker.
 *
 * Type-checked before it enters async logic, like every other inbound payload:
 * the discriminant alone is not the payload (round-3 W1).
 */
export function handlePickDestination(
  deps: DestinationPickDeps,
  surface: WorktreeSurface,
  msg: Extract<WorktreeActionMessage, { type: "worktreePickDestination" }>,
): void {
  // Type-checked before it enters async logic, like every other inbound
  // payload: the discriminant alone is not the payload (round-3 W1).
  if (
    typeof msg.repoId !== "string" ||
    !Number.isSafeInteger(msg.token) ||
    msg.token < 0 ||
    !Number.isSafeInteger(msg.ask) ||
    msg.ask < 0
  ) {
    return;
  }
  void pickDestination(deps, surface, msg);
  return;
}
