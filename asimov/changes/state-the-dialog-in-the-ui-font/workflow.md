# Workflow State: state-the-dialog-in-the-ui-font

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved — no fork; the user named each item and the design brief already states the rule (monospace only for editable or copyable values) _(only if a real fork; else `[-]`)_
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
- Must-not: no copy change, no removal of any note, no change to the picker's message contract or `pickAsked` gate, no edit to `docs/ui/*` mockups or to the shared vault atoms.
- Tasks are chained 1_1 → 2_1 → 3_1 → 3_2 → 3_3 because all five edit `worktreePanel.css`; the chain is a lease decision, not a semantic dependency.
- Left for their own changes, as the user agreed: wait-for-setup relocation and hint removal (c); ad-hoc setup steps for one create (d).
- 1_1 PARKED with its code and RED→GREEN witness done (347/347 in the file, 7716/7717 in the suite twice): both strikes were `src/agentHooks/install/ClaudeHookInstaller.test.ts:526` at 2146 ms and 2015 ms against a 2000 ms wall-clock bound, while the same test passes 3/3 standalone. Sixth strike on that one assertion today across three changes. Parked rather than spending the third attempt — that test is fixed in its own change (`bound-the-hook-drain-by-what-curl-owns`) first, then this resumes at 1_1.
