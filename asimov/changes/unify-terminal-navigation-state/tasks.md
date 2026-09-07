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

- [x] 2_1 Correlate split requests and guarantee completion — verified: pnpm exec vitest run src/providers/TerminalViewProvider.test.ts src/webview/split/SplitTreeRenderer.test.ts && pnpm exec vitest run src/webview/navigation/TerminalNavigationController.test.ts src/webview/messaging/MessageRouter.test.ts src/webview/navigation/TerminalNavigationComposition.test.ts exit 0
  - **Deps**: 1_4
  - **Refs**: specs/terminal-owner-navigation/spec.md#{every-terminal-has-one-stable-owner,split-completion-remains-attached-to-its-source-tab}; design.md D3, design.md D4, design.md D7
  - **Acceptance**:
    - Outcome: No completed split child remains unreachable from the terminal UI.
    - Verify: command pnpm exec vitest run src/providers/TerminalViewProvider.test.ts src/webview/split/SplitTreeRenderer.test.ts
  - **Plan**:
    1. Extend split request, response, and attachment-result contracts in `src/types/messages.ts`; track correlated pending children in `src/providers/TerminalViewProvider.ts` and `src/providers/TerminalViewProvider.test.ts` with bounded cleanup on rejection, timeout, disposal, or source disappearance.
    2. Add source-tab correlation and attachment acknowledgment in `src/webview/main.ts` and `src/webview/split/SplitTreeRenderer.ts`; update `src/webview/navigation/TerminalNavigationController.ts` and `src/webview/navigation/TerminalNavigationController.test.ts` so catalog mutations receive one effect batch even when selection is unchanged.
    3. Add `src/webview/split/SplitTreeRenderer.test.ts`, update `src/webview/messaging/MessageRouter.test.ts`, and add provider cases for tab switching, owner reconciliation, failed delivery, missing source, attached-child retention, and no unreachable session.

- [x] 2_2 Restore and reconcile navigation with explicit precedence — verified: pnpm exec vitest run src/webview/navigation/TerminalNavigationRestore.integration.test.ts src/providers/TerminalViewProvider.restore.test.ts src/session/SessionManager.snapshot.test.ts && pnpm exec vitest run src/webview/state/WebviewStateStore.navigation.test.ts src/providers/TerminalViewProvider.test.ts src/providers/TerminalEditorProvider.test.ts src/webview/navigation/TerminalNavigationController.test.ts exit 0
  - **Deps**: 2_1
  - **Refs**: specs/terminal-owner-navigation/spec.md#{restore-uses-one-versioned-navigation-checkpoint,restore-validates-saved-navigation-against-terminal-facts,snapshot-replay-order-never-chooses-restored-navigation,a-disappeared-linked-owner-falls-back-atomically}; specs/tab-bar-component/spec.md#{a-scope-that-loses-its-worktree-is-dropped-and-said,a-surface-s-scope-survives-a-reload-and-never-outlives-its-worktree,a-host-restart-resets-the-scope-an-in-memory-re-resolve-preserves-it}; design.md D4, design.md D6
  - **Acceptance**:
    - Outcome: Warm reload, cold restore, legacy migration, and owner disappearance each commit one valid navigation state.
    - Verify: command pnpm exec vitest run src/webview/navigation/TerminalNavigationRestore.integration.test.ts src/providers/TerminalViewProvider.restore.test.ts src/session/SessionManager.snapshot.test.ts
  - **Plan**:
    1. Add `src/webview/navigation/TerminalNavigationRestore.ts` and `src/webview/navigation/TerminalNavigationRestore.integration.test.ts` for catalog-first warm, cold, exited, stale-root, owner-empty, and absent-tree restore sequences; update `src/session/SessionManager.ts`, `src/providers/TerminalViewProvider.restore.test.ts`, and `src/session/SessionManager.snapshot.test.ts` so replay order cannot manufacture selection.
    2. Replace `resetWorktreeScope` with `navigationBootstrap` in `src/types/messages.ts`, `src/providers/TerminalViewProvider.ts`, `src/providers/TerminalViewProvider.test.ts`, `src/providers/TerminalEditorProvider.ts`, `src/providers/TerminalEditorProvider.test.ts`, and `src/webview/main.ts`.
    3. Apply checkpoint-first precedence and one-shot legacy scope consumption in `src/webview/state/WebviewStateStore.ts` and `src/webview/state/WebviewStateStore.navigation.test.ts`; route complete owner reconciliation through one controller transaction.

## 3. Render committed navigation without mirror state

- [x] 3_1 Convert tab scope into active-owner projection — verified: pnpm exec vitest run src/webview/tabBarScope.test.ts src/webview/tabBarScopeWiring.test.ts src/webview/emptyScopeRegion.test.ts src/webview/TabBar.test.ts && pnpm exec vitest run src/webview/navigation/TerminalNavigationComposition.test.ts exit 0
  - **Deps**: 2_2
  - **Refs**: specs/tab-bar-component/spec.md#{tab-bar-rendering,the-tab-bar-is-presented-whenever-it-is-filtered,a-scope-is-named-wherever-it-is-in-force,a-push-that-moves-no-attribution-redraws-no-tab-bar,a-hidden-tab-that-needs-a-human-is-counted,a-scope-holding-no-pane-says-so-and-offers-what-is-worth-doing}; design.md D2, design.md D8
  - **Acceptance**:
    - Outcome: Tab membership, linked indicator, waiting count, and empty state are pure active-owner projections.
    - Verify: command pnpm exec vitest run src/webview/tabBarScope.test.ts src/webview/tabBarScopeWiring.test.ts src/webview/emptyScopeRegion.test.ts src/webview/TabBar.test.ts
  - **Plan**:
    1. Remove mutable scope, resolution, and navigation persistence from `src/webview/tabBarScope.ts` and `src/webview/tabBarScopeWiring.ts`, retaining only projection helpers where reuse remains useful; remove owner callbacks from `src/webview/navigation/TerminalNavigationComposition.ts` and compose owner intents and projections in `src/webview/main.ts`.
    2. Update `src/webview/TabBarUtils.ts` and `src/webview/emptyScopeRegion.ts` to consume total active owner, exact stable membership, linked-only indicators, waiting counts, and owner-empty state.
    3. Rewrite focused tests to delete `All` and presence-membership assertions and to enforce no owner projection callback can dispatch navigation.

- [x] 3_2 Project linked owner into the worktree tree — verified: pnpm exec vitest run src/webview/worktree/WorktreeView.test.ts src/webview/worktree/WorktreeController.test.ts src/webview/tabBarScopeWiring.test.ts exit 0
  - **Deps**: 3_1
  - **Refs**: specs/tab-bar-component/spec.md#selecting-a-worktree-goes-to-a-pane-of-that-worktree; specs/worktree-panel/spec.md#{only-an-active-linked-owner-marks-a-worktree-row,worktree-row-activation-requests-one-navigation-transition,a-selection-leaves-the-rail-as-the-user-left-it,scope-does-not-depend-on-the-layout}; design.md D4, design.md D8
  - **Acceptance**:
    - Outcome: Only a linked active owner marks a row; main and keyboard focus create no owner mark.
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeView.test.ts src/webview/worktree/WorktreeController.test.ts src/webview/tabBarScopeWiring.test.ts
  - **Plan**:
    1. Replace `selectedWorktreeId` navigation writes in `src/webview/worktree/WorktreeView.ts`, `src/webview/worktree/WorktreeController.ts`, `src/webview/worktree/worktreeView/viewTypes.ts`, `src/webview/worktree/worktreeView/composeViewCollaborators.ts`, and `src/webview/worktree/worktreeView/worktreeRow.ts` with linked-owner rendering input and owner intents; project controller commits from `src/webview/main.ts`.
    2. Update controller composition files under `src/webview/worktree/controller/` so terminal focus and creation change the projection without changing roving keyboard focus, expansion, rail visibility, search, or menus.
    3. Add multi-root main, linked programmatic focus, row activation, and no-focus-jump cases to worktree tests.

- [x] 3_3 Restore navigation integration type safety — verified: pnpm run check-types exit 0
  - **Deps**: 3_2
  - **Refs**: design.md D4, design.md D5
  - **Acceptance**:
    - Outcome: Correlated split rendering and editor host-echo tests compile under the repository type gate.
    - Verify: command pnpm run check-types
  - **Plan**:
    1. Restore the split-render queue declaration in `src/webview/main.ts` and correct the committed-message test callback typing in `src/providers/TerminalEditorProvider.test.ts`.

- [x] 3_4 Route split-pane close through atomic navigation — verified: pnpm exec vitest run src/webview/split/SplitTreeRenderer.test.ts src/webview/navigation/TerminalNavigationController.test.ts && pnpm exec vitest run src/webview/messaging/MessageRouter.test.ts exit 0
  - **Deps**: 3_3
  - **Refs**: specs/terminal-owner-navigation/spec.md#navigation-changes-owner-tab-and-pane-as-one-action; design.md D4, design.md D8
  - **Acceptance**:
    - Outcome: Closing a split pane produces one atomic navigation effect batch.
    - Verify: command pnpm exec vitest run src/webview/split/SplitTreeRenderer.test.ts src/webview/navigation/TerminalNavigationController.test.ts
  - **Plan**:
    1. Make `src/webview/split/SplitTreeRenderer.ts` split-close handling fact-only and return the owning tab plus surviving pane.
    2. Compose the close inside one controller transaction in `src/webview/main.ts`; update `src/webview/split/SplitTreeRenderer.test.ts` and `src/webview/navigation/TerminalNavigationController.test.ts` to reject direct render, persist, focus, or host-routing effects before commit.

## 4. Reconcile contracts and enforcement

- [x] 4_1 Rewrite worktree-facing navigation documentation — verified: pnpm exec vitest run src/test/invariants/terminalNavigationDocs.test.ts exit 0
  - **Deps**: 3_3
  - **Refs**: specs/terminal-owner-navigation/spec.md#{navigation-changes-owner-tab-and-pane-as-one-action,navigation-is-isolated-per-surface,presence-reports-activity-but-never-terminal-ownership}; specs/worktree-panel/spec.md#a-history-is-requested-once-per-session-and-again-if-that-session-returns; design.md D7, design.md D8
  - **Acceptance**:
    - Outcome: Worktree documentation contains only current stable-owner navigation and no inspector contract.
    - Verify: command pnpm exec vitest run src/test/invariants/terminalNavigationDocs.test.ts
  - **Plan**:
    1. Rewrite `docs/design/worktree-scope.md` around global main, linked owners, atomic navigation, linked-only marks, and surface isolation.
    2. Update `docs/design/worktree-panel-ui.md`, `docs/design/worktree-agent-presence.md`, and `docs/design/worktree-rpc.md` to remove inspector, `All`, presence-membership, and independent selection claims.
    3. Add `src/test/invariants/terminalNavigationDocs.test.ts` to inspect every changed navigation document for required authority statements and retired terms.

- [x] 4_2 Reconcile terminal architecture and invariant registry — verified: pnpm exec vitest run src/test/invariants/coverage.test.ts src/test/invariants/terminalNavigationDocs.test.ts && pnpm exec vitest run src/session/SessionManager.test.ts src/session/SessionManager.snapshot.test.ts src/providers/TerminalViewProvider.test.ts src/webview/navigation/TerminalNavigationState.property.test.ts src/webview/navigation/TerminalNavigationRestore.integration.test.ts src/webview/TabBar.test.ts exit 0
  - **Deps**: 4_1, 3_4
  - **Refs**: specs/terminal-owner-navigation/spec.md#{every-terminal-has-one-stable-owner,restore-uses-one-versioned-navigation-checkpoint,restore-validates-saved-navigation-against-terminal-facts,snapshot-replay-order-never-chooses-restored-navigation,presence-reports-activity-but-never-terminal-ownership}; design.md D1, design.md D3, design.md D5, design.md D6
  - **Acceptance**:
    - Outcome: Architecture and invariant registry enforce stable owner, coherent navigation, split completion, and restore precedence.
    - Verify: command pnpm exec vitest run src/test/invariants/coverage.test.ts src/test/invariants/terminalNavigationDocs.test.ts
  - **Plan**:
    1. Update `docs/design/xterm-integration.md`, `docs/design/session-manager.md`, `docs/design/message-protocol.md`, and `docs/DESIGN.md`; supersede D50 and document checkpoint and host echo boundaries.
    2. Update `src/test/invariants/registry.ts`, `src/session/SessionManager.test.ts`, `src/session/SessionManager.snapshot.test.ts`, `src/providers/TerminalViewProvider.test.ts`, `src/webview/navigation/TerminalNavigationState.property.test.ts`, `src/webview/navigation/TerminalNavigationRestore.integration.test.ts`, and `src/test/invariants/terminalNavigationDocs.test.ts`, `src/webview/TabBar.test.ts` so stable ownership, atomic navigation, split reachability, restore precedence, and presence non-authority replace obsolete attribution behavior.


## 5. Close review findings

- [x] 5_1 Close round-1 split completion blockers — verified: pnpm exec vitest run src/providers/TerminalViewProvider.test.ts src/webview/navigation/TerminalNavigationController.test.ts src/webview/navigation/TerminalNavigationComposition.test.ts src/webview/navigation/TerminalNavigationState.test.ts src/webview/messaging/MessageRouter.test.ts && pnpm exec vitest run src/test/invariants/terminalNavigationDocs.test.ts exit 0
  - **Deps**: 4_2
  - **Refs**: design.md D3, design.md D7; design.md OBL-3, design.md OBL-7
  - **Acceptance**:
    - Outcome: A delivered split child survives delayed acknowledgment, and attachment success is emitted only after a replayable committed effect batch completes.
    - Verify: command pnpm exec vitest run src/providers/TerminalViewProvider.test.ts src/webview/navigation/TerminalNavigationController.test.ts src/webview/navigation/TerminalNavigationComposition.test.ts src/webview/navigation/TerminalNavigationState.test.ts src/webview/messaging/MessageRouter.test.ts
  - **Plan**:
    1. Distinguish undelivered from delivered-pending children in `src/providers/TerminalViewProvider.ts`; make `src/providers/TerminalViewProvider.test.ts` prove the host delivery deadline cannot destroy a delivered child and that failed delivery, explicit rejection, source loss, and disposal still clean up.
    2. Make the webview request deadline send a correlated rejection in `src/webview/main.ts` and update the split result union in `src/types/messages.ts` plus `src/webview/messaging/MessageRouter.test.ts`.
    3. Preserve and replay failed post-commit effects and queued intents in `src/webview/navigation/TerminalNavigationController.ts`; add the recovery composition to `src/webview/navigation/TerminalNavigationComposition.ts`, cover it in `src/webview/navigation/TerminalNavigationController.test.ts` and `src/webview/navigation/TerminalNavigationComposition.test.ts`, and gate attachment acknowledgment in `src/webview/main.ts` on successful reconciliation.
    4. Reuse `tabOwningPane` in `src/webview/navigation/TerminalNavigationState.ts` and encode `terminalNavigationCommitted` as a coherent nullable-pair union in `src/types/messages.ts`.
    5. Reconcile delivery-aware timeout and effect-recovery wording in `docs/design/worktree-scope.md`, `docs/design/xterm-integration.md`, `docs/design/message-protocol.md`, and `src/test/invariants/terminalNavigationDocs.test.ts`.

- [x] 5_2 Repair stable-owner obligation witness paths — verified: pnpm exec vitest run src/session/SessionManager.test.ts src/session/SessionManager.snapshot.test.ts src/webview/TabBar.test.ts exit 0
  - **Deps**: 5_1
  - **Refs**: design.md OBL-1
  - **Acceptance**:
    - Outcome: OBL-1 cites existing tests that independently witness stable owner persistence and presence-independent projection.
    - Verify: command pnpm exec vitest run src/session/SessionManager.test.ts src/session/SessionManager.snapshot.test.ts src/webview/TabBar.test.ts
  - **Plan**:
    1. Replace the nonexistent OBL-1 witness paths in `asimov/changes/unify-terminal-navigation-state/design.md` with the shipped I18 and I19 witness suites.


- [x] 5_3 Close round-2 split convergence blockers — verified: pnpm exec vitest run src/providers/TerminalViewProvider.test.ts src/webview/navigation/TerminalNavigationController.test.ts src/webview/navigation/TerminalNavigationComposition.test.ts src/webview/split/SplitTreeRenderer.test.ts && pnpm exec vitest run src/test/invariants/terminalNavigationDocs.test.ts exit 0
  - **Deps**: 5_2
  - **Refs**: design.md D3, design.md D7; design.md OBL-3, design.md OBL-7
  - **Acceptance**:
    - Outcome: A late split post is safe, and persistent effect failure rolls back its provisional child.
    - Verify: command pnpm exec vitest run src/providers/TerminalViewProvider.test.ts src/webview/navigation/TerminalNavigationController.test.ts src/webview/navigation/TerminalNavigationComposition.test.ts src/webview/split/SplitTreeRenderer.test.ts
  - **Plan**:
    1. Remove unilateral delivery-timer destruction from `src/providers/TerminalViewProvider.ts`; update `src/providers/TerminalViewProvider.test.ts` for late true resolution, resolved-false delivery, explicit rejection, source loss, disposal, and capped pending ownership.
    2. Add explicit failed-effect abandonment for rollback in `src/webview/navigation/TerminalNavigationController.ts` and `src/webview/navigation/TerminalNavigationController.test.ts` without weakening transient queued-intent recovery.
    3. Add bounded scheduled recovery and provisional-child rollback composition in `src/webview/navigation/TerminalNavigationComposition.ts`, `src/webview/navigation/TerminalNavigationComposition.test.ts`, and `src/webview/main.ts`; reuse fact-only close from `src/webview/split/SplitTreeRenderer.ts`.
    4. Reconcile the convergent protocol in `docs/design/worktree-scope.md`, `docs/design/xterm-integration.md`, `docs/design/message-protocol.md`, and `src/test/invariants/terminalNavigationDocs.test.ts`.
