import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const spawned: FakeGit[] = [];

class FakeGit extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin: Writable;
  kill = vi.fn();

  /** `gone`: git has already exited, so writing its stdin fails with EPIPE. */
  constructor(gone: boolean) {
    super();
    this.stdin = new Writable({
      write: (_chunk, _encoding, callback) => {
        callback(gone ? Object.assign(new Error("write EPIPE"), { code: "EPIPE" }) : null);
      },
    });
  }
}

let nextGone = false;
vi.mock("node:child_process", () => ({
  spawn: () => {
    const proc = new FakeGit(nextGone);
    spawned.push(proc);
    return proc;
  },
}));

import { getIgnoredPaths } from "./gitIgnoreChecker";

afterEach(() => {
  spawned.length = 0;
  nextGone = false;
});

describe("getIgnoredPaths", () => {
  it("returns the NUL-delimited paths git reports as ignored", async () => {
    const result = getIgnoredPaths("/repo", ["/repo/a", "/repo/dist"]);
    const git = spawned[0];
    git.stdout.write("/repo/dist\0");
    await new Promise((r) => setImmediate(r));
    git.emit("close", 0);
    expect(await result).toEqual(new Set(["/repo/dist"]));
  });

  it("survives git exiting before it reads stdin (EPIPE), answering nothing ignored", async () => {
    // e.g. a folder that is not a repository: git exits 128 at once, and the
    // path list then lands on a closed pipe. Unhandled, that EPIPE is an
    // uncaught exception in the extension host.
    nextGone = true;
    const result = getIgnoredPaths("/not-a-repo", ["/not-a-repo/a"]);
    await new Promise((r) => setImmediate(r));
    spawned[0].emit("close", 128);
    expect(await result).toEqual(new Set());
  });
});
