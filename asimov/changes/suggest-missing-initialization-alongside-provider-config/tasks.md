## 1. Compose missing suggestions

- [ ] 1_1 Make the detector supplement a base model without duplicates
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#missing-initialization-material-is-suggested-without-overriding-configuration; design.md D1, D2
  - **Acceptance**:
    - Outcome: a base model gains only nonduplicate, noncontending unchecked suggestions
    - Verify: command VITEST_MAX_THREADS=6 pnpm exec vitest run src/worktree/provisioning/suggestProvisioning.test.ts
  - **Plan**:
    1. In src/worktree/provisioning/suggestProvisioning.ts accept an optional base model, suppress candidates per design.md D2, preserve every base field, and return unreadable bases unchanged.
    2. In src/worktree/provisioning/suggestProvisioning.test.ts add base-model cases for configured, excluded, fold-contending and exact-setup candidates; rerun the secret-boundary dependency spy against a base.

## 2. Supplement every provider read

- [ ] 2_1 Compose suggestions after each successful provider answer
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#{missing-initialization-material-is-suggested-without-overriding-configuration, saved-configuration-suppresses-only-the-suggestions-it-now-expresses}; design.md D3
  - **Acceptance**:
    - Outcome: every readable provider offer includes only its own missing unchecked suggestions
    - Verify: command VITEST_MAX_THREADS=6 pnpm exec vitest run src/worktree/provisioning/readProvisioning.test.ts src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. In src/worktree/provisioning/readProvisioning.ts pass the finished framework or native model through `suggestProvisioning`; leave the absent-provider fallback and unreadable suppression intact.
    2. In src/worktree/provisioning/readProvisioning.test.ts cover readable sources with and without rows, duplicate suppression, source switching, a saved native copy plus a recurring setup suggestion, and the shared row cap.
    3. In src/providers/WorktreeHost.actions.test.ts assert a provider offer can show configured rows plus unchecked environment-file and setup suggestions and save only positive file consent.
