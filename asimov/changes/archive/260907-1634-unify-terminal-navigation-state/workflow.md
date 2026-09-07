# Workflow State: unify-terminal-navigation-state

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [x] Gate 1: direction approved _(only if a real fork; else `[-]`)_
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
Lane: full (standard) — terminal navigation crosses host/webview state and has repeated ordering failures | flags: cross-boundary
Admission: in-contract — stable terminal ownership and owner-scoped navigation
Planned at: 0a55a300
Gate 1: independent adjudication selected webview navigation authority with host-canonical durable facts and routing; oracle findings were verified against code and VS Code source.
Real-dependency: task 2_1 — SessionManager snapshot ownership enters webview restore; Verify runs snapshot and navigation restore suites.
Main projection: global main marks no repository-specific worktree row; linked owners mark exactly one linked row.
Plan attack: Opus and Astra findings triaged; accepted restore, split, witness, migration, and stale-contract defects; rejected host-impossibility and startup-main-mark claims.
Witnesses: I18 pass [exit 0]; I19 pass [exit 0]; I20 pass [exit 0]; I21 pass [exit 0]; I22 pass [exit 0]; OBL-1 pass [exit 0]; OBL-2 pass [exit 0]; OBL-3 pass [exit 0]; OBL-4 pass [exit 0]; OBL-5 pass [exit 0]; OBL-6 pass [exit 0]; OBL-7 pass [exit 0].
Review handback: round-1 F001 replaced unilateral attachment-timeout destruction with the user-approved delivery-aware timeout; no new capability or external behavior.
Review handback: round-2 closes the remaining delivery and persistent-effect boundaries within the approved delivery-aware safety direction.
Review blocked: round-3 F002 sustained — failed rollback effects remain ahead of later navigation and abandonment drops queued intents. Unblock: replan the controller recovery lifecycle; any round 4 requires an explicit user grant.
Risk accepted: F002 — persistent rollback-effect failure may block navigation until reload | Owner: terminal navigation controller | Expiry: 2026-10-07 | Reactivate: navigation freeze report, persistent effect failure, or effect-pipeline change.
