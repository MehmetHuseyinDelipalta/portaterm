// src/worktree/gitCommandRunner.ts — The one bounded seam every git call uses.
// See: asimov/changes/enumerate-git-worktrees/design.md D1
//
// stdout stays a Buffer because `worktree list -z` splits on NUL: decoding to a
// string first is what turns an unusually-encoded path into an unparseable one.

import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { messageOf } from "./errorMessage";

/** docs/DESIGN.md § 10 — git command timeout, read-only listings. */
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BUFFER_BYTES = 32 * 1024 * 1024;

export interface GitCommandResult {
  /** Exit code, or -1 when the process never produced one. */
  code: number;
  stdout: Buffer;
  stderr: string;
  timedOut: boolean;
  /** The executable could not be spawned — git absent or not executable. */
  failedToSpawn: boolean;
  /**
   * Set when the spawn failed because of the working directory, not the
   * executable. Node reports a missing `cwd` as ENOENT and one it may not
   * enter as EACCES — the same codes as a missing or non-executable git — so
   * without this a deleted or locked worktree folder read as "no usable git".
   * `missing`: not there, or not a directory. `unreadable`: there, but this
   * process cannot open it (or could not even look). `failedToSpawn` stays
   * true alongside it: it is still a command that never ran.
   */
  cwdProblem?: { path: string; kind: "missing" | "unreadable" };
}

/** Per-call overrides. Without these a mutation cannot have its own budget. */
export interface GitRunOptions {
  /**
   * Overrides the runner's construction-time timeout for THIS call.
   *
   * worktree-actions.md:267-269: "the 10 s timeout applies to read-only
   * listings. Mutations get a longer budget and a cancellable path where one
   * exists, because killing git mid-write is the thing that creates these
   * states in the first place." A per-runner constant cannot express that.
   */
  timeoutMs?: number;
  /**
   * Overrides the runner's construction-time output ceiling for THIS call.
   *
   * Same reason as `timeoutMs`, for the other resource: a read whose whole
   * point is that it must not hold an unbounded listing cannot say so through a
   * per-runner constant. Overflow kills the child and fails the command, which
   * is the answer a bounded read wants — it did not get to measure this tree.
   */
  maxBufferBytes?: number;
  /** Kills the child when it aborts. The cancellable path the authority asks for. */
  signal?: AbortSignal;
  /** Bytes written to stdin and then closed; required by commands such as `update-ref --stdin`. */
  input?: string | Buffer;
}

export interface GitCommandRunner {
  run(args: readonly string[], cwd: string, runOptions?: GitRunOptions): Promise<GitCommandResult>;
}

interface ExecFileFailure extends Error {
  code?: number | string;
  killed?: boolean;
}

export interface GitCommandRunnerOptions {
  executable?: string;
  timeoutMs?: number;
  maxBufferBytes?: number;
}

/**
 * A runner that resolves with the command's outcome and never rejects — a
 * failing git degrades one repository (spec: Confine a repository failure to
 * that repository) rather than propagating out of discovery.
 */
export function createGitCommandRunner(options: GitCommandRunnerOptions = {}): GitCommandRunner {
  const executable = options.executable ?? "git";
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBuffer = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;

  return {
    run(args, cwd, runOptions) {
      return new Promise<GitCommandResult>((resolve) => {
        const options = {
          cwd,
          timeout: runOptions?.timeoutMs ?? timeout,
          signal: runOptions?.signal,
          maxBuffer: runOptions?.maxBufferBytes ?? maxBuffer,
          encoding: "buffer" as const,
          // `repoRoots` tells a missing repository from a git that declined to
          // answer by matching git's own stderr, so the language it arrives in
          // cannot be the user's. PATH and the rest of the environment stay.
          env: { ...process.env, LC_ALL: "C", LANG: "C" },
        };
        let child: ReturnType<typeof execFile>;
        try {
          child = execFile(executable, [...args], options, onExit);
        } catch (err) {
          // Some spawn refusals throw instead of calling back — a `cwd` that is
          // a file throws ENOTDIR. The runner never rejects, so this is a
          // command that did not run, reported the way the callback would.
          const code = (err as NodeJS.ErrnoException).code;
          const spawnFailure: GitCommandResult = {
            code: -1,
            stdout: Buffer.alloc(0),
            stderr: messageOf(err),
            timedOut: false,
            failedToSpawn: true,
          };
          if (code === "ENOTDIR" || code === "ENOENT" || code === "EACCES") {
            resolveWithCwdCheck(spawnFailure);
          } else {
            resolve(spawnFailure);
          }
          return;
        }
        function onExit(error: Error | null, stdout: Buffer | string, stderr: Buffer | string): void {
          const out = Buffer.isBuffer(stdout) ? stdout : Buffer.alloc(0);
          const errText = (Buffer.isBuffer(stderr) ? stderr : Buffer.alloc(0)).toString();
          if (!error) {
            resolve({ code: 0, stdout: out, stderr: errText, timedOut: false, failedToSpawn: false });
            return;
          }
          const failure = error as ExecFileFailure;
          const overflowed = failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
          const result: GitCommandResult = {
            code: typeof failure.code === "number" ? failure.code : -1,
            stdout: out,
            stderr: errText || failure.message,
            // maxBuffer overflow also kills the child; that is not a timeout.
            // An abort kills it too, and reaches us as ABORT_ERR — reported as
            // killed rather than as a clean failure, because a killed mutation
            // has already changed an unknown amount of state (design.md D11).
            timedOut: !overflowed && (failure.killed === true || failure.code === "ABORT_ERR"),
            failedToSpawn: failure.code === "ENOENT" || failure.code === "EACCES" || failure.code === "EPERM",
          };
          if (failure.code !== "ENOENT" && failure.code !== "EACCES") {
            resolve(result);
            return;
          }
          resolveWithCwdCheck(result);
        }
        // ENOENT/ENOTDIR/EACCES name the executable OR the working directory.
        // Only on this failure path is the folder looked at, so a healthy call
        // pays nothing for the distinction.
        function resolveWithCwdCheck(failed: GitCommandResult): void {
          void diagnoseCwd(cwd).then((problem) =>
            resolve(problem === null ? failed : { ...failed, cwdProblem: { path: cwd, kind: problem } }),
          );
        }
        if (runOptions?.input !== undefined) {
          // A child can exit before the write completes; its command result is
          // still reported by the callback, so EPIPE must not escape the runner.
          child.stdin?.on("error", () => {});
          child.stdin?.end(runOptions.input);
        }
      });
    },
  };
}

/**
 * What is wrong with `cwd`, if anything: `missing` (absent or not a
 * directory), `unreadable` (there but not enterable, or not even
 * inspectable), or `null` when it is a usable directory — so the failure was
 * the executable's.
 */
async function diagnoseCwd(cwd: string): Promise<"missing" | "unreadable" | null> {
  try {
    if (!(await stat(cwd)).isDirectory()) {
      return "missing";
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR" ? "missing" : "unreadable";
  }
  try {
    await access(cwd, fsConstants.R_OK | fsConstants.X_OK);
    return null;
  } catch {
    return "unreadable";
  }
}
