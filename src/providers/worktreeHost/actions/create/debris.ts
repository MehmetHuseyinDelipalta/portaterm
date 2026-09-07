// src/providers/worktreeHost/actions/create/debris.ts — Authorizing the removal
// of what is already sitting at a create's destination.
//
// Extracted from `createCreateActions` by change `decompose-worktree-host`
// (design.md D1, task 2_14). Minting a clearance is deletion authority, and it
// is the one thing the create form does that destroys something the user did
// not name — so it reads better as its own file than as one arm among eight.
//
// `corroborate` and `corroborateAdopt` were planned to come here. They did not:
// direction B (D1a) found the probe is their only caller, so task 2_13 took
// them instead.

import type { DebrisAuthorization, WorktreeActionMessage } from "../../../../types/messages";
import type { WorktreeHostOptions } from "../../../WorktreeHost";
import type { Opening, WorktreeSurface } from "../../hostTypes";

/** What issuing a clearance needs from the host. A subset of `CreateDeps`. */
export interface DebrisDeps {
  readonly options: WorktreeHostOptions;
  disposed(): boolean;
  hasSurface(surface: WorktreeSurface): boolean;
  openingFor(s: WorktreeSurface, repoId: string, token: number): Opening | undefined;
}

/**
 * Issue an authorization to clear `path`, or say why there is none.
 *
 * ONE read of the directory answers both questions — what the offer will state
 * and what the token is digested over. Reading twice would let the user be
 * shown one set and the fingerprint bind another (design.md D6).
 */
export async function answerDebrisAuthorization(
  deps: DebrisDeps,
  surface: WorktreeSurface,
  msg: Extract<WorktreeActionMessage, { type: "worktreeAuthorizeDebris" }>,
): Promise<void> {
  const answer = (
    rest:
      | { granted: true; authorization: DebrisAuthorization; entries: readonly string[] }
      | { granted: false; because: "notDebris" | "unreadable" },
  ): void => {
    surface.post({
      type: "worktreeDebrisAuthorized",
      repoId: msg.repoId,
      token: msg.token,
      // Echoed, never re-derived: it is what tells this answer from one the
      // form has already withdrawn (round-2 W2).
      ask: msg.ask,
      path: msg.path,
      ...rest,
    });
  };
  const issue = deps.options.issueDebrisAuthorization;
  if (issue === undefined) {
    answer({ granted: false, because: "unreadable" });
    return;
  }
  const issued = await issue(msg.path);
  // The opening AND the candidate, re-asked after the read. A newer answer can
  // have published a different destination while this one was reading, and a
  // token bound to the superseded one is not an answer to any question now on
  // screen (round-1 B1).
  if (
    deps.disposed() ||
    !deps.hasSurface(surface) ||
    deps.openingFor(surface, msg.repoId, msg.token)?.debrisCandidate !== msg.path
  ) {
    return;
  }
  answer(
    issued.ok
      ? {
          granted: true,
          authorization: { path: msg.path, fingerprint: issued.fingerprint },
          entries: issued.entries,
        }
      : { granted: false, because: issued.because },
  );
}
