# Tasks: unify-terminal-navigation-state

## 1. Establish one navigation authority

- [x] 1_1 Introduce total owner state and versioned checkpoint — verified: pnpm exec vitest run src/webview/navigation/TerminalNavigationState.test.ts src/webview/navigation/TerminalNavigationState.property.test.ts src/webview/state/WebviewStateStore.navigation.test.ts && pnpm exec vitest run src/webview/state/WebviewStateStore.test.ts src/webview/state/WebviewStateStore.searchMode.test.ts exit 0
  - **Deps**: none
  - **Refs**: specs/terminal-owner-navigation/spec.md#{every-terminal-has-one-stable-owner,restore-uses-one-versioned-navigation-checkpoint,restore-validates-saved-navigation-against-terminal-facts,presence-reports-activity-but-never-terminal-ownership}; design.md D1, design.md D2, design.md D3, design.md D6
  - **Acceptance**:
    - Outcome: Navigation state always has a total owner and independently verified live tab and pane references.
    - Verify: command pnpm exec vitest run src/webview/navigation/TerminalNavigationState.test.ts src/webview/navigation/TerminalNavigationState.property.test.ts src/webview/state/WebviewStateStore.navigation.test.ts
  - **Plan**:
    1. Add `src/webview/navigation/TerminalNavigationState.ts` with owner decoding, checkpoint schema, catalog queries, pure transitions, and deterministic clamping.
    2. Add `src/webview/navigation/TerminalNavigationState.test.ts` and `src/webview/navigation/TerminalNavigationState.property.test.ts`; assert invariants with independent predicates rather than the production validator.
    3. Extend `src/webview/state/WebviewState.ts` and `src/webview/state/WebviewStateStore.ts`, and add `src/webview/state/WebviewStateStore.navigation.test.ts` for versioned checkpoint persistence, validation, explicit owner-empty state, and legacy field access.

- [x] 1_2 Add a queued commit-before-effects controller — verified: pnpm exec vitest run src/webview/navigation/TerminalNavigationController.test.ts && pnpm exec vitest run src/webview/navigation/TerminalNavigationState.test.ts src/webview/navigation/TerminalNavigationState.property.test.ts exit 0
  - **Deps**: 1_1
  - **Refs**: specs/terminal-owner-navigation/spec.md#{navigation-changes-owner-tab-and-pane-as-one-action,navigation-is-isolated-per-surface}; design.md D3, design.md D4
  - **Acceptance**:
    - Outcome: Each accepted intent produces one effect batch and each no-op produces none.
    - Verify: command pnpm exec vitest run src/webview/navigation/TerminalNavigationController.test.ts
  - **Plan**:
    1. Add `src/webview/navigation/TerminalNavigationController.ts` with catalog transactions, queued reentrant intents, effect ordering, persistence, and delayed-effect generation cancellation.
    2. Add `src/webview/navigation/TerminalNavigationController.test.ts` for transition ordering, no-op behavior, queued callbacks, stale delayed focus, and controller isolation.

- [x] 1_3 Route interactive and creation ingresses through the controller — verified: pnpm exec vitest run src/webview/navigation/TerminalNavigationComposition.test.ts src/webview/worktree/activatePane.test.ts src/webview/TabBar.test.ts src/providers/TerminalViewProvider.vaultContinue.test.ts && pnpm exec vitest run src/webview/navigation/TerminalNavigationController.test.ts src/webview/navigation/TerminalNavigationState.test.ts exit 0
  - **Deps**: 1_2
  - **Refs**: specs/terminal-owner-navigation/spec.md#{navigation-changes-owner-tab-and-pane-as-one-action,terminal-creation-activates-its-assigned-owner}; specs/tab-bar-component/spec.md#{tab-click-handlers,tab-bar-update-integration,scope-changes-what-is-drawn-and-nothing-else}; design.md D3, design.md D4, design.md D8
  - **Acceptance**:
    - Outcome: Tab click, session focus, terminal creation, DOM focus, and last-tab replacement share one transition path.
    - Verify: command pnpm exec vitest run src/webview/navigation/TerminalNavigationComposition.test.ts src/webview/worktree/activatePane.test.ts src/webview/TabBar.test.ts src/providers/TerminalViewProvider.vaultContinue.test.ts
  - **Plan**:
    1. Add `src/webview/navigation/TerminalNavigationComposition.ts` and `src/webview/navigation/TerminalNavigationComposition.test.ts` using production adapters to reproduce owner-before-pane recursion, transient old-tab activation, focusin duplication, and last-tab replacement owner loss.
    2. Route tab click, terminal-created, Vault-created, DOM focus, close, and last-tab replacement in `src/webview/main.ts` through controller transactions.
    3. Remove navigation writes from `src/webview/worktree/activatePane.ts`, update `src/webview/worktree/activatePane.test.ts`, and adapt `src/webview/terminal/TerminalFactory.ts` to register facts before one intent.

- [x] 1_4 Replace independent host activity writers with one nullable echo — verified: pnpm exec vitest run src/session/SessionManager.test.ts src/providers/TerminalViewProvider.test.ts src/providers/TerminalEditorProvider.test.ts src/extension.worktreeAssembly.test.ts && pnpm exec vitest run src/webview/navigation/TerminalNavigationController.test.ts src/webview/navigation/TerminalNavigationComposition.test.ts exit 0
  - **Deps**: 1_3
  - **Refs**: specs/terminal-owner-navigation/spec.md#{navigation-changes-owner-tab-and-pane-as-one-action,navigation-is-isolated-per-surface}; specs/worktree-panel/spec.md#a-focused-pane-is-revealed-where-it-actually-lives; design.md D1, design.md D5, design.md D7
  - **Acceptance**:
    - Outcome: One committed nullable tab and pane pair drives all host-side active-session routing.
    - Verify: command pnpm exec vitest run src/session/SessionManager.test.ts src/providers/TerminalViewProvider.test.ts src/providers/TerminalEditorProvider.test.ts src/extension.worktreeAssembly.test.ts
  - **Plan**:
    1. Add `terminalNavigationCommitted` to `src/types/messages.ts` and emit it from `src/webview/main.ts`; `MessageRouter.ts` remains extension-to-webview only.
    2. Add validated nullable navigation echo handling to `src/session/SessionManager.ts`, `src/providers/TerminalViewProvider.ts`, and `src/providers/TerminalEditorProvider.ts`; retire independent tab-switch and focus cache writes.
    3. Extend `src/session/SessionManager.test.ts`, `src/providers/TerminalViewProvider.test.ts`, `src/providers/TerminalEditorProvider.test.ts`, and `src/extension.worktreeAssembly.test.ts` coverage for clearing, retained split roots, wrong-view rejection, and target-surface-only routing.

## 2. Make asynchronous lifecycle transitions coherent

- [ ] 2_1 Correlate split requests and guarantee completion
  - **Deps**: 1_4
  - **Refs**: specs/terminal-owner-navigation/spec.md#{every-terminal-has-one-stable-owner,split-completion-remains-attached-to-its-source-tab}; design.md D3, design.md D4, design.md D7
  - **Acceptance**:
    - Outcome: No completed split child remains unreachable from the terminal UI.
    - Verify: command pnpm exec vitest run src/providers/TerminalViewProvider.test.ts src/webview/split/SplitTreeRenderer.test.ts
  - **Plan**:
    1. Extend split request, response, and attachment-result contracts in `src/types/messages.ts`; track correlated pending children in `src/providers/TerminalViewProvider.ts` with bounded cleanup on rejection, timeout, disposal, or source disappearance.
    2. Add source-tab correlation and attachment acknowledgment in `src/webview/main.ts` and `src/webview/split/SplitTreeRenderer.ts`; derive local child owner from the current source fact and never from the currently active tab.
    3. Add `src/webview/split/SplitTreeRenderer.test.ts` and provider cases for tab switching, owner reconciliation, failed delivery, missing source, attached-child retention, and no unreachable session.

- [ ] 2_2 Restore and reconcile navigation with explicit precedence
  - **Deps**: 2_1
  - **Refs**: specs/terminal-owner-navigation/spec.md#{restore-uses-one-versioned-navigation-checkpoint,restore-validates-saved-navigation-against-terminal-facts,snapshot-replay-order-never-chooses-restored-navigation,a-disappeared-linked-owner-falls-back-atomically}; specs/tab-bar-component/spec.md#{a-scope-that-loses-its-worktree-is-dropped-and-said,a-surface-s-scope-survives-a-reload-and-never-outlives-its-worktree,a-host-restart-resets-the-scope-an-in-memory-re-resolve-preserves-it}; design.md D4, design.md D6
  - **Acceptance**:
    - Outcome: Warm reload, cold restore, legacy migration, and owner disappearance each commit one valid navigation state.
    - Verify: command pnpm exec vitest run src/webview/navigation/TerminalNavigationRestore.integration.test.ts src/providers/TerminalViewProvider.restore.test.ts src/session/SessionManager.snapshot.test.ts
  - **Plan**:
    1. Add `src/webview/navigation/TerminalNavigationRestore.ts` and `src/webview/navigation/TerminalNavigationRestore.integration.test.ts` for catalog-first warm, cold, exited, stale-root, owner-empty, and absent-tree restore sequences.
    2. Replace `resetWorktreeScope` with `navigationBootstrap` in `src/types/messages.ts`, `src/providers/TerminalViewProvider.ts`, `src/providers/TerminalEditorProvider.ts`, and `src/webview/main.ts`.
    3. Apply checkpoint-first precedence and one-shot legacy scope consumption in `src/webview/state/WebviewStateStore.ts`; route complete owner reconciliation through one controller transaction.

## 3. Render committed navigation without mirror state

- [ ] 3_1 Convert tab scope into active-owner projection
  - **Deps**: 2_2
  - **Refs**: specs/tab-bar-component/spec.md#{tab-bar-rendering,the-tab-bar-is-presented-whenever-it-is-filtered,a-scope-is-named-wherever-it-is-in-force,a-push-that-moves-no-attribution-redraws-no-tab-bar,a-hidden-tab-that-needs-a-human-is-counted,a-scope-holding-no-pane-says-so-and-offers-what-is-worth-doing}; design.md D2, design.md D8
  - **Acceptance**:
    - Outcome: Tab membership, linked indicator, waiting count, and empty state are pure active-owner projections.
    - Verify: command pnpm exec vitest run src/webview/tabBarScope.test.ts src/webview/tabBarScopeWiring.test.ts src/webview/emptyScopeRegion.test.ts src/webview/TabBar.test.ts
  - **Plan**:
    1. Remove mutable scope, resolution, and navigation persistence from `src/webview/tabBarScope.ts` and `src/webview/tabBarScopeWiring.ts`, retaining only projection helpers where reuse remains useful.
    2. Update `src/webview/TabBarUtils.ts` and `src/webview/emptyScopeRegion.ts` to consume total active owner, exact stable membership, linked-only indicators, waiting counts, and owner-empty state.
    3. Rewrite focused tests to delete `All` and presence-membership assertions and to enforce no owner projection callback can dispatch navigation.

- [ ] 3_2 Project linked owner into the worktree tree
  - **Deps**: 3_1
  - **Refs**: specs/tab-bar-component/spec.md#selecting-a-worktree-goes-to-a-pane-of-that-worktree; specs/worktree-panel/spec.md#{only-an-active-linked-owner-marks-a-worktree-row,worktree-row-activation-requests-one-navigation-transition,a-selection-leaves-the-rail-as-the-user-left-it,scope-does-not-depend-on-the-layout}; design.md D4, design.md D8
  - **Acceptance**:
    - Outcome: Only a linked active owner marks a row; main and keyboard focus create no owner mark.
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeView.test.ts src/webview/worktree/WorktreeController.test.ts src/webview/tabBarScopeWiring.test.ts
  - **Plan**:
    1. Replace `selectedWorktreeId` navigation writes in `src/webview/worktree/WorktreeView.ts`, `src/webview/worktree/WorktreeController.ts`, and `src/webview/worktree/worktreeView/worktreeRow.ts` with linked-owner rendering input and owner intents.
    2. Update controller composition files under `src/webview/worktree/controller/` so terminal focus and creation change the projection without changing roving keyboard focus, expansion, rail visibility, search, or menus.
    3. Add multi-root main, linked programmatic focus, row activation, and no-focus-jump cases to worktree tests.

## 4. Reconcile contracts and enforcement

- [ ] 4_1 Rewrite worktree-facing navigation documentation
  - **Deps**: 3_2
  - **Refs**: specs/terminal-owner-navigation/spec.md#{navigation-changes-owner-tab-and-pane-as-one-action,navigation-is-isolated-per-surface,presence-reports-activity-but-never-terminal-ownership}; specs/worktree-panel/spec.md#a-history-is-requested-once-per-session-and-again-if-that-session-returns; design.md D7, design.md D8
  - **Acceptance**:
    - Outcome: Worktree documentation contains only current stable-owner navigation and no inspector contract.
    - Verify: command pnpm exec vitest run src/test/invariants/terminalNavigationDocs.test.ts
  - **Plan**:
    1. Rewrite `docs/design/worktree-scope.md` around global main, linked owners, atomic navigation, linked-only marks, and surface isolation.
    2. Update `docs/design/worktree-panel-ui.md`, `docs/design/worktree-agent-presence.md`, and `docs/design/worktree-rpc.md` to remove inspector, `All`, presence-membership, and independent selection claims.
    3. Add `src/test/invariants/terminalNavigationDocs.test.ts` to inspect every changed navigation document for required authority statements and retired terms.

- [ ] 4_2 Reconcile terminal architecture and invariant registry
  - **Deps**: 4_1
  - **Refs**: specs/terminal-owner-navigation/spec.md#{every-terminal-has-one-stable-owner,restore-uses-one-versioned-navigation-checkpoint,restore-validates-saved-navigation-against-terminal-facts,snapshot-replay-order-never-chooses-restored-navigation,presence-reports-activity-but-never-terminal-ownership}; design.md D1, design.md D3, design.md D5, design.md D6
  - **Acceptance**:
    - Outcome: Architecture and invariant registry enforce stable owner, coherent navigation, split completion, and restore precedence.
    - Verify: command pnpm exec vitest run src/test/invariants/coverage.test.ts src/test/invariants/terminalNavigationDocs.test.ts
  - **Plan**:
    1. Update `docs/design/xterm-integration.md`, `docs/design/session-manager.md`, `docs/design/message-protocol.md`, and `docs/DESIGN.md`; supersede D50 and document checkpoint and host echo boundaries.
    2. Update `src/test/invariants/registry.ts` and tagged production-boundary tests so stable ownership, atomic navigation, split reachability, and presence non-authority replace obsolete attribution behavior.
