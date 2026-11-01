// Real files in a temp directory — the stamp is made of their stats — with git
// itself faked, so each test counts exactly which paths git was asked about.

import { execFileSync } from "node:child_process";
import type { Stats } from "node:fs";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGitIgnoreCache, type GitIgnoreCacheDeps, type IgnoreQuery } from "./gitIgnoreCache";
import { checkIgnore, readExcludesFileSetting } from "./gitIgnoreChecker";

/** Stat fields a test pretends changed, by path. */
const statOverrides = new Map<string, Partial<Stats>>();
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    stat: vi.fn(async (file: string) => Object.assign(await actual.stat(file), statOverrides.get(file))),
  };
});

let root: string;
let home: string;
let repo: string;
let clock = 1_700_000_000;

/** Write `file`, giving it an mtime no earlier write had, so its stat always changes. */
function put(file: string, content = ""): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  clock += 10;
  fs.utimesSync(file, clock, clock);
}

function harness(overrides: Partial<GitIgnoreCacheDeps> = {}) {
  /** Paths whose `check-ignore` answer is "ignored". */
  const rules = new Set<string>();
  const checkIgnore = vi.fn(
    async (_cwd: string, paths: readonly string[]): Promise<Set<string> | null> =>
      new Set(paths.filter((p) => rules.has(p))),
  );
  const readExcludesFileSetting = vi.fn(async (_cwd: string): Promise<string | null | undefined> => null);
  const cache = createGitIgnoreCache({
    checkIgnore,
    readExcludesFileSetting,
    homeDir: home,
    xdgConfigHome: undefined,
    ...overrides,
  });
  return { cache, rules, checkIgnore, readExcludesFileSetting };
}

const file = (p: string): IgnoreQuery => ({ path: p, kind: "1" });
const asked = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.map((call) => call[1]);

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "git-ignore-cache-")));
  home = path.join(root, "home");
  repo = path.join(root, "work", "repo");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(repo, ".git", "info"), { recursive: true });
  put(path.join(repo, ".git", "index"), "i");
  put(path.join(repo, "src", "a.ts"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  statOverrides.clear();
  vi.mocked(fsp.stat).mockClear();
});

describe("createGitIgnoreCache", () => {
  it("asks git nothing — and answers nothing — outside a repository", async () => {
    const { cache, checkIgnore, readExcludesFileSetting } = harness();
    const outside = path.join(root, "plain");
    fs.mkdirSync(outside);
    expect(await cache.getIgnoredPaths(outside, [file(path.join(outside, "x"))])).toEqual(new Set());
    expect(checkIgnore).not.toHaveBeenCalled();
    expect(readExcludesFileSetting).not.toHaveBeenCalled();
  });

  it("asks nothing, and reads nothing, for no queries", async () => {
    const { cache, checkIgnore, readExcludesFileSetting } = harness();
    expect(await cache.getIgnoredPaths(repo, [])).toEqual(new Set());
    expect(checkIgnore).not.toHaveBeenCalled();
    expect(readExcludesFileSetting).not.toHaveBeenCalled();
    expect(fsp.stat).not.toHaveBeenCalled();
  });

  it("asks git once from cwd, then answers both outcomes from memory while nothing changed", async () => {
    const { cache, rules, checkIgnore } = harness();
    const dist = path.join(repo, "dist");
    const src = path.join(repo, "src");
    rules.add(dist);
    const queries = [file(dist), file(src)];
    expect(await cache.getIgnoredPaths(repo, queries)).toEqual(new Set([dist]));
    expect(checkIgnore).toHaveBeenCalledWith(repo, [dist, src]);

    rules.clear(); // git would now say otherwise — but nothing it reads changed
    expect(await cache.getIgnoredPaths(repo, queries)).toEqual(new Set([dist]));
    expect(checkIgnore).toHaveBeenCalledOnce();
  });

  it("asks only about entries it has no answer for", async () => {
    const { cache, checkIgnore } = harness();
    const a = path.join(repo, "a");
    const b = path.join(repo, "b");
    await cache.getIgnoredPaths(repo, [file(a)]);
    await cache.getIgnoredPaths(repo, [file(a), file(b)]);
    expect(asked(checkIgnore)).toEqual([[a], [b]]);
  });

  it("asks again about a path whose kind changed", async () => {
    const { cache, checkIgnore } = harness();
    const build = path.join(repo, "build");
    await cache.getIgnoredPaths(repo, [file(build)]);
    await cache.getIgnoredPaths(repo, [{ path: build, kind: "2" }]);
    await cache.getIgnoredPaths(repo, [{ path: build, kind: "2" }]);
    expect(asked(checkIgnore)).toEqual([[build], [build]]);
  });

  it.each([
    ["the directory's own .gitignore", () => path.join(repo, "src", "deep", ".gitignore")],
    ["an ancestor's .gitignore", () => path.join(repo, "src", "deep", "..", ".gitignore")],
    ["the top's .gitignore", () => path.join(repo, ".gitignore")],
    ["the index", () => path.join(repo, ".git", "index")],
    ["info/exclude", () => path.join(repo, ".git", "info", "exclude")],
    ["the repository config", () => path.join(repo, ".git", "config")],
    ["config.worktree", () => path.join(repo, ".git", "config.worktree")],
    ["~/.gitconfig", () => path.join(home, ".gitconfig")],
    ["the XDG git config", () => path.join(home, ".config", "git", "config")],
    ["the XDG ignore file", () => path.join(home, ".config", "git", "ignore")],
  ])("asks again once %s changes", async (_label, target) => {
    const { cache, checkIgnore } = harness();
    const dir = path.join(repo, "src", "deep");
    fs.mkdirSync(dir, { recursive: true });
    const query = [file(path.join(dir, "x"))];
    await cache.getIgnoredPaths(dir, query);
    put(path.resolve(target()), "rule");
    await cache.getIgnoredPaths(dir, query);
    await cache.getIgnoredPaths(dir, query);
    expect(checkIgnore).toHaveBeenCalledTimes(2);
  });

  it.each([
    "ino",
    "size",
    "mtimeMs",
    "ctimeMs",
  ] as const)("asks again when only a rule file's %s changed", async (field) => {
    const { cache, checkIgnore } = harness();
    const rules = path.join(repo, ".gitignore");
    put(rules, "x");
    const query = [file(path.join(repo, "x"))];
    await cache.getIgnoredPaths(repo, query);
    statOverrides.set(rules, { [field]: 42 });
    await cache.getIgnoredPaths(repo, query);
    await cache.getIgnoredPaths(repo, query);
    expect(checkIgnore).toHaveBeenCalledTimes(2);
  });

  it("stats each file once per request, however many directories share it", async () => {
    const { cache } = harness();
    const one = path.join(repo, "src", "one", "x");
    const two = path.join(repo, "src", "two", "x");
    await cache.getIgnoredPaths(repo, [file(one), file(two)]);
    const statted = vi.mocked(fsp.stat).mock.calls.map((call) => String(call[0]));
    expect(statted.filter((p) => p === path.join(repo, "src", ".gitignore"))).toHaveLength(1);
    expect(statted.filter((p) => p === path.join(repo, ".git"))).toHaveLength(1);
    expect(new Set(statted).size).toBe(statted.length);
  });

  it("answers a path outside the repository from git, without climbing past the root", async () => {
    const { cache, rules, checkIgnore } = harness();
    const stray = path.join(root, "elsewhere", "x");
    rules.add(stray);
    expect(await cache.getIgnoredPaths(repo, [file(stray)])).toEqual(new Set([stray]));
    expect(checkIgnore).toHaveBeenCalledWith(repo, [stray]);
  });

  it("asks again when the .git entry itself changes", async () => {
    const { cache, checkIgnore } = harness();
    const query = [file(path.join(repo, "x"))];
    await cache.getIgnoredPaths(repo, query);
    clock += 10;
    fs.utimesSync(path.join(repo, ".git"), clock, clock);
    await cache.getIgnoredPaths(repo, query);
    expect(checkIgnore).toHaveBeenCalledTimes(2);
  });

  it("ignores a .gitignore above the repository top", async () => {
    const { cache, checkIgnore } = harness();
    const query = [file(path.join(repo, "src", "x"))];
    await cache.getIgnoredPaths(path.join(repo, "src"), query);
    put(path.join(root, "work", ".gitignore"), "x");
    await cache.getIgnoredPaths(path.join(repo, "src"), query);
    expect(checkIgnore).toHaveBeenCalledOnce();
  });

  it("asks again when a repository appears between the directory and the top", async () => {
    const { cache, checkIgnore } = harness();
    const nested = path.join(repo, "vendor", "lib");
    fs.mkdirSync(nested, { recursive: true });
    const query = [file(path.join(nested, "x"))];
    await cache.getIgnoredPaths(repo, query);
    fs.mkdirSync(path.join(repo, "vendor", ".git"));
    await cache.getIgnoredPaths(repo, query);
    expect(checkIgnore).toHaveBeenCalledTimes(2);
  });

  it("uses $XDG_CONFIG_HOME when set", async () => {
    const xdg = path.join(root, "xdg");
    const { cache, checkIgnore } = harness({ xdgConfigHome: xdg });
    const query = [file(path.join(repo, "x"))];
    await cache.getIgnoredPaths(repo, query);
    put(path.join(home, ".config", "git", "ignore"), "x"); // not where git looks now
    await cache.getIgnoredPaths(repo, query);
    expect(checkIgnore).toHaveBeenCalledOnce();
    put(path.join(xdg, "git", "ignore"), "x");
    await cache.getIgnoredPaths(repo, query);
    expect(checkIgnore).toHaveBeenCalledTimes(2);
  });

  describe("core.excludesFile", () => {
    it("watches the configured excludes file", async () => {
      const global = path.join(home, ".gitignore_global");
      const { cache, checkIgnore, readExcludesFileSetting } = harness();
      readExcludesFileSetting.mockResolvedValue(global);
      const query = [file(path.join(repo, "x"))];
      await cache.getIgnoredPaths(repo, query);
      expect(readExcludesFileSetting).toHaveBeenCalledWith(repo);
      put(global, "x");
      await cache.getIgnoredPaths(repo, query);
      expect(checkIgnore).toHaveBeenCalledTimes(2);
    });

    it("is looked up once per repository while the config files are unchanged", async () => {
      const { cache, readExcludesFileSetting } = harness();
      await cache.getIgnoredPaths(repo, [file(path.join(repo, "x"))]);
      await cache.getIgnoredPaths(repo, [file(path.join(repo, "y"))]);
      expect(readExcludesFileSetting).toHaveBeenCalledOnce();
      put(path.join(home, ".gitconfig"), "[core]");
      await cache.getIgnoredPaths(repo, [file(path.join(repo, "z"))]);
      expect(readExcludesFileSetting).toHaveBeenCalledTimes(2);
    });

    it("keeps a newer lookup when an older one, superseded meanwhile, gives no answer", async () => {
      const { cache, readExcludesFileSetting } = harness();
      let releaseOld: (value: undefined) => void = () => {};
      readExcludesFileSetting.mockImplementationOnce(() => new Promise((resolve) => (releaseOld = resolve)));
      const old = cache.getIgnoredPaths(repo, [file(path.join(repo, "x"))]);
      await vi.waitFor(() => expect(readExcludesFileSetting).toHaveBeenCalledOnce());
      put(path.join(home, ".gitconfig"), "[core]");
      await cache.getIgnoredPaths(repo, [file(path.join(repo, "y"))]); // a newer lookup, answered
      releaseOld(undefined);
      await old;
      await cache.getIgnoredPaths(repo, [file(path.join(repo, "z"))]);
      expect(readExcludesFileSetting).toHaveBeenCalledTimes(2);
    });

    it("is looked up again when git gave no answer", async () => {
      const { cache, readExcludesFileSetting } = harness();
      readExcludesFileSetting.mockResolvedValueOnce(undefined);
      await cache.getIgnoredPaths(repo, [file(path.join(repo, "x"))]);
      await cache.getIgnoredPaths(repo, [file(path.join(repo, "y"))]);
      await cache.getIgnoredPaths(repo, [file(path.join(repo, "z"))]);
      expect(readExcludesFileSetting).toHaveBeenCalledTimes(2);
    });
  });

  describe("linked worktrees and submodules", () => {
    it("follows a .git file to its git dir and that dir's common dir", async () => {
      const common = path.join(root, "main", ".git");
      const gitDir = path.join(common, "worktrees", "wt");
      const wt = path.join(root, "wt");
      put(path.join(wt, ".git"), `gitdir: ${gitDir}\r\n`); // as Git for Windows writes it
      put(path.join(gitDir, "commondir"), "../..\n");
      put(path.join(gitDir, "index"), "i");
      const { cache, checkIgnore } = harness();
      const query = [file(path.join(wt, "x"))];
      await cache.getIgnoredPaths(wt, query);
      for (const changed of [
        path.join(gitDir, "index"),
        path.join(common, "info", "exclude"),
        path.join(common, "config"),
        path.join(gitDir, "config.worktree"),
      ]) {
        put(changed, "change");
        await cache.getIgnoredPaths(wt, query);
      }
      expect(checkIgnore).toHaveBeenCalledTimes(5);
      expect(checkIgnore).toHaveBeenLastCalledWith(wt, [path.join(wt, "x")]);
    });

    it("resolves a relative gitdir against the work tree, and reads info/ from the git dir without a commondir", async () => {
      const sub = path.join(repo, "sub");
      const gitDir = path.join(repo, ".git", "modules", "sub");
      put(path.join(sub, ".git"), "gitdir: ../.git/modules/sub\n");
      put(path.join(gitDir, "index"), "i");
      const { cache, checkIgnore } = harness();
      const query = [file(path.join(sub, "x"))];
      await cache.getIgnoredPaths(sub, query);
      put(path.join(gitDir, "info", "exclude"), "x");
      await cache.getIgnoredPaths(sub, query);
      put(path.join(repo, ".git", "info", "exclude"), "x"); // the outer repository's
      await cache.getIgnoredPaths(sub, query);
      expect(checkIgnore).toHaveBeenCalledTimes(2);
    });

    it("keeps spaces that end the path — git trims only line breaks", async () => {
      const gitDir = path.join(root, "dirs", "sub ");
      const sub = path.join(root, "sub");
      put(path.join(sub, ".git"), `gitdir: ${gitDir}\n`);
      const { cache, checkIgnore } = harness();
      const query = [file(path.join(sub, "x"))];
      await cache.getIgnoredPaths(sub, query);
      put(path.join(gitDir, "index"), "i");
      await cache.getIgnoredPaths(sub, query);
      expect(checkIgnore).toHaveBeenCalledTimes(2);
    });

    it.each([
      ["names no git dir", "not a pointer"],
      ["names an empty git dir", "gitdir: \n"],
      ["does not start with the key", " gitdir: /x\n"],
      ["spells the key without its space", "gitdir:/x\n"],
      ["is empty", ""],
    ])("asks git nothing under a .git file that %s, which git refuses", async (_label, content) => {
      const odd = path.join(root, "odd");
      put(path.join(odd, ".git"), content);
      const { cache, rules, checkIgnore, readExcludesFileSetting } = harness();
      const x = path.join(odd, "x");
      rules.add(x);
      expect(await cache.getIgnoredPaths(odd, [file(x)])).toEqual(new Set());
      expect(checkIgnore).not.toHaveBeenCalled();
      expect(readExcludesFileSetting).not.toHaveBeenCalled();
    });
  });

  it("does not remember an unknown answer, but still applies what it knew", async () => {
    const { cache, rules, checkIgnore } = harness();
    const a = path.join(repo, "a");
    const b = path.join(repo, "b");
    rules.add(a);
    rules.add(b);
    await cache.getIgnoredPaths(repo, [file(a)]);
    checkIgnore.mockResolvedValueOnce(null);
    expect(await cache.getIgnoredPaths(repo, [file(a), file(b)])).toEqual(new Set([a]));
    expect(await cache.getIgnoredPaths(repo, [file(a), file(b)])).toEqual(new Set([a, b]));
    expect(asked(checkIgnore)).toEqual([[a], [b], [b]]);
  });

  it("asks once, in one run from cwd, for paths spread over several directories", async () => {
    const { cache, rules, checkIgnore } = harness();
    const one = path.join(repo, "src", "one.ts");
    const two = path.join(repo, "lib", "two.ts");
    rules.add(two);
    expect(await cache.getIgnoredPaths(repo, [file(one), file(two)])).toEqual(new Set([two]));
    expect(checkIgnore).toHaveBeenCalledWith(repo, [one, two]);
    put(path.join(repo, "lib", ".gitignore"), "two.ts");
    await cache.getIgnoredPaths(repo, [file(one), file(two)]);
    expect(asked(checkIgnore)).toEqual([[one, two], [two]]);
  });

  it("shares one git run between identical requests in flight", async () => {
    const { cache, checkIgnore } = harness();
    let release: (value: Set<string>) => void = () => {};
    checkIgnore.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const x = path.join(repo, "x");
    const first = cache.getIgnoredPaths(repo, [file(x)]);
    const second = cache.getIgnoredPaths(repo, [file(x)]);
    await vi.waitFor(() => expect(checkIgnore).toHaveBeenCalledOnce());
    await new Promise((r) => setTimeout(r, 20)); // the second request has reached git too
    release(new Set([x]));
    expect(await first).toEqual(new Set([x]));
    expect(await second).toEqual(new Set([x]));
    expect(checkIgnore).toHaveBeenCalledOnce();
  });

  it("shares the run with a request from another folder of the same repository", async () => {
    const { cache, checkIgnore } = harness();
    let release: (value: Set<string>) => void = () => {};
    checkIgnore.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const src = path.join(repo, "src");
    const x = path.join(src, "x");
    const first = cache.getIgnoredPaths(src, [file(x)]);
    const second = cache.getIgnoredPaths(repo, [file(x)]);
    await vi.waitFor(() => expect(checkIgnore).toHaveBeenCalledOnce());
    await new Promise((r) => setTimeout(r, 20)); // the second request has reached git too
    release(new Set([x]));
    expect(await first).toEqual(new Set([x]));
    expect(await second).toEqual(new Set([x]));
    expect(checkIgnore).toHaveBeenCalledOnce();
  });

  it("does not share a run between requests asking about different paths", async () => {
    const { cache, rules, checkIgnore } = harness();
    let release: (value: Set<string>) => void = () => {};
    checkIgnore.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const x = path.join(repo, "x");
    const y = path.join(repo, "y");
    rules.add(y);
    const first = cache.getIgnoredPaths(repo, [file(x)]);
    await vi.waitFor(() => expect(checkIgnore).toHaveBeenCalledOnce());
    expect(await cache.getIgnoredPaths(repo, [file(y)])).toEqual(new Set([y]));
    release(new Set());
    await first;
    expect(asked(checkIgnore)).toEqual([[x], [y]]);
  });

  it("runs git again for a request made after the shared run settled", async () => {
    const { cache, checkIgnore } = harness();
    const x = path.join(repo, "x");
    checkIgnore.mockResolvedValueOnce(null);
    await cache.getIgnoredPaths(repo, [file(x)]);
    await cache.getIgnoredPaths(repo, [file(x)]);
    expect(checkIgnore).toHaveBeenCalledTimes(2);
  });

  it("does not share a run between requests under different rules", async () => {
    const { cache, checkIgnore } = harness();
    let release: (value: Set<string>) => void = () => {};
    checkIgnore.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const x = path.join(repo, "x");
    const first = cache.getIgnoredPaths(repo, [file(x)]);
    await vi.waitFor(() => expect(checkIgnore).toHaveBeenCalledOnce());
    put(path.join(repo, ".gitignore"), "x");
    const second = cache.getIgnoredPaths(repo, [file(x)]);
    await vi.waitFor(() => expect(checkIgnore).toHaveBeenCalledTimes(2));
    release(new Set());
    await first;
    await second;
  });

  it("asks again after a rule changed while git was running", async () => {
    const { cache, checkIgnore } = harness();
    let release: (value: Set<string>) => void = () => {};
    checkIgnore.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const query = [file(path.join(repo, "x"))];
    const first = cache.getIgnoredPaths(repo, query);
    await vi.waitFor(() => expect(checkIgnore).toHaveBeenCalledOnce());
    put(path.join(repo, ".gitignore"), "x");
    release(new Set());
    await first;
    await cache.getIgnoredPaths(repo, query);
    expect(checkIgnore).toHaveBeenCalledTimes(2);
  });

  it("forgets the least recently used directory past its bound", async () => {
    const { cache, checkIgnore } = harness({ maxEntries: 2 });
    const [a, b, c] = ["a", "b", "c"].map((d) => path.join(repo, d, "x"));
    await cache.getIgnoredPaths(repo, [file(a)]);
    await cache.getIgnoredPaths(repo, [file(b)]);
    await cache.getIgnoredPaths(repo, [file(a)]); // a is now the most recent
    await cache.getIgnoredPaths(repo, [file(c)]); // drops b
    await cache.getIgnoredPaths(repo, [file(a)]);
    await cache.getIgnoredPaths(repo, [file(b)]);
    expect(asked(checkIgnore)).toEqual([[a], [b], [c], [b]]);
  });

  it("bounds the excludes-file lookups the same way", async () => {
    const other = path.join(root, "other");
    fs.mkdirSync(path.join(other, ".git"), { recursive: true });
    const third = path.join(root, "third");
    fs.mkdirSync(path.join(third, ".git"), { recursive: true });
    const { cache, readExcludesFileSetting } = harness({ maxEntries: 2 });
    await cache.getIgnoredPaths(repo, [file(path.join(repo, "x"))]);
    await cache.getIgnoredPaths(other, [file(path.join(other, "x"))]);
    await cache.getIgnoredPaths(third, [file(path.join(third, "x"))]);
    await cache.getIgnoredPaths(other, [file(path.join(other, "y"))]);
    await cache.getIgnoredPaths(repo, [file(path.join(repo, "y"))]);
    expect(readExcludesFileSetting.mock.calls.map((call) => call[0])).toEqual([repo, other, third, repo]);
  });
});

describe("sharedGitIgnoreCache", () => {
  afterEach(() => {
    vi.doUnmock("./gitIgnoreChecker");
    vi.doUnmock("node:os");
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("is built from the real home directory and $XDG_CONFIG_HOME", async () => {
    const xdg = path.join(root, "xdg");
    vi.stubEnv("XDG_CONFIG_HOME", xdg);
    const fakeCheckIgnore = vi.fn(async () => new Set<string>());
    vi.resetModules();
    // A worker thread's env is its own copy, so libuv would still see the real
    // HOME: stand in for os.homedir() instead.
    vi.doMock("node:os", async (importOriginal) => ({
      ...(await importOriginal<typeof import("node:os")>()),
      homedir: () => home,
    }));
    vi.doMock("./gitIgnoreChecker", () => ({
      checkIgnore: fakeCheckIgnore,
      readExcludesFileSetting: async () => null,
    }));
    const { sharedGitIgnoreCache } = await import("./gitIgnoreCache");
    const query = [file(path.join(repo, "x"))];
    await sharedGitIgnoreCache.getIgnoredPaths(repo, query);
    put(path.join(xdg, "git", "ignore"), "x");
    await sharedGitIgnoreCache.getIgnoredPaths(repo, query);
    put(path.join(home, ".gitconfig"), "[core]");
    await sharedGitIgnoreCache.getIgnoredPaths(repo, query);
    expect(fakeCheckIgnore).toHaveBeenCalledTimes(3);
  });
});

describe("createGitIgnoreCache with real git", () => {
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "ignore" });

  it("follows .gitignore edits and force-added files", async () => {
    const work = path.join(root, "real");
    fs.mkdirSync(work);
    git(work, "init", "-q");
    put(path.join(work, ".gitignore"), "dist/\n");
    put(path.join(work, "notes.md"), "n");
    fs.mkdirSync(path.join(work, "dist"));
    const cache = createGitIgnoreCache({
      checkIgnore,
      readExcludesFileSetting,
      homeDir: home,
      xdgConfigHome: undefined,
    });
    const queries = [
      { path: path.join(work, "dist"), kind: "2" },
      { path: path.join(work, "notes.md"), kind: "1" },
    ];
    expect(await cache.getIgnoredPaths(work, queries)).toEqual(new Set([path.join(work, "dist")]));

    put(path.join(work, ".gitignore"), "dist/\nnotes.md\n");
    expect(await cache.getIgnoredPaths(work, queries)).toEqual(
      new Set([path.join(work, "dist"), path.join(work, "notes.md")]),
    );

    git(work, "add", "-f", "notes.md"); // tracked now, so no longer reported
    expect(await cache.getIgnoredPaths(work, queries)).toEqual(new Set([path.join(work, "dist")]));
  });
});
