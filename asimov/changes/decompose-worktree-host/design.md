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
| 2 | `launchAdmission.ts` | 1469-1547 | ~90 | 1 | `2_2` |
| 3 | `destinationResolve.ts` | 1555-1729 | ~180 | 2 | `2_3` |
| 4 | `assessLanes.ts` | 906-1063 | ~160 | 2 | `2_4` |
| 5 | `hostLookups.ts` | 1348-1467, 2525-2534 | ~150 | 3 | `2_5` |
| 6 | `presenceProjection.ts` | 1249-1347 | ~120 | 3 (`presence` 22, as one accessor) | `2_6` |
| 7 | `openingRegistry.ts` | 797-905, 1064-1164 | ~210 | 9 (`surfaceKey`) | `2_7` |
| 8 | `provisionOffers.ts` | 494-796 | ~300 | 5 (`withAdded`) | `2_8` |
| 9 | `actionRouting.ts` | 1548-1554, 1730-1871 | ~155 | 2 | `2_9` |
| 10 | `scanReconcile.ts` | 1223-1248, 2088-2220, 2358-2408 | ~215 | 6 | `2_10` |
| 11 | `projectionLoop.ts` | 1165-1222, 1872-2087 | ~275 | 8 | `2_11` |
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
| OBL-1 | `dispose` still cancels every armed timer | after `host.dispose()` no timer handle remains armed, for both the cap and the scan | `scanReconcile.ts` holds `capHandle`/`scanHandle` privately and exposes no teardown, so the facade's `if (capHandle !== undefined)` reads a variable nobody writes any more and both timers outlive the host | `X: pnpm exec vitest run src/providers/WorktreeHost.presence.test.ts` — "leaves no timer behind when the host is disposed" asserts the harness's live timer count is 0 after dispose (`:978-986`), and `:778-789` asserts a pane change armed before dispose fires nothing after it | supported |
| OBL-2 | forgetting a surface still clears BOTH its openings and its assessments | when a surface detaches or the host disposes, no opening and no queued assessment keyed to it remains | `openingRegistry.ts` and `assessLanes.ts` are cut apart (tasks `2_7`, `2_4`) and the facade calls only `forgetSurfaceOpenings`, leaving `forgetSurfaceAssessments` unreachable — a detached surface's queued assessment then resolves into a host that no longer has it | `X: pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts` — the 369-case arm suite drives attach/detach and every action arm; the mutation is measured per task, not assumed | supported |
| OBL-3 | a token minted before a cut still rejects the answer minted after it | an answer carrying an opening token the registry has retired changes nothing — no post, no action | `openingFor` moves to `openingRegistry.ts` and the token counter is copied into the module instead of moved, so the facade and the module mint from two counters and a stale token matches a live opening | `X: pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts` — `:836-870` "a value that went stale acts on nothing" asserts `calls` and `posts` are both empty for a superseded row; `:1347-1582` drive `requestWorktreeRefs` under an explicit token | supported |
| OBL-4 | the inherited regression net is not weakened | the seven `WorktreeHost.*.test.ts` files are byte-identical to their state at `914dbb2b` | a case is relaxed to accommodate a moved body | `X: git diff --exit-code 914dbb2b -- src/providers/WorktreeHost.actions.test.ts src/providers/WorktreeHost.presence.test.ts src/providers/WorktreeHost.test.ts src/providers/WorktreeHost.delegations.test.ts src/providers/WorktreeHost.scale.test.ts src/providers/WorktreeHost.invalidation.test.ts src/providers/WorktreeHost.secondSurface.test.ts` — ONE command, base against the working tree. The two-command form has a staged-edit hole (verified by experiment in change A) | supported |
| OBL-5 | the composition root holds no reference to moved state | after `2_12`, `WorktreeHost.ts` declares no `let` a task moved | a binding is duplicated rather than moved, leaving two owners that drift — the concrete form OBL-3 names | `X: the D2 suite command` plus a per-task grep recorded in the task's evidence: the moved identifier returns zero declarations in the composition root | supported |

## Risk Map

| Risk | Mitigation |
|---|---|
| No seam is unit-testable; the net is end-to-end only | It runs in 591 ms, so every task verifies in seconds. Each seam is additionally mutation-checked in its task: plant the defeater, confirm red, remove, confirm green |
| `presence` has 22 read-sites and `broadcast` 10 | Both stay reachable from the composition root as one accessor each. A module that needs them is handed a thunk, never a copy — OBL-5's defeater is exactly the copy |
| Async projection is single-flight over a dirty flag | `projectionLoop.ts` (`2_11`) moves the flag and the run together, never apart. It is late in the order for that reason |
| Timers and dispose end up in different files | OBL-1 is the row that catches it, and it has a real witness rather than an assertion |
