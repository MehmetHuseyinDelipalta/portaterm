# Design: decompose-mutation-service (refactor: src/worktree/worktreeMutationService.ts)

## Diagnosis

| | |
|---|---|
| Target | `src/worktree/worktreeMutationService.ts` |
| Lines at start | 1134 |
| Shape | `long-function` (`asm refactor shape`) |
| Because | `createWorktreeMutationService` is 647 lines = **57%** of the module's statements against a 25% bar; the module is also **28%** types, `MutationServiceDeps` alone being 189 lines |
| Direct tests | `worktreeMutationService.test.ts`, `mutationService/{removal,registerExisting,setupExecution}.test.ts`, `extension.worktreeMutations.test.ts` — **218 cases** |
| Why now | Change D of the user's standing goal, and the smallest of the four |

## Decisions

### D1: Target structure

**The types, the create's control flow, and the create's provisioning are three
subjects.** Everything else in the factory is a two-line delegation to a collaborator
that already exists (`setup`, `registerExisting`, `removal`, `coordinator`), and those
delegations plus the wiring are what a composition root legitimately keeps.

```
src/worktree/
  worktreeMutationService.ts        # composition root: deps in, collaborators wired, the small delegating methods
  mutationService/
    serviceTypes.ts                 # what the service is asked for and what it answers with
    createRun.ts                    # the create's control flow: two validation phases either side of the coordinator wait
    createProvisioning.ts           # what a created worktree is then given: exclusions, ports, setup steps, the launch
```

Left in `worktreeMutationService.ts` on purpose: the collaborator construction,
`withTarget`, `reconcileFingerprints`, `issueDebrisAuthorization`, `pruneRepo`, the
lock/unlock/remove/retry delegations, and the `finally` that disposes provision
materials. That last one is deliberate and is OBL-1.

| # | Cluster | Lines | LOC | Task |
|---|---|---|---|---|
| 1 | `serviceTypes.ts` — `MutationOutcome`, `MutationVerb`, `ResolvedTarget`, `RepairListingRecord`, `SetupExecutionInput`/`Outcome`, `MutationServiceDeps`, `RemovalReport`, `WorktreeMutationService` | 75-143, 169-432 | ~290 | `4_1` |
| 2 | `createProvisioning.ts` — `writtenExclusions`, `writeExclusion`, the ports/setup application and `launch` | 787-999 | ~215 | `4_2` |
| 3 | `createRun.ts` — the `createWorktree` arm and the coordinator body it hands over | 625-786, 1000-1058 | ~220 | `4_3` |

Deliberately not cut: `registerExisting.ts` (413), `removal.ts` (349),
`setupExecution.ts` (276), `outcomes.ts` (25) — already under 500 and outside the goal.

#### D1a: Both directions, every capturing task

A cluster's boundary is assumed WRONG until its free names have been enumerated in BOTH
directions:

- **A — what the block reads from outside it.** Every identifier the moved lines use and
  do not declare, INCLUDING imported constants and types. Compile the block in isolation
  and read the `TS2304` list; never do this by eye. A name declared LOWER in the same
  closure compiles inside an arrow and fails as a direct reference — check declaration
  order too.
- **B — what the rest reads from the block.** `grep -n '\bname\b'` across the source for
  every identifier the block declares.

Carried from change A, where skipping direction A's constants cost a task.

#### D4a: Accessor conversion and its negation trap

A former `let` becoming `x()` is flagged by TypeScript at `x ||` and `if (x)` (TS2774)
but **NOT** at `!x &&`. Every converted binding's negation sites are checked by hand.

### D2: Preservation proof

| | |
|---|---|
| Suite command | `pnpm exec vitest run src/worktree/worktreeMutationService.test.ts src/worktree/mutationService/ src/extension.worktreeMutations.test.ts` |
| Baseline | **218** tests green at `914dbb2b`, type-check clean |

Rules every task obeys:

- Baseline green after every task. A drop stops the task: revert, never adjust a test.
- Re-run `asm refactor shape` on the source AND every destination after each cut.
- Any module reaching 500 lines is split before the task is ticked, not deferred.
- `pnpm run gate:fs-deletion` must stay green and its carve-out count must not grow.

### D3: Expected test moves

**None.** Every suite imports `createWorktreeMutationService` from
`src/worktree/worktreeMutationService.ts` and drives it through its public surface. This
is OBL-3, and an edit to any of them stops the change.

### D4: Allowed non-pure transformations

- Every task: a `let` becoming an accessor function, and a block comment moving with the
  code it describes.
- Every task: an unused destructure or import left by a cut is trimmed in that task.
- `4_1`: every moved type is re-exported from `worktreeMutationService.ts`, so no
  importer changes.

Anything beyond this list is a design change.

## Obligation ledger

| id | claim | semantics | defeater | witness | disposition |
|---|---|---|---|---|---|
| OBL-1 | claimed provision material is disposed on every exit of a create | for any create — admitted, refused before the queue, or thrown out of the body — each `ProvisionMaterial` in the request has `dispose()` called exactly once | `createRun.ts` takes the whole of `createWorktree` including the wrapper, and the composition root's `finally` at `:1069-1078` is dropped as redundant — a create that throws inside the coordinator body then leaks every claimed material | `X: pnpm exec vitest run src/worktree/worktreeMutationService.test.ts` — `:2906-2925` asserts dispose is NOT called early and is called exactly once at the end; `:2928-2934` covers the refused-before-the-queue path; `:2941+` is a table over the failing cases | supported |
| OBL-2 | a debris authorization is redeemed against the ONE store the service issued from | `issue`, `redeem` and `forget` all reach the same `DebrisAuthorizationStore` instance | `createRun.ts` is handed `deps.debrisAuthorizations` instead of the resolved `debrisAuthorizations` at `:434` — where the dep is absent the factory's default store is created twice and every issued fingerprint is unredeemable | `X: pnpm exec vitest run src/worktree/worktreeMutationService.test.ts` — `:494-500` "carries the token that authorizes exactly the blockers it just returned", which the comment says exists because a token nothing can redeem is the failure; `:619`, `:676` drive mismatch and staleness through the same store | supported |
| OBL-3 | the inherited regression net is not weakened | the five suites are byte-identical to their state at `914dbb2b` | a case is relaxed to accommodate a moved body | `X: git diff --exit-code 914dbb2b -- src/worktree/worktreeMutationService.test.ts src/worktree/mutationService/removal.test.ts src/worktree/mutationService/registerExisting.test.ts src/worktree/mutationService/setupExecution.test.ts src/extension.worktreeMutations.test.ts` — ONE command, base against the working tree; the two-command form has a staged-edit hole verified by experiment in change A | supported |
| OBL-4 | the composition root holds no reference to moved state | after `4_3`, `worktreeMutationService.ts` declares no `let` or `const` a task moved | a binding is duplicated rather than moved, leaving two owners that drift — the concrete form OBL-2 names | `X: the D2 suite command` plus a per-task grep recorded in the task's evidence | supported |
| OBL-5 | the destructive-filesystem carve-out list does not grow | `pnpm run gate:fs-deletion` reports the same carve-out count before and after | a cut moves a `node:fs` removal into a module the gate does not scan, and the gate passes because it no longer sees it | `X: pnpm run gate:fs-deletion` — scans by module scope and prints the carve-out count; the count is recorded in the Verify Gate's Notes line, so a silent growth is visible | supported |

## Risk Map

| Risk | Mitigation |
|---|---|
| `createWorktree` spans a coordinator await; a split could reorder work | The coordinator call itself is not moved — only the body it is handed, and the split is along the closure's own stages |
| The `finally` that disposes materials looks redundant once the create moves | It is OBL-1's exact defeater, and OBL-1 has three witnessing cases rather than an assertion |
| A destructive `node:fs` path runs under this service | OBL-5, and the gate runs in the Verify Gate rather than only at the end |
