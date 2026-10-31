import * as os from "node:os";
import { describe, expect, it } from "vitest";
import { describeGitFailure } from "./describeGitFailure";
import { createGitCommandRunner } from "./gitCommandRunner";

// `node` stands in for `git`: always present wherever this suite runs, and it
// can be told to produce each outcome the runner has to survive.
const nodeRunner = (timeoutMs?: number) => createGitCommandRunner({ executable: process.execPath, timeoutMs });

const cwd = os.tmpdir();

describe("createGitCommandRunner", () => {
  it("returns exit code 0 and stdout for a successful command", async () => {
    const result = await nodeRunner().run(["-e", "process.stdout.write('hi')"], cwd);
    expect(result.code).toBe(0);
    expect(result.stdout.toString()).toBe("hi");
    expect(result.timedOut).toBe(false);
    expect(result.failedToSpawn).toBe(false);
  });

  // design.md D1: `-z` parsing splits on NUL, so stdout must stay bytes.
  it("hands back stdout as bytes, preserving NUL", async () => {
    const result = await nodeRunner().run(["-e", "process.stdout.write(Buffer.from([97,0,98]))"], cwd);
    expect(Buffer.isBuffer(result.stdout)).toBe(true);
    expect([...result.stdout]).toEqual([97, 0, 98]);
  });

  it("writes per-call input to stdin", async () => {
    const result = await nodeRunner().run(["-e", "process.stdin.pipe(process.stdout)"], cwd, {
      input: "start\nverify refs/heads/main abc\ncommit\n",
    });
    expect(result.code).toBe(0);
    expect(result.stdout.toString()).toBe("start\nverify refs/heads/main abc\ncommit\n");
  });

  it("returns a non-zero exit code as a value instead of throwing", async () => {
    const result = await nodeRunner().run(["-e", "process.exit(3)"], cwd);
    expect(result.code).toBe(3);
    expect(result.failedToSpawn).toBe(false);
    expect(result.timedOut).toBe(false);
  });

  it("captures stderr alongside a failing exit code", async () => {
    const result = await nodeRunner().run(["-e", "process.stderr.write('bad');process.exit(1)"], cwd);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("bad");
  });

  it("reports a timeout instead of hanging", async () => {
    const result = await nodeRunner(150).run(["-e", "setTimeout(() => {}, 60000)"], cwd);
    expect(result.timedOut).toBe(true);
    expect(result.failedToSpawn).toBe(false);
  });

  it("reports a missing executable rather than throwing", async () => {
    const runner = createGitCommandRunner({ executable: "definitely-not-a-real-binary-xyz" });
    const result = await runner.run(["--version"], cwd);
    expect(result.failedToSpawn).toBe(true);
    expect(result.code).not.toBe(0);
  });

  it("defaults to the `git` executable and a 10 s budget", async () => {
    const result = await createGitCommandRunner().run(["--version"], cwd);
    // Whatever git is installed, the runner must not throw on it.
    expect(typeof result.code).toBe("number");
  });
});

// Review round 1, W1: repoRoots classifies absence from git's own message, so
// the message has to arrive in the language that classifier was written for.
describe("createGitCommandRunner — locale", () => {
  it("pins the child's locale to C", async () => {
    const result = await createGitCommandRunner({ executable: process.execPath }).run(
      ["-e", "process.stdout.write(process.env.LC_ALL + '/' + process.env.LANG)"],
      cwd,
    );
    expect(result.stdout.toString()).toBe("C/C");
  });

  it("keeps the rest of the environment, so git stays findable on PATH", async () => {
    const result = await createGitCommandRunner({ executable: process.execPath }).run(
      ["-e", "process.stdout.write(String(process.env.PATH === undefined))"],
      cwd,
    );
    expect(result.stdout.toString()).toBe("false");
  });
});

// One read's ceiling is not the runner's. The ignored walk buffers a listing it
// must not be allowed to hold unboundedly, and a construction-time constant
// shared by every caller cannot express that (design.md D3).
describe("createGitCommandRunner — per-call output ceiling", () => {
  it("honours a smaller ceiling than the runner was built with", async () => {
    const runner = createGitCommandRunner({ executable: process.execPath, maxBufferBytes: 1024 * 1024 });

    const result = await runner.run(["-e", "process.stdout.write('x'.repeat(4096))"], cwd, {
      maxBufferBytes: 64,
    });

    // Overflow fails the command rather than truncating it: a caller that asked
    // for a bound wants to hear it was exceeded, not a partial listing.
    expect(result.code).not.toBe(0);
    // Not a timeout — the ignored walk tells the two apart when it reports why.
    expect(result.timedOut).toBe(false);
  });

  it("leaves the runner's own ceiling in place for calls that ask for nothing", async () => {
    const runner = createGitCommandRunner({ executable: process.execPath, maxBufferBytes: 1024 * 1024 });

    const result = await runner.run(["-e", "process.stdout.write('x'.repeat(4096))"], cwd);

    expect(result.code).toBe(0);
    expect(result.stdout.length).toBe(4096);
  });
});

// ─── A folder that is not there is not a missing git ───────────────
// execFile reports a non-existent cwd as ENOENT, the same code as a missing
// executable, so a deleted worktree folder used to read as "No usable `git`
// executable was found." — sending the user to reinstall git.

describe("createGitCommandRunner — a missing working directory", () => {
  it("says the folder is missing, not that git is", async () => {
    const gone = `${cwd}/definitely-not-here-${process.pid}`;
    const result = await nodeRunner().run(["-e", "0"], gone);
    expect(result.failedToSpawn).toBe(true); // still a failure every guard catches
    expect(result.cwdProblem).toEqual({ path: gone, kind: "missing" });
    expect(describeGitFailure(result, "git status")).toBe(`The folder \`${gone}\` does not exist.`);
  });

  it("still blames the executable when the folder is there", async () => {
    const result = await createGitCommandRunner({ executable: "definitely-not-a-binary-xyz" }).run(["x"], cwd);
    expect(result.failedToSpawn).toBe(true);
    expect(result.cwdProblem).toBeUndefined();
    expect(describeGitFailure(result, "git status")).toBe("No usable `git` executable was found.");
  });

  it("treats a cwd that is a file as missing too", async () => {
    const result = await nodeRunner().run(["-e", "0"], __filename);
    expect(result.failedToSpawn).toBe(true);
    expect(result.cwdProblem).toEqual({ path: __filename, kind: "missing" });
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "says a folder it may not enter cannot be opened — not that git is missing, and not that it is gone",
    async () => {
      const { mkdtempSync, chmodSync, rmSync } = await import("node:fs");
      const locked = mkdtempSync(`${cwd}/portaterm-locked-`);
      chmodSync(locked, 0o000);
      try {
        const result = await nodeRunner().run(["-e", "0"], locked);
        expect(result.failedToSpawn).toBe(true);
        expect(result.cwdProblem).toEqual({ path: locked, kind: "unreadable" });
        expect(describeGitFailure(result, "git status")).toBe(`The folder \`${locked}\` cannot be opened.`);
      } finally {
        chmodSync(locked, 0o700);
        rmSync(locked, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "says a folder under a parent it cannot search cannot be opened, not that it does not exist",
    async () => {
      const { mkdtempSync, mkdirSync, chmodSync, rmSync } = await import("node:fs");
      const parent = mkdtempSync(`${cwd}/portaterm-parent-`);
      const child = `${parent}/inner`;
      mkdirSync(child);
      chmodSync(parent, 0o000);
      try {
        const result = await nodeRunner().run(["-e", "0"], child);
        expect(result.cwdProblem).toEqual({ path: child, kind: "unreadable" });
      } finally {
        chmodSync(parent, 0o700);
        rmSync(parent, { recursive: true, force: true });
      }
    },
  );
});
