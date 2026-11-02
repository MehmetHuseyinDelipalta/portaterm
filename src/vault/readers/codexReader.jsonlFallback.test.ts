// src/vault/readers/codexReader.jsonlFallback.test.ts — the Codex JSONL fallbacks
// (no database; or a database that records no parentage) read each rollout's
// first line once per change of the file, sixteen files at a time (perf B6).
// Real files; the line reader is counted.

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SqliteResult } from "../sqlite";
import {
  __forgetCodexRolloutsForTests,
  MAX_REMEMBERED_ROLLOUTS,
  ROLLOUT_READ_CONCURRENCY,
  readCodexDetail,
  readCodexSessions,
} from "./codexReader";

const seen = vi.hoisted(() => ({ lineReads: [] as string[], limits: [] as number[] }));

vi.mock("./jsonlStream", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./jsonlStream")>();
  return {
    ...actual,
    streamJsonlLines: (filePath: string, ...rest: unknown[]) => {
      seen.lineReads.push(filePath);
      return (actual.streamJsonlLines as (...args: unknown[]) => unknown)(filePath, ...rest);
    },
  };
});

vi.mock("../../utils/mapBounded", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/mapBounded")>();
  return {
    mapBounded: (items: unknown[], limit: number, task: (item: unknown, index: number) => Promise<unknown>) => {
      seen.limits.push(limit);
      return actual.mapBounded(items, limit, task);
    },
  };
});

let codexDir: string;
let sessionsDir: string;
let clock = 1_700_000_000;

const noDb = async (): Promise<SqliteResult> => ({ status: "no-db", rows: [] });

/** Write a rollout whose first line is its session_meta, with an mtime no earlier write had. */
async function rollout(
  name: string,
  meta: { id: string; timestamp?: string; cwd?: string; parent?: string } | string,
): Promise<string> {
  const file = path.join(sessionsDir, "2026", "03", `${name}.jsonl`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const first =
    typeof meta === "string"
      ? meta
      : JSON.stringify({
          type: "session_meta",
          ...(meta.timestamp ? { timestamp: meta.timestamp } : {}),
          payload: {
            id: meta.id,
            ...(meta.cwd ? { cwd: meta.cwd } : {}),
            ...(meta.parent ? { source: { subagent: { thread_spawn: { parent_thread_id: meta.parent } } } } : {}),
          },
        });
  await fs.writeFile(file, `${first}\n{"type":"event_msg"}\n`);
  clock += 10;
  await fs.utimes(file, clock, clock);
  return file;
}

const reads = () => seen.lineReads.map((p) => path.basename(p, ".jsonl")).sort();

beforeEach(async () => {
  codexDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "at-codex-jsonl-")));
  sessionsDir = path.join(codexDir, "sessions");
  seen.lineReads.length = 0;
  seen.limits.length = 0;
  __forgetCodexRolloutsForTests();
});

afterEach(async () => {
  await fs.rm(codexDir, { recursive: true, force: true });
  __forgetCodexRolloutsForTests();
});

describe("the no-database listing", () => {
  it("lists root sessions from first lines, reading each line once", async () => {
    await rollout("a", { id: "sess-a", timestamp: "2026-03-14T05:00:00.000Z", cwd: "/w" });
    const bFile = await rollout("b", { id: "sess-b" });
    await rollout("child", { id: "sess-child", parent: "sess-a" });
    const result = await readCodexSessions({ codexDir, readSqliteFn: noDb });
    expect(result.entries).toEqual([
      expect.objectContaining({
        id: "codex:sess-a",
        sessionId: "sess-a",
        cwd: "/w",
        modified: Date.parse("2026-03-14T05:00:00.000Z"),
        agent: "codex",
        title: "",
        flags: {},
      }),
      expect.objectContaining({ sessionId: "sess-b", cwd: "", modified: clock * 1000 - 10_000 }),
    ]);
    expect(result.entries[1].sessionPath).toBe(bFile);
    expect(result.unreadable).toBe(0);
    expect(reads()).toEqual(["a", "b", "child"]);
    expect(seen.limits).toEqual([16]);
  });

  it("opens no rollout again while none changed", async () => {
    await rollout("a", { id: "sess-a" });
    await rollout("child", { id: "sess-child", parent: "sess-a" });
    const first = await readCodexSessions({ codexDir, readSqliteFn: noDb });
    seen.lineReads.length = 0;
    const second = await readCodexSessions({ codexDir, readSqliteFn: noDb }, first.cache);
    expect(second.entries.map((e) => e.sessionId)).toEqual(["sess-a"]);
    expect(reads()).toEqual([]);
  });

  it.each([
    ["its size", async (file: string) => fs.appendFile(file, "x".repeat(3))],
    [
      "its mtime",
      async (file: string) => {
        clock += 10;
        await fs.utimes(file, clock, clock);
      },
    ],
  ])("reads a rollout again once %s changed", async (_label, change) => {
    const file = await rollout("a", { id: "sess-a" });
    const { mtime } = await fs.stat(file);
    await readCodexSessions({ codexDir, readSqliteFn: noDb });
    seen.lineReads.length = 0;
    await change(file);
    if (_label === "its size") {
      await fs.utimes(file, mtime, mtime);
    }
    await readCodexSessions({ codexDir, readSqliteFn: noDb });
    expect(reads()).toEqual(["a"]);
  });

  it("counts a blank first line as unreadable, and remembers it", async () => {
    await rollout("blank", "");
    expect((await readCodexSessions({ codexDir, readSqliteFn: noDb })).unreadable).toBe(1);
    seen.lineReads.length = 0;
    expect((await readCodexSessions({ codexDir, readSqliteFn: noDb })).unreadable).toBe(1);
    expect(reads()).toEqual([]);
  });

  it("counts a first line that is not JSON as unreadable, and tries it again", async () => {
    await rollout("broken", "{not json");
    expect((await readCodexSessions({ codexDir, readSqliteFn: noDb })).unreadable).toBe(1);
    seen.lineReads.length = 0;
    expect((await readCodexSessions({ codexDir, readSqliteFn: noDb })).unreadable).toBe(1);
    expect(reads()).toEqual(["broken"]);
  });

  it("re-reads exactly the rollouts it had to forget past its bound", async () => {
    __forgetCodexRolloutsForTests(2);
    for (const name of ["a", "b", "c"]) {
      await rollout(name, { id: `sess-${name}` });
    }
    await readCodexSessions({ codexDir, readSqliteFn: noDb }); // three read, one forgotten
    seen.lineReads.length = 0;
    await readCodexSessions({ codexDir, readSqliteFn: noDb });
    expect(reads().length).toBeGreaterThanOrEqual(1); // what was forgotten is read again
    __forgetCodexRolloutsForTests(3);
    await readCodexSessions({ codexDir, readSqliteFn: noDb });
    seen.lineReads.length = 0;
    await readCodexSessions({ codexDir, readSqliteFn: noDb });
    expect(reads()).toEqual([]); // within the bound, nothing is
  });

  it("forgets the least recently used rollout, a re-found one counting as used", async () => {
    __forgetCodexRolloutsForTests(2);
    const files = Object.fromEntries(
      await Promise.all(["a", "b", "c"].map(async (n) => [n, await rollout(n, { id: `sess-${n}` })] as const)),
    );
    // One child per detail read, so the reads come in a known order.
    const detailOf = (name: string) =>
      readCodexDetail("sess-parent", {
        codexDir,
        readSqliteFn: async (_db, sql) =>
          sql.startsWith("SELECT child_thread_id")
            ? { status: "ok", rows: [{ child_thread_id: `sess-${name}` }] }
            : sql.includes("WHERE archived = 0")
              ? { status: "ok", rows: [{ id: `sess-${name}`, rollout_path: files[name], updated_at_ms: 1 }] }
              : { status: "ok", rows: [] },
      });
    await detailOf("a");
    await detailOf("b");
    await detailOf("a"); // a found again: b is now the least recently used
    await detailOf("c"); // drops b
    seen.lineReads.length = 0;
    await detailOf("a");
    expect(reads()).toEqual([]);
    await detailOf("b");
    expect(reads()).toEqual(["b"]);
  });

  it("reads sixteen rollouts at a time, and remembers twenty thousand", () => {
    expect(ROLLOUT_READ_CONCURRENCY).toBe(16);
    expect(MAX_REMEMBERED_ROLLOUTS).toBe(20_000);
  });
});

describe("the rollout parentage fallback", () => {
  /** A database whose threads carry no source column and which has no spawn-edge table. */
  const noParentage = async (_db: string, sql: string): Promise<SqliteResult> =>
    sql.includes(", source") || sql.includes("thread_spawn_edges")
      ? { status: "query-error", rows: [] }
      : {
          status: "ok",
          rows: [
            { id: "sess-a", updated_at_ms: 1 },
            { id: "sess-child", updated_at_ms: 2 },
          ],
        };

  it("hides the children it finds in rollouts, reading each line once per change", async () => {
    await fs.mkdir(codexDir, { recursive: true });
    await fs.writeFile(path.join(codexDir, "state_5.sqlite"), "");
    await rollout("a", { id: "sess-a" });
    await rollout("child", { id: "sess-child", parent: "sess-a" });
    const first = await readCodexSessions({ codexDir, readSqliteFn: noParentage });
    expect(first.entries.map((e) => e.sessionId)).toEqual(["sess-a"]);
    expect(reads()).toEqual(["a", "child"]);
    expect(seen.limits).toEqual([16]);
    seen.lineReads.length = 0;
    await readCodexSessions({ codexDir, readSqliteFn: noParentage });
    expect(reads()).toEqual([]);
  });

  it("skips a rollout it cannot read", async () => {
    await fs.mkdir(codexDir, { recursive: true });
    await fs.writeFile(path.join(codexDir, "state_5.sqlite"), "");
    await rollout("broken", "{not json");
    await rollout("child", { id: "sess-child", parent: "sess-a" });
    const result = await readCodexSessions({ codexDir, readSqliteFn: noParentage });
    expect(result.entries.map((e) => e.sessionId)).toEqual(["sess-a"]);
  });
});

describe("a detail's subagent rollouts", () => {
  it("reads a child's first line once while it is unchanged", async () => {
    const child = await rollout("child", { id: "sess-child", timestamp: "2026-03-14T04:57:00.000Z" });
    const readSqliteFn = async (_db: string, sql: string): Promise<SqliteResult> =>
      sql.startsWith("SELECT child_thread_id")
        ? { status: "ok", rows: [{ child_thread_id: "sess-child" }] }
        : sql.includes("WHERE archived = 0")
          ? { status: "ok", rows: [{ id: "sess-child", rollout_path: child, updated_at_ms: 1 }] }
          : { status: "ok", rows: [{ rollout_path: null, first_user_message: "parent" }] };
    const first = await readCodexDetail("sess-parent", { codexDir, readSqliteFn });
    const second = await readCodexDetail("sess-parent", { codexDir, readSqliteFn });
    const stamp = (d: typeof first) =>
      d?.timeline.find((item) => item.kind === "subagentSession")?.timestamp as number | undefined;
    expect(stamp(first)).toBe(Date.parse("2026-03-14T04:57:00.000Z"));
    expect(stamp(second)).toBe(Date.parse("2026-03-14T04:57:00.000Z"));
    expect(seen.lineReads.filter((p) => p === child)).toHaveLength(1);
  });

  it("reads a child found by its file name once while it is unchanged", async () => {
    // No rollout_path in the index: the rollout is found by its `-<id>.jsonl` name.
    const child = await rollout("rollout-2026-03-14-sess-child", { id: "sess-child" });
    const readSqliteFn = async (_db: string, sql: string): Promise<SqliteResult> =>
      sql.startsWith("SELECT child_thread_id")
        ? { status: "ok", rows: [{ child_thread_id: "sess-child" }] }
        : sql.includes("WHERE archived = 0")
          ? { status: "ok", rows: [{ id: "sess-child", updated_at_ms: 1 }] }
          : { status: "ok", rows: [{ rollout_path: null, first_user_message: "parent" }] };
    await readCodexDetail("sess-parent", { codexDir, readSqliteFn });
    await readCodexDetail("sess-parent", { codexDir, readSqliteFn });
    expect(seen.lineReads.filter((p) => p === child)).toHaveLength(1);
  });
});
