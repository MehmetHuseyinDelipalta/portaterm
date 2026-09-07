# tab-bar-component Specification

## Purpose
TBD
## Requirements

### Requirement: Tab-Bar-Rendering

The webview SHALL render only terminal tabs owned by the active owner. Each presented tab SHALL display its active pane's terminal name and a close button. The tab bar SHALL include a final New Terminal button that creates in the active owner.

The tab bar SHALL render from a committed navigation state and terminal catalog, never from an independently mutable scope.

### Requirement: Tab-Bar-Styling

The tab bar SHALL use VS Code CSS variables for all colors to ensure theme consistency. The tab bar SHALL have a horizontal layout with tabs arranged left-to-right. The active tab SHALL be visually distinguished from inactive tabs.

#### Scenario: Theme-consistent styling

- Given the webview is rendered in a VS Code dark theme
- When the tab bar renders
- Then tab background colors use `--vscode-tab-inactiveBackground` for inactive tabs and `--vscode-tab-activeBackground` for active tabs
- And tab text colors use `--vscode-tab-inactiveForeground` and `--vscode-tab-activeForeground`
- And the tab bar background uses `--vscode-editorGroupHeader-tabsBackground`

#### Scenario: Tab bar height

- Given the tab bar is visible
- Then the tab bar height SHALL be approximately 28-35px (compact, not stealing excessive terminal space)
- And the tab bar SHALL have `flex-shrink: 0` to prevent compression

### Requirement: Tab-Click-Handlers

Clicking a tab SHALL request one navigation transition to that tab and its retained active pane. A close button SHALL request removal without activating the tab. The New Terminal button SHALL request creation in the active owner.

Closing the active or last tab SHALL normalize navigation within the same owner before any replacement terminal is requested.

### Requirement: Tab-Bar-Update-Integration

Terminal registration, removal, tab activation, pane activation, split completion, restore, and owner fallback SHALL each update the tab bar only from the resulting committed navigation state. One accepted navigation intent SHALL NOT render an intermediate tab selection.

### Requirement: The tab bar is presented whenever it is filtered

The tab bar SHALL be hidden while main owns fewer than two tabs. A linked owner SHALL present its tab bar regardless of tab count so the linked-owner indicator remains visible.

### Requirement: Scope changes what is drawn and nothing else

Changing the active terminal owner SHALL start, stop, close, and detach no existing terminal, and SHALL change no other surface. Main SHALL present only main-owned tabs; a linked owner SHALL present only that linked owner's tabs.

### Requirement: A scope is named wherever it is in force

While a linked owner is active, the terminal surface SHALL carry a frame and compact indicator naming that worktree. Main SHALL carry neither linked-worktree frame nor linked-worktree indicator. The user SHALL return to main by selecting a main worktree row; no clear, close, or show-all owner control SHALL be offered.

### Requirement: A scope that loses its worktree is dropped and said

When an active linked owner leaves the current worktree tree, its terminals SHALL fall back to main, main SHALL become active, and the worktree panel SHALL state why. A linked worktree still registered but reported missing SHALL remain a valid owner until reconciliation removes it.

### Requirement: A push that moves no attribution redraws no tab bar

A tree or presence push that changes no terminal owner, owner validity, committed navigation state, tab activity, or waiting count SHALL perform no tab-bar DOM work.

### Requirement: A surface's scope survives a reload and never outlives its worktree

An in-memory surface reload SHALL restore a valid versioned navigation checkpoint. A saved linked owner SHALL remain valid while terminal facts support it or until a complete worktree tree proves it absent. Invalid saved navigation SHALL normalize to main.

### Requirement: A host restart resets the scope; an in-memory re-resolve preserves it

After extension-host restart, a surface SHALL restore a valid versioned navigation checkpoint independently from host snapshot replay order. Where no checkpoint survives, the surface SHALL start in main. An in-memory re-resolve MAY use the host's validated live active-session hint only when no checkpoint exists.

### Requirement: A hidden tab that needs a human is counted

While a linked owner is active, its indicator SHALL count hidden tabs owned by other owners that contain a waiting pane. Zero SHALL render no mark. Selecting main or another linked worktree SHALL present only that owner's tabs.

### Requirement: The count reads every source that can say a pane is waiting

A pane SHALL be counted as waiting when either the surface's own tracked pane status or the
presence row for that pane says so. Neither source alone SHALL be able to suppress the count.

#### Scenario: Only presence knows

- **WHEN** a hidden tab's pane has a presence row saying waiting and the surface's own status does not
- **THEN** the tab is counted

#### Scenario: Only the surface's own status knows

- **WHEN** a hidden tab's pane has its own tracked status saying waiting and no presence row says so
- **THEN** the tab is counted

### Requirement: Selecting a worktree goes to a pane of that worktree

Selecting a worktree SHALL activate its owner and retain that owner's current valid tab and pane when available; otherwise it SHALL activate a valid tab and pane of that owner. Selecting any main worktree row SHALL activate the global main owner without marking a repository-specific main row.

### Requirement: A scope holding no pane says so and offers what is worth doing

When the active owner has no terminal, the surface SHALL present an owner-specific empty region offering a new terminal and any available agent launch. It SHALL state that another worktree may be selected, SHALL show no out-of-owner pane, and SHALL NOT change owner automatically.

