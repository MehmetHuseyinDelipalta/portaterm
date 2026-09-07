// src/providers/worktreeHost/actionRouting.ts — Which capability group answers
// an inbound action, and the one read the router makes on its own.
//
// Extracted from `createWorktreeHost` by change `decompose-worktree-host`
// (design.md D1, task 2_9). The switch is the whole inbound surface of the
// host, and it sat between the four factories it dispatches to.
//
// The groups arrive as accessors rather than values: `perform` is a dependency
// of the create group, so this module is CONSTRUCTED before them and reads them
// when a message actually arrives — which is always after construction.

import type { WorktreeActionMessage } from "../../types/messages";
import type { DelegationRoster, WorktreeAgentRow } from "../../worktree/presenceTypes";
import type { createCreateActions } from "./actions/create";
import type { createProvisionActions } from "./actions/provision";
import type { createRemovalActions } from "./actions/removal";
import type { createShellActions } from "./actions/shell";
import type { WorktreeHostOptions } from "./hostOptions";
import type { WorktreeSurface } from "./hostTypes";
import { rosterKey } from "./presenceProjection";

export interface ActionRoutingDeps {
  options: Pick<WorktreeHostOptions, "actions" | "readDelegations">;
  disposed(): boolean;
  /** The four capability groups, read at message time (see the header). */
  shell(): ReturnType<typeof createShellActions>;
  create(): ReturnType<typeof createCreateActions>;
  removal(): ReturnType<typeof createRemovalActions>;
  provision(): ReturnType<typeof createProvisionActions>;
  /** The row `rowId` names in the envelope this host last published. */
  publishedRow(rowId: string): WorktreeAgentRow | undefined;
  rosters: Map<string, DelegationRoster>;
  rosterReads: Map<string, Promise<void>>;
  /** Publish the envelope a completed roster read belongs in. */
  commitAndBroadcast(): void;
  /** `console.warn` under the window's own log prefix. */
  logWarn(message: string, err: unknown): void;
}

export interface ActionRouting {
  /** Run one capability, keeping a rejection out of the message loop. */
  perform(run: () => Promise<void>): void;

  /** Route one inbound action to the group that owns it. Unknown types ignored. */
  handleAction(surface: WorktreeSurface, msg: WorktreeActionMessage): void;

  /**
   * Read what one row's session delegated — at most once per row per session.
   *
   * The request's entry id is an expected-version token, never an argument: the
   * read uses the published row's OWN id, so a stale or forged one reads
   * nothing rather than the wrong transcript (design.md D1). A second request
   * while the first is in flight joins it; one already answered re-reads
   * nothing (D8).
   */
  requestDelegations(rowId: string, entryId: string): void;
}

export function createActionRouting(deps: ActionRoutingDeps): ActionRouting {
  return {
    perform(run) {
      void run().catch((err) => {
        deps.logWarn("worktree action failed", err);
      });
    },

    handleAction(surface, msg) {
      const actions = deps.options.actions;
      if (!actions || deps.disposed()) {
        return;
      }
      const shell = deps.shell();
      const create = deps.create();
      const removal = deps.removal();
      const provision = deps.provision();
      switch (msg.type) {
        case "worktreeOpenFolder":
          shell.worktreeOpenFolder(surface, msg, actions);
          return;
        case "worktreeCreate":
          create.worktreeCreate(surface, msg, actions);
          return;
        case "worktreeSetupRetry":
          create.worktreeSetupRetry(surface, msg, actions);
          return;
        case "worktreeSetupViewOutput":
          shell.worktreeSetupViewOutput(surface, msg, actions);
          return;
        case "worktreeRemoveAssess":
          removal.worktreeRemoveAssess(surface, msg, actions);
          return;
        case "worktreeRemove":
          removal.worktreeRemove(surface, msg, actions);
          return;
        case "worktreeLock":
          removal.worktreeLock(surface, msg, actions);
          return;
        case "worktreeUnlock":
          removal.worktreeUnlock(surface, msg, actions);
          return;
        case "worktreePickDestination":
          create.worktreePickDestination(surface, msg, actions);
          return;
        case "worktreeCreateProbe":
          create.worktreeCreateProbe(surface, msg, actions);
          return;
        case "worktreeAuthorizeDebris":
          create.worktreeAuthorizeDebris(surface, msg, actions);
          return;
        case "worktreeProvisionSwitch":
          provision.worktreeProvisionSwitch(surface, msg);
          return;
        case "worktreeCopyFileAsk":
          provision.worktreeCopyFileAsk(surface, msg);
          return;
        case "worktreeSetupStepAsk":
          provision.worktreeSetupStepAsk(surface, msg);
          return;
        case "worktreeProvisionSave":
          provision.worktreeProvisionSave(surface, msg);
          return;
        case "worktreeCreateClosed":
          create.worktreeCreateClosed(surface, msg, actions);
          return;
        case "requestWorktreeCreateDefaults":
          create.requestWorktreeCreateDefaults(surface, msg, actions);
          return;
        case "requestWorktreeRefs":
          create.requestWorktreeRefs(surface, msg, actions);
          return;
        case "worktreePrune":
          removal.worktreePrune(surface, msg, actions);
          return;
        case "worktreeRevealInOS":
          shell.worktreeRevealInOS(surface, msg, actions);
          return;
        case "worktreeCopyPath":
          shell.worktreeCopyPath(surface, msg, actions);
          return;
        case "worktreeOpenTerminal":
          shell.worktreeOpenTerminal(surface, msg, actions);
          return;
        case "worktreeFocusPane":
          shell.worktreeFocusPane(surface, msg, actions);
          return;
        case "worktreeOpenPreview":
          shell.worktreeOpenPreview(surface, msg, actions);
          return;
        case "worktreeCopyResumeCommand":
          shell.worktreeCopyResumeCommand(surface, msg, actions);
          return;
        case "worktreeRevealAgentCwd":
          shell.worktreeRevealAgentCwd(surface, msg, actions);
          return;
        case "worktreeCopyAgentPath":
          shell.worktreeCopyAgentPath(surface, msg, actions);
          return;
        case "worktreeLaunchAgent":
          shell.worktreeLaunchAgent(surface, msg, actions);
          return;
        case "worktreeResumeHere":
          shell.worktreeResumeHere(surface, msg, actions);
          return;
      }
    },

    requestDelegations(rowId, entryId) {
      const reader = deps.options.readDelegations;
      if (!reader || deps.disposed()) {
        return;
      }
      const row = deps.publishedRow(rowId);
      const session = row?.entryId;
      if (session === undefined || session !== entryId) {
        return;
      }
      const key = rosterKey(rowId, session);
      if (deps.rosters.has(key) || deps.rosterReads.has(key)) {
        return;
      }
      const read = (async () => {
        let roster: DelegationRoster;
        try {
          roster = await reader(session);
        } catch (err) {
          roster = { kind: "failed", reason: err instanceof Error ? err.message : String(err) };
        }
        if (deps.disposed()) {
          return;
        }
        deps.rosterReads.delete(key);
        deps.rosters.set(key, roster);
        deps.commitAndBroadcast();
      })();
      deps.rosterReads.set(key, read);
    },
  };
}
