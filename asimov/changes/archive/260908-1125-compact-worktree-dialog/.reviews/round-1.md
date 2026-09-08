# Asimov Review Round 1

- Date: 2026-09-08
- Cycle: 1
- Mode: discovery
- Scope: production-only commit range `3766b9bc..e0d4b216faf096dee16dae09ebca22799a2ae125`
- Head: `e0d4b216faf096dee16dae09ebca22799a2ae125`
- Tree: frozen at dispatch; the only then-current working-tree diff was hook-generated `asimov/changes/compact-worktree-dialog/analytics.json`. Later temporary edits to `src/webview/worktree/WorktreeCreateDialog.test.ts`, `src/webview/worktree/WorktreeView.test.ts`, and `src/webview/vault/VaultPanel.test.ts` belong to a separate test-pruning experiment and were excluded. All test-file changes, verification artifacts, and change metadata were excluded as review targets.
- Reviewable lines: 1291
- Size note: Large change — accuracy may decrease
- Agents spawned:
  - `asm-review-frontend` — create-dialog DOM, focus, responsive presentation, and accessibility — `gpt-5.6-sol[1M]`
  - `asm-review-logic` — provisioning grouping, consent, replacement offers, and async state — `gpt-5.6-terra[1M]`
  - `asm-review-frontend` — Vault header, narrow rows, persistent footer, and trailing chips — `sonnet[1M]`
  - `asm-review-contracts` — panel-size message, surface guard, and host lifecycle — `gpt-5.6-terra[1M]`
  - `asm-review-performance` — bounded offer/list rendering and recompute paths — `gpt-5.6-luna[1M]`
  - `asm-review-reuse` — dialog atoms, provisioning composition, and row-action reuse — `gpt-5.6-luna[1M]`
- Support agent: `asm-finder` — authoritative surface identity and end-to-end create-flow trace — `gpt-5.6-luna[1M]`
- Agents skipped:
  - `asm-review-data-security` — no persistence, auth, secret, trust-boundary, or input-authority change
- Full-flow trace: Vault and per-repository actions enter the existing Worktree controller, snapshot an opening, ask the host for defaults/refs, compose one dialog DOM, settle host-owned provisioning offers into opaque selected ids, submit through the existing create conversation, and retire all bindings on submit, Cancel, Escape, or scrim dismissal. The panel-height path is separately explicit: checkpoint-authored `data-terminal-location` enables the control only for `panel`; its payload-free message reaches `TerminalViewProvider`, whose location/current-view/visibility guard precedes `workbench.action.toggleMaximizedPanel`. CSS media/container queries rearrange the same mounted controls and add no resize listener or replacement lifecycle.
- Data-scale pass: provisioning grows per host offer and is structurally capped by `MAX_MODEL_ROWS = 200`; changed grouping/count passes are linear over that offer, with contention aggregation retained in its existing bounded owner. Worktree rendering retains existing cap/fold behavior and status marks are structurally capped. No scale finding survived adjudication.
- Verification evidence: review did not run project gates. Pre-checkpoint evidence supplied for this frozen scope records 333 suites / 8134 tests, typecheck, check-mode lint with seven existing warnings, and I10 passing. Native editor command verification and the phase-8 browser matrix remain explicitly unrun.
- Verdict: WARN
- Counts: 0 BLOCK, 1 WARN, 0 SUGGEST
- Split: 0 feature, 0 machinery gating blockers

## Findings

### F001

- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: asm-review-frontend; chair
- Class: feature
- File: `src/webview/worktree/worktreeTreeView.ts:1019`
- Title: Persistent create footers bypass the tree's roving keyboard model
- Evidence: `renderCreateWorktreeAction` appends a direct button under the `role="tree"` root and forces `tabIndex = 0`. The tree keyboard owner enumerates only `.wt-repo, .wt-idle, .wt-row, .wt-arow, .wt-srow`, maintains one roving row stop, and resolves arrow movement only through those rows. `.wt-create-worktree` therefore creates one permanent extra Tab stop per populated repository, has no `treeitem` role or `aria-level`, cannot be reached by ArrowDown from the preceding row, and makes arrow keys pressed on the footer resolve from an unrecognized active item.
- Impact: Keyboard and screen-reader users encounter controls inside the tree that are outside its announced hierarchy and traversal order; multi-repository views add multiple permanent Tab stops instead of preserving the tree's single-stop/arrow-navigation contract.
- Reach: none — the create action remains operable by Tab and pointer, so this does not reach data loss, a wrong repository target, a crossed security boundary, or a broken primary create flow.
- Adjudicated-by: chair
- Adjudication: Walked the shipped DOM and keyboard path from `WorktreeView`'s `role="tree"` root through `treeRender.ts:466-468`, `renderCreateWorktreeAction`, and `keyboardNav.ts`. The footer is deliberately appended inside the tree but absent from `NAV_ROWS`; `syncRovingTabindex`, `stampLevels`, `depthOf`, and active-row resolution never include it. The existing conditional Show-all button shows this mixed-widget pattern is not new in kind, but the change makes it persistent and once-per-populated-repository, so the regression is retained as a non-blocking accessibility warning.
- Witness: none — non-blocking accessibility/keyboard contract warning; the production code path is statically deterministic.
- SuggestedFix: Either model the footer as a navigable `treeitem` and include it in the tree's key/depth/roving traversal, or render repository create footers outside the `role="tree"` region while preserving their visual placement and repository-specific callback.
- Status: accepted
- Triage: Parent independently confirmed the direct tree child, permanent tabIndex=0 and exclusion from NAV_ROWS in production. Accept as the chair's non-blocking accessibility warning, not a primary-flow failure. No fix applied: choosing treeitem integration versus moving the control outside the tree affects the keyboard/DOM design and is left for user approval.

## Remediation evidence

F001 remains the chair's accepted non-blocking warning. Implemented via task 9_1: the footer now participates in NAV_ROWS, carries treeitem semantics and a namespaced per-repo identity, and uses the existing leaf depth. Focus/targeting/repaint tests and actual browser Enter/Space/arrow traversal passed; no new review verdict is claimed. Full final verification passed 8136 tests with two workers. User authorized approval and archive after verified correction.
