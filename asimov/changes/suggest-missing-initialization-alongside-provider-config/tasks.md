## 1. Compose missing suggestions

- [x] 1_1 Make the detector supplement a base model without duplicates — verified: VITEST_MAX_THREADS=6 pnpm exec vitest run src/worktree/provisioning/suggestProvisioning.test.ts && pnpm run check-types && VITEST_MAX_THREADS=6 pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#missing-initialization-material-is-suggested-without-overriding-configuration; design.md D1, D2
  - **Acceptance**:
    - Outcome: a base model gains only nonduplicate, noncontending unchecked suggestions
    - Verify: command VITEST_MAX_THREADS=6 pnpm exec vitest run src/worktree/provisioning/suggestProvisioning.test.ts
  - **Plan**:
    1. In src/worktree/provisioning/suggestProvisioning.ts add required no-follow `readManifest`, accept an optional base model, synchronize the budget per design.md D3, mint disjoint candidate ids, suppress candidates per D2, and preserve every base field.
    2. In src/worktree/provisioning/provisioningDeps.ts supply a bounded no-follow manifest reader; update src/worktree/provisioning/provisioningDeps.test.ts and the shared fake in src/worktree/provisioning/readProvisioning.test.ts.
    3. In src/worktree/provisioning/suggestProvisioning.test.ts add a fully populated base fixture, cases covering configured rows, excluded rows, possible folds, id collisions, exact scripts, the cap and refunded merge capacity, and dependency spies proving manifest symlinks and candidate bytes are refused.

## 2. Supplement every provider read

- [x] 2_1 Compose suggestions after each successful provider answer — verified: VITEST_MAX_THREADS=6 pnpm exec vitest run src/worktree/provisioning/readProvisioning.test.ts src/providers/WorktreeHost.actions.test.ts && pnpm run check-types && VITEST_MAX_THREADS=6 pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#{missing-initialization-material-is-suggested-without-overriding-configuration, an-incomplete-provider-answer-is-not-supplemented, saved-configuration-suppresses-only-the-suggestions-it-now-expresses}; design.md D3
  - **Acceptance**:
    - Outcome: every readable provider offer includes only its own missing unchecked suggestions
    - Verify: command VITEST_MAX_THREADS=6 pnpm exec vitest run src/worktree/provisioning/readProvisioning.test.ts src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. Add required `AdapterRead.suggestible` in src/worktree/provisioning/providerKit.ts and set it per design.md D4 in src/worktree/provisioning/asimovProvider.ts, src/worktree/provisioning/nativeProvider.ts, src/worktree/provisioning/orcaProvider.ts and src/worktree/provisioning/vscodeTasksProvider.ts; update src/worktree/provisioning/providerKit.test.ts where the answer shape is asserted.
    2. In src/worktree/provisioning/readProvisioning.ts propagate completeness through native assembly and pass every complete finished model through `suggestProvisioning`.
    3. In src/worktree/provisioning/readProvisioning.test.ts cover complete answers with and without rows, malformed partial and unresolved-extends suppression, duplicate merge capacity, source switching and the cap branches.
    4. In src/providers/WorktreeHost.actions.test.ts and src/worktree/provisioning/writeNativeConfig.test.ts cover the non-native save followed by reread: selected file becomes configured, setup remains an unchecked suggestion, warning text preserved.
    5. In src/extension.worktreeAssembly.test.ts keep the late-offer integration witness isolated now that existing environment files can supplement complete provider answers.

## 3. Close review blockers

- [x] 3_1 Enforce the exact row ceiling and reject incomplete task members — verified: VITEST_MAX_THREADS=6 pnpm exec vitest run src/worktree/provisioning/suggestProvisioning.test.ts src/worktree/provisioning/vscodeTasksProvider.test.ts src/worktree/provisioning/readProvisioning.test.ts && pnpm run check-types && VITEST_MAX_THREADS=6 pnpm run test:unit exit 0
  - **Deps**: 2_1
  - **Refs**: specs/worktree-panel/spec.md#{missing-initialization-material-is-suggested-without-overriding-configuration, an-incomplete-provider-answer-is-not-supplemented}; design.md D3, D4
  - **Acceptance**:
    - Outcome: supplementation stays within reserved capacity and never follows malformed VS Code task material
    - Verify: command VITEST_MAX_THREADS=6 pnpm exec vitest run src/worktree/provisioning/suggestProvisioning.test.ts src/worktree/provisioning/vscodeTasksProvider.test.ts src/worktree/provisioning/readProvisioning.test.ts
  - **Plan**:
    1. In src/worktree/provisioning/suggestProvisioning.ts refuse an optional base already at the exact read ceiling; add its fresh-budget boundary witness in src/worktree/provisioning/suggestProvisioning.test.ts.
    2. In src/worktree/provisioning/vscodeTasksProvider.ts mark non-object task members and malformed `runOptions` incomplete without inventing setup; cover both shapes in src/worktree/provisioning/vscodeTasksProvider.test.ts and src/worktree/provisioning/readProvisioning.test.ts.
