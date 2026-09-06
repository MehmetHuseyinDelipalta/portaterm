# Workflow State: decompose-worktree-webview

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [ ] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [ ] `asm change validate` passes
- [ ] Gate 2: plan approved

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
Planned at: 15571982
- Mode: fastlane (user goal: plan -> oracle attack -> triage/fix -> build -> review max 3 rounds -> archive). No git worktree; build on `main`.
- Class: refactor. Targets `src/webview/worktree/WorktreeView.ts` (2321) and `src/webview/worktree/WorktreeCreateDialog.ts` (3873). Baseline at `15571982`: suite 7963 / 314 files.
- `asm refactor shape` reads the two DIFFERENTLY, and the cuts follow that rather than the line counts: `WorktreeView.ts` is `god-class` (79% of the file in one class, 90 members, 76 private) whose remedy is extract-collaborators-keep-a-facade; `WorktreeCreateDialog.ts` is `long-function` on a 2802-line closure factory, which is the SAME percentage artifact the previous change recorded — a closure-factory module fires it at any size. So the dialog is not cut by moving DOM code out; its cut is the headless form model (`draft` / `choice` / `pending*`) the closure keeps in scope.
- Inherited from `decompose-worktree-host-controller` round-1 F002 (audit-backlog): `provisionBaseline` is written in `providers/worktreeHost/actions/create.ts` and read in `actions/provision.ts`. Its owner is the follow-up split of `create.ts` on the read/commit seam, which is a THIRD change, not this one — recorded here only so the trigger is not lost.
- Still outstanding on the user's goal after this change: the `create.ts` read/commit split, and `src/worktree/worktreeMutationService.ts` (1852).
