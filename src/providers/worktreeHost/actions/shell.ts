// src/providers/worktreeHost/actions/shell.ts — The actions that act on the machine.
//
// Extracted from `handleAction` by change `decompose-worktree-host-controller`
// (design.md D1, task 2_1). Twelve arms that reveal, copy, open, focus or launch:
// each resolves a path or a row, then hands it to a capability. None of them
// touches create, provisioning or removal state, which is why they cut first.
//
// `actions` arrives per call rather than in `Deps`: the dispatcher already guards
// `!actions || disposed` once for every arm, so re-reading it here would only
// duplicate that guard.

import type { WorktreeActionMessage, WorktreeAgentLaunchFields } from "../../../types/messages";
import type { CreateSessionOptions } from "../../../vault/VaultLauncher";
import type { WorktreeAgentRow } from "../../../worktree/presenceTypes";
import type { AdmittedLaunch, LaunchTargetRecord, WorktreeActions, WorktreeSurface } from "../hostTypes";

/** One arm, once the dispatcher has proved `actions` is there. */
type Arm<T extends WorktreeActionMessage["type"]> = (
  surface: WorktreeSurface,
  msg: Extract<WorktreeActionMessage, { type: T }>,
  actions: WorktreeActions,
) => void;

export interface ShellDeps {
  /** The worktree's path, or undefined when it no longer resolves. */
  actionPath(worktreeId: string, allowMissing: boolean): string | undefined;
  /** Run a capability, logging a rejection rather than surfacing it. */
  perform(run: () => Promise<void>): void;
  /** The published row, only while it still carries the value the message quoted. */
  matchedRow(rowId: string, field: "paneId" | "entryId", carried: string): WorktreeAgentRow | undefined;
  admittedTarget(fields: unknown): AdmittedLaunch | undefined;
  admissibleLaunch(surface: WorktreeSurface, fields: unknown): boolean;
  launchOpts(fields: WorktreeAgentLaunchFields): { permissionChoiceId?: string; prompt?: string };
  isKnownSetupOutput(msg: unknown): boolean;
  /** Where a launch would run, re-read at handoff so a rebuild cannot redirect it. */
  launchTarget(worktreeId: string): LaunchTargetRecord | undefined;
}

export function createShellActions(deps: ShellDeps) {
  const {
    actionPath,
    perform,
    matchedRow,
    admittedTarget,
    admissibleLaunch,
    launchOpts,
    isKnownSetupOutput,
    launchTarget,
  } = deps;

  /**
   * Resolve a launch, then hand the resolved command to the surface that asked.
   *
   * Deliberately NOT `perform`: that swallows a rejection into a log, which is
   * right for a copy or a reveal and wrong here. A launch the user asked for and
   * did not get has to say so — "agent executable not found" is the whole error
   * surface this action has (worktree-actions.md § 5).
   */
  function launch(
    surface: WorktreeSurface,
    admitted: AdmittedLaunch,
    resolve: (target: AdmittedLaunch) => Promise<CreateSessionOptions>,
  ): void {
    const open = surface.launchAgent;
    if (!open) {
      return;
    }
    void resolve(admitted)
      .then((launchOptions) => {
        // Asked again at the handoff, not only at the request: executable
        // resolution awaits, and neither a worktree removed while it ran nor a
        // different one recreated at the same id may receive the session. One
        // lookup answers both halves, so the path used is always the path the
        // compared registration belongs to.
        const now = launchTarget(admitted.worktreeId);
        if (now === undefined || now.generation !== admitted.generation) {
          return undefined;
        }
        const path = now.path;
        // Re-resolved rather than reusing the pre-await path: git's own display
        // string for the registration that is there now.
        return { ...launchOptions, cwd: path };
      })
      .then((options) => (options === undefined ? undefined : open.call(surface, options)))
      .catch((err: unknown) => {
        const reason = err instanceof Error ? err.message : "The agent could not be started.";
        surface.post({ type: "error", message: reason, severity: "error" });
      });
  }

  const worktreeOpenFolder: Arm<"worktreeOpenFolder"> = (_surface, msg, actions) => {
    // Validated, not trusted: the capability treats anything that is not
    // `newWindow` as `addToWorkspace`, so a malformed payload would mutate
    // the workspace instead of failing closed (round-1 W1).
    if (msg.mode !== "newWindow" && msg.mode !== "addToWorkspace") {
      return;
    }
    const path = actionPath(msg.worktreeId, false);
    if (path !== undefined) {
      perform(() => actions.openFolder(path, msg.mode));
    }
    return;
  };

  const worktreeSetupViewOutput: Arm<"worktreeSetupViewOutput"> = (surface, msg, actions) => {
    if (!isKnownSetupOutput(msg) || actions.viewSetupOutput === undefined) {
      return;
    }
    perform(() => actions.viewSetupOutput?.(msg.outputId, surface) ?? Promise.resolve());
    return;
  };

  const worktreeRevealInOS: Arm<"worktreeRevealInOS"> = (_surface, msg, actions) => {
    const path = actionPath(msg.worktreeId, false);
    if (path !== undefined) {
      perform(() => actions.revealInOS(path));
    }
    return;
  };

  const worktreeCopyPath: Arm<"worktreeCopyPath"> = (_surface, msg, actions) => {
    const path = actionPath(msg.worktreeId, true);
    if (path !== undefined) {
      perform(() => actions.copyText(path));
    }
    return;
  };

  const worktreeOpenTerminal: Arm<"worktreeOpenTerminal"> = (surface, msg, _actions) => {
    // Asked of the surface that raised it: a new tab belongs where the user
    // was, and only a surface can create one at all.
    const path = actionPath(msg.worktreeId, false);
    const open = surface.openTerminal;
    if (path !== undefined && open) {
      perform(() => open.call(surface, path));
    }
    return;
  };

  const worktreeFocusPane: Arm<"worktreeFocusPane"> = (_surface, msg, actions) => {
    // An external row carries no `paneId` at all, so this cannot resolve for
    // one however it is asked — the innermost of three barriers (D4).
    const row = matchedRow(msg.rowId, "paneId", msg.paneId);
    if (row?.paneId !== undefined && row.viewId !== undefined) {
      perform(() => actions.focusPane(row.paneId as string, row.viewId as string));
    }
    return;
  };

  const worktreeOpenPreview: Arm<"worktreeOpenPreview"> = (surface, msg, _actions) => {
    const row = matchedRow(msg.rowId, "entryId", msg.entryId);
    if (row?.entryId !== undefined) {
      // Answered back to the asking surface: the overlay is webview-owned,
      // and the entry id it gets is the host's, not the one it asked with.
      surface.post({ type: "worktreeShowPreview", entryId: row.entryId });
    }
    return;
  };

  const worktreeCopyResumeCommand: Arm<"worktreeCopyResumeCommand"> = (_surface, msg, actions) => {
    const row = matchedRow(msg.rowId, "entryId", msg.entryId);
    if (row?.entryId !== undefined) {
      const entryId = row.entryId;
      perform(() => actions.copyResumeCommand(entryId));
    }
    return;
  };

  const worktreeRevealAgentCwd: Arm<"worktreeRevealAgentCwd"> = (_surface, msg, actions) => {
    const row = matchedRow(msg.rowId, "entryId", msg.entryId);
    if (row?.entryId !== undefined) {
      const entryId = row.entryId;
      perform(() => actions.revealSessionCwd(entryId));
    }
    return;
  };

  const worktreeCopyAgentPath: Arm<"worktreeCopyAgentPath"> = (_surface, msg, actions) => {
    const row = matchedRow(msg.rowId, "entryId", msg.entryId);
    if (row?.entryId !== undefined) {
      const entryId = row.entryId;
      perform(() => actions.copySessionCwd(entryId));
    }
    return;
  };

  const worktreeLaunchAgent: Arm<"worktreeLaunchAgent"> = (surface, msg, actions) => {
    const start = actions.startAgent;
    const { type: _type, ...fields } = msg;
    const admitted = admittedTarget(fields);
    if (!start || admitted === undefined) {
      return;
    }
    // Admission first, and it is the HOST's own answer being checked, not
    // the registry's: an agent that resolves on this machine but was never
    // advertised for a fresh start is still not what the panel offered.
    //
    // Synchronous, and the generation is read in the same turn as the
    // message: an admission that awaited would let a rebuild land between
    // "which worktree was asked for" and "which one was recorded", and
    // record the replacement as the one the user aimed at (round-4 B5).
    if (!admissibleLaunch(surface, fields)) {
      return;
    }
    launch(surface, admitted, (target) => start(fields.agent, target.path, launchOpts(fields)));
    return;
  };

  const worktreeResumeHere: Arm<"worktreeResumeHere"> = (surface, msg, actions) => {
    const resume = actions.resumeSessionAt;
    // BOTH doors: the row must still hold this session, and the worktree
    // must still be the registration the row was published under. A resume
    // is raised on a rendered row like a launch is chosen from a rendered
    // list, so it quotes its registration for the same reason and is
    // refused on the same terms (round-5 B5).
    const row = matchedRow(msg.rowId, "entryId", msg.entryId);
    const admitted = admittedTarget(msg);
    if (!resume || row?.entryId === undefined || admitted === undefined) {
      return;
    }
    const entryId = row.entryId;
    launch(surface, admitted, (target) => resume(entryId, target.path));
    return;
  };

  return {
    worktreeOpenFolder,
    worktreeSetupViewOutput,
    worktreeRevealInOS,
    worktreeCopyPath,
    worktreeOpenTerminal,
    worktreeFocusPane,
    worktreeOpenPreview,
    worktreeCopyResumeCommand,
    worktreeRevealAgentCwd,
    worktreeCopyAgentPath,
    worktreeLaunchAgent,
    worktreeResumeHere,
  };
}
