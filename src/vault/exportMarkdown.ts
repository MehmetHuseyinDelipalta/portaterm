// src/vault/exportMarkdown.ts — Render a session's preview timeline as a
// Markdown document, for sharing with a team or pasting into a PR description.
//
// Pure: the host reads the detail, this turns it into text, the host writes it.
// The output follows the preview's own reading order, and keeps the preview's
// folding: reasoning, compaction summaries and subagent transcripts go inside
// `<details>` blocks, which GitHub and most Markdown viewers render collapsed.

import { getAgentDefinition } from "./registry";
import type { VaultActivityStep, VaultSessionDetail, VaultSessionEntry, VaultTimelineItem } from "./types";

export interface SessionMarkdownOptions {
  /** Formats an epoch-ms timestamp. Defaults to local `YYYY-MM-DD HH:MM`. */
  formatTime?: (epochMs: number) => string;
  /** When the export ran; stamped into the footer. Defaults to now. */
  now?: number;
}

/** One rendered timeline item. List items join without a blank line between them. */
interface Block {
  text: string;
  list?: boolean;
}

export function renderSessionMarkdown(
  entry: VaultSessionEntry,
  detail: VaultSessionDetail,
  options: SessionMarkdownOptions = {},
): string {
  const time = options.formatTime ?? formatLocalTime;
  const parts: string[] = [
    `# ${oneLine(entry.customName || entry.title || entry.sessionId)}`,
    metaTable(entry, detail, time),
  ];

  const notes: string[] = [];
  if (detail.partial && detail.limitedReason) {
    notes.push(detail.limitedReason);
  }
  if (detail.truncated) {
    notes.push(`Only the most recent ${detail.timeline.length} timeline items are included.`);
  }
  if (detail.contentKind === "metadata-only") {
    notes.push("This session's transcript is not readable, so only its details are exported.");
  }
  if (notes.length > 0) {
    parts.push(notes.map((n) => `> **Note:** ${oneLine(n)}`).join("\n>\n"));
  }

  if (detail.contentKind === "timeline" && detail.timeline.length > 0) {
    parts.push("---", joinBlocks(detail.timeline.map((item) => renderItem(item, time))));
  }

  const stamp = time(options.now ?? Date.now());
  parts.push("---", `*Exported from Portaterm on ${stamp}.*`);
  return `${parts.join("\n\n")}\n`;
}

/**
 * The save dialog's default filename: the session's name as a lowercase slug,
 * then the export date — `fix-the-login-bug-2026-10-29.md`. Accents fold to
 * their base letter (`dışa` → `disa`) rather than vanishing from the name.
 */
export function sessionExportFilename(entry: VaultSessionEntry, now: number = Date.now()): string {
  const name = entry.customName || entry.title || `${entry.agent}-${entry.sessionId}`;
  const slug = name
    .replace(/ı/g, "i")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, MAX_SLUG)
    .replace(/^-+|-+$/g, "");
  return `${slug || "session"}-${formatLocalTime(now).slice(0, 10)}.md`;
}

const MAX_SLUG = 60;

// ─── Header ─────────────────────────────────────────────────────────

function metaTable(entry: VaultSessionEntry, detail: VaultSessionDetail, time: (ms: number) => string): string {
  const rows: [string, string][] = [
    ["Agent", getAgentDefinition(entry.agent)?.displayName ?? entry.agent],
    ["Session", code(entry.sessionId)],
  ];
  if (entry.cwd) {
    rows.push(["Folder", code(entry.cwd)]);
  }
  if (entry.gitBranch) {
    rows.push(["Branch", code(entry.gitBranch)]);
  }
  rows.push(["Last active", time(entry.modified)]);

  const { stats } = detail;
  const activity = [
    plural(stats.messageCount, "message"),
    plural(stats.toolCount, "tool call"),
    ...(stats.subagentCount > 0 ? [plural(stats.subagentCount, "subagent")] : []),
  ];
  rows.push(["Activity", activity.join(" · ")]);
  if (stats.tokenCount !== undefined && stats.tokenCount > 0) {
    const floor = stats.usage?.lowerBound ? "≥ " : "";
    rows.push(["Tokens", `${floor}${stats.tokenCount.toLocaleString("en-US")}`]);
  }
  if (stats.usage?.costUSD !== undefined) {
    const floor = stats.usage.lowerBound ? "≥ " : "";
    rows.push(["Cost", `${floor}${formatCost(stats.usage.costUSD)}`]);
  }
  const models = stats.usage?.models.flatMap((m) => (m.model ? [code(m.model)] : [])) ?? [];
  if (models.length > 0) {
    rows.push([models.length === 1 ? "Model" : "Models", models.join(", ")]);
  }

  const body = rows.map(([k, v]) => `| ${k} | ${cell(v)} |`).join("\n");
  return `| | |\n|---|---|\n${body}`;
}

// ─── Timeline ───────────────────────────────────────────────────────

function joinBlocks(blocks: Block[]): string {
  let out = "";
  blocks.forEach((b, i) => {
    if (i > 0) {
      out += b.list && blocks[i - 1].list ? "\n" : "\n\n";
    }
    out += b.text;
  });
  return out;
}

function renderItem(item: VaultTimelineItem, time: (ms: number) => string): Block {
  const at = (ts: number | undefined): string => (ts === undefined ? "" : ` · ${time(ts)}`);
  switch (item.kind) {
    case "message": {
      const role = item.role === "user" ? "User" : "Assistant";
      const model = item.model ? ` · ${code(item.model)}` : "";
      return { text: `### ${role}${model}${at(item.timestamp)}\n\n${item.text.trim()}` };
    }
    case "thinking":
      return { text: details("Thinking", item.text) };
    case "notice": {
      const status = item.status ? ` (${item.status})` : "";
      const line = `> **Notice:** ${oneLine(item.summary)}${status}`;
      return { text: item.body ? `${line}\n\n${details("Notice output", item.body)}` : line };
    }
    case "compaction":
      return { text: details(`Context compacted${at(item.timestamp)}`, item.text) };
    case "gap":
      return { text: "*… earlier records were omitted here …*" };
    case "question": {
      const lines = item.questions.map((q) => {
        const answer = q.answer ? `**${oneLine(q.answer)}**` : "*no answer*";
        return `- ${oneLine(q.prompt)} → ${answer}`;
      });
      return { text: `### Question${at(item.timestamp)}\n\n${lines.join("\n")}` };
    }
    case "subagentSession":
      return subagentBlock({
        name: item.undeclared ? undefined : item.agent,
        title: item.title,
        status: item.status,
        prompt: item.prompt ?? item.firstMessage,
        result: item.result,
        continuation: item.continuation,
      });
    case "teammateTurn":
      return { text: quote(`**@${item.agentName}** ← ${item.from}${at(item.timestamp)}`, item.preview) };
    case "teammateMessage":
      return { text: quote(`**@${item.agentName}** ← ${item.from}${at(item.timestamp)}`, item.text) };
    case "workflowBoard":
      return { text: workflowBlock(item) };
    case "tool":
    case "subagent":
      return stepBlock(item);
  }
}

function stepBlock(step: VaultActivityStep): Block {
  if (step.kind === "tool") {
    const detail = step.detail ? ` ${code(oneLine(step.detail))}` : "";
    const diff = step.diff ? ` (+${step.diff.added} −${step.diff.removed})` : "";
    return { text: `- **${step.tool}**${detail}${diff}`, list: true };
  }
  return subagentBlock({
    name: step.undeclared ? undefined : step.name,
    title: step.title,
    status: step.status,
    prompt: step.prompt,
    result: step.result,
    continuation: step.continuation,
  });
}

function subagentBlock(sub: {
  name?: string;
  title?: string;
  status?: string;
  prompt?: string;
  result?: string;
  continuation?: boolean;
}): Block {
  const label = [
    sub.continuation ? "Subagent (continued)" : "Subagent",
    sub.name ? `@${sub.name}` : "",
    sub.title ? `— ${oneLine(sub.title)}` : "",
    sub.status ? `(${sub.status})` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const sections = [
    ...(sub.prompt ? [`**Prompt**\n\n${sub.prompt.trim()}`] : []),
    ...(sub.result ? [`**Result**\n\n${sub.result.trim()}`] : []),
  ];
  if (sections.length === 0) {
    return { text: `- ${label}`, list: true };
  }
  return { text: details(label, sections.join("\n\n")) };
}

function workflowBlock(wf: Extract<VaultTimelineItem, { kind: "workflowBoard" }>): string {
  const facts = [
    wf.status,
    wf.agentCount !== undefined ? plural(wf.agentCount, "agent") : undefined,
    wf.totalToolCalls !== undefined ? plural(wf.totalToolCalls, "tool call") : undefined,
    wf.totalTokens !== undefined ? `${wf.totalTokens.toLocaleString("en-US")} tokens` : undefined,
    wf.durationMs !== undefined ? formatDuration(wf.durationMs) : undefined,
  ].filter((f): f is string => Boolean(f));
  const lines = [`### Workflow: ${oneLine(wf.workflowName)}`];
  if (wf.summary) {
    lines.push("", wf.summary.trim());
  }
  if (facts.length > 0) {
    lines.push("", `*${facts.join(" · ")}*`);
  }
  // Grouped as the board groups them: agents under their phase, and any whose
  // phase the manifest never declared under a trailing "Other".
  const known = new Set(wf.phases.map((p) => p.index));
  const groups = wf.phases.map((p) => ({
    title: `**${oneLine(p.title)}**${p.detail ? ` — ${oneLine(p.detail)}` : ""}`,
    agents: wf.agents.filter((a) => a.phaseIndex === p.index),
  }));
  const orphans = wf.agents.filter((a) => !known.has(a.phaseIndex));
  if (orphans.length > 0) {
    groups.push({ title: "**Other**", agents: orphans });
  }
  if (groups.length > 0) {
    lines.push("");
    for (const group of groups) {
      lines.push(`- ${group.title}`);
      for (const agent of group.agents) {
        lines.push(`  - ${oneLine(agent.label)}`);
      }
    }
  }
  return lines.join("\n");
}

// ─── Text helpers ───────────────────────────────────────────────────

/** A collapsed `<details>` block. The blank lines let the body render as Markdown. */
function details(summary: string, body: string): string {
  return `<details>\n<summary>${escapeHtml(oneLine(summary))}</summary>\n\n${body.trim()}\n\n</details>`;
}

function quote(head: string, body: string): string {
  const lines = [head, "", ...body.trim().split("\n")];
  return lines.map((l) => (l ? `> ${l}` : ">")).join("\n");
}

/** An inline code span that survives backticks inside the value. */
function code(value: string): string {
  const longest = Math.max(0, ...(value.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  const pad = value.startsWith("`") || value.endsWith("`") ? " " : "";
  return `${fence}${pad}${value}${pad}${fence}`;
}

function cell(value: string): string {
  return oneLine(value).replace(/\|/g, "\\|");
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function plural(n: number, noun: string): string {
  return `${n.toLocaleString("en-US")} ${noun}${n === 1 ? "" : "s"}`;
}

function formatCost(usd: number): string {
  return usd > 0 && usd < 0.005 ? "<$0.01" : `$${usd.toFixed(2)}`;
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) {
    return `${s}s`;
  }
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function formatLocalTime(epochMs: number): string {
  const d = new Date(epochMs);
  const pad = (n: number): string => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
