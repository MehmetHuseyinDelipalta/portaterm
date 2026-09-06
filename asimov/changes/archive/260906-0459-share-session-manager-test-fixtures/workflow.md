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
- [x] Review done _(round 1: APPROVE, 0 blocking; F001-F003 accepted and fixed, F004 audit-backlog)_
- [x] Gate: implementation approved _(fastlane)_
- [-] Blueprint sync complete — no blueprint for this change

## Archive

- [x] Apply deltas: `bun run asm change apply`
- [x] Archive change: `bun run asm change archive`

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
Audit correction: I-06's "two byte-identical copies, replace outright" is false at 34a7680d — `onReady`/`restore` differ from `sessionMocks` in `loadNodePty`'s spawn result, the `onData`/`onExit` field shape, and `isOutputPaused`. Handled by task 3_1 as a widening rather than a swap. (The first draft carried this as OBL-7/OBL-8; both were removed at D6 once the oracle showed all three differences are unobservable — `PtySession` is mocked in every one of the five suites, so `loadNodePty` is never dereferenced.)
Deliberately not cut: `SessionManager.snapshot.test.ts`'s `makeFactories` — its addon instrumentation is the subject under test (design.md D1).
Oracle triage: 5 of 9 first-draft ledger rows accepted as refuted/unresolved and removed (design.md D6); 3 kept with consumer witnesses; 1 new row OBL-10 added from its finding 4; OBL-9's gate rewritten as OBL-11 to catch untracked files. Verified independently before accepting: `bufferFilePath` unreachable through the injected double, `loadNodePty` never dereferenced under `PtySession` mocks, `SessionManager.test.ts:462-470` needs its own handle. Net effect: two pieces of planned work dropped.
Wave 3 built solo, not fanned out to fillers: its five tasks have disjoint leases but one decision thread (the same preservation rules), and the risk here is semantic — a suite passing for the wrong reason — which leases do not prevent.
Witnesses: OBL-4 pass exit 0; OBL-5 pass exit 0; OBL-6 pass exit 0; OBL-10 pass exit 0; OBL-11 pass exit 0.
Verify gate: check-types clean; biome check exit 0 (14 warnings, all pre-existing — the two this change introduced were fixed); gate:fs-deletion ok; test:unit 305 files / 7862 tests, growth purely additive over the 304 / 7845 baseline (+1 file, +17 tests, all in the new sessionMocks.test.ts).
Review round 1 (34a7680d..a4b5e61e): APPROVE, 0 blocking / 0 warn / 4 suggest. F001 (dead `data?` guard), F002 (unpinned backed async write), F003 (unpinned onWrite/cb order) accepted and fixed; both new tests mutation-checked — swapping the callback order and dropping the backed async store each fail exactly one test. F004 (unexercised OutputBuffer surface in the two provider suites) → audit-backlog: Reach none, D1's superset rule accepts it, and dropping `flush` would reach all 18 consumers; reactivates when OutputBuffer wiring lands in either provider. Review also corrected D6's generation-bookkeeping evidence, which argued only the two overriding suites and not the four that do not override — conclusion unchanged, wording fixed.
Post-fix gate: check-types clean, biome exit 0, gate:fs-deletion ok, 305 files / 7865 tests (the 3 added tests are F002's two and F003's one).
D2 shape re-run: `sessionMocks.ts` now fires `test-bloat` at 252 lines, where it was `unremarkable` at 101. Judged not a recreated defect — the tool's own remedy for that shape is "share fixtures and factories", which is what this change did, and the file holds fixtures, not assertions. Left as a WARN for review to overrule if it disagrees. Result: 724 duplicated fixture lines removed across 13 suites against 151 added to the shared module.
