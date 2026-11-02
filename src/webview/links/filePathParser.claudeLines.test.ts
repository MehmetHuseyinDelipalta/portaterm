// src/webview/links/filePathParser.claudeLines.test.ts — the `path · lines N`
// pattern starts a match only where a path can start (perf D6): the same
// matches as before, without re-scanning a long token from every position.

import { describe, expect, it } from "vitest";
import { CLAUDE_LINES_RE, detectFilePathLinks } from "./filePathParser";

/** The pattern as it was, without the lookbehind: the reference for what matches. */
const BEFORE = /(?<path>[^\s'"<>(){}[\]|]+)\s+·\s+lines?\s+(?<row>\d+)(?:-\d+)?/g;

const matches = (re: RegExp, line: string) =>
  [...line.matchAll(re)].map((m) => [m.index, m[0], m.groups?.path, m.groups?.row]);

/** A small deterministic generator, so a failure names a line that can be replayed. */
function lines(count: number): string[] {
  let seed = 0x2f6b;
  const next = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed;
  };
  const alphabet = [
    " ",
    "·",
    "line",
    "lines",
    " ",
    "/",
    "a",
    "x.ts",
    "(",
    ")",
    '"',
    "'",
    "[",
    "]",
    "|",
    "1",
    "2-9",
    "-",
    "=",
    "<",
    ">",
    "{",
    "}",
    "\t",
  ];
  return Array.from({ length: count }, () =>
    Array.from({ length: next() % 24 }, () => alphabet[next() % alphabet.length]).join(""),
  );
}

describe("CLAUDE_LINES_RE's lookbehind", () => {
  it("matches exactly what the pattern without it matched", () => {
    const known = [
      "Read(/src/x.ts · lines 180-299)",
      "Edit(/src/foo.ts · line 42)",
      "foo=/p/x.ts · line 3",
      '"quoted/x.ts · line 7"',
      "'single/x.ts · line 8'",
      "<angle/x.ts · line 1>",
      "(paren/x.ts · line 2)",
      "{brace/x.ts · line 3}",
      "a>gt/x.ts · line 4",
      "f()close/x.ts · line 5",
      "{}brace/x.ts · line 6",
      "[a/b.ts · lines 1-2] and {c.ts · line 4}",
      "x.ts·line 1",
      "a|b.ts · line 9",
      "  leading/x.ts · lines 5",
    ];
    for (const line of [...known, ...lines(3000)]) {
      expect(matches(CLAUDE_LINES_RE, line), line).toEqual(matches(BEFORE, line));
    }
  });

  it("is the pattern the parser uses", () => {
    expect(detectFilePathLinks("Read(/src/x.ts · lines 180-299)", "posix")).toEqual([
      expect.objectContaining({ path: "/src/x.ts", line: 180 }),
    ]);
  });

  it("scans a long token with no separator after it in linear time", () => {
    // Without the lookbehind each call took about 6 ms on this line; with it,
    // well under a tenth of a millisecond.
    const line = "QUJD".repeat(500);
    const start = performance.now();
    for (let i = 0; i < 30; i++) {
      expect(detectFilePathLinks(line, "posix")).toEqual([]);
    }
    expect(performance.now() - start).toBeLessThan(60);
  });
});
