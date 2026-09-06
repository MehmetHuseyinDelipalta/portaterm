// src/pty/processTree.ts — Build a process tree from the OS process table and
// BFS-collect a pid's descendants. Used to find the `claude` node descendant of a
// terminal's pty so it can be matched to the running-session PID registry.
// See: design.md D4, D8; src/pty/processCwd.ts (OS-query precedent).
//
// The OS shell-out is split from the pure parse + BFS so the latter can be
// unit-tested on fixture text without spawning `ps`.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Hard cap on the `ps` shell-out so a hung/slow ps can't stall a click. */
export const PS_TIMEOUT_MS = 500;

/**
 * The header-less `pid ppid command` invocation for this platform, or
 * `undefined` where no process table is reachable (Windows and anything else).
 *
 *   macOS (BSD ps): `ps -axo pid=,ppid=,comm=`   Linux (procps): `ps -eo pid=,ppid=,comm=`
 *
 * `comm=` rides along in the SAME read the subtree walk already pays for, so
 * naming the application that hosts a session costs no extra `ps`. It is last
 * because it is the only column that can contain spaces.
 *
 * Exported so `processTableSnapshot.ts` shares one platform matrix with
 * `descendantPids`; two copies would drift the moment a platform is added.
 */
export function psTableArgs(platform: NodeJS.Platform): string[] | undefined {
  switch (platform) {
    case "darwin":
      return ["-axo", "pid=,ppid=,comm="];
    case "linux":
      return ["-eo", "pid=,ppid=,comm="];
    default:
      return undefined; // Windows / unsupported → no subtree
  }
}

/** One `ps` read, parsed: who is whose child, and what each pid is running. */
export interface ProcessRows {
  /** parent pid → its direct children. */
  children: Map<number, number[]>;
  /** pid → the executable path `ps` reported, absent when the line carried none. */
  command: Map<number, string>;
  /** pid → its parent. The inverse of `children`, kept because the owner walk goes UP. */
  parent: Map<number, number>;
}

/**
 * Parse `pid ppid [command]` lines. Pure.
 *
 * The command column is optional so a two-column table still parses: the
 * platform matrix asks for three, but a caller handed an older capture — or a
 * `ps` that omits it — degrades to no command rather than to no table.
 */
export function parseProcessRows(text: string): ProcessRows {
  const children = new Map<number, number[]>();
  const command = new Map<number, string>();
  const parent = new Map<number, number>();
  for (const line of text.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)(?:\s+(.*))?$/);
    if (!m) {
      continue; // header / blank / malformed line
    }
    const pid = Number(m[1]);
    const ppid = Number(m[2]);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) {
      continue;
    }
    const siblings = children.get(ppid);
    if (siblings) {
      siblings.push(pid);
    } else {
      children.set(ppid, [pid]);
    }
    parent.set(pid, ppid);
    const cmd = m[3]?.trim();
    if (cmd) {
      command.set(pid, cmd);
    }
  }
  return { children, command, parent };
}

/** Parse whitespace-separated `pid ppid` lines into a parent→children map. Pure. */
export function parseProcessTable(text: string): Map<number, number[]> {
  return parseProcessRows(text).children;
}

/**
 * How far up a process chain the search for an owning application goes.
 *
 * A pty's chain to its host app is a handful of links (agent → shell → login →
 * helper → app). The bound exists so a malformed table — a cycle `parseProcessRows`
 * did not create but `ps` could report — cannot spin here.
 */
const MAX_OWNER_HOPS = 24;

/**
 * The bundled application that owns `pid`, by walking up its ancestry, or
 * `undefined` when nothing on the way is inside one.
 *
 * The LEFTMOST `.app` on a path is the answer, not the nearest: a helper
 * process runs from `/Applications/Orca.app/Contents/Frameworks/Orca Helper.app/…`
 * and the user calls that Orca, not Orca Helper.
 *
 * macOS-shaped by construction. On Linux nothing carries a bundle and this
 * returns `undefined` everywhere, which is the honest answer there — the caller
 * says "outside this window" rather than inventing an owner.
 */
export function ownerAppOf(pid: number, rows: ProcessRows): string | undefined {
  let current = pid;
  for (let hop = 0; hop < MAX_OWNER_HOPS; hop++) {
    const bundle = /\/([^/]+)\.app\//.exec(rows.command.get(current) ?? "");
    if (bundle) {
      return bundle[1];
    }
    const next = rows.parent.get(current);
    // pid 1 (launchd/init) owns everything and names nothing; stopping there is
    // what keeps an unowned chain `undefined` rather than walking to the root.
    if (next === undefined || next === current || next <= 1) {
      return undefined;
    }
    current = next;
  }
  return undefined;
}

/** BFS-collect every descendant pid of `root` from a parent→children map. Pure. */
export function collectDescendants(root: number, table: Map<number, number[]>): number[] {
  const out: number[] = [];
  const seen = new Set<number>([root]);
  const queue: number[] = [root];
  while (queue.length > 0) {
    const current = queue.shift() as number;
    for (const child of table.get(current) ?? []) {
      if (seen.has(child)) {
        continue; // cycle guard — defensive; a real process table is a forest
      }
      seen.add(child);
      out.push(child);
      queue.push(child);
    }
  }
  return out;
}

/** Injectable IO surface — mirrors `ProcessCwdDeps` so tests avoid real `ps`. */
export interface ProcessTreeDeps {
  exec(file: string, args: string[], options: { timeout: number }): Promise<{ stdout: string; stderr: string }>;
  platform: NodeJS.Platform;
}

/** The real `ps` binding, shared with `processTableSnapshot.ts`. */
export const defaultProcessTreeDeps: ProcessTreeDeps = {
  exec: (file, args, options) =>
    execFileAsync(file, args, options).then(({ stdout, stderr }) => ({
      stdout: stdout.toString(),
      stderr: stderr.toString(),
    })),
  platform: process.platform,
};

/**
 * Return every descendant pid of `rootPid` on macOS/Linux. Returns `[]` for an
 * invalid pid, an unsupported platform (e.g. Windows), or any `ps` failure —
 * never throws.
 *
 * PREFER `createProcessTableSnapshot()` for anything that reasons about who owns
 * a session. The `[]` here answers "this pty holds nothing" and "we could not
 * look" identically, and a caller that cannot tell those apart will treat a
 * directory two processes happen to share as ownership — which is how a session
 * another application was running was drawn as this window's
 * (260906-at-session-owner-other-window). No production caller remains.
 */
export async function descendantPids(
  rootPid: number,
  deps: ProcessTreeDeps = defaultProcessTreeDeps,
): Promise<number[]> {
  if (!Number.isInteger(rootPid) || rootPid <= 0) {
    return [];
  }
  const args = psTableArgs(deps.platform);
  if (args === undefined) {
    return []; // Windows / unsupported → no subtree; cwd fallbacks take over
  }
  let stdout: string;
  try {
    ({ stdout } = await deps.exec("ps", args, { timeout: PS_TIMEOUT_MS }));
  } catch {
    return []; // ps missing / timed out / errored → empty subtree
  }
  return collectDescendants(rootPid, parseProcessTable(stdout));
}
