// src/webview/vault/grouping.test.ts — Pure grouping (redesign-vault-panel-ui 4_2).

import { describe, expect, it } from "vitest";
import type { VaultSessionEntry } from "../../vault/types";
import { groupEntries } from "./grouping";

function entry(over: Partial<VaultSessionEntry> = {}): VaultSessionEntry {
  return {
    id: "claude:a",
    agent: "claude",
    sessionId: "a",
    title: "t",
    cwd: "/work/repo",
    modified: 1,
    flags: {},
    ...over,
  };
}

describe("groupEntries", () => {
  it("Recent → one flat group ordered by modified desc, cwd chip kept", () => {
    const groups = groupEntries(
      [entry({ id: "a", modified: 10 }), entry({ id: "b", modified: 30 }), entry({ id: "c", modified: 20 })],
      "recent",
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].mode).toBe("recent");
    expect(groups[0].hideCwd).toBe(false);
    expect(groups[0].entries.map((e) => e.id)).toEqual(["b", "c", "a"]);
  });

  it("Agent → one group per agent with display label, accent, and count", () => {
    const groups = groupEntries(
      [
        entry({ id: "c1", agent: "claude", modified: 5 }),
        entry({ id: "x1", agent: "codex", modified: 50 }),
        entry({ id: "c2", agent: "claude", modified: 9 }),
      ],
      "agent",
    );
    // Codex group is first (its newest entry, t=50, beats claude's t=9).
    expect(groups.map((g) => g.key)).toEqual(["codex", "claude"]);
    const claude = groups.find((g) => g.key === "claude");
    expect(claude?.label).toBe("Claude Code");
    expect(claude?.accent).toBe("claude");
    expect(claude?.entries.map((e) => e.id)).toEqual(["c2", "c1"]);
    expect(claude?.hideCwd).toBe(false);
  });

  it("Cursor → uses the registered display label and accent", () => {
    const groups = groupEntries([entry({ id: "cursor:c1", agent: "cursor" })], "agent");
    expect(groups[0]).toMatchObject({ key: "cursor", label: "Cursor Agent", accent: "cursor" });
  });

  it("Folder → group per cwd, leaf label, cwd chip suppressed", () => {
    const groups = groupEntries(
      [
        entry({ id: "a", cwd: "/work/anywhere-terminal", modified: 100 }),
        entry({ id: "b", cwd: "/work/bootstrap-agent", modified: 40 }),
        entry({ id: "c", cwd: "/work/anywhere-terminal", modified: 60 }),
      ],
      "folder",
    );
    expect(groups.map((g) => g.label)).toEqual(["anywhere-terminal", "bootstrap-agent"]);
    expect(groups[0].hideCwd).toBe(true);
    expect(groups[0].entries.map((e) => e.id)).toEqual(["a", "c"]);
  });

  it("returns no groups for an empty list", () => {
    expect(groupEntries([], "agent")).toEqual([]);
    expect(groupEntries([], "recent")).toEqual([
      { mode: "recent", key: "recent", label: "", hideCwd: false, entries: [] },
    ]);
  });

  it("falls back to the raw agent id as label for an unknown agent", () => {
    const groups = groupEntries([entry({ id: "z", agent: "mystery" })], "agent");
    expect(groups[0].label).toBe("mystery");
    expect(groups[0].accent).toBeUndefined();
  });
});

describe("groupEntries with pinned sessions", () => {
  it("Recent → pinned rows lead, each band newest first", () => {
    const groups = groupEntries(
      [
        entry({ id: "old-pin", modified: 1 }),
        entry({ id: "new", modified: 30 }),
        entry({ id: "mid", modified: 20 }),
        entry({ id: "new-pin", modified: 5 }),
      ],
      "recent",
      new Set(["old-pin", "new-pin"]),
    );
    expect(groups[0].entries.map((e) => e.id)).toEqual(["new-pin", "old-pin", "new", "mid"]);
  });

  it("Agent → a pinned row leads its group, and its group leads a newer one", () => {
    const groups = groupEntries(
      [
        entry({ id: "c-old", agent: "claude", modified: 1 }),
        entry({ id: "c-new", agent: "claude", modified: 9 }),
        entry({ id: "x-newest", agent: "codex", modified: 50 }),
      ],
      "agent",
      new Set(["c-old"]),
    );
    expect(groups.map((g) => g.key)).toEqual(["claude", "codex"]);
    expect(groups[0].entries.map((e) => e.id)).toEqual(["c-old", "c-new"]);
  });

  it("Folder → groups without a pin keep newest-first order among themselves", () => {
    const groups = groupEntries(
      [
        entry({ id: "a", cwd: "/w/a", modified: 10 }),
        entry({ id: "b", cwd: "/w/b", modified: 40 }),
        entry({ id: "c", cwd: "/w/c", modified: 1 }),
        entry({ id: "c2", cwd: "/w/c", modified: 2 }),
      ],
      "folder",
      new Set(["c"]),
    );
    expect(groups.map((g) => g.key)).toEqual(["/w/c", "/w/b", "/w/a"]);
    expect(groups[0].entries.map((e) => e.id)).toEqual(["c", "c2"]);
  });

  it("orders two pinned groups by their newest row, pinned or not", () => {
    const groups = groupEntries(
      [
        entry({ id: "c-pin", agent: "claude", modified: 1 }),
        entry({ id: "c-new", agent: "claude", modified: 60 }),
        entry({ id: "x-pin", agent: "codex", modified: 30 }),
      ],
      "agent",
      new Set(["c-pin", "x-pin"]),
    );
    expect(groups.map((g) => g.key)).toEqual(["claude", "codex"]);
  });

  it("ignores pinned ids that match no entry", () => {
    const groups = groupEntries([entry({ id: "a", modified: 1 })], "recent", new Set(["gone"]));
    expect(groups[0].entries.map((e) => e.id)).toEqual(["a"]);
  });
});

describe("groupEntries with open sessions", () => {
  it("Recent → open rows follow pinned ones and lead the rest", () => {
    const groups = groupEntries(
      [entry({ id: "new", modified: 30 }), entry({ id: "open", modified: 29 }), entry({ id: "pin", modified: 1 })],
      "recent",
      new Set(["pin"]),
      new Set(["open"]),
    );
    expect(groups[0].entries.map((e) => e.id)).toEqual(["pin", "open", "new"]);
  });

  it("Agent → a group holding an open row leads a newer one", () => {
    const groups = groupEntries(
      [entry({ id: "c-open", agent: "claude", modified: 1 }), entry({ id: "x-newest", agent: "codex", modified: 50 })],
      "agent",
      new Set(),
      new Set(["c-open"]),
    );
    expect(groups.map((g) => g.key)).toEqual(["claude", "codex"]);
  });
});
