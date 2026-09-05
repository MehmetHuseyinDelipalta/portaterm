## 1. Hold one exact regular source object

- [x] 1_1 Add lifecycle slots for bounded held-file admission and copy — verified: VITEST_MAX_THREADS=6 pnpm exec vitest run src/utils/heldRegularFile.test.ts && pnpm run check-types && VITEST_MAX_THREADS=6 pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: design.md D1, D5
  - **Acceptance**:
    - Outcome: pending held-file admission and copy consume at most 64 lifecycle slots
    - Verify: command VITEST_MAX_THREADS=6 pnpm exec vitest run src/utils/heldRegularFile.test.ts
  - **Plan**:
    1. In src/utils/heldRegularFile.ts build a 64-slot pool whose reservation precedes admission operations, fail closed without `O_NOFOLLOW`, abandon timed-out holds safely, transfer once to an auto-closing stream, and release only after actual lifecycle teardown.
    2. In src/utils/heldRegularFile.test.ts cover concurrent reservation ceiling, unsupported constants, timed-out and never-settling admission, late holder disposal, claim and source races, replacement, unlink, in-place edits, stalled pipeline teardown, charged-slot retention, and pool disposal.

## 2. Preserve private provenance through offer reminting

- [x] 2_1 Add additive held-file sidecars and material redemption — verified: VITEST_MAX_THREADS=6 pnpm exec vitest run src/worktree/provisioning/offerStore.test.ts src/worktree/provisioning/provisionMaterial.test.ts src/worktree/provisioning/readOnly.test.ts && pnpm run check-types && VITEST_MAX_THREADS=6 pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: design.md D2, D3
  - **Acceptance**:
    - Outcome: scoped redemption maps reminted ids to private holders outside model lookup
    - Verify: command VITEST_MAX_THREADS=6 pnpm exec vitest run src/worktree/provisioning/offerStore.test.ts src/worktree/provisioning/provisionMaterial.test.ts src/worktree/provisioning/readOnly.test.ts
  - **Plan**:
    1. In src/worktree/provisioning/provisionMaterial.ts define required model and held-file arms, entry projection, transactional selected-holder claims with rollback, and idempotent claim disposal; add src/worktree/provisioning/provisionMaterial.test.ts.
    2. In src/worktree/provisioning/offerStore.ts accept an exact-entry-object sidecar, translate it during remint, add scoped internal `redeem`, and retain model-only `lookup`; update src/worktree/provisioning/offerStore.test.ts for duplicate provisional ids, marker-like fields, stale offers, and sidecar-free serialization.
    3. In src/worktree/provisioning/readOnly.test.ts register the new production material module in the closed inventory.

## 3. Copy held material through a strict lower API

- [x] 3_1 Add source-first cancellable streams while preserving model compatibility — verified: VITEST_MAX_THREADS=6 pnpm exec vitest run src/worktree/provisioning/applyEntries.test.ts src/worktree/provisioning/applyEntries.node.test.ts src/worktree/provisioning/applyProvisioning.test.ts && pnpm run check-types && VITEST_MAX_THREADS=6 pnpm run test:unit exit 0
  - **Deps**: 2_1
  - **Refs**: design.md D3, D4
  - **Acceptance**:
    - Outcome: strict held material pins its source reader before any destination effect
    - Verify: command VITEST_MAX_THREADS=6 pnpm exec vitest run src/worktree/provisioning/applyEntries.test.ts src/worktree/provisioning/applyEntries.node.test.ts src/worktree/provisioning/applyProvisioning.test.ts
  - **Plan**:
    1. In src/worktree/provisioning/applyEntries.ts and src/worktree/provisioning/applyEntries.fake.ts add required `copyHeldFile` with a deadline-raced cancellable pipeline and route internal `ProvisionMaterial` while leaving ordinary `copyFileNoFollow` unchanged.
    2. In src/worktree/provisioning/applyEntries.test.ts and src/worktree/provisioning/applyEntries.node.test.ts trace synchronous source acquisition before parent and output, including parent refusal and throw cleanup, timeout with stalled pipeline, root loss, budget, contest, partial transfer, replacement, unlink, rewrite, aliases, and unsupported no-follow cases.
    3. In src/worktree/provisioning/applyProvisioning.ts add strict `applyProvisionMaterials`, retain entry-only `applyProvisioning` as a model wrapper, preserve reference and order semantics, and close claims in `finally`; update src/worktree/provisioning/applyProvisioning.test.ts.

## 4. Switch production create to strict material

- [x] 4_1 Switch model provisioning to the strict material path in one green wave — verified: VITEST_MAX_THREADS=6 pnpm exec vitest run src/worktree/worktreeMutationService.test.ts src/providers/WorktreeHost.actions.test.ts src/extension.worktreeAssembly.test.ts && pnpm run check-types && VITEST_MAX_THREADS=6 pnpm run test:unit exit 0
  - **Deps**: 3_1
  - **Refs**: design.md D3, D5
  - **Acceptance**:
    - Outcome: production model provisioning retains its outcomes through the strict material path
    - Verify: command VITEST_MAX_THREADS=6 pnpm exec vitest run src/worktree/worktreeMutationService.test.ts src/providers/WorktreeHost.actions.test.ts src/extension.worktreeAssembly.test.ts
  - **Plan**:
    1. In src/providers/WorktreeHost.ts wrap every current selected offer entry as model material after existing model lookup; update src/providers/WorktreeHost.actions.test.ts to prove marker-like fields remain model provenance.
    2. In src/worktree/worktreeMutationService.ts change create and apply requests to `ProvisionMaterial`, project entries only for existing reports and manifests, await queue completion before cleanup, and update src/worktree/worktreeMutationService.test.ts.
    3. In src/extension.ts route production materials to `applyProvisionMaterials`; update src/extension.worktreeAssembly.test.ts for strict model provenance and unchanged wire messages. Positive held redemption remains exclusively in the dependent picker change.

## 5. Retain failed teardown and exact byte accounting

- [x] 5_1 Close review findings at held source, destination teardown, and pre-copy budget boundaries — verified: VITEST_MAX_THREADS=6 pnpm exec vitest run src/utils/heldRegularFile.test.ts src/worktree/provisioning/applyEntries.test.ts src/worktree/provisioning/applyEntries.node.test.ts src/worktree/provisioning/applyProvisioning.test.ts && pnpm run check-types && VITEST_MAX_THREADS=6 pnpm run test:unit exit 0
  - **Deps**: 1_1, 3_1, 4_1
  - **Refs**: design.md D1, D4; .reviews/round-1.md#{f001-a-read-stream-close-failure-still-releases-its-lifecycle-slot, f002-a-parent-refusal-spends-held-bytes-that-were-never-written, f003-a-rejected-destination-close-hides-the-real-error-until-the-deadline, f004-the-already-aborted-race-can-leave-its-actual-rejection-unobserved}; .reviews/round-2.md#f001-stream-owned-close-failure-can-still-release-the-lifecycle-slot
  - **Acceptance**:
    - Outcome: held-copy teardown and byte accounting remain exact on every failure
    - Verify: command VITEST_MAX_THREADS=6 pnpm exec vitest run src/utils/heldRegularFile.test.ts src/worktree/provisioning/applyEntries.test.ts src/worktree/provisioning/applyEntries.node.test.ts src/worktree/provisioning/applyProvisioning.test.ts
  - **Plan**:
    1. In src/utils/heldRegularFile.ts observe actual FileHandle close-promise fulfillment for stream-owned descriptors and keep ambiguous or rejected source closure charged; add a source witness where public fd bookkeeping reaches -1 before close rejection in src/utils/heldRegularFile.test.ts.
    2. In src/worktree/provisioning/applyEntries.ts reconcile held-byte precharge before copy, observe an already-started operation before an already-aborted race returns, split caller error settlement from lifecycle retention, and require actual destination close-promise fulfillment after stream ownership transfers.
    3. In src/worktree/provisioning/applyEntries.test.ts, src/worktree/provisioning/applyEntries.node.test.ts, and src/worktree/provisioning/applyProvisioning.test.ts cover each pre-copy early exit followed by fitting material, rejected pre-stream and post-transfer destination closure retaining lifecycle while preserving the operation error, and already-aborted copy without unhandled rejection.
