// src/worktree/debrisClassification.ts — Is this destination crash debris?
// See: asimov/changes/clear-crash-debris-under-an-explicit-authorization/design.md D1
//
// Debris is a directory that is deliberately NOT a git checkout — the half-made
// worktree whose registration never landed. It is the one destination a create
// may delete (worktree-create.md § 2.2), so what separates it from a checkout is
// load-bearing rather than cosmetic.
//
// Absence from git's listing is NOT that separator, which is what this module
// exists to correct. A checkout whose administrative entry was pruned is also
// unregistered, and it holds the work WT-012.15 re-registers.

import { lstatSync } from "node:fs";
import * as path from "node:path";
import type { ResolvedDisposition } from "../types/messages";

/**
 * What is at a path, WITHOUT resolving it.
 *
 * Three answers, not two: "could not tell" is its own case because it is the one
 * that must not be collapsed into "absent". A `.git` behind a directory this
 * process cannot read is still a `.git`.
 */
export type GitEntryProbe = (p: string) => "present" | "absent" | "unknown";

/**
 * `lstat`, never `exists`. `existsSync` follows the link, so a `.git` symlink
 * whose target is gone reads as absent — and that reading would classify a
 * checkout as debris and offer to delete it. What matters here is whether the
 * ENTRY is there, not whether it resolves.
 */
export const probeGitEntry: GitEntryProbe = (p) => {
  try {
    lstatSync(p);
    return "present";
  } catch (error) {
    return (error as NodeJS.ErrnoException | null)?.code === "ENOENT" ? "absent" : "unknown";
  }
};

/**
 * What the destination holds, for a candidate the caller has already decided is
 * worth asking about.
 *
 * Fails closed in both directions that are not a proven bare directory: a
 * registered path and an unreadable one are both reported `free`, because
 * `debris` is what authorizes a delete and neither reading earns one.
 */
export function classifyDestination(
  candidatePath: string,
  isRegistered: boolean,
  probe: GitEntryProbe = probeGitEntry,
): ResolvedDisposition {
  if (isRegistered) {
    return { kind: "free" };
  }
  return probe(path.join(candidatePath, ".git")) === "absent" ? { kind: "debris" } : { kind: "free" };
}

/** What `findRepositoryWithin` found beneath a directory. `at` is relative to it. */
export type RepositoryScan = { kind: "none" } | { kind: "repository" | "unknown"; at: string } | { kind: "too-large" };

/**
 * How many entries a scan reads before it gives up. Debris is a half-made
 * checkout; a tree larger than this is not what debris looks like, and an
 * unverified recursive delete of it is not one to take.
 */
export const MAX_DEBRIS_SCAN_ENTRIES = 20_000;

type ScanLstat = (p: string) => { isDirectory(): boolean; isSymbolicLink(): boolean } | null;

/**
 * Is there a repository anywhere beneath `dir` — `dir` included?
 *
 * The removal is recursive, so a `.git` probe on `dir` alone is not enough: a
 * parent folder whose descendant is a checkout (this repo's main worktree, a
 * sibling clone two levels down) has no `.git` of its own and reads as debris.
 * Every level is walked, breadth first, without following symlinks (the
 * removal does not follow them either). A repository is:
 *
 * - any `.git` entry below `dir` — a directory (a clone), a file (a linked
 *   worktree or submodule), or a symlink;
 * - a bare layout — `HEAD` file, `objects/` and `refs/` directories — which is
 *   also what a `--separate-git-dir` common dir looks like.
 *
 * Fails closed: an entry that cannot be read is `unknown`, and a tree past
 * `maxEntries` is `too-large`; neither authorizes a delete. SYNC, like every
 * reading the delete boundary takes (clearDebris.ts). `rootEntries`, when
 * given, is the listing of `dir` the caller already took and compared.
 */
export function findRepositoryWithin(
  dir: string,
  lstat: ScanLstat,
  readdir: (p: string) => readonly string[] | null,
  options: { rootEntries?: readonly string[]; maxEntries?: number } = {},
): RepositoryScan {
  const maxEntries = options.maxEntries ?? MAX_DEBRIS_SCAN_ENTRIES;
  const relative = (p: string): string => path.relative(dir, p) || ".";
  const queue: string[] = [dir];
  let read = 0;
  while (queue.length > 0) {
    const current = queue.shift() as string;
    const entries = current === dir && options.rootEntries ? options.rootEntries : readdir(current);
    if (entries === null) {
      return { kind: "unknown", at: relative(current) };
    }
    const kinds = new Map<string, { isDirectory(): boolean; isSymbolicLink(): boolean }>();
    for (const entry of entries) {
      read += 1;
      if (read > maxEntries) {
        return { kind: "too-large" };
      }
      const child = path.join(current, entry);
      const stat = lstat(child);
      if (stat === null) {
        return { kind: "unknown", at: relative(child) };
      }
      if (entry === ".git") {
        return { kind: "repository", at: relative(current) };
      }
      kinds.set(entry, stat);
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        queue.push(child);
      }
    }
    if (isBareLayout(kinds)) {
      return { kind: "repository", at: relative(current) };
    }
  }
  return { kind: "none" };
}

function isBareLayout(kinds: ReadonlyMap<string, { isDirectory(): boolean; isSymbolicLink(): boolean }>): boolean {
  const dirNamed = (name: string) => {
    const k = kinds.get(name);
    return k?.isDirectory() === true && !k.isSymbolicLink();
  };
  const head = kinds.get("HEAD");
  return head !== undefined && !head.isDirectory() && dirNamed("objects") && dirNamed("refs");
}
