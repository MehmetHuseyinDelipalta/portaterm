// src/session/resolveClaudeSession.ts — Map a terminal pane to the Claude
// `sessionId` it is showing. Resolution order (design.md D4 / spec "Map a
// terminal to its Claude session"):
//   1. process subtree of the pane's pty ∩ running PID registry (exact pid;
//      tie-break newest <sessionId>.jsonl mtime when >1);
//   2. running registry entries whose cwd equals the pane's live cwd (newest
//      mtime) — ONLY when step 1 could not be asked. A process table that
//      answered names every pid on the machine, so a running session it did not
//      place under this pty is a session this pane does not hold: matching it on
//      the directory it happens to share is not weaker evidence, it is evidence
//      already refuted (260906-at-session-owner-other-window);
//   3. newest Claude session recorded under that cwd (even if already exited) —
//      still reached after a conclusive step 1, because an EXITED session's
//      transcript has no pid for the table to have refuted. A LIVE session's
//      does: the registry pairs it with one, and step 3 must skip it or the
//      identity step 2 just refused walks back in through the disk
//      (round-1 F001).
//
// SessionManager + reader access is injected via `deps` so the algorithm is
// unit-tested without the host. The host (TerminalViewProvider) wires the real
// implementations; on Windows the subtree is `unknown` so the cwd fallbacks run.

import type { RunningClaudeSession, RunningSessionIndex } from "../vault/readers/runningSessions";

/**
 * Which step matched, and so how much the match is worth.
 *
 * `reported` is the agent's own word, carried back over the credential issued
 * to one terminal. `process` is this window's reading of the machine — the
 * claude pid inside this pane's pty subtree, and no other pane's. `directory`
 * and `recent` are guesses that any pane sitting in the same directory would
 * have made, so a caller with more than one pane can only settle a contested
 * session by knowing which kind it holds.
 */
export type ClaudeSessionEvidence = "reported" | "process" | "directory" | "recent";

/** Strongest first. A contested session goes to a strictly higher rank, never to a tie. */
export const EVIDENCE_RANK: Record<ClaudeSessionEvidence, number> = {
  reported: 3,
  process: 2,
  directory: 1,
  recent: 0,
};

/**
 * What this window's process table could say about a pane's pty subtree.
 *
 * `known` with no pids is an ANSWER — this pty holds nothing — and is what lets
 * step 2 stand down. It is not the same claim as `unknown`, which is a platform
 * or a `ps` that could not be asked; collapsing the two is what let a pane claim
 * a session another application was running.
 */
export type PaneSubtree = { kind: "known"; pids: readonly number[] } | { kind: "unknown" };

export interface ResolvedClaudeSession {
  sessionId: string;
  cwd: string;
  evidence: ClaudeSessionEvidence;
}

export interface ResolveClaudeSessionDeps {
  /** The pane's pty pid (subtree root), or undefined when the session is unknown. */
  getPtyPid(terminalId: string): number | undefined;
  /** The pane's best-available cwd (live → tracked → initial), or undefined. */
  getCwd(terminalId: string): Promise<string | undefined>;
  /**
   * Live, liveness-probed PID registry, keyed for lookup (runningSessions.ts).
   *
   * An index rather than a list because the registry is user-wide: scanning it
   * per pane made a presence rebuild grow with every Claude session on the
   * machine (.reviews/round-2.md W1).
   */
  runningIndex(): Promise<RunningSessionIndex>;
  /**
   * Descendant pids of a root pid, or `unknown` where no process table was
   * reachable (Windows, a missing or timed-out `ps`). The distinction is the
   * point: a caller that cannot tell "this pty holds nothing" from "we could not
   * look" has no way to know when a directory match has already been refuted.
   */
  paneSubtree(rootPid: number): Promise<PaneSubtree>;
  /** mtime (epoch ms) of `<sessionId>.jsonl`, or undefined when unresolved. */
  sessionMtime(sessionId: string): Promise<number | undefined>;
  /**
   * Newest Claude session (running or exited) recorded under `cwd`, or null.
   *
   * `exclude` names session ids this pane has been proven NOT to hold. Skipping
   * them is the selector's job rather than the caller's: a caller can only drop
   * the one answer it was handed, which would let a refuted live transcript mask
   * an older exited one that is genuinely eligible.
   */
  newestSessionUnderCwd(cwd: string, exclude: ReadonlySet<string>): Promise<{ sessionId: string; cwd: string } | null>;
}

/** Among candidates, the one with the newest `<sessionId>.jsonl` mtime (current
 *  activity beats launch order); first candidate wins when all mtimes are equal. */
async function pickNewest(
  candidates: readonly RunningClaudeSession[],
  sessionMtime: ResolveClaudeSessionDeps["sessionMtime"],
): Promise<RunningClaudeSession> {
  let best = candidates[0];
  let bestMtime = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    const mtime = (await sessionMtime(candidate.sessionId)) ?? 0;
    // Stable secondary key (lexical sessionId) so equal mtimes resolve the same
    // way regardless of readdir/scan order.
    if (mtime > bestMtime || (mtime === bestMtime && candidate.sessionId < best.sessionId)) {
      best = candidate;
      bestMtime = mtime;
    }
  }
  return best;
}

const EMPTY_EXCLUSION: ReadonlySet<string> = new Set();

export async function resolveClaudeSession(
  terminalId: string,
  deps: ResolveClaudeSessionDeps,
): Promise<ResolvedClaudeSession | null> {
  // Headless runs are filtered at index build, not per step: a hook-spawned
  // `claude -p` is a descendant of this pty AND shares its cwd, so it can
  // hijack steps 1 and 2 alike, and its just-written transcript wins the mtime
  // tie-break. Step 3 reads from disk where no entrypoint exists — design.md D3.
  const running = await deps.runningIndex();

  // Step 1 — exact: the claude node pid is a descendant of the pane's pty shell.
  // `refuted` records that the table ANSWERED and placed no running session here.
  let refuted = false;
  const ptyPid = deps.getPtyPid(terminalId);
  if (ptyPid !== undefined) {
    const subtree = await deps.paneSubtree(ptyPid);
    if (subtree.kind === "known") {
      const inTree = running.byPid(new Set(subtree.pids));
      if (inTree.length === 1) {
        return { sessionId: inTree[0].sessionId, cwd: inTree[0].cwd, evidence: "process" };
      }
      if (inTree.length > 1) {
        const best = await pickNewest(inTree, deps.sessionMtime);
        return { sessionId: best.sessionId, cwd: best.cwd, evidence: "process" };
      }
      refuted = true;
    }
  }

  // Steps 2 & 3 — cwd fallbacks. The pane's live cwd is the SHELL's cwd and may
  // differ from a registry launch cwd if the shell cd'd; a miss degrades to step 3.
  const cwd = await deps.getCwd(terminalId);
  if (cwd === undefined) {
    return null;
  }
  // Step 2 stands down once the table has spoken: every candidate it offers is a
  // LIVE session with a pid, and the same read that failed to find one under this
  // pty found all of them somewhere else.
  const byCwd = refuted ? [] : running.byCwd(cwd);
  if (byCwd.length > 0) {
    const best = await pickNewest(byCwd, deps.sessionMtime);
    return { sessionId: best.sessionId, cwd: best.cwd, evidence: "directory" };
  }
  // Step 3 reads from disk, where a session that is still RUNNING also has a
  // transcript — and the registry pairs that transcript with the pid the table
  // just placed elsewhere. Without this the identity step 2 refused returns by
  // the other door, relabelled `recent`.
  const excluded: ReadonlySet<string> = refuted
    ? new Set(running.all().map((session) => session.sessionId))
    : EMPTY_EXCLUSION;
  const recent = await deps.newestSessionUnderCwd(cwd, excluded);
  // Re-checked here rather than trusted: a selector that ignores `exclude` would
  // otherwise hand back exactly the identity this function has already refused.
  if (recent === null || excluded.has(recent.sessionId)) {
    return null;
  }
  return { ...recent, evidence: "recent" };
}
