// src/providers/worktreeHost/mutationSupport.ts — Everything the mutation
// service asks the host, answered from the listing the host already holds.
//
// Extracted from `createWorktreeHost` by change `decompose-worktree-host`
// (design.md D1, task 2_19). The types module `mutationBindings.ts` was split
// out for this consumer by task 2_1; this is its implementation.
//
// Every answer here is a READ of the current listing plus, for the removal
// assessment, four independent probes taken as ONE suspension point. A serial
// await is another moment a rebuild can land and replace the listing every
// later line is derived from, which is the window round-9 B8 closed.

import type { IgnoredMaterial } from "../../worktree/ignoredMaterial";
import type { MigrationRepositoryBinding } from "../../worktree/migrateChanges";
import type { WorktreePresence } from "../../worktree/presenceTypes";
import type { WorktreeInfo, WorktreeRepo } from "../../worktree/types";
import type { WorktreeCache } from "../../worktree/WorktreeCache";
import { evaluateRemoval } from "../../worktree/worktreeBlockers";
import { observationOf } from "./hostLookups";
import type { WorktreeHostOptions } from "./hostOptions";
import type { WorktreeMutationBindings } from "./mutationBindings";

export interface MutationSupportDeps {
  options: Pick<WorktreeHostOptions, "deps" | "removalFacts">;
  cache: Pick<WorktreeCache, "read">;
  /** The rebuild gate, so a mutation can force the listing it just changed. */
  gate: { request(scope: string, opts: { force?: boolean }): Promise<unknown> | unknown };
  /** The listing lookups (task 2_5). */
  locate(worktreeId: string): { repo: WorktreeRepo; wt: WorktreeInfo } | null;
  repoById(repoId: string): WorktreeRepo | undefined;
  presence(): WorktreePresence;
  currentMigrationRegistration(repoId: string): MigrationRepositoryBinding["registration"] | undefined;
}

/** The narrow read surface the mutation service is handed (design.md D1). */
export function createMutationSupport(deps: MutationSupportDeps): WorktreeMutationBindings {
  return {
    forceRebuild: async (repoId) => {
      await deps.gate.request(repoId, { force: true });
    },
    resolve: (target) => {
      const found = deps.locate(target.worktreeId);
      if (found === null || found.repo.repoId !== target.repoId) {
        return null;
      }
      return {
        repoPath: found.repo.mainPath,
        // git's own string, never the normalized id.
        worktreePath: found.wt.displayPath,
        // The head this registration is on. It is not a perfect incarnation
        // marker — a recreate onto the same commit repeats it — but it is the
        // strongest one a listing carries, and it is strictly better than the
        // path alone that B5 found (worktree-model.md).
        incarnation: `${found.wt.head ?? ""}:${found.wt.branch ?? ""}`,
        locked: found.wt.locked === true,
        wasRegistered: true,
        existedOnDisk: found.wt.missing !== true,
      };
    },
    repoPath: (repoId) => deps.cache.read().repos.find((r) => r.repoId === repoId)?.mainPath ?? null,
    migrationRegistration: deps.currentMigrationRegistration,
    // The claim a launch is admitted against, published as its value and
    // never derived from `degraded` (round-2 B7, round-7 W8, design.md D12).
    observation: (repoId) => observationOf(deps.repoById(repoId)),
    createContext: (repoId) => {
      const repo = deps.cache.read().repos.find((r) => r.repoId === repoId);
      if (repo === undefined) {
        return null;
      }
      return {
        mainWorktree: repo.mainPath,
        // The common dir: outside main under `--separate-git-dir`, and a folder
        // around it holds every worktree's objects.
        commonDir: repo.repoId,
        // LINKED only — a path inside main is where the default root lives.
        linkedWorktrees: repo.worktrees.filter((w) => w.id !== repo.mainPath).map((w) => w.id),
      };
    },
    assessRemoval: async (target) => {
      const found = deps.locate(target.worktreeId);
      const facts = deps.options.removalFacts;
      if (found === null || found.repo.repoId !== target.repoId || facts === undefined) {
        return null;
      }
      const observed = observationOf(found.repo);
      // Run in the worktree itself, not the repo: `--porcelain` is what names
      // the files a force would destroy, and that is per worktree.
      //
      // Not run at all when the directory is gone. Asking an absent cwd for
      // its status fails every time, which D16 correctly reported as
      // `unavailable` — permanently, on the one worktree state whose ONLY
      // remedy is the removal that prunes its registration (round-3 B8).
      // All four TOGETHER, not one after another. They are independent, and
      // each serial await is another moment a rebuild can land and replace the
      // listing everything below is derived from — the window round-9 B8
      // closed. Awaiting them as one suspension point is what kept adding the
      // ignored walk from widening it (round-1 B2 fix round).
      //
      // Neither the status nor the ignored walk runs when the directory is
      // gone. Asking an absent cwd for its status fails every time, which D16
      // correctly reported as `unavailable` — permanently, on the one worktree
      // state whose ONLY remedy is the removal that prunes its registration
      // (round-3 B8). A measured zero is the honest answer for the walk: there
      // is no directory, so there is no ignored material to delete.
      // Held so the proofs can await the SAME read rather than take their
      // own. Both entries below join one `Promise.all`, so this adds a read
      // to the assessment and not a suspension point (design.md D7).
      const sessionsRead = facts.sessions();
      const [status, ignored, sessions, panes, claimedByPane, proofs] = await Promise.all([
        // Run in the worktree itself, not the repo: `--porcelain` is what
        // names the files a force would destroy, and that is per worktree.
        found.wt.missing
          ? Promise.resolve(null)
          : deps.options.deps.runner.run(["status", "--porcelain"], found.wt.displayPath),
        found.wt.missing
          ? Promise.resolve<IgnoredMaterial>({ kind: "measured", entries: 0, bytes: 0 })
          : facts.ignored(found.wt.displayPath),
        sessionsRead,
        facts.panes(),
        facts.claimedByPane(),
        // A missing worktree is answered without touching the disk: no
        // directory means no lock file and no branch to compare, so only the
        // ownership proof is answered — from the registry read taken anyway.
        facts.proofs(
          found.wt.missing
            ? { path: found.wt.id, locked: false }
            : {
                path: found.wt.id,
                locked: found.wt.locked,
                ...(found.wt.branch === undefined ? {} : { branch: found.wt.branch }),
              },
          sessionsRead,
        ),
      ]);
      // Round-9 B8: those two reads take real time, and a rebuild landing in
      // between replaces the listing everything below is derived from — the
      // siblings, and the target itself. An assessment spanning two
      // observations belongs to neither, so it reports the listing unreadable
      // rather than answering from a mixture of them.
      const stillObserved = observed !== undefined && observationOf(deps.repoById(target.repoId)) === observed;
      return evaluateRemoval({
        target: found.wt,
        siblings: found.repo.worktrees,
        panes,
        rows: deps.presence().rowsByWorktreeId[target.worktreeId] ?? [],
        // Every read that can fail is carried as a read, not as its benign
        // fallback. A failed status is not a clean worktree (round-2 B6).
        sessions,
        claimedByPane,
        proofs,
        ignored,
        porcelain:
          status === null
            ? { ok: "notApplicable" }
            : status.code === 0 && !status.timedOut
              ? { ok: true, value: status.stdout.toString("utf8") }
              : { ok: false },
        // The same claim `observeAfter` asks after the attempt, so a removal
        // cannot be authorized under one reading and classified under another.
        listingDegraded: !stillObserved,
      });
    },
  };
}
