# terminal-owner-navigation Specification
## Requirements

### Requirement: Every terminal has one stable owner

Every terminal SHALL belong to exactly one owner: the global main terminal bucket or one currently linked worktree. Creating a terminal from an owner view SHALL assign that owner, splitting SHALL inherit the source terminal's owner, and changing shell working directory or presence attribution SHALL NOT change it.

Legacy restored terminals without an owner and terminals whose linked owner no longer exists SHALL belong to main.

#### Scenario: Working directory changes after creation

- **WHEN** a terminal owned by linked worktree A changes its shell working directory outside A
- **THEN** it remains visible only with A's terminals

### Requirement: Navigation changes owner tab and pane as one action

Activating a terminal SHALL select its stable owner, containing tab, and exact pane as one user-visible action. No intermediate owner, tab, or pane SHALL be rendered or reported active.

#### Scenario: Focus a session from another owner

- **WHEN** main is active and the user focuses one of two sessions owned by linked worktree A
- **THEN** A becomes active, both A tabs are presented, and the chosen session receives focus

#### Scenario: Activate a split pane

- **WHEN** the requested session is a pane inside a split tab
- **THEN** its owner and containing tab become active and that exact pane receives focus

### Requirement: Terminal creation activates its assigned owner

A newly created terminal SHALL be registered before navigation is applied, then SHALL activate its assigned owner, tab, and pane without transiently activating an older tab.

The New Terminal action and replacement after closing the last tab SHALL use the currently active owner.

#### Scenario: Resume into a linked worktree

- **WHEN** Vault Resume or Continue creates a terminal whose recorded working directory belongs to linked worktree A
- **THEN** the new terminal activates A and is presented with A's existing terminal tabs

### Requirement: Split completion remains attached to its source tab

A split response SHALL attach the new pane to the tab that contained its source when the request was made, regardless of which tab is active when the response arrives. A worktree-owner reconciliation during split creation SHALL NOT produce a mixed-owner tab or leave a created terminal unreachable.

#### Scenario: User switches tabs before split creation returns

- **WHEN** the user requests a split in tab A, switches to tab B, and then creation succeeds
- **THEN** the new pane is attached to tab A and tab B remains unchanged

#### Scenario: Linked owner disappears while a split is pending

- **WHEN** a split is requested under linked owner A and A is reconciled to main before completion
- **THEN** the source tab and completed pane are normalized to main and the new terminal remains reachable

### Requirement: Restore uses one versioned navigation checkpoint

Each surface SHALL persist active owner, active tab, and active pane per tab in one versioned checkpoint. Restore SHALL register terminal facts and split topology before applying that checkpoint once.

### Requirement: Restore validates saved navigation against terminal facts

A surviving active tab SHALL determine owner from its terminal fact, even when the saved owner disagrees. Stale tab or pane identifiers SHALL be replaced within the saved owner, or by main where none survive; an explicitly saved owner with no active tab SHALL restore that owner's empty state.

### Requirement: Snapshot replay order never chooses restored navigation

Legacy snapshots without an owner SHALL restore into main. Host activity reconstructed while snapshots replay SHALL NOT override the versioned checkpoint or choose the active terminal when no checkpoint exists.

### Requirement: A disappeared linked owner falls back atomically

When a linked owner disappears, its terminals SHALL be reassigned to main before navigation is normalized. If that owner was active, main SHALL become active and one valid main-owned tab and pane SHALL be selected, or main's empty state SHALL be shown, without displaying an invalid intermediate state.

Absence of a worktree tree response SHALL NOT by itself prove that a linked owner disappeared.

### Requirement: Navigation is isolated per surface

Each terminal surface SHALL maintain its own active owner, tab, and pane. Navigating one surface SHALL NOT alter another surface. The extension host SHALL route a cross-surface focus request to the surface holding the pane, and that surface SHALL resolve and apply its own navigation state.

### Requirement: Presence reports activity but never terminal ownership

Worktree presence MAY report pane activity, waiting state, and worktree association for the agent list. It SHALL NOT move a terminal between owners or decide which owner, tab, or pane is active.

