## 1. Center the inline state

- [x] 1_1 Center the unbranched empty-state block inside the tree — verified: VITEST_MAX_THREADS=6 pnpm exec vitest run src/webview/worktree/WorktreeView.test.ts && pnpm run check-types && VITEST_MAX_THREADS=6 pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: asimov/specs/worktree-panel/spec.md#{each-cause-of-emptiness-reads-differently, the-unbranched-repository-state-offers-the-create-it-describes}
  - **Acceptance**:
    - Outcome: the compact unbranched empty state is centered within the tree
    - Verify: command VITEST_MAX_THREADS=6 pnpm exec vitest run src/webview/worktree/WorktreeView.test.ts
  - **Plan**:
    1. In src/webview/worktree/worktreePanel.css replace the row-label inset on `.wt-empty-inline` with centered alignment and a bounded body measure; keep the compact title, body and secondary action rules.
    2. In src/webview/worktree/WorktreeView.test.ts replace the old row-label assertion with a centered-layout assertion and keep the compact typography witness.
  - **Boundary**: the shared empty-state atom, the four panel-scale empty kinds, copy, action and visibility are untouched.
