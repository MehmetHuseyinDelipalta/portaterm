# Workflow State: decompose-worktree-mutation-service

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [ ] All tasks done (`tasks.md`)
- [ ] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [ ] Review done _(user-initiated; `[-]` + reason if skipped)_
- [ ] Gate: implementation approved
- [ ] Blueprint sync complete _(`[-]` + reason only when `Blueprint: none`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: full
Admission: <new-owner|in-contract — owner or contract>
Planned at: ef96ea01
- Mode: fastlane, under the user's standing goal. No git worktree; build on `main`. Class: refactor. Target `src/worktree/worktreeMutationService.ts` (1852), the last of the five files.
- Admission: in-contract — behaviour-preserving decomposition, no new invariant owner. Specs are NO-DELTA.
- Change base for OBL-4: `ef96ea01`. Written literally into every task's closing step; a form re-deriving it from `HEAD` compares `HEAD..HEAD` and passes on a committed protocol edit, which is what the plan attack refuted.
- Baseline at `ef96ea01`: suite 8017 / 319 files; `gate:fs-deletion` 70 scoped modules.
- Real-dependency: none — the module is exercised through `worktreeMutationService.test.ts` (159 cases) with `deps` doubles, and the real-git behaviour it wraps is already covered by `worktreeMutations.integration.test.ts` and `adoptWorktree.integration.test.ts`, neither of which this change touches.
- Plan attack: the oracle refuted or unresolved three of four ledger rows and found three task steps unexecutable. I verified every load-bearing claim myself before accepting — `setupRetries` really is written from `:733`, `:1730` and `:1739` outside `retrySetup`; `fingerprints` really has 5 of its 9 reads inside `removeWorktree`; `reconcileFingerprints` really walks both stores; the file really is 1852 lines. All accepted. The design changed as a result: `removeWorktree` moves (its exclusion was refuted), `reconcileFingerprints` splits into a `forgetAbsent` per module, `setupExecution` gains a publishing member so create-proper can mint through the map's owner, and the vacuous OBL-4 command is replaced by the literal base sha. Ledger now reads 4 supported.
- Gate 2 auto-taken under the standing fastlane grant in the user's own message; it records that authorization, not a plan the user read.
- I10 count after 1_3: `[I10] ok — 74 scoped modules scanned` (pre-change 70). Four production modules, not the three the ledger first wrote: `outcomes.ts` was added under 1_2 because removal.ts is imported BY the facade, so importing `settled`/`paths` back would be a runtime cycle. OBL-3's claim is unchanged — the gate reads every new module; only the derived count moved, and tasks.md/design.md now carry 74.
- `asm refactor shape` after 1_3, recorded and NOT chased (design.md Risk Map): facade 1852 → 1135 lines, still `long-function` (`createWorktreeMutationService` 647 lines, 57%); setupExecution.ts 276 → `god-class` 61%; removal.ts 346 → `long-function` 70%; registerExisting.ts 414 → `long-function` 52%; outcomes.ts 26 → `unremarkable`. These are PERCENTAGE heuristics: a factory-per-module file is one big closure by construction, so it fires them at any size. Third change in a row to record this rather than chase it.
