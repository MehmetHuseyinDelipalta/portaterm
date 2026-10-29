// src/webview/vault/format.test.ts — Folder-scope path containment and the Activity line formatting.

import { describe, expect, it } from "vitest";
import type { VaultSessionStats } from "../../vault/types";
import {
  formatCost,
  formatStats,
  formatStatsParts,
  formatTokens,
  formatToolBreakdown,
  formatUsageBreakdown,
  isWithin,
  MAX_TOOL_BREAKDOWN_LINES,
} from "./format";

describe("isWithin", () => {
  it("matches the folder itself and its subtree, not a sibling prefix", () => {
    expect(isWithin("/a/b", "/a/b")).toBe(true);
    expect(isWithin("/a/b/c", "/a/b/")).toBe(true);
    expect(isWithin("/a/bc", "/a/b")).toBe(false);
    expect(isWithin("/a", "/")).toBe(true);
  });

  it("matches a composed path against the same folder reported decomposed", () => {
    const composed = "/work/0- PHP-8 Geçişi";
    const decomposed = "/work/0- PHP-8 Geçişi";
    expect(isWithin(composed, decomposed)).toBe(true);
    expect(isWithin(`${composed}/best.sinavkoleji.k12.tr`, decomposed)).toBe(true);
    expect(isWithin(decomposed, composed)).toBe(true);
  });
});

describe("formatTokens", () => {
  it("prints small counts whole, thousands as k, millions as M", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1650)).toBe("1.6k");
    expect(formatTokens(999_949)).toBe("999.9k");
    // Would round to "1000.0k" — switches to M instead.
    expect(formatTokens(999_950)).toBe("1.0M");
    expect(formatTokens(1_298_026)).toBe("1.3M");
  });
});

describe("formatCost", () => {
  it("prints dollars to the cent, and never claims a tiny cost is $0.00", () => {
    expect(formatCost(1.0062)).toBe("$1.01");
    expect(formatCost(0.42)).toBe("$0.42");
    expect(formatCost(0.005)).toBe("$0.01");
    expect(formatCost(0.0003)).toBe("<$0.01");
    expect(formatCost(0)).toBe("$0.00");
  });
});

const usageStats = (over: Partial<VaultSessionStats> = {}): VaultSessionStats => ({
  messageCount: 3,
  toolCount: 1,
  subagentCount: 0,
  tokenCount: 1650,
  usage: {
    models: [{ model: "m", input: 50, cacheRead: 1000, cacheWrite: 500, output: 100, costUSD: 0.42 }],
    costUSD: 0.42,
    includesSubagents: false,
  },
  ...over,
});

describe("formatStats", () => {
  it("joins msgs, tokens, cost, tools, subagents", () => {
    expect(formatStats(usageStats({ subagentCount: 1 }))).toBe("3 msgs · 1.6k tok · ~$0.42 · 1 tool · 1 subagent");
  });

  it("leaves out what the session did not record", () => {
    expect(formatStats({ messageCount: 1, toolCount: 0, subagentCount: 0 })).toBe("1 msg · 0 tools");
    expect(formatStats({ messageCount: 2, toolCount: 2, subagentCount: 0, tokenCount: 40 })).toBe(
      "2 msgs · 40 tok · 2 tools",
    );
  });

  it("marks a lower-bound total with ≥", () => {
    const stats = usageStats();
    const usage = stats.usage && { ...stats.usage, lowerBound: true as const };
    expect(formatStats({ ...stats, usage })).toContain("≥1.6k tok");
  });

  it("tags the token and tool segments as breakdown anchors, nothing else", () => {
    expect(formatStatsParts(usageStats({ subagentCount: 1 })).map((p) => p.kind)).toEqual([
      "plain",
      "tokens",
      "plain",
      "tools",
      "plain",
    ]);
  });
});

describe("formatUsageBreakdown", () => {
  it("is empty without usage", () => {
    expect(formatUsageBreakdown({ messageCount: 1, toolCount: 0, subagentCount: 0, tokenCount: 5 })).toBe("");
  });

  it("lists each model's non-zero counts and cost, then the cost note", () => {
    expect(formatUsageBreakdown(usageStats())).toBe(
      [
        "m · $0.42",
        "50 input · 1.0k cache read · 500 cache write · 100 output",
        "",
        "Cost at API rates, as recorded by the agent.",
      ].join("\n"),
    );
  });

  it("names an unattributed bucket and adds no notes when nothing falls short", () => {
    expect(
      formatUsageBreakdown({
        messageCount: 1,
        toolCount: 0,
        subagentCount: 0,
        usage: { models: [{ input: 10, cacheRead: 0, cacheWrite: 0, output: 5 }], includesSubagents: false },
      }),
    ).toBe("All models\n10 input · 5 output");
  });

  it("notes a lower bound, and missing subagent usage only when there are subagents", () => {
    const base = usageStats();
    const usage = base.usage && { ...base.usage, costUSD: undefined, lowerBound: true as const };
    const text = formatUsageBreakdown({ ...base, subagentCount: 2, usage });
    expect(text).toContain("Only part of this session was read, so these are minimums.");
    expect(text).toContain("Subagent usage is not included.");
    expect(text).not.toContain("Cost at API rates");
    expect(formatUsageBreakdown({ ...base, subagentCount: 0 })).not.toContain("Subagent");
    const withSubagents = base.usage && { ...base.usage, includesSubagents: true };
    expect(formatUsageBreakdown({ ...base, subagentCount: 2, usage: withSubagents })).not.toContain("Subagent");
  });
});

describe("formatToolBreakdown", () => {
  const stats = (tools?: VaultSessionStats["tools"]): VaultSessionStats => ({
    messageCount: 1,
    toolCount: (tools ?? []).reduce((n, t) => n + t.count, 0),
    subagentCount: 0,
    ...(tools ? { tools } : {}),
  });

  it("is empty when no tool was called", () => {
    expect(formatToolBreakdown(stats())).toBe("");
  });

  it("lists every tool with its call count, in the order given", () => {
    expect(
      formatToolBreakdown(
        stats([
          { name: "Bash", count: 4 },
          { name: "Read", count: 3 },
          { name: "Edit", count: 1 },
        ]),
      ),
    ).toBe("Bash ×4\nRead ×3\nEdit ×1");
  });

  it("shows a list exactly at the cap in full", () => {
    const tools = Array.from({ length: MAX_TOOL_BREAKDOWN_LINES }, (_, i) => ({ name: `t${i}`, count: 1 }));
    const lines = formatToolBreakdown(stats(tools)).split("\n");
    expect(lines).toHaveLength(MAX_TOOL_BREAKDOWN_LINES);
    expect(lines.some((l) => l.startsWith("+"))).toBe(false);
  });

  it("folds the tail past the cap into one line that keeps the call total", () => {
    const tools = Array.from({ length: MAX_TOOL_BREAKDOWN_LINES + 2 }, (_, i) => ({ name: `t${i}`, count: i + 1 }));
    const lines = formatToolBreakdown(stats(tools)).split("\n");
    expect(lines).toHaveLength(MAX_TOOL_BREAKDOWN_LINES);
    // The last line stands in for the 3 tools it replaced: t14, t15, t16 → 15+16+17 calls.
    expect(lines[lines.length - 1]).toBe("+3 more tools ×48");
  });
});
