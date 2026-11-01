// src/vault/readers/codexReader.detailSnapshot.test.ts — A Codex session's detail
// reads its index rows from ONE snapshot of a real SQLite store, and asks only
// for the session's own children (perf B4). The store is real (node:sqlite), so
// the filtered SQL is exercised as written.

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type SqliteResult, type SqliteSnapshot, withSqliteSnapshot } from "../sqlite";
import { readCodexDetail, readCodexMessageRecord } from "./codexReader";

const seen = vi.hoisted(() => ({ limits: [] as number[] }));
vi.mock("../../utils/mapBounded", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/mapBounded")>();
  return {
    mapBounded: (items: unknown[], limit: number, task: (item: unknown, index: number) => Promise<unknown>) => {
      seen.limits.push(limit);
      return actual.mapBounded(items, limit, task);
    },
  };
});

const PARENT = "parent-0001";

let codexDir: string;
let dbPath: string;

/** Columns a current Codex has; tests drop some to play an older schema. */
const FULL_COLUMNS = [
  "id TEXT PRIMARY KEY",
  "rollout_path TEXT",
  "cwd TEXT",
  "title TEXT",
  "model TEXT",
  "git_branch TEXT",
  "approval_mode TEXT",
  "sandbox_policy TEXT",
  "reasoning_effort TEXT",
  "first_user_message TEXT",
  "updated_at_ms INTEGER",
  "archived INTEGER DEFAULT 0",
  "source TEXT",
  "created_at_ms INTEGER",
];

interface ThreadRow {
  id: string;
  title?: string;
  first_user_message?: string;
  updated_at_ms?: number;
  archived?: number;
  source?: string;
  created_at_ms?: number;
}

function createStore(options: { without?: string[]; edges?: boolean } = {}): DatabaseSync {
  const columns = FULL_COLUMNS.filter((c) => !options.without?.includes(c.split(" ")[0]));
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE threads (${columns.join(", ")})`);
  if (options.edges !== false) {
    db.exec("CREATE TABLE thread_spawn_edges (parent_thread_id TEXT, child_thread_id TEXT, status TEXT)");
  }
  return db;
}

function insertThread(db: DatabaseSync, row: ThreadRow): void {
  const names = Object.keys(row);
  db.prepare(`INSERT INTO threads (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`).run(
    ...names.map((n) => row[n as keyof ThreadRow] ?? null),
  );
}

const spawnedBy = (parent: string, prompt = "go") =>
  JSON.stringify({ subagent: { thread_spawn: { parent_thread_id: parent, prompt } }, agent_nickname: "helper" });

/** The real snapshot, counted, with every query and the ids it returned recorded. */
function countedSnapshots() {
  const queries: Array<{ sql: string; ids: string[] }> = [];
  const fn = vi.fn(<T>(db: string, callback: (snapshot: SqliteSnapshot) => Promise<T>) =>
    withSqliteSnapshot(db, (snapshot) =>
      callback({
        query: async (sql) => {
          const result = await snapshot.query(sql);
          queries.push({ sql, ids: result.rows.map((r) => String(r.id ?? r.child_thread_id)) });
          return result;
        },
      }),
    ),
  );
  return { fn: fn as unknown as typeof withSqliteSnapshot, calls: fn, queries };
}

const childrenOf = async (options: Parameters<typeof readCodexDetail>[1]) =>
  ((await readCodexDetail(PARENT, options))?.timeline ?? [])
    .filter((item) => item.kind === "subagentSession")
    .map((item) => (item.kind === "subagentSession" ? item.entryId : ""));

beforeEach(async () => {
  codexDir = await fs.mkdtemp(path.join(os.tmpdir(), "at-codex-snapshot-"));
  dbPath = path.join(codexDir, "state_5.sqlite");
  seen.limits.length = 0;
});

afterEach(async () => {
  await fs.rm(codexDir, { recursive: true, force: true });
});

describe("readCodexDetail against one snapshot of a real store", () => {
  it("takes one snapshot for the whole read and runs every query on it", async () => {
    const db = createStore();
    insertThread(db, { id: PARENT, first_user_message: "parent prompt", updated_at_ms: 1 });
    db.close();
    const snapshots = countedSnapshots();
    const readSqliteFn = vi.fn();
    const detail = await readCodexDetail(PARENT, { codexDir, withSqliteSnapshotFn: snapshots.fn, readSqliteFn });
    expect(detail?.firstPrompt).toBe("parent prompt");
    expect(snapshots.calls).toHaveBeenCalledOnce();
    expect(snapshots.calls.mock.calls[0][0]).toBe(dbPath);
    expect(snapshots.queries.length).toBeGreaterThanOrEqual(3);
    expect(readSqliteFn).not.toHaveBeenCalled();
  });

  it("finds children by spawn edge and by source, and fetches no other thread", async () => {
    const db = createStore();
    insertThread(db, { id: PARENT, first_user_message: "parent prompt", updated_at_ms: 1 });
    insertThread(db, { id: "edge-child", title: "By edge", updated_at_ms: 10, created_at_ms: 10 });
    insertThread(db, { id: "source-child", title: "By source", source: spawnedBy(PARENT), created_at_ms: 20 });
    insertThread(db, { id: "mentions-only", title: "Mentions", source: spawnedBy("other-9", `see ${PARENT}`) });
    insertThread(db, { id: "archived-child", source: spawnedBy(PARENT), archived: 1 });
    insertThread(db, { id: "stranger", title: "Unrelated", source: spawnedBy("other-9"), updated_at_ms: 99 });
    insertThread(db, { id: "other-edge-child", title: "Another parent's", updated_at_ms: 98 });
    db.prepare("INSERT INTO thread_spawn_edges VALUES (?, ?, 'done')").run(PARENT, "edge-child");
    db.prepare("INSERT INTO thread_spawn_edges VALUES (?, ?, 'done')").run("other-9", "other-edge-child");
    db.close();
    const snapshots = countedSnapshots();

    expect(await childrenOf({ codexDir, withSqliteSnapshotFn: snapshots.fn })).toEqual([
      "codex:edge-child",
      "codex:source-child",
    ]);
    const fetched = snapshots.queries.flatMap((q) => q.ids);
    expect(fetched).not.toContain("stranger");
    expect(fetched).not.toContain("other-edge-child");
    expect(fetched).not.toContain("archived-child");
  });

  it("names a child's agent and spawn prompt from its source", async () => {
    const db = createStore();
    insertThread(db, { id: PARENT, first_user_message: "p", updated_at_ms: 1 });
    insertThread(db, { id: "source-child", source: spawnedBy(PARENT, "write the tests"), created_at_ms: 5 });
    db.close();
    const detail = await readCodexDetail(PARENT, { codexDir, withSqliteSnapshotFn: countedSnapshots().fn });
    expect(detail?.timeline).toContainEqual(
      expect.objectContaining({ kind: "subagentSession", agent: "helper", title: "write the tests", timestamp: 5 }),
    );
  });

  it("falls back when the store has no created_at_ms", async () => {
    const db = createStore({ without: ["created_at_ms"] });
    insertThread(db, { id: PARENT, first_user_message: "p", updated_at_ms: 1 });
    insertThread(db, { id: "source-child", source: spawnedBy(PARENT), updated_at_ms: 7 });
    insertThread(db, { id: "edge-child", updated_at_ms: 8 });
    db.prepare("INSERT INTO thread_spawn_edges VALUES (?, ?, 'done')").run(PARENT, "edge-child");
    db.close();
    expect(await childrenOf({ codexDir, withSqliteSnapshotFn: countedSnapshots().fn })).toEqual([
      "codex:source-child",
      "codex:edge-child",
    ]);
  });

  /** A rollout naming the parent — what only the rollout-file fallback would find. */
  async function rolloutChild(id: string): Promise<void> {
    const dir = path.join(codexDir, "sessions", "2026", "03", "14");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, `rollout-${id}.jsonl`),
      `${JSON.stringify({
        type: "session_meta",
        timestamp: "2026-03-14T04:57:00.000Z",
        payload: { id, source: { subagent: { thread_spawn: { parent_thread_id: PARENT } } } },
      })}\n`,
    );
  }

  it("finds children by edge alone when the store has no source column", async () => {
    await rolloutChild("rollout-only"); // the store records parentage: no file scan
    const db = createStore({ without: ["source", "created_at_ms"] });
    insertThread(db, { id: PARENT, first_user_message: "p", updated_at_ms: 1 });
    insertThread(db, { id: "edge-child", updated_at_ms: 8 });
    insertThread(db, { id: "stranger", updated_at_ms: 9 });
    db.prepare("INSERT INTO thread_spawn_edges VALUES (?, ?, 'done')").run(PARENT, "edge-child");
    db.close();
    const snapshots = countedSnapshots();
    expect(await childrenOf({ codexDir, withSqliteSnapshotFn: snapshots.fn })).toEqual(["codex:edge-child"]);
    expect(snapshots.queries.flatMap((q) => q.ids)).not.toContain("stranger");
  });

  it("finds children by source alone when the store has no spawn-edge table", async () => {
    await rolloutChild("rollout-only"); // the store records parentage: no file scan
    const db = createStore({ edges: false });
    insertThread(db, { id: PARENT, first_user_message: "p", updated_at_ms: 1 });
    insertThread(db, { id: "source-child", source: spawnedBy(PARENT), created_at_ms: 3 });
    db.close();
    expect(await childrenOf({ codexDir, withSqliteSnapshotFn: countedSnapshots().fn })).toEqual(["codex:source-child"]);
  });

  it("looks in the rollout files when the store records no parentage at all", async () => {
    const db = createStore({ without: ["source", "created_at_ms"], edges: false });
    insertThread(db, { id: PARENT, first_user_message: "p", updated_at_ms: 1 });
    db.close();
    await rolloutChild("jsonl-child");
    const snapshots = countedSnapshots();
    expect(await childrenOf({ codexDir, withSqliteSnapshotFn: snapshots.fn })).toEqual(["codex:jsonl-child"]);
    // With nothing to match children by, the row query asks for none.
    const rowQueries = snapshots.queries.filter((q) => q.sql.includes("WHERE archived = 0"));
    expect(rowQueries.length).toBeGreaterThan(0);
    expect(rowQueries.flatMap((q) => q.ids)).toEqual([]);
  });

  it("looks in the rollout files when the store cannot be opened, but not after a failed query", async () => {
    const dir = path.join(codexDir, "sessions", "2026", "03", "14");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "rollout-jsonl-child.jsonl"),
      `${JSON.stringify({
        type: "session_meta",
        timestamp: "2026-03-14T04:57:00.000Z",
        payload: { id: "jsonl-child", source: { subagent: { thread_spawn: { parent_thread_id: PARENT } } } },
      })}\n`,
    );
    const failing =
      (status: "db-unreachable" | "query-error"): typeof withSqliteSnapshot =>
      async () => ({ status });
    expect(await childrenOf({ codexDir, withSqliteSnapshotFn: failing("db-unreachable") })).toEqual([
      "codex:jsonl-child",
    ]);
    expect(await childrenOf({ codexDir, withSqliteSnapshotFn: failing("query-error") })).toEqual([]);
  });

  it("bounds a parent's children to the row limit", async () => {
    const db = createStore();
    insertThread(db, { id: PARENT, first_user_message: "p", updated_at_ms: 1 });
    db.exec("BEGIN");
    for (let i = 0; i < 501; i++) {
      const id = `kid-${String(i).padStart(4, "0")}`;
      insertThread(db, { id, updated_at_ms: i, created_at_ms: i });
      db.prepare("INSERT INTO thread_spawn_edges VALUES (?, ?, 'done')").run(PARENT, id);
    }
    db.exec("COMMIT");
    db.close();
    const snapshots = countedSnapshots();
    const children = await childrenOf({ codexDir, withSqliteSnapshotFn: snapshots.fn });
    expect(children).toHaveLength(500);
    expect(children).not.toContain("codex:kid-0000"); // the least recently updated
    const threadRowQueries = snapshots.queries.filter((q) => q.sql.includes("WHERE archived = 0"));
    expect(threadRowQueries.map((q) => q.ids.length)).toEqual([500]);
    // The edge query is only ids, all of them: a limit there could keep another subset.
    expect(snapshots.queries.find((q) => q.sql.startsWith("SELECT child_thread_id"))?.ids).toHaveLength(501);
  });

  it("reads children's rollout files eight at a time", async () => {
    const db = createStore();
    insertThread(db, { id: PARENT, first_user_message: "p", updated_at_ms: 1 });
    insertThread(db, { id: "edge-child", updated_at_ms: 8 });
    db.prepare("INSERT INTO thread_spawn_edges VALUES (?, ?, 'done')").run(PARENT, "edge-child");
    db.close();
    await readCodexDetail(PARENT, { codexDir, withSqliteSnapshotFn: countedSnapshots().fn });
    expect(seen.limits).toEqual([8]);
  });

  it("keeps the index-only partial when queries run through an injected readSqliteFn", async () => {
    const readSqliteFn = vi.fn(
      async (_db: string, sql: string): Promise<SqliteResult> =>
        sql.includes(`WHERE id = '${PARENT}'`)
          ? { status: "ok", rows: [{ rollout_path: null, first_user_message: "from the fake" }] }
          : { status: "ok", rows: [] },
    );
    const detail = await readCodexDetail(PARENT, { codexDir, readSqliteFn });
    expect(detail?.firstPrompt).toBe("from the fake");
    expect(readSqliteFn.mock.calls.every(([db]) => db === dbPath)).toBe(true);
  });

  it("finds a message's rollout through the index of the store it was asked about", async () => {
    const dir = path.join(codexDir, "sessions", "2026");
    await fs.mkdir(dir, { recursive: true });
    const rollout = path.join(dir, "named-unlike-its-id.jsonl");
    await fs.writeFile(
      rollout,
      `${JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "hi" } })}\n`,
    );
    const readSqliteFn = vi.fn(
      async (db: string): Promise<SqliteResult> =>
        db === dbPath ? { status: "ok", rows: [{ rollout_path: rollout }] } : { status: "no-db", rows: [] },
    );
    const record = await readCodexMessageRecord(PARENT, "#1", { codexDir, readSqliteFn });
    expect(record.ok).toBe(true);
  });
});
