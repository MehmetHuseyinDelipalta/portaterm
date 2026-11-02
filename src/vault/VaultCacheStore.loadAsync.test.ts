// src/vault/VaultCacheStore.loadAsync.test.ts — the cache read without blocking,
// answering exactly as `load` does (perf B8). Real files in a temp directory.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type * as vscode from "vscode";
import { VAULT_CACHE_VERSION, type VaultListCacheFileV1 } from "./cacheTypes";
import { VaultCacheStore } from "./VaultCacheStore";

let root: string;
let store: VaultCacheStore;
const cacheFile = () => path.join(root, "vault-cache", "list.json");

const doc = (): VaultListCacheFileV1 => ({
  version: VAULT_CACHE_VERSION,
  savedAt: 1,
  agents: {},
  entries: [{ id: "claude:s1", agent: "claude", sessionId: "s1", title: "t", cwd: "/w", modified: 1, flags: {} }],
  unreadable: { count: 0, reasons: [] },
});

function write(content: string): void {
  fs.mkdirSync(path.dirname(cacheFile()), { recursive: true });
  fs.writeFileSync(cacheFile(), content);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "vault-cache-async-"));
  store = new VaultCacheStore({ fsPath: root } as vscode.Uri, fs as never);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("VaultCacheStore.loadAsync", () => {
  it("reads back what save wrote", async () => {
    await store.save(doc());
    expect(await store.loadAsync()).toEqual(doc());
    expect(store.load()).toEqual(doc());
  });

  it.each([
    ["no file", null],
    ["torn JSON", '{"version":'],
    ["another version", JSON.stringify({ ...doc(), version: VAULT_CACHE_VERSION + 1 })],
    ["a malformed entry", JSON.stringify({ ...doc(), entries: [{ id: 7 }] })],
    ["a malformed reader cache", JSON.stringify({ ...doc(), agents: { claude: { kind: "weird" } } })],
    ["no unreadable reasons", JSON.stringify({ ...doc(), unreadable: { count: 0 } })],
    ["JSON null", "null"],
    ["a JSON number", "5"],
  ])("answers a miss for %s, as load does", async (_label, content) => {
    if (content !== null) {
      write(content);
    }
    expect(await store.loadAsync()).toBeNull();
    expect(store.load()).toBeNull();
  });

  it("answers a miss when the path cannot be read as a file", async () => {
    fs.mkdirSync(cacheFile(), { recursive: true });
    expect(await store.loadAsync()).toBeNull();
    expect(store.load()).toBeNull();
  });
});
