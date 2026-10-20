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
 * `pinned` holds the entry ids pinned tabs are running. Those rows lead their
 * group, and a group holding one leads the groups that do not; the newest-first
 * order still applies within each of those bands.
 */
export function groupEntries(
  entries: VaultSessionEntry[],
  mode: GroupMode,
  pinned: ReadonlySet<string> = new Set(),
): VaultGroup[] {
  const isPinned = (entry: VaultSessionEntry) => pinned.has(entry.id);
  const sorted = [...entries].sort((a, b) => Number(isPinned(b)) - Number(isPinned(a)) || byModifiedDesc(a, b));

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

  // Groups holding a pinned row first, then by newest entry. A bucket's pinned
  // rows lead it, so entries[0] says whether it holds one; the newest entry is
  // the first modified-desc row after them.
  const rank = new Map<VaultGroup, { pinned: number; newest: number }>();
  for (const group of groups) {
    const first = group.entries[0];
    const unpinned = group.entries.find((e) => !isPinned(e));
    rank.set(group, {
      pinned: first !== undefined && isPinned(first) ? 1 : 0,
      newest: Math.max(first?.modified ?? 0, unpinned?.modified ?? 0),
    });
  }
  groups.sort((a, b) => {
    const ra = rank.get(a);
    const rb = rank.get(b);
    return (rb?.pinned ?? 0) - (ra?.pinned ?? 0) || (rb?.newest ?? 0) - (ra?.newest ?? 0);
  });
  return groups;
}
