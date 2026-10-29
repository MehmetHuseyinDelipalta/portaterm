// src/vault/readers/usage.ts — Per-model token tally shared by the detail readers,
// and the one place a `VaultSessionUsage` becomes the stats' `tokenCount`.

import type { VaultModelUsage, VaultSessionStats, VaultSessionUsage } from "../types";

/** The four disjoint token counts of {@link VaultModelUsage}. */
export interface UsageCounts {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

/** Every token the counts cover. */
export function usageCountsTotal(c: UsageCounts): number {
  return c.input + c.cacheRead + c.cacheWrite + c.output;
}

/** Every token the session sent and received, across its models. */
export function sessionUsageTotal(usage: VaultSessionUsage): number {
  return usage.models.reduce((sum, m) => sum + usageCountsTotal(m), 0);
}

/**
 * Accumulates counts per model. A `model` of `undefined` is its own bucket, for
 * sources that do not say which model spent the tokens.
 */
export function createUsageTally() {
  const byModel = new Map<string | undefined, VaultModelUsage>();
  return {
    add(model: string | undefined, counts: UsageCounts, costUSD?: number): void {
      let row = byModel.get(model);
      if (!row) {
        row = { ...(model !== undefined ? { model } : {}), input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
        byModel.set(model, row);
      }
      row.input += counts.input;
      row.cacheRead += counts.cacheRead;
      row.cacheWrite += counts.cacheWrite;
      row.output += counts.output;
      if (costUSD !== undefined) {
        row.costUSD = (row.costUSD ?? 0) + costUSD;
      }
    },
    /** The tally as session usage, or undefined when no model used a token. */
    result(includesSubagents: boolean): VaultSessionUsage | undefined {
      const models = [...byModel.values()]
        .filter((m) => usageCountsTotal(m) > 0)
        .sort((a, b) => usageCountsTotal(b) - usageCountsTotal(a));
      if (models.length === 0) {
        return undefined;
      }
      const costs = models.flatMap((m) => (m.costUSD !== undefined ? [m.costUSD] : []));
      return {
        models,
        ...(costs.length > 0 ? { costUSD: costs.reduce((a, b) => a + b, 0) } : {}),
        includesSubagents,
      };
    },
  };
}

/** The stats' token fields for `usage`: its total and the breakdown, or nothing. */
export function usageStats(usage: VaultSessionUsage | undefined): Pick<VaultSessionStats, "tokenCount" | "usage"> {
  return usage ? { tokenCount: sessionUsageTotal(usage), usage } : {};
}
