# Workflow State: align-the-inline-empty-state-with-its-rows

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved — no fork; one CSS rule is at the wrong inset and the numbers it has to match are in the same file _(only if a real fork; else `[-]`)_
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [-] Review done — one CSS rule set and one source-read test, no product logic, no escalation flags
- [x] Gate: implementation approved
- [-] Blueprint sync complete — no blueprint for this change

## Archive

- [x] Apply deltas: `bun run asm change apply`
- [x] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: light
Planned at: be07ff8d
- Must-not: no edit to `.wt-row`/`.wt-repo`, the shared `emptyState` atom, `vaultPanel.css`, the copy, the create action, or `isUnbranched` — the report is about where the block sits, not what it says or when.
- The user's "nhà quê" is read as scale, not styling: the atom is the panel-scale block (24px padding, 13/12px, 240px body cap) and inline it sits between 11-13px rows. Scaling it to the row is the whole fix; no new visual vocabulary is introduced.
- Three sibling changes the user approved in the same turn are NOT here: dialog typography and affordances, wait-for-setup relocation, ad-hoc setup steps for one create.
- 1_1 verify strike 1 was mine: `unit` Verify defaults to `bun test`, which has no jsdom, so 224/224 failed on `document is not defined` — this repo's runner is vitest and needs `--runner 'VITEST_MAX_THREADS=3 pnpm exec vitest run'`. Strike 2 was the suite rule refusing the new RED witness until `--test-change` declared it. Strike 3 was `src/agentHooks/install/ClaudeHookInstaller.test.ts:526` at 2229 ms against its 2000 ms wall-clock bound under load 6.4 — the same flake that locked `prove-entry-reconstruction-on-windows` 1_4 earlier today. Waited for load < 3 before the last attempt.
- Follow-up, NOT taken here: that test bounds the whole `spawn /bin/sh → close` round-trip at 2000 ms while the command it runs already carries `--connect-timeout 0.5 --max-time 1.5`, leaving 500 ms for shell, awk and curl startup and teardown under a 295-file parallel run. Its neighbour at :505 has the same 2000 ms bound with no lower bound at all. The invariant worth keeping is the LOWER bound (≥1400: the black hole really was waited out to max-time, not short-circuited) and exit 0; the upper bound is asserting the machine's scheduling, not the command. Four verify strikes across two changes today.
- Verify Gate: type check 0, 7716/7716 (VITEST_MAX_THREADS=2), `biome check src` exits 1 on the same one pre-existing error at `src/webview/worktree/worktreeFormat.ts:30:27` and 14 `noDescendingSpecificity` warnings — none in a file this change touched (`git diff --stat` at the change's base: worktreePanel.css and WorktreeView.test.ts only; the css file's only diagnostic is the pre-existing :635).
