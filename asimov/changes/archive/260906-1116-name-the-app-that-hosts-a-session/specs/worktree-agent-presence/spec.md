# Spec Delta: worktree-agent-presence — name-the-app-that-hosts-a-session

## ADDED Requirements

### Requirement: An outside-this-window row names the application running it, where one can be named

A row for an agent running outside this window SHALL carry the bundled application that owns its
process, resolved by walking that process's ancestry in the process table this rebuild already
reads. WHERE no ancestor belongs to a bundled application, or the table could not be read, the
row SHALL carry no application rather than a guess.

Resolving it SHALL NOT cost a second process-table read.

#### Scenario: A session another application is running

- **WHEN** an outside-this-window session's process descends from a bundled application
- **THEN** its row carries that application's name

#### Scenario: A nested helper process

- **WHEN** that process descends from a helper bundled inside another application
- **THEN** the row carries the outermost application, not the helper

#### Scenario: Nothing in the chain is a bundled application

- **WHEN** no ancestor of the session's process belongs to a bundled application
- **THEN** the row carries no application name

#### Scenario: The process table could not be read

- **WHEN** the process table is unavailable
- **THEN** the row carries no application name, and the row is still produced
