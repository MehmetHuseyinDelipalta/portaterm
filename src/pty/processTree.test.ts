// src/pty/processTree.test.ts — Unit tests for the pure parser/BFS + OS wrapper.

import { describe, expect, it, vi } from "vitest";
import {
  collectDescendants,
  descendantPids,
  ownerAppOf,
  type ProcessTreeDeps,
  parseProcessRows,
  parseProcessTable,
} from "./processTree";

function makeDeps(overrides: Partial<ProcessTreeDeps> = {}): ProcessTreeDeps {
  return {
    exec: vi.fn(async () => ({ stdout: "", stderr: "" })),
    platform: "darwin",
    ...overrides,
  };
}

// A small forest:  1 → 2 → 4 ; 1 → 3 ; 2 → 5 ; 10 (unrelated)
const TABLE_TEXT = ["  2   1", "  3   1", "  4   2", "  5   2", " 10   9", "PID PPID", ""].join("\n");

describe("parseProcessTable", () => {
  it("parses `pid ppid` lines into a parent→children map, ignoring junk", () => {
    const table = parseProcessTable(TABLE_TEXT);
    expect(table.get(1)).toEqual([2, 3]);
    expect(table.get(2)).toEqual([4, 5]);
    expect(table.get(9)).toEqual([10]);
    // "PID PPID" header line and the trailing blank are skipped.
    expect(table.has(Number.NaN)).toBe(false);
  });

  it("returns an empty map for empty input", () => {
    expect(parseProcessTable("").size).toBe(0);
  });
});

describe("collectDescendants", () => {
  it("BFS-collects all transitive descendants of a root", () => {
    const table = parseProcessTable(TABLE_TEXT);
    expect(collectDescendants(1, table).sort((a, b) => a - b)).toEqual([2, 3, 4, 5]);
    expect(collectDescendants(2, table).sort((a, b) => a - b)).toEqual([4, 5]);
  });

  it("returns [] for a leaf / unknown pid", () => {
    const table = parseProcessTable(TABLE_TEXT);
    expect(collectDescendants(4, table)).toEqual([]);
    expect(collectDescendants(999, table)).toEqual([]);
  });

  it("does not loop on a cyclic table (defensive)", () => {
    const cyclic = new Map<number, number[]>([
      [1, [2]],
      [2, [1]],
    ]);
    expect(collectDescendants(1, cyclic)).toEqual([2]);
  });
});

describe("descendantPids: OS wrapper", () => {
  it("macOS calls `ps -axo pid=,ppid=,comm=` and returns the subtree", async () => {
    const deps = makeDeps({ platform: "darwin", exec: vi.fn(async () => ({ stdout: TABLE_TEXT, stderr: "" })) });
    const result = await descendantPids(1, deps);
    expect(result.sort((a, b) => a - b)).toEqual([2, 3, 4, 5]);
    expect(deps.exec).toHaveBeenCalledWith("ps", ["-axo", "pid=,ppid=,comm="], { timeout: 500 });
  });

  it("Linux calls `ps -eo pid=,ppid=,comm=`", async () => {
    const deps = makeDeps({ platform: "linux", exec: vi.fn(async () => ({ stdout: TABLE_TEXT, stderr: "" })) });
    await descendantPids(2, deps);
    expect(deps.exec).toHaveBeenCalledWith("ps", ["-eo", "pid=,ppid=,comm="], { timeout: 500 });
  });

  it("returns [] on Windows without any IO", async () => {
    const deps = makeDeps({ platform: "win32" });
    expect(await descendantPids(1, deps)).toEqual([]);
    expect(deps.exec).not.toHaveBeenCalled();
  });

  it("returns [] for an invalid pid without any IO", async () => {
    const deps = makeDeps();
    expect(await descendantPids(0, deps)).toEqual([]);
    expect(await descendantPids(-5, deps)).toEqual([]);
    expect(await descendantPids(Number.NaN, deps)).toEqual([]);
    expect(deps.exec).not.toHaveBeenCalled();
  });

  it("returns [] when ps throws (not installed / timeout)", async () => {
    const deps = makeDeps({
      platform: "darwin",
      exec: vi.fn(async () => {
        throw new Error("Command failed: ps");
      }),
    });
    expect(await descendantPids(1, deps)).toEqual([]);
  });
});

describe("ownerAppOf", () => {
  // The real shape, from `ps -axo pid=,ppid=,comm=` on the machine that reported
  // the bug: claude -> zsh -> login -> Orca Helper -> Orca. The first two links
  // carry no bundle at all, which is why the walk has to keep going.
  const ORCA = parseProcessRows(
    [
      "16716 16179 claude",
      "16179 16178 -/bin/zsh -l",
      "16178 84446 /usr/bin/login",
      "84446 11289 /Applications/Orca.app/Contents/Frameworks/Orca Helper.app/Contents/MacOS/Orca Helper",
      "11289 1 /Applications/Orca.app/Contents/MacOS/Orca",
    ].join("\n"),
  );

  it("names the outermost bundle, not the helper the process actually runs from", () => {
    // `Orca Helper.app` is nested inside `Orca.app`, and the user calls it Orca.
    expect(ownerAppOf(16716, ORCA)).toBe("Orca");
  });

  it("keeps walking past links that carry no bundle", () => {
    // Proven by the shell and `login` in the chain above: a nearest-match rule
    // that stopped at the first command would answer undefined here.
    expect(ownerAppOf(16179, ORCA)).toBe("Orca");
  });

  it("says nothing when nothing in the chain is a bundled application", () => {
    const bare = parseProcessRows(["500 400 claude", "400 1 /bin/zsh"].join("\n"));
    expect(ownerAppOf(500, bare)).toBeUndefined();
  });

  it("says nothing for a pid the table does not hold", () => {
    expect(ownerAppOf(99999, ORCA)).toBeUndefined();
  });

  it("stops at the root rather than crediting init with the ownership", () => {
    const rooted = parseProcessRows(["7 1 /bin/sh", "1 0 /sbin/launchd"].join("\n"));
    expect(ownerAppOf(7, rooted)).toBeUndefined();
  });

  it("does not spin on a table that reports a cycle", () => {
    const cyclic = parseProcessRows(["10 11 a", "11 10 b"].join("\n"));
    expect(ownerAppOf(10, cyclic)).toBeUndefined();
  });

  it("still parses a two-column table, with no command to read", () => {
    const rows = parseProcessRows(["10 11", "11 1"].join("\n"));
    expect(rows.children.get(11)).toEqual([10]);
    expect(ownerAppOf(10, rows)).toBeUndefined();
  });
});
