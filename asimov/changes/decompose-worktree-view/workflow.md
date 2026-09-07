# Workflow State: decompose-worktree-view

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [ ] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [ ] `asm change validate` passes
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
- Deviation (task 3_5): `createFlow.ts` came to 585 lines with the openers and the answers together, over the Boundary before a single trim. Split in the same task: `createAnswers.ts` takes the deps, the state, the nine handlers, `createRepos` and `openPendingCreate`; `createFlow.ts` keeps the three doors and the factory. One direction only — `createFlow` imports `createAnswers`, never the reverse — so `handleCreateDefaults` can call `openPendingCreate` without a cycle.
- Deviation (task 3_5): design.md D1 says "the four answer caches at :302-337" and that block holds SIX. D5 pins three of them (`createDefaults`, `provisionOffers`, `repoRefs`) as controller fields, so the three that moved are `migrationOffers`, `repoPullRequests` and `createResolutions`. The pins bind; the count in the prose did not.
- Auto-decision (task 3_5): `asm refactor shape` reports `giant-literal` on `createFlow.ts` at 30% — the factory's own returned object, 23 one-line delegations and nothing else. A composition root's wiring has nothing to extract into; not split further.

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: full
Admission: <new-owner|in-contract — owner or contract>
Planned at: 914dbb2b
Planned at: 914dbb2b
Lane: full. Class: refactor. Gate 1 `[-]`: no real fork — the collaborator-per-responsibility seam is the `god-class` remedy, and change A already used it here on `foldState.ts`, `keyboardNav.ts` and `dialogChannels.ts`.
Admission: in-contract — behaviour-preserving decomposition; no new invariant owner
- Plan attack (asm-oracle) refuted D5 and the `3_11` boundary; both re-verified by hand and both corrected.
- D5 claimed three private reach-ins and there are **sixteen**. `WorktreeController.test.ts` reaches `createDialogDeps()` 39 times and reads six distinct private controller fields (`dialogChannels`, `view`, `provisionOffers`, `repoRefs`, `createDefaults`, `actionResults`). The rule this yields, now in D5: **the object graph is the contract** — a type may move, the field it hangs on may not.
- `3_11` was estimated ~480 and is **560** source lines, over the Boundary before a single import. Split at plan time rather than left as an in-task contingency: `worktreeRow.ts` (`3_13`) takes the 197-line row builder at `:1288-1485`.
- `3_5` was too narrow: the create's four answer caches at `:302-337` come with it, and its two outside writers (visibility at `:805-815`, reconciliation at `:1732-1748`) are now named in the task so the build is told rather than discovering them.
- De-serialized on the plan attack's reading: the three targets are three independent files, so `3_1..3_6` (controller), `3_7..3_11, 3_13` (view) and `3_12` (notices) are three chains, not one.
- OBL-1's witness range corrected to `:2250-2272` — the first draft cited only the empty-listing half and missed the dispose half at `:2269-2272`.
- 3_15: `WorktreeController.ts` 416. Under `controller/`: controllerTypes 63, dialogChannels 110, menuActions 131, visibility 135, composeCollaborators 168, composeCreateDialogDeps 215, composeViewDeps 221, createFlow 245, treeReconcile 316, agentActions 378, mutationResults 405, createAnswers 414.
- 3_15: an orphaned doc-comment head left by the 3_6 cut (the `departed` field's) had swallowed `repoFor`'s own doc comment; removed with the wiring cut.
