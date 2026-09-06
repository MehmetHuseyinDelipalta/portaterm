# Workflow State: share-session-manager-test-fixtures

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved _(no real fork — the audit settled target and approach)_
- [x] `asm change validate` passes
- [x] Gate 2: plan approved _(fastlane)_

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
Lane: full (standard) — refactor class; 18 consumer test files, MEDIUM risk | flags: none
Admission: in-contract — behavior-preserving test-fixture consolidation; no new invariant owner (specs/NO-DELTA.md)
Planned at: 34a7680d
Source: docs/audit/2026-09-05-slop-audit.md findings U-18 and I-06, deferred at audit time pending this fixture design.
Real-dependency: none — the change edits test doubles only; no production path and no external dependency is involved.
Verify field choice: every suite here calls `vi.mock`, so each Verify is `command pnpm exec vitest run <path>` rather than `unit <path>` — `asm verify-task`'s default `bun test` runner mis-runs these files.
Audit correction: I-06's "two byte-identical copies, replace outright" is false at 34a7680d — `onReady`/`restore` differ from `sessionMocks` in `loadNodePty`'s spawn result, the `onData`/`onExit` field shape, and `isOutputPaused`. Carried as OBL-7/OBL-8 and task 3_1.
Deliberately not cut: `SessionManager.snapshot.test.ts`'s `makeFactories` — its addon instrumentation is the subject under test (design.md D1).
Oracle triage: 5 of 9 first-draft ledger rows accepted as refuted/unresolved and removed (design.md D6); 3 kept with consumer witnesses; 1 new row OBL-10 added from its finding 4; OBL-9's gate rewritten as OBL-11 to catch untracked files. Verified independently before accepting: `bufferFilePath` unreachable through the injected double, `loadNodePty` never dereferenced under `PtySession` mocks, `SessionManager.test.ts:462-470` needs its own handle. Net effect: two pieces of planned work dropped.
Wave 3 built solo, not fanned out to fillers: its five tasks have disjoint leases but one decision thread (the same preservation rules), and the risk here is semantic — a suite passing for the wrong reason — which leases do not prevent.
Witnesses: OBL-4 pass exit 0; OBL-5 pass exit 0; OBL-6 pass exit 0; OBL-10 pass exit 0; OBL-11 pass exit 0.
Verify gate: check-types clean; biome check exit 0 (14 warnings, all pre-existing — the two this change introduced were fixed); gate:fs-deletion ok; test:unit 305 files / 7862 tests, growth purely additive over the 304 / 7845 baseline (+1 file, +17 tests, all in the new sessionMocks.test.ts).
D2 shape re-run: `sessionMocks.ts` now fires `test-bloat` at 252 lines, where it was `unremarkable` at 101. Judged not a recreated defect — the tool's own remedy for that shape is "share fixtures and factories", which is what this change did, and the file holds fixtures, not assertions. Left as a WARN for review to overrule if it disagrees. Result: 724 duplicated fixture lines removed across 13 suites against 151 added to the shared module.
