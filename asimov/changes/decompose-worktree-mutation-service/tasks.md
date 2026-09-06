# Tasks: decompose-worktree-mutation-service

## 1. Extractions

- [ ] 1_1 Extract setup execution and its retry authority
  - **Deps**: none
  - **Refs**: design.md D1, design.md D1b, design.md D3, design.md D4
  - **Boundary**: the map, its key and its id minting move as one unit — the facade keeps no reference to any of the three, and no caller outside the module mints a retry id
  - **Acceptance**:
    - Outcome: the retry authority lives outside the service closure.
    - Verify: command pnpm exec vitest run src/worktree/worktreeMutationService.test.ts src/worktree/mutationService/setupExecution.test.ts
  - **Plan**:
    1. Create `src/worktree/mutationService/setupExecution.ts` exporting `createSetupExecution(deps)` over `failedSetup`, `portEnvironment`, `executeSetup`, `writeManifest`, `retryKey`, `setupRetries`, `newSetupRetryId`, `SetupRetryRecord`, `PendingSetupRetry` and the `retrySetup` body, moving them out of `src/worktree/worktreeMutationService.ts`.
    2. Add the publishing member D3's Contract requires. It performs the delete at `src/worktree/worktreeMutationService.ts:1730` and the mint-and-insert at `:1739` as one call and returns the minted id, or `null` where the incarnation or normalized path no longer matches. Create-proper calls it and stays in the facade.
    3. Add `forgetAbsent(presentWorktreeIds)` over the setup half of `reconcileFingerprints` (`:731-735`) and have the facade's member call it (D1b). Leave the fingerprint half in place for 1_2.
    4. `executeSetup`, `writeManifest`, `failedSetup` and `portEnvironment` are also called by create-proper — expose them as members so there is one implementation, not two.
    5. Add `src/worktree/mutationService/setupExecution.test.ts` driving the authority directly: spend an id and assert the second spend is a no-op, and spend an authority issued for one repo against a DIFFERENT repo and assert refusal. The second case is OBL-1's scoping witness and the existing suite cannot see it.
    6. Do not edit `src/worktree/worktreeMutationService.test.ts`; it is the regression net and OBL-1's rotation witness.
    7. Close with `git diff --exit-code ef96ea01..HEAD -- src/types/messages.ts` and then `git diff --exit-code -- src/types/messages.ts` (OBL-4). The base sha is literal — a form that re-derives it from `HEAD` compares `HEAD..HEAD` and passes on a committed edit.

- [ ] 1_2 Extract removal, which owns the fingerprint store
  - **Deps**: 1_1
  - **Refs**: design.md D1, design.md D1a, design.md D1b, design.md D4
  - **Boundary**: the facade holds no reference to `fingerprints`; no `node:fs` deletion is introduced
  - **Acceptance**:
    - Outcome: every fingerprint read and write happens inside one module.
    - Verify: command pnpm exec vitest run src/worktree/worktreeMutationService.test.ts src/worktree/mutationService/removal.test.ts
  - **Plan**:
    1. Create `src/worktree/mutationService/removal.ts` exporting `createRemoval(deps)` over the `fingerprints` store, `assess`, `issueFingerprint`, `assessRemovalReport` and `removeWorktree`, moving them out of `src/worktree/worktreeMutationService.ts`. `removeWorktree` comes too: five of the nine store reads are inside it (D1a).
    2. Add `forgetAbsent(presentWorktreeIds)` over the fingerprint half of `reconcileFingerprints` (`:726-729`); the facade's member now calls this and 1_1's, and owns nothing itself.
    3. `settled` (`:710`) is pure and read by removal and by 1_3's reattach — lift it to module scope in the facade and import it, never copy it (D4).
    4. Add `src/worktree/mutationService/removal.test.ts` covering assess-without-performing and the fingerprint's target scoping.
    5. Do not edit `src/worktree/worktreeMutationService.test.ts`.
    6. Close with the OBL-4 pair from 1_1 step 7, base sha literal.

- [ ] 1_3 Extract registering a checkout already on disk
  - **Deps**: 1_2
  - **Refs**: design.md D1, design.md D2, design.md D4
  - **Boundary**: a carried debris clearance is refused BEFORE either branch corroborates anything — the guard does not move past the early return
  - **Acceptance**:
    - Outcome: adopt and reattach run outside the service closure.
    - Verify: command pnpm exec vitest run src/worktree/worktreeMutationService.test.ts src/worktree/adoptWorktree.test.ts src/worktree/mutationService/registerExisting.test.ts
  - **Plan**:
    1. Create `src/worktree/mutationService/registerExisting.ts` exporting `createRegisterExisting(deps)` with named `adopt` and `reattach` handlers, moving `src/worktree/worktreeMutationService.ts:1123-1231` and `:1241-1338` into it along with `recordFor`, `holdsStaleRegistration`, `liveHolderOf`, `adoptDeclineReason`, `declineReason` and `residueNote`.
    2. Both branches read three things declared outside them: `fail` (`:1099`), `openFailure` (`:1112`) and `settled` (`:710`). Pass `fail` in rather than rebuilding it; make `openFailure` an accessor pair and apply D4's negation rule at every site; import `settled` from where 1_2 lifted it.
    3. Add `src/worktree/mutationService/registerExisting.test.ts` asserting, for BOTH modes, that a debris disposition reports the refusal and that the corroboration dependency was never called. The call count is the assertion — a test on the reported message passes with the guard moved past `:1168` / `:1283`, which is OBL-2's defeater.
    4. Do not edit `src/worktree/worktreeMutationService.test.ts` or `src/worktree/adoptWorktree.test.ts`.
    5. Close with the OBL-4 pair from 1_1 step 7, base sha literal.

- [ ] 1_4 Confirm the destruction gate reads the new modules
  - **Deps**: 1_3
  - **Refs**: design.md § Obligation ledger
  - **Boundary**: `src/test/invariants/fsDeletionGate.ts` is not edited — the point is that the existing prefix rule already covers the new directory
  - **Acceptance**:
    - Outcome: the I10 scan reports 73 scoped modules, up from 70.
    - Verify: command pnpm run gate:fs-deletion
  - **Plan**:
    1. Run `pnpm run gate:fs-deletion` and record the printed count in workflow.md Notes beside the pre-change 70. Three production modules, not six — the gate excludes `.test.ts`. A count that did not rise means the new files are outside the scan and the gate is passing on modules it never read.
    2. Run `bun run asm refactor shape` on `src/worktree/worktreeMutationService.ts` and every module this change created; RECORD the output in workflow.md Notes rather than chasing it (design.md Risk Map).
