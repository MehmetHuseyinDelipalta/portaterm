import { describe, expect, it } from "vitest";
import { type ClearDebrisDeps, clearDebris, type DebrisApproval } from "./clearDebris";

const CTX = { mainWorktree: "/repo", linkedWorktrees: ["/trees/other"] };
const PATH = "/trees/repo-feat";
const APPROVED: DebrisApproval = { identity: "1:2", entries: ["node_modules", "src"] };

function statLike(dev: number, ino: number, directory = true, link = false) {
  return { dev, ino, isDirectory: () => directory, isSymbolicLink: () => link };
}

/**
 * The boundary's readings are all SYNC, so a double that resolves later cannot
 * exist here — which is the point: the deps' shape is what makes the no-await
 * window enforceable rather than merely intended (round-1 B4, B5).
 *
 * `lstat` answers for the path itself, for every component walked above it,
 * and for the entries beneath it; by default each is a plain directory.
 */
function deps(over: Partial<ClearDebrisDeps> & { removed?: string[]; after?: "absent" | "present" } = {}) {
  const present = over.after ?? "absent";
  const built: ClearDebrisDeps = {
    lstat:
      over.lstat ?? ((p) => (p === PATH || p.startsWith(`${PATH}/`) || !p.startsWith(PATH) ? statLike(1, 2) : null)),
    // The destination lists the approved entries; everything beneath it is empty.
    readdir: over.readdir ?? ((p) => (p === PATH ? APPROVED.entries : [])),
    probeEntry:
      over.probeEntry ??
      ((p) => {
        if (p.endsWith(".git")) {
          return "absent";
        }
        return present;
      }),
    remove:
      over.remove ??
      (async (p: string) => {
        over.removed?.push(p);
      }),
  };
  return built;
}

describe("clearDebris", () => {
  it("removes the directory and reports success when the destination is gone", async () => {
    const removed: string[] = [];
    const result = await clearDebris(PATH, CTX, APPROVED, deps({ removed }));
    expect(result).toEqual({ ok: true });
    expect(removed).toEqual([PATH]);
  });

  it("refuses and removes nothing when the identity no longer matches", async () => {
    const removed: string[] = [];
    const result = await clearDebris(PATH, CTX, APPROVED, deps({ removed, lstat: () => statLike(1, 99) }));
    expect(result.ok).toBe(false);
    expect(removed).toEqual([]);
  });

  it("refuses where the platform gave no approval to bind to", async () => {
    const removed: string[] = [];
    const result = await clearDebris(PATH, CTX, null, deps({ removed }));
    expect(result.ok).toBe(false);
    expect(removed).toEqual([]);
  });

  it("refuses where a .git appeared after the authorization", async () => {
    const removed: string[] = [];
    const result = await clearDebris(PATH, CTX, APPROVED, deps({ removed, probeEntry: () => "present" }));
    expect(result.ok).toBe(false);
    expect(removed).toEqual([]);
  });

  it("refuses where the .git reading could not be taken", async () => {
    const removed: string[] = [];
    const result = await clearDebris(PATH, CTX, APPROVED, deps({ removed, probeEntry: () => "unknown" }));
    expect(result.ok).toBe(false);
    expect(removed).toEqual([]);
  });

  it("refuses where the directory is gone", async () => {
    const removed: string[] = [];
    const result = await clearDebris(PATH, CTX, APPROVED, deps({ removed, lstat: () => null }));
    expect(result.ok).toBe(false);
    expect(removed).toEqual([]);
  });

  it("refuses where the path is not a directory", async () => {
    const removed: string[] = [];
    const result = await clearDebris(PATH, CTX, APPROVED, deps({ removed, lstat: () => statLike(1, 2, false) }));
    expect(result.ok).toBe(false);
    expect(removed).toEqual([]);
  });

  it("refuses the repository's main worktree, whatever the authorization says", async () => {
    const removed: string[] = [];
    const result = await clearDebris(CTX.mainWorktree, CTX, APPROVED, deps({ removed }));
    expect(result.ok).toBe(false);
    expect(removed).toEqual([]);
  });

  it("refuses another worktree of this repository", async () => {
    const removed: string[] = [];
    const result = await clearDebris("/trees/other", CTX, APPROVED, deps({ removed }));
    expect(result.ok).toBe(false);
    expect(removed).toEqual([]);
  });

  it("refuses a path INSIDE another worktree of this repository", async () => {
    const removed: string[] = [];
    const result = await clearDebris("/trees/other/nested", CTX, APPROVED, deps({ removed }));
    expect(result.ok).toBe(false);
    expect(removed).toEqual([]);
  });

  // ── A folder AROUND a worktree: no `.git` of its own, so every probe passes ──

  it("refuses a folder that contains the main worktree", async () => {
    // Create root ~/code, main checkout ~/code/group/app: ~/code/group has no
    // `.git`, and its one entry is the repository itself.
    const removed: string[] = [];
    const ctx = { mainWorktree: "/code/group/app", linkedWorktrees: [] };
    const approval = { identity: "1:2", entries: ["app"] };
    const result = await clearDebris(
      "/code/group",
      ctx,
      approval,
      deps({ removed, lstat: () => statLike(1, 2), readdir: (p) => (p === "/code/group" ? ["app"] : []) }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("main worktree");
    expect(removed).toEqual([]);
  });

  it("refuses a folder that contains another worktree of this repository", async () => {
    const removed: string[] = [];
    const result = await clearDebris(
      "/trees",
      CTX,
      { identity: "1:2", entries: ["other"] },
      deps({ removed, lstat: () => statLike(1, 2), readdir: (p) => (p === "/trees" ? ["other"] : []) }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("contains another worktree");
    expect(removed).toEqual([]);
  });

  it("refuses where a repository sits two levels down", async () => {
    const removed: string[] = [];
    const result = await clearDebris(
      PATH,
      CTX,
      APPROVED,
      deps({
        removed,
        readdir: (p) =>
          p === PATH ? APPROVED.entries : p === `${PATH}/src` ? ["vendor"] : p === `${PATH}/src/vendor` ? [".git"] : [],
      }),
    );
    expect(result.ok === false && result.reason).toContain("“src/vendor”");
    expect(removed).toEqual([]);
  });

  it("refuses a folder that contains the repository's separate git directory", async () => {
    // `--separate-git-dir`: the common dir lives outside the main worktree.
    const removed: string[] = [];
    const ctx = { mainWorktree: "/code/app", linkedWorktrees: [], commonDir: "/code/group/app.git" };
    const result = await clearDebris(
      "/code/group",
      ctx,
      { identity: "1:2", entries: ["app.git"] },
      deps({ removed, lstat: () => statLike(1, 2), readdir: (p) => (p === "/code/group" ? ["app.git"] : []) }),
    );
    expect(result.ok === false && result.reason).toContain("git directory");
    expect(removed).toEqual([]);
  });

  it("refuses where an immediate entry is a repository this context does not know", async () => {
    const removed: string[] = [];
    const result = await clearDebris(
      PATH,
      CTX,
      APPROVED,
      deps({ removed, readdir: (p) => (p === PATH ? APPROVED.entries : p === `${PATH}/src` ? [".git"] : []) }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("“src”");
    expect(removed).toEqual([]);
  });

  it("refuses where a directory beneath it could not be listed", async () => {
    const removed: string[] = [];
    const result = await clearDebris(
      PATH,
      CTX,
      APPROVED,
      deps({ removed, readdir: (p) => (p === PATH ? APPROVED.entries : p === `${PATH}/src` ? null : []) }),
    );
    expect(result.ok).toBe(false);
    expect(removed).toEqual([]);
  });

  it("refuses where an immediate entry could not be read", async () => {
    const removed: string[] = [];
    const result = await clearDebris(
      PATH,
      CTX,
      APPROVED,
      deps({ removed, lstat: (p) => (p === `${PATH}/src` ? null : statLike(1, 2)) }),
    );
    expect(result.ok).toBe(false);
    expect(removed).toEqual([]);
  });

  it("does not probe beneath an entry that is a symlink or a file", async () => {
    // The removal does not follow a symlink, and a file holds no `.git` — a
    // probe there would read ENOTDIR as "unknown" and refuse ordinary debris.
    const removed: string[] = [];
    const result = await clearDebris(
      PATH,
      CTX,
      APPROVED,
      deps({
        removed,
        lstat: (p) =>
          p === `${PATH}/node_modules`
            ? statLike(1, 2, true, true)
            : p === `${PATH}/src`
              ? statLike(1, 2, false)
              : statLike(1, 2),
        probeEntry: (p) => (p === PATH || p.endsWith("/repo-feat/.git") ? "absent" : "present"),
        // A repository behind the symlink and "inside" the file: neither is walked into.
        readdir: (p) => (p === PATH ? APPROVED.entries : [".git"]),
      }),
    );
    expect(result).toEqual({ ok: true });
    expect(removed).toEqual([PATH]);
  });

  // ── round-1 B4: the approved CONTENTS, re-read at the boundary ──

  it("[B4] refuses where an entry appeared since the authorization was issued", async () => {
    // The redemption compared an entry set read several awaits ago. Between
    // that read and the delete another process can write, and the removal is
    // recursive — so the comparison is retaken here or it is not a bound.
    const removed: string[] = [];
    const result = await clearDebris(
      PATH,
      CTX,
      APPROVED,
      deps({ removed, readdir: (p) => (p === PATH ? ["node_modules", "src", "UNSAVED-WORK.md"] : []) }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("UNSAVED-WORK.md");
    expect(removed).toEqual([]);
  });

  it("[B4] proceeds where an approved entry disappeared — fewer is still covered", async () => {
    const removed: string[] = [];
    const result = await clearDebris(
      PATH,
      CTX,
      APPROVED,
      deps({ removed, readdir: (p) => (p === PATH ? ["src"] : []) }),
    );
    expect(result).toEqual({ ok: true });
    expect(removed).toEqual([PATH]);
  });

  it("[B4] refuses where the contents could not be read at the boundary", async () => {
    const removed: string[] = [];
    const result = await clearDebris(PATH, CTX, APPROVED, deps({ removed, readdir: () => null }));
    expect(result.ok).toBe(false);
    expect(removed).toEqual([]);
  });

  // ── round-1 B5: the component walk, retaken where the delete happens ──

  it("[B5] refuses where a component above the destination is a symlink", async () => {
    // § 2.2: a symlinked component means the thing deleted is not the thing
    // validated. The create validator walked before several awaits; this walk
    // is the one that describes the delete.
    const removed: string[] = [];
    const result = await clearDebris(
      PATH,
      CTX,
      APPROVED,
      deps({ removed, lstat: (p) => statLike(1, 2, true, p === "/trees") }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("/trees");
    expect(removed).toEqual([]);
  });

  it("[B5] refuses where a component could not be read", async () => {
    const removed: string[] = [];
    const result = await clearDebris(
      PATH,
      CTX,
      APPROVED,
      deps({ removed, lstat: (p) => (p === "/trees" ? null : statLike(1, 2)) }),
    );
    expect(result.ok).toBe(false);
    expect(removed).toEqual([]);
  });

  // ── round-1 B6: success is proven absence, never an unreadable directory ──

  it("[B6] refuses to call the clearance complete when the destination is still there", async () => {
    const result = await clearDebris(PATH, CTX, APPROVED, {
      ...deps(),
      probeEntry: (p) => (p.endsWith(".git") ? "absent" : "present"),
      readdir: (p) => (p === PATH ? ["locked.db"] : APPROVED.entries),
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("locked.db");
  });

  it("[B6] refuses where the destination's absence could not be proven", async () => {
    // An unreadable directory is not a cleared one. Reading the failure as
    // success is how a create starts describing a destination still on disk.
    const result = await clearDebris(PATH, CTX, APPROVED, {
      ...deps(),
      probeEntry: (p) => (p.endsWith(".git") ? "absent" : "unknown"),
    });
    expect(result.ok).toBe(false);
  });

  it("[round-2 W3] names the survivors of a removal that threw partway", async () => {
    // A recursive removal can delete half a tree and then reject. The error
    // alone tells the user a delete failed and not what it left behind.
    const result = await clearDebris(PATH, CTX, APPROVED, {
      ...deps(),
      readdir: (p) => (p === PATH ? ["node_modules"] : []),
      remove: async () => {
        throw new Error("EPERM");
      },
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("EPERM");
    expect(result.ok === false && result.reason).toContain("node_modules");
  });

  it("reports a removal that threw, rather than claiming the path is clear", async () => {
    const result = await clearDebris(
      PATH,
      CTX,
      APPROVED,
      deps({
        remove: async () => {
          throw new Error("EPERM");
        },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("EPERM");
  });

  it("takes every bound reading with no await between it and the removal", async () => {
    // The ordering IS the guard (design.md D3, round-1 B4/B5). Anything awaited
    // between the last check and the removal is a window where the directory
    // can be replaced, so this asserts the sequence rather than trusting the
    // source — and every reading before `remove` is synchronous by type.
    const order: string[] = [];
    await clearDebris(PATH, CTX, APPROVED, {
      lstat: (p) => {
        order.push(`lstat:${p}`);
        return statLike(1, 2);
      },
      probeEntry: (p) => {
        order.push(p.endsWith(".git") ? "git" : "gone?");
        return "absent";
      },
      readdir: (p) => {
        order.push(`readdir:${p}`);
        return p === PATH ? APPROVED.entries : [];
      },
      remove: async (p: string) => {
        order.push(`remove:${p}`);
      },
    });
    expect(order).toEqual([
      "lstat:/trees",
      `lstat:${PATH}`,
      `lstat:${PATH}`,
      "git",
      `readdir:${PATH}`,
      // The repository scan, still before the removal and still synchronous.
      `lstat:${PATH}/node_modules`,
      `lstat:${PATH}/src`,
      `readdir:${PATH}/node_modules`,
      `readdir:${PATH}/src`,
      `remove:${PATH}`,
      "gone?",
    ]);
  });
});
