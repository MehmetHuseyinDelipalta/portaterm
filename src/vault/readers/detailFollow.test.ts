// The detail readers re-read a followed transcript through the shared follow
// cache (B3): what a re-read returns after an append is what a fresh read
// returns, and the lines it had already read are not read again.

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SqliteResult } from "../sqlite";
import { readClaudeDetail } from "./claudeReader";
import { scanClaudeTranscript } from "./claudeScan";
import { readCodexDetail } from "./codexReader";
import { jsonlFollowCache } from "./jsonlFollow";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "at-detail-follow-"));
  jsonlFollowCache.clear();
});

afterEach(async () => {
  jsonlFollowCache.clear();
  await fs.rm(root, { recursive: true, force: true });
});

const jsonl = (records: Record<string, unknown>[]) => `${records.map((r) => JSON.stringify(r)).join("\n")}\n`;

/** Overwrite `from` with `to` (same byte length) where it first occurs — same inode, far from the end. */
async function rewriteInPlace(file: string, from: string, to: string): Promise<void> {
  expect(Buffer.byteLength(from)).toBe(Buffer.byteLength(to));
  const content = await fs.readFile(file);
  const at = content.indexOf(from);
  expect(at).toBeGreaterThanOrEqual(0);
  const handle = await fs.open(file, "r+");
  try {
    await handle.write(Buffer.from(to), 0, Buffer.byteLength(to), at);
  } finally {
    await handle.close();
  }
}

function claudeUser(text: string, ts: string) {
  return { type: "user", uuid: `u-${ts}`, timestamp: ts, message: { role: "user", content: text } };
}

function claudeAssistant(text: string, ts: string, extra: Record<string, unknown> = {}) {
  return {
    type: "assistant",
    uuid: `a-${ts}`,
    timestamp: ts,
    message: {
      id: `msg-${ts}`,
      role: "assistant",
      model: "claude-opus",
      content: [{ type: "text", text }],
      usage: { input_tokens: 10, output_tokens: 5 },
    },
    ...extra,
  };
}

describe("Claude main session", () => {
  const configDir = () => path.join(root, "claude");
  async function writeSession(records: Record<string, unknown>[]): Promise<string> {
    const dir = path.join(configDir(), "projects", "-Users-me-proj");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, "sess-1.jsonl");
    await fs.writeFile(file, jsonl(records));
    return file;
  }

  it("answers a re-read after an append exactly as a fresh read does", async () => {
    const file = await writeSession([
      claudeUser("first prompt", "2026-11-01T10:00:00.000Z"),
      claudeAssistant("first answer", "2026-11-01T10:00:01.000Z"),
    ]);
    const before = await readClaudeDetail("sess-1", { configDir: configDir() });
    expect(before?.timeline).toHaveLength(2);

    await fs.appendFile(
      file,
      jsonl([
        claudeUser("second prompt", "2026-11-01T10:01:00.000Z"),
        claudeAssistant("second answer", "2026-11-01T10:01:01.000Z"),
      ]),
    );
    const followed = await readClaudeDetail("sess-1", { configDir: configDir() });
    jsonlFollowCache.clear();
    const fresh = await readClaudeDetail("sess-1", { configDir: configDir() });

    expect(followed).toEqual(fresh);
    expect(followed?.timeline).toHaveLength(4);
    expect(followed?.stats.usage?.models[0]).toMatchObject({ input: 20, output: 10 });
  });

  it("does not read again the lines it already read", async () => {
    // Witness: a line changed in place far from the end is not noticed by a
    // re-read — it was not parsed again — while a fresh read sees it.
    const file = await writeSession([
      claudeUser("ORIGINAL prompt", "2026-11-01T10:00:00.000Z"),
      claudeAssistant(
        "an answer long enough to keep the change away from the end of the file",
        "2026-11-01T10:00:01.000Z",
      ),
    ]);
    await readClaudeDetail("sess-1", { configDir: configDir() });

    await rewriteInPlace(file, "ORIGINAL", "REWRITTN");
    await fs.appendFile(file, jsonl([claudeUser("next prompt", "2026-11-01T10:01:00.000Z")]));
    const followed = await readClaudeDetail("sess-1", { configDir: configDir() });
    jsonlFollowCache.clear();
    const fresh = await readClaudeDetail("sess-1", { configDir: configDir() });

    const texts = (d: typeof fresh) => d?.timeline.flatMap((t) => (t.kind === "message" ? [t.text] : []));
    expect(texts(followed)).toEqual(["ORIGINAL prompt", expect.any(String), "next prompt"]);
    expect(texts(fresh)).toEqual(["REWRITTN prompt", expect.any(String), "next prompt"]);
  });
});

describe("Claude subagent", () => {
  it("answers a re-read after an append exactly as a fresh read does", async () => {
    const configDir = path.join(root, "claude");
    const projectDir = path.join(configDir, "projects", "-Users-me-proj");
    const subDir = path.join(projectDir, "sess-1", "subagents");
    await fs.mkdir(subDir, { recursive: true });
    await fs.writeFile(path.join(projectDir, "sess-1.jsonl"), jsonl([claudeUser("root", "2026-11-01T10:00:00.000Z")]));
    const subFile = path.join(subDir, "agent-abc.jsonl");
    await fs.writeFile(subFile, jsonl([{ ...claudeUser("sub task", "2026-11-01T10:00:02.000Z"), isSidechain: true }]));
    await fs.writeFile(path.join(subDir, "agent-abc.meta.json"), JSON.stringify({ agentType: "general-purpose" }));
    const id = "sess-1:subagent:agent-abc";
    const before = await readClaudeDetail(id, { configDir });
    expect(before).not.toBeNull();

    await fs.appendFile(
      subFile,
      jsonl([claudeAssistant("sub answer", "2026-11-01T10:00:03.000Z", { isSidechain: true })]),
    );
    const followed = await readClaudeDetail(id, { configDir });
    jsonlFollowCache.clear();
    const fresh = await readClaudeDetail(id, { configDir });

    expect(followed).toEqual(fresh);
    expect(followed?.timeline.length).toBeGreaterThan(before?.timeline.length ?? 0);
  });
});

describe("scanClaudeTranscript", () => {
  it("hands back copies, so a later read cannot change an earlier answer", async () => {
    const file = path.join(root, "t.jsonl");
    const spawn = (id: string) => ({
      type: "assistant",
      teamName: id === "t1" ? "red" : "blue",
      message: {
        id: `m-${id}`,
        content: [{ type: "tool_use", id, name: "Task", input: {} }],
        usage: { input_tokens: 1 },
      },
    });
    await fs.writeFile(file, jsonl([spawn("t1")]));
    const first = await scanClaudeTranscript(file, { includeSidechain: false });

    await fs.appendFile(file, jsonl([spawn("t2")]));
    const second = await scanClaudeTranscript(file, { includeSidechain: false });

    expect([...(first?.spawnIds ?? [])]).toEqual(["t1"]);
    expect([...(first?.team.teamNames ?? [])]).toEqual(["red"]);
    expect(first?.usage?.models[0].input).toBe(1);
    expect([...(second?.spawnIds ?? [])]).toEqual(["t1", "t2"]);
    expect([...(second?.team.teamNames ?? [])]).toEqual(["red", "blue"]);
    expect(second?.usage?.models[0].input).toBe(2);
  });

  it("keeps a main-session scan and a sidechain scan of one file apart", async () => {
    const file = path.join(root, "t.jsonl");
    await fs.writeFile(
      file,
      jsonl([
        {
          type: "assistant",
          isSidechain: true,
          message: { content: [{ type: "tool_use", id: "side", name: "Task", input: {} }] },
        },
      ]),
    );
    const main = await scanClaudeTranscript(file, { includeSidechain: false });
    const side = await scanClaudeTranscript(file, { includeSidechain: true });
    expect([...(main?.spawnIds ?? [])]).toEqual([]);
    expect([...(side?.spawnIds ?? [])]).toEqual(["side"]);
  });
});

describe("Codex rollout", () => {
  const sessionId = "019ceab2-21cf-74d1-865a-c17622809999";
  const noSqlite = async (): Promise<SqliteResult> => ({ rows: [], status: "no-sqlite3" });
  const rec = (type: string, payload: Record<string, unknown>) => ({
    timestamp: "2026-11-01T10:00:00.000Z",
    type,
    payload,
  });

  async function writeRollout(content: string): Promise<string> {
    const dir = path.join(root, "codex", "sessions", "2026", "11", "01");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `rollout-2026-11-01T10-00-00-${sessionId}.jsonl`);
    await fs.writeFile(file, content);
    return file;
  }

  it("answers a re-read after an append exactly as a fresh read does, line locators included", async () => {
    const codexDir = path.join(root, "codex");
    // Ends without its LF, as a rollout does while Codex is writing it.
    const file = await writeRollout(
      `${JSON.stringify(rec("event_msg", { type: "user_message", message: "build it" }))}\n\n${JSON.stringify(
        rec("event_msg", { type: "agent_message", message: "working" }),
      )}`,
    );
    await readCodexDetail(sessionId, { codexDir, readSqliteFn: noSqlite });

    await fs.appendFile(file, `\n${jsonl([rec("event_msg", { type: "agent_message", message: "done" })])}`);
    const followed = await readCodexDetail(sessionId, { codexDir, readSqliteFn: noSqlite });
    jsonlFollowCache.clear();
    const fresh = await readCodexDetail(sessionId, { codexDir, readSqliteFn: noSqlite });

    expect(followed).toEqual(fresh);
    const refs = followed?.timeline.flatMap((t) => (t.kind === "message" ? [t.msgRef] : []));
    expect(refs).toEqual(["#1", "#3", "#4"]);
  });

  it("does not read again the lines it already read", async () => {
    const codexDir = path.join(root, "codex");
    const file = await writeRollout(
      jsonl([
        rec("event_msg", { type: "user_message", message: "ORIGINAL ask" }),
        rec("event_msg", { type: "agent_message", message: "a reply long enough to keep the change far from the end" }),
      ]),
    );
    await readCodexDetail(sessionId, { codexDir, readSqliteFn: noSqlite });

    await rewriteInPlace(file, "ORIGINAL", "REWRITTN");
    await fs.appendFile(file, jsonl([rec("event_msg", { type: "agent_message", message: "more" })]));
    const followed = await readCodexDetail(sessionId, { codexDir, readSqliteFn: noSqlite });

    expect(followed?.timeline[0]).toMatchObject({ kind: "message", text: "ORIGINAL ask" });
    expect(followed?.timeline.at(-1)).toMatchObject({ kind: "message", text: "more" });
  });
});
