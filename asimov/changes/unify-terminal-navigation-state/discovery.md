# Discovery: unify-terminal-navigation-state

## Context

Terminal ownership is durable in the extension host, but navigation is independently mutated by the webview store, tab-scope coordinator, worktree selection, split renderer, DOM focus handler, and focus helpers. These copies permit an active linked terminal while the bar renders main, nested owner/pane activation, and asynchronous split responses attaching to whichever tab became active later.

The shipped product model is one global main terminal bucket plus linked-worktree owners. Shell CWD and presence remain launch/activity evidence; neither may mutate ownership. Existing specifications and design documents still contain the replaced `All + presence attribution` model and an inspector removed by commit `5a05dd54`.

## Options

### Option A — Host-authoritative navigation

Move owner, tab, pane, and split navigation into the extension host. This is feasible only with acknowledgments and a replicated layout model: the host cannot directly observe or apply iframe DOM focus, and failed webview delivery otherwise leaves its declared state unapplied.

### Option B — Surface-authoritative navigation with host-canonical facts (Recommended)

Keep session existence, stable owner, persistence facts, and cross-surface routing in `SessionManager`; give each webview one non-reentrant controller for active owner, tab, and pane. This matches the existing data boundary and VS Code's workbench/backend split without adding a second split topology.

### Option C — Coordinator over existing stores

Sequence the existing mutators without changing ownership. `tabBarScopeWiring` already implements this shape, and its callbacks expose half-applied state, so another coordinator preserves the failure class.

## Reuse — existing code to build on

- `SessionManager.createSession`, `rootTabId`, and `reconcileWorktreeOwners` in `src/session/SessionManager.ts` remain canonical host facts.
- `WebviewStateStore` remains the per-surface topology and persistence boundary, extended with a versioned navigation checkpoint.
- `activatePane` supplies the current pane-to-tab search behavior to fold into the navigation transition model.
- `resolveTabDisplayPane` and `SplitModel` remain the topology queries used to validate displayable leaves.
- `WorktreeHost` and `extension.ts` remain the cross-surface router; the target surface resolves local owner, tab, and pane.
- Existing retry support in `src/providers/webviewRequests.ts` remains the split delivery primitive, with correlated acknowledgment added above it.

## Key Findings

`TerminalInstance.worktreeId` already encodes main as absence, while `tabBarScope` adds `scope + resolved` and `WorktreeView` stores a row-id selection. A linked scope can therefore be consumed as main while its linked tab is active. Pane activation changes owner before active pane; scope settlement can synchronously activate another pane and recurse before the first transition commits.

Host `isActive` is runtime state, not remembered navigation: snapshot metadata omits it, restored roots deactivate predecessors in restore order, and an exited root can leave no active session. Webview persistence also omits `activeTabId`. Restore therefore needs a versioned webview checkpoint rather than treating replay order as user selection.

A split response currently mutates `store.activeTabId`, not the tab containing `sourcePaneId`. A response after tab switching can register a pane in no layout. Correlation and attachment acknowledgment are required so every host-created child is either reachable or rolled back before attachment.

A global main terminal bucket cannot uniquely identify one main worktree row in a multi-root workspace. Main therefore has no active row mark; linked owners project to exactly one linked row.

VS Code keeps active group and instance in the workbench context adjacent to terminal UI and sends layout to the backend for storage. Webview delivery may fail after disposal or port loss, so a host-side state declaration alone cannot prove the surface applied navigation. This supports the hybrid boundary but does not make host authority theoretically impossible.

## Gap Analysis

| Component | Have | Need | Gap |
|---|---|---|---|
| Host session registry | Durable session owner and surface routing | Canonical facts plus nullable committed routing echo | `isActive` and pane cache are independent writers |
| Webview navigation | Active tab/pane plus separate scope and row selection | One versioned owner/tab/pane authority | Multiple writers, no active-tab persistence, reentrancy |
| Split topology | Webview-only persisted tree | Correlated source-tab completion | Response attaches through current active tab; no completion acknowledgment |
| Restore | Host replay activity plus legacy scope | Checkpoint-first explicit warm/cold precedence | Replay order and reset flag can contradict user navigation |
| Worktree UI | Independent selected row | Linked-owner projection; no main mark | Programmatic navigation and multi-root main are ambiguous |
| Presence | Activity and worktree association | Decoration only | Old contracts still let it decide membership |
| Contracts | Applied `All`, inspector, and presence-derived scope | Global main plus linked stable owners | Specs and design docs contradict shipped behavior |
