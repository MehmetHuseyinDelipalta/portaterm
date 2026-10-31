import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { nodeClearDebrisDeps } from "./clearDebris";
import { classifyDestination, findRepositoryWithin, type GitEntryProbe } from "./debrisClassification";

const absent: GitEntryProbe = () => "absent";
const present: GitEntryProbe = () => "present";
const unknown: GitEntryProbe = () => "unknown";

describe("classifyDestination", () => {
  it("calls an unregistered directory with no .git debris", () => {
    expect(classifyDestination("/trees/repo-feat", false, absent)).toEqual({ kind: "debris" });
  });

  it("never calls a directory holding a .git file debris — that is a checkout WT-012.15 re-registers", () => {
    expect(classifyDestination("/trees/repo-feat", false, present)).toEqual({ kind: "free" });
  });

  it("never calls a registered worktree debris, whatever is on disk", () => {
    // The probe would say debris. Registration outranks it, and this asserts the
    // order rather than a shared answer: `absent` is the debris-producing reading.
    expect(classifyDestination("/trees/repo-feat", true, absent)).toEqual({ kind: "free" });
  });

  it("fails closed where the entry could not be read", () => {
    // Not proven to be debris is not debris. An EACCES on `.git` must not
    // authorize deleting the directory that holds it.
    expect(classifyDestination("/trees/repo-feat", false, unknown)).toEqual({ kind: "free" });
  });

  it("asks about `.git` inside the candidate, not the candidate itself", () => {
    const asked: string[] = [];
    classifyDestination("/trees/repo-feat", false, (p) => {
      asked.push(p);
      return "absent";
    });
    expect(asked).toEqual(["/trees/repo-feat/.git"]);
  });

  it("does not probe at all for a registered path", () => {
    let calls = 0;
    classifyDestination("/trees/repo-feat", true, () => {
      calls += 1;
      return "absent";
    });
    expect(calls).toBe(0);
  });
});

describe("findRepositoryWithin, on a real filesystem", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) {
      try {
        chmodSync(root, 0o700);
      } catch {
        /* best-effort */
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  /** A folder shaped like debris at the top, with whatever beneath it. */
  function folder(build: (dir: string) => void): string {
    const root = mkdtempSync(join(tmpdir(), "portaterm-scan-"));
    roots.push(root);
    const dir = join(root, "group");
    mkdirSync(dir);
    build(dir);
    return dir;
  }

  const scan = (dir: string, maxEntries?: number) =>
    findRepositoryWithin(dir, nodeClearDebrisDeps.lstat, nodeClearDebrisDeps.readdir, { maxEntries });

  it("finds a clone one level down", () => {
    expect(scan(folder((d) => mkdirSync(join(d, "app", ".git"), { recursive: true })))).toEqual({
      kind: "repository",
      at: "app",
    });
  });

  it("finds a clone two levels down — the folder above it has no .git of its own", () => {
    // Create root ~/code, destination ~/code/clients, an unrelated checkout at
    // ~/code/clients/acme/web: `acme` looks like plain content.
    const dir = folder((d) => mkdirSync(join(d, "acme", "web", ".git"), { recursive: true }));
    expect(scan(dir)).toEqual({ kind: "repository", at: join("acme", "web") });
  });

  it("finds a linked worktree or submodule by its .git FILE", () => {
    const dir = folder((d) => {
      mkdirSync(join(d, "deep", "wt"), { recursive: true });
      writeFileSync(join(d, "deep", "wt", ".git"), "gitdir: /elsewhere\n");
    });
    expect(scan(dir)).toEqual({ kind: "repository", at: join("deep", "wt") });
  });

  it("finds a bare repository — also the shape of a --separate-git-dir common dir", () => {
    const dir = folder((d) => {
      const bare = join(d, "app.git");
      mkdirSync(join(bare, "objects"), { recursive: true });
      mkdirSync(join(bare, "refs"));
      writeFileSync(join(bare, "HEAD"), "ref: refs/heads/main\n");
    });
    expect(scan(dir)).toEqual({ kind: "repository", at: "app.git" });
  });

  it("passes ordinary debris: files and directories with no repository in them", () => {
    const dir = folder((d) => {
      writeFileSync(join(d, "stale.log"), "x");
      mkdirSync(join(d, "node_modules", "pkg", "lib"), { recursive: true });
      writeFileSync(join(d, "node_modules", "pkg", "lib", "HEAD"), "not git"); // HEAD alone is not a repo
    });
    expect(scan(dir)).toEqual({ kind: "none" });
  });

  it("does not follow a symlink to a repository — the removal would not either", () => {
    const dir = folder((d) => {
      const target = join(d, "..", "real");
      mkdirSync(join(target, ".git"), { recursive: true });
      symlinkSync(target, join(d, "link"));
    });
    expect(scan(dir)).toEqual({ kind: "none" });
  });

  it("refuses a tree too large to verify", () => {
    const dir = folder((d) => {
      for (let i = 0; i < 30; i++) {
        writeFileSync(join(d, `f${i}`), "");
      }
    });
    expect(scan(dir, 20)).toEqual({ kind: "too-large" });
    expect(scan(dir, 100)).toEqual({ kind: "none" });
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "reports a directory it cannot read as unknown, never as clear",
    () => {
      const dir = folder((d) => {
        mkdirSync(join(d, "locked", "inner"), { recursive: true });
        chmodSync(join(d, "locked"), 0o000);
      });
      try {
        expect(scan(dir)).toEqual({ kind: "unknown", at: "locked" });
      } finally {
        chmodSync(join(dir, "locked"), 0o700);
      }
    },
  );
});
