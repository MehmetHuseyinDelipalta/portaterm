# Proposal: refuse-a-directory-match-the-process-table-refuted

## Why

A user watching the Worktree panel saw a claude session another application (orca) was
running drawn as a row of this window, with no "other window" chip. Debug session
`260906-at-session-owner-other-window` found and fixed the fault; this change records the
rule the fix established, which the specs still contradict.

Terminal→session resolution asked the process table and then ignored what it said. When
the pty subtree intersection came back empty it fell through to a cwd-only match, and the
two cases that reach that fall-through are not the same:

- the table could not be read (Windows, a missing or timed-out `ps`) — nothing was learned,
  and the launch directory is the only evidence available;
- the table *was* read and placed the session's pid outside every pane of this window — the
  claim the directory is about to make has already been refuted by that same read.

`claude-running-session-map` step 2 is written as though only the first case exists. It is
not a soft ranking either: presence puts every matched session in the claimed set, and an
outside-this-window row is suppressed for anything claimed, so a directory guess nobody
contests silently converts into ownership.

## Scope

- `claude-running-session-map` — step 2's precondition, and the platform note that reads as
  though an unreachable process table were the only way to reach it.
- `worktree-agent-presence` — the claim rule for one pane and a session it does not hold.
  "One session belongs to one pane" adjudicates two panes contesting one session; nothing
  said what a single uncontested-but-refuted claim is worth.

## Non-goals and must-nots

- **Must not remove the cwd fallbacks.** They are the whole of identity on Windows, where
  no process table is reachable and nothing is ever refuted.
- **Must not gate step 3.** A transcript on disk carries no pid, so there is nothing for a
  process-table read to have refuted; it stays reachable after a refusal.
- No change to how two panes contest one session — that rule already holds and is untouched.
- No new evidence rank. `directory` keeps its rank; what changes is when it may be reached.

## Appetite

XS. The code and its tests landed under the debug session; this is the spec catching up.
