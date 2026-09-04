## 1. Inline empty state sits on the row grid

- [x] 1_1 Inset the inline empty state to the row label column and scale it to a row — verified: VITEST_MAX_THREADS=2 pnpm exec vitest run 'src/webview/worktree/WorktreeView.test.ts' && pnpm exec tsc --noEmit -p tsconfig.json && VITEST_MAX_THREADS=2 pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: asimov/specs/worktree-panel/spec.md#{each-cause-of-emptiness-reads-differently, the-unbranched-repository-state-offers-the-create-it-describes}
  - **Acceptance**:
    - Outcome: "No other worktrees yet" starts on the same x as the worktree rows' labels above it
    - Verify: unit src/webview/worktree/WorktreeView.test.ts
  - **Plan**:
    1. `src/webview/worktree/worktreePanel.css` `.wt-empty-inline` — set `padding-left` to the row label column's inset: `.wt-row` margin 4px + padding-left 8px + the 16px glyph column + the 6px grid gap = 34px; keep the right inset in step with `.wt-row`'s 10px padding + 4px margin, and shrink the vertical padding to a row's (4px above, 8px below) and `gap` to 2px. State the derivation in the comment above the rule so a later `.wt-row` edit knows what to keep in step.
    2. Same file — add `.wt-empty-inline .vault-empty-title` at the row's 13px size and 500 weight (matches `.wt-branch`, restated because the atom sets those same values itself and a scoped rule must name it to own it) and `.wt-empty-inline .vault-empty-body` at `.wt-idle`'s 11px with `line-height: 1.4` and `max-width: none`, so the block reads at the tree's scale rather than the panel's.
    3. `src/webview/worktree/WorktreeView.test.ts` — beside `[1_1] offers the inline create as a secondary action`, add a test that reads `worktreePanel.css` from source (same idiom), extracts the `.wt-empty-inline` rule, and asserts its `padding-left` is `34px`; and one that asserts a `.wt-empty-inline .vault-empty-body` rule exists and sets `font-size: 11px`. Tag both `[1_1]`.
  - **Boundary**: `.wt-row`, `.wt-repo`, the shared `emptyState` atom and `vaultPanel.css` are not edited; the four panel-scale empty kinds are untouched.
