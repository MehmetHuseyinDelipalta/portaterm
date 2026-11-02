// src/worktree/folderRepoMemo.test.ts — the stamp a folder's repository answer is
// kept under, on real directories, and how answers are kept (perf C7).

import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFolderRepoMemo, MAX_REMEMBERED_FOLDERS } from "./folderRepoMemo";

let root: string;
let clock = 1_700_000_000;

function touch(file: string, content = "x"): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  clock += 10;
  fs.utimesSync(file, clock, clock);
}

const realMemo = (overrides: Partial<Parameters<typeof createFolderRepoMemo>[0]> = {}) =>
  createFolderRepoMemo({ realpath: (p) => fsp.realpath(p), stat: (p) => fsp.stat(p), ...overrides });

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "folder-repo-memo-")));
  fs.mkdirSync(path.join(root, "repo", ".git"), { recursive: true });
  touch(path.join(root, "repo", ".git", "HEAD"), "ref: refs/heads/main\n");
  fs.mkdirSync(path.join(root, "repo", "packages", "api"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("FolderRepoMemo.stampOf", () => {
  it("names the .git directory found walking up, and stays put while git only takes a lock in it", async () => {
    const memo = realMemo();
    const folder = path.join(root, "repo", "packages", "api");
    const stamp = await memo.stampOf(folder);
    expect(stamp).toMatch(new RegExp(`^dir ${path.join(root, "repo", ".git")} \\d+ `));
    touch(path.join(root, "repo", ".git", "index.lock"));
    fs.rmSync(path.join(root, "repo", ".git", "index.lock"));
    clock += 10;
    fs.utimesSync(path.join(root, "repo", ".git"), clock, clock);
    expect(await memo.stampOf(folder)).toBe(stamp);
  });

  it("changes when HEAD is rewritten", async () => {
    const memo = realMemo();
    const folder = path.join(root, "repo");
    const stamp = await memo.stampOf(folder);
    touch(path.join(root, "repo", ".git", "HEAD"), "ref: refs/heads/other\n");
    expect(await memo.stampOf(folder)).not.toBe(stamp);
  });

  it("changes when HEAD is replaced by another file with the same size and times", async () => {
    let ino = 0;
    const memo = realMemo({
      stat: async (p) => {
        const real = await fsp.stat(p);
        return p.endsWith("HEAD") ? Object.assign(real, { ino: real.ino + ino }) : real;
      },
    });
    const folder = path.join(root, "repo");
    const stamp = await memo.stampOf(folder);
    ino = 1;
    expect(await memo.stampOf(folder)).not.toBe(stamp);
  });

  it("changes when the .git directory is replaced", async () => {
    const memo = realMemo();
    const folder = path.join(root, "repo");
    const stamp = await memo.stampOf(folder);
    fs.renameSync(path.join(root, "repo", ".git"), path.join(root, "old-git"));
    fs.mkdirSync(path.join(root, "repo", ".git"));
    fs.renameSync(path.join(root, "old-git", "HEAD"), path.join(root, "repo", ".git", "HEAD"));
    expect(await memo.stampOf(folder)).not.toBe(stamp);
  });

  it("uses a .git file's stat, so a rewritten pointer changes it", async () => {
    const memo = realMemo();
    const wt = path.join(root, "wt");
    touch(path.join(wt, ".git"), "gitdir: /somewhere\n");
    const stamp = await memo.stampOf(wt);
    expect(stamp).toMatch(new RegExp(`^file ${path.join(wt, ".git")} `));
    touch(path.join(wt, ".git"), "gitdir: /elsewhere\n");
    expect(await memo.stampOf(wt)).not.toBe(stamp);
  });

  it("says none outside any repository, and changes once one is created", async () => {
    const memo = realMemo();
    const plain = path.join(root, "plain");
    fs.mkdirSync(plain);
    expect(await memo.stampOf(plain)).toBe("none");
    fs.mkdirSync(path.join(plain, ".git"));
    expect(await memo.stampOf(plain)).not.toBe("none");
  });

  it("marks a .git directory without HEAD", async () => {
    const memo = realMemo();
    const bare = path.join(root, "bare");
    fs.mkdirSync(path.join(bare, ".git"), { recursive: true });
    expect(await memo.stampOf(bare)).toMatch(/ -$/);
  });

  it("walks up from the folder's real path, not its spelling", async () => {
    const memo = realMemo();
    const link = path.join(root, "link");
    fs.symlinkSync(path.join(root, "repo", "packages"), link);
    expect(await memo.stampOf(link)).toBe(await memo.stampOf(path.join(root, "repo")));
  });

  it("takes no stamp for a folder that is gone", async () => {
    expect(await realMemo().stampOf(path.join(root, "missing"))).toBeNull();
  });

  it("takes no stamp when a level cannot be looked at", async () => {
    const memo = realMemo({
      stat: async (p) => {
        if (p === path.join(root, "repo", "packages", ".git")) {
          throw Object.assign(new Error("denied"), { code: "EACCES" });
        }
        return fsp.stat(p);
      },
    });
    expect(await memo.stampOf(path.join(root, "repo", "packages"))).toBeNull();
  });

  it("looks past a level whose .git path runs through a file", async () => {
    const memo = realMemo();
    touch(path.join(root, "repo", "file.txt"));
    // `<file>/.git` fails with ENOTDIR: no .git there, keep walking.
    expect(await memo.stampOf(path.join(root, "repo", "file.txt"))).toBe(await memo.stampOf(path.join(root, "repo")));
  });
});

describe("FolderRepoMemo answers", () => {
  const answer = { kind: "resolved" as const, root: "/r", commonDir: "/r/.git" };

  it("recalls an answer only under the stamp it was remembered under", () => {
    const memo = realMemo();
    memo.remember("/f", "s1", answer);
    expect(memo.recall("/f", "s1")).toEqual(answer);
    expect(memo.recall("/f", "s2")).toBeUndefined();
    expect(memo.recall("/g", "s1")).toBeUndefined();
  });

  it("drops the least recently used folder past its bound, a recalled one counting as used", () => {
    const memo = realMemo({ maxFolders: 2 });
    memo.remember("/a", "s", answer);
    memo.remember("/b", "s", answer);
    memo.recall("/a", "s");
    memo.remember("/c", "s", answer);
    expect(memo.recall("/b", "s")).toBeUndefined();
    expect(memo.recall("/a", "s")).toEqual(answer);
    expect(memo.recall("/c", "s")).toEqual(answer);
  });

  it("keeps the newest answer for a folder remembered twice", () => {
    const memo = realMemo({ maxFolders: 2 });
    memo.remember("/a", "s", answer);
    memo.remember("/b", "s", answer);
    memo.remember("/a", "t", { kind: "absent" });
    memo.remember("/c", "s", answer); // drops /b, the least recently used
    expect(memo.recall("/a", "t")).toEqual({ kind: "absent" });
    expect(memo.recall("/b", "s")).toBeUndefined();
  });

  it("remembers 256 folders by default", () => {
    expect(MAX_REMEMBERED_FOLDERS).toBe(256);
  });
});
