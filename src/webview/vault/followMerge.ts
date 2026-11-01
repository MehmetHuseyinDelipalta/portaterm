// src/webview/vault/followMerge.ts — Decide whether a live-follow push only
// extends the transcript already on screen.
//
// The host re-reads a followed session and sends its latest window — the last N
// items — so once a session is longer than N, every push has dropped items off
// the top as well as adding at the bottom. What the preview shows is kept instead:
// when the push agrees with it, the result is the shown transcript plus what is
// new, and only its last unit needs drawing again.

import type { VaultTimelineItem } from "../../vault/types";

/**
 * Overlap required before a push is trusted to continue what is shown, when what
 * is shown is longer than this. A short overlap of common items (a lone `ls` step)
 * could match by coincidence.
 */
export const MIN_FOLLOW_OVERLAP = 16;

export interface FollowMerge {
  /** The shown transcript, its last unit and onwards replaced by the push's. */
  timeline: VaultTimelineItem[];
  /** Items of the shown transcript that the push no longer carries at its top. */
  dropped: number;
  /** How many more items `timeline` has than the shown transcript. */
  added: number;
}

/**
 * Merge `next` (a fresh window) onto `shown`, where `fixedUntil` is the index of
 * the first item of the last rendered unit: items before it AND that item must
 * reappear unchanged in `next`, at the same distance from each other; anything
 * after it may have changed (a run whose last tool call has since completed) and
 * is taken from `next`.
 *
 * `null` when `next` does not continue `shown` that way — an earlier item changed,
 * the overlap is too short to trust, or nothing at or after the last unit is
 * new — and the caller renders `next` in full.
 */
export function mergeFollowTimeline(
  shown: readonly VaultTimelineItem[],
  next: readonly VaultTimelineItem[],
  fixedUntil: number,
): FollowMerge | null {
  if (fixedUntil < 0 || fixedUntil >= shown.length || next.length === 0) {
    return null;
  }
  const shownKeys = shown.slice(0, fixedUntil + 1).map(itemKey);
  const nextKeys = next.map(itemKey);
  // A shown prefix shorter than the minimum must reappear whole.
  const required = Math.min(MIN_FOLLOW_OVERLAP, fixedUntil + 1);
  // Smallest `dropped` first: the push drops the fewest items it can.
  for (let dropped = 0; fixedUntil + 1 - dropped >= required; dropped++) {
    const overlap = fixedUntil + 1 - dropped; // shown[dropped..fixedUntil] ↔ next[0..overlap)
    if (overlap > next.length) {
      continue;
    }
    let agrees = true;
    for (let k = 0; k < overlap; k++) {
      if (shownKeys[dropped + k] !== nextKeys[k]) {
        agrees = false;
        break;
      }
    }
    if (!agrees) {
      continue;
    }
    const timeline = [...shown.slice(0, fixedUntil + 1), ...next.slice(overlap)];
    const added = timeline.length - shown.length;
    const tailChanged =
      added !== 0 ||
      timeline.slice(fixedUntil + 1).some((item, k) => itemKey(item) !== itemKey(shown[fixedUntil + 1 + k]));
    return tailChanged ? { timeline, dropped, added } : null;
  }
  return null;
}

/** Items cross the webview boundary as structured clones of plain data, so their JSON is their identity. */
function itemKey(item: VaultTimelineItem): string {
  return JSON.stringify(item);
}
