// src/utils/shellEscape.test.ts — `escapePathForShell` must name the same file.
//
// The exact-string cases pin the quoting form. The real-shell cases are the
// ones that matter: each path is quoted, handed to sh / bash / zsh, and the
// word the shell reads back must be the original path byte for byte. The old
// helper's own tests asserted that `C#` became `C` and `\` became `\\` — they
// checked the output against itself, never against a shell.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { escapePathForShell, quotePathForShell, quotePathsForShell, shellKindOf } from "./shellEscape";

describe("escapePathForShell", () => {
  it("single-quotes a plain path", () => {
    expect(escapePathForShell("/Users/alice/code/main.ts")).toBe("'/Users/alice/code/main.ts'");
  });

  it("single-quotes a path containing spaces", () => {
    expect(escapePathForShell("/Users/alice/My Documents/notes.md")).toBe("'/Users/alice/My Documents/notes.md'");
  });

  it("writes an embedded single quote as '\\''", () => {
    expect(escapePathForShell("/tmp/can't-touch-this.txt")).toBe("'/tmp/can'\\''t-touch-this.txt'");
  });

  it("handles single AND double quotes with the same single-quote form", () => {
    expect(escapePathForShell(`/tmp/it's "complicated".log`)).toBe(`'/tmp/it'\\''s "complicated".log'`);
  });

  // The reported corruptions: each of these used to name a different file.
  it.each([
    ["/proj/C#/notes.md", "'/proj/C#/notes.md'"],
    ["report$1.txt", "'report$1.txt'"],
    [String.raw`/x/a\b`, String.raw`'/x/a\b'`],
    ["/Users/me/file$(echo evil).txt", "'/Users/me/file$(echo evil).txt'"],
    ["/tmp/a`b`|c&d>e~f!g^h*i;j<k", "'/tmp/a`b`|c&d>e~f!g^h*i;j<k'"],
  ])("keeps every character of %s, quoted rather than removed", (input, expected) => {
    expect(escapePathForShell(input)).toBe(expected);
  });

  it("leaves a Windows path's backslashes single, which PowerShell reads literally", () => {
    expect(escapePathForShell(String.raw`C:\Users\me\My Docs\a.txt`)).toBe(String.raw`'C:\Users\me\My Docs\a.txt'`);
  });

  it("writes control characters as \\xHH inside $'...' so none reaches the PTY raw", () => {
    const out = escapePathForShell("/tmp/a\u001b[31mb\nc\u0003d\u007f'e\\f");
    expect(out).toBe(String.raw`$'/tmp/a\x1b[31mb\x0ac\x03d\x7f\'e\\f'`);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting their absence
    expect(out).not.toMatch(/[\u0000-\u001f\u007f]/);
  });
});

// ─── Round trip through real shells ─────────────────────────────────

/** What a shell reads back from `printf '%s\0' <quoted>` — one NUL per word. */
function readBack(shell: string, quoted: string): string {
  const result = spawnSync(shell, ["-c", `printf '%s\\0' ${quoted}`], {
    encoding: "utf8",
    env: { PATH: "/usr/bin:/bin" },
  });
  if (result.status !== 0) {
    throw new Error(`${shell} exited ${result.status}: ${result.stderr}`);
  }
  return result.stdout;
}

const PLAIN_PATHS = [
  "/proj/C#/notes.md",
  "/tmp/report$1.txt",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: a literal `${...}` the shell must not expand
  "/tmp/$HOME and ${PATH}",
  String.raw`/x/a\b`,
  String.raw`/x/trailing\\`,
  "/Users/me/file$(touch /tmp/portaterm-pwned).txt",
  "/tmp/a`id`b",
  "/tmp/a|b&c>d<e;f",
  "~/not-home",
  "/tmp/#hash at start",
  "/tmp/glob*?[ab]",
  "/tmp/bang!history!!",
  "/tmp/caret^x",
  "/tmp/can't",
  `/tmp/it's "complicated".log`,
  "/tmp/'''",
  "/tmp/  two  spaces  ",
  "/tmp/ünïcødé/日本語",
];

const CONTROL_PATHS = [
  "/tmp/new\nline",
  "/tmp/esc\u001b[31mred",
  "/tmp/ctrl\u0003c\u0015u",
  "/tmp/tab\there",
  "/tmp/del\u007f'q\\",
];

const isPosix = process.platform !== "win32";
const shellsFor = (candidates: string[]) => candidates.filter((s) => isPosix && existsSync(s));

describe("escapePathForShell round-trips through a real shell", () => {
  // `sh` may be dash, which has no `$'...'`; it only gets the plain paths.
  const plainShells = shellsFor(["/bin/sh", "/bin/bash", "/bin/zsh", "/usr/bin/zsh"]);
  const ansiShells = shellsFor(["/bin/bash", "/bin/zsh", "/usr/bin/zsh"]);

  it.skipIf(plainShells.length === 0)("reads every plain path back as exactly one, unchanged word", () => {
    for (const shell of plainShells) {
      for (const p of PLAIN_PATHS) {
        expect({ shell, word: readBack(shell, escapePathForShell(p)) }).toEqual({ shell, word: `${p}\0` });
      }
    }
  });

  it.skipIf(ansiShells.length === 0)("reads every control-character path back unchanged", () => {
    for (const shell of ansiShells) {
      for (const p of CONTROL_PATHS) {
        expect({ shell, word: readBack(shell, escapePathForShell(p)) }).toEqual({ shell, word: `${p}\0` });
      }
    }
  });

  it.skipIf(plainShells.length === 0)("keeps several quoted paths as separate words, as the callers join them", () => {
    const paths = ["/a b/c#", "/d$e", "/f'g"];
    for (const shell of plainShells) {
      expect(readBack(shell, paths.map(escapePathForShell).join(" "))).toBe(paths.map((p) => `${p}\0`).join(""));
    }
  });
});

// ─── Per-shell quoting ──────────────────────────────────────────────

const BS = "\\"; // one backslash, spelled once so the cases below stay readable

describe("shellKindOf", () => {
  it.each([
    ["/bin/zsh", "posix"],
    ["/bin/bash", "posix"],
    ["/usr/bin/fish", "fish"],
    ["/opt/homebrew/bin/pwsh", "powershell"],
    [`C:${BS}Program Files${BS}PowerShell${BS}7${BS}pwsh.exe`, "powershell"],
    [`C:${BS}Windows${BS}System32${BS}WindowsPowerShell${BS}v1.0${BS}powershell.exe`, "powershell"],
    ["cmd.exe", "cmd"],
    [`C:${BS}Windows${BS}System32${BS}CMD.EXE`, "cmd"],
    ["claude", "posix"],
    [undefined, "posix"],
  ])("reads %s as %s", (shell, kind) => {
    expect(shellKindOf(shell)).toBe(kind);
  });
});

describe("quotePathForShell", () => {
  it("cmd: double quotes, so a path with spaces stays one word (single quotes are literal there)", () => {
    const p = `C:${BS}Program Files${BS}a.txt`;
    expect(quotePathForShell(p, "cmd")).toBe(`"${p}"`);
  });

  it("powershell: a quote is doubled, typographic quotes too — `'\\''` left the string open", () => {
    expect(quotePathForShell(`C:${BS}Users${BS}O'Brien${BS}x`, "powershell")).toBe(`'C:${BS}Users${BS}O''Brien${BS}x'`);
    expect(quotePathForShell("C:/a\u2019b", "powershell")).toBe("'C:/a\u2019\u2019b'");
    expect(quotePathForShell("/tmp/$x `y`", "powershell")).toBe("'/tmp/$x `y`'");
  });

  it("fish: backslash and quote escaped inside the quotes, controls written outside them", () => {
    expect(quotePathForShell(`/x/a${BS}${BS}b`, "fish")).toBe(`'/x/a${BS}${BS}${BS}${BS}b'`);
    expect(quotePathForShell("/x/it's", "fish")).toBe(`'/x/it${BS}'s'`);
    expect(quotePathForShell(`/x/trailing${BS}`, "fish")).toBe(`'/x/trailing${BS}${BS}'`);
    expect(quotePathForShell("/x/a\u001bb", "fish")).toBe(`'/x/a'${BS}x1b'b'`);
  });

  it("posix: the same as escapePathForShell", () => {
    for (const p of ["/a b", "/it's", "/a\u001bb"]) {
      expect(quotePathForShell(p, "posix")).toBe(escapePathForShell(p));
    }
  });

  it("joins several paths for the pane's shell with a trailing space", () => {
    expect(quotePathsForShell([`C:${BS}a b`, `C:${BS}c`], "cmd.exe")).toBe(`"C:${BS}a b" "C:${BS}c" `);
    expect(quotePathsForShell(["/a b"], "/bin/zsh")).toBe("'/a b' ");
  });
});

describe("quotePathForShell round-trips through fish and PowerShell where they are installed", () => {
  const find = (names: string[]) => names.find((n) => isPosix && existsSync(n));
  const fish = find(["/opt/homebrew/bin/fish", "/usr/local/bin/fish", "/usr/bin/fish"]);
  const pwsh = find(["/opt/homebrew/bin/pwsh", "/usr/local/bin/pwsh", "/usr/bin/pwsh"]);
  const paths = ["/tmp/a b", "/tmp/it's", `/tmp/a${BS}${BS}b${BS}`, "/tmp/$HOME `x` #y", "/tmp/a\u2019b"];

  it.skipIf(fish === undefined)("fish reads every path back unchanged", () => {
    for (const p of [...paths, "/tmp/esc\u001b[31m"]) {
      const out = spawnSync(fish as string, ["-c", `printf '%s\\0' ${quotePathForShell(p, "fish")}`], {
        encoding: "utf8",
      });
      expect(out.stdout).toBe(`${p}\0`);
    }
  });

  it.skipIf(pwsh === undefined)("PowerShell reads every path back unchanged", () => {
    for (const p of paths) {
      const script = `[Console]::Write(${quotePathForShell(p, "powershell")})`;
      const out = spawnSync(pwsh as string, ["-NoProfile", "-Command", script], { encoding: "utf8" });
      expect(out.stdout).toBe(p);
    }
  });
});
