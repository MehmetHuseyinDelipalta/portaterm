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
| 5 | `createFlow.ts` | Controller 342-359, 900-993, 1209-1471 | ~360 | `3_5` |
| 6 | `treeReconcile.ts` | Controller 298, 432-446, 879-890, 1052-1061, 1614-1630, 1692-1785, 1848-1858 | ~200 | `3_6` |
| 7 | `viewTypes.ts` | View 84-197 | ~125 | `3_7` |
| 8 | `ceilingClock.ts` | View 326-330, 514-579, 1144-1178 | ~110 | `3_8` |
| 9 | `viewDialogs.ts` | View 594-758 | ~170 | `3_9` |
| 10 | `viewFilter.ts` | View 226, 580-593, 872-889, 1082-1143 | ~110 | `3_10` |
| 11 | `treeRender.ts` | View 360-420, 890-1081, 1179-1485 | ~480 | `3_11` |
| 12 | `actionNotices/summaries.ts` | actionNotices 476-622 | ~150 | `3_12` |

Line ranges are the map at `914dbb2b` and shift as tasks land; the cluster's NAME binds,
not its numbers.

Deliberately not cut: `worktreeView/keyboardNav.ts` (272), `worktreeView/foldState.ts`
(198), `controller/dialogChannels.ts` (110) — already under 500 and outside the goal.

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

Three cases reach past the public surface. OBL-4 forbids editing them, so these names
and their shapes are pinned:

| Reach | Suite | What is pinned |
|---|---|---|
| `(view as …).rowMemo` is a `Map` and `.size` goes to 0 on empty listing and on dispose | `WorktreeView.test.ts:2250-2267` | `rowMemo` stays a `Map` FIELD on `WorktreeView`. `treeRender.ts` (`3_11`) is handed it, or assigns it back; it may not become the collaborator's private |
| `(controller as …).dialogChannels` | `WorktreeController.test.ts:82` | the field name `dialogChannels` on the controller |
| `(controller as …).view.deps.actions` | `WorktreeController.test.ts:87` | `view` on the controller, `deps` on the view, `actions` on those deps — so `viewTypes.ts` (`3_7`) moves the TYPE, never the field |

A cut that would rename or relocate any of these is the wrong cut, not a reason to edit
the suite.

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
| OBL-1 | the row memo is still emptied on an empty listing and on dispose | after a listing that draws no rows, and after `dispose()`, `view.rowMemo.size` is 0 | `treeRender.ts` keeps its own memo privately and `WorktreeView.rowMemo` becomes a stale field nothing clears, so the suite reads 0 from a map the render no longer uses and the real memo leaks every row | `X: pnpm exec vitest run src/webview/worktree/WorktreeView.test.ts` — `:2250-2267` asserts `size` both grows and returns to 0 across three cycles, so a map nothing writes fails the grow half | supported |
| OBL-2 | every armed notice timer is cancelled | a dropped result's dismiss timer handle is gone, not merely left with nothing to do; dispose clears all of them | `actionNotices/summaries.ts` (`3_12`) takes the arming with the sentences, splitting the timer map from `dispose` | `X: pnpm exec vitest run src/webview/worktree/worktreeView/actionNotices.test.ts` — the suite asserts the surviving KEY and the live timer count, which is the half "nothing ran" cannot see (`:57-70`, `:82-90`) | supported |
| OBL-3 | one pending create still gates on all its outstanding repositories | a create asked against N repositories opens the form once, after the Nth answer — never on the first | `createFlow.ts` (`3_5`) is handed `pendingCreate` by value rather than owning it, so the controller's copy and the collaborator's diverge and `outstanding.delete` is applied to a set nobody reads | `X: pnpm exec vitest run src/webview/worktree/WorktreeController.test.ts` — the create-flow cases drive `handleCreateDefaults` per repository against `WorktreeController.ts:1409-1428`, where the gate lives | supported |
| OBL-4 | the inherited regression net is not weakened | the seven suites are byte-identical to their state at `914dbb2b` | a case is relaxed to accommodate a moved member — D5's three reach-ins are the ones most likely to tempt it | `X: git diff --exit-code 914dbb2b -- src/webview/worktree/WorktreeView.test.ts src/webview/worktree/WorktreeController.test.ts src/webview/worktree/WorktreeController.state.test.ts src/webview/worktree/controller/dialogChannels.test.ts src/webview/worktree/worktreeView/actionNotices.test.ts src/webview/worktree/worktreeTreeView.test.ts src/webview/worktree/WorktreeContextMenu.test.ts` — ONE command, base against the working tree; the two-command form has a staged-edit hole verified by experiment in change A | supported |
| OBL-5 | the facades hold no reference to moved state | after `3_6` and `3_11`, neither class declares a field a task moved, except the three D5 pins | a field is duplicated rather than moved, leaving two owners that drift — the concrete form OBL-1 and OBL-3 both name | `X: the D2 suite command` plus a per-task grep recorded in the task's evidence | supported |

## Risk Map

| Risk | Mitigation |
|---|---|
| Three suites reach past the public surface | D5 names all three and pins their shapes at plan time rather than discovering them at build time |
| `treeRender.ts` is estimated at ~480, close to the bar | `3_11` splits again the moment `asm refactor shape` fires on it; the row builders are the natural second cut |
| The controller's create flow spans nine handlers over one record | They move as ONE collaborator, and OBL-3 is the row that catches it if they do not |
