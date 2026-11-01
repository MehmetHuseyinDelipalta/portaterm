import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const spawned: FakeGit[] = [];

class FakeGit extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin: Writable;
  written = "";
  kill = vi.fn();

  /** `gone`: git has already exited, so writing its stdin fails with EPIPE. */
  constructor(
    gone: boolean,
    readonly args: readonly string[],
    readonly options: { cwd: string },
  ) {
    super();
    this.stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        this.written += chunk.toString();
        callback(gone ? Object.assign(new Error("write EPIPE"), { code: "EPIPE" }) : null);
      },
    });
  }
}

let nextGone = false;
let spawnThrows = false;
vi.mock("node:child_process", () => ({
  spawn: (_cmd: string, args: string[], options: { cwd: string }) => {
    if (spawnThrows) {
      throw new Error("spawn ENOENT");
    }
    const proc = new FakeGit(nextGone, args, options);
    spawned.push(proc);
    return proc;
  },
}));

import { checkIgnore, readExcludesFileSetting } from "./gitIgnoreChecker";

const tick = () => new Promise((r) => setImmediate(r));

afterEach(() => {
  spawned.length = 0;
  nextGone = false;
  spawnThrows = false;
  vi.useRealTimers();
});

describe("checkIgnore", () => {
  it("returns the NUL-delimited paths git reports as ignored", async () => {
    const result = checkIgnore("/repo", ["/repo/a", "/repo/dist"]);
    const git = spawned[0];
    expect(git.args).toEqual(["check-ignore", "-z", "--stdin"]);
    expect(git.options.cwd).toBe("/repo");
    git.stdout.write("/repo/dist\0");
    await tick();
    git.emit("close", 0);
    expect(await result).toEqual(new Set(["/repo/dist"]));
    expect(git.written).toBe("/repo/a\0/repo/dist\0");
  });

  it("answers an empty set, not unknown, when git matched nothing (exit 1)", async () => {
    const result = checkIgnore("/repo", ["/repo/a"]);
    await tick();
    spawned[0].emit("close", 1);
    expect(await result).toEqual(new Set());
  });

  it("asks nothing for no paths", async () => {
    expect(await checkIgnore("/repo", [])).toEqual(new Set());
    expect(spawned).toHaveLength(0);
  });

  it("survives git exiting before it reads stdin (EPIPE), answering unknown", async () => {
    // e.g. a folder that is not a repository: git exits 128 at once, and the
    // path list then lands on a closed pipe. Unhandled, that EPIPE is an
    // uncaught exception in the extension host.
    nextGone = true;
    const result = checkIgnore("/not-a-repo", ["/not-a-repo/a"]);
    await tick();
    spawned[0].emit("close", 128);
    expect(await result).toBeNull();
  });

  it("answers unknown when git cannot be spawned", async () => {
    spawnThrows = true;
    expect(await checkIgnore("/repo", ["/repo/a"])).toBeNull();
  });

  it("answers unknown when the process errors", async () => {
    const result = checkIgnore("/repo", ["/repo/a"]);
    spawned[0].emit("error", new Error("ENOENT"));
    expect(await result).toBeNull();
  });

  it("kills git and answers unknown after 1.5 s", async () => {
    vi.useFakeTimers();
    const result = checkIgnore("/repo", ["/repo/a"]);
    await vi.advanceTimersByTimeAsync(1499);
    expect(spawned[0].kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(spawned[0].kill).toHaveBeenCalledOnce();
    expect(await result).toBeNull();
  });

  it("still answers unknown on timeout when kill throws", async () => {
    vi.useFakeTimers();
    const result = checkIgnore("/repo", ["/repo/a"]);
    spawned[0].kill.mockImplementation(() => {
      throw new Error("ESRCH");
    });
    await vi.advanceTimersByTimeAsync(1500);
    expect(await result).toBeNull();
  });

  it("does not kill a git that already answered", async () => {
    vi.useFakeTimers();
    const result = checkIgnore("/repo", ["/repo/a"]);
    spawned[0].emit("close", 1);
    expect(await result).toEqual(new Set());
    await vi.advanceTimersByTimeAsync(5000);
    expect(spawned[0].kill).not.toHaveBeenCalled();
  });

  it("does not kill a git that failed to start", async () => {
    vi.useFakeTimers();
    const result = checkIgnore("/repo", ["/repo/a"]);
    spawned[0].emit("error", new Error("ENOENT"));
    expect(await result).toBeNull();
    await vi.advanceTimersByTimeAsync(5000);
    expect(spawned[0].kill).not.toHaveBeenCalled();
  });
});

describe("readExcludesFileSetting", () => {
  it("returns the configured path, trimmed, asking with ~ expansion", async () => {
    const result = readExcludesFileSetting("/repo");
    const git = spawned[0];
    expect(git.args).toEqual(["config", "--path", "--get", "core.excludesFile"]);
    expect(git.options.cwd).toBe("/repo");
    git.stdout.write("/home/u/.gitignore_global\n");
    await tick();
    git.emit("close", 0);
    expect(await result).toBe("/home/u/.gitignore_global");
    expect(git.written).toBe("");
  });

  it("returns null when the key is unset (exit 1)", async () => {
    const result = readExcludesFileSetting("/repo");
    spawned[0].emit("close", 1);
    expect(await result).toBeNull();
  });

  it("returns null for an empty value", async () => {
    const result = readExcludesFileSetting("/repo");
    spawned[0].stdout.write("\n");
    await tick();
    spawned[0].emit("close", 0);
    expect(await result).toBeNull();
  });

  it("returns undefined when git fails", async () => {
    const result = readExcludesFileSetting("/repo");
    spawned[0].emit("close", 128);
    expect(await result).toBeUndefined();
  });

  it("returns undefined when git cannot be spawned", async () => {
    spawnThrows = true;
    expect(await readExcludesFileSetting("/repo")).toBeUndefined();
  });
});
