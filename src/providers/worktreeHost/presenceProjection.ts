// src/providers/worktreeHost/presenceProjection.ts — What the presence envelope
// SAYS: the empty answer a host with no projector gives, the roster attached to
// each row, and the freshness a child's status inherits from its parent.
//
// Extracted from `createWorktreeHost` by change `decompose-worktree-host`
// (design.md D1, task 2_6). Derivation ONLY. `projected` and `projectedVersion`
// did NOT come: `projectOnce` is their sole writer and it stays in the
// projection loop (task 2_11), so they arrive here as reads. `rosters` is the
// same — this module evicts from it, but the read that fills it lives outside.

import type {
  DelegationRoster,
  PresenceDegradation,
  WorktreeAgentRow,
  WorktreePresence,
} from "../../worktree/presenceTypes";
import { ACTIVITY_EVIDENCE } from "../../worktree/presenceTypes";

/** `\0` cannot occur in a row id or an entry id, so the join is unambiguous. */
export function rosterKey(rowId: string, entryId: string): string {
  return `${rowId}\u0000${entryId}`;
}

export function parentIsLive(row: WorktreeAgentRow, degraded: ReadonlySet<PresenceDegradation["source"]>): boolean {
  if (row.activity !== "running" && row.activity !== "waiting") {
    return false;
  }
  const evidence = ACTIVITY_EVIDENCE[row.activitySource];
  // `none` proves nothing, so the parent's own liveness is unevidenced too.
  return evidence !== undefined && !degraded.has(evidence);
}

/**
 * A child's `running` does not outlive its parent's freshness (design.md D11).
 *
 * The transcript's recorded status is what the mapper hands over; whether it
 * may still be PUBLISHED is decided here, in the same pass that publishes the
 * parent — which is what makes the two incapable of disagreeing.
 */
export function decay(
  roster: DelegationRoster,
  parent: WorktreeAgentRow,
  degraded: ReadonlySet<PresenceDegradation["source"]>,
): DelegationRoster {
  if (roster.kind !== "ok" || parentIsLive(parent, degraded)) {
    return roster;
  }
  if (!roster.rows.some((child) => child.status === "running")) {
    return roster;
  }
  return {
    ...roster,
    rows: roster.rows.map((child) => (child.status === "running" ? { ...child, status: "unknown" as const } : child)),
  };
}

export interface PresenceProjectionDeps {
  /** The last projection, or `undefined` before the first one (task 2_11). */
  projected(): WorktreePresence | undefined;
  /** The host's clock, for the timestamp on an empty envelope. */
  now(): number;
  /**
   * Rosters read, keyed by `(rowId, entryId)`. Shared: the read that fills it
   * lives outside this module, and `withDelegations` is what evicts from it.
   */
  rosters: Map<string, DelegationRoster>;
  /** The tree-and-presence pair this host last published, if any. */
  published(): { presence: WorktreePresence } | undefined;
}

export interface PresenceProjection {
  /** Presence with no projector is the empty envelope this host always sent. */
  presence(): WorktreePresence;

  /**
   * Attach every roster to the row it was read for, and drop the rest.
   *
   * The rows here are the projector's own retained objects — a replay hands
   * them straight back — so each is COPIED rather than written through, or the
   * roster would end up inside the projector's replay state (design.md D3).
   * Eviction runs against the rows actually published, so a closed pane, or a
   * pane that started a new session, takes its roster with it.
   */
  withDelegations(source: WorktreePresence): WorktreePresence;

  /** The row `rowId` names in the envelope this host last published, if any. */
  publishedRow(rowId: string): WorktreeAgentRow | undefined;
}

export function createPresenceProjection(deps: PresenceProjectionDeps): PresenceProjection {
  return {
    presence() {
      return deps.projected() ?? { rowsByWorktreeId: {}, scannedAt: deps.now(), degradedSources: [] };
    },

    withDelegations(source) {
      const rosters = deps.rosters;
      if (rosters.size === 0) {
        return source;
      }
      const degraded = new Set(source.degradedSources.map((entry) => entry.source));
      const kept = new Set<string>();
      const rowsByWorktreeId: Record<string, WorktreeAgentRow[]> = {};
      for (const [worktreeId, rows] of Object.entries(source.rowsByWorktreeId)) {
        rowsByWorktreeId[worktreeId] = rows.map((row) => {
          const key = row.entryId === undefined ? undefined : rosterKey(row.rowId, row.entryId);
          const roster = key === undefined ? undefined : rosters.get(key);
          if (key === undefined || roster === undefined) {
            return row;
          }
          // A roster the agent reported for itself is the better evidence and is
          // already gone if its report went stale. Overwriting it with a cached
          // transcript read would replace live work with its own history.
          if (row.delegations?.kind === "ok" && row.delegations.reported) {
            kept.add(key);
            return row;
          }
          kept.add(key);
          return { ...row, delegations: decay(roster, row, degraded) };
        });
      }
      for (const key of rosters.keys()) {
        if (!kept.has(key)) {
          rosters.delete(key);
        }
      }
      return { ...source, rowsByWorktreeId };
    },

    publishedRow(rowId) {
      const envelope = deps.published();
      if (!envelope) {
        return undefined;
      }
      for (const rows of Object.values(envelope.presence.rowsByWorktreeId)) {
        const found = rows.find((row) => row.rowId === rowId);
        if (found) {
          return found;
        }
      }
      return undefined;
    },
  };
}
