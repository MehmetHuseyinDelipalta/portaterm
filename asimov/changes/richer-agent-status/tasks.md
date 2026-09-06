## 1. Registry lifecycle truth

- [x] 1_1 Preserve and normalize Claude registry lifecycle state — verified: pnpm exec vitest run src/vault/readers/runningSessions.test.ts src/worktree/registrySessionActivity.test.ts && pnpm run check-types exit 0
  - **Deps**: none
  - **Refs**: specs/claude-running-session-map/spec.md#preserve-claude-registry-lifecycle-state; design.md#d1-one-exact-registry-status-mapping-serves-every-consumer
  - **Acceptance**:
    - Outcome: Registry records preserve busy, waiting, idle and expose one shared activity mapping.
    - Verify: command pnpm exec vitest run src/vault/readers/runningSessions.test.ts src/worktree/registrySessionActivity.test.ts
  - **Plan**:
    1. Extend `src/vault/readers/runningSessions.ts` and its tests to validate `busy | waiting | idle` plus transition timestamps without defaulting unknown values.
    2. Add `src/worktree/registrySessionActivity.ts` and its test with the one registry-to-pane activity mapping consumed downstream.

- [x] 1_2 Apply registry lifecycle state consistently — verified: pnpm exec vitest run src/worktree/presenceProjector.test.ts src/worktree/sessionViews.test.ts src/worktree/worktreeBlockers.test.ts && pnpm run check-types exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-agent-presence/spec.md#{surface-agents-running-outside-this-window, external-activity-age-follows-the-lifecycle-transition}; design.md#d1-one-exact-registry-status-mapping-serves-every-consumer
  - **Acceptance**:
    - Outcome: External rows and removal checks agree on every recognized and unknown registry state.
    - Verify: command pnpm exec vitest run src/worktree/presenceProjector.test.ts src/worktree/sessionViews.test.ts src/worktree/worktreeBlockers.test.ts
  - **Plan**:
    1. Update `src/worktree/presenceProjector.ts` to consume the shared mapper, preserve transition time, omit registry completion, and present missing status through the existing unknown path.
    2. Update `src/worktree/sessionViews.ts` and `src/worktree/worktreeBlockers.ts` to consume and describe the same mapping for removal safety.
    3. Cover busy, waiting, idle, absent and invalid status, timestamp fallback, pre-launch timestamps, repeated scans, and removal outcomes in the adjacent tests.

## 2. Completion semantics

- [x] 2_1 Derive done only from an explicit completed turn — verified: pnpm exec vitest run src/worktree/presenceProjector.test.ts src/webview/worktree/worktreeFormat.test.ts && pnpm run check-types exit 0
  - **Deps**: 1_2
  - **Refs**: specs/worktree-agent-presence/spec.md#{completion-requires-an-explicit-completed-turn, completion-time-survives-only-its-turn}; specs/worktree-panel/spec.md#{strongest-state-wins-and-shape-carries-it, completed-and-idle-are-visually-distinct}; design.md#{d2-done-is-presentation-derived-from-an-authoritative-completion-fact, d3-attention-outranks-execution-evidence-gaps-outrank-history}
  - **Acceptance**:
    - Outcome: Explicitly completed turns receive the done presentation.
    - Verify: command pnpm exec vitest run src/worktree/presenceProjector.test.ts src/webview/worktree/worktreeFormat.test.ts
  - **Plan**:
    1. Refine completion stamping in `src/worktree/presenceProjector.ts` and `src/worktree/presenceTypes.ts` around non-boundary hook transition time, superseding turns, identities, and boundaries.
    2. Extend `src/webview/worktree/worktreeFormat.ts` with derived done presentation, exhaustive grouping, labels, and the approved precedence.
    3. Add transition, duplicate-projection, unknown-precedence, summary-membership, age, and non-Claude no-completion tests beside both modules; update the exhaustive presented-state record in `src/webview/worktree/WorktreeView.test.ts` so the widened presentation type still type-checks.
    4. Correct shell-reclaim and completion terminology in `docs/design/agent-hook-server.md`.

## 3. Hybrid Orca presentation

- [x] 3_1 Render the richer status vocabulary with shape-first theme styling — verified: pnpm exec vitest run src/webview/worktree/WorktreeView.test.ts src/webview/worktree/worktreeFormat.test.ts && pnpm run check-types && pnpm exec biome check src/webview/worktree src/worktree/registrySessionActivity.ts src/vault/readers/runningSessions.ts exit 0
  - **Deps**: 2_1
  - **Refs**: specs/worktree-panel/spec.md#{strongest-state-wins-and-shape-carries-it, completed-and-idle-are-visually-distinct, continuous-rotation-identifies-confirmed-execution-only, attention-has-its-own-shape}; design.md#{d3-attention-outranks-execution-evidence-gaps-outrank-history, d4-borrow-orca-s-semantics-retain-anywhere-s-shape-discipline, d5-no-new-runtime-vocabulary-without-evidence}
  - **Acceptance**:
    - Outcome: Running, waiting, done, and idle render as distinct glyphs.
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeView.test.ts src/webview/worktree/worktreeFormat.test.ts
  - **Plan**:
    1. Add trusted waiting and done SVGs in `src/webview/worktree/worktreeIcons.ts`, and render them through `stateShape` in `src/webview/worktree/worktreeTreeView.ts` with updated labels.
    2. Update `src/webview/worktree/worktreePanel.css` and `src/webview/worktree/worktreeFixtures.ts` for the hybrid shapes, theme tokens, motion, and reduced-motion behavior.
    3. Extend `src/webview/worktree/WorktreeView.test.ts` to prove every shape, colour-independent distinction, summary state, animation restriction, and agent-neutral rendering.
    4. Reconcile the vocabulary, precedence, external status, and completion rules in `docs/DESIGN.md`, `docs/design/worktree-panel-ui.md`, and `docs/design/worktree-agent-presence.md`; keep the lifecycle parser edit in `src/vault/readers/runningSessions.ts` formatter-clean for the final gate.
