// src/vault/readers/toolTally.ts — Per-tool call counts behind a detail's
// `toolCount`. Every reader counts a call here at the same point it bumps its
// counter, so the breakdown always sums to the count it explains.

import type { VaultSessionStats, VaultToolUse } from "../types";

export function createToolTally() {
  const counts = new Map<string, number>();
  return {
    add(name: string): void {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    },
    /** Most-called first, ties by name. */
    result(): VaultToolUse[] {
      return [...counts]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    },
  };
}

/** The stats' `tools` field: the breakdown, or nothing when no tool was called. */
export function toolStats(tools: VaultToolUse[]): Pick<VaultSessionStats, "tools"> {
  return tools.length > 0 ? { tools } : {};
}
