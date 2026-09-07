# Workflow State: decompose-create-dialog

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [x] Review done _(user-initiated; `[-]` + reason if skipped)_
- [x] Gate: implementation approved
- [-] Blueprint sync complete — `Blueprint: none`; this refactor was raised directly from the goal, so there is no blueprint row to sync.

## Archive

- [x] Apply deltas: `bun run asm change apply`
- [x] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: full
Admission: in-contract — behaviour-preserving decomposition; no new invariant owner
Planned at: fe49091f
- Lane: full. Class: refactor. Gate 1 `[-]`: no real fork — the factory-per-module seam is the one three archived changes used.
- Gate 2 auto-taken under the standing fastlane grant in the user's goal; it records that authorization, not a plan the user read.
- Scope simplified on the user's challenge ("13 changes is too many"): one change per SUBSYSTEM, not per slice. This change takes the whole of WorktreeCreateDialog.ts in ten tasks. Remaining: B = WorktreeHost.ts + actions/create.ts + actions/provision.ts; C = WorktreeController.ts + WorktreeView.ts + worktreeView/actionNotices.ts; D = worktreeMutationService.ts.
- Plan attack refuted this change's FIRST shape and the design is the corrected one. Three things it caught: (1) the provisioning state was written up as a three-call-site cluster and is read at ~40 sites from `:1395` to `:3490` — I had grepped free names inside the range only, never the reverse direction, and had put the false claim in proposal.md; (2) OBL-2 as first written asserted that a new offer never carries the previous offer's ticks, which is the OPPOSITE of what `carryForward` (`:575-611`) exists to do and what `:3040-3078` already requires; (3) OBL-4's two-command form has a staged-edit hole. D1a now makes both-direction enumeration the first step of every capturing task.
- **CORRECTION (round-1 plan attack, change B).** The claim previously recorded here — that a single `git diff --exit-code <base> -- <path>` closes the staged-edit hole — is FALSE, and I have now re-run the experiment properly. Stage a weakened test, then restore the working tree from the base: the index holds the weakened file and `git diff --exit-code <base> -- <path>` exits **0**. Only `git diff --cached --exit-code <base> -- <path>` catches it. The right check is BOTH, `&&`-joined. This change's own answer is unaffected — both forms exit 0 on `WorktreeCreateDialog.test.ts` against `fe49091f`, re-verified — but the reason recorded was weaker than claimed, and changes B, C and D now carry the two-command form.
- Knowledge candidate: `checkedByOffer` is keyed by offer id alone (`:1840`) and no test in the 386-case suite reuses one offer id across two repositories | Surprise: a repo-less key collision is uncovered, found while auditing OBL-1's witness | Evidence: WorktreeCreateDialog.ts:1840, WorktreeCreateDialog.test.ts:3278-3324 | Consumer: plan | Action: a behaviour-preserving change may not touch it; raise as its own change after the decomposition series.
- Real-dependency: none — every task is a move within one webview module; no task crosses a network, filesystem or spawn boundary.
- OBL-2 correction, found at 1_2 by mutation rather than by reading: the ledger says the inherited suite asserts only the TICK half of `carryForward`, so the untick half needed a new witness. False. Planting `keptKeys.has(key) || row.checked` — which drops the untick half — turns `WorktreeCreateDialog.test.ts` red (385/386) as well as the new suite. The new case is a faster and more direct witness, not the only one, and the ledger over-claimed its necessity. design.md is frozen at Gate 2, so the row stands as written with this correction beside it; review should read the two together.
- D1a direction A must enumerate imported CONSTANTS, not only types and functions: task 1_3's range read `ICON_CLOSE` and `ICON_RENAME` from `../vault/icons`, both missed by an enumeration that looked for free identifiers used as calls or types. The type check caught them; the enumeration should have.
- Knowledge candidate: `grantedPath()`'s settled gate has no witness | Surprise: mutation-checking task 1_5's two new accessors, `asking()` kills 5 cases but dropping the whole `settledDisposition() === undefined ?` guard from `grantedPath` leaves all 386 green | Evidence: createDialog/recoverOffer.ts `grantedPath`, ex-WorktreeCreateDialog.ts:2262 | Consumer: plan | Action: pre-existing hole in the inherited suite, not opened by this move — the expression is unchanged; a behaviour-preserving change may not cover it, so raise it after the decomposition series. A grant still held while the box is unticked would leak its path into the destination line.
- D4's negation trap is witnessed by the inherited suite, checked rather than assumed at 1_6: passing `asks.outstanding` where `asks.outstanding()` is meant fails 82 of 386 cases, and the same slip on `asks.classifying` fails 84. The Boundary's other two conversions are thinner but real — `answersOurDefaults` always-true fails 1, `unasked` always-false fails 2.
- Task 1_7 needed a second module: `provisionState.ts` came to 544 lines, over this change's own goal, so the two ordinal tick records went to `createDialog/tickRecords.ts` (126) leaving the state at 465. Acceptance and Boundary are untouched — the suite is still `provisionState.test.ts` and drives the records through the composition, which is the stronger witness. Its three defeaters: a form-wide record instead of a per-repository one fails 3 of 8, reseeding from defaults instead of carrying fails 1, and a remove that does not splice the ordinal out fails 1.
- design.md D1's arithmetic does not close, found at 1_9 by measuring rather than at 1_10 by failing: the facade is 1541 and D1's only remaining module is `hostBindings` at ~336, which leaves 1205 against a Boundary of 500. The cause is an owner D1 never assigned — `syncDerived` is 381 lines, the whole render pass — plus per-module estimates made against the pre-cut file. Acceptance and Boundary are untouched and are what caught it, so this is a Plan/path change like `paths.ts` (1_5) and `tickRecords.ts` (1_7): task 1_9b adds `derivePass.ts` and 1_10 now depends on it.
- 1_9b probed rather than assumed, and the probe says the task as written is not buildable: extracting `syncDerived` plus the three after-* functions leaves 46 free names (measured by compiling the block in isolation and reading TS2304, not by eye). That is not a seam — it is the form's whole render reading everything, and a factory with 40 deps would move lines without moving a decision. Nor would it close the gap: 1541 - 331 = 1210, still over 500. Parked and handed back rather than forced.
- Handback at 1_9b: design.md D1's target structure has no owner for the render pass and its estimates predate the cuts. What the remaining 1541 lines actually are, measured: `syncDerived` 331, the field listeners and wiring ~250, the after-creating/agent/wait/advanced/actions construction ~170, the eight `deps.bind*` channels ~173, `submit` 49, `rebuildAfterOptions` 91, the rest small. A plan that reaches the Boundary has to name owners for the first three, and the render pass most likely splits by SUBJECT — the destination line, the button gates, the after-create reveals — rather than moving whole.
- 1_10 cut five modules, not the three the Plan sketched: `dialogDeps.ts` (the host contract, 161), `destinationField.ts` (190), `submission.ts` (199), `sections.ts` (267), and `explain`/`labelOf` into `formFields.ts`. `wiring.ts` was never needed — the Boundary was met at 474 without it, and the listeners left are four lines each that read as the form's own.
- 1_10 D1a correction, third instance: `stateDestination`'s free names included `bring` and `bringView`, both declared BELOW the pick button it moved with. Enumerating the block's names is not enough — a name declared later in the same closure compiles inside an arrow and fails as a direct reference. Moved the construction to just after `bringView` instead of thunking two more deps; the appends are unaffected because `pathField` only reaches the DOM inside the advanced disclosure below.
- 1_10 measurement (Plan step 3), every file under 500: facade 474 · derivePass 478 · provisionState 465 · resolutionAsks 403 · bringSummaries 395 · provisionView 384 · formFields 289 · branchChoices 287 · sections 267 · bringRowView 251 · recoverOffer 247 · branchList 246 · hostBindings 228 · draftModel 216 · submission 199 · destinationField 190 · dialogDeps 161 · bringContention 146 · tickRecords 126 · afterCreate 99 · paths 31.
- 1_10 OBL-5 (Plan step 4): the facade declares exactly one `let` — `repoSelect`, the element it builds itself. Every moved binding (`choice`, `forkHead`, `activeAt`, `listOpen`, `pathIsDerived`, `usingChosen`, `recoverGrant`, `recoverAsks`, `checkedByOffer`, `waitChoice`, `drawnMigrationOfferId`, `pickAsks`, `pickAsked`, `disposeDestTip`, `nameLeft`, `baseLeft`, `nameTyped`, `baseTyped`) returns zero declarations there.
- 1_10 mutation checks on the three new seams: `nameBlurred` no-op → 3 of 386 fail; the pick withdrawal in `stateDestination` removed → 3 fail; `waitChoice` ignored in favour of always-recommended → 2 fail. Each restored and re-run green.
- 1_10 `hostBindings.ts` now names `WorktreeCreateDialogDeps` instead of restating eight of its fields structurally — the second copy of that contract is gone with the type's move to `dialogDeps.ts`.
- Witnesses: OBL-1 pass [exit 0]; OBL-2 pass [exit 0]; OBL-3 pass [exit 0]; OBL-4 pass [exit 0]; OBL-5 pass [exit 0, grep returns 0 declarations].
- Round 1 (WARN, 0 blockers): F001 accepted and fixed — the cut split `pathField`'s two appends across `formFields.ts` and `destinationField.ts`, which run 133 lines apart, so the destination hint rendered ABOVE its input. `insertBefore(pathRow, fields.pathNote)` restores base's `[label, pathRow, pathNote]`, confirmed by runtime probe. The facade comment that asserted the broken invariant is rewritten. F002 accepted, F003 accepted in part, F004 rejected with justification — triage in `.reviews/round-1.md`.
- Round 1 re-verify: 8066 tests green, types clean, lint clean except the two pre-existing warnings. OBL-4 re-checked on BOTH diff forms, both exit 0.

