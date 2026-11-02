// src/worktree/folderRepoMemo.ts — Which repository each workspace folder is in,
// remembered while the `.git` that answers it is unchanged.
//
// Every whole-tree rebuild resolved every workspace folder again: a
// `git rev-parse --show-toplevel` and a `--git-common-dir`, two processes per
// folder per rebuild, for an answer that changes only when a repository is
// created, removed or moved. The answer is kept here under a stamp of the
// `.git` entry git would find from the folder — the first one walking up from
// its real path:
//
//   - a `.git` directory: its inode and its `HEAD` file (a repository created
//     in place, or a broken one repaired, rewrites `HEAD`). Not the directory's
//     own mtime, which most git commands move with a lock file;
//   - a `.git` file (a linked worktree or submodule): its stat, since its
//     content is the pointer;
//   - none found: its absence, so `git init` in the folder or above it is seen.
//
// Taking the stamp is a realpath and a stat per folder level — far cheaper than
// two git processes. A stamp that cannot be taken (a level that cannot be
// stat'ed for a reason other than absence) remembers nothing, and an answer git
// failed to give is never remembered.

import type { Stats } from "node:fs";
import * as path from "node:path";

/** What git said about one folder: its top level and common dir, or no repository. */
export type FolderRepoAnswer = { kind: "absent" } | { kind: "resolved"; root: string; commonDir: string };

export interface FolderRepoMemo {
  /** The stamp to file an answer for `folder` under; `null` when none can be taken. */
  stampOf(folder: string): Promise<string | null>;
  recall(folder: string, stamp: string): FolderRepoAnswer | undefined;
  remember(folder: string, stamp: string, answer: FolderRepoAnswer): void;
}

export interface FolderRepoMemoDeps {
  realpath(p: string): Promise<string>;
  stat(p: string): Promise<Stats>;
  /** Folders remembered before the least recently used is dropped. */
  maxFolders?: number;
}

/** Folders remembered by default — far more than any window opens. */
export const MAX_REMEMBERED_FOLDERS = 256;

function isAbsence(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

export function createFolderRepoMemo(deps: FolderRepoMemoDeps): FolderRepoMemo {
  const maxFolders = deps.maxFolders ?? MAX_REMEMBERED_FOLDERS;
  const answers = new Map<string, { stamp: string; answer: FolderRepoAnswer }>();

  const statOrNull = async (p: string): Promise<Stats | null> => {
    try {
      return await deps.stat(p);
    } catch (err) {
      if (isAbsence(err)) {
        return null;
      }
      throw err;
    }
  };
  const signature = (s: Stats | null): string => (s ? `${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}` : "-");

  return {
    async stampOf(folder) {
      try {
        let level = await deps.realpath(folder);
        for (;;) {
          const dotGit = path.join(level, ".git");
          const entry = await statOrNull(dotGit);
          if (entry?.isDirectory()) {
            return `dir ${dotGit} ${entry.ino} ${signature(await statOrNull(path.join(dotGit, "HEAD")))}`;
          }
          if (entry) {
            return `file ${dotGit} ${signature(entry)}`;
          }
          const parent = path.dirname(level);
          if (parent === level) {
            return "none";
          }
          level = parent;
        }
      } catch {
        return null;
      }
    },

    recall(folder, stamp) {
      const known = answers.get(folder);
      if (known?.stamp !== stamp) {
        return undefined;
      }
      answers.delete(folder);
      answers.set(folder, known);
      return known.answer;
    },

    remember(folder, stamp, answer) {
      answers.delete(folder);
      answers.set(folder, { stamp, answer });
      if (answers.size > maxFolders) {
        answers.delete(answers.keys().next().value as string);
      }
    },
  };
}
