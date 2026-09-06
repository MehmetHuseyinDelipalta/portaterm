# Workflow State: share-provider-request-mechanics

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
Lane: full (standard) — refactor class; 9 duplicated members across 2 production providers, MEDIUM risk | flags: none
Admission: in-contract — behaviour-preserving extraction; no new invariant owner (specs/NO-DELTA.md)
Planned at: 8484a26f
Source: docs/audit/2026-09-05-slop-audit.md finding U-11, the audit's last deferred item.
Audit premise partly falsified before planning: U-11's stated risk basis ("the editor/view retry asymmetry is real and must be parameterised") is wrong about the retry primitives — `safeSendWithRetry`/`safePostMessage` are identical in both providers. One real posting asymmetry does exist, but at the `handleRequestSubagentPreview` call sites, not in the primitives.
Scope decision: user chose the full ~180-line scope (both clusters) in one change over the 73-line provably-redundant subset, after being shown the measurement. proposal.md states the two clusters carry different risk.
Real-dependency: task 1_2 — the VS Code webview posting contract. Its Verify drives the real `postOnce`/`postWithRetry` against a fake webview whose `postMessage` outcome and attempt count the test controls; neither function under test is stubbed.
Plan attack: asm-oracle returned 0 refuted, 4 supported, 4 unresolved; all four accepted and fixed, corrections in design.md § D6. The common defect was mine: four witnesses tested the shared module and called it proof of the providers' behaviour, so task 1_3 was added for the wiring half.
Witnesses: OBL-1 pass; OBL-2 pass; OBL-3 pass; OBL-4 pass (both halves); OBL-5 pass; OBL-6 pass; OBL-7 pass; OBL-8 pass (both halves) [exit 0] — `pnpm exec vitest run src/providers/webviewRequests.test.ts` (23) and `.../providerRequestWiring.test.ts` (5), each run on its own rather than inferred from the suite.
Verify gate: `pnpm run test:unit` failed 2 tests in `src/worktree/adoptWorktree.integration.test.ts`, a file this change does not touch. Reproduced on a clean detached worktree at the change's base 8484a26f (1 failure, same file), so it is pre-existing — gate ticked per the build rule. `check-types`, `biome check src`, `gate:fs-deletion` and `build:check-requires` all clean.
Provider baseline is NOT provably clean: one `pnpm exec vitest run src/providers` run failed a single test, four consecutive re-runs passed 1027/1027, and the failing test's name was not captured. design.md § D2 requires a re-run before attributing any lone provider failure to this change.
