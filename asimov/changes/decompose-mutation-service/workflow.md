# Workflow State: decompose-mutation-service

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [ ] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [ ] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [ ] Review done _(user-initiated; `[-]` + reason if skipped)_
- [ ] Gate: implementation approved
- [-] Blueprint sync complete _(Blueprint: none)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: full
Admission: <new-owner|in-contract — owner or contract>
Planned at: 914dbb2b
Planned at: 914dbb2b
Lane: full. Class: refactor. Gate 1 `[-]`: no real fork — the factory-per-module seam is the one changes A and the three archived decompositions used.
Admission: in-contract — behaviour-preserving decomposition; no new invariant owner
- Plan attack (asm-oracle) returned OBL-2 supported/OBL-3 supported/OBL-5 supported, OBL-1 and OBL-4 unresolved, and refuted D1's `:999` provisioning boundary. All four corrections applied: the boundary moved to `:1048` with the eight severed identifiers named, OBL-1's semantics narrowed to what its witness establishes, OBL-2's witnesses replaced (the three first recorded were removal fingerprints, a different store), and OBL-4 given a runnable frozen inventory instead of "a per-task grep". OBL-6 added for the destructive create ordering, which the ledger had missed.
- OBL-1 mutation-verified rather than accepted from the oracle: deleting the disposing wrapper entirely fails 5 of 180. The oracle's `unresolved` was about a WIDER claim than the row's own defeater — the rejection path, which `try/finally` covers structurally and no test exercises.
- Knowledge candidate: the create's rejection path disposes provision material by `finally` alone, with no test | Surprise: a plan attack read the disposal as absent on rejection because every cited case fulfills; the `finally` at worktreeMutationService.ts:1071-1076 does cover it, but nothing would notice if a refactor turned it into a `.then()` | Evidence: src/worktree/worktreeMutationService.ts#createWorktree wrapper; applyProvision's rejection is swallowed at :919-924 | Consumer: plan | Action: after this series, add one case that rejects out of the coordinator body and asserts dispose was still called. OBL-3 forbids adding it here.
- serviceTypes.ts is 342 source lines plus ~45 of type imports, not the ~290 first estimated — still under 500, so no extra task.

- 4_3: `worktreeMutationService.ts` 253. Under `mutationService/`: outcomes 25, registerExisting.test 141, setupExecution.test 144, removal.test 212, setupExecution 276, createRun 320, removal 349, serviceTypes 388, registerExisting 413, createProvisioning 434.
- 4_3: OBL-3's both frozen-suite diffs pass (exit 0); OBL-4's frozen inventory prints nothing; OBL-5 reports 1 declared carve-out across 77 scoped modules, unchanged.
- 4_3: `issueDebrisAuthorization` moved with create/debris redemption into `createRun.ts`; that leaves the resolved `DebrisAuthorizationStore` one owner and makes the OBL-4 inventory honest rather than hiding it behind an alias in the root.
- Witnesses: OBL-1 pass [exit 0]; OBL-2 pass [exit 0]; OBL-3 pass [exit 0]; OBL-4 pass [exit 0]; OBL-5 pass [exit 0, 1 carve-out]; OBL-6 pass [exit 0].
