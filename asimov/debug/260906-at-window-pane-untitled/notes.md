# 260906-at-window-pane-untitled

Supersedes `260906-at-session-owner-other-window`, whose repro stays green here.

## Symptom (verbatim)

> có vẻ sau khi fix (cả change, ko phải round 1) thì session từ có tên thành (untitled);
> bug đầu tiên chỉ là ko hiện OTHER WINDOW thôi, giờ thì nó untitled luôn?

Screenshot: worktree `plan/brd-lifecycle-integration`, 5 agent rows. Four are badged
`OTHER WINDOW` and named (PROMPT-BEST-PRACTICE, BRD-RESEARCHER, BRD-INTEGRATE-PLAN,
"Công việc hiện tại"). The fifth — the only window-scope row — reads `(untitled) ~`
with the terminal glyph and `now`.

## Verdict: not a defect. DIAGNOSED, and the remaining question is a product choice.

## Evidence

**No AT pane is running claude at all.** Every live claude pid on the machine —
31734, 10054, 64602, 74786, 29070, 64595, 16716, 12224, 61560, 79349, 85292 — traces
to `84446 daemon-entry.js` under `11289 Orca.app`, each through its own
`login -flpq huybuidac` + `-/bin/zsh -l` pair. Not one descends from a VS Code /
Antigravity pty. So the window-scope row is a plain shell.

**That row's title had exactly one honest source, and it is empty.** A window row takes
`identity?.name ?? pane.title` (`presenceProjector.ts`). With no agent proven there is no
`identity.name`, and `pane.title` is the pane's OSC title, which zsh does not set. The
rendered `~` beside the placeholder is the confidence marker span
(`worktreeTreeView.ts:180`), not a title — so the field is absent at source, not stripped.

**What changed is the false name, not a true one.** Before the fix that shell pane matched
an orca session by directory and wore that session's registry `name`. Whichever orca
session had the newest transcript is the name it showed, so it also CHANGED under the user
as different orca sessions became active. Removing it left the pane with what it always
had: nothing.

Both faces are the same bug. The reporter saw one of them (`no OTHER WINDOW chip`) because
a claimed session is dropped from the external pass; the other face was the borrowed name
on the shell row.

## Eliminated

1. The fix stripped identity from a pane really running claude — no claude is under any AT
   pty (ancestry above).
2. `stripDecorations` ate a real title — it strips only a leading frame run, and the
   placeholder renders beside a separate marker span. Same elimination
   `260827-worktree-agent-untitled` recorded.

## The product choice this raises

A no-agent pane that sets no OSC title has no name to show, and `(untitled)` is what the
panel says about it. Three options, none of them a bug fix:

1. **Leave it.** Honest, and the row is a shell — there is nothing to name.
2. **Name it from the shell.** `pane.shell` is already carried (`zsh`), so the row could
   read `zsh` instead of a placeholder.
3. **Name it from the directory.** The pane's cwd basename — informative, but every shell
   pane in one worktree then wears the same name, and the worktree row above already says it.

Option 2 or 3 is a `worktree-agent-presence` change, not a debug fix. `260827-worktree-agent-untitled`
already recorded the same gap from the other end: "Non-claude panes stay untitled."

## Not settled

- A pane running claude **under tmux/screen**, or any launcher that reparents the agent out
  of the pty subtree, now loses its claim on darwin/linux and renders as an external row.
  Carried forward from the superseded session; still true, still untested against a real
  multiplexer.
