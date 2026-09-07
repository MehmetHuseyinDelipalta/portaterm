# Proposal: unify-terminal-navigation-state

## Why

Terminal owner, active tab, active pane, tab scope, and worktree selection can disagree because separate components mutate them in sequence. Replace that choreography with one per-surface navigation authority while retaining the extension host as the canonical owner of durable session facts.

## Appetite

M (≤3d)

## Scope

### In scope

- A total global-main-or-linked owner model for every terminal surface.
- Atomic owner, tab, and pane transitions for worktree selection, tab click, session focus, creation, split, close, restore, Vault launch, and owner disappearance.
- A versioned per-surface navigation checkpoint and a nullable host routing echo.
- Worktree marks, tab filtering, frame, indicator, and empty state as projections of committed navigation.
- One-shot migration away from persisted `All`/presence-derived scope semantics and reconciliation of stale specifications and design docs.

### Out of scope

- Synchronizing navigation between different terminal surfaces.
- Moving an existing terminal to another owner except linked-owner disappearance fallback to main.
- Changing worktree discovery, agent activity inference, Vault indexing, or general PTY lifecycle.
- Redesigning worktree expansion, keyboard row focus, search, menus, or disclosure.

### Must not

- Shell `cd` or presence attribution must not change terminal ownership.
- Navigation must not stop, close, detach, or restart an attached terminal.
- One surface must not follow another surface's owner, tab, or pane.
- Main must not mark a repository-specific worktree row or display the linked frame/indicator.
- Split rollback may destroy only a newly created child that was never attached and acknowledged.

## Risk Level

MEDIUM — the change touches every terminal navigation ingress, persistence, and asynchronous split completion while preserving existing PTY and worktree discovery ownership.
