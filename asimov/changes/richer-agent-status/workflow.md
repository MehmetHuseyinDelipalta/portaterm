# Workflow State: richer-agent-status

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved _(no real fork — hybrid Orca semantics with Anywhere's evidence-aware shapes was already chosen)_
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
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
Lane: full (standard) — registry semantics, derived presentation state, and worktree UI styling span host projection and webview rendering | flags: none
Planned at: 0de80546
Validator warning accepted: the modified requirement keeps the existing public capability name and specifies visible external-row behavior, not a private source path.
Verify exception: `pnpm run test:unit` had 7,932 pass / 3 fail outside this change — two `src/extension.worktreeMutations.test.ts` `terminal.retire` failures reproduce on clean `0de80546`, and the documented load-flaky `src/extension.worktreeAssembly.test.ts` case passed standalone; all 590 change regressions and every other project gate passed.
