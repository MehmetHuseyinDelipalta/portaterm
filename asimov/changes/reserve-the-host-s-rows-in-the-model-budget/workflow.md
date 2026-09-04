# Workflow State: reserve-the-host-s-rows-in-the-model-budget

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved — no fork: the host-side alternative is refuted in design.md D2, and the reservation is the only construction that holds the bound
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
Lane: full (standard) — a shared invariant owner over the provisioning row budget | flags: none (no wire, no user-facing contract change)
Planned at: 4db569c4
Origin: review round 3 F003 of `add-a-setup-step-for-this-create-only` (thrash stop, option 1). That change DEPENDS on this one; F008 (the inert `wt-bring-box--only-add` toggle) travels here as 2_1 step 3.
Baseline: the defect predates both changes — at `edc455a7` the save branch published `withSaveReports(base, posts)` through `offers.issue` with no bound, so a capped read plus a refusal and a lock shipped 202 rows with no added step involved.
