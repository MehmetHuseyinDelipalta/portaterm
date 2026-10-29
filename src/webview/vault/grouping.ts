// src/webview/vault/grouping.ts — Pure client-side grouping for the vault list
// (redesign-vault-panel-ui D2). No DOM, no host round-trip — operates on the
// already-loaded entries so switching modes is instant.

import type { VaultSessionEntry } from "../../vault/types";
import { getAgentAccent, getAgentDisplayName, type VaultAccent } from "./agentIcons";
import { leafSegment } from "./format";

export type GroupMode = "recent" | "agent" | "folder";

export interface VaultGroup {
  /** Which mode produced this group. */
  mode: GroupMode;
  /** Stable group identity (agent id, full cwd, or "recent"). */
  key: string;
  /** Display label for the group header. */
  label: string;
  /** Agent accent for the header dot (Agent mode only). */
  accent?: VaultAccent;
  /** Whether the cwd chip should be suppressed on rows (Folder mode). */
  hideCwd: boolean;
  entries: VaultSessionEntry[];
}

function byModifiedDesc(a: VaultSessionEntry, b: VaultSessionEntry): number {
  return b.modified - a.modified;
}

/**
 * Group `entries` for the given mode. Recent → one flat group ordered by
 * modified desc. Agent → grouped by `agent`. Folder → grouped by `cwd` (chip
 * suppressed). Non-Recent groups are ordered by their newest entry (desc), and
 * entries within every group are ordered by modified desc.
 *
 * `pinned` holds the entry ids pinned tabs are running, `open` the ids any live
 * pane is running. Pinned rows lead their group, then the user's starred rows,
 * then open ones, and a group is ranked by the highest band it holds; the
 * newest-first order still applies within each band. A star outranks an open
 * pane because it is the user's lasting choice, where open is only where a
 * session happens to run right now.
 */
export function groupEntries(
  entries: VaultSessionEntry[],
  mode: GroupMode,
  pinned: ReadonlySet<string> = new Set(),
  open: ReadonlySet<string> = new Set(),
): VaultGroup[] {
  // 3 = pinned, 2 = starred, 1 = open in a live pane, 0 = none of these.
  const band = (entry: VaultSessionEntry) =>
    pinned.has(entry.id) ? 3 : entry.starred ? 2 : open.has(entry.id) ? 1 : 0;
  const sorted = [...entries].sort((a, b) => band(b) - band(a) || byModifiedDesc(a, b));

  if (mode === "recent") {
    return [{ mode, key: "recent", label: "", hideCwd: false, entries: sorted }];
  }

  const buckets = new Map<string, VaultSessionEntry[]>();
  for (const entry of sorted) {
    const key = mode === "agent" ? entry.agent : entry.cwd;
    const list = buckets.get(key);
    if (list) {
      list.push(entry);
    } else {
      buckets.set(key, [entry]);
    }
  }

  const groups: VaultGroup[] = [];
  for (const [key, groupEntriesList] of buckets) {
    groups.push(
      mode === "agent"
        ? {
            mode,
            key,
            label: getAgentDisplayName(key) ?? key,
            accent: getAgentAccent(key),
            hideCwd: false,
            entries: groupEntriesList,
          }
        : { mode, key, label: leafSegment(key), hideCwd: true, entries: groupEntriesList },
    );
  }

  // Groups ranked by the highest band they hold, then by newest entry. A
  // bucket's highest-band rows lead it, so entries[0] carries its band.
  const rank = new Map<VaultGroup, { band: number; newest: number }>();
  for (const group of groups) {
    const first = group.entries[0];
    rank.set(group, {
      band: first === undefined ? 0 : band(first),
      newest: Math.max(0, ...group.entries.map((e) => e.modified)),
    });
  }
  groups.sort((a, b) => {
    const ra = rank.get(a);
    const rb = rank.get(b);
    return (rb?.band ?? 0) - (ra?.band ?? 0) || (rb?.newest ?? 0) - (ra?.newest ?? 0);
  });
  return groups;
}
