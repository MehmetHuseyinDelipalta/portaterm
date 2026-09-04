# Workflow State: offer-the-setup-wait-only-where-setup-exists

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved — no fork; the user named the outcome (hide when there is nothing to wait for, put it by setup, drop the hint) and the design row already carries the only counter-argument, which the delta answers _(only if a real fork; else `[-]`)_
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [-] Review done — one control moved and its visibility rule narrowed; the submitted draft, the never-re-arm rule and host gating are untouched and the assembly tests that drive the real gate pass; no escalation flags
- [x] Gate: implementation approved
- [-] Blueprint sync complete — no blueprint; the owning design paragraph (§ 6) was updated inside the task's lease

## Archive

- [x] Apply deltas: `bun run asm change apply`
- [x] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: light
Planned at: ed596778
- Validate WARN on requirement length: inherited — the accepted requirement is already four bullets and a scenario; this delta adds two clauses and one scenario. Splitting "visible/disabled/hidden" out into its own requirement would make every later MODIFIED carry two blocks for one control. Kept.
- The design's own argument for disabled-not-hidden ("hiding it would make its absence look like a layout change rather than a consequence of the checkbox above it") is right for the case it names — setup exists and is unticked — and that case stays disabled. It does not cover a repository with no setup at all, where there is no checkbox above it for the absence to be a consequence of; that case was a permanently grey box with a sentence telling the user to select a row that does not exist.
- Must-not: the submitted `waitForSetup`, the never-re-arm rule, and host-side gating are untouched.
- Verify Gate: type check 0, full suite green at VITEST_MAX_THREADS=6 on the tick, `biome check src` exits 1 on the same pre-existing `src/webview/worktree/worktreeFormat.ts:30:27` error and 14 warnings — none new, none in a touched line.
