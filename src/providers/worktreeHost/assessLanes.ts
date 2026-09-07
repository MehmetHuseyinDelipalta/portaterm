// src/providers/worktreeHost/assessLanes.ts — The per-repository queue that
// bounds how many removal assessments this window can have in flight.
//
// Extracted from `createWorktreeHost` by change `decompose-worktree-host`
// (design.md D1, task 2_4). The lane, its rotation and the job that drains it
// were five functions spread through the closure, so "does a panel asking
// continuously starve the other one" could only be asked by attaching two
// surfaces to a whole host.
//
// The prefix on the one warning it emits belongs to the window, not to this
// module, so it arrives as `logWarn` rather than being restated here.

import type { WorktreeActions, WorktreeSurface } from "./hostTypes";

/**
 * Assessment admission, one lane per REPOSITORY (design.md D1).
 *
 * A removal assessment runs inside `coordinator.run`, so every one of them is
 * a job on that repository's mutation queue, ahead of any lock, unlock,
 * remove, prune or create queued behind it. The queue is deliberately
 * non-coalescing (`keyedSerialQueue.ts`), so the bound has to live here.
 *
 * Keyed by repository because that is what the queue is keyed by. A slot per
 * `(surface, repository)` was drafted and refuted: detaching a surface
 * deletes its record but cannot retract a job already appended, so attach →
 * ask → detach repeated N times left N jobs queued with nothing attached.
 *
 * At most ONE job per repository exists at a time. Further requests rewrite
 * `pending` and enqueue nothing; the job re-enqueues itself while anything is
 * still owed. Service is round-robin over `rotation`, not newest-first: two
 * panels asking continuously must each be answered.
 */
export type PendingAssess =
  | {
      kind: "assessment";
      surface: WorktreeSurface;
      worktreeId: string;
      token: string;
    }
  | {
      kind: "rawRemoval";
      surface: WorktreeSurface;
      worktreeId: string;
    };

interface AssessLane {
  /** The latest unanswered request per surface, keyed by `surfaceKey`. */
  pending: Map<string, PendingAssess>;
  /** Service order. A key joins when it first has a request and cycles when served. */
  rotation: string[];
  /** A job for this repository is enqueued or running. */
  outstanding: boolean;
}

type AssessCapability = NonNullable<WorktreeActions["assessRemovalReport"]>;

export interface AssessLanesDeps {
  /** This host's stable name for one surface. */
  surfaceKey(surface: WorktreeSurface): string;
  /** Is this surface still attached? A detached one cannot be answered. */
  attached(surface: WorktreeSurface): boolean;
  /** `options.actions`, read at call time rather than captured. */
  actions(): WorktreeActions | undefined;
  /** The path an id names, or `undefined` when it names nothing here. */
  actionPath(worktreeId: string, allowMissing: boolean): string | undefined;
  /** `console.warn` under the window's own log prefix. */
  logWarn(message: string, err: unknown): void;
}

export interface AssessLanes {
  /** Replace this surface's pending report request and enqueue at most one repository job. */
  admitAssess(repoId: string, request: PendingAssess): void;
  /** Everything one surface has pending, dropped when it detaches. */
  forgetSurfaceAssessments(key: string): void;
}

/**
 * The next request this lane owes, taken from the rotation rather than from
 * arrival order. Bounded by the rotation's length, so a lane holding only
 * departed surfaces terminates rather than spinning.
 */
function takeNextAssess(lane: AssessLane, attached: AssessLanesDeps["attached"]): PendingAssess | undefined {
  for (let guard = lane.rotation.length; guard > 0; guard -= 1) {
    const key = lane.rotation.shift();
    if (key === undefined) {
      break;
    }
    const request = lane.pending.get(key);
    // Nothing owed under this key any more, so it leaves the rotation.
    if (request === undefined) {
      continue;
    }
    lane.pending.delete(key);
    // A detached surface cannot be answered, and its request must not cost a
    // job. Dropped WITHOUT rejoining the rotation.
    if (!attached(request.surface)) {
      continue;
    }
    lane.rotation.push(key);
    return request;
  }
  return undefined;
}

/**
 * The other thing a lane slot can hold: a removal with no report at all, which
 * shares the queue only because it costs the same repository job.
 */
async function serveRawRemoval(
  deps: AssessLanesDeps,
  repoId: string,
  request: Extract<PendingAssess, { kind: "rawRemoval" }>,
): Promise<void> {
  const remove = deps.actions()?.removeWorktree;
  if (remove === undefined) {
    return;
  }
  try {
    await remove({ repoId, worktreeId: request.worktreeId, origin: request.surface }, undefined);
  } catch (err) {
    deps.logWarn("worktree action failed", err);
  }
}

/** Serve one report-producing request while its surface remains attached. */
async function serveAssess(deps: AssessLanesDeps, repoId: string, request: PendingAssess): Promise<void> {
  const { surface: origin, worktreeId } = request;
  if (request.kind === "rawRemoval") {
    await serveRawRemoval(deps, repoId, request);
    return;
  }

  const { token } = request;
  const unavailable = (unreadable: readonly string[]): void => {
    if (deps.attached(origin)) {
      origin.post({
        type: "worktreeRemoveAssessment",
        worktreeId,
        token,
        result: { kind: "unavailable", unreadable },
      });
    }
  };
  // Re-checked HERE as well as at admission: a request waits its turn in the
  // lane, and the registration can leave while it does.
  if (deps.actionPath(worktreeId, true) === undefined) {
    unavailable(["the worktree is no longer registered"]);
    return;
  }
  const assess = deps.actions()?.assessRemovalReport;
  if (assess === undefined) {
    unavailable(["the assessment"]);
    return;
  }
  let result: Awaited<ReturnType<AssessCapability>>;
  try {
    result = await assess({ repoId, worktreeId, origin });
  } catch {
    // Inventing an empty report would render a worktree of unknown risk as
    // one with none — but silence made an explicit destructive request look
    // inert, with no retry. The `unavailable` arm D8 already defines is the
    // honest third answer (D12).
    //
    // Scoped to the assessment alone. Chaining it after the success handler
    // would report a failure to DELIVER a report as a failure to produce one.
    unavailable(["the assessment"]);
    return;
  }
  // Re-checked after the await, like every other read here: the surface may
  // have gone, and this answer carries a fingerprint.
  if (!deps.attached(origin)) {
    return;
  }
  if (result === null) {
    unavailable(["the worktree is no longer registered"]);
    return;
  }
  origin.post({ type: "worktreeRemoveAssessment", worktreeId, token, result });
}

export function createAssessLanes(deps: AssessLanesDeps): AssessLanes {
  const assessLanes = new Map<string, AssessLane>();

  async function runAssessLane(repoId: string): Promise<void> {
    const lane = assessLanes.get(repoId);
    if (lane === undefined) {
      return;
    }
    try {
      const request = takeNextAssess(lane, deps.attached);
      if (request !== undefined) {
        await serveAssess(deps, repoId, request);
      }
    } finally {
      // Synchronous, in one block: the flag falls and the re-enqueue decision
      // is taken together, so a request that arrived during the job cannot land
      // in a window where nothing is outstanding and nothing is queued — a lost
      // wakeup leaves it owed forever (design.md D6).
      lane.outstanding = false;
      if (lane.pending.size > 0) {
        lane.outstanding = true;
        void runAssessLane(repoId);
      } else if (assessLanes.get(repoId) === lane) {
        assessLanes.delete(repoId);
      }
    }
  }

  return {
    admitAssess(repoId, request) {
      const laneKey = deps.surfaceKey(request.surface);
      const fresh: AssessLane = { pending: new Map(), rotation: [], outstanding: false };
      const lane = assessLanes.get(repoId) ?? fresh;
      assessLanes.set(repoId, lane);
      // Against the ROTATION, not against `pending`: a surface being served has
      // already had its pending entry taken, so testing `pending` here re-appends
      // its key on every re-ask and grows the rotation without bound.
      if (!lane.rotation.includes(laneKey)) {
        lane.rotation.push(laneKey);
      }
      lane.pending.set(laneKey, request);
      if (lane.outstanding) {
        return;
      }
      lane.outstanding = true;
      void runAssessLane(repoId);
    },

    forgetSurfaceAssessments(key) {
      for (const [repoId, lane] of [...assessLanes]) {
        lane.pending.delete(key);
        const at = lane.rotation.indexOf(key);
        if (at !== -1) {
          lane.rotation.splice(at, 1);
        }
        if (!lane.outstanding && lane.pending.size === 0) {
          assessLanes.delete(repoId);
        }
      }
    },
  };
}
