# Spec Delta: worktree-panel — name-the-app-that-hosts-a-session

## ADDED Requirements

### Requirement: An outside-this-window label names only the host presence established

The label on an outside-this-window row SHALL name the application running that agent when
presence resolved one, and SHALL otherwise say only that the agent is outside this window. It
SHALL NOT describe every outside agent as running in another window of this editor.

#### Scenario: A session another application is running

- **WHEN** an outside-this-window row carries the name of the application running it
- **THEN** the row's label names that application

#### Scenario: An outside agent whose host was not established

- **WHEN** such a row carries no application name
- **THEN** the row's label says only that it is outside this window, naming no host

### Requirement: The panel lists agents, not panes

A pane holding no proven agent SHALL NOT be drawn as a row, counted in a group's summary, or
reachable by keyboard navigation. Presence still projects a row for it, and this exclusion
SHALL be applied at one place, so what is counted and what is reachable cannot disagree with
what is drawn.

#### Scenario: A worktree holding a shell alongside agents

- **WHEN** a worktree's rows are four agents and one pane with no proven agent
- **THEN** four rows are drawn and the summary names four agents

#### Scenario: A worktree holding only panes with no proven agent

- **WHEN** no row in a worktree holds a proven agent
- **THEN** the group draws no agent rows
