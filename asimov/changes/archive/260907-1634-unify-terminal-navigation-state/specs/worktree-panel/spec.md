# worktree-panel Specification Delta

## ADDED Requirements

### Requirement: Only an active linked owner marks a worktree row

The panel SHALL mark exactly the linked worktree whose terminal owner is active. Main SHALL mark no worktree row because the global main terminal bucket is not owned by one repository. Focusing, creating, resuming, or restoring a linked-owned terminal SHALL move the mark without moving keyboard focus inside the tree.

#### Scenario: Focus a linked session from main

- **WHEN** main is active and the user focuses a session owned by linked worktree A
- **THEN** A alone is marked and the chosen terminal pane receives focus

#### Scenario: Activate main in a multi-root workspace

- **WHEN** a workspace has several repositories and any main worktree row activates the global main owner
- **THEN** no repository-specific main row is marked

### Requirement: Worktree row activation requests one navigation transition

Activating a worktree row SHALL request one owner-navigation transition. It SHALL NOT independently mutate selected-row state, tab filtering, active tab, or active pane.

## MODIFIED Requirements

### Requirement: A focused pane is revealed where it actually lives

When a pane is focused from the panel, the surface holding that pane SHALL be revealed and SHALL atomically activate the pane's stable owner, containing tab, and exact pane. The asking surface SHALL NOT be revealed when another surface holds the pane.

### Requirement: A selection leaves the rail as the user left it

Changing the active terminal owner SHALL NOT change whether the worktree rail is open in any layout. Only the rail's own controls and commands SHALL change its open or collapsed state.

### Requirement: Scope does not depend on the layout

Owner navigation and filtering SHALL be identical in every layout. The same owner, tabs, active pane, linked-owner indicator, and empty state SHALL be presented whether the rail is beside, above, below, or collapsed beside the terminal.

### Requirement: A history is requested once per session, and again if that session returns

A delegation history SHALL be requested at most once for a given agent row and session across every surface that presents it, and SHALL be requestable again after that row has left and returned.

#### Scenario: The same agent is presented in two trees

- **WHEN** an agent row is presented on two surfaces and its history has not been read
- **THEN** exactly one request for that history is made

## REMOVED Requirements

### Requirement: A worktree can be selected, and selection is an explicit act

**Reason**: Linked-row treatment becomes a projection of active terminal owner, which also changes through terminal focus, creation, resume, restore, or fallback.
**Migration**: Keyboard row focus remains independent; main has no repository-specific active mark.

### Requirement: The selected worktree is the only one marked as selected

**Reason**: The linked active-owner mark replaces independently mutable selected-worktree navigation state.
**Migration**: Expansion, open-folder state, and keyboard focus retain independent treatments.

### Requirement: Selecting a worktree opens an inspector under the tree

**Reason**: The inspector was removed when worktree row activation was reduced to owner navigation.
**Migration**: Row actions remain in the row toolbar and context menu.

### Requirement: The inspector is bounded so the tree stays scannable

**Reason**: No inspector is rendered.
**Migration**: Not applicable.

### Requirement: The inspector states the full path and rows still state none

**Reason**: No inspector is rendered.
**Migration**: The full path remains available from the row tooltip and Copy Path action.

### Requirement: The inspector names the model that no row names

**Reason**: No inspector is rendered.
**Migration**: Agent rows retain their current identity presentation.

### Requirement: A push that changes nothing changes no pixel of the inspector

**Reason**: No inspector is rendered.
**Migration**: Existing tree render guards remain applicable.

### Requirement: The inspector keeps its own claims current without a push

**Reason**: No inspector is rendered.
**Migration**: Time-derived agent claims remain owned by the tree.

### Requirement: The inspector offers only actions it can perform on this worktree

**Reason**: No inspector is rendered.
**Migration**: Capability-gated actions remain in the row toolbar and context menu.

### Requirement: An inspector action performs what its menu equivalent performs

**Reason**: No inspector is rendered.
**Migration**: The context menu remains the action authority.

### Requirement: The inspector carries the delegation history of each agent it presents

**Reason**: No inspector is rendered.
**Migration**: Delegation history remains under expanded agent rows.

### Requirement: Dismissing the inspector leaves the selection and the scope alone

**Reason**: Neither inspector state nor independent selection state remains.
**Migration**: Owner navigation and rail disclosure stay independent.

### Requirement: The inspector does not take focus and gives it back

**Reason**: No inspector is rendered.
**Migration**: Worktree keyboard focus remains in the tree.
