// src/vault/readers/claudeUsage.ts — A Claude transcript's token usage, fed one
// record at a time so it sees the whole stream even when the detail read keeps
// only its head and tail.
//
// Two sources, and the first wins:
//  - `cost-state`: Claude's own running total, rewritten (cumulatively) as the
//    session goes on. Per model, with Claude's USD cost, and covering every call
//    the session made — subagents, workflows, side requests — not just this file.
//  - the `usage` on each assistant record, summed. All a live session has before
//    its first `cost-state`, and all a subagent's own transcript ever has.

import { asRecord } from "../../utils/record";
import type { VaultSessionUsage } from "../types";
import { finiteNumberOrZero } from "./detail";
import { createUsageTally } from "./usage";

type Rec = Record<string, unknown>;

/**
 * `wholeSession: false` is for a SLICE of a transcript (one team turn): a
 * `cost-state` inside it is the whole session's total, not the slice's, so only
 * the slice's own records are summed.
 */
export function createClaudeUsageCollector(opts: { wholeSession?: boolean } = {}) {
  const wholeSession = opts.wholeSession !== false;
  const summed = createUsageTally();
  // One API response is written as several records (one per content block), each
  // repeating the response's full usage — count it once.
  const seen = new Set<string>();
  let costState: Rec | undefined;

  return {
    onRecord(rec: Rec): void {
      if (rec.type === "cost-state") {
        if (wholeSession && asRecord(rec.modelUsage)) {
          costState = rec; // cumulative, so the latest one is the session total
        }
        return;
      }
      if (rec.type !== "assistant") {
        return;
      }
      const msg = asRecord(rec.message);
      const usage = asRecord(msg?.usage);
      if (!msg || !usage) {
        return;
      }
      const key = typeof msg.id === "string" ? msg.id : typeof rec.requestId === "string" ? rec.requestId : undefined;
      if (key !== undefined) {
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
      }
      summed.add(typeof msg.model === "string" ? msg.model : undefined, {
        input: finiteNumberOrZero(usage.input_tokens),
        cacheRead: finiteNumberOrZero(usage.cache_read_input_tokens),
        cacheWrite: finiteNumberOrZero(usage.cache_creation_input_tokens),
        output: finiteNumberOrZero(usage.output_tokens),
      });
    },
    result(): VaultSessionUsage | undefined {
      return (costState && fromCostState(costState)) ?? summed.result(false);
    },
  };
}

function fromCostState(rec: Rec): VaultSessionUsage | undefined {
  const tally = createUsageTally();
  // A model Claude has no price for leaves the total short; show no cost rather
  // than a number that silently omits that model.
  const costKnown = rec.hasUnknownModelCost !== true;
  for (const [model, raw] of Object.entries(asRecord(rec.modelUsage) ?? {})) {
    const u = asRecord(raw);
    if (!u) {
      continue;
    }
    const cost = typeof u.costUSD === "number" && Number.isFinite(u.costUSD) ? u.costUSD : undefined;
    tally.add(
      model,
      {
        input: finiteNumberOrZero(u.inputTokens),
        cacheRead: finiteNumberOrZero(u.cacheReadInputTokens),
        cacheWrite: finiteNumberOrZero(u.cacheCreationInputTokens),
        output: finiteNumberOrZero(u.outputTokens),
      },
      costKnown ? cost : undefined,
    );
  }
  return tally.result(true);
}
