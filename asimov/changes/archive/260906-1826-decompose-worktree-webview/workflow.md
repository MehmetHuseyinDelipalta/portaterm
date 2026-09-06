# Workflow State: decompose-worktree-webview

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
- [-] Blueprint sync complete — reason: `Blueprint: none`, so there is no PLAN.md task whose status this change could move.

## Archive

- [x] Apply deltas: `bun run asm change apply`
- [x] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: full
Admission: <new-owner|in-contract — owner or contract>
Planned at: a4b4adf77852a7da4a900c47f5624b950b30f5e0
- Mode: fastlane (user goal: plan -> oracle attack -> triage/fix -> build -> review max 3 rounds -> archive). No git worktree; build on `main`.
- Class: refactor. Targets `src/webview/worktree/WorktreeView.ts` (2321) and `src/webview/worktree/WorktreeCreateDialog.ts` (3873). Baseline at `15571982`: suite 7963 / 314 files.
- `asm refactor shape` reads the two DIFFERENTLY, and the cuts follow that rather than the line counts: `WorktreeView.ts` is `god-class` (79% of the file in one class, 90 members, 76 private) whose remedy is extract-collaborators-keep-a-facade; `WorktreeCreateDialog.ts` is `long-function` on a 2802-line closure factory, which is the SAME percentage artifact the previous change recorded — a closure-factory module fires it at any size. So the dialog is not cut by moving DOM code out; its cut is the headless form model (`draft` / `choice` / `pending*`) the closure keeps in scope.
- Inherited from `decompose-worktree-host-controller` round-1 F002 (audit-backlog): `provisionBaseline` is written in `providers/worktreeHost/actions/create.ts` and read in `actions/provision.ts`. Its owner is the follow-up split of `create.ts` on the read/commit seam, which is a THIRD change, not this one — recorded here only so the trigger is not lost.
- Still outstanding on the user's goal after this change: the `create.ts` read/commit split, and `src/worktree/worktreeMutationService.ts` (1852).
- Change base for OBL-5: `a4b4adf77852a7da4a900c47f5624b950b30f5e0` — the parent of this change's first code commit. The tree-only `git diff --exit-code` cannot see a committed protocol edit, which is why every task's closing step diffs against this sha as well.
- Plan attack: oracle refuted OBL-1 and OBL-4 as first written and found OBL-3's and OBL-5's witnesses vacuous. I verified every load-bearing claim myself before accepting: `pruneStaleState` does REPLACE both sets (`WorktreeView.ts:930,948`), does clear `selectedWorktreeId` and call `deps.onSelectWorktree` (`:917-923`) and `rosters.reconcile` (`:954`); `uncapped` has no toggle in the cluster (`:1178,1373`); the jsdom pragma is per file (line 1 of both existing suites). All four remedies applied — see design.md § What the attack changed in the plan. Ledger now reads 5 supported.
- Gate 2 auto-taken under the fastlane grant in the user's own message; it records that authorization, not a plan the user read.
- 1_1: `idleTailKey` moved to `foldState.ts` with the sets it keys into; `WorktreeView` no longer needs it. OBL-1's witness run as a mutation — giving the facade back a private `collapsed` copy for its two render reads turns 2 of `WorktreeView.test.ts`'s 243 red, so the existing suite really is an independent oracle for sole ownership. WorktreeView.ts 2321 -> 2260.
- 1_2: the `focusin` delegate and `setRowTabStop`/`NAV_ROWS` moved with the nine methods, per the oracle's finding that leaving them behind splits ownership of roving focus. `focusedKey` became an accessor pair on the collaborator. OBL-2's witness run as a mutation — memoising `navRows()` at first call turns 2 of 6 red. WorktreeView.ts 2260 -> 2047.
- 1_3: `infoFor` moved after all — `placeResults` is its only caller. Seven module-level notice helpers (`resultKey`, `setupSummary`, `portSummary`, `provisionSummary`, `branchDeleteLine`, `branchDeleteReason`, `AUTO_DISMISS_MS`) had no use outside the cluster and went with it; `resultKey` is exported because the render signature still calls it. `dispose`'s inline timer clearing became `notices.dispose()`, per the oracle's finding. OBL-3's witness run as a mutation — dropping the `clearTimeout` from `pruneAutoDismiss` turns 1 of 4 red, while an 'assert nothing ran' test would have stayed green. WorktreeView.ts 2047 -> 1489.
- 2_1: `AfterChoice` moved with the answer it names; `pickAsks`/`pickAsked` stayed, per the plan. The initial `draft.openAfter` is now the derivation rule at t=0 rather than a copy of the choice — `"folder"` is not a wire value, and the original only type-checked because no caller ever passed it. OBL-4's witness run as a mutation — planting `document.activeElement` in `statePath` throws `ReferenceError` under node, so the missing pragma really is what proves the module headless. WorktreeCreateDialog.ts 3873 -> 3812.
- 2_2: the ordering functions (`orderChoices`, `pullRequestChoices`, `partialListText`, `CREATE_ROW_LABEL`, `choiceMode`, `branchOfPullRequest`) were already module-level and moved as-is; the state (`choice`, `choices`, `forkHead`) was not. `commit` now RETURNS what taking a row decides — ignored / refused / taken plus the fields to state — so the refusal message and the pull-request name are decided headlessly and the DOM only applies them. `activeAt`/`listOpen` stayed. Four mutations run against `branchChoices.test.ts`: reordering the list, dropping the fork head's repository condition, dropping its detached condition, and planting a DOM read in `commit` — 1, 1, 1 and 11 of 23 red respectively. WorktreeCreateDialog.ts 3812 -> 3665.
- `asm refactor shape` after 2_2, recorded rather than chased (design.md Risk Map): `WorktreeCreateDialog.ts` still `long-function` (the closure is 73% of statements, bar 25%) and `WorktreeView.ts` still `god-class` (86%, bar 60%) — both percentage heuristics a facade or closure-factory module cannot clear at any size. `branchChoices.ts` reads `unremarkable`; `draftModel.ts` reads `giant-literal` at 53% because the factory's returned object IS the module. No structural remedy is taken from any of the four.
- Witnesses: OBL-1 pass [exit 0]; OBL-2 pass [exit 0]; OBL-3 pass [exit 0]; OBL-4 pass [exit 0]; OBL-5 pass [exit 0]. No `docs/DESIGN.md § Cross-Cutting Invariants` row's Owner section is cited by any task Ref and none shares state with a changed path, so the touched set is the ledger alone.
- Real-dependency: none — the change is webview-local and moves no I/O; every seam it cuts is already exercised by the jsdom suites it left in place.
- Verify Gate on `cc73fc3f` + the branchChoices format fix: `pnpm run check-types` 0, `pnpm exec biome check src` 0 (check mode, never `--write`), `pnpm run test:unit` 8017/319 passed, `pnpm run gate:fs-deletion` ok, `pnpm run build:check-requires` ok. Suite grew 7963/314 -> 8017/319 (+54 across five new files).
- Correction to 3_1's stored `--test-change`: it says "assertion count is unchanged or higher"; `verify-task` measured **-1**, and the tool is right. The -1 is the `usingChosen()` assertion dropped from `draftModel.test.ts` — redundant where it stood, because the `destinationCandidate()` line immediately above asserts the object equals `{ candidatePath }` and an absent `useChosenFolder` key is exactly what `usingChosen()` false means, so the dropped line could not fail while the kept one passed. The other two edits are net 0 (an assertion retargeted onto the production seam) and strictly stronger (OBL-3 naming the survivor). The record could not be re-recorded — `verify-task` refuses a task that is already done — so the correction lives here.
- Round-1 triage: F001 accepted in full (three members with no production consumer dropped, two assertions retargeted onto the seam production reads); F002 `audit-backlog` (carried across unchanged, `Witness: none`, owner = the follow-up `WorktreeView` render split); F003 accepted as a PRECISION improvement with its stated defeater refuted — I ran the exact mutation it names (`!live.has(key)` -> `live.has(key)` at `actionNotices.ts:148`) and the OBL-3 test goes red as it stood, because the inverted prune deletes the surviving entry and the same `placeResults` re-arms it, so `armedKeys()` is 2 and not 1. F004-F006 were rejected by the chair itself. 0 BLOCK, 0 WARN, nothing rebutted, so the cycle ends at Re-Verify with no round 2.
- Re-verify caught two things the first gate did not. (1) Lint went to exit 1 on MY round-1 edits — JSDoc continuation lines at four spaces where biome formats three, in `keyboardNav.ts` and `branchChoices.ts`. Fixed; `pnpm exec biome check src` back to exit 0. (2) One full-suite run reported `1 failed | 8016 passed` and I did not capture which test — the grep filtering that run's output dropped the FAIL line, and the identity is not recoverable from the stored output. Two subsequent full runs on the same tree are `8017 passed / 319 files`, and the only edit between them is comment indentation, which cannot reach a test. So the failure is UNIDENTIFIED rather than diagnosed: it did not reproduce, and I am not claiming it was pre-existing or unrelated, because I never saw its name.
- Implementation approval taken under the same standing fastlane grant as Gate 2 — the user's own message named `review (max 3 round) -> archive` as the sequence. It records that authorization, not a review the user read.
