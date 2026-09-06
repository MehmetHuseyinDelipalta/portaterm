# Workflow State: decompose-worktree-webview

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [ ] Gate 1: direction approved _(only if a real fork; else `[-]`)_
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
