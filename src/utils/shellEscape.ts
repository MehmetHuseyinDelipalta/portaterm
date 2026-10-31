// src/utils/shellEscape.ts — Quote a filesystem path as ONE shell word.
//
// Shared between the Extension Host ("Insert Path in Portaterm", OS drops) and
// the WebView (drag-and-drop). The result is typed into a live shell, so it
// must name exactly the file the user picked: a quoted path that the shell
// reads back as a different path points `rm` or an editor at the wrong file.
//
// Inside POSIX single quotes NOTHING is special, so the only character that
// needs handling is the single quote itself. This used to strip
// `` ` $ | & > ~ # ! ^ * ; < `` and double every backslash "for safety" —
// both unnecessary inside single quotes, and both turned real paths into
// different ones (`C#/notes.md` → `C/notes.md`, `a\b` → `a\\b`).

import { posixShellQuote } from "./posixShellQuote";

/** C0 controls and DEL — bytes that act as keystrokes when typed into a PTY. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point
const ANSI_C_ESCAPED = /[\\'\u0000-\u001f\u007f]/g;

/**
 * Quote `path` so a POSIX shell (sh, bash, zsh) reads it back byte for byte.
 *
 * - Ordinary paths → single-quoted, with `'` written as `'\''`. Every other
 *   byte — `$`, `` ` ``, `#`, `!`, `*`, `~`, `\`, spaces, double quotes —
 *   is literal inside single quotes.
 * - Paths holding a control character → ANSI-C `$'...'` with each control
 *   written as `\xHH`. The text is typed into a terminal, and a raw ESC, ^C or
 *   ^U there is a keystroke the line editor acts on, not part of the word.
 *
 * This is the POSIX form. Where the target shell is known, use
 * `quotePathForShell` — fish, PowerShell and cmd read quotes differently.
 */
export function escapePathForShell(path: string): string {
  if (!CONTROL_CHARS.test(path)) {
    return posixShellQuote(path);
  }
  const body = path.replace(ANSI_C_ESCAPED, (c) => {
    if (c === "\\") {
      return "\\\\";
    }
    if (c === "'") {
      return "\\'";
    }
    return `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`;
  });
  return `$'${body}'`;
}

/** The quoting families an inserted path has to be written for. */
export type ShellKind = "posix" | "fish" | "powershell" | "cmd";

/**
 * Which quoting `shellPath` reads, from its executable name. Anything not
 * recognised (bash, zsh, sh, dash, ksh — and agent CLIs, nu, xonsh) gets the
 * POSIX form, which is also what the line editors of those read.
 */
export function shellKindOf(shellPath: string | undefined): ShellKind {
  const base = (shellPath ?? "").replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
  const name = base.endsWith(".exe") ? base.slice(0, -4) : base;
  if (name === "fish") {
    return "fish";
  }
  if (name === "pwsh" || name === "powershell") {
    return "powershell";
  }
  if (name === "cmd") {
    return "cmd";
  }
  return "posix";
}

/** PowerShell reads the typographic single quotes as quotes too, so each is doubled like `'`. */
const POWERSHELL_QUOTES = /['\u2018\u2019\u201a\u201b]/g;

/**
 * Quote `path` as ONE word for a shell of `kind`, so it reads back as exactly
 * that path.
 *
 * - posix: `escapePathForShell`.
 * - fish: single quotes, where fish still honours `\\` and `\'` — so both are
 *   escaped; a control character is written outside the quotes as `\xHH`,
 *   which fish reads there (it has no `$'…'`).
 * - powershell: single quotes, a quote doubled (`''`), typographic ones too.
 * - cmd: double quotes. A Windows file name cannot contain `"`. Known limit:
 *   interactive cmd still expands `%NAME%` inside quotes when NAME is set, and
 *   there is no escape for it there.
 */
export function quotePathForShell(path: string, kind: ShellKind): string {
  switch (kind) {
    case "posix":
      return escapePathForShell(path);
    case "fish": {
      let out = "'";
      for (const c of path) {
        if (c === "\\" || c === "'") {
          out += `\\${c}`;
        } else if (CONTROL_CHARS.test(c)) {
          out += `'\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}'`;
        } else {
          out += c;
        }
      }
      return `${out}'`;
    }
    case "powershell":
      return `'${path.replace(POWERSHELL_QUOTES, (q) => q + q)}'`;
    case "cmd":
      return `"${path}"`;
  }
}

/** Several paths for one shell, space-separated with a trailing space — what an insert types. */
export function quotePathsForShell(paths: readonly string[], shellPath: string | undefined): string {
  const kind = shellKindOf(shellPath);
  return `${paths.map((p) => quotePathForShell(p, kind)).join(" ")} `;
}
