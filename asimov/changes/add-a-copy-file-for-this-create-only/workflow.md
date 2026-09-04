# Workflow State: add-a-copy-file-for-this-create-only

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved — fail-closed choice: current provider entries and exclusions win over an ad-hoc duplicate
- [x] `asm change validate` passes
- [ ] Gate 2: plan approved

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
Lane: full (standard) — new inbound operation, system picker and current-opening copy authority | flags: new-api-contract, security-privacy
Planned at: c270a0bb
Dependencies: archived `add-a-setup-step-for-this-create-only` (host-held input/record pattern), archived `reserve-the-host-s-rows-in-the-model-budget` (shared final-model bound), and active `bind-a-picked-copy-to-its-source-leaf` (exact held source plus private offer provenance); Gate 2 waits for the prerequisite archive.
Plan attack: the original path-only record, string-marker provenance, current-source duplicate check, and Create-before-Save witness were refuted. Replanned on the held-file prerequisite with resolved containment, exact-object sidecars, provider precedence, transactional claims, lifecycle disposal, and Save-before-Create verification.
