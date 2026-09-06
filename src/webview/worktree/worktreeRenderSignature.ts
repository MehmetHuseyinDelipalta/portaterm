// src/webview/worktree/worktreeRenderSignature.ts — Stable signature over the
// worktree tree + presence for the no-op render guard (worktree-panel-ui § 6.1).
//
// Mirrors src/webview/vault/vaultRenderSignature.ts and adds the rule that makes
// this view survivable: decorative title frames are stripped BEFORE the signature
// is computed. Without that, one agent's spinner repaints the whole tree at
// animation rate and destroys scroll position and expansion state.
//
// The signature covers every field a row, badge, pill, marker, or notice reads —
// a change the UI would reflect must never be masked by the guard. It is
// order-sensitive: the tree renders in array order, so a reorder is a change.

import { displayedRows, presentedActivity, stripDecorations } from "./worktreeFormat";
import type {
  DelegationRoster,
  PresenceDegradation,
  WorktreeAgentRow,
  WorktreeInfo,
  WorktreePresence,
  WorktreeTree,
} from "./worktreeViewTypes";

// Low control chars that cannot appear in branches, paths, ids, or titles, so
// distinct field layouts can't collide into one signature.
const FIELD_SEP = String.fromCharCode(1);
const ROW_SEP = String.fromCharCode(2);
const SECTION_SEP = String.fromCharCode(3);

export function worktreeSignature(
  tree: WorktreeTree | null,
  presence: WorktreePresence | null,
  now: number = Date.now(),
): string {
  if (!tree) {
    return "";
  }
  const repos = tree.repos
    .map((repo) =>
      [
        repo.repoId,
        repo.label,
        repo.mainPath,
        repo.degraded ?? "",
        repo.worktrees.map(worktreeFields).join(ROW_SEP),
      ].join(SECTION_SEP),
    )
    .join(ROW_SEP);

  // `unreadable.count` is occurrences and `reasons` is deduplicated for display —
  // both go in, because the copy shows the count and lists the reasons.
  const treePart = [
    tree.gitAvailable ? "1" : "0",
    String(tree.unreadable.count),
    tree.unreadable.reasons.join(FIELD_SEP),
    repos,
  ].join(SECTION_SEP);

  if (!presence) {
    return treePart;
  }

  // `scannedAt` is deliberately EXCLUDED: a rescan that found nothing new must not
  // invalidate the guard, or the guard buys nothing on a polling rebuild.
  const rows = Object.keys(presence.rowsByWorktreeId)
    .sort()
    .map((worktreeId) => {
      // Keyed on what is DRAWN. A pane holding no proven agent is not a row in
      // this panel, so its activity flipping — a shell running a build emits
      // output for minutes — moved this key and tore the whole list down through
      // `replaceChildren` to change nothing anyone could see (round-2 F001).
      //
      // A row crossing between the two sets still moves the key, because it
      // enters or leaves this list: it is only motion WITHIN the hidden set that
      // is now silent, which is the motion that had nothing to draw.
      const list = displayedRows(presence.rowsByWorktreeId[worktreeId] ?? []);
      return [worktreeId, list.map((r) => agentRowFields(r, presence.degradedSources, now)).join(ROW_SEP)].join(
        SECTION_SEP,
      );
    })
    .join(ROW_SEP);

  const degraded = presence.degradedSources
    .map((d) => [d.source, d.reason, String(d.since)].join(FIELD_SEP))
    .join(ROW_SEP);

  return [treePart, rows, degraded].join(SECTION_SEP);
}

/** One worktree's own fields, in the order the tree renders them. */
export function worktreeFields(w: WorktreeInfo): string {
  return [
    w.id,
    w.displayPath,
    w.kind,
    w.branch ?? "",
    w.head ?? "",
    w.bare ? "1" : "0",
    w.detached ? "1" : "0",
    w.locked ? "1" : "0",
    w.lockReason ?? "",
    w.prunable ? "1" : "0",
    w.missing ? "1" : "0",
    w.inWorkspace ? "1" : "0",
  ].join(FIELD_SEP);
}

/** One agent row's fields. `degraded` and `now` only reach `presentedActivity`. */
export function agentRowFields(r: WorktreeAgentRow, degraded: readonly PresenceDegradation[], now: number): string {
  return [
    r.rowId,
    r.scope,
    r.paneId ?? "",
    // Keyed though nothing renders them: a row's listeners close over
    // the row object, so a guarded-out render hands the old routing
    // value back at click time (review round 1, B1).
    r.viewId ?? "",
    // Stripped, so a spinner tick alone leaves the signature unchanged.
    stripDecorations(r.title),
    // Raw: a preview is message text, so its leading `- ` is content and
    // must move the signature like any other change (D4).
    r.preview ?? "",
    r.agent ?? "",
    // The chip's own text: an external row that learns its host, or loses it
    // when the table cannot be read, draws a different word in the same slot.
    r.host ?? "",
    r.agentSource,
    r.activity,
    r.activitySource,
    // In the key because the row's HINT draws it (§ 3.3). It left when the model
    // left the visible row (WT-009.2), which made a model change invisible to
    // the guard and left a stale id in the hint.
    r.model ?? "",
    // The PRESENTED state, not just the wire one: confidence is derived
    // from the clock, so a row that crosses the confirmation ceiling
    // changes what it draws while every field above stays identical.
    // Without this the guard would hold the old glyph on screen forever.
    presentedActivity(r, degraded, now),
    // A prompt that changed while the activity did not is still a
    // different question in front of the user.
    r.interactivePrompt ?? "",
    r.entryId ?? "",
    // Every clock `ageTimestamp` can fall back to, or a row whose only
    // moving timestamp is a fallback renders a frozen age.
    String(r.stateStartedAt ?? ""),
    String(r.finishedAt ?? ""),
    String(r.lastActivityAt ?? ""),
    String(r.startedAt ?? ""),
    delegationSignature(r.delegations),
  ].join(FIELD_SEP);
}

/**
 * A roster's contribution to the signature.
 *
 * Every state gets a distinct prefix, so an unread row and one read-and-empty
 * are not the same string — rendering them alike would leave "Reading…" on
 * screen after the answer arrived (design.md D4).
 */
function delegationSignature(roster: DelegationRoster | undefined): string {
  if (roster === undefined) {
    return "unread";
  }
  // The discriminant goes in verbatim rather than being inferred by elimination:
  // it is a rendered field, and a key that reconstructs it cannot move when it
  // changes.
  if (roster.kind === "failed") {
    return `${roster.kind}:${roster.reason}`;
  }
  // `live` and `reported` are rendered — they decide the section label and the
  // row styling — so a roster that changed only in provenance must not hash the
  // same as the one it replaced (.reviews/round-1.md W3).
  const rows = roster.rows
    .map((s) => [s.name, s.title ?? "", s.status, s.entryId ?? "", s.live ? "live" : "past"].join(FIELD_SEP))
    .join(",");
  const provenance = roster.reported === true ? "reported" : "transcript";
  return `${roster.kind}:${provenance}:${roster.incomplete === true ? "part" : "whole"}:${rows}`;
}
