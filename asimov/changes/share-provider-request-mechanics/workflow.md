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
- [x] Review done _(user-initiated; `[-]` + reason if skipped)_
- [x] Gate: implementation approved
- [-] Blueprint sync complete — no blueprint for this change

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
Witnesses: OBL-1 pass; OBL-2 pass; OBL-3 pass; OBL-4 pass (both halves); OBL-5 pass; OBL-6 pass; OBL-7 pass; OBL-8 pass (both halves) [exit 0] — `pnpm exec vitest run src/providers/webviewRequests.test.ts` (25) and `.../providerRequestWiring.test.ts` (7), each run on its own rather than inferred from the suite.
Witnesses line correction: the version of this line written at the first verify gate claimed OBL-8 passed in both halves when its file-preview WIRING half did not exist, and claimed OBL-2 passed when its disposal half observed only the test's own `dispose()` call. Both were false, both are round-1 F001/F002, and both are true as written above only since `ebf30358`.
Verify gate: at the first pass `pnpm run test:unit` failed 2 tests in `src/worktree/adoptWorktree.integration.test.ts`, a file this change does not touch; reproduced on a clean detached worktree at the change's base 8484a26f, so pre-existing. After the round-1 fixes the full suite is 7910/7910 green. `check-types`, `biome check src`, `gate:fs-deletion` and `build:check-requires` all clean.
Gate auto-decision (fastlane): implementation approved on 0 blocking findings, all four accepted findings closed by their named mutation, and a fully green gate — the user's fastlane goal named review-then-archive explicitly.
Review: cycle 1, round 1 (discovery) — 0 BLOCK, 2 WARN, 4 SUGGEST, verdict WARN. Chair machine-diffed all four handlers between the two providers at base and found no unlisted difference for the extraction to unify. F001-F004 accepted and fixed in `ebf30358`, each closed by the mutation the round file names. F005 (a third copy of the swallowing post at `src/extension.ts:2306`) and F006 (wall-clock settle budgets) are `audit-backlog` — valid, out of this change's declared scope, neither can falsify an obligation row here. No BLOCK and no open rebuttal, so the cycle ends at re-verify; no round 2.
Round-1 remediation cost me a redo: I reverted each mutation with `git checkout <file>` while the fixes were still uncommitted, which discarded them along with the mutant. Commit the fix before running its mutation.
Provider baseline is NOT provably clean: one `pnpm exec vitest run src/providers` run failed a single test, four consecutive re-runs passed 1027/1027, and the failing test's name was not captured. design.md § D2 requires a re-run before attributing any lone provider failure to this change.
