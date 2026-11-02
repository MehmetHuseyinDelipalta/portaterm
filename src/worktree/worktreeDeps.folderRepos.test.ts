// src/worktree/worktreeDeps.folderRepos.test.ts — the production discovery deps
// carry a folder memo bound to the real filesystem (perf C7).

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorktreeTreeDeps } from "./worktreeDeps";

let root: string | undefined;
afterEach(() => {
  if (root) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("createWorktreeTreeDeps", () => {
  it("remembers folders under stamps read from the real filesystem", async () => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "worktree-deps-")));
    fs.mkdirSync(path.join(root, "repo", ".git"), { recursive: true });
    fs.mkdirSync(path.join(root, "link-target"));
    fs.symlinkSync(path.join(root, "repo"), path.join(root, "link"));
    const memo = createWorktreeTreeDeps().folderRepos;
    expect(await memo?.stampOf(path.join(root, "link"))).toMatch(
      new RegExp(`^dir ${path.join(root, "repo", ".git")} \\d+ -$`),
    );
  });
});
