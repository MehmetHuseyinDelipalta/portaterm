// src/webview/worktree/createDialog/recoverOffer.ts — The offer to clear a
// directory that is in the way, and the authorization that makes clearing it
// something the host agreed to.
//
// Extracted from `openWorktreeCreateDialog` by change `decompose-create-dialog`
// (design.md D1, task 1_5). Five `let` bindings sat in the dialog closure and
// were read from six places spread over a thousand lines, so "is this form
// holding a grant, and for which directory" was a question only a rendered
// dialog could answer.
//
// None of the five leaves as an accessor (task Boundary). Two outside reads were
// not operations and became answers instead: `recoverGrant?.path` behind a
// settled disposition is `grantedPath()`, and `recoverAsked !== null` is
// `asking()`. Both are asked in a ternary chain the facade still owns, so they
// answer rather than act.
//
// `applyAnswer` keeps the whole of the old handler body, `deps.syncDerived()`
// included, so the early return that drops an answer for another request still
// drops the redraw with it. The facade's half of the guard — the dialog being
// closed, and the repository the answer names — stays outside: neither is this
// module's to know.
//
// DOM-bound, so no suite beside this file (design.md D2). The 386-case dialog
// suite drives the offer end to end: it appears only for a skipped candidate the
// resolution called debris, it is withdrawn by a changed selection, a late
// answer for a withdrawn ask is dropped, and a refusal is stated where the offer
// was.

import type {
  DebrisAuthorization,
  WorktreeCreateResolutionMessage,
  WorktreeDebrisAuthorizedMessage,
} from "../../../types/messages";
import type { WorktreeCreateDraft } from "../worktreeViewTypes";
import { lastSegment } from "./paths";

export interface RecoverOfferDeps {
  readonly recoverField: HTMLDivElement;
  readonly recoverBox: HTMLInputElement;
  readonly recoverText: HTMLSpanElement;
  readonly recoverNote: HTMLParagraphElement;
  /** Read, never held: the draft's repository and mode both move under this form. */
  readonly draft: WorktreeCreateDraft;
  /** The resolution currently in force, or null while one is in flight. */
  resolution(): WorktreeCreateResolutionMessage | null;
  targetOf(resolution: WorktreeCreateResolutionMessage): string;
  /** Both halves, or the offer is a control nothing can answer. */
  onAuthorizeDebris?: (request: { repoId: string; ask: number; path: string }) => void;
  canAnswer: boolean;
  syncDerived(settled?: boolean): void;
}

export interface RecoverOffer {
  /** The disposition the submit carries — `debris` only under a grant for the path on screen. */
  disposition(): { kind: "debris"; authorization: DebrisAuthorization } | undefined;

  /**
   * The directory an accepted offer would clear, which is where this create then
   * lands — so the destination line can say so before Create authorizes it.
   */
  grantedPath(): string | undefined;

  /** A request is outstanding, so the form is waiting rather than blocked. */
  asking(): boolean;

  /** Forget an acceptance and its grant. The authorization binds one path and one content. */
  withdraw(): void;

  /** State the offer, and what accepting it would remove. */
  render(): void;

  /** Apply the host's answer to the one request the acceptance sent. */
  applyAnswer(answer: WorktreeDebrisAuthorizedMessage): void;
}

export function createRecoverOffer(deps: RecoverOfferDeps): RecoverOffer {
  const { draft, recoverBox, recoverField, recoverNote, recoverText } = deps;

  /** The user accepted the recover offer. Withdrawn by any change of selection. */
  let recoverWanted = false;
  /** The authorization the host issued, and the entries it was digested over. */
  let recoverGrant: { path: string; authorization: DebrisAuthorization; entries: readonly string[] } | null = null;
  /**
   * Which request is outstanding, or null.
   *
   * A generation rather than a flag: an answer that arrives after the offer was
   * withdrawn names the same path and would otherwise be kept, so a later
   * re-acceptance reused a reading that acceptance never made (round-1 W2).
   */
  let recoverAsked: number | null = null;
  let recoverAsks = 0;
  /** Why the host refused, stated where the offer was — a refusal is an answer, not silence. */
  let recoverRefused: string | null = null;

  /**
   * The directory this form would offer to clear, or null where it offers none.
   *
   * Only a candidate the suffixing SKIPPED, only where the resolution classified
   * it as debris, and only where the create would actually take that path once
   * it is cleared: under `reattach` the create acts on the registration's own
   * path, so the skipped candidate is a directory this create never touches, and
   * offering to delete it would be the round-3 B3 defect with a delete attached.
   */
  function debrisOffer(): string | null {
    if (!deps.canAnswer) {
      // Nothing can answer the request, so the offer would be a control that
      // cannot be acted on.
      return null;
    }
    const resolution = deps.resolution();
    if (resolution === null) {
      return null;
    }
    const occupied = resolution.occupiedCandidate;
    if (occupied === undefined || occupied.disposition.kind !== "debris") {
      return null;
    }
    // The MODE, said outright. Comparing `targetOf` against `freePath` was a
    // proxy for it, and the two coincide whenever a stale registration's own
    // path is also the first free candidate — which armed a clearance the
    // service's repair branch never performs (round-1 B7).
    // Adopt joins `reattach`, and more strongly: a repair's skipped candidate is
    // merely a directory this create never touches, while an adoption's IS the
    // directory being re-registered — so the offer would be to delete the work.
    if (draft.branchMode !== "detached" && (resolution.mode.kind === "reattach" || resolution.mode.kind === "adopt")) {
      return null;
    }
    return deps.targetOf(resolution) === resolution.freePath ? occupied.path : null;
  }

  /** The disposition the form settled on — `debris` only under a grant for the path on screen. */
  function settledDisposition(): { kind: "debris"; authorization: DebrisAuthorization } | undefined {
    const offer = debrisOffer();
    if (!recoverWanted || offer === null || recoverGrant === null || recoverGrant.path !== offer) {
      return undefined;
    }
    return { kind: "debris", authorization: recoverGrant.authorization };
  }

  /** Forget an acceptance and its grant. The authorization binds one path and one content. */
  function withdrawRecover(): void {
    recoverWanted = false;
    recoverGrant = null;
    recoverAsked = null;
    recoverRefused = null;
    recoverBox.checked = false;
  }

  recoverBox.addEventListener("change", () => {
    const offer = debrisOffer();
    if (offer === null) {
      recoverBox.checked = false;
      return;
    }
    if (!recoverBox.checked) {
      withdrawRecover();
      deps.syncDerived();
      return;
    }
    recoverWanted = true;
    recoverRefused = null;
    if (recoverGrant?.path !== offer) {
      // A grant for a different directory authorizes nothing here.
      recoverGrant = null;
      recoverAsks += 1;
      recoverAsked = recoverAsks;
      deps.onAuthorizeDebris?.({ repoId: draft.repoId, ask: recoverAsked, path: offer });
    }
    deps.syncDerived();
  });

  /** How many entries the note names before it summarises the rest. */
  const RECOVER_ENTRY_CAP = 6;

  /**
   * State the offer, and what accepting it would remove.
   *
   * The list is the one the AUTHORIZATION was digested over, so what is shown
   * and what is bound cannot differ — a list read separately for display would
   * be a second answer to the question the token already answered.
   */
  function renderRecover(): void {
    const offer = debrisOffer();
    if (offer === null) {
      recoverField.hidden = true;
      recoverNote.hidden = true;
      recoverNote.textContent = "";
      recoverBox.checked = false;
      return;
    }
    recoverField.hidden = false;
    recoverBox.checked = recoverWanted;
    recoverText.textContent = `Clear existing folder and create here: ${lastSegment(offer)}`;
    const note =
      recoverRefused ??
      (recoverAsked !== null
        ? "Reading what is there…"
        : recoverGrant !== null && recoverGrant.path === offer
          ? recoverGrant.entries.length === 0
            ? `Removes ${offer}, which is empty.`
            : `Removes ${recoverGrant.entries.length} item(s) from ${offer}: ${listed(recoverGrant.entries)}`
          : `${offer} is not a git checkout. Accepting clears it before the worktree is created.`);
    recoverNote.hidden = false;
    // `textContent`, not markup: these are directory names off the user's disk.
    recoverNote.textContent = note;
  }

  /** The first few names, and a count for the rest — a capped list never reads as the whole set. */
  function listed(entries: readonly string[]): string {
    const shown = entries.slice(0, RECOVER_ENTRY_CAP).join(", ");
    const rest = entries.length - RECOVER_ENTRY_CAP;
    return rest > 0 ? `${shown} and ${rest} more.` : `${shown}.`;
  }
  return {
    disposition: settledDisposition,
    grantedPath: () => (settledDisposition() === undefined ? undefined : recoverGrant?.path),
    asking: () => recoverAsked !== null,
    withdraw: withdrawRecover,
    render: renderRecover,

    applyAnswer(answer) {
      const offer = debrisOffer();
      // THIS request, not merely some request for this path. Accept, withdraw and
      // accept again asks twice inside one opening, and the first answer arriving
      // late would otherwise satisfy the second with a reading that request never
      // made (round-1 W2, round-2 W2).
      if (offer === null || recoverAsked === null || answer.ask !== recoverAsked || answer.path !== offer) {
        return;
      }
      recoverAsked = null;
      if (answer.granted) {
        recoverGrant = { path: answer.path, authorization: answer.authorization, entries: answer.entries };
        recoverRefused = null;
      } else {
        // Not debris, or unreadable — either way there is nothing to authorize,
        // so the acceptance is withdrawn and the create falls back to the suffix.
        recoverGrant = null;
        recoverWanted = false;
        recoverRefused =
          answer.because === "notDebris"
            ? "That directory holds a repository, so it will not be cleared."
            : "That directory could not be read, so it will not be cleared.";
      }
      deps.syncDerived();
    },
  };
}
