# Spec Delta: claude-running-session-map — close-the-disk-door-on-a-refuted-session

## MODIFIED Requirements

### Requirement: Map a terminal to its Claude session

The host SHALL resolve the Claude `sessionId` a given terminal is showing, in this order:

1. Walk the terminal's pty process subtree (from `session.pty.pid`) and intersect the
   descendant pids with the running registry (the registry `pid` is the `claude` node
   process, a descendant of the pty's shell, never the pty pid itself). A single match
   yields the exact `{ sessionId, cwd }`; WHEN more than one running registry pid is found
   in the subtree, the one with the most-recently-modified `<sessionId>.jsonl` transcript
   SHALL be chosen.
2. WHEN the subtree walk could not be performed at all, fall back to running registry
   entries whose `cwd` equals the terminal's current cwd, choosing the most-recently-modified
   `<sessionId>.jsonl`. (Note: the terminal's live cwd is the shell's cwd and MAY differ
   from the registry's launch cwd if the shell has `cd`'d; a miss here SHALL degrade to
   step 3, not error.) WHEN the subtree walk WAS performed and yielded no match, this step
   SHALL be skipped: every candidate it offers is a live session with a pid, and the read
   that found none under this pty located all of them elsewhere, so the shared directory is
   a refuted claim rather than a weaker one.
3. WHEN step 2 produced no running session — whether it found none or was skipped — fall
   back to the most-recently-modified Claude session recorded under that cwd, so a terminal
   whose CLI has already exited still resolves. WHERE step 2 was skipped, this step SHALL
   consider only sessions that are not in the running registry: a live session's transcript
   IS paired with a pid, and it is the newest file under the directory, so a step 3 that
   accepted it would return the identity step 2 just refused and hide the exited session
   behind it. A refuted candidate SHALL be passed over rather than ending the search, and
   resolution SHALL NOT return one even if the selector offers it.

**Headless one-shot sessions SHALL be excluded from the running set before steps 1 and 2
are evaluated**, so they can neither be selected outright nor win a tie-break. A session is
headless one-shot when its `entrypoint` is one of the known headless values — currently the
single value `sdk-cli`, as written by `claude -p` / `claude --print`. Exclusion SHALL be an
explicit allow-list of known headless values, never "anything that is not `cli`", so an
unrecognised or absent `entrypoint` keeps the session as a candidate. WHEN exclusion empties
the candidate set for a step, resolution SHALL continue to the next step rather than
returning null.

Step 3 is otherwise unfiltered by `entrypoint`: it reads transcripts from disk, where no
`entrypoint` is available.

It SHALL return null when nothing resolves, and SHALL derive every path from the cwd within
the Claude store — never from a webview-supplied path. On platforms without a supported
process-table query (e.g. Windows) the subtree walk SHALL no-op and resolution SHALL use the
cwd fallbacks only, with nothing refuted and therefore nothing excluded.

#### Scenario: Another application runs the session in a directory this pane also sits in

- **WHEN** the process table is readable, a live registry session's `cwd` equals the pane's
  cwd, and that session's pid is in no pane's pty subtree
- **THEN** resolution MUST NOT return that session, by either the running or the recorded route

#### Scenario: A refuted live transcript is newer than an eligible exited one

- **WHEN** the process table has placed every live session outside this pane's subtree, and
  the newest Claude transcript under the pane's cwd belongs to one of those live sessions
  while an older transcript belongs to an exited one
- **THEN** resolution MUST return the exited session

#### Scenario: The selector offers a refuted session anyway

- **WHEN** the recorded-session selector returns a session that is in the running registry
  after the process table refuted every live session for this pane
- **THEN** resolution MUST return null

#### Scenario: The same directory match, where no process table can be read

- **WHEN** no process-table query is available on this platform and a live registry session's
  `cwd` equals the pane's cwd
- **THEN** resolution MUST return that session's `{ sessionId, cwd }`

#### Scenario: Hook-spawned headless child competes with the interactive session

- **WHEN** the pane's pty subtree contains both the interactive `claude` registry pid and a
  live `claude -p` child whose transcript was modified more recently
- **THEN** resolution MUST return the interactive session's `{ sessionId, cwd }`.

#### Scenario: Unrecognised entrypoint is not treated as headless

- **WHEN** the only running session in the subtree reports an `entrypoint` that is absent,
  empty, or an unknown value
- **THEN** it MUST still be selected, so a future Claude release cannot silently break
  resolution by renaming the field's values.
