// src/providers/gitIgnoreChecker.ts — The git subprocesses behind the file
// tree's gitignore dimming.
//
// VS Code's Explorer dims gitignored files. We mirror that behaviour by asking
// `git check-ignore -z --stdin` — git itself owns the rules (nested .gitignore,
// global excludes, .git/info/exclude, etc.), so we get correct results without
// re-implementing the matcher. `-z` puts both stdin and stdout in NUL-delimited
// mode so filenames containing `\n` (legal on POSIX) are handled correctly.
//
// Every spawn is bounded by a 1.5 s timeout. These functions only run git;
// `gitIgnoreCache.ts` decides when an answer is still good and when git has to
// be asked again.

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";

const TIMEOUT_MS = 1500;

/** Run `git <args>` in `cwd`; `null` when it could not start, timed out, or failed to spawn. */
function runGit(
  cwd: string,
  args: readonly string[],
  input: string,
): Promise<{ code: number | null; stdout: string } | null> {
  return new Promise((resolve) => {
    let proc: ChildProcessWithoutNullStreams;
    try {
      proc = spawn("git", [...args], { cwd, stdio: ["pipe", "pipe", "pipe"] });
    } catch {
      resolve(null);
      return;
    }

    let stdout = "";
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        // ignore
      }
      resolve(null);
    }, TIMEOUT_MS);

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    proc.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    // git can exit before reading stdin (not a repository: it exits 128 at
    // once), and the write below then fails with EPIPE. Without a listener that
    // is an uncaught exception; the `close` handler already decides the answer.
    proc.stdin.on("error", () => {});
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout });
    });

    proc.stdin.end(input);
  });
}

/**
 * The subset of `absolutePaths` git considers ignored, asked from `cwd` (whose
 * repository supplies the rules). `null` when git gave no answer — git missing,
 * not a repository, a timeout — so a caller can tell "nothing is ignored" from
 * "unknown" and never remember the latter.
 *
 * Caller MUST pass absolute paths.
 */
export async function checkIgnore(cwd: string, absolutePaths: readonly string[]): Promise<Set<string> | null> {
  if (absolutePaths.length === 0) {
    return new Set();
  }
  // NUL-terminate every path and close stdin so git starts processing.
  const result = await runGit(cwd, ["check-ignore", "-z", "--stdin"], `${absolutePaths.join("\0")}\0`);
  // Exit code 0 = some paths matched ignore rules.
  // Exit code 1 = no paths matched (NOT an error).
  // Any other code = real error (git missing, not a repo, etc.).
  if (!result || (result.code !== 0 && result.code !== 1)) {
    return null;
  }
  const ignored = new Set<string>();
  for (const entry of result.stdout.split("\0")) {
    if (entry) {
      ignored.add(entry);
    }
  }
  return ignored;
}

/**
 * The `core.excludesFile` git would use from `cwd`, `~` expanded: a path, `null`
 * when the setting is unset, `undefined` when git gave no answer.
 */
export async function readExcludesFileSetting(cwd: string): Promise<string | null | undefined> {
  const result = await runGit(cwd, ["config", "--path", "--get", "core.excludesFile"], "");
  if (!result) {
    return undefined;
  }
  if (result.code === 0) {
    return result.stdout.trim() || null;
  }
  // 1 = the key is unset; anything else is git failing (e.g. 128, not a repository).
  return result.code === 1 ? null : undefined;
}
