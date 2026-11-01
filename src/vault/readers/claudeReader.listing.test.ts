// src/vault/readers/claudeReader.listing.test.ts — How much of the Claude store a
// list refresh reads (perf B5): excluded sessions are remembered by stamp, a
// watcher's hint re-reads only the files it names, and a full pass reads
// sixteen files at a time. Real files; the body reader is counted.

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReaderListCache } from "../cacheTypes";
import { CLAUDE_SCAN_CONCURRENCY, readClaudeSessions } from "./claudeReader";

const seen = vi.hoisted(() => ({
  bodyReads: [] as string[],
  limits: [] as number[],
  statFailures: new Map<string, string>(),
  lstatFailures: new Map<string, string>(),
}));

vi.mock("./jsonlStream", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./jsonlStream")>();
  return {
    ...actual,
    streamJsonlObjects: (filePath: string, ...rest: unknown[]) => {
      seen.bodyReads.push(filePath);
      return (actual.streamJsonlObjects as (...args: unknown[]) => unknown)(filePath, ...rest);
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

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const failing =
    (failures: Map<string, string>, real: (p: string) => Promise<unknown>) =>
    async (p: string, ...rest: unknown[]) => {
      const code = failures.get(String(p));
      if (code) {
        throw Object.assign(new Error(code), { code });
      }
      return (real as (...args: unknown[]) => Promise<unknown>)(p, ...rest);
    };
  return {
    ...actual,
    stat: failing(seen.statFailures, actual.stat as never),
    lstat: failing(seen.lstatFailures, actual.lstat as never),
  };
});

let configDir: string;
let projectsDir: string;
let clock = 1_700_000_000;

const userLine = (text: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: "user", message: { role: "user", content: text }, cwd: "/work", ...extra });

/** Write a session file with an mtime no earlier write had. */
async function session(project: string, id: string, lines: string[]): Promise<string> {
  const file = path.join(projectsDir, project, `${id}.jsonl`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${lines.join("\n")}\n`);
  clock += 10;
  await fs.utimes(file, clock, clock);
  return file;
}

const listed = (lines = [userLine("hello")]) => lines;
const member = () => [userLine("work for the lead", { agentName: "helper", teamName: "crew" })];
const contentless = () => [JSON.stringify({ type: "system", content: "caveat" })];
const garbage = () => ["not json at all"];

const ids = (result: { entries: { sessionId: string }[] }) => result.entries.map((e) => e.sessionId).sort();
const reads = () => seen.bodyReads.map((p) => path.basename(p, ".jsonl")).sort();

beforeEach(async () => {
  configDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "at-claude-list-")));
  projectsDir = path.join(configDir, "projects");
  seen.bodyReads.length = 0;
  seen.limits.length = 0;
  seen.statFailures.clear();
  seen.lstatFailures.clear();
});

afterEach(async () => {
  await fs.rm(configDir, { recursive: true, force: true });
});

describe("readClaudeSessions — full passes", () => {
  it("does not read an excluded session again while its file is unchanged", async () => {
    await session("-work", "kept", listed());
    const memberFile = await session("-work", "member", member());
    await session("-work", "empty", contentless());
    const first = await readClaudeSessions({ configDir });
    expect(ids(first)).toEqual(["kept"]);
    expect(reads()).toEqual(["empty", "kept", "member"]);

    seen.bodyReads.length = 0;
    const second = await readClaudeSessions({ configDir }, first.cache);
    expect(ids(second)).toEqual(["kept"]);
    expect(reads()).toEqual([]);

    // Changed, it is read again — and, a member no longer, listed.
    await session("-work", "member", listed([userLine("now my own session")]));
    seen.bodyReads.length = 0;
    const third = await readClaudeSessions({ configDir }, second.cache);
    expect(ids(third)).toEqual(["kept", "member"]);
    expect(reads()).toEqual(["member"]);
    expect(memberFile).toContain("member.jsonl");
  });

  it("reads a file again when only its size changed", async () => {
    const file = await session("-work", "kept", listed([userLine("abc")]));
    const { mtime } = await fs.stat(file);
    const first = await readClaudeSessions({ configDir });
    await fs.writeFile(file, `${userLine("abcdef")}\n`);
    await fs.utimes(file, mtime, mtime);
    seen.bodyReads.length = 0;
    const second = await readClaudeSessions({ configDir }, first.cache);
    expect(reads()).toEqual(["kept"]);
    expect(second.entries[0]?.title).toBe("abcdef");
  });

  it("drops a deleted session's excluded stamp", async () => {
    const emptyFile = await session("-work", "empty", contentless());
    const first = await readClaudeSessions({ configDir });
    await fs.rm(emptyFile);
    const second = await readClaudeSessions({ configDir }, first.cache);
    expect(second.cache).toEqual({ kind: "files", files: {}, excluded: {}, unreadablePaths: [] });
  });

  it("reads an unreadable file again on every full pass, and counts it", async () => {
    const bad = await session("-work", "bad", garbage());
    const first = await readClaudeSessions({ configDir });
    expect(first.unreadable).toBe(1);
    expect(first.cache).toMatchObject({ unreadablePaths: [bad] });
    seen.bodyReads.length = 0;
    expect((await readClaudeSessions({ configDir }, first.cache)).unreadable).toBe(1);
    expect(reads()).toEqual(["bad"]);
  });

  it("counts a file that vanished before its stat as unreadable, not gone", async () => {
    const file = await session("-work", "racing", listed());
    seen.statFailures.set(file, "ENOENT");
    const result = await readClaudeSessions({ configDir });
    expect(result.unreadable).toBe(1);
  });

  it("reads project folders and their files sixteen at a time", async () => {
    await session("-a", "one", listed());
    await session("-b", "two", listed());
    await readClaudeSessions({ configDir });
    expect(seen.limits).toEqual([16, 16]);
    expect(CLAUDE_SCAN_CONCURRENCY).toBe(16);
  });

  it("lists sessions across many project folders", async () => {
    for (let i = 0; i < 40; i++) {
      await session(`-p${i}`, `s${i}`, listed());
    }
    expect((await readClaudeSessions({ configDir })).entries).toHaveLength(40);
  });

  it("answers an empty list for a store that is not there", async () => {
    expect(await readClaudeSessions({ configDir: path.join(configDir, "missing") })).toEqual({
      entries: [],
      unreadable: 0,
      cache: { kind: "files", files: {} },
    });
  });
});

describe("readClaudeSessions — a watcher's hint", () => {
  async function base() {
    const keptFile = await session("-work", "kept", listed());
    const emptyFile = await session("-work", "empty", contentless());
    const badFile = await session("-work", "bad", garbage());
    const first = await readClaudeSessions({ configDir });
    seen.bodyReads.length = 0;
    seen.limits.length = 0;
    return { first, keptFile, emptyFile, badFile };
  }

  it("reads only the session files it names, carrying every other file forward", async () => {
    const { first } = await base();
    const fresh = await session("-work", "fresh", listed());
    const unnamed = await session("-other", "unnamed", listed());
    const result = await readClaudeSessions({ configDir }, first.cache, { paths: [fresh] });
    expect(ids(result)).toEqual(["fresh", "kept"]);
    expect(reads()).toEqual(["fresh"]);
    expect(result.unreadable).toBe(1); // "bad", carried forward
    expect(seen.limits).toEqual([16]);
    const cache = result.cache as Extract<ReaderListCache, { kind: "files" }>;
    expect(Object.keys(cache.excluded ?? {})).toEqual([path.join(projectsDir, "-work", "empty.jsonl")]);
    expect(cache.unreadablePaths).toEqual([path.join(projectsDir, "-work", "bad.jsonl")]);
    expect(unnamed).toContain("unnamed"); // not named, so not seen until a full pass
  });

  it("gives each named file its own outcome", async () => {
    const { first, emptyFile } = await base();
    const fresh = await session("-work", "fresh", listed());
    const result = await readClaudeSessions({ configDir }, first.cache, { paths: [fresh, emptyFile] });
    expect(ids(result)).toEqual(["fresh", "kept"]);
    const cache = result.cache as Extract<ReaderListCache, { kind: "files" }>;
    expect(Object.keys(cache.excluded ?? {})).toEqual([emptyFile]);
  });

  it("keeps an excluded file excluded, unread", async () => {
    const { first, emptyFile } = await base();
    const result = await readClaudeSessions({ configDir }, first.cache, { paths: [emptyFile] });
    expect(ids(result)).toEqual(["kept"]);
    expect(reads()).toEqual([]);
  });

  it("re-reads a named file that changed", async () => {
    const { first } = await base();
    const kept = await session("-work", "kept", listed([userLine("edited")]));
    const result = await readClaudeSessions({ configDir }, first.cache, { paths: [kept] });
    expect(reads()).toEqual(["kept"]);
    expect(result.entries.find((e) => e.sessionId === "kept")?.title).toBe("edited");
  });

  it("drops a named file that is gone, without counting it unreadable", async () => {
    const { first, keptFile, badFile } = await base();
    await fs.rm(keptFile);
    await fs.rm(badFile);
    const result = await readClaudeSessions({ configDir }, first.cache, { paths: [keptFile, badFile] });
    expect(ids(result)).toEqual([]);
    expect(result.unreadable).toBe(0);
  });

  it("counts a named file it cannot stat for a reason other than absence as unreadable", async () => {
    const { first, keptFile } = await base();
    seen.statFailures.set(keptFile, "EACCES");
    const result = await readClaudeSessions({ configDir }, first.cache, { paths: [keptFile] });
    expect(ids(result)).toEqual([]);
    expect(result.unreadable).toBe(2);
  });

  it("drops a named file whose project folder is gone, without a full pass", async () => {
    const { first, keptFile, emptyFile, badFile } = await base();
    await session("-other", "unnamed", listed());
    await fs.rm(path.dirname(keptFile), { recursive: true });
    const result = await readClaudeSessions({ configDir }, first.cache, { paths: [keptFile, emptyFile, badFile] });
    expect(result).toMatchObject({ entries: [], unreadable: 0 });
  });

  it.each([
    ["a subagent transcript", ["kept", "subagents", "agent-1.jsonl"]],
    ["a file directly in a session folder", ["kept", "notes.jsonl"]],
  ])("ignores %s, which is never a list row", async (_label, below) => {
    const { first } = await base();
    await session("-other", "unnamed", listed()); // a full pass would list it
    const nested = path.join(projectsDir, "-work", ...below);
    await fs.mkdir(path.dirname(nested), { recursive: true });
    await fs.writeFile(nested, `${userLine("sub")}\n`);
    const result = await readClaudeSessions({ configDir }, first.cache, { paths: [nested] });
    expect(ids(result)).toEqual(["kept"]);
    expect(reads()).toEqual([]);
  });

  it("ignores a session file in a symlinked project folder, as a full pass does", async () => {
    const { first } = await base();
    const elsewhere = path.join(configDir, "elsewhere");
    await fs.mkdir(elsewhere);
    await fs.writeFile(path.join(elsewhere, "linked.jsonl"), `${userLine("x")}\n`);
    await fs.symlink(elsewhere, path.join(projectsDir, "-linked"));
    const result = await readClaudeSessions({ configDir }, first.cache, {
      paths: [path.join(projectsDir, "-linked", "linked.jsonl")],
    });
    expect(ids(result)).toEqual(["kept"]);
    expect(ids(await readClaudeSessions({ configDir }))).toEqual(["kept"]);
  });

  it.each([
    ["a path outside the store", () => path.join(configDir, "elsewhere.jsonl")],
    ["a sibling folder named like the store", () => path.join(`${projectsDir}-backup`, "-work", "kept.jsonl")],
    ["the store itself", () => projectsDir],
    ["a project folder", () => path.join(projectsDir, "-work")],
    ["a file in a project folder that is not a session", () => path.join(projectsDir, "-work", "notes.txt")],
  ])("falls back to a full pass for %s", async (_label, changed) => {
    const { first } = await base();
    await session("-other", "unnamed", listed());
    const result = await readClaudeSessions({ configDir }, first.cache, { paths: [changed()] });
    expect(ids(result)).toEqual(["kept", "unnamed"]);
  });

  it("falls back to a full pass when it cannot tell whether a project folder is real", async () => {
    const { first, keptFile } = await base();
    await session("-other", "unnamed", listed());
    seen.lstatFailures.set(path.dirname(keptFile), "EACCES");
    const result = await readClaudeSessions({ configDir }, first.cache, { paths: [keptFile] });
    expect(ids(result)).toEqual(["kept", "unnamed"]);
  });

  it("answers an empty list when the store is gone", async () => {
    const { first, keptFile } = await base();
    await fs.rm(projectsDir, { recursive: true });
    expect(await readClaudeSessions({ configDir }, first.cache, { paths: [keptFile] })).toEqual({
      entries: [],
      unreadable: 0,
      cache: { kind: "files", files: {} },
    });
  });

  it("does a full pass without a previous cache to carry forward", async () => {
    await session("-work", "kept", listed());
    const other = await session("-other", "unnamed", listed());
    const result = await readClaudeSessions({ configDir }, undefined, { paths: [other] });
    expect(ids(result)).toEqual(["kept", "unnamed"]);
  });

  it("carries a previous cache from before excluded stamps were kept", async () => {
    const { first } = await base();
    const legacy: ReaderListCache = {
      kind: "files",
      files: (first.cache as Extract<ReaderListCache, { kind: "files" }>).files,
    };
    const fresh = await session("-work", "fresh", listed());
    const result = await readClaudeSessions({ configDir }, legacy, { paths: [fresh] });
    expect(ids(result)).toEqual(["fresh", "kept"]);
    expect(result.unreadable).toBe(0);
  });
});
