# Proposal: close-the-disk-door-on-a-refuted-session

## Why

`refuse-a-directory-match-the-process-table-refuted` stopped step 2 from claiming a live
session the process table had placed outside this pane. Its round-1 review (F001, BLOCK)
found the same identity walking back in through step 3.

The sentence that change wrote into the spec is where the hole is:

> This step SHALL remain reachable after a refusal in step 2: a transcript on disk carries
> no pid, so a process-table read cannot have refuted it.

True of an **exited** session. False of a **live** one — the running registry pairs its
transcript with a pid, and that is exactly the pid the table just placed elsewhere. A live
session's transcript is also the *newest* one under the directory, so it does not merely leak:
it masks the older exited transcript the pane may genuinely have left behind.

The reach is the subagent-preview path, whose disk selector scans every Claude transcript
under the cwd. A user clicking a Task line in a pane that shares a directory with another
application's running claude gets that session's subagent detail, relabelled `recent`.

## Scope

- `claude-running-session-map` — step 3's precondition, and the reason attached to it.
- The resolver names the refuted session ids to the disk selector, and re-checks the answer.
- The shipped subagent-preview selector skips them and keeps looking.

## Non-goals and must-nots

- **Must not gate step 3 on `refuted` itself.** An exited session under the directory stays
  reachable; that is the case step 3 exists for, and gating the whole step would take it away.
- **Must not stop at a refuted candidate.** Skipping is not rejecting: the excluded transcript
  is usually the newest, so ending the search there hides the eligible older one.
- No change to presence, whose disk fallback is deliberately `null` and always was.
- No new evidence rank; `recent` keeps its meaning.

## Appetite

XS. One dep parameter, one selector loop, and the tests that arm both ends.
