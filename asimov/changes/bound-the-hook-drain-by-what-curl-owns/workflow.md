# Workflow State: bound-the-hook-drain-by-what-curl-owns

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved — no fork; one wall-clock bound asserts the scheduler, and the alternatives (retry, fake timers, skip) each hide the invariant instead of keeping it _(only if a real fork; else `[-]`)_
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
Lane: light
Planned at: baf7ca11
- Why now: this one assertion took six `verify-task` strikes today across three changes (`prove-entry-reconstruction-on-windows` 1_4 → locked; `align-the-inline-empty-state-with-its-rows` 1_1 strike 3; `state-the-dialog-in-the-ui-font` 1_1 strikes 1-2, parked). Measured: 2012, 2146, 2229, 2015 ms against 2000, and 3/3 green standalone. Fixing the harness is cheaper than waiting for load before every gate.
- Must-not: the command's own `--max-time 1.5` and the test's ≥1400 ms floor are the invariant; neither moves. No retry, fake timers, or skip.
