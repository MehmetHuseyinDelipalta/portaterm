// src/webview/vault/format.ts — Pure, DOM-free formatting + path helpers for the
// AI-vault panel. No `this`, no side effects — independently unit-testable.

import type { VaultSessionDetail } from "../../vault/types";
import { getAgentDisplayName } from "./agentIcons";

/** Last path segment (folder leaf) for the cwd chip. */
export function leafSegment(cwd: string): string {
  const trimmed = cwd.replace(/[/\\]+$/, "");
  const parts = trimmed.split(/[/\\]/);
  return parts[parts.length - 1] || trimmed || cwd;
}

/** Drop leading/trailing separators and collapse consecutive ones. */
export function collapseSeparators<T>(items: (T | "sep")[]): (T | "sep")[] {
  const out: (T | "sep")[] = [];
  for (const it of items) {
    if (it === "sep") {
      if (out.length === 0 || out[out.length - 1] === "sep") {
        continue;
      }
    }
    out.push(it);
  }
  while (out.length > 0 && out[out.length - 1] === "sep") {
    out.pop();
  }
  return out;
}

/** Compact token count: 1650 → "1.6k", 1_250_000 → "1.3M". */
export function formatTokens(n: number): string {
  if (n >= 999_950) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** USD to the cent; a cost too small to show a cent reads "<$0.01", never "$0.00". */
export function formatCost(usd: number): string {
  if (usd > 0 && usd < 0.005) {
    return "<$0.01";
  }
  return `$${usd.toFixed(2)}`;
}

/** One segment of the Activity line; `tokens` and `tools` carry a hover breakdown. */
export interface StatsPart {
  kind: "plain" | "tokens" | "tools";
  text: string;
}

/** Activity summary segments: "24 msgs", "18.2k tok", "~$0.42", "8 tools", "1 subagent". */
export function formatStatsParts(stats: VaultSessionDetail["stats"]): StatsPart[] {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const parts: StatsPart[] = [{ kind: "plain", text: plural(stats.messageCount, "msg") }];
  if (stats.tokenCount !== undefined) {
    const floor = stats.usage?.lowerBound ? "≥" : "";
    parts.push({ kind: "tokens", text: `${floor}${formatTokens(stats.tokenCount)} tok` });
  }
  if (stats.usage?.costUSD !== undefined) {
    // "~": the agent's figure at API rates, not necessarily what was billed.
    parts.push({ kind: "plain", text: `~${formatCost(stats.usage.costUSD)}` });
  }
  parts.push({ kind: "tools", text: plural(stats.toolCount, "tool") });
  if (stats.subagentCount > 0) {
    parts.push({ kind: "plain", text: plural(stats.subagentCount, "subagent") });
  }
  return parts;
}

/** Activity summary line: "24 msgs · 18.2k tok · ~$0.42 · 8 tools · 1 subagent". */
export function formatStats(stats: VaultSessionDetail["stats"]): string {
  return formatStatsParts(stats)
    .map((p) => p.text)
    .join(" · ");
}

/** Tool lines shown before the rest collapse into one "+N more" line. */
export const MAX_TOOL_BREAKDOWN_LINES = 15;

/** The hover breakdown behind the tool count: one "Name ×count" line per tool. */
export function formatToolBreakdown(stats: VaultSessionDetail["stats"]): string {
  const tools = stats.tools ?? [];
  const shown = tools.length > MAX_TOOL_BREAKDOWN_LINES ? MAX_TOOL_BREAKDOWN_LINES - 1 : tools.length;
  const lines = tools.slice(0, shown).map((t) => `${t.name} ×${t.count}`);
  const rest = tools.slice(shown);
  if (rest.length > 0) {
    const calls = rest.reduce((sum, t) => sum + t.count, 0);
    lines.push(`+${rest.length} more tools ×${calls}`);
  }
  return lines.join("\n");
}

/**
 * The hover breakdown behind the token count: per model, the non-zero counts and
 * the agent's cost, then a note for each way the figures fall short of the truth.
 */
export function formatUsageBreakdown(stats: VaultSessionDetail["stats"]): string {
  const usage = stats.usage;
  if (!usage) {
    return "";
  }
  const lines: string[] = [];
  for (const m of usage.models) {
    const cost = m.costUSD !== undefined ? ` · ${formatCost(m.costUSD)}` : "";
    lines.push(`${m.model ?? "All models"}${cost}`);
    const counts: [number, string][] = [
      [m.input, "input"],
      [m.cacheRead, "cache read"],
      [m.cacheWrite, "cache write"],
      [m.output, "output"],
    ];
    lines.push(
      counts
        .filter(([n]) => n > 0)
        .map(([n, label]) => `${formatTokens(n)} ${label}`)
        .join(" · "),
    );
  }
  const notes: string[] = [];
  if (usage.costUSD !== undefined) {
    notes.push("Cost at API rates, as recorded by the agent.");
  }
  if (usage.lowerBound) {
    notes.push("Only part of this session was read, so these are minimums.");
  }
  if (!usage.includesSubagents && stats.subagentCount > 0) {
    notes.push("Subagent usage is not included.");
  }
  return [...lines, ...(notes.length > 0 ? ["", ...notes] : [])].join("\n");
}

/** True iff `child` equals `parent` or sits inside its subtree (either separator, any Unicode normal form). */
export function isWithin(child: string, parent: string): boolean {
  if (!child || !parent) {
    return false;
  }
  // Strip trailing separators so a trailing-slash parent (`/a/b/`) and a root
  // (`/`) compare correctly without falling into the sibling-prefix trap
  // (`/a/b` must NOT match `/a/bc`). A parent that normalizes to empty was a
  // filesystem root → it contains every absolute path.
  // NFC first: macOS reports a live cwd (lsof) decomposed — `c` + U+0327 for
  // `ç` — while agents record it composed, so the same folder would not match.
  const strip = (p: string): string => p.normalize("NFC").replace(/[/\\]+$/, "");
  const c = strip(child);
  const p = strip(parent);
  if (p === "") {
    return true;
  }
  return c === p || c.startsWith(`${p}/`) || c.startsWith(`${p}\\`);
}

export function agentLabel(agent: string): string {
  return getAgentDisplayName(agent) ?? agent;
}

/** "just now" / "5m" / "3h" / "2d" / "Jan 5" — compact relative age. */
export function formatRelativeTime(epochMs: number, now: number = Date.now()): string {
  const diff = now - epochMs;
  if (!Number.isFinite(epochMs) || epochMs <= 0 || diff < 0) {
    return "";
  }
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min) {
    return "just now";
  }
  if (diff < hour) {
    return `${Math.floor(diff / min)}m ago`;
  }
  if (diff < day) {
    return `${Math.floor(diff / hour)}h ago`;
  }
  if (diff < 7 * day) {
    return `${Math.floor(diff / day)}d ago`;
  }
  return new Date(epochMs).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
