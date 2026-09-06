# Workflow State: refuse-a-directory-match-the-process-table-refuted

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved _(no fork: the rule is the one the verified fix already established)_
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing — `pnpm run check-types`, `biome check`, `pnpm run test:unit` (309 files, 7913 tests) all exit 0
- [-] Review done _(not requested)_
- [x] Gate: implementation approved
- [-] Blueprint sync complete — reason: `Blueprint: none`; this change adds no phase or task to a blueprint, it records a rule an already-verified fix established

## Archive

- [x] Apply deltas: `bun run asm change apply`
- [x] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: light
Admission: in-contract — `claude-running-session-map` owns terminal→session resolution; `worktree-agent-presence` owns what a pane may claim.
Debug session: asimov/debug/260906-at-session-owner-other-window (code and tests landed there; this change records the rule).
Real-dependency: task 1_1 — real Claude PID-registry files on disk, read by the shipped `listRunningClaudeSessions` through `createPresenceProjectorDeps` and `createPresenceProjector`, with the row drawn by the shipped `renderAgentRow`; only the `ps` table is injected, so the refusal it decides is stated rather than sampled. Verify: `bun run asimov/debug/260906-at-session-owner-other-window/repro.ts`
Planned at: c7d1ac4d
