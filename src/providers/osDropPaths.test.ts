import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile: mocks.execFile }));

import { handleInsertOsDropPaths, matchDropPaths, readOsDragPaths } from "./osDropPaths";

/** Make the mocked osascript print `stdout` (or fail when `stdout` is an Error). */
function osascriptReturns(stdout: string | Error): void {
  mocks.execFile.mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1] as (e: unknown, r?: unknown) => void;
    if (stdout instanceof Error) {
      cb(stdout);
    } else {
      cb(null, { stdout, stderr: "" });
    }
  });
}

describe("matchDropPaths", () => {
  it("orders the pasteboard paths to follow the dropped names", () => {
    expect(matchDropPaths(["/a/b.txt", "/c/My Folder"], ["My Folder", "b.txt"])).toEqual(["/c/My Folder", "/a/b.txt"]);
  });

  it("matches two items that share a basename once each", () => {
    expect(matchDropPaths(["/x/a.txt", "/y/a.txt"], ["a.txt", "a.txt"])).toEqual(["/x/a.txt", "/y/a.txt"]);
  });

  it("rejects a stale pasteboard whose names differ from the drop", () => {
    expect(matchDropPaths(["/old/drag.png"], ["report.pdf"])).toBeNull();
  });

  it("rejects a count mismatch and an empty drop", () => {
    expect(matchDropPaths(["/a/x", "/a/y"], ["x"])).toBeNull();
    expect(matchDropPaths([], [])).toBeNull();
  });
});

describe("readOsDragPaths", () => {
  beforeEach(() => {
    mocks.execFile.mockReset();
  });

  it("returns nothing off macOS without spawning osascript", async () => {
    expect(await readOsDragPaths("linux")).toEqual([]);
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it("parses the JSON path list osascript prints", async () => {
    osascriptReturns('["/Users/me/a b.txt"]\n');
    expect(await readOsDragPaths("darwin")).toEqual(["/Users/me/a b.txt"]);
  });

  it("returns nothing when osascript fails or prints junk", async () => {
    osascriptReturns(new Error("boom"));
    expect(await readOsDragPaths("darwin")).toEqual([]);
    osascriptReturns("not json");
    expect(await readOsDragPaths("darwin")).toEqual([]);
  });
});

describe("handleInsertOsDropPaths", () => {
  beforeEach(() => {
    mocks.execFile.mockReset();
  });

  it("writes the shell-escaped paths with a trailing space", async () => {
    osascriptReturns('["/Users/me/a b.txt","/Users/me/c.txt"]');
    const write = vi.fn();
    expect(await handleInsertOsDropPaths("s1", ["a b.txt", "c.txt"], write, "/bin/zsh", "darwin")).toBe(true);
    expect(write).toHaveBeenCalledWith("s1", "'/Users/me/a b.txt' '/Users/me/c.txt' ");
  });

  it("writes each Finder path quoted as itself — no character dropped or doubled", async () => {
    osascriptReturns(JSON.stringify(["/Users/me/C#/notes.md", "/Users/me/report$1.txt", "/Users/me/a\\b"]));
    const write = vi.fn();
    expect(await handleInsertOsDropPaths("s1", ["notes.md", "report$1.txt", "a\\b"], write, "/bin/zsh", "darwin")).toBe(
      true,
    );
    expect(write).toHaveBeenCalledWith(
      "s1",
      String.raw`'/Users/me/C#/notes.md' '/Users/me/report$1.txt' '/Users/me/a\b' `,
    );
  });

  it("quotes for the target pane's shell — cmd reads double quotes, not single", async () => {
    osascriptReturns('["/Users/me/a b.txt"]');
    const write = vi.fn();
    await handleInsertOsDropPaths("s1", ["a b.txt"], write, "cmd.exe", "darwin");
    expect(write).toHaveBeenCalledWith("s1", '"/Users/me/a b.txt" ');
  });

  it("writes nothing when the pasteboard does not match the drop", async () => {
    osascriptReturns('["/Users/me/other.txt"]');
    const write = vi.fn();
    expect(await handleInsertOsDropPaths("s1", ["a.txt"], write, "/bin/zsh", "darwin")).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });
});
