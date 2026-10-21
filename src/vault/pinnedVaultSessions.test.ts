// src/vault/pinnedVaultSessions.test.ts — which vault sessions pinned tabs run.

import { describe, expect, it, vi } from "vitest";
import type { DescendantsOutcome, ProcessTableSnapshot } from "../pty/processTableSnapshot";
import {
  createClaudeProcessLookup,
  createPinnedVaultPublisher,
  livePaneForEntry,
  type PinnedIdentitySources,
  pinnedEntryIds,
  resolvePinnedEntryIds,
} from "./pinnedVaultSessions";
import type { RunningClaudeSession } from "./readers/runningSessions";

describe("pinnedEntryIds", () => {
  it("names the entry a pinned pane resumed", () => {
    expect(pinnedEntryIds([{ paneId: "p1", vaultEntryId: "codex:abc" }], () => undefined)).toEqual(["codex:abc"]);
  });

  it("prefers what the pane is running now, since the agent may have moved on since the resume", () => {
    const running = (paneId: string) => (paneId === "p1" ? "claude:new" : undefined);
    expect(pinnedEntryIds([{ paneId: "p1", vaultEntryId: "claude:old" }], running)).toEqual(["claude:new"]);
  });

  it("skips a pane that names nothing — a plain shell in a pinned tab", () => {
    expect(pinnedEntryIds([{ paneId: "p1" }], () => undefined)).toEqual([]);
  });

  it("covers every pane of a pinned tab, sorted and without duplicates", () => {
    const panes = [
      { paneId: "root", vaultEntryId: "codex:b" },
      { paneId: "split", vaultEntryId: "claude:a" },
      { paneId: "other", vaultEntryId: "codex:b" },
    ];
    expect(pinnedEntryIds(panes, () => undefined)).toEqual(["claude:a", "codex:b"]);
  });
});

describe("livePaneForEntry", () => {
  it("finds the pane a vault launch resumed the entry in", () => {
    const panes = [{ paneId: "p1" }, { paneId: "p2", vaultEntryId: "claude:s1" }];
    expect(livePaneForEntry(panes, () => undefined, "claude:s1")).toEqual({ paneId: "p2", vaultEntryId: "claude:s1" });
  });

  it("finds a pane whose agent reports the entry, though no vault launch started it", () => {
    const running = (paneId: string) => (paneId === "p1" ? "claude:s1" : undefined);
    expect(livePaneForEntry([{ paneId: "p1" }], running, "claude:s1")).toEqual({ paneId: "p1" });
  });

  it("does not claim the entry for a pane whose agent has moved to another session", () => {
    const running = (paneId: string) => (paneId === "p1" ? "claude:new" : undefined);
    expect(livePaneForEntry([{ paneId: "p1", vaultEntryId: "claude:s1" }], running, "claude:s1")).toBeUndefined();
  });

  it("answers nothing when no pane runs the entry", () => {
    expect(livePaneForEntry([{ paneId: "p1", vaultEntryId: "codex:x" }], () => undefined, "claude:s1")).toBeUndefined();
  });
});

describe("resolvePinnedEntryIds", () => {
  function sources(over: Partial<PinnedIdentitySources> = {}): PinnedIdentitySources {
    return {
      reported: () => undefined,
      ptyPid: () => 100,
      claudeByProcess: vi.fn(async () => new Map<string, string>()),
      ...over,
    };
  }

  it("names a claude started by hand from its process, with no hook", async () => {
    const s = sources({ claudeByProcess: async () => new Map([["p1", "sess-1"]]) });
    await expect(resolvePinnedEntryIds([{ paneId: "p1" }], s)).resolves.toEqual({
      entryIds: ["claude:sess-1"],
      claudeByPane: new Map([["p1", "sess-1"]]),
    });
  });

  it("ranks the hook report over the process, and the process over the resumed entry", async () => {
    const s = sources({
      reported: (paneId) => (paneId === "reported" ? "opencode:ses_1" : undefined),
      claudeByProcess: async () => new Map([["process", "now"]]),
    });
    const panes = [
      { paneId: "reported", vaultEntryId: "opencode:old" },
      { paneId: "process", vaultEntryId: "claude:old" },
      { paneId: "resumed", vaultEntryId: "codex:t1" },
    ];
    const resolved = await resolvePinnedEntryIds(panes, s);
    expect(resolved.entryIds).toEqual(["claude:now", "codex:t1", "opencode:ses_1"]);
  });

  it("asks the process table about every pinned pane with a pty, reported or not", async () => {
    // A report outlives the Claude that made it; only the table says what a
    // restore may resume.
    const claudeByProcess = vi.fn(async () => new Map<string, string>([["a", "running"]]));
    const s = sources({
      reported: (paneId) => (paneId === "a" ? "claude:x" : undefined),
      ptyPid: (paneId) => (paneId === "b" ? 200 : paneId === "a" ? 100 : undefined),
      claudeByProcess,
    });
    const resolved = await resolvePinnedEntryIds([{ paneId: "a" }, { paneId: "b" }, { paneId: "no-pty" }], s);
    expect(claudeByProcess).toHaveBeenCalledWith([
      { paneId: "a", ptyPid: 100 },
      { paneId: "b", ptyPid: 200 },
    ]);
    expect(resolved.entryIds).toEqual(["claude:x"]); // the report still names the row
    expect(resolved.claudeByPane).toEqual(new Map([["a", "running"]]));
  });

  it("reads no process table when nothing is pinned", async () => {
    const claudeByProcess = vi.fn(async () => new Map<string, string>());
    await expect(resolvePinnedEntryIds([], sources({ claudeByProcess }))).resolves.toEqual({
      entryIds: [],
      claudeByPane: new Map(),
    });
    expect(claudeByProcess).not.toHaveBeenCalled();
  });
});

describe("createClaudeProcessLookup", () => {
  function table(descendants: Record<number, DescendantsOutcome>): ProcessTableSnapshot {
    const outcome = (pid: number): DescendantsOutcome => descendants[pid] ?? { kind: "ok", pids: [] };
    return {
      descendantsOf: async (pid) => outcome(pid),
      open: async () => ({ descendantsOf: outcome, ownerAppOf: () => undefined }),
    };
  }
  const session = (over: Partial<RunningClaudeSession>): RunningClaudeSession => ({
    sessionId: "s",
    cwd: "/work",
    pid: 1,
    ...over,
  });

  it("finds the claude running under a pane's pty", async () => {
    const lookup = createClaudeProcessLookup({
      table: table({ 100: { kind: "ok", pids: [101, 102] } }),
      listRunning: async () => ({ kind: "ok", sessions: [session({ sessionId: "mine", pid: 102 })] }),
      sessionMtime: async () => undefined,
    });
    await expect(lookup([{ paneId: "p1", ptyPid: 100 }])).resolves.toEqual(new Map([["p1", "mine"]]));
  });

  it("finds a claude launched as the pane's pty process itself", async () => {
    // A vault or worktree launch spawns `claude` with no shell above it.
    const lookup = createClaudeProcessLookup({
      table: table({ 100: { kind: "ok", pids: [] } }),
      listRunning: async () => ({ kind: "ok", sessions: [session({ sessionId: "launched", pid: 100 })] }),
      sessionMtime: async () => undefined,
    });
    await expect(lookup([{ paneId: "p1", ptyPid: 100 }])).resolves.toEqual(new Map([["p1", "launched"]]));
  });

  it("does not guess from the directory: a claude in the same folder but another pty is not this pane's", async () => {
    const lookup = createClaudeProcessLookup({
      table: table({ 100: { kind: "ok", pids: [101] } }),
      listRunning: async () => ({ kind: "ok", sessions: [session({ sessionId: "elsewhere", pid: 999 })] }),
      sessionMtime: async () => undefined,
    });
    await expect(lookup([{ paneId: "p1", ptyPid: 100 }])).resolves.toEqual(new Map());
  });

  it("names nothing where the process table cannot answer", async () => {
    const lookup = createClaudeProcessLookup({
      table: table({ 100: { kind: "unsupported" }, 200: { kind: "failed", reason: "ps timed out" } }),
      listRunning: async () => ({ kind: "ok", sessions: [session({ sessionId: "x", pid: 101 })] }),
      sessionMtime: async () => undefined,
    });
    await expect(
      lookup([
        { paneId: "win", ptyPid: 100 },
        { paneId: "slow", ptyPid: 200 },
      ]),
    ).resolves.toEqual(new Map());
  });

  it("names nothing when the registry cannot be read", async () => {
    const lookup = createClaudeProcessLookup({
      table: table({ 100: { kind: "ok", pids: [101] } }),
      listRunning: async () => ({ kind: "failed", reason: "EACCES" }),
      sessionMtime: async () => undefined,
    });
    await expect(lookup([{ paneId: "p1", ptyPid: 100 }])).resolves.toEqual(new Map());
  });
});

describe("createPinnedVaultPublisher", () => {
  function harness(initial: string[]) {
    let set = initial;
    const queued: Array<() => void> = [];
    const posts: string[][] = [];
    const publisher = createPinnedVaultPublisher({
      compute: () => set,
      post: (ids) => posts.push(ids),
      schedule: (run) => queued.push(run),
    });
    return {
      publisher,
      posts,
      queued,
      setSet(next: string[]) {
        set = next;
      },
      async flush() {
        while (queued.length > 0) {
          for (const run of queued.splice(0)) {
            run();
          }
          await Promise.resolve();
          await Promise.resolve();
        }
      },
    };
  }

  it("posts when the set changes", async () => {
    const h = harness([]);
    h.setSet(["claude:a"]);
    h.publisher.refresh();
    await h.flush();
    expect(h.posts).toEqual([["claude:a"]]);
  });

  it("stays quiet when a refresh finds the same set", async () => {
    const h = harness(["claude:a"]);
    h.publisher.refresh();
    await h.flush();
    h.publisher.refresh();
    await h.flush();
    expect(h.posts).toEqual([["claude:a"]]);
  });

  it("does not post the empty set it starts from", async () => {
    const h = harness([]);
    h.publisher.refresh();
    await h.flush();
    expect(h.posts).toEqual([]);
  });

  it("coalesces a burst of refreshes into one pass", () => {
    const h = harness(["claude:a"]);
    h.publisher.refresh();
    h.publisher.refresh();
    h.publisher.refresh();
    expect(h.queued).toHaveLength(1);
  });

  it("reads the settled state when the deferred pass runs, not the state at the trigger", async () => {
    const h = harness([]);
    h.publisher.refresh();
    h.setSet(["codex:late"]);
    await h.flush();
    expect(h.posts).toEqual([["codex:late"]]);
  });

  it("answers current() with the last published set", async () => {
    const h = harness(["claude:a"]);
    expect(h.publisher.current()).toEqual([]);
    h.publisher.refresh();
    await h.flush();
    expect(h.publisher.current()).toEqual(["claude:a"]);
  });

  it("posts nothing after dispose", async () => {
    const h = harness([]);
    h.publisher.refresh();
    h.publisher.dispose();
    h.setSet(["claude:a"]);
    await h.flush();
    h.publisher.refresh();
    await h.flush();
    expect(h.posts).toEqual([]);
  });

  it("runs one more pass, not a concurrent one, for a refresh that lands mid-pass", async () => {
    let release: (() => void) | undefined;
    let calls = 0;
    let set = ["claude:a"];
    const posts: string[][] = [];
    const publisher = createPinnedVaultPublisher({
      compute: async () => {
        calls++;
        if (calls === 1) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return set;
      },
      post: (ids) => posts.push(ids),
      schedule: (run) => run(),
    });
    publisher.refresh();
    set = ["claude:b"];
    publisher.refresh();
    publisher.refresh();
    expect(calls).toBe(1);
    release?.();
    await vi.waitFor(() => expect(posts).toEqual([["claude:b"]]));
    expect(calls).toBe(2);
  });

  it("reports a failed pass and keeps publishing afterwards", async () => {
    const onError = vi.fn();
    let fail = true;
    const posts: string[][] = [];
    const publisher = createPinnedVaultPublisher({
      compute: async () => {
        if (fail) {
          throw new Error("ps failed");
        }
        return ["claude:a"];
      },
      post: (ids) => posts.push(ids),
      schedule: (run) => run(),
      onError,
    });
    publisher.refresh();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    fail = false;
    publisher.refresh();
    await vi.waitFor(() => expect(posts).toEqual([["claude:a"]]));
  });
});
