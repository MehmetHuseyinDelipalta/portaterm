# Design: decompose-worktree-host (refactor: src/providers/WorktreeHost.ts)

## Diagnosis

| | |
|---|---|
| Target | `src/providers/WorktreeHost.ts`, `src/providers/worktreeHost/actions/create.ts`, `src/providers/worktreeHost/actions/provision.ts` |
| Lines at start | 2724 · 1423 · 637 |
| Shape | `long-function` on all three (`asm refactor shape`) |
| Because | `createWorktreeHost` is 2234 lines = **82%** of the module's statements against a 25% bar; `createCreateActions` 1301 = **91%**; `createProvisionActions` 449 = **70%** |
| Direct tests | Seven suites — `WorktreeHost.actions` (369), `.presence` (52), `.test` , `.delegations`, `.scale`, `.invalidation`, `.secondSurface`. **519 cases, 591 ms.** None reaches inside the factory: they build a host and drive it through `handleMessage`/`attach` |
| Why now | Change B of the user's standing goal — these three plus `WorktreeView`/`WorktreeController`/`worktreeMutationService` under 500 |

## Decisions

### D1: Target structure

**One module per question the host answers itself.** The host is a composition root that
owns the surfaces and the cache; everything it *decides* — how a destination resolves,
when to rescan, which opening an answer belongs to, what the presence projection says —
is a subject with its own state, and each becomes `createXxx(deps)` returning named
handlers. Former `let` bindings become accessor functions.

```
src/providers/
  WorktreeHost.ts               # composition root: options in, surfaces + cache held, the returned host
  worktreeHost/
    hostOptions.ts              # the contract the extension offers the host, and the host's own shape
    launchAdmission.ts          # what counts as an admissible agent launch, and the targets published for it
    destinationResolve.ts       # where a create would land: the root, a vetted override, the disposition
    assessLanes.ts              # the per-repository queue of removal assessments and how one is served
    hostLookups.ts              # reading one worktree, repo, path or agent row out of the current cache
    presenceProjection.ts       # what the published presence IS: decay, delegations, the roster
    openingRegistry.ts          # which question a surface asked, under which token, and forgetting it
    provisionOffers.ts          # the provisioning offer a repository is currently being shown
    actionRouting.ts            # dispatching one action message, and the delegation requests it makes
    scanReconcile.ts            # the timers: when to rescan, when to draw rows, when to watch
    projectionLoop.ts           # the single-flight projection run and its commit
    surfaceDelivery.ts          # what reaches a surface, when, and the attachment that receives it
    actions/
      create.ts                 # composition root for the create arms
      create/probes.ts          # answering a create probe: branch verdict, base verdict, well-formedness
      create/debris.ts          # authorizing a removal of what is already at the destination
      create/destinationPick.ts # the folder picker and the answer it returns
      create/submitArm.ts       # the create itself, and the setup retry
      create/defaultsArm.ts     # the defaults and refs a freshly opened form is told
      provision.ts              # composition root for the provisioning arms
      provision/asks.ts         # the copy-file and setup-step asks
```

Left in `WorktreeHost.ts` on purpose: the options preamble, the `surfaces`/`cache`/
`watches`/`openings`/`rosters` maps every module reads, `built`/`disposed`, the wiring
of the twelve modules to each other, `dispose`, and the returned object. That is a
composition root, and moving it would mean inventing a second one.

Clusters ordered by coupling ascending — the count is `grep -c` for the cluster's most
read export inside `WorktreeHost.ts` today.

| # | Cluster | Lines | LOC | Reads | Task |
|---|---|---|---|---|---|
| 1 | `hostOptions.ts` | 119-321, 411-451 | ~250 | 0 (types) | `2_1` |
| 2 | `launchAdmission.ts` — **plus `offerSeq`** | 524-525, 1469-1547 | ~92 | 5 | `2_2` |
| 3 | `destinationResolve.ts` | 1555-1729 | ~180 | 2 | `2_3` |
| 4 | `assessLanes.ts` | 906-1063 | ~160 | 2 | `2_4` |
| 5 | `hostLookups.ts` | 1348-1467, 2525-2534 | ~150 | 3 | `2_5` |
| 6 | `presenceProjection.ts` — derivation only; **not** `projected`/`projectedVersion` | 1249-1347 | ~120 | 8 reads, 0 writes | `2_6` |
| 7 | `openingRegistry.ts` | 797-905, 1064-1164 | ~210 | 9 (`surfaceKey`) | `2_7` |
| 8 | `provisionOffers.ts` — **without `offerSeq`** | 494-523, 526-796 | ~298 | 13 | `2_8` |
| 9 | `actionRouting.ts` | 1548-1554, 1730-1871 | ~155 | 2 | `2_9` |
| 10 | `scanReconcile.ts` | 1223-1248, 2088-2220, 2358-2408 | ~215 | 6 | `2_10` |
| 11 | `projectionLoop.ts` — **plus `projected`/`projectedVersion`**, whose only writer it is | 504-505, 1167-1222, 1872-2087 | ~277 | 11 | `2_11` |
| 12 | `surfaceDelivery.ts` | 2221-2357, 2409-2524 | ~305 | 10 (`broadcast`) | `2_12` |
| 13 | `create/probes.ts` | 160-213, 305-603 | ~360 | — | `2_13` |
| 14 | `create/debris.ts` | 604-683 | ~85 | — | `2_14` |
| 15 | `create/destinationPick.ts` | 214-304, 919-934 | ~110 | — | `2_15` |
| 16 | `create/submitArm.ts` | 684-918 | ~240 | — | `2_16` |
| 17 | `create/defaultsArm.ts` | 1020-1412 | ~400 | — | `2_17` |
| 18 | `provision/asks.ts` | 306-496 | ~190 | — | `2_18` |

Line ranges are the map at `914dbb2b` and shift as tasks land; the cluster's NAME is
what binds, not its numbers.

Deliberately not cut: `messageGuards.ts` (350), `hostTypes.ts` (315),
`actions/shell.ts` (240), `actions/removal.ts` (152), `openingLifecycle.ts` (139) — all
already under 500 and outside the goal.

**Three cluster memberships were wrong in the first draft**, refuted by the plan attack
and re-verified by hand against `914dbb2b`. Each is recorded because the reason
generalises — a binding belongs to its WRITER, not to the block it is declared beside:

- `offerSeq` is declared at `:524-525`, among the provisioning state, and has no
  provisioning use at all: it is incremented and read only by `publishLaunchTargets` at
  `:1533-1534`. It goes to `launchAdmission` (`2_2`), which is extracted six tasks before
  `provisionOffers` would have claimed it.
- `projected` and `projectedVersion` are declared at `:504-505` but written ONLY by
  `projectOnce` at `:1918-1919`. Assigning them to `presenceProjection` (`2_6`) would
  have made that task unable to end green without either inventing setters D4 does not
  allow or editing `projectionLoop`'s body five tasks early. They go to `projectionLoop`
  (`2_11`); `presenceProjection` becomes derivation over what it is handed.
- `treeVersion` stays in the composition root. It is incremented at `:2331`, `:2339` and
  `:2397` — inside `rebuild` and `reconcileWatches`, which belong to two OTHER clusters —
  and read by a third at `:1873`, `:1906`, `:1914`. A counter three clusters write is
  shared state, and shared state is exactly what a composition root is for.

#### D1a: Both directions, every capturing task

A cluster's boundary is assumed WRONG until its free names have been enumerated in BOTH
directions:

- **A — what the block reads from outside it.** Every identifier the moved lines use and
  do not declare, INCLUDING imported constants and types, not only calls. Compile the
  block in isolation against a placeholder header and read the `TS2304` list; do not do
  this by eye. A name declared LOWER in the same closure compiles inside an arrow and
  fails as a direct reference — check the declaration order too, not only the presence.
- **B — what the rest reads from the block.** `grep -n '\bname\b'` across the source file
  for every identifier the block declares. A name read outside becomes an export, an
  accessor, or a reason to move its reader too.

Carried from change A, where skipping direction A's constants cost a task and skipping
direction B put a false claim in a proposal.

#### D4: Accessor conversion and its negation trap

A former `let x` becomes `x()`. TypeScript flags `x ||` and `if (x)` (TS2774) when `x`
becomes a function but does **NOT** flag `!x &&` — the negation silently becomes
"always false". Every converted binding's negation sites are checked by hand, per task.

### D2: Preservation proof

| | |
|---|---|
| Suite command | `pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts` |
| Baseline | **519** tests green at `914dbb2b`, type-check clean, 591 ms |

Rules every task obeys:

- Baseline green after every task. A drop stops the task: revert, never adjust a test.
- Re-run `asm refactor shape` on the source AND on every destination after each cluster.
  A destination that still fires has moved the defect, not removed it.
- Any module reaching 500 lines is split before the task is ticked, not deferred.
- The same step failing twice means the seam is wrong — stop and re-plan.

### D3: Expected test moves

**None.** Every one of the seven suites imports `createWorktreeHost` from
`src/providers/WorktreeHost.ts` and drives it through its public surface. No cut changes
that import, so no test file is touched. This is OBL-4, and an edit to any of them stops
the change.

### D4: Allowed non-pure transformations

- Every task: a `let` becoming an accessor function, and a block comment moving with the
  code it describes.
- Every task: an unused destructure or import left by a cut is trimmed in that task.
- `2_1`: `WorktreeHostOptions` and `WorktreeHost` are re-exported from
  `WorktreeHost.ts`, so no importer changes.
- `2_12`: `handleMessage`'s per-type dispatch may become a lookup into the modules it
  already calls, provided the order of the guards before it is unchanged.

Anything beyond this list is a design change.

## Obligation ledger

| id | claim | semantics | defeater | witness | disposition |
|---|---|---|---|---|---|
| OBL-1 | `dispose` still cancels every armed timer | after `host.dispose()` no timer handle remains armed, for both the cap and the scan | `scanReconcile.ts` holds `capHandle`/`scanHandle` privately and exposes no teardown, so the facade's `if (capHandle !== undefined)` reads a variable nobody writes any more and both timers outlive the host | `X: pnpm exec vitest run src/providers/WorktreeHost.presence.test.ts` — "leaves no timer behind when the host is disposed" asserts the harness's live timer count is 0 after dispose (the assertion is at `:986`), and `:776-789` asserts a pane change armed before dispose fires nothing after it (`pending() === 0` at `:787`). Removing cap cancellation at `:2696-2699` breaks the first; removing scan cancellation at `:2700-2703` breaks the second | supported |
| OBL-2 | forgetting a surface still clears its openings, and disposal still clears the same set | when a surface detaches, and when the host disposes, no opening keyed to it remains — which is what the host does today and all this change may preserve | `openingRegistry.ts` (`2_7`) takes `forgetSurfaceOpenings` but `dispose` at `:2711-2713` keeps calling a facade-local stub, so the loop over `surfaces.keys()` clears nothing and every opening outlives the host | `X: pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts` — detach is driven at `:3543-3565` and `:6958-6982`; the mutation is measured per task, not assumed | supported |
| OBL-3 | a token minted before a cut still rejects the answer minted after it | an answer carrying an opening token the registry has retired changes nothing — no post, no action | `openingFor` moves to `openingRegistry.ts` and the token counter is copied into the module instead of moved, so the facade and the module mint from two counters and a stale token matches a live opening | `X: pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts` — `:5904-5942`: replaying a RETIRED refs token must neither invoke the authorization issuer nor post an answer. It catches removal of the lifecycle guard at `actions/create.ts:1295-1297` or of the registry equality at `WorktreeHost.ts:1074-1078`. (The `:836-870` block first cited here is stale pane/session identity, a different subject; and there is no host-minted opening-token counter, so the row's earlier counter wording was wrong too.) | supported |
| OBL-4 | the inherited regression net is not weakened | the seven `WorktreeHost.*.test.ts` files are byte-identical to their state at `914dbb2b` | a case is relaxed to accommodate a moved body | `X: git diff --exit-code 914dbb2b -- src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts && git diff --cached --exit-code 914dbb2b -- src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts` — BOTH forms, `&&`-joined: `git diff --exit-code <base> -- <paths> && git diff --cached --exit-code <base> -- <paths>`. The single working-tree form alone exits 0 when a weakened test is STAGED and the working copy restored from base; change A recorded the opposite and was wrong, re-verified by experiment on 2026-09-07 | supported |
| OBL-5 | the composition root holds no reference to moved state | after `2_12`, `WorktreeHost.ts` declares none of the frozen inventory below, under that name OR an alias | a binding is duplicated rather than moved, leaving two owners that drift — the concrete form OBL-3 names. A name-only grep cannot see an alias or a carrier object, so the inventory is paired with a size check | `X: the executable check below` | supported |
| OBL-6 | disposal is a commit fence for work already in flight | a projection or roster read that resolves AFTER `disposed` becomes true writes no host state and publishes nothing | `projectionLoop` (`2_11`) and `actionRouting` (`2_9`) take their bodies but not the `disposed` guard that surrounds the await, so a read that was in flight at dispose repopulates `rosters` or assigns `projected` into a dead host | `X: pnpm exec vitest run src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.delegations.test.ts` — `presence.test.ts:798-815` and `delegations.test.ts:424-431`. Production guards: `:1910-1919` around the projection await, `:1852-1861` before `rosters` is repopulated | supported |
| OBL-7 | launch-offer ids stay monotonic across republishes | an offer id minted for an earlier publish is refused after a republish; the counter is never reset or duplicated | `2_2` and `2_8` both claim `offerSeq` (the first draft's error) and it ends up minted from two counters, so a republish re-issues an id an earlier publish already used | `X: pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts` — `:1999-2016` proves an old offer is rejected after a republish. Production: `:524-525` and `:1531-1535` | supported |

### Frozen inventory for OBL-5

Checked by ONE runnable command rather than an unspecified grep — the plan attack refused
the earlier wording:

```sh
# every moved binding, by name — must print nothing
grep -nE '^\s*(let|const|function) (offerSeq|migrationSequence|previewProvisioning|withoutAdded|privateIdsFor|withAdded|roomForOneMoreSetup|issueWithAdded|currentMigrationRegistration|surfaceSeq|surfaceKey|openingKey|openingFor|retireOpening|forgetSurfaceOpenings|forgetDepartedRepos|admitAssess|takeNextAssess|runAssessLane|serveAssess|forgetSurfaceAssessments|presence|rosterKey|parentIsLive|decay|withDelegations|publishedRow|projected|projectedVersion|cachedWorktree|repoIdOf|observationOf|repoById|launchTarget|actionPath|matchedRow|locate|admissiblePrompt|admissibleLaunch|admittedTarget|publishLaunchTargets|launchOpts|createRootFor|vettedOverride|dispositionOf|resolveDestination|perform|handleAction|requestDelegations|armCap|arm|cancelCap|capHandle|scanHandle|reconcileScan|anyShowing|anyDrawingRows|enrichmentOwed|reconcileRowDrawing|armScan|onPaneChange|reconcileWatches|projectionRun|projectionDirty|commit|worktreeIds|projectOnce|requestProjection|ensureProjection|commitAndBroadcast|deliverable|currentMessage|postTo|deliver|broadcast|reconcileShowing|rebuild|attach|handleMessage)\b' \
  src/providers/WorktreeHost.ts
```

`treeVersion`, `built`, `disposed`, `surfaces`, `cache`, `watches`, `openings`, `rosters`
and `rosterReads` are deliberately absent from the inventory: they are the composition
root's own, named in D1 above.

## Risk Map

| Risk | Mitigation |
|---|---|
| No seam is unit-testable; the net is end-to-end only | It runs in 591 ms, so every task verifies in seconds. Each seam is additionally mutation-checked in its task: plant the defeater, confirm red, remove, confirm green |
| `presence` and `broadcast` are read across clusters | Both stay reachable from the composition root as one accessor each. A module that needs them is handed a thunk, never a copy — OBL-5's defeater is exactly the copy |
| Async projection is single-flight over a dirty flag | `projectionLoop.ts` (`2_11`) moves the flag and the run together, never apart. It is late in the order for that reason |
| Timers and dispose end up in different files | OBL-1 is the row that catches it, and it has a real witness rather than an assertion |
