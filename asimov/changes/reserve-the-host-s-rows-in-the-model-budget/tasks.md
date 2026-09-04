# Tasks: reserve the host's rows in the model budget

## 1. The reservation

- [ ] 1_1 Reserve the host's slots in the read budget
  - **Deps**: none
  - **Refs**: design.md D1
  - **Acceptance**:
    - Outcome: a read that hits the cap leaves the host's slots free under the row bound
    - Verify: unit src/worktree/provisioning/providerKit.test.ts
  - **Plan**:
    1. In src/worktree/provisioning/providerKit.ts export `HOST_COMPOSED_ROWS` and `MAX_READ_ROWS` per design.md D1 and compare `full()` against `MAX_READ_ROWS`.
    2. In src/worktree/provisioning/providerKit.test.ts assert `rowsOf(modelFromDraft(draft)) + HOST_COMPOSED_ROWS <= MAX_MODEL_ROWS` for a draft filled past the cap, and that its cap problem is still recorded.
    3. Move the exact-count assertions in src/worktree/provisioning/nativeProvider.test.ts, src/worktree/provisioning/orcaProvider.test.ts, src/worktree/provisioning/asimovProvider.test.ts, src/worktree/provisioning/vscodeTasksProvider.test.ts and src/worktree/provisioning/readProvisioning.test.ts onto the constant each one is really asserting.

## 2. The witness at the seam

- [ ] 2_1 Witness a capped read carrying every row the host composes
  - **Deps**: 1_1
  - **Refs**: design.md D1, D2
  - **Acceptance**:
    - Outcome: a capped read plus every host-composed row publishes inside the row bound
    - Verify: unit src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. In src/providers/WorktreeHost.actions.test.ts add a test whose read returns a model at the cap with its own "are not offered" problem, whose write answers `{ ok: false, reason: "unwritable", mayStillBeLocked: true }`, and which then saves: assert `rowsOf` of the published offer is at most `MAX_MODEL_ROWS`, and that the refusal, the lock report and the reader's statement are all present.
    2. Add the single-report case (`{ ok: true, wrote: true, mayStillBeLocked: true }`) against the same capped read.
    3. Remove the inert `wt-bring-box--only-add` toggle in src/webview/worktree/WorktreeCreateDialog.ts (round 3 F008) and its `bringBox.classList.toggle` call.
