import { describe, expect, it, vi } from "vitest";
import {
  normalizeVaultTag,
  normalizeVaultTags,
  VAULT_TAG_MAX_LENGTH,
  VAULT_TAGS_PER_SESSION,
  VaultMarksRegistry,
  type VaultMarksStorage,
} from "./VaultMarksRegistry";

function fakeStorage(initial?: Record<string, unknown>): {
  storage: VaultMarksStorage;
  written: () => unknown;
  writes: () => number;
} {
  const store = new Map<string, unknown>(Object.entries(initial ?? {}));
  let writes = 0;
  return {
    storage: {
      get: (k) => store.get(k),
      update: (k, v) => {
        writes++;
        store.set(k, v);
        return Promise.resolve();
      },
    },
    written: () => store.get("portaterm.vaultMarks"),
    writes: () => writes,
  };
}

describe("normalizeVaultTag", () => {
  it("trims, drops leading #s, and joins inner whitespace with a dash", () => {
    expect(normalizeVaultTag("  ##bug fix  ")).toBe("bug-fix");
    expect(normalizeVaultTag("a \t b")).toBe("a-b");
  });

  it("is null when nothing is left", () => {
    expect(normalizeVaultTag("")).toBeNull();
    expect(normalizeVaultTag("  # ")).toBeNull();
  });

  it("caps an over-length tag", () => {
    expect(normalizeVaultTag("x".repeat(100))).toHaveLength(VAULT_TAG_MAX_LENGTH);
  });
});

describe("normalizeVaultTags", () => {
  it("drops empties and case-insensitive duplicates, keeping the first spelling and the order", () => {
    expect(normalizeVaultTags(["Frontend", " ", "api", "frontend", "#API", "db"])).toEqual(["Frontend", "api", "db"]);
  });

  it("keeps at most the per-session cap", () => {
    const many = Array.from({ length: 30 }, (_, i) => `t${i}`);
    expect(normalizeVaultTags(many)).toHaveLength(VAULT_TAGS_PER_SESSION);
  });
});

describe("VaultMarksRegistry", () => {
  it("stars and unstars an entry", () => {
    const reg = new VaultMarksRegistry(fakeStorage().storage);
    reg.setStarred("claude:a", true);
    expect(reg.get("claude:a")).toEqual({ starred: true });
    reg.setStarred("claude:a", false);
    expect(reg.get("claude:a")).toBeUndefined();
  });

  it("sets tags normalized, and an empty list clears them", () => {
    const reg = new VaultMarksRegistry(fakeStorage().storage);
    reg.setTags("claude:a", ["#review", "review", " wip "]);
    expect(reg.get("claude:a")).toEqual({ tags: ["review", "wip"] });
    reg.setTags("claude:a", []);
    expect(reg.get("claude:a")).toBeUndefined();
  });

  it("keeps a star and tags independently on one entry", () => {
    const reg = new VaultMarksRegistry(fakeStorage().storage);
    reg.setStarred("claude:a", true);
    reg.setTags("claude:a", ["x"]);
    reg.setStarred("claude:a", false);
    expect(reg.get("claude:a")).toEqual({ tags: ["x"] });
    reg.setStarred("claude:a", true);
    reg.setTags("claude:a", []);
    expect(reg.get("claude:a")).toEqual({ starred: true });
  });

  it("hands out copies, so a caller cannot edit the stored tags", () => {
    const reg = new VaultMarksRegistry(fakeStorage().storage);
    reg.setTags("claude:a", ["x"]);
    reg.get("claude:a")?.tags?.push("y");
    expect(reg.get("claude:a")).toEqual({ tags: ["x"] });
  });

  it("persists a snapshot and rehydrates from it", () => {
    const backing = fakeStorage();
    const reg = new VaultMarksRegistry(backing.storage);
    reg.setStarred("codex:1", true);
    reg.setTags("claude:2", ["infra"]);
    expect(backing.written()).toEqual({ "codex:1": { starred: true }, "claude:2": { tags: ["infra"] } });

    const again = new VaultMarksRegistry(backing.storage);
    expect(again.get("codex:1")).toEqual({ starred: true });
    expect(again.get("claude:2")).toEqual({ tags: ["infra"] });
  });

  it("drops malformed stored records instead of failing to load", () => {
    const { storage } = fakeStorage({
      "portaterm.vaultMarks": {
        "claude:ok": { starred: true, tags: ["a", 3, "A", ""] },
        "claude:arr": ["x"],
        "claude:null": null,
        "claude:str": "starred",
        "claude:empty": { starred: false, tags: [] },
      },
    });
    const reg = new VaultMarksRegistry(storage);
    expect(reg.all()).toEqual({ "claude:ok": { starred: true, tags: ["a"] } });
  });

  it("starts empty on a non-object stored value", () => {
    for (const raw of [undefined, null, "x", 5, ["a"]]) {
      const reg = new VaultMarksRegistry(fakeStorage({ "portaterm.vaultMarks": raw }).storage);
      expect(reg.all()).toEqual({});
    }
  });

  it("neither persists nor notifies when nothing changed", () => {
    const backing = fakeStorage();
    const reg = new VaultMarksRegistry(backing.storage);
    const listener = vi.fn();
    reg.onDidChange(listener);
    reg.setStarred("claude:a", false);
    reg.setTags("claude:a", ["  "]);
    expect(backing.writes()).toBe(0);
    expect(listener).not.toHaveBeenCalled();

    reg.setTags("claude:a", ["x"]);
    reg.setTags("claude:a", ["#x"]);
    reg.setStarred("claude:a", true);
    reg.setStarred("claude:a", true);
    expect(backing.writes()).toBe(2);
    expect(listener.mock.calls).toEqual([["claude:a"], ["claude:a"]]);
  });

  it("stops notifying a disposed listener, and one failing listener does not stop the next", () => {
    const reg = new VaultMarksRegistry(fakeStorage().storage);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const second = vi.fn();
    const dispose = reg.onDidChange(() => {
      throw new Error("boom");
    });
    reg.onDidChange(second);
    reg.setStarred("claude:a", true);
    expect(second).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalled();
    dispose();
    errors.mockClear();
    reg.setStarred("claude:a", false);
    expect(second).toHaveBeenCalledTimes(2);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("logs, rather than throws, when persisting fails", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const reg = new VaultMarksRegistry({ get: () => undefined, update: () => Promise.reject(new Error("disk")) });
    reg.setStarred("claude:a", true);
    await Promise.resolve();
    await Promise.resolve();
    expect(errors).toHaveBeenCalledWith("[Portaterm] Failed to persist vault marks:", expect.any(Error));
    errors.mockRestore();
  });

  it("lists every tag in use once, case-insensitively, sorted", () => {
    const reg = new VaultMarksRegistry(fakeStorage().storage);
    reg.setTags("claude:a", ["zeta", "Api"]);
    reg.setTags("claude:b", ["api", "beta"]);
    expect(reg.knownTags()).toEqual(["Api", "beta", "zeta"]);
  });
});

describe("VaultMarksRegistry: tab color and icon", () => {
  it("records both as they stand, beside the star, and clears what is left out", () => {
    const fake = fakeStorage();
    const reg = new VaultMarksRegistry(fake.storage);
    const changed = vi.fn();
    reg.onDidChange(changed);
    reg.setStarred("claude:a", true);
    reg.setTabAppearance("claude:a", { tabColor: "red", tabIcon: "rocket" });
    expect(reg.get("claude:a")).toEqual({ starred: true, tabColor: "red", tabIcon: "rocket" });
    expect(fake.written()).toEqual({ "claude:a": { starred: true, tabColor: "red", tabIcon: "rocket" } });

    reg.setTabAppearance("claude:a", { tabIcon: "rocket" });
    expect(reg.get("claude:a")).toEqual({ starred: true, tabIcon: "rocket" });
    expect(changed).toHaveBeenCalledTimes(3);
  });

  it("drops an entry left with nothing, and a no-op change neither persists nor notifies", () => {
    const fake = fakeStorage();
    const reg = new VaultMarksRegistry(fake.storage);
    reg.setTabAppearance("claude:a", { tabColor: "blue" });
    const changed = vi.fn();
    reg.onDidChange(changed);
    const writes = fake.writes();
    reg.setTabAppearance("claude:a", { tabColor: "blue" });
    expect(fake.writes()).toBe(writes);
    expect(changed).not.toHaveBeenCalled();

    reg.setTabAppearance("claude:a", {});
    expect(reg.get("claude:a")).toBeUndefined();
    expect(fake.written()).toEqual({});
  });

  it("loads known ids from an earlier window and drops ids this build does not know", () => {
    const fake = fakeStorage({
      "portaterm.vaultMarks": {
        "claude:a": { tabColor: "green", tabIcon: "bug" },
        "claude:b": { tabColor: "plaid", tabIcon: 7 },
        "claude:c": { starred: true, tabColor: "plaid" },
      },
    });
    const reg = new VaultMarksRegistry(fake.storage);
    expect(reg.get("claude:a")).toEqual({ tabColor: "green", tabIcon: "bug" });
    expect(reg.get("claude:b")).toBeUndefined();
    expect(reg.get("claude:c")).toEqual({ starred: true });
  });
});
