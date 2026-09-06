# worktree-panel Delta

## MODIFIED Requirements

### Requirement: Strongest state wins and shape carries it

Each presented activity — `waiting`, `running`, unconfirmed running, `unknown`, `done`, `idle`, and `exited` — SHALL be distinguishable from every other by shape alone, without relying on colour or motion. The same shape SHALL be used on a worktree row and on an agent row.

A worktree row SHALL reflect the strongest presented activity among its agents in the precedence `waiting` > `running` > unconfirmed running > `unknown` > `done` > `idle` > `exited`.

#### Scenario: One waiting agent among several running ones

- **WHEN** a worktree holds one waiting agent and four running agents
- **THEN** the worktree row reads as waiting

#### Scenario: Motion is removed

- **WHEN** the viewer requests reduced motion
- **THEN** every presented state remains distinguishable by shape

#### Scenario: A completed agent and an idle agent share a worktree

- **WHEN** a worktree holds one agent presented as done and one presented as idle
- **THEN** the worktree row reads as done

## ADDED Requirements

### Requirement: Completed and idle are visually distinct

A confirmed completed turn SHALL use a static green check. A live row that is merely quiet SHALL use a muted static dot; registry idle and session boundaries SHALL NOT receive the completed treatment.

#### Scenario: A completed turn remains visible

- **WHEN** a row has a confirmed completion time and no later turn has started
- **THEN** the row and its collapsed summary use the done state rather than idle

#### Scenario: An idle external session is not completed

- **WHEN** an external live session reports idle
- **THEN** it uses the idle marker and not the done check

### Requirement: Continuous rotation identifies confirmed execution only

Only confirmed running SHALL use a continuously rotating indicator. Done, idle, running unconfirmed, unknown, and exited SHALL remain static; waiting MAY use a non-rotating pulse that stops under reduced motion.

#### Scenario: A quiet list contains no running animation

- **WHEN** every visible agent is done, idle, unknown, exited, or running unconfirmed
- **THEN** no status indicator continuously rotates

### Requirement: Attention has its own shape

Waiting SHALL use a question-shaped marker rather than the running spinner. Running, waiting, done, and idle SHALL use activity, attention, success, and muted theme colours respectively, while shape remains the primary carrier of meaning.

#### Scenario: An agent needs input

- **WHEN** an agent is waiting for a question or permission response
- **THEN** its row uses the question-shaped attention marker rather than the running spinner
