// src/worktree/describeGitFailure.ts — One wording for every failed git call.
// See: asimov/changes/fix-worktree-freshness-contract/design.md D1
//
// The reason string reaches the user as a repository's degraded affordance, so a
// listing that failed and a resolution that failed must not describe the same
// condition two different ways. The command name is a parameter because that is
// the only part that legitimately differs.

import type { GitCommandResult } from "./gitCommandRunner";

export function describeGitFailure(result: GitCommandResult, command: string): string {
  if (result.timedOut) {
    return `\`${command}\` timed out.`;
  }
  // Before the spawn failure it is reported as: a folder that is gone is not a
  // missing git, and saying it is sends the user to reinstall git.
  if (result.cwdProblem !== undefined) {
    const { path, kind } = result.cwdProblem;
    return kind === "missing" ? `The folder \`${path}\` does not exist.` : `The folder \`${path}\` cannot be opened.`;
  }
  if (result.failedToSpawn) {
    return "No usable `git` executable was found.";
  }
  const detail = result.stderr.trim().split("\n")[0];
  return detail.length > 0 ? detail : `\`${command}\` exited with code ${result.code}.`;
}
