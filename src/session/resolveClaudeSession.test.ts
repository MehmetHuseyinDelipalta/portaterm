// src/session/resolveClaudeSession.test.ts — Unit tests for terminal→session mapping.

import { describe, expect, it, vi } from "vitest";
import type { RunningClaudeSession } from "../vault/readers/runningSessions";
import { indexRunningSessions } from "../vault/readers/runningSessions";
import { type ResolveClaudeSessionDeps, resolveClaudeSession } from "./resolveClaudeSession";

const TID = "term-1";

function run(sessionId: string, pid: number, cwd: string): RunningClaudeSession {
  return { sessionId, pid, cwd };
}

function makeDeps(overrides: Partial<ResolveClaudeSessionDeps> = {}): ResolveClaudeSessionDeps {
  return {
    getPtyPid: vi.fn(() => 1000),
    getCwd: vi.fn(async () => "/work/proj"),
    runningIndex: vi.fn(async () => indexRunningSessions([])),
    // Unknown by default: these cases exercise the fallbacks, which only exist
    // for a pane whose process table could not answer.
    paneSubtree: vi.fn(async () => ({ kind: "unknown" as const })),
    sessionMtime: vi.fn(async () => 0),
    newestSessionUnderCwd: vi.fn(async () => null),
    ...overrides,
  };
}

describe("resolveClaudeSession — step 1 (process subtree ∩ registry)", () => {
  it("returns the exact session when one running pid is in the pty subtree", async () => {
    const deps = makeDeps({
      paneSubtree: vi.fn(async () => ({ kind: "known" as const, pids: [1001, 1002] })),
      runningIndex: vi.fn(async () =>
        indexRunningSessions([run("sess-x", 1002, "/launch/cwd"), run("sess-y", 5000, "/other")]),
      ),
    });
    expect(await resolveClaudeSession(TID, deps)).toEqual({
      sessionId: "sess-x",
      cwd: "/launch/cwd",
      evidence: "process",
    });
    // An exact subtree hit must NOT consult the cwd fallbacks.
    expect(deps.getCwd).not.toHaveBeenCalled();
  });

  it("tie-breaks >1 subtree matches by newest <sessionId>.jsonl mtime", async () => {
    const deps = makeDeps({
      paneSubtree: vi.fn(async () => ({ kind: "known" as const, pids: [1001, 1002] })),
      runningIndex: vi.fn(async () => indexRunningSessions([run("old", 1001, "/a"), run("new", 1002, "/b")])),
      sessionMtime: vi.fn(async (id: string) => (id === "new" ? 200 : 100)),
    });
    expect(await resolveClaudeSession(TID, deps)).toEqual({ sessionId: "new", cwd: "/b", evidence: "process" });
  });

  it("matches a claude that IS the pty process, as an agent launch spawns it", async () => {
    // No shell above it: the pty pid is claude's own, and its subtree is empty.
    const deps = makeDeps({
      paneSubtree: vi.fn(async () => ({ kind: "known" as const, pids: [] })),
      runningIndex: vi.fn(async () =>
        indexRunningSessions([run("launched", 1000, "/work/proj"), run("other", 5000, "/work/proj")]),
      ),
    });
    expect(await resolveClaudeSession(TID, deps)).toEqual({
      sessionId: "launched",
      cwd: "/work/proj",
      evidence: "process",
    });
    expect(deps.getCwd).not.toHaveBeenCalled();
  });
});

describe("resolveClaudeSession — step 2 (running by cwd)", () => {
  it("falls back to a running entry whose cwd matches, when the table could not be read", async () => {
    const deps = makeDeps({
      getPtyPid: vi.fn(() => 1000),
      paneSubtree: vi.fn(async () => ({ kind: "unknown" as const })),
      getCwd: vi.fn(async () => "/work/proj"),
      runningIndex: vi.fn(async () =>
        indexRunningSessions([run("sess-here", 4242, "/work/proj"), run("elsewhere", 4243, "/other")]),
      ),
    });
    expect(await resolveClaudeSession(TID, deps)).toEqual({
      sessionId: "sess-here",
      cwd: "/work/proj",
      evidence: "directory",
    });
  });

  it("tie-breaks multiple cwd matches by newest mtime", async () => {
    const deps = makeDeps({
      paneSubtree: vi.fn(async () => ({ kind: "unknown" as const })),
      getCwd: vi.fn(async () => "/work/proj"),
      runningIndex: vi.fn(async () => indexRunningSessions([run("a", 1, "/work/proj"), run("b", 2, "/work/proj")])),
      sessionMtime: vi.fn(async (id: string) => (id === "b" ? 9 : 1)),
    });
    expect(await resolveClaudeSession(TID, deps)).toEqual({ sessionId: "b", cwd: "/work/proj", evidence: "directory" });
  });

  it("refuses a cwd match once the table has placed every running session outside this pty", async () => {
    // The reporter's case: another application (orca) runs claude in a directory
    // an idle shell pane of this window happens to sit in. The same `ps` read
    // that found no session under this pty found that one under someone else's,
    // so the shared directory is a refuted claim, not a weaker one.
    const deps = makeDeps({
      getPtyPid: vi.fn(() => 1000),
      paneSubtree: vi.fn(async () => ({ kind: "known" as const, pids: [9999] })),
      getCwd: vi.fn(async () => "/work/proj"),
      runningIndex: vi.fn(async () => indexRunningSessions([run("theirs", 4242, "/work/proj")])),
    });
    expect(await resolveClaudeSession(TID, deps)).toBeNull();
  });

  it("still reaches the on-disk fallback after a refusal — an exited transcript has no pid to refute", async () => {
    const deps = makeDeps({
      getPtyPid: vi.fn(() => 1000),
      paneSubtree: vi.fn(async () => ({ kind: "known" as const, pids: [9999] })),
      getCwd: vi.fn(async () => "/work/proj"),
      runningIndex: vi.fn(async () => indexRunningSessions([run("theirs", 4242, "/work/proj")])),
      newestSessionUnderCwd: vi.fn(async () => ({ sessionId: "exited", cwd: "/work/proj" })),
    });
    expect(await resolveClaudeSession(TID, deps)).toEqual({
      sessionId: "exited",
      cwd: "/work/proj",
      evidence: "recent",
    });
  });

  it("names the refuted live sessions to the on-disk selector, so a newer one cannot mask an older exited one", async () => {
    // Round-1 F001. A session running right now has a transcript on disk too, and
    // it is the newest one under this directory — so a selector told nothing would
    // stop at the identity step 2 has just refused.
    const onDisk = [
      { sessionId: "theirs", cwd: "/work/proj", modified: 900 },
      { sessionId: "ours-exited", cwd: "/work/proj", modified: 100 },
    ];
    const newestSessionUnderCwd = vi.fn(async (cwd: string, exclude: ReadonlySet<string>) => {
      const eligible = onDisk.filter((e) => e.cwd === cwd && !exclude.has(e.sessionId));
      const best = eligible.sort((a, b) => b.modified - a.modified)[0];
      return best === undefined ? null : { sessionId: best.sessionId, cwd: best.cwd };
    });
    const deps = makeDeps({
      getPtyPid: vi.fn(() => 1000),
      paneSubtree: vi.fn(async () => ({ kind: "known" as const, pids: [9999] })),
      getCwd: vi.fn(async () => "/work/proj"),
      runningIndex: vi.fn(async () => indexRunningSessions([run("theirs", 4242, "/work/proj")])),
      newestSessionUnderCwd,
    });
    expect(await resolveClaudeSession(TID, deps)).toEqual({
      sessionId: "ours-exited",
      cwd: "/work/proj",
      evidence: "recent",
    });
    expect(newestSessionUnderCwd).toHaveBeenCalledWith("/work/proj", new Set(["theirs"]));
  });

  it("refuses a refuted identity a selector handed back anyway", async () => {
    // The exclusion is stated AND re-checked: a selector that ignores it must not
    // be able to return the identity this resolution has already refused.
    const deps = makeDeps({
      getPtyPid: vi.fn(() => 1000),
      paneSubtree: vi.fn(async () => ({ kind: "known" as const, pids: [9999] })),
      getCwd: vi.fn(async () => "/work/proj"),
      runningIndex: vi.fn(async () => indexRunningSessions([run("theirs", 4242, "/work/proj")])),
      newestSessionUnderCwd: vi.fn(async () => ({ sessionId: "theirs", cwd: "/work/proj" })),
    });
    expect(await resolveClaudeSession(TID, deps)).toBeNull();
  });

  it("excludes nothing where the process table could not be read", async () => {
    // Nothing was refuted, so the disk selector must see the whole field — the
    // Windows path keeps every candidate it had.
    const newestSessionUnderCwd = vi.fn(async () => ({ sessionId: "theirs", cwd: "/work/proj" }));
    const deps = makeDeps({
      getPtyPid: vi.fn(() => 1000),
      paneSubtree: vi.fn(async () => ({ kind: "unknown" as const })),
      getCwd: vi.fn(async () => "/work/proj"),
      runningIndex: vi.fn(async () => indexRunningSessions([run("theirs", 4242, "/elsewhere")])),
      newestSessionUnderCwd,
    });
    expect(await resolveClaudeSession(TID, deps)).toEqual({
      sessionId: "theirs",
      cwd: "/work/proj",
      evidence: "recent",
    });
    expect(newestSessionUnderCwd).toHaveBeenCalledWith("/work/proj", new Set());
  });
});

describe("resolveClaudeSession — step 3 (newest under cwd) + null", () => {
  it("falls back to the newest session under cwd when no running entry matches", async () => {
    const deps = makeDeps({
      paneSubtree: vi.fn(async () => ({ kind: "unknown" as const })),
      getCwd: vi.fn(async () => "/work/proj"),
      runningIndex: vi.fn(async () => indexRunningSessions([run("running-elsewhere", 1, "/elsewhere")])),
      newestSessionUnderCwd: vi.fn(async () => ({ sessionId: "exited", cwd: "/work/proj" })),
    });
    expect(await resolveClaudeSession(TID, deps)).toEqual({
      sessionId: "exited",
      cwd: "/work/proj",
      evidence: "recent",
    });
  });

  it("returns null when nothing resolves", async () => {
    const deps = makeDeps({
      paneSubtree: vi.fn(async () => ({ kind: "unknown" as const })),
      getCwd: vi.fn(async () => "/work/proj"),
      newestSessionUnderCwd: vi.fn(async () => null),
    });
    expect(await resolveClaudeSession(TID, deps)).toBeNull();
  });

  it("returns null when the pane has no cwd and no subtree match", async () => {
    const deps = makeDeps({
      getPtyPid: vi.fn(() => undefined), // unknown pane
      getCwd: vi.fn(async () => undefined),
    });
    expect(await resolveClaudeSession(TID, deps)).toBeNull();
    expect(deps.newestSessionUnderCwd).not.toHaveBeenCalled();
  });
});

describe("resolveClaudeSession — Windows / no pty pid", () => {
  it("uses cwd fallbacks when the subtree is unknown (Windows no-op)", async () => {
    const deps = makeDeps({
      getPtyPid: vi.fn(() => 1000),
      paneSubtree: vi.fn(async () => ({ kind: "unknown" as const })), // Windows: no process table
      getCwd: vi.fn(async () => "/work/proj"),
      runningIndex: vi.fn(async () => indexRunningSessions([run("by-cwd", 7, "/work/proj")])),
    });
    expect(await resolveClaudeSession(TID, deps)).toEqual({
      sessionId: "by-cwd",
      cwd: "/work/proj",
      evidence: "directory",
    });
  });
});

describe("resolveClaudeSession — headless one-shot exclusion", () => {
  /** A headless `claude -p` registry entry (entrypoint measured as "sdk-cli"). */
  function headless(sessionId: string, pid: number, cwd: string): RunningClaudeSession {
    return { sessionId, pid, cwd, entrypoint: "sdk-cli" };
  }

  it("prefers the interactive session over a headless child with a newer transcript", async () => {
    // The hook-spawned `claude -p` writes its transcript at that instant, so it
    // wins pickNewest unless it is filtered out first.
    const deps = makeDeps({
      paneSubtree: vi.fn(async () => ({ kind: "known" as const, pids: [1001, 1002] })),
      runningIndex: vi.fn(async () =>
        indexRunningSessions([
          { ...run("interactive", 1001, "/work/proj"), entrypoint: "cli" },
          headless("one-shot", 1002, "/work/proj"),
        ]),
      ),
      sessionMtime: vi.fn(async (id: string) => (id === "one-shot" ? 999 : 100)),
    });
    expect(await resolveClaudeSession(TID, deps)).toEqual({
      sessionId: "interactive",
      cwd: "/work/proj",
      evidence: "process",
    });
  });

  it("falls through to the cwd fallbacks when the subtree holds only a headless run", async () => {
    const deps = makeDeps({
      paneSubtree: vi.fn(async () => ({ kind: "known" as const, pids: [1002] })),
      runningIndex: vi.fn(async () => indexRunningSessions([headless("one-shot", 1002, "/work/proj")])),
      newestSessionUnderCwd: vi.fn(async () => ({ sessionId: "on-disk", cwd: "/work/proj" })),
    });
    expect(await resolveClaudeSession(TID, deps)).toEqual({
      sessionId: "on-disk",
      cwd: "/work/proj",
      evidence: "recent",
    });
  });

  it("excludes a headless run from the cwd fallback too", async () => {
    // Step 2 matches on cwd alone, so a headless run in the same directory can
    // hijack it just as easily as the subtree intersection. Held at `unknown`:
    // a readable table would refuse step 2 outright and prove nothing about the
    // headless filter this test is about.
    const deps = makeDeps({
      paneSubtree: vi.fn(async () => ({ kind: "unknown" as const })),
      runningIndex: vi.fn(async () => indexRunningSessions([headless("one-shot", 7777, "/work/proj")])),
      newestSessionUnderCwd: vi.fn(async () => ({ sessionId: "on-disk", cwd: "/work/proj" })),
    });
    expect(await resolveClaudeSession(TID, deps)).toEqual({
      sessionId: "on-disk",
      cwd: "/work/proj",
      evidence: "recent",
    });
  });

  it("keeps a session whose entrypoint is unknown", async () => {
    const deps = makeDeps({
      paneSubtree: vi.fn(async () => ({ kind: "known" as const, pids: [1002] })),
      runningIndex: vi.fn(async () =>
        indexRunningSessions([{ ...run("future", 1002, "/work/proj"), entrypoint: "some-new-value" }]),
      ),
    });
    expect(await resolveClaudeSession(TID, deps)).toEqual({
      sessionId: "future",
      cwd: "/work/proj",
      evidence: "process",
    });
  });
});
