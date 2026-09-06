# worktree-agent-presence Delta

## MODIFIED Requirements

### Requirement: Surface agents running outside this window

The Worktree view SHALL include one externally marked row per qualifying live agent session under the worktree containing its recorded working directory. A recognized lifecycle status SHALL map `busy` to running, `waiting` to waiting, and `idle` to idle; a record with no recognized status SHALL present unknown activity without continuous animation.

#### Scenario: An external session is waiting

- **WHEN** a live external registry record reports `waiting`
- **THEN** its row reports waiting and its worktree reflects that attention state

#### Scenario: An external session is idle

- **WHEN** a live external registry record reports `idle`
- **THEN** its row reports idle without reporting a completed turn

#### Scenario: An older registry has no lifecycle state

- **WHEN** a live external registry record carries no recognized status
- **THEN** its row presents unknown activity without a running animation

## ADDED Requirements

### Requirement: External activity age follows the lifecycle transition

An external row SHALL age and rank from its valid lifecycle-transition timestamp, falling back to its launch or first-seen time when none is available. A transition timestamp earlier than that session's launch or first-seen time SHALL be clamped to that floor, and repeated scans SHALL NOT refresh the result.

#### Scenario: A transition predates the process

- **WHEN** a live record's valid status timestamp is earlier than its launch timestamp
- **THEN** the external row uses the launch timestamp rather than claiming pre-launch activity

### Requirement: Completion requires an explicit completed turn

An agent row SHALL be eligible for completed presentation only after the agent explicitly reports that an ordinary turn ended. A session boundary, registry idle, inferred quiet, or shell reclaim SHALL remain idle without a completion time.

#### Scenario: An ordinary reported turn ends

- **WHEN** an agent reports `done` for a turn that is not a session boundary
- **THEN** its row is eligible for completed presentation at that report's transition time

#### Scenario: A resumed session lands idle

- **WHEN** a session start, resume, clear, or compaction boundary reports an idle state
- **THEN** the row remains idle and reports no completed turn

#### Scenario: Output merely becomes quiet

- **WHEN** an inferred running row becomes idle because its terminal output stops
- **THEN** the row remains idle and reports no completed turn

#### Scenario: An agent has no completed-turn report

- **WHEN** a Cursor, OpenCode, or Codex row becomes idle without an explicit completed-turn report
- **THEN** it uses the idle presentation and not the done presentation

### Requirement: Completion time survives only its turn

A completed row's time SHALL remain stable while the same completion is reprojected. A later running or waiting turn, a changed session identity, or a session boundary SHALL clear it.
