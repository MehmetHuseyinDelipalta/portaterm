# Workflow State: add-a-setup-step-for-this-create-only

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved — the fork (edit the provider file vs a step for this create only) was answered by the user before scaffolding: "Thêm step ad-hoc cho create này"
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
Lane: full (standard) — a new inbound message on the create wire and a new host capability | flags: new-api-contract, security-privacy
Planned at: edc455a7
Plan attack: the oracle refuted the ledger's universal "no extra key crosses the wire" claim (`worktreeCreate` is not `onlyKeys`-checked at the top level; extra keys reach the host and are ignored) — narrowed to "no inbound string is ever read as a command". Six findings, all accepted and repaired in design: F1 `withAdded` strips marker rows before appending; F2 marker ticks carry by script descriptor, edit by ordinal on the pending record; F3 switch records marker ticks; F4 Create withheld while an ask is pending (spec clause added); F5 runtime `kind` membership; F6 the accepted "setup command the user chose to run" scenario narrowed to provider/suggestion steps, and § 4.3's "every row names its source file" to be amended in 3_2.
Auto-decision (fastlane): the marker source text is a host constant shared through `messages.ts`, so the dialog recognises an added row by the same string the host wrote and never by position.
Residual (inherited): a `showInputBox` that never settles holds the form, exactly as the picker's round-4 F007; no timeout added for the same reason.
Verify gate (cycle 2, after 4_1/4_2): observed at ea5e499d on a clean tree — 7750/7750, type check clean, I10 and fs-deletion gates green, bundle gate green against a fresh `node esbuild.js --production`; Biome in check mode carries the same 1 error, 14 warnings and 1 info as the cycle-1 gate, none in a file this change touches; `verify-status` exits 0.
Verify gate (cycle 1): observed at cc32327a on a clean tree — 7747/7747, type check clean, I10 gate green, bundle gate green against a fresh `node esbuild.js --production` (the `compile`/`package` scripts wrap `pnpm run lint`, the auto-fix form, so the bundle was built directly). Biome in check mode: 1 error (`src/webview/worktree/worktreeFormat.ts:30` noUselessEscapeInRegex, untouched, present at the plan's base) and 14 noDescendingSpecificity warnings in CSS files this change does not touch; every file this change edits lints clean, and `worktreePanel.css` carries the same single warning it did at the base. `verify-status` exits 0.
Deviation (2_2): the switch rows are held only while an INPUT is open, not while a save or switch is in flight — the shipped latest-wins ordering already lets a switch outrank those, and holding them broke the accepted "increasing sequence" test.
Handback (review round 1, cycle 1): F001–F003 each need a D# change — D5's selection carry (ordinal snapshot for every op, not script descriptors) and its gate (form-wide, repository selector held), D3's bound (combined model inside `MAX_MODEL_ROWS - 1`). Gate 2, All tasks done and Verify gate unticked; tasks 1_1–3_2 stay `[x]` — the wire, the record, the input and the docs are unchanged by the amendments, only how the form carries ticks and how far the host lets the record grow. F004 rebutted (the picker's optional-capability contract), F005 accepted as trivial. Round 2 is cycle 2's discovery round.
Replan (fastlane, after round 1): D3 bound and D5 carry/gate amended; 4_1 and 4_2 added. Planned at: d3c3df42
