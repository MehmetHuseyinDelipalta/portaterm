// src/vault/pinnedVaultSessions.ts — Which vault sessions pinned tabs are running.
//
// The tab pin is the only source of truth: a vault row reads as pinned exactly
// while a pinned tab runs its session, and nothing here is persisted. Each pane
// of a pinned tab names its session three ways, strongest first:
//   1. what its agent reported through the hooks (Claude, OpenCode);
//   2. the Claude process running inside its pty, matched against the live
//      `~/.claude/sessions` registry — so a `claude` typed by hand counts with
//      the hooks off. Only that exact match counts: the directory and
//      newest-transcript guesses the resolver also knows would pin a session
//      the pane does not hold;
//   3. the entry its vault launch resumed.
// The first two say what is running now; the third, what the tab started as.

import type { ProcessTableSnapshot } from "../pty/processTableSnapshot";
import { type PaneSubtree, resolveClaudeSession } from "../session/resolveClaudeSession";
import { indexRunningSessionsOrEmpty, type RunningSessionsOutcome } from "./readers/runningSessions";
import { formatEntryId } from "./types";

/** One live pane of a pinned tab. */
export interface PinnedTabPane {
  paneId: string;
  /** The entry this pane's vault launch resumed, if it was one. */
  vaultEntryId?: string;
}

/**
 * The entry ids pinned tabs are running, sorted and de-duplicated.
 *
 * `runningEntryId` answers what a pane is running now (a hook report, or its
 * Claude process), already in entry form; a pane with neither that nor a
 * resumed entry contributes nothing.
 */
export function pinnedEntryIds(
  panes: readonly PinnedTabPane[],
  runningEntryId: (paneId: string) => string | undefined,
): string[] {
  const ids = new Set<string>();
  for (const pane of panes) {
    const entryId = runningEntryId(pane.paneId) ?? pane.vaultEntryId;
    if (entryId) {
      ids.add(entryId);
    }
  }
  return [...ids].sort();
}

/**
 * The first live pane running `entryId`, read with the same precedence as
 * `pinnedEntryIds`: what the pane reports running now outranks what its vault
 * launch resumed, so a pane whose agent moved to another session no longer
 * claims the one it started as.
 */
export function livePaneForEntry<P extends PinnedTabPane>(
  panes: readonly P[],
  runningEntryId: (paneId: string) => string | undefined,
  entryId: string,
): P | undefined {
  return panes.find((pane) => (runningEntryId(pane.paneId) ?? pane.vaultEntryId) === entryId);
}

export interface PinnedIdentitySources {
  /** A pane's hook-reported session, in entry form. */
  reported(paneId: string): string | undefined;
  /** A pane's pty pid, the root of the process subtree a Claude must sit under. */
  ptyPid(paneId: string): number | undefined;
  /** Claude session ids found running under the given ptys, by paneId. */
  claudeByProcess(panes: ReadonlyArray<{ paneId: string; ptyPid: number }>): Promise<ReadonlyMap<string, string>>;
}

export interface PinnedResolution {
  /** Entry ids pinned tabs are running, sorted. */
  entryIds: string[];
  /**
   * Claude sessions found RUNNING under a pinned pane's pty, by paneId — the
   * process table's word, never a hook report alone, since a report outlives
   * the Claude that made it. What a restore may safely resume.
   */
  claudeByPane: ReadonlyMap<string, string>;
}

/**
 * Resolve the pinned set. The process table is read once for every pinned
 * pane with a pty, and not at all when nothing is pinned — a window without
 * pins costs no `ps`.
 */
export async function resolvePinnedEntryIds(
  panes: readonly PinnedTabPane[],
  sources: PinnedIdentitySources,
): Promise<PinnedResolution> {
  const withPty: Array<{ paneId: string; ptyPid: number }> = [];
  for (const pane of panes) {
    const ptyPid = sources.ptyPid(pane.paneId);
    if (ptyPid !== undefined) {
      withPty.push({ paneId: pane.paneId, ptyPid });
    }
  }
  const byProcess = withPty.length > 0 ? await sources.claudeByProcess(withPty) : new Map<string, string>();
  const entryIds = pinnedEntryIds(panes, (paneId) => {
    const reported = sources.reported(paneId);
    if (reported !== undefined) {
      return reported;
    }
    const claudeSessionId = byProcess.get(paneId);
    return claudeSessionId === undefined ? undefined : formatEntryId("claude", claudeSessionId);
  });
  return { entryIds, claudeByPane: byProcess };
}

/**
 * Find the Claude session each pty is running from the process table and the
 * live registry: one registry read and one table per call, shared by every pane.
 *
 * A pane whose table read failed, or a platform with no table (Windows), names
 * nothing — the cwd fallbacks are deliberately not consulted.
 */
export function createClaudeProcessLookup(deps: {
  table: ProcessTableSnapshot;
  listRunning: () => Promise<RunningSessionsOutcome>;
  sessionMtime: (sessionId: string) => Promise<number | undefined>;
}): PinnedIdentitySources["claudeByProcess"] {
  return async (panes) => {
    const running = indexRunningSessionsOrEmpty(deps.listRunning());
    const reading = await deps.table.open();
    const found = new Map<string, string>();
    for (const pane of panes) {
      const outcome = reading.descendantsOf(pane.ptyPid);
      if (outcome.kind !== "ok") {
        continue;
      }
      const subtree: PaneSubtree = { kind: "known", pids: outcome.pids };
      const session = await resolveClaudeSession(pane.paneId, {
        getPtyPid: () => pane.ptyPid,
        // No cwd: steps 2 and 3 are guesses, and a guess here would pin a row.
        getCwd: async () => undefined,
        runningIndex: () => running,
        paneSubtree: async () => subtree,
        sessionMtime: deps.sessionMtime,
        newestSessionUnderCwd: async () => null,
      });
      if (session?.evidence === "process") {
        found.set(pane.paneId, session.sessionId);
      }
    }
    return found;
  };
}

export interface PinnedVaultPublisher {
  /** Recompute soon; posts only if the set changed. Coalesces bursts. */
  refresh(): void;
  /** The last published set, for a surface that has just asked for the vault list. */
  current(): string[];
  dispose(): void;
}

/**
 * Publish the pinned set to the vault surfaces when it changes.
 *
 * Refreshes are deferred to a microtask: the triggers fire mid-mutation (a pane
 * is announced before its session is registered) and in bursts (every pane
 * evidence change), and the deferred pass reads the settled state once. The
 * pass is asynchronous (the process table), so at most one runs at a time; a
 * refresh that arrives meanwhile runs one more pass after it, never a second
 * concurrent one.
 */
export function createPinnedVaultPublisher(deps: {
  compute: () => Promise<string[]> | string[];
  post: (entryIds: string[]) => void;
  schedule?: (run: () => void) => void;
  onError?: (err: unknown) => void;
}): PinnedVaultPublisher {
  const schedule = deps.schedule ?? queueMicrotask;
  let published: string[] = [];
  let scheduled = false;
  let running = false;
  let again = false;
  let disposed = false;

  async function pass(): Promise<void> {
    running = true;
    try {
      const next = await deps.compute();
      if (!disposed && JSON.stringify(next) !== JSON.stringify(published)) {
        published = next;
        deps.post(next);
      }
    } catch (err) {
      deps.onError?.(err);
    } finally {
      running = false;
    }
    if (again && !disposed) {
      again = false;
      start();
    }
  }

  function start(): void {
    if (scheduled || disposed) {
      return;
    }
    scheduled = true;
    schedule(() => {
      scheduled = false;
      if (disposed) {
        return;
      }
      if (running) {
        again = true;
        return;
      }
      void pass();
    });
  }

  return {
    refresh() {
      if (running) {
        again = true;
        return;
      }
      start();
    },
    current() {
      return published;
    },
    dispose() {
      disposed = true;
    },
  };
}
