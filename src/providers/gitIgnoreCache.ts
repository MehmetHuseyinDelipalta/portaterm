// src/providers/gitIgnoreCache.ts — Remember what `git check-ignore` said, for
// as long as nothing it read has changed.
//
// Every directory listing the file tree shows asks git which of its entries are
// ignored, and a window-focus rehydrate re-lists the root and every expanded
// folder in every tree host — one `git` process per folder, per host, per
// alt-tab, for an answer that almost never changes. The answers are kept here,
// per directory, under a stamp of every file git reads to reach them:
//
//   - the `.gitignore` of the directory and of each ancestor up to the
//     repository top (and any `.git` between them: a repository nested below
//     the top changes what the outer one sees);
//   - the repository's `.git`, index (`git check-ignore` reports no tracked
//     path), `info/exclude`, and config files;
//   - the global config files and the excludes file git uses — `core.excludesFile`
//     (asked of git once per repository, again only when a config file changes)
//     and the XDG default.
//
// A request re-stats those files (cheap, in parallel) and asks git only about
// entries it has no answer for under the current stamp. One file is not read:
// the system-wide gitconfig, whose location depends on how git was built.
//
// The stamp is taken before git is asked, so a rule that changes while git runs
// leaves a stamp that no longer matches, never a stale answer under a new one.

import type { Stats } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { checkIgnore, readExcludesFileSetting } from "./gitIgnoreChecker";

/** One path to classify. */
export interface IgnoreQuery {
  /** Absolute path. */
  readonly path: string;
  /**
   * What the path is, as the caller knows it (any stable token). Part of the
   * remembered answer's key: `build/` ignores a directory named `build`, not a
   * file of that name, so a file replaced by a directory is asked about again.
   */
  readonly kind: string;
}

export interface GitIgnoreCache {
  /**
   * The paths among `queries` that git, run from `cwd`, considers ignored. An
   * empty set when `cwd` is in no repository, or when git gives no answer (that
   * outcome is not remembered).
   */
  getIgnoredPaths(cwd: string, queries: readonly IgnoreQuery[]): Promise<Set<string>>;
}

export interface GitIgnoreCacheDeps {
  /** `git check-ignore` from `cwd`; `null` when git gave no answer. */
  checkIgnore(cwd: string, paths: readonly string[]): Promise<Set<string> | null>;
  /** `core.excludesFile` from `cwd`: a path, `null` when unset, `undefined` when git gave no answer. */
  readExcludesFileSetting(cwd: string): Promise<string | null | undefined>;
  /** Home directory: `~/.gitconfig`, and the XDG fallback. */
  readonly homeDir: string;
  /** `$XDG_CONFIG_HOME`, when set. */
  readonly xdgConfigHome: string | undefined;
  /** Directories (and repositories) remembered before the least recently used is dropped. */
  readonly maxEntries?: number;
}

/** Directories remembered by default — far more than any tree shows at once. */
export const MAX_CACHED_DIRECTORIES = 4096;

interface DirectoryAnswers {
  readonly stamp: string;
  /** `answerKey(query)` → ignored. */
  readonly answers: Map<string, boolean>;
}

interface ExcludesFileLookup {
  readonly configStamp: string;
  readonly value: Promise<string | null | undefined>;
}

function answerKey(query: IgnoreQuery): string {
  return `${query.path}\0${query.kind}`;
}

/** Insert `key` as the most recently used, dropping the least recently used past `max`. */
function remember<V>(map: Map<string, V>, key: string, value: V, max: number): void {
  map.delete(key);
  map.set(key, value);
  if (map.size > max) {
    map.delete(map.keys().next().value as string);
  }
}

async function readText(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
}

export function createGitIgnoreCache(deps: GitIgnoreCacheDeps): GitIgnoreCache {
  const maxEntries = deps.maxEntries ?? MAX_CACHED_DIRECTORIES;
  const configHome = deps.xdgConfigHome || path.join(deps.homeDir, ".config");
  /** `${repoTop}\0${directory}` → answers. */
  const directories = new Map<string, DirectoryAnswers>();
  /** repository top → its `core.excludesFile`, as of a config stamp. */
  const excludesFiles = new Map<string, ExcludesFileLookup>();
  /** A git run another request is already waiting on, by what it asks. */
  const inFlight = new Map<string, Promise<Set<string> | null>>();

  function excludesFileFor(top: string, configStamp: string): Promise<string | null | undefined> {
    const known = excludesFiles.get(top);
    if (known?.configStamp === configStamp) {
      return known.value;
    }
    const lookup: ExcludesFileLookup = { configStamp, value: deps.readExcludesFileSetting(top) };
    remember(excludesFiles, top, lookup, maxEntries);
    void lookup.value.then((value) => {
      // No answer is not an answer: ask again next time.
      if (value === undefined && excludesFiles.get(top) === lookup) {
        excludesFiles.delete(top);
      }
    });
    return lookup.value;
  }

  /**
   * Share one git run between requests asking about the same paths under the
   * same stamps. Equal stamps name the same repository (they include its `.git`
   * entry's inode), so the answer does not depend on which `cwd` asked.
   */
  function askGit(cwd: string, stamps: readonly string[], paths: readonly string[]): Promise<Set<string> | null> {
    const key = `${stamps.join("\n")}\0${paths.join("\0")}`;
    const running = inFlight.get(key);
    if (running) {
      return running;
    }
    const run = deps.checkIgnore(cwd, paths).finally(() => inFlight.delete(key));
    inFlight.set(key, run);
    return run;
  }

  async function getIgnoredPaths(cwd: string, queries: readonly IgnoreQuery[]): Promise<Set<string>> {
    const ignored = new Set<string>();
    if (queries.length === 0) {
      return ignored;
    }

    // Each file is stat'ed at most once per request.
    const stats = new Map<string, Promise<Stats | null>>();
    const statOnce = (file: string): Promise<Stats | null> => {
      let stat = stats.get(file);
      if (!stat) {
        stat = fs.stat(file).catch(() => null);
        stats.set(file, stat);
      }
      return stat;
    };
    // Any one field changing is enough: an editor's atomic save swaps the inode,
    // a coarse (1–2 s) clock can leave both times equal across two writes that
    // change the size, and a tool that restores the mtime still moves the ctime.
    const signature = async (file: string): Promise<string> => {
      const stat = await statOnce(file);
      return stat ? `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}` : "-";
    };

    // The repository git finds from `cwd`: the nearest ancestor holding `.git`.
    let top = cwd;
    let dotGit = await statOnce(path.join(top, ".git"));
    while (!dotGit) {
      const parent = path.dirname(top);
      if (parent === top) {
        return ignored; // no repository: git would answer nothing
      }
      top = parent;
      dotGit = await statOnce(path.join(top, ".git"));
    }

    // A linked worktree or submodule has a `.git` file naming its git dir; a
    // worktree's git dir names the common dir holding `info/` and `config`.
    let gitDir = path.join(top, ".git");
    if (!dotGit.isDirectory()) {
      // Read the way git reads it: `gitdir: <path>`, only line breaks trimmed.
      const text = (await readText(gitDir)) ?? "";
      const pointer = text.startsWith("gitdir: ") ? text.slice("gitdir: ".length).replace(/[\r\n]+$/, "") : "";
      if (!pointer) {
        return ignored; // git refuses a .git file it cannot follow, and answers nothing
      }
      gitDir = path.resolve(top, pointer);
    }
    const common = (await readText(path.join(gitDir, "commondir")))?.trim();
    const commonDir = common ? path.resolve(gitDir, common) : gitDir;

    const configStamp = (
      await Promise.all(
        [
          path.join(deps.homeDir, ".gitconfig"),
          path.join(configHome, "git", "config"),
          path.join(commonDir, "config"),
          path.join(gitDir, "config.worktree"),
        ].map(signature),
      )
    ).join("|");
    const excludesFile = await excludesFileFor(top, configStamp);
    const repoStamp = [
      configStamp,
      ...(await Promise.all(
        [
          path.join(top, ".git"),
          path.join(gitDir, "index"),
          path.join(commonDir, "info", "exclude"),
          path.join(configHome, "git", "ignore"),
          ...(excludesFile ? [excludesFile] : []),
        ].map(signature),
      )),
    ].join("|");

    const byDirectory = new Map<string, IgnoreQuery[]>();
    for (const query of queries) {
      const dir = path.dirname(query.path);
      const group = byDirectory.get(dir);
      if (group) {
        group.push(query);
      } else {
        byDirectory.set(dir, [query]);
      }
    }

    const misses: Array<{ query: IgnoreQuery; directory: DirectoryAnswers }> = [];
    await Promise.all(
      [...byDirectory].map(async ([dir, group]) => {
        // `.gitignore` of every level from `dir` up to the top, plus any `.git` below it.
        const files: string[] = [];
        for (let level = dir; ; ) {
          files.push(path.join(level, ".gitignore"));
          const parent = path.dirname(level);
          if (level === top || parent === level) {
            break;
          }
          files.push(path.join(level, ".git"));
          level = parent;
        }
        const stamp = `${repoStamp}#${(await Promise.all(files.map(signature))).join("|")}`;
        const key = `${top}\0${dir}`;
        const known = directories.get(key);
        const directory = known?.stamp === stamp ? known : { stamp, answers: new Map<string, boolean>() };
        remember(directories, key, directory, maxEntries);
        for (const query of group) {
          const answer = directory.answers.get(answerKey(query));
          if (answer === undefined) {
            misses.push({ query, directory });
          } else if (answer) {
            ignored.add(query.path);
          }
        }
      }),
    );
    if (misses.length === 0) {
      return ignored;
    }

    const stamps = [...new Set(misses.map((miss) => miss.directory.stamp))];
    const answer = await askGit(
      cwd,
      stamps,
      misses.map((miss) => miss.query.path),
    );
    if (!answer) {
      return ignored; // unknown, so shown undimmed and not remembered
    }
    for (const { query, directory } of misses) {
      const isIgnored = answer.has(query.path);
      directory.answers.set(answerKey(query), isIgnored);
      if (isIgnored) {
        ignored.add(query.path);
      }
    }
    return ignored;
  }

  return { getIgnoredPaths };
}

/** The one cache every tree host shares, so two hosts listing a folder ask git once. */
export const sharedGitIgnoreCache: GitIgnoreCache = createGitIgnoreCache({
  checkIgnore,
  readExcludesFileSetting,
  homeDir: os.homedir(),
  xdgConfigHome: process.env.XDG_CONFIG_HOME,
});
