import { describe, expect, it } from "vitest";
import { renderSessionMarkdown, sessionExportFilename } from "./exportMarkdown";
import type { VaultSessionDetail, VaultSessionEntry, VaultTimelineItem } from "./types";

const time = (ms: number): string => `T${ms}`;

function entry(over: Partial<VaultSessionEntry> = {}): VaultSessionEntry {
  return {
    id: "claude:s1",
    agent: "claude",
    sessionId: "s1",
    title: "Fix the login bug",
    cwd: "/work/app",
    modified: 1000,
    flags: {},
    ...over,
  };
}

function detail(timeline: VaultTimelineItem[], over: Partial<VaultSessionDetail> = {}): VaultSessionDetail {
  return {
    entryId: "claude:s1",
    contentKind: "timeline",
    recentActivity: [],
    timeline,
    stats: { messageCount: 2, toolCount: 1, subagentCount: 0 },
    ...over,
  };
}

function render(timeline: VaultTimelineItem[], over: Partial<VaultSessionDetail> = {}, e = entry()): string {
  return renderSessionMarkdown(e, detail(timeline, over), { formatTime: time, now: 9 });
}

describe("renderSessionMarkdown: header", () => {
  it("titles the document and lists the session's details in a table", () => {
    const md = render([], {}, entry({ gitBranch: "fix/login" }));
    expect(md.startsWith("# Fix the login bug\n\n| | |\n|---|---|\n")).toBe(true);
    expect(md).toContain("| Agent | Claude Code |");
    expect(md).toContain("| Session | `s1` |");
    expect(md).toContain("| Folder | `/work/app` |");
    expect(md).toContain("| Branch | `fix/login` |");
    expect(md).toContain("| Last active | T1000 |");
    expect(md).toContain("| Activity | 2 messages · 1 tool call |");
    expect(md.endsWith("---\n\n*Exported from Portaterm on T9.*\n")).toBe(true);
  });

  it("prefers the user's custom name over the reader's title", () => {
    expect(render([], {}, entry({ customName: "Login fix" }))).toMatch(/^# Login fix\n/);
  });

  it("shows tokens, cost and models, marking a windowed read as a floor", () => {
    const md = render([], {
      stats: {
        messageCount: 1,
        toolCount: 0,
        subagentCount: 2,
        tokenCount: 1234567,
        usage: {
          models: [
            { model: "opus", input: 1, cacheRead: 0, cacheWrite: 0, output: 1, costUSD: 1.5 },
            { input: 1, cacheRead: 0, cacheWrite: 0, output: 1 },
          ],
          costUSD: 1.5,
          includesSubagents: false,
          lowerBound: true,
        },
      },
    });
    expect(md).toContain("| Activity | 1 message · 0 tool calls · 2 subagents |");
    expect(md).toContain("| Tokens | ≥ 1,234,567 |");
    expect(md).toContain("| Cost | ≥ $1.50 |");
    expect(md).toContain("| Model | `opus` |");
  });

  it("reads a sub-cent cost as <$0.01 and lists several models", () => {
    const md = render([], {
      stats: {
        messageCount: 1,
        toolCount: 0,
        subagentCount: 0,
        tokenCount: 10,
        usage: {
          models: [
            { model: "a", input: 1, cacheRead: 0, cacheWrite: 0, output: 1 },
            { model: "b", input: 1, cacheRead: 0, cacheWrite: 0, output: 1 },
          ],
          costUSD: 0.001,
          includesSubagents: true,
        },
      },
    });
    expect(md).toContain("| Tokens | 10 |");
    expect(md).toContain("| Cost | <$0.01 |");
    expect(md).toContain("| Models | `a`, `b` |");
  });

  it("leaves out the rows a session has no value for", () => {
    const md = render([], {}, entry({ cwd: "" }));
    expect(md).not.toContain("| Folder");
    expect(md).not.toContain("| Branch");
    expect(md).not.toContain("| Tokens");
    expect(md).not.toContain("| Cost");
    expect(md).not.toContain("| Model");
  });

  it("escapes a pipe so a value cannot split its table cell", () => {
    expect(render([], {}, entry({ gitBranch: "a|b" }))).toContain("| Branch | `a\\|b` |");
  });

  it("notes a partial read, a truncated timeline, and a metadata-only session", () => {
    const md = render([{ kind: "gap" }], { partial: true, limitedReason: "Middle skipped.", truncated: true });
    expect(md).toContain(
      "> **Note:** Middle skipped.\n>\n> **Note:** Only the most recent 1 timeline items are included.",
    );
    const meta = render([], { contentKind: "metadata-only" });
    expect(meta).toContain("> **Note:** This session's transcript is not readable");
    expect(meta).not.toContain("---\n\n---");
  });

  it("falls back to the agent's id when the registry does not know it", () => {
    expect(render([], {}, entry({ agent: "mystery" }))).toContain("| Agent | mystery |");
  });
});

describe("renderSessionMarkdown: timeline", () => {
  it("renders messages as headed sections with role, model and time", () => {
    const md = render([
      { kind: "message", role: "user", text: "  Please fix it  ", timestamp: 5 },
      { kind: "message", role: "assistant", text: "Done:\n\n- one", model: "opus" },
    ]);
    expect(md).toContain("### User · T5\n\nPlease fix it\n\n### Assistant · `opus`\n\nDone:\n\n- one");
  });

  it("groups consecutive tool steps into one list", () => {
    const md = render([
      { kind: "tool", tool: "Read", detail: "src/a.ts" },
      { kind: "tool", tool: "Edit", detail: "src/a.ts", diff: { added: 3, removed: 1 } },
      { kind: "tool", tool: "Bash" },
      { kind: "message", role: "assistant", text: "ok" },
    ]);
    expect(md).toContain("- **Read** `src/a.ts`\n- **Edit** `src/a.ts` (+3 −1)\n- **Bash**\n\n### Assistant");
  });

  it("keeps a backtick inside a tool detail from breaking its code span", () => {
    expect(render([{ kind: "tool", tool: "Bash", detail: "echo `date`" }])).toContain("- **Bash** `` echo `date` ``");
  });

  it("folds reasoning and compaction into collapsed details blocks", () => {
    const md = render([
      { kind: "thinking", text: "hmm <x>" },
      { kind: "compaction", text: "summary", timestamp: 3 },
    ]);
    expect(md).toContain("<details>\n<summary>Thinking</summary>\n\nhmm <x>\n\n</details>");
    expect(md).toContain("<details>\n<summary>Context compacted · T3</summary>\n\nsummary\n\n</details>");
  });

  it("renders a notice as a quote, with its output folded when there is one", () => {
    const md = render([
      { kind: "notice", summary: "Task done", status: "completed", body: "output" },
      { kind: "notice", summary: "Bare" },
    ]);
    expect(md).toContain(
      "> **Notice:** Task done (completed)\n\n<details>\n<summary>Notice output</summary>\n\noutput\n\n</details>",
    );
    expect(md).toContain("> **Notice:** Bare");
  });

  it("marks a gap where the reader omitted records", () => {
    expect(render([{ kind: "gap" }])).toContain("*… earlier records were omitted here …*");
  });

  it("lists each question with the answer picked, or none", () => {
    const md = render([
      {
        kind: "question",
        timestamp: 4,
        questions: [{ prompt: "Which db?", answer: "Postgres" }, { prompt: "Pending?" }],
      },
    ]);
    expect(md).toContain("### Question · T4\n\n- Which db? → **Postgres**\n- Pending? → *no answer*");
  });

  it("folds a subagent's prompt and result under a labelled summary", () => {
    const md = render([
      {
        kind: "subagentSession",
        entryId: "claude:s1:subagent:a",
        title: "Find usages",
        agent: "Explore",
        status: "completed",
        prompt: "Look for X",
        result: "Found 3",
      },
      {
        kind: "subagentSession",
        entryId: "claude:s1:subagent:b",
        title: "Again",
        agent: "Explore",
        firstMessage: "first",
        continuation: true,
        undeclared: true,
      },
    ]);
    expect(md).toContain(
      "<summary>Subagent @Explore — Find usages (completed)</summary>\n\n**Prompt**\n\nLook for X\n\n**Result**\n\nFound 3",
    );
    // An undeclared agent type carries no `@agent`; a missing prompt falls back to the first message.
    expect(md).toContain("<summary>Subagent (continued) — Again</summary>\n\n**Prompt**\n\nfirst");
  });

  it("renders a subagent step with nothing to fold as a list line", () => {
    const md = render([
      { kind: "subagent", name: "Plan", title: "Design it", background: true },
      { kind: "subagent", name: "Task", undeclared: true, result: "done", status: "failed" },
    ]);
    expect(md).toContain("- Subagent @Plan — Design it");
    expect(md).toContain("<summary>Subagent (failed)</summary>\n\n**Result**\n\ndone");
  });

  it("quotes teammate turns and messages line by line", () => {
    const md = render([
      { kind: "teammateTurn", entryId: "e", agentName: "ana", from: "leader", preview: "do A", timestamp: 7 },
      { kind: "teammateMessage", agentName: "bo", from: "peer", text: "line1\nline2" },
    ]);
    expect(md).toContain("> **@ana** ← leader · T7\n>\n> do A");
    expect(md).toContain("> **@bo** ← peer\n>\n> line1\n> line2");
  });

  it("renders a workflow run with its facts and agents grouped by phase", () => {
    const md = render([
      {
        kind: "workflowBoard",
        wfId: "wf_1",
        workflowName: "review",
        summary: "Reviewed it",
        status: "completed",
        agentCount: 3,
        totalToolCalls: 12,
        totalTokens: 4500,
        durationMs: 125_000,
        phases: [
          { index: 0, title: "Scan", detail: "find files" },
          { index: 1, title: "Verify" },
        ],
        agents: [
          { label: "scan:a", phaseIndex: 0 },
          { label: "verify:a", phaseIndex: 1 },
          { label: "stray", phaseIndex: 9 },
        ],
      },
    ]);
    expect(md).toContain(
      [
        "### Workflow: review",
        "",
        "Reviewed it",
        "",
        "*completed · 3 agents · 12 tool calls · 4,500 tokens · 2m 5s*",
        "",
        "- **Scan** — find files",
        "  - scan:a",
        "- **Verify**",
        "  - verify:a",
        "- **Other**",
        "  - stray",
      ].join("\n"),
    );
  });

  it("formats workflow durations in seconds and hours, and omits absent facts", () => {
    const base = { kind: "workflowBoard" as const, wfId: "w", workflowName: "x", phases: [], agents: [] };
    expect(render([{ ...base, durationMs: 4000 }])).toContain("*4s*");
    expect(render([{ ...base, durationMs: 3_720_000 }])).toContain("*1h 2m*");
    const bare = render([base]);
    expect(bare).toContain("### Workflow: x\n\n---");
  });
});

describe("sessionExportFilename", () => {
  const NOW = new Date(2026, 9, 29, 10, 30).getTime();

  it("slugs the custom name, then the title, then agent and id, and adds the date", () => {
    expect(sessionExportFilename(entry({ customName: "Mine" }), NOW)).toBe("mine-2026-10-29.md");
    expect(sessionExportFilename(entry(), NOW)).toBe("fix-the-login-bug-2026-10-29.md");
    expect(sessionExportFilename(entry({ title: "" }), NOW)).toBe("claude-s1-2026-10-29.md");
  });

  it("folds accented letters to their base letter instead of dropping them", () => {
    expect(sessionExportFilename(entry({ title: "Oturumu dışa aktar: Önizleme & Çizelge!" }), NOW)).toBe(
      "oturumu-disa-aktar-onizleme-cizelge-2026-10-29.md",
    );
  });

  it("caps a long name and never leaves a dangling dash", () => {
    const name = sessionExportFilename(entry({ title: `${"a".repeat(59)} tail` }), NOW);
    expect(name).toBe(`${"a".repeat(59)}-2026-10-29.md`);
  });

  it("names a session whose title has no letters at all", () => {
    expect(sessionExportFilename(entry({ title: "!!!" }), NOW)).toBe("session-2026-10-29.md");
  });
});
