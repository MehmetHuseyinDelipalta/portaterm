# Workflow State: share-jsonl-stream-lifecycle

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [x] Review done _(user-initiated; `[-]` + reason if skipped)_
- [x] Gate: implementation approved
- [-] Blueprint sync complete _(`[-]` + reason only when `Blueprint: none`)_ — `Blueprint: none`

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: full (standard) — refactor class; 8 sites across 4 production readers, MEDIUM risk | flags: none
Admission: in-contract — behaviour-preserving extraction; no new invariant owner (specs/NO-DELTA.md)
Planned at: 842914b5
Source: docs/audit/2026-09-05-slop-audit.md finding U-07, deferred at audit time pending this design.
Sibling: share-session-manager-test-fixtures (archived 260906-0459) closed U-18 and I-06. U-11 remains, and needs its own lifecycle/retry design round first.
Real-dependency: task 1_2 — the real filesystem. Its Verify writes actual JSONL fixtures to a temp dir and streams them through node:fs + node:readline, with no stubbing of either.
Discovery, carried into the ledger rather than repeated: 6 of the 8 sites share the parsed frame; the other two (codexReader.readFirstLine:382, claudeRecords.readFirstUserRecord:203) need the thin lines-only seam, which is why D1 has two.
Plan attack: 3 HIGH + 2 MEDIUM from asm-oracle, all verified against source and all accepted; corrections in design.md § D6. Fastlane auto-decision — no fork opened, the findings were factual defects in my own claims, not choices.
Witnesses: OBL-1 pass; OBL-2 pass; OBL-3 pass; OBL-4 pass; OBL-5 pass; OBL-6 pass; OBL-7 pass; OBL-8 pass — each `X:` run on its own, not inferred from the suite's exit.
Verify-task `--cmd`: `pnpm run check-types` rather than the full test script, because `pnpm run test:unit` is load-flaky (project.md § "test:unit is load-flaky") and three refusals lock a task. Each task's own Verify — the reader suite — was run by `verify-task` itself, and the full 7878-test suite was run once at the Verify Gate.
Lint: `pnpm exec biome check src` exits 1 on three pre-existing findings in files this change never touches (`webview/worktree/worktreeFormat.ts:30`, `session/SnapshotPersistence.ts:504`, `vault/VaultService.customName.test.ts:23`). Scoped to this change's seven files it exits 0.
Shape after: all five touched readers plus `jsonlStream.ts` (65 lines) are `unremarkable` — the frame did not move into a new shape. Production shrank 2561 → 2429 lines against 64 added.
Review: cycle 1 round 1 — WARN, 0 blocking, 2 WARN + 1 SUGGEST, all accepted and closed doc-only (no logic changed, so the cycle ends at Re-Verify). Chair corrected one D4 fact of mine: the six sites spell the record predicate three ways, not two — `claudeReader:128` swaps the operands.
Knowledge candidate: claudeRecords.readFirstUserRecord:216 parses with no object guard, so one literal `null` line ends the whole title lookup at :229 | Surprise: expected the same guard the other six sites carry; the inner catch wraps only JSON.parse, so the TypeError escapes to the file-level catch | Evidence: src/vault/readers/claudeRecords.ts#readFirstUserRecord | Consumer: plan | Action: a separate behaviour-changing change with its own spec delta; OBL-8 pins the current answer so this refactor cannot drift it.
Verify field choice: reader suites are node-ish and would pass under `bun test`, but each Verify is written `command pnpm exec vitest run <path>` so the recorded runner is the project's, not asm's default.
