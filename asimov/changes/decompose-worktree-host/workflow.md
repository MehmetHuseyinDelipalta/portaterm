# Workflow State: decompose-worktree-host

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [ ] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [ ] `asm change validate` passes
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
- Auto-decision (task 2_10): `asm refactor shape` still reports `giant-literal` on `scanReconcile.ts` at 25% against a 25% bar. `arm`, `cancelCap`, `anyShowing`, `anyDrawingRows`, `enrichmentOwed`, `reconcileRowDrawing` and `reconcileWatches` were hoisted to module scope; the residue is exactly `capHandle`, `scanHandle` and the four members that read or write them, and is not split further.
- OBL-1 (task 2_10) mutation-checked: emptying `scanReconcile`'s `dispose` fails 2 of 519. Disposition stays `supported`.
- Knowledge candidate: the scan handle's cancellation on dispose is witnessed; the CAP handle's is not | Surprise: neutering only the `capHandle` branch of `dispose` leaves 519 of 519 green, so half of OBL-1's claim rests on no test | Evidence: src/providers/worktreeHost/scanReconcile.ts#dispose | Consumer: plan | Action: a presence-cap-armed-then-disposed case, in whichever change next touches the timers.
- Auto-decision (task 2_4): `asm refactor shape` still reports `long-function` on `assessLanes.ts` at 26% against a 25% bar, and the body it names is the factory itself — the map plus its three closures. `takeNextAssess`, `serveAssess` and `serveRawRemoval` were hoisted to module scope to answer it; the residue is the seam this change chose and is not split further.

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: full
Admission: <new-owner|in-contract — owner or contract>
Planned at: 914dbb2b
Planned at: 914dbb2b
Lane: full. Class: refactor. Gate 1 `[-]`: no real fork — the factory-per-module seam is the one change A and three archived decompositions used.
Admission: in-contract — behaviour-preserving decomposition; no new invariant owner
- Plan attack (asm-oracle) called the first draft NOT executable and was right on every count I could re-verify by hand. OBL-2 refuted, OBL-4 refuted, OBL-5 unresolved, and three cluster memberships wrong.
- The generalisable lesson, now written into D1: **a binding belongs to its WRITER, not to the block it is declared beside.** All three errors were the same error. `offerSeq` sits among the provisioning state at `:524-525` and is minted only by `publishLaunchTargets` at `:1533-1534`. `projected`/`projectedVersion` sit at `:504-505` and are written only by `projectOnce` at `:1918-1919` — assigning them to task `2_6` would have made that task unable to end green six tasks before its writer moved. `treeVersion` is written by three different clusters, so it stays in the composition root.
- OBL-2 as first written was false about CURRENT behaviour, not just about the cut: `dispose` at `:2691-2721` forgets openings and never calls `forgetSurfaceAssessments`. The row is rewritten to the preservation-shaped claim; the gap itself is pre-existing and is recorded below rather than fixed here.
- Knowledge candidate: host disposal forgets openings but not assess lanes | Surprise: I wrote an obligation asserting it cleared both, and the plan attack found `dispose` (`src/providers/WorktreeHost.ts:2691-2721`) clears `openings`, `rosters`, `rosterReads` and `surfaces` but leaves `assessLanes` intact — a held assessment stays in `lane.pending` (`:917-922`) until an await at `:975` completes, which can be withheld indefinitely | Evidence: src/providers/WorktreeHost.ts#dispose vs #forgetSurfaceAssessments | Consumer: plan | Action: raise as its own change after the decomposition series; a behaviour-preserving cut may not fix it.
- OBL-1's and OBL-3's first-draft witness citations were both wrong by a few lines or entirely (`:836-870` is stale pane identity, not opening tokens); corrected in the ledger against `:5904-5942`, which is the real one.
- OBL-6 (disposal as a commit fence for in-flight work) and OBL-7 (launch-offer ids monotonic across republishes) added — both load-bearing, neither covered by the first draft.
- `presence` has 4 call sites, not the 22 the first draft's risk map claimed; that was a grep counting the declaration and property labels.

