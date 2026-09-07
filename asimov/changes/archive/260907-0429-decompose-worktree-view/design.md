# Design: decompose-worktree-view (refactor: WorktreeController.ts + WorktreeView.ts)

## Diagnosis

| | |
|---|---|
| Target | `src/webview/worktree/WorktreeController.ts`, `src/webview/worktree/WorktreeView.ts`, `src/webview/worktree/worktreeView/actionNotices.ts` |
| Lines at start | 1904 · 1485 · 622 |
| Shape | `god-class` · `god-class` · `long-function` |
| Because | `WorktreeController` holds 1582/1904 (**83%**) across 76 members and `WorktreeView` 1282/1486 (**86%**) across 69, against a 60% bar; `createActionNotices` is 323 lines = **52%** against a 25% bar |
| Direct tests | `WorktreeView.test.ts`, `WorktreeController.test.ts`, `WorktreeController.state.test.ts`, `controller/dialogChannels.test.ts`, `worktreeView/actionNotices.test.ts`, `worktreeTreeView.test.ts`, `WorktreeContextMenu.test.ts` — **510 cases** |
| Why now | Change C of the user's standing goal |

## Decisions

### D1: Target structure

**A collaborator per responsibility; both classes stay as facades.** This is the remedy
`asm refactor shape` names for `god-class`, and change A already proved it here
specifically: `foldState.ts` and `keyboardNav.ts` came out of the view, and
`dialogChannels.ts` out of the controller, on exactly this seam.

```
src/webview/worktree/
  WorktreeController.ts             # facade: constructs the six collaborators, holds the view, routes
  WorktreeView.ts                   # facade: constructs the five collaborators, holds the element
  controller/
    controllerTypes.ts              # WorktreeControllerDeps and the state shape it patches
    createFlow.ts                   # opening a create, and the nine host answers one form waits on
    agentActions.ts                 # launching, resuming, and the pane attribution it reports
    mutationResults.ts              # what a finished mutation says, and the removal assess before it
    treeReconcile.ts                # a tree arriving, reconciled against what is drawn
    visibility.ts                   # whether the panel is shown, and what that subscribes to
  worktreeView/
    viewTypes.ts                    # WorktreeViewDeps and WorktreeViewData
    viewDialogs.ts                  # every dialog the view opens, and the one that is open
    ceilingClock.ts                 # when a row next crosses the confidence ceiling
    viewFilter.ts                   # the query, the idle tail, and the render cap
    treeRender.ts                   # the render pass, its signature and its per-worktree memo
    actionNotices/summaries.ts      # the sentences a result is summarised into
```

Left in the two facades on purpose: the element, the collaborator construction, the
public methods the panel calls, and `dispose`. That is a facade, which is what the
`god-class` remedy asks for.

| # | Cluster | Source | LOC | Task |
|---|---|---|---|---|
| 1 | `controllerTypes.ts` | Controller 63-106 | ~60 | `3_1` |
| 2 | `visibility.ts` | Controller 294-297, 805-878 | ~90 | `3_2` |
| 3 | `agentActions.ts` | Controller 390, 1016-1051, 1062-1208, 1823-1847 | ~300 | `3_3` |
| 4 | `mutationResults.ts` | Controller 387, 994-1015, 1472-1613, 1659-1676, 1786-1822 | ~290 | `3_4` |
| 5 | `createFlow.ts` — **plus the four answer caches** at 302-337 | Controller 302-359, 900-993, 1209-1471 | ~400 | `3_5` |
| 6 | `treeReconcile.ts` | Controller 298, 432-446, 879-890, 1052-1061, 1614-1630, 1692-1785, 1848-1858 | ~200 | `3_6` |
| 7 | `viewTypes.ts` | View 84-197 | ~125 | `3_7` |
| 8 | `ceilingClock.ts` | View 326-330, 514-579, 1144-1178 | ~110 | `3_8` |
| 9 | `viewDialogs.ts` | View 594-758 | ~170 | `3_9` |
| 10 | `viewFilter.ts` | View 226, 580-593, 872-889, 1082-1143 | ~110 | `3_10` |
| 11 | `treeRender.ts` — the pass and the listing | View 360-420, 890-1081, 1179-1287 | ~363 | `3_11` |
| 12 | `actionNotices/summaries.ts` | actionNotices 476-622 | ~150 | `3_12` |
| 13 | `worktreeRow.ts` — the per-worktree row builder | View 1288-1485 | ~197 | `3_13` |

Line ranges are the map at `914dbb2b` and shift as tasks land; the cluster's NAME binds,
not its numbers.

Deliberately not cut: `worktreeView/keyboardNav.ts` (272), `worktreeView/foldState.ts`
(198), `controller/dialogChannels.ts` (110) — already under 500 and outside the goal.

**`treeRender` needed a second cut**, found by the plan attack: the first draft's three
spans total **560** lines, over the Boundary before a single import. The row builder —
`worktreeMemoKey`, `renderWorktree`, `buildWorktree` at `:1288-1485`, 197 lines — is a
subject of its own and becomes `worktreeRow.ts` (`3_13`), leaving the pass at ~363.

**`createFlow` needed a wider boundary**, same source: the first draft named only
`probeSeq`, `refsToken` and `pendingCreate`, but the create's four answer caches live at
`:302-337` and are reconciled at `:1699-1728`. They come with it. Two writers stay
outside by design and are named here so the build does not rediscover them: visibility
clears `pendingCreate` at `:805-815`, and tree reconciliation mutates it and calls
`openPendingCreate` at `:1732-1748`. Both reach it through the collaborator's own
accessors — never a second record, which is OBL-3's defeater.

`3_9` also owns the three files' one genuine cycle: the create dialog's dep object is
built by the controller and consumed by the view. D5 pins its whole shape, so it moves as
one contract or not at all.

#### D1a: Both directions, every capturing task

A cluster's boundary is assumed WRONG until its free names have been enumerated in BOTH
directions:

- **A — what the block reads from outside it.** Every identifier the moved lines use and
  do not declare, INCLUDING imported constants and types. Compile the block in isolation
  and read the `TS2304` list; never do this by eye. For a class member the equivalent is
  every `this.` reference the block makes.
- **B — what the rest reads from the block.** `grep -n '\bname\b'` across the source for
  every member the block declares.

Carried from change A, where skipping direction A's constants cost a task.

#### D5: Members the suites reach into, which therefore cannot move

The first draft claimed three. The plan attack found **sixteen**, and I re-verified the
shape of the claim by hand: `WorktreeController.test.ts` alone reaches
`createDialogDeps()` 39 times and reads six distinct private controller fields. OBL-4
forbids editing any of it, so every name below is pinned — its identity, its owner, and
the object path that reaches it.

| Pinned path | Suite anchor | Constrains |
|---|---|---|
| `view.rowMemo` is a `Map` whose `.size` grows and returns to 0 | `WorktreeView.test.ts:2250-2272` | `3_11` |
| `controller.dialogChannels` | `WorktreeController.test.ts:82` | `3_5` |
| `controller.view.deps.actions` | `WorktreeController.test.ts:87` | `3_7`, `3_9` |
| `controller.provisionOffers` | `:1784`, `:2329`, `:2431`, `:2695`, `:2711` | `3_5` |
| `controller.repoRefs` | `:1792` | `3_5` |
| `controller.createDefaults` | `:2328` | `3_5` |
| `controller.actionResults` | `:2492`, `:2744`, `:3595`-`:3995` (13 sites) | `3_4` |
| `view.deps.createOpening`, `.onCreateClosed` | `:677-687`, `:2302-2310` | `3_5`, `3_7`, `3_9` |
| `view.deps.onCreateSubmit` | 15 sites, `:703`-`:2273` | `3_5`, `3_7`, `3_9` |
| `view.deps.onCreateForRepo` | `:2510-2511` | `3_5`, `3_7`, `3_9` |
| `createDialogDeps().onSelectionChange` | `:955-960`, `:999-1008`, `:2258-2262`, `:4194-4204`, `:4265-4269` | `3_5`, `3_9` |
| `createDialogDeps().onAuthorizeDebris` / `.bindDebrisAuthorization` | `:2027-2031`, `:2046-2052` | `3_5`, `3_9` |
| `createDialogDeps().onPickDestination` / `.bindDestinationPicked` | `:2085-2089`, `:2160-2238` | `3_5`, `3_9` |
| `createDialogDeps().onSetupStepAsk` / `.onCopyFileAsk` | `:2102-2112`, `:2131-2141` | `3_5`, `3_9` |
| `createDialogDeps().repos`, `.onProvisionSwitch`, and the whole returned contract | `:2598-2599`, `:3402-3407`, `:4170-4235`; `controller/dialogChannels.test.ts:43-55` | `3_5`, `3_9` |
| Result/action callbacks `onRetrySetup`, `onViewSetupOutput`, `onRetryAction`, `onDismissActionResult`, `onPrune`, `onForceRemove`; and the facade methods `view.openLaunchDialog`, `view.openRemoveReport` | `:2907-2916`, `:3236-3325`, `:3730-3739`, `:4031-4035`, `:4066-4071` | `3_4`, `3_7`, `3_9` |

Read as one rule: **the object graph is the contract.** `3_7` may move the TYPE of
`WorktreeViewDeps` but not the `deps` field; `3_5` may move the create flow's logic but
not the four caches hanging off the controller; `3_9` may move dialog construction but
not the facade methods that open them. A cut that would rename or relocate any of these
is the wrong cut, not a reason to edit a suite.

### D2: Preservation proof

| | |
|---|---|
| Suite command | `pnpm exec vitest run src/webview/worktree/WorktreeView.test.ts src/webview/worktree/WorktreeController.test.ts src/webview/worktree/WorktreeController.state.test.ts src/webview/worktree/controller/dialogChannels.test.ts src/webview/worktree/worktreeView/actionNotices.test.ts src/webview/worktree/worktreeTreeView.test.ts src/webview/worktree/WorktreeContextMenu.test.ts` |
| Baseline | **510** tests green at `914dbb2b`, type-check clean |

Rules every task obeys:

- Baseline green after every task. A drop stops the task: revert, never adjust a test.
- Re-run `asm refactor shape` on the source AND every destination after each cut.
- Any module reaching 500 lines is split before the task is ticked, not deferred.
- The same step failing twice means the seam is wrong — stop and re-plan.

### D3: Expected test moves

**None.** Every suite imports the two classes from their current paths and drives them
through their public surfaces, plus the three reach-ins D5 pins. This is OBL-4.

### D4: Allowed non-pure transformations

- Every task: a private field becoming a collaborator's own state and a `this.x` read
  becoming an accessor call, and a block comment moving with the code it describes.
- Every task: an unused import left by a cut is trimmed in that task.
- `3_1`, `3_7`: moved types are re-exported from their current modules, so no importer
  changes.

Anything beyond this list is a design change.

## Obligation ledger

| id | claim | semantics | defeater | witness | disposition |
|---|---|---|---|---|---|
| OBL-1 | the row memo is still emptied on an empty listing and on dispose | after a listing that draws no rows, and after `dispose()`, `view.rowMemo.size` is 0 | `treeRender.ts` keeps its own memo privately and `WorktreeView.rowMemo` becomes a stale field nothing clears, so the suite reads 0 from a map the render no longer uses and the real memo leaks every row | `X: pnpm exec vitest run src/webview/worktree/WorktreeView.test.ts` — `:2250-2272`: `:2250-2267` asserts `size` grows and returns to 0 across three empty-listing cycles (catching removal of the deletion at `WorktreeView.ts:962-965`), and `:2269-2272` asserts the same for DISPOSE (catching removal of `:721-722`). The first draft cited only the former | supported |
| OBL-2 | every armed notice timer is cancelled | a dropped result's dismiss timer handle is gone, not merely left with nothing to do; dispose clears all of them | `actionNotices/summaries.ts` (`3_12`) takes the arming with the sentences, splitting the timer map from `dispose` | `X: pnpm exec vitest run src/webview/worktree/worktreeView/actionNotices.test.ts` — the suite asserts the surviving KEY and the live timer count, which is the half "nothing ran" cannot see (`:57-70`, `:82-90`) | supported |
| OBL-3 | one pending create still gates on all its outstanding repositories | a create asked against N repositories opens the form once, after the Nth answer — never on the first | `createFlow.ts` (`3_5`) is handed `pendingCreate` by value rather than owning it, so the controller's copy and the collaborator's diverge and `outstanding.delete` is applied to a set nobody reads | `X: pnpm exec vitest run src/webview/worktree/WorktreeController.test.ts` — `:1456-1479` defines two repositories; `:1650-1662` answers A, asserts the form CLOSED, answers B, then asserts it open naming both; `:1664-1671` repeats in the reverse order. Catches divergence from the gate at `WorktreeController.ts:1409-1429` | supported |
| OBL-4 | the inherited regression net is not weakened | the seven suites are byte-identical to their state at `914dbb2b` | a case is relaxed to accommodate a moved member — D5's three reach-ins are the ones most likely to tempt it | `X: git diff --exit-code 914dbb2b -- src/webview/worktree/WorktreeView.test.ts src/webview/worktree/WorktreeController.test.ts src/webview/worktree/WorktreeController.state.test.ts src/webview/worktree/controller/dialogChannels.test.ts src/webview/worktree/worktreeView/actionNotices.test.ts src/webview/worktree/worktreeTreeView.test.ts src/webview/worktree/WorktreeContextMenu.test.ts && git diff --cached --exit-code 914dbb2b -- src/webview/worktree/WorktreeView.test.ts src/webview/worktree/WorktreeController.test.ts src/webview/worktree/WorktreeController.state.test.ts src/webview/worktree/controller/dialogChannels.test.ts src/webview/worktree/worktreeView/actionNotices.test.ts src/webview/worktree/worktreeTreeView.test.ts src/webview/worktree/WorktreeContextMenu.test.ts` — BOTH forms, `&&`-joined: `git diff --exit-code <base> -- <paths> && git diff --cached --exit-code <base> -- <paths>`. The single working-tree form alone exits 0 when a weakened test is STAGED and the working copy restored from base; change A recorded the opposite and was wrong, re-verified by experiment on 2026-09-07 | supported |
| OBL-5 | the facades hold no reference to moved state | after `3_6`, `3_11` and `3_13`, neither class declares a field in the frozen inventory below, under that name OR an alias — the D5 pins excepted, which stay by contract | a field is duplicated rather than moved, leaving two owners that drift — the concrete form OBL-1 and OBL-3 both name. A name-only grep cannot see an alias, so the inventory is paired with a size check | `X: the executable check below` | supported |

### Frozen inventory for OBL-5

Checked by TWO runnable commands rather than an unspecified grep — the plan attack refused
the earlier wording:

```sh
# controller fields every task moves — must print nothing
grep -nE '^\s+(private |readonly |private readonly )?(probeSeq|refsToken|assessSeq|bodyShown|refreshing|awaitingLaunchTargets|pendingCreate)\b' \
  src/webview/worktree/WorktreeController.ts
# view fields every task moves — must print nothing
grep -nE '^\s+(private |readonly |private readonly )?(ceilingTimer|query|signature|uncapped|rowMemoSeen)\b' \
  src/webview/worktree/WorktreeView.ts
```

`rowMemo`, `dialogChannels`, `deps`, `provisionOffers`, `repoRefs`, `createDefaults` and
`actionResults` are deliberately absent: D5 pins them in place. The inventory is paired
with each Boundary's line count — a facade still large after every collaborator moved is
holding something, whatever it is called.

## Risk Map

| Risk | Mitigation |
|---|---|
| Sixteen paths reach past the public surface, across two suites | D5 names every one and pins its shape at plan time. The first draft claimed three; the plan attack found the rest, which is the difference between a build that discovers them and one that is told |
| `treeRender.ts` was estimated at ~480 and is actually 560 | Split at plan time into `3_11` (~363) and `3_13` (~197), rather than left as an in-task contingency |
| The controller's create flow spans nine handlers over one record | They move as ONE collaborator, and OBL-3 is the row that catches it if they do not |
