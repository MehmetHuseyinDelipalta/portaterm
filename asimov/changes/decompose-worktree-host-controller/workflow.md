# Workflow State: decompose-worktree-host-controller

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved — approach arrived settled from asimov-refactor; the one late fork (action seam shape) was decided in Stage 3
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
Lane: full (standard) — 10+ files across the extension-host/webview boundary, MEDIUM risk concentrated in HostState threading | flags: cross-boundary
Admission: in-contract — behaviour-preserving decomposition; no new invariant owner, single acceptance story (baseline suite green)
Planned at: a3d2416e
Plan attack: asm-oracle refuted all 4 obligation rows in their first form; claims restated to what a witness establishes, 2 rows now fund new tests (OBL-3 dialogChannels, OBL-4 provision). Rejected as out of scope: fsDeletionGate is not transitive (src/extension.ts:1603-1619) — pre-existing gate property.
Late fork: action modules need ~10 host helpers, not just state — chose factory-per-module over a ~25-field context object; the planned HostState task was dropped as unnecessary.
Pattern: tagged-union opening reducer admitted (design.md D5) as task 3_1, after extraction, per user decision to keep it in this change.
Residual: createWorktreeHost still fires long-function at ~71% after 2_4 — projection/publish/presence is a separate axis and a follow-up change.
Worktree: none — building on main at user's direction.
Mode: fastlane from task 1_2 onward (user), incl. review to 3 rounds then archive.
Next change (user-directed): WorktreeCreateDialog.ts + WorktreeView.ts — note CreateDialog is this change's declared non-goal; the churn/capture reasons in proposal.md stand and the cut there must be the headless form model, not a DOM split.
D1 premise corrected during 1_2: the controller suite is not purely black-box — 7 tests bound the create form's sinks by assigning the private `apply*` fields. Retargeted to the channel seam (design.md D3); assertions untouched. The host suite was checked and has no equivalent poke.
Planning defect found at 2_1, fixed in-contract: all four action factories need WorktreeSurface / AdmittedLaunch / LaunchTargetRecord / WorktreeActions across the module boundary, and two of those were unexported. Added barrier task 2_0 (hostTypes.ts) as predecessor per skeleton-first; 2_1 now Deps on it. 2_1's lease was parked unstarted — no code was written for it.

