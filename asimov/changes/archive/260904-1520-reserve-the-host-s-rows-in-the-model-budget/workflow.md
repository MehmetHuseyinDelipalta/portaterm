# Workflow State: reserve-the-host-s-rows-in-the-model-budget

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved — no fork: the host-side alternative is refuted in design.md D2, and the reservation is the only construction that holds the bound
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [x] Review done _(user-initiated; `[-]` + reason if skipped)_
- [x] Gate: implementation approved
- [-] Blueprint sync complete — no blueprint for this change

## Archive

- [x] Apply deltas: `bun run asm change apply`
- [x] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: full (standard) — a shared invariant owner over the provisioning row budget | flags: none (no wire, no user-facing contract change)
Planned at: 4db569c4
Origin: review round 3 F003 of `add-a-setup-step-for-this-create-only` (thrash stop, option 1). That change DEPENDS on this one; F008 (the inert `wt-bring-box--only-add` toggle) travels here as 2_1 step 3.
Baseline: the defect predates both changes — at `edc455a7` the save branch published `withSaveReports(base, posts)` through `offers.issue` with no bound, so a capped read plus a refusal and a lock shipped 202 rows with no added step involved.
Plan attack: claims 1, 2, 3 and 5 supported — the three host rows are the complete set, every publish path passes through `withAdded`, `postedBySave` really replaces a prior attempt's reports (including on the thrown-reread fallback, which composes from an already-composed model without double counting), and `isKnownSave` may stay at `MAX_MODEL_ROWS`. Two refuted and repaired: the cap's own statement would have claimed 200 while refusing at 197 (it now names `MAX_READ_ROWS`), and 2_1 with one recorded step would have left the reserved withholding row unexercised (it now records two and covers the thrown reread).
Verify gate: observed at 6f7903e0 on a clean tree — 7759/7759, type check clean, I10 and fs-deletion gates green, bundle gate green against a fresh `node esbuild.js --production`; Biome in check mode carries two errors and 14 warnings, all pre-existing in files this change does not touch (`worktreeFormat.ts:30`, `VaultService.customName.test.ts:23`); `verify-status` exits 0.
Review: round 1 (cycle 1) APPROVE, 0 findings — the reader's allowance, all four publish paths, save-report replacement, the thrown-reread fallback and `isKnownSave`'s bound each verified independently. Blueprint sync `[-]`: `Blueprint: none`.
