// src/vault/VaultService.marks.test.ts — the star/tag overlay is served like the
// custom name: on every served list, never written into the cache.

import { describe, expect, it } from "vitest";
import type { VaultListCacheFileV1 } from "./cacheTypes";
import { VAULT_CACHE_VERSION } from "./cacheTypes";
import type { VaultSessionEntry } from "./types";
import type { VaultCacheStore } from "./VaultCacheStore";
import { VaultCustomNameRegistry } from "./VaultCustomNameRegistry";
import { VaultMarksRegistry } from "./VaultMarksRegistry";
import { VaultService } from "./VaultService";

function entry(id: string): VaultSessionEntry {
  const [agent, sessionId] = id.split(":");
  return { id, agent, sessionId, title: id, cwd: "/x", modified: 1, flags: {} };
}

function docWith(entries: VaultSessionEntry[]): VaultListCacheFileV1 {
  return { version: VAULT_CACHE_VERSION, savedAt: 1, agents: {}, entries, unreadable: { count: 0, reasons: [] } };
}

function memStorage() {
  const store = new Map<string, unknown>();
  return {
    get: (k: string) => store.get(k),
    update: (k: string, v: unknown) => {
      store.set(k, v);
      return Promise.resolve();
    },
  };
}

function service(doc: VaultListCacheFileV1, withNames = false) {
  const cacheStore = { load: () => doc, save: async () => {} } as unknown as VaultCacheStore;
  return new VaultService({
    cacheStore,
    marks: new VaultMarksRegistry(memStorage()),
    ...(withNames ? { customNames: new VaultCustomNameRegistry(memStorage()) } : {}),
  });
}

describe("VaultService star and tag overlay", () => {
  it("overlays starred and tags on listCached() without mutating the cache doc", () => {
    const doc = docWith([entry("claude:a"), entry("codex:b")]);
    const svc = service(doc);
    svc.setStarred("claude:a", true);
    svc.setTags("codex:b", ["infra", "#review"]);

    const listed = svc.listCached()?.entries ?? [];
    expect(listed.find((e) => e.id === "claude:a")).toMatchObject({ starred: true });
    expect(listed.find((e) => e.id === "claude:a")?.tags).toBeUndefined();
    expect(listed.find((e) => e.id === "codex:b")).toMatchObject({ tags: ["infra", "review"] });
    expect(listed.find((e) => e.id === "codex:b")?.starred).toBeUndefined();
    expect(doc.entries.every((e) => e.starred === undefined && e.tags === undefined)).toBe(true);
  });

  it("passes unmarked entries through by reference", () => {
    const doc = docWith([entry("claude:a"), entry("claude:b")]);
    const svc = service(doc);
    svc.setStarred("claude:a", true);
    const listed = svc.listCached()?.entries ?? [];
    expect(listed[1]).toBe(doc.entries[1]);
    expect(listed[0]).not.toBe(doc.entries[0]);
  });

  it("carries a rename and marks on the same entry together", () => {
    const svc = service(docWith([entry("claude:a")]), true);
    svc.setCustomName("claude:a", "Named");
    svc.setStarred("claude:a", true);
    svc.setTags("claude:a", ["x"]);
    expect(svc.listCached()?.entries[0]).toMatchObject({ customName: "Named", starred: true, tags: ["x"] });
  });

  it("overlays a remembered tab color and icon", () => {
    const doc = docWith([entry("claude:a"), entry("claude:b")]);
    const marks = new VaultMarksRegistry(memStorage());
    const cacheStore = { load: () => doc, save: async () => {} } as unknown as VaultCacheStore;
    const svc = new VaultService({ cacheStore, marks });
    marks.setTabAppearance("claude:a", { tabColor: "cyan", tabIcon: "server" });
    marks.setTabAppearance("claude:b", { tabIcon: "bug" });
    const listed = svc.listCached()?.entries ?? [];
    expect(listed[0]).toMatchObject({ tabColor: "cyan", tabIcon: "server" });
    expect(listed[1]?.tabColor).toBeUndefined();
    expect(listed[1]?.tabIcon).toBe("bug");
    expect(doc.entries.every((e) => e.tabColor === undefined && e.tabIcon === undefined)).toBe(true);
  });

  it("drops the overlay once the marks are cleared", () => {
    const svc = service(docWith([entry("claude:a")]));
    svc.setStarred("claude:a", true);
    svc.setTags("claude:a", ["x"]);
    svc.setStarred("claude:a", false);
    svc.setTags("claude:a", []);
    const [a] = svc.listCached()?.entries ?? [];
    expect(a?.starred).toBeUndefined();
    expect(a?.tags).toBeUndefined();
    expect(svc.marksOf("claude:a")).toBeUndefined();
  });

  it("answers marksOf and knownTags from the registry", () => {
    const svc = service(docWith([entry("claude:a")]));
    svc.setTags("claude:a", ["b", "a"]);
    expect(svc.marksOf("claude:a")).toEqual({ tags: ["b", "a"] });
    expect(svc.knownTags()).toEqual(["a", "b"]);
  });

  it("is a no-op without a marks registry", () => {
    const cacheStore = { load: () => docWith([entry("claude:a")]), save: async () => {} } as unknown as VaultCacheStore;
    const svc = new VaultService({ cacheStore });
    svc.setStarred("claude:a", true);
    svc.setTags("claude:a", ["x"]);
    expect(svc.listCached()?.entries[0].starred).toBeUndefined();
    expect(svc.marksOf("claude:a")).toBeUndefined();
    expect(svc.knownTags()).toEqual([]);
  });
});
