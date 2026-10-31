// src/providers/worktreeHost/mutationSupport.test.ts — the create context the
// host hands the mutation service.

import { describe, expect, it } from "vitest";
import type { WorktreeRepo } from "../../worktree/types";
import { createMutationSupport, type MutationSupportDeps } from "./mutationSupport";

function supportFor(repos: WorktreeRepo[]) {
  return createMutationSupport({
    options: {} as MutationSupportDeps["options"],
    cache: { read: () => ({ repos }) } as unknown as MutationSupportDeps["cache"],
    gate: { request: () => undefined },
    locate: () => null,
    repoById: (id) => repos.find((r) => r.repoId === id),
    presence: () => ({}) as never,
    currentMigrationRegistration: () => undefined,
  });
}

describe("createMutationSupport.createContext", () => {
  it("carries the git common dir, so a folder around a separate git dir is never debris", () => {
    // `--separate-git-dir`: the common dir is not inside the main worktree.
    const repo = {
      repoId: "/code/group/app.git",
      mainPath: "/code/app",
      worktrees: [{ id: "/code/app" }, { id: "/code/app-feat" }],
    } as unknown as WorktreeRepo;

    expect(supportFor([repo]).createContext("/code/group/app.git")).toEqual({
      mainWorktree: "/code/app",
      commonDir: "/code/group/app.git",
      linkedWorktrees: ["/code/app-feat"],
    });
  });

  it("answers null for a repository it does not list", () => {
    expect(supportFor([]).createContext("/nope/.git")).toBeNull();
  });
});
