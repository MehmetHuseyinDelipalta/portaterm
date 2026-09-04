# Workflow State: add-a-setup-step-for-this-create-only

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved — the fork (edit the provider file vs a step for this create only) was answered by the user before scaffolding: "Thêm step ad-hoc cho create này"
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
Lane: full (standard) — a new inbound message on the create wire and a new host capability | flags: new-api-contract, security-privacy
Planned at: edc455a7
Plan attack: the oracle refuted the ledger's universal "no extra key crosses the wire" claim (`worktreeCreate` is not `onlyKeys`-checked at the top level; extra keys reach the host and are ignored) — narrowed to "no inbound string is ever read as a command". Six findings, all accepted and repaired in design: F1 `withAdded` strips marker rows before appending; F2 marker ticks carry by script descriptor, edit by ordinal on the pending record; F3 switch records marker ticks; F4 Create withheld while an ask is pending (spec clause added); F5 runtime `kind` membership; F6 the accepted "setup command the user chose to run" scenario narrowed to provider/suggestion steps, and § 4.3's "every row names its source file" to be amended in 3_2.
Auto-decision (fastlane): the marker source text is a host constant shared through `messages.ts`, so the dialog recognises an added row by the same string the host wrote and never by position.
Residual (inherited): a `showInputBox` that never settles holds the form, exactly as the picker's round-4 F007; no timeout added for the same reason.
