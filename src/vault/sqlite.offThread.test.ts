// src/vault/sqlite.offThread.test.ts — `node:sqlite` queries run off the
// extension host's thread.
//
// `DatabaseSync` is synchronous. Run in process, a query over a large store
// (OpenCode's passes 1 GB, and its session list uses correlated subqueries and
// a LIKE scan) froze the whole extension host for its duration: every PTY's
// output relay, every webview message. These run the real engine on real files.

import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __queryWorkersUnavailable,
  __resetQueryWorkerCache,
  readSqlite,
  runNodeQueryOffThread,
  type SqliteDeps,
} from "./sqlite";

const dirs: string[] = [];
afterEach(async () => {
  __resetQueryWorkerCache();
  await Promise.all(dirs.splice(0).map((d) => fsp.rm(d, { recursive: true, force: true })));
});

async function fixture(seed: (db: InstanceType<typeof DatabaseSync>) => void): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "at-vault-offthread-"));
  dirs.push(dir);
  const file = path.join(dir, "store.sqlite");
  const db = new DatabaseSync(file);
  seed(db);
  db.close();
  return file;
}

/** A query that keeps SQLite busy for a while without needing a large file. */
const SLOW =
  "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 3000000) SELECT count(*) AS n FROM c";

describe("runNodeQueryOffThread", () => {
  it("returns the rows the in-process engine would, normalised the same way", async () => {
    const file = await fixture((db) => {
      db.exec("CREATE TABLE t(id TEXT, big INTEGER, data BLOB)");
      db.prepare("INSERT INTO t VALUES (?, ?, ?)").run("a", 1_700_000_000_000n, new Uint8Array([1, 2, 3]));
    });

    const result = await runNodeQueryOffThread(file, "SELECT id, big, data FROM t");

    expect(result.status).toBe("ok");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].id).toBe("a");
    expect(result.rows[0].big).toBe(1_700_000_000_000); // bigint → number, as before
    expect(Array.from(result.rows[0].data as Uint8Array)).toEqual([1, 2, 3]);
  });

  it("keeps the calling thread's event loop running while the query does", async () => {
    const file = await fixture(() => {});
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
    }, 5);
    const started = Date.now();
    try {
      const result = await runNodeQueryOffThread(file, SLOW);
      expect(result).toMatchObject({ status: "ok", rows: [{ n: 3_000_000 }] });
    } finally {
      clearInterval(timer);
    }
    const elapsed = Date.now() - started;
    // In process, the loop gets no turn at all until the query returns.
    expect(elapsed).toBeGreaterThan(50);
    expect(ticks).toBeGreaterThan(elapsed / 5 / 4);
  });

  it("reports a failing statement as query-error, never as rows", async () => {
    const file = await fixture((db) => db.exec("CREATE TABLE t(id TEXT)"));
    const result = await runNodeQueryOffThread(file, "SELECT nope FROM missing");
    expect(result.status).toBe("query-error");
    expect(result.rows).toEqual([]);
    expect(result.error).toMatch(/no such table/);
  });

  it("gives up on a query past its deadline and reports it", async () => {
    const file = await fixture(() => {});
    const started = Date.now();
    const result = await runNodeQueryOffThread(file, SLOW, { timeoutMs: 20 });
    expect(result.status).toBe("query-error");
    expect(result.error).toMatch(/20ms/);
    // Answered at the deadline, not when the query would have finished.
    expect(Date.now() - started).toBeLessThan(250);
  });

  it("runs in process when a worker cannot be started, rather than failing the read", async () => {
    const file = await fixture((db) => {
      db.exec("CREATE TABLE t(id TEXT)");
      db.exec("INSERT INTO t VALUES ('x')");
    });
    const result = await runNodeQueryOffThread(file, "SELECT id FROM t", {
      createWorker: () => {
        throw new Error("worker_threads unavailable");
      },
    });
    expect(result).toEqual({ status: "ok", rows: [{ id: "x" }] });
  });

  it("fails only the query when a started worker dies, and keeps using workers", async () => {
    // A query that runs the worker out of memory must not move every later read
    // back onto the extension host's thread.
    const file = await fixture((db) => db.exec("CREATE TABLE t(id TEXT)"));
    const dying = () => new Worker("setTimeout(() => { throw new Error('worker died') }, 20)", { eval: true });

    const result = await runNodeQueryOffThread(file, "SELECT id FROM t", { createWorker: dying });

    expect(result.status).toBe("query-error");
    expect(result.error).toMatch(/worker died/);
    expect(__queryWorkersUnavailable()).toBe(false);
  });

  it("reads in process when the engine does not load in a worker, and stops starting them", async () => {
    const file = await fixture((db) => {
      db.exec("CREATE TABLE t(id TEXT)");
      db.exec("INSERT INTO t VALUES ('y')");
    });
    let started = 0;
    const noEngine = () => {
      started += 1;
      return new Worker(
        "require('node:worker_threads').parentPort.postMessage({ ok: false, unavailable: true, error: 'no sqlite' })",
        { eval: true },
      );
    };

    expect(await runNodeQueryOffThread(file, "SELECT id FROM t", { createWorker: noEngine })).toEqual({
      status: "ok",
      rows: [{ id: "y" }],
    });
    expect(__queryWorkersUnavailable()).toBe(true);
    await runNodeQueryOffThread(file, "SELECT id FROM t", { createWorker: noEngine });
    expect(started).toBe(1);
  });

  it("answers every one of several concurrent queries on one WAL-mode snapshot", async () => {
    // A detail read fans its queries out at once. Without a busy timeout, the
    // first worker's WAL setup made the others fail "database is locked".
    for (let round = 0; round < 8; round++) {
      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "at-vault-wal-"));
      dirs.push(dir);
      const live = new DatabaseSync(path.join(dir, "live.db"));
      live.exec("PRAGMA journal_mode = WAL; CREATE TABLE t(x); INSERT INTO t VALUES (1)");
      const snapshot = path.join(dir, "snapshot.db");
      await backup(live, snapshot);
      live.close();

      const results = await Promise.all(
        Array.from({ length: 8 }, () => runNodeQueryOffThread(snapshot, "SELECT count(*) AS n FROM t")),
      );
      expect(results.map((r) => r.status)).toEqual(Array(8).fill("ok"));
    }
  });

  it("has no deadline unless one is asked for — it cannot stop the statement anyway", async () => {
    const file = await fixture(() => {});
    // Only the deadline's clock is faked; the worker and its messages are real.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const pending = runNodeQueryOffThread(file, SLOW);
      vi.advanceTimersByTime(10 * 60 * 1000); // far past any default a deadline could have
      expect(await pending).toMatchObject({ status: "ok" });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("readSqlite, as shipped, keeps the extension host responsive", () => {
  it("runs the default node:sqlite query off the calling thread", async () => {
    const file = await fixture(() => {});
    const deps: SqliteDeps = {
      exec: async () => {
        throw Object.assign(new Error("not found"), { code: "ENOENT" });
      },
      exists: async () => true,
      mkdtemp: () => fsp.mkdtemp(path.join(os.tmpdir(), "at-vault-")),
      rmrf: (d) => fsp.rm(d, { recursive: true, force: true }),
      hasNodeSqlite: async () => true,
      // no runNodeQuery: the default engine
    };
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
    }, 5);
    let result: Awaited<ReturnType<typeof readSqlite>>;
    const started = Date.now();
    try {
      result = await readSqlite(file, SLOW, deps);
    } finally {
      clearInterval(timer);
    }
    expect(result).toMatchObject({ status: "ok", rows: [{ n: 3_000_000 }] });
    expect(ticks).toBeGreaterThan((Date.now() - started) / 5 / 4);
  });
});
