# Spec Delta: worktree-agent-presence — refuse-a-directory-match-the-process-table-refuted

## ADDED Requirements

### Requirement: A session this window is measurably not running is claimed by no pane of it

WHERE this window can read the process table, a live agent session whose process it places in
no pane's pty subtree SHALL be claimed by no pane of this window, however many panes share that
session's recorded working directory, and SHALL be presented as running outside this window.

One uncontested claimant is covered as much as two contesting ones.

#### Scenario: Another application runs an agent in a directory a pane of this window sits in

- **WHEN** the process table is readable, a live registry session's working directory is one a
  pane of this window is also in, and that session's process is in no pane's pty subtree
- **THEN** that pane claims no agent and no session
- **AND** the session is presented as an outside-this-window row

#### Scenario: The same directory, where no process table can be read

- **WHEN** no process-table query is available on this platform and a live registry session's
  working directory equals a pane's
- **THEN** the pane claims that session, and no outside-this-window row is produced for it
