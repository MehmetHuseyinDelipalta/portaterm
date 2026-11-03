// src/session/agentLaunchResume.ts — How a restored Claude agent launch picks
// up the conversation it was running, rather than re-running its launch.
//
// A vault launch spawns `claude` AS the pty process and the snapshot keeps that
// command line. Re-running it verbatim is only right for a resume of the very
// session the pane still holds: a fresh start (`claude`) opens a NEW session,
// a continuation (`claude "<prompt>"`) re-submits its handoff prompt, and a
// resume whose agent moved on (`/resume`, `/clear`) reopens the old one. The
// restored scrollback then shows the old conversation above an empty prompt.
//
// When the process table placed a Claude session under the pane, the restore
// resumes THAT session, keeping only the run settings the launch chose.

import { formatEntryId } from "../vault/types";

/** The launch flags that carry a run setting into the resumed session, each with one value. */
const KEPT_FLAGS: ReadonlySet<string> = new Set(["--model", "--permission-mode"]);

/** Whether a pty root executable is Claude Code (`claude`, a path to it, or a Windows shim). */
export function isClaudeExecutable(shell: string): boolean {
  const base = shell.split(/[\\/]/).pop() ?? "";
  return /^claude(\.(exe|cmd|bat|ps1))?$/i.test(base);
}

/**
 * The args that resume `sessionId` in place of `args`, keeping the launch's
 * `--model` and `--permission-mode` (in either `--flag value` or `--flag=value`
 * form). Everything else — a prior `--resume <id>`, a positional prompt — is
 * dropped: each would steer the restore away from the session the pane held.
 */
export function claudeResumeArgs(args: readonly string[], sessionId: string): string[] {
  const kept: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const eq = arg.indexOf("=");
    if (eq > 0 && KEPT_FLAGS.has(arg.slice(0, eq))) {
      kept.push(arg);
    } else if (KEPT_FLAGS.has(arg) && i + 1 < args.length) {
      kept.push(arg, args[i + 1]);
      i++;
    }
  }
  return ["--resume", sessionId, ...kept];
}

/** The vault entry a restored Claude launch now resumes. */
export function claudeEntryId(sessionId: string): string {
  return formatEntryId("claude", sessionId);
}
