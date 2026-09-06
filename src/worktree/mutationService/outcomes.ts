// src/worktree/mutationService/outcomes.ts — The two pure projections the
// facade and its extracted modules both read.
//
// Neither is a module's own: `settled` turns a git result into a report and is
// read by lock, unlock, prune, create and — through 1_3 — reattach; `paths`
// narrows a resolved target to the pair every git verb takes. Lifted here by
// change `decompose-worktree-mutation-service` (design.md D4, task 1_2) rather
// than left on the facade, because a module importing them back from the facade
// it is imported BY is a runtime cycle, and a copy in each module is two
// definitions of one answer.
//
// Types only from the facade, so nothing here participates in an import cycle.

import type { MutationOutcome, MutationVerb, ResolvedTarget } from "../worktreeMutationService";
import type { MutationResult } from "../worktreeMutations";

/** A git verb's result as the report the surface publishes. */
export function settled(verb: MutationVerb, repoId: string, result: MutationResult): MutationOutcome {
  return result.ok ? { kind: "ok", verb, repoId } : { kind: "error", verb, repoId, message: result.message };
}

/** The two paths every worktree-scoped git command takes, and nothing else. */
export function paths(t: ResolvedTarget): { repoPath: string; worktreePath: string } {
  return { repoPath: t.repoPath, worktreePath: t.worktreePath };
}
