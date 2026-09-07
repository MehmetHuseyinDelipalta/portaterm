# Workflow State: decompose-worktree-host

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [ ] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [ ] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [x] Review done _(user-initiated; `[-]` + reason if skipped)_
- [ ] Gate: implementation approved
- [ ] Blueprint sync complete _(`[-]` + reason only when `Blueprint: none`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes
- Review cycle 1 round 1 (`asm-review-master`, range `112e0284..1f21b202`): APPROVE, 0 blocking / 0 warnings / 0 suggestions. Persisted at `.reviews/round-1.md`. No fix loop; the cycle ended at the discovery round.
- Witnesses: OBL-1 pass [exit 0]; OBL-2 pass [exit 0]; OBL-3 pass [exit 0]; OBL-4 pass [exit 0]; OBL-5 pass [exit 1 — the grep printed nothing, which is the pass]; OBL-6 pass [exit 0]; OBL-7 pass [exit 0].
- Deviation (task 2_21): the re-point alone was not enough. `oneOwner.test.ts`'s `callablesOf` indexed a name LAST-WINS, so `openingRegistry`'s one-line `forgetDepartedRepos(departed)` delegate on the returned object shadowed the module-scope routine of the same name and the assertion ran over an empty body. It now keeps the OUTERMOST spelling — which is the owner in every factory-per-module file this change created.
- Auto-decision (task 2_10): `asm refactor shape` still reports `giant-literal` on `scanReconcile.ts` at 25% against a 25% bar. `arm`, `cancelCap`, `anyShowing`, `anyDrawingRows`, `enrichmentOwed`, `reconcileRowDrawing` and `reconcileWatches` were hoisted to module scope; the residue is exactly `capHandle`, `scanHandle` and the four members that read or write them, and is not split further.
- OBL-1 (task 2_10) mutation-checked: emptying `scanReconcile`'s `dispose` fails 2 of 519. Disposition stays `supported`.
- Knowledge candidate: the scan handle's cancellation on dispose is witnessed; the CAP handle's is not | Surprise: neutering only the `capHandle` branch of `dispose` leaves 519 of 519 green, so half of OBL-1's claim rests on no test | Evidence: src/providers/worktreeHost/scanReconcile.ts#dispose | Consumer: plan | Action: a presence-cap-armed-then-disposed case, in whichever change next touches the timers.
- Task 2_20 `wc -l` (plan step 4): `WorktreeHost.ts` 432. Under `worktreeHost/`: `actions/create/probes.ts` 464 · `actions/provision.ts` 440 · `surfaceDelivery.ts` 416 · `projectionLoop.ts` 391 · `actions/create/submitArm.ts` 362 · `messageGuards.ts` 350 · `scanReconcile.ts` 347 · `actions/create/defaultsArm.ts` 347 · `hostTypes.ts` 332 · `hostOptions.ts` 306 · `provisionOffers.ts` 287 · `composeCreateSurface.ts` 267 · `actions/provision/asks.ts` 261 · `assessLanes.ts` 242 · `actions/shell.ts` 240 · `openingRegistry.ts` 238 · `actions/create/refsArm.ts` 218 · `actions/create.ts` 210 · `actionRouting.ts` 198 · `hostLookups.ts` 172 · `mutationSupport.ts` 161 · `actions/create/destinationPick.ts` 158 · `actions/removal.ts` 152 · `presenceProjection.ts` 144 · `openingLifecycle.ts` 139 · `destinationResolve.ts` 133 · `launchAdmission.ts` 128 · `mutationBindings.ts` 82 · `actions/create/debris.ts` 79. Nothing at or above 500.
- OBL-4 and OBL-5 re-run at task 2_20: both clean — the seven suites are byte-identical to `914dbb2b` in BOTH diff forms, and the frozen-inventory grep prints nothing.
- Auto-decision (task 2_20): `shape` reports `long-function` on `WorktreeHost.ts` (84%) and `composeCreateSurface.ts` (84%). Both bodies are wiring — a sequence of `const x = createY({...})` and nothing else. The remedy "extract functions first" has nothing to extract from a composition root: the extraction would BE a composition root, which is what `composeCreateSurface` already is. Not split further.
- Auto-decision (task 2_18): `asm refactor shape` fired on both files after the asks cut. Answered by hoisting: `provision.ts`'s two remaining arms (`handleProvisionSwitch`, `handleProvisionSave`) to module scope, and `applyStepAsk` and `takePickedCopy` out of the two asks. `asks.ts` is now `unremarkable`; `provision.ts` residue is `handleProvisionSave` at 31% against a 25% bar — one save, one flow — and is not split further.
- Deviation (task 2_17): the two arms were planned into one `defaultsArm.ts`; together they came to 498 lines and `asm refactor shape` still fired, so the refs arm went to its own `create/refsArm.ts`. The seam is real rather than size-only: `requestWorktreeCreateDefaults` MINTS the opening and `requestWorktreeRefs` may only ride one (design.md D5).
- Auto-decision (task 2_17): `shape` reports `long-function` on `defaultsArm.ts` at 28% and `refsArm.ts` at 35%, against a 25% bar. `offerMigration`, `offerProvisioning`, `offerPullRequests` and `postRefs` were hoisted; each residue is one arm's own guard-and-record sequence, and is not split further.
- Auto-decision (task 2_16): `asm refactor shape` reported `long-function` on `submitArm.ts` at 76%. Answered by four extractions inside the submit — `refuseCreate` (the same error post written out four times), `redeemProvision`, `spendMigrationOffer` and `runCreate`. Re-run reports `unremarkable`.
- Deviation (task 2_14): the task planned `corroborate` and `corroborateAdopt` into `create/debris.ts`; task 2_13's direction-B enumeration had already shown the probe is their only caller, so they went to `create/probes.ts` and 2_14 cut `answerDebrisAuthorization` alone.
- Deviation (task 2_13): `corroborate` and `corroborateAdopt` moved to `create/probes.ts` too. Plan step 2 did not name them; direction B (D1a) found the probe is their only caller, so leaving them behind would have left two dead helpers in the file the task is cutting down.
- Auto-decision (task 2_13): `asm refactor shape` still reports `long-function` on `probes.ts` at 27% against a 25% bar. `resolveProbeMode` and `recordPublication` were hoisted out of `answerCreateProbe` (195 lines to 127); the residue is the ownership dance itself — `stillOurs`, its anchor, and the three re-checks between awaits — which is the one thing that cannot leave the function it guards. Not split further.
- Task 2_12 `wc -l` (plan step 5): `WorktreeHost.ts` 739 · `surfaceDelivery.ts` 416 · `projectionLoop.ts` 391 · `messageGuards.ts` 350 · `scanReconcile.ts` 347 · `hostTypes.ts` 315 · `hostOptions.ts` 306 · `provisionOffers.ts` 287 · `assessLanes.ts` 242 · `actions/shell.ts` 240 · `openingRegistry.ts` 238 · `actionRouting.ts` 198 · `hostLookups.ts` 172 · `actions/removal.ts` 152 · `presenceProjection.ts` 144 · `openingLifecycle.ts` 139 · `destinationResolve.ts` 133 · `launchAdmission.ts` 128 · `mutationBindings.ts` 82. Over 500: `actions/create.ts` 1423 and `actions/provision.ts` 637, both owned by tasks `2_13`-`2_18`, and the facade at 739.
- Deviation (task 2_12): D1 says the returned object and the wiring stay in the composition root, and after twelve cuts that root is still 739 lines — the twelve modules' wiring costs lines the design's arithmetic did not carry. The goal binds at 500, so task `2_19` is added to cut what the mutation service asks the host (`mutationBindings()` and the removal assessment behind it) into `worktreeHost/mutationSupport.ts`, beside the types module `2_1` already split out for the same consumer.
- Auto-decision (task 2_12): `asm refactor shape` reported `long-function` on `surfaceDelivery.ts` at 69%. Answered the way `2_11` answered it — every member hoisted to module scope over a `DeliveryFlags` record holding the one fact (`built`) the module writes. Re-run reports `unremarkable`.
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

