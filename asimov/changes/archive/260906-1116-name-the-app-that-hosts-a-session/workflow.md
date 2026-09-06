# Workflow State: name-the-app-that-hosts-a-session

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [x] Gate 1: direction approved — user chose A+B plus option 2 (name the shell, split the count) after the alternatives were put to them
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate — `pnpm run check-types` clean, `biome check` clean, `node esbuild.js` exit 0, `pnpm run test:unit` 311 files / 7940 tests with only the known adoptWorktree.integration load flake (green in isolation, exit 0)
- [x] Review done — 2 rounds, asm-review-master. Round 1 BLOCK F001 (hidden panes still classified their worktree active) and round 2 WARN F001 (the top-level render guard still hashed hidden rows) both accepted and fixed; responses recorded in `.reviews/round-1.md` and `.reviews/round-2.md`
- [x] Gate: implementation approved — user previewed the build in the debug host and confirmed the behaviour, then asked for the review; both rounds closed
- [-] Blueprint sync complete — reason: `Blueprint: none`; adds no phase or task to a blueprint

## Archive

- [x] Apply deltas: `bun run asm change apply`
- [x] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: light
Admission: in-contract — `worktree-agent-presence` owns what a row may claim; `worktree-panel` owns how it is labelled.
Raised by: asimov/debug/260906-at-window-pane-untitled (DIAGNOSED — the panel over-claiming, not a mechanism fault)
Real-dependency: task 1_1 — the real `ps -axo pid=,ppid=,comm=` ancestry shape from the reporting machine (claude → zsh → login → Orca Helper → Orca), replayed through `parseProcessRows`/`ownerAppOf`; the two unbundled links are what make a nearest-match rule fail. Verify: `pnpm exec vitest run src/pty/processTree.test.ts`
Planned at: a3f5a20a
