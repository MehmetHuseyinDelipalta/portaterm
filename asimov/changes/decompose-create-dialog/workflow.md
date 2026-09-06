# Workflow State: decompose-create-dialog

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
Admission: in-contract — behaviour-preserving decomposition; no new invariant owner
Planned at: fe49091f
- Lane: full. Class: refactor. Gate 1 `[-]`: no real fork — the factory-per-module seam is the one three archived changes used.
- Gate 2 auto-taken under the standing fastlane grant in the user's goal; it records that authorization, not a plan the user read.
- Scope simplified on the user's challenge ("13 changes is too many"): one change per SUBSYSTEM, not per slice. This change takes the whole of WorktreeCreateDialog.ts in ten tasks. Remaining: B = WorktreeHost.ts + actions/create.ts + actions/provision.ts; C = WorktreeController.ts + WorktreeView.ts + worktreeView/actionNotices.ts; D = worktreeMutationService.ts.
- Plan attack refuted this change's FIRST shape and the design is the corrected one. Three things it caught: (1) the provisioning state was written up as a three-call-site cluster and is read at ~40 sites from `:1395` to `:3490` — I had grepped free names inside the range only, never the reverse direction, and had put the false claim in proposal.md; (2) OBL-2 as first written asserted that a new offer never carries the previous offer's ticks, which is the OPPOSITE of what `carryForward` (`:575-611`) exists to do and what `:3040-3078` already requires; (3) OBL-4's two-command form has a staged-edit hole. D1a now makes both-direction enumeration the first step of every capturing task.
- OBL-4's hole is real and I verified it by experiment rather than by reading: with a staged edit to the regression suite and HEAD at the base, `git diff <base>..HEAD -- <path> && git diff -- <path>` both pass. The single `git diff --exit-code <base> -- <path>` catches it. The weak two-command form shipped in changes 2 and 3 — their answers were right because nothing was ever staged, but the check was weaker than those ledgers claimed.
- Knowledge candidate: `checkedByOffer` is keyed by offer id alone (`:1840`) and no test in the 386-case suite reuses one offer id across two repositories | Surprise: a repo-less key collision is uncovered, found while auditing OBL-1's witness | Evidence: WorktreeCreateDialog.ts:1840, WorktreeCreateDialog.test.ts:3278-3324 | Consumer: plan | Action: a behaviour-preserving change may not touch it; raise as its own change after the decomposition series.
- Real-dependency: none — every task is a move within one webview module; no task crosses a network, filesystem or spawn boundary.
- OBL-2 correction, found at 1_2 by mutation rather than by reading: the ledger says the inherited suite asserts only the TICK half of `carryForward`, so the untick half needed a new witness. False. Planting `keptKeys.has(key) || row.checked` — which drops the untick half — turns `WorktreeCreateDialog.test.ts` red (385/386) as well as the new suite. The new case is a faster and more direct witness, not the only one, and the ledger over-claimed its necessity. design.md is frozen at Gate 2, so the row stands as written with this correction beside it; review should read the two together.
