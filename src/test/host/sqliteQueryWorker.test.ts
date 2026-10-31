import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { __queryWorkersUnavailable, __resetQueryWorkerCache, runNodeQueryOffThread } from "../../vault/sqlite";

// The vault's node:sqlite queries run on a worker thread so a large store cannot
// freeze the extension host. Vitest runs that worker under plain Node; only this
// lane can say whether VS Code's own extension host (Electron's Node, at the
// `engines.vscode` floor) starts it — or silently falls back to the in-process
// read the worker exists to replace.
suite("Vault SQLite queries in the extension host", () => {
  test("run on a worker thread, not in process", async () => {
    __resetQueryWorkerCache();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "portaterm-host-sqlite-"));
    try {
      const file = path.join(dir, "store.sqlite");
      const db = new DatabaseSync(file);
      db.exec("CREATE TABLE t(id TEXT, n INTEGER)");
      db.exec("INSERT INTO t VALUES ('a', 1), ('b', 2)");
      db.close();

      const result = await runNodeQueryOffThread(file, "SELECT id, n FROM t ORDER BY id");

      assert.deepStrictEqual(result, {
        status: "ok",
        rows: [
          { id: "a", n: 1 },
          { id: "b", n: 2 },
        ],
      });
      assert.strictEqual(__queryWorkersUnavailable(), false, "the read fell back to the extension host's thread");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
