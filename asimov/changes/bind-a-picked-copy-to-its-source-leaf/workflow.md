# Workflow State: bind-a-picked-copy-to-its-source-leaf

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved — no fork: explicit provenance plus opened-handle identity is the minimum safe prerequisite
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [x] All tasks done (`tasks.md`)
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
Lane: full (standard) — host-to-apply source authority crosses asynchronous and filesystem boundaries | flags: security-privacy, cross-boundary
Planned at: 54319e80
Dependencies: parent change `add-a-copy-file-for-this-create-only` must depend on this prerequisite before its Gate 2.
Plan attack: refuted metadata identity and optional authorization; redesigned to a 64-slot held-handle pool, exact-object offer sidecars, required material union, unchanged model copy branch, mutation-finally disposal, and the closed module inventory. Parent claim/reconciliation remains owned by its dependent change.
Plan reattack: refuted unsafe platform fallback, stream/manual-close ownership, unbounded admission/copy teardown, non-green API replacement, immediate-close claim loss, and stale parent ownership. Final construction uses 64 lifecycle slots, bounded admission, safe no-follow hold, auto-closing source streams, additive sidecars, strict material apply, pending-submission claims, and a parent-owned positive path. Oracle: Gate 2 supportable.
