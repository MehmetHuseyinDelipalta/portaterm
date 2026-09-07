## 1. `worktreeMutationService.ts` — the types, then the two halves of the create

- [x] 4_1 Move what the service is asked for and answers with — verified: pnpm exec vitest run src/worktree/worktreeMutationService.test.ts src/worktree/mutationService/ src/extension.worktreeMutations.test.ts exit 0
  - **Deps**: none
  - **Refs**: design.md D1, design.md D1a, design.md D4
  - **Boundary**: `src/worktree/mutationService/serviceTypes.ts` is under 500 lines
  - **Acceptance**:
    - Outcome: the cut lands and the 218-case net is unchanged.
    - Verify: command pnpm exec vitest run src/worktree/worktreeMutationService.test.ts src/worktree/mutationService/ src/extension.worktreeMutations.test.ts
  - **Plan**:
    1. Enumerate free names in both directions (D1a): compile the block in isolation and read the `TS2304` list for direction A, then `grep -n` every identifier it declares across `src/worktree/worktreeMutationService.ts` for direction B.
    2. Create `src/worktree/mutationService/serviceTypes.ts` with the type declarations named in design.md D1 row 1, moving them out of `src/worktree/worktreeMutationService.ts`.
    3. Re-export every moved type from `src/worktree/worktreeMutationService.ts` so no importer changes (D4).
    4. Trim the imports the cut leaves unused in `src/worktree/worktreeMutationService.ts`.
    5. Run `bun run asm refactor shape src/worktree/worktreeMutationService.ts src/worktree/mutationService/serviceTypes.ts` and split again if it fires.

- [x] 4_2 Extract what a created worktree is then given — verified: pnpm exec vitest run src/worktree/worktreeMutationService.test.ts src/worktree/mutationService/ src/extension.worktreeMutations.test.ts exit 0
  - **Deps**: 4_1
  - **Refs**: design.md D1, design.md D1a, design.md D4
  - **Boundary**: `src/worktree/mutationService/createProvisioning.ts` is under 500 lines
  - **Acceptance**:
    - Outcome: the cut lands and the 218-case net is unchanged.
    - Verify: command pnpm exec vitest run src/worktree/worktreeMutationService.test.ts src/worktree/mutationService/ src/extension.worktreeMutations.test.ts
  - **Plan**:
    1. Enumerate free names in both directions (D1a), as in 4_1.
    2. Create `src/worktree/mutationService/createProvisioning.ts` with the exclusion writes, the ports and setup application, the launch, the manifest write and the retry staging (design.md D1 row 2 — the boundary is the source's `:1048`, NOT `:999`), moving them out of `src/worktree/worktreeMutationService.ts`; former `let` bindings become accessor functions and their negation sites are checked by hand (D4a).
    3. Keep `writtenExclusions` as ONE set inside the new module — a second set would write an exclusion twice.
    4. Trim the destructures and imports the cut leaves unused in `src/worktree/worktreeMutationService.ts`.
    5. Run `bun run asm refactor shape` on both files and split again if either fires.

- [x] 4_3 Extract the create's control flow — verified: pnpm exec vitest run src/worktree/worktreeMutationService.test.ts src/worktree/mutationService/ src/extension.worktreeMutations.test.ts exit 0
  - **Deps**: 4_2
  - **Refs**: design.md D1, design.md D1a, design.md D4, design.md § Obligation ledger
  - **Boundary**: `src/worktree/worktreeMutationService.ts` and every file under `src/worktree/mutationService/` is under 500 lines, and the create's destructive ordering is unchanged (OBL-6)
  - **Acceptance**:
    - Outcome: the cut lands and the 218-case net is unchanged.
    - Verify: command pnpm exec vitest run src/worktree/worktreeMutationService.test.ts src/worktree/mutationService/ src/extension.worktreeMutations.test.ts
  - **Plan**:
    1. Enumerate free names in both directions (D1a), as in 4_1.
    2. Create `src/worktree/mutationService/createRun.ts` with the `createWorktree` arm and the coordinator body it hands over (design.md D1 row 3), moving them out of `src/worktree/worktreeMutationService.ts`.
    3. Leave the `finally` that calls `disposeProvisionMaterials` in `src/worktree/worktreeMutationService.ts` — it is OBL-1's defeater. Pass the resolved `debrisAuthorizations` instance, never `deps.debrisAuthorizations` (OBL-2).
    4. Record `wc -l` for `src/worktree/worktreeMutationService.ts` and every file under `src/worktree/mutationService/` in workflow.md Notes. Any file at 500 or above is split before ticking, not deferred.
    5. Confirm OBL-4 by running design.md § Frozen inventory's command verbatim; it must print nothing. Then check the composition root's line count against the ~350 the same section names — a root still large after every cluster moved is holding something under another name.
    6. Run `pnpm run gate:fs-deletion` and record its carve-out count (OBL-5).

- [x] 4_4 Close round-1 rationale-preservation findings — verified: pnpm exec vitest run src/worktree/worktreeMutationService.test.ts src/worktree/mutationService/ src/extension.worktreeMutations.test.ts exit 0
  - **Deps**: 4_3
  - **Refs**: design.md D4, design.md § Obligation ledger
  - **Boundary**: No executable statement or ordering changes; restore only the moved destructive-path rationale and the unreachable throw text accepted from round 1.
  - **Acceptance**:
    - Outcome: F001 and F002 are closed, while the 218-case net and every destructive ordering remain unchanged.
    - Verify: command pnpm exec vitest run src/worktree/worktreeMutationService.test.ts src/worktree/mutationService/ src/extension.worktreeMutations.test.ts
  - **Plan**:
    1. Restore the base's phase-1, adopt/reattach, changed-path, current-emptiness, branch-name, unreadable-debris and `sourceOf` rationale beside the same guards in `src/worktree/mutationService/createRun.ts`.
    2. Restore `sourceOf`'s exact unreachable throw message.
