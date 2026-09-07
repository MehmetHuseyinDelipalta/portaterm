## 1. `WorktreeController.ts` — a collaborator per responsibility


- [x] 3_1 Move the controller's contract out of the class that implements it — verified: pnpm exec vitest run src/webview/worktree/WorktreeView.test.ts src/webview/worktree/WorktreeController.test.ts src/webview/worktree/WorktreeController.state.test.ts src/webview/worktree/controller/dialogChannels.test.ts src/webview/worktree/worktreeView/actionNotices.test.ts src/webview/worktree/worktreeTreeView.test.ts src/webview/worktree/WorktreeContextMenu.test.ts exit 0
  - **Deps**: none
  - **Refs**: design.md D1, design.md D1a, design.md D4, design.md D5
  - **Boundary**: `src/webview/worktree/controller/controllerTypes.ts` is under 500 lines, and `src/webview/worktree/WorktreeController.ts` never grows
  - **Acceptance**:
    - Outcome: the cut lands and the 510-case net is unchanged.
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeView.test.ts src/webview/worktree/WorktreeController.test.ts src/webview/worktree/WorktreeController.state.test.ts src/webview/worktree/controller/dialogChannels.test.ts src/webview/worktree/worktreeView/actionNotices.test.ts src/webview/worktree/worktreeTreeView.test.ts src/webview/worktree/WorktreeContextMenu.test.ts
  - **Plan**:
    1. Enumerate free names in both directions (D1a): compile the block in isolation and read the `TS2304` list for direction A — for a class member, every `this.` reference it makes — then `grep -n` every member it declares across `src/webview/worktree/WorktreeController.ts` for direction B.
    2. Create `src/webview/worktree/controller/controllerTypes.ts` with the `WorktreeControllerDeps` and the state shape it patches, moving them out of `src/webview/worktree/WorktreeController.ts`; a `this.x` read becomes an accessor call and its negation sites are checked by hand (D4).
    3. Trim the imports the cut leaves unused in `src/webview/worktree/WorktreeController.ts`.
    4. Run `bun run asm refactor shape src/webview/worktree/WorktreeController.ts src/webview/worktree/controller/controllerTypes.ts` and split `src/webview/worktree/controller/controllerTypes.ts` again if it fires.
    5. Re-export the moved types from `src/webview/worktree/WorktreeController.ts` so no importer changes (D4).

- [x] 3_2 Extract whether the panel is shown — verified: pnpm exec vitest run src/webview/worktree/WorktreeView.test.ts src/webview/worktree/WorktreeController.test.ts src/webview/worktree/WorktreeController.state.test.ts src/webview/worktree/controller/dialogChannels.test.ts src/webview/worktree/worktreeView/actionNotices.test.ts src/webview/worktree/worktreeTreeView.test.ts src/webview/worktree/WorktreeContextMenu.test.ts exit 0
  - **Deps**: 3_1
  - **Refs**: design.md D1, design.md D1a, design.md D4, design.md D5
  - **Boundary**: `src/webview/worktree/controller/visibility.ts` is under 500 lines, and `src/webview/worktree/WorktreeController.ts` never grows
  - **Acceptance**:
    - Outcome: the cut lands and the 510-case net is unchanged.
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeView.test.ts src/webview/worktree/WorktreeController.test.ts src/webview/worktree/WorktreeController.state.test.ts src/webview/worktree/controller/dialogChannels.test.ts src/webview/worktree/worktreeView/actionNotices.test.ts src/webview/worktree/worktreeTreeView.test.ts src/webview/worktree/WorktreeContextMenu.test.ts
  - **Plan**:
    1. Enumerate free names in both directions (D1a): compile the block in isolation and read the `TS2304` list for direction A — for a class member, every `this.` reference it makes — then `grep -n` every member it declares across `src/webview/worktree/WorktreeController.ts` for direction B.
    2. Create `src/webview/worktree/controller/visibility.ts` with the visibility (`bodyShown`, `setVisible`, `revalidateVisibility`, `applySubscription`), moving them out of `src/webview/worktree/WorktreeController.ts`; a `this.x` read becomes an accessor call and its negation sites are checked by hand (D4).
    3. Trim the imports the cut leaves unused in `src/webview/worktree/WorktreeController.ts`.
    4. Run `bun run asm refactor shape src/webview/worktree/WorktreeController.ts src/webview/worktree/controller/visibility.ts` and split `src/webview/worktree/controller/visibility.ts` again if it fires.

- [x] 3_3 Extract launching, resuming and pane attribution — verified: pnpm exec vitest run src/webview/worktree/WorktreeView.test.ts src/webview/worktree/WorktreeController.test.ts src/webview/worktree/WorktreeController.state.test.ts src/webview/worktree/controller/dialogChannels.test.ts src/webview/worktree/worktreeView/actionNotices.test.ts src/webview/worktree/worktreeTreeView.test.ts src/webview/worktree/WorktreeContextMenu.test.ts exit 0
  - **Deps**: 3_2
  - **Refs**: design.md D1, design.md D1a, design.md D4, design.md D5
  - **Boundary**: `src/webview/worktree/controller/agentActions.ts` is under 500 lines, and `src/webview/worktree/WorktreeController.ts` never grows
  - **Acceptance**:
    - Outcome: the cut lands and the 510-case net is unchanged.
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeView.test.ts src/webview/worktree/WorktreeController.test.ts src/webview/worktree/WorktreeController.state.test.ts src/webview/worktree/controller/dialogChannels.test.ts src/webview/worktree/worktreeView/actionNotices.test.ts src/webview/worktree/worktreeTreeView.test.ts src/webview/worktree/WorktreeContextMenu.test.ts
  - **Plan**:
    1. Enumerate free names in both directions (D1a): compile the block in isolation and read the `TS2304` list for direction A — for a class member, every `this.` reference it makes — then `grep -n` every member it declares across `src/webview/worktree/WorktreeController.ts` for direction B.
    2. Create `src/webview/worktree/controller/agentActions.ts` with the agent actions (`openLaunchFor`, `launchOfferFor`, `captureMenuTarget`, `resumeHere`, `buildAttribution`, `emitAttribution`, `worktreeIdOf`, `handleLaunchTargets`, `syncLaunchActions`, `awaitingLaunchTargets`, `requestRoster`, `activateAgent`, `activateSubagentParent`), moving them out of `src/webview/worktree/WorktreeController.ts`; a `this.x` read becomes an accessor call and its negation sites are checked by hand (D4).
    3. Trim the imports the cut leaves unused in `src/webview/worktree/WorktreeController.ts`.
    4. Run `bun run asm refactor shape src/webview/worktree/WorktreeController.ts src/webview/worktree/controller/agentActions.ts` and split `src/webview/worktree/controller/agentActions.ts` again if it fires.

- [ ] 3_4 Extract what a finished mutation says
  - **Deps**: 3_3
  - **Refs**: design.md D1, design.md D1a, design.md D4, design.md D5
  - **Boundary**: `src/webview/worktree/controller/mutationResults.ts` is under 500 lines, and `src/webview/worktree/WorktreeController.ts` never grows
  - **Acceptance**:
    - Outcome: the cut lands and the 510-case net is unchanged.
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeView.test.ts src/webview/worktree/WorktreeController.test.ts src/webview/worktree/WorktreeController.state.test.ts src/webview/worktree/controller/dialogChannels.test.ts src/webview/worktree/worktreeView/actionNotices.test.ts src/webview/worktree/worktreeTreeView.test.ts src/webview/worktree/WorktreeContextMenu.test.ts
  - **Plan**:
    1. Enumerate free names in both directions (D1a): compile the block in isolation and read the `TS2304` list for direction A — for a class member, every `this.` reference it makes — then `grep -n` every member it declares across `src/webview/worktree/WorktreeController.ts` for direction B.
    2. Create `src/webview/worktree/controller/mutationResults.ts` with the mutation results (`assessSeq`, `confirmPrune`, `handleMutationResult`, `handleProvisionResult`, `beginAssess`, `askRemoval`, `showActionResult`, `handleRemoveAssessment`, `reportScopeCleared`, `stageScopeCleared`, `rescope`), moving them out of `src/webview/worktree/WorktreeController.ts`; a `this.x` read becomes an accessor call and its negation sites are checked by hand (D4).
    3. Trim the imports the cut leaves unused in `src/webview/worktree/WorktreeController.ts`.
    4. Run `bun run asm refactor shape src/webview/worktree/WorktreeController.ts src/webview/worktree/controller/mutationResults.ts` and split `src/webview/worktree/controller/mutationResults.ts` again if it fires.

- [ ] 3_5 Extract opening a create and the answers one form waits on
  - **Deps**: 3_4
  - **Refs**: design.md D1, design.md D1a, design.md D4, design.md D5, design.md § Obligation ledger
  - **Boundary**: `src/webview/worktree/controller/createFlow.ts` is under 500 lines, and `src/webview/worktree/WorktreeController.ts` never grows
  - **Acceptance**:
    - Outcome: the cut lands and the 510-case net is unchanged.
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeView.test.ts src/webview/worktree/WorktreeController.test.ts src/webview/worktree/WorktreeController.state.test.ts src/webview/worktree/controller/dialogChannels.test.ts src/webview/worktree/worktreeView/actionNotices.test.ts src/webview/worktree/worktreeTreeView.test.ts src/webview/worktree/WorktreeContextMenu.test.ts
  - **Plan**:
    1. Enumerate free names in both directions (D1a): compile the block in isolation and read the `TS2304` list for direction A — for a class member, every `this.` reference it makes — then `grep -n` every member it declares across `src/webview/worktree/WorktreeController.ts` for direction B.
    2. Create `src/webview/worktree/controller/createFlow.ts` with the the create flow (`probeSeq`, `refsToken`, `pendingCreate`, the four answer caches at `:302-337`, `openCreateFor`, `openCreateForRepo`, `openCreate`, `createRepos`, `labelForRepo`, `openPendingCreate`, and the nine host-answer handlers), moving them out of `src/webview/worktree/WorktreeController.ts`; a `this.x` read becomes an accessor call and its negation sites are checked by hand (D4).
    3. Trim the imports the cut leaves unused in `src/webview/worktree/WorktreeController.ts`.
    4. Run `bun run asm refactor shape src/webview/worktree/WorktreeController.ts src/webview/worktree/controller/createFlow.ts` and split `src/webview/worktree/controller/createFlow.ts` again if it fires.
    5. `pendingCreate` is MOVED, not copied — two records is OBL-3's defeater. Its two outside writers stay outside and reach it through the collaborator's accessors: visibility clears it at `src/webview/worktree/WorktreeController.ts:805-815`, tree reconciliation mutates it and calls `openPendingCreate` at `:1732-1748`.
    6. `provisionOffers`, `repoRefs`, `createDefaults` and `dialogChannels` stay as controller FIELDS — five suites read them through the instance (D5).

- [ ] 3_6 Extract a tree arriving
  - **Deps**: 3_5
  - **Refs**: design.md D1, design.md D1a, design.md D4, design.md D5
  - **Boundary**: `src/webview/worktree/controller/treeReconcile.ts` is under 500 lines, and `src/webview/worktree/WorktreeController.ts` never grows
  - **Acceptance**:
    - Outcome: the cut lands and the 510-case net is unchanged.
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeView.test.ts src/webview/worktree/WorktreeController.test.ts src/webview/worktree/WorktreeController.state.test.ts src/webview/worktree/controller/dialogChannels.test.ts src/webview/worktree/worktreeView/actionNotices.test.ts src/webview/worktree/worktreeTreeView.test.ts src/webview/worktree/WorktreeContextMenu.test.ts
  - **Plan**:
    1. Enumerate free names in both directions (D1a): compile the block in isolation and read the `TS2304` list for direction A — for a class member, every `this.` reference it makes — then `grep -n` every member it declares across `src/webview/worktree/WorktreeController.ts` for direction B.
    2. Create `src/webview/worktree/controller/treeReconcile.ts` with the tree reconciliation (`refreshing`, `repoFor`, `requestRefresh`, `infoOf`, `generationOf`, `handleTreeResponse`, `reconcile`, `push`), moving them out of `src/webview/worktree/WorktreeController.ts`; a `this.x` read becomes an accessor call and its negation sites are checked by hand (D4).
    3. Trim the imports the cut leaves unused in `src/webview/worktree/WorktreeController.ts`.
    4. Run `bun run asm refactor shape src/webview/worktree/WorktreeController.ts src/webview/worktree/controller/treeReconcile.ts` and split `src/webview/worktree/controller/treeReconcile.ts` again if it fires.
    5. Record `wc -l` for `src/webview/worktree/WorktreeController.ts` and every file under `src/webview/worktree/controller/` in workflow.md Notes. Any file at 500 or above is split before ticking.
    6. Confirm OBL-5 by running design.md § Frozen inventory's controller command verbatim; it must print nothing.
    7. Run design.md OBL-4's BOTH diff forms, `&&`-joined.


## 2. `WorktreeView.ts` — a collaborator per responsibility


- [ ] 3_7 Move the view's contract out of the class that implements it
  - **Deps**: none
  - **Refs**: design.md D1, design.md D1a, design.md D4, design.md D5
  - **Boundary**: `src/webview/worktree/worktreeView/viewTypes.ts` is under 500 lines, and `src/webview/worktree/WorktreeView.ts` never grows
  - **Acceptance**:
    - Outcome: the cut lands and the 510-case net is unchanged.
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeView.test.ts src/webview/worktree/WorktreeController.test.ts src/webview/worktree/WorktreeController.state.test.ts src/webview/worktree/controller/dialogChannels.test.ts src/webview/worktree/worktreeView/actionNotices.test.ts src/webview/worktree/worktreeTreeView.test.ts src/webview/worktree/WorktreeContextMenu.test.ts
  - **Plan**:
    1. Enumerate free names in both directions (D1a): compile the block in isolation and read the `TS2304` list for direction A — for a class member, every `this.` reference it makes — then `grep -n` every member it declares across `src/webview/worktree/WorktreeView.ts` for direction B.
    2. Create `src/webview/worktree/worktreeView/viewTypes.ts` with the `WorktreeViewDeps` and `WorktreeViewData`, moving them out of `src/webview/worktree/WorktreeView.ts`; a `this.x` read becomes an accessor call and its negation sites are checked by hand (D4).
    3. Trim the imports the cut leaves unused in `src/webview/worktree/WorktreeView.ts`.
    4. Run `bun run asm refactor shape src/webview/worktree/WorktreeView.ts src/webview/worktree/worktreeView/viewTypes.ts` and split `src/webview/worktree/worktreeView/viewTypes.ts` again if it fires.
    5. Move the TYPE only: `WorktreeController.test.ts:87` reads `view.deps.actions`, so the `deps` FIELD stays on the class (D5). Re-export both types from `src/webview/worktree/WorktreeView.ts`.

- [ ] 3_8 Extract when a row next crosses the confidence ceiling
  - **Deps**: 3_7
  - **Refs**: design.md D1, design.md D1a, design.md D4, design.md D5
  - **Boundary**: `src/webview/worktree/worktreeView/ceilingClock.ts` is under 500 lines, and `src/webview/worktree/WorktreeView.ts` never grows
  - **Acceptance**:
    - Outcome: the cut lands and the 510-case net is unchanged.
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeView.test.ts src/webview/worktree/WorktreeController.test.ts src/webview/worktree/WorktreeController.state.test.ts src/webview/worktree/controller/dialogChannels.test.ts src/webview/worktree/worktreeView/actionNotices.test.ts src/webview/worktree/worktreeTreeView.test.ts src/webview/worktree/WorktreeContextMenu.test.ts
  - **Plan**:
    1. Enumerate free names in both directions (D1a): compile the block in isolation and read the `TS2304` list for direction A — for a class member, every `this.` reference it makes — then `grep -n` every member it declares across `src/webview/worktree/WorktreeView.ts` for direction B.
    2. Create `src/webview/worktree/worktreeView/ceilingClock.ts` with the the ceiling clock (`ceilingTimer`, `now`, `armCeiling`, `nextCeilingCrossing`, `strongestConfidenceTip`), moving them out of `src/webview/worktree/WorktreeView.ts`; a `this.x` read becomes an accessor call and its negation sites are checked by hand (D4).
    3. Trim the imports the cut leaves unused in `src/webview/worktree/WorktreeView.ts`.
    4. Run `bun run asm refactor shape src/webview/worktree/WorktreeView.ts src/webview/worktree/worktreeView/ceilingClock.ts` and split `src/webview/worktree/worktreeView/ceilingClock.ts` again if it fires.
    5. `dispose` stays on the class and must still clear the timer through the module.

- [ ] 3_9 Extract every dialog the view opens
  - **Deps**: 3_8
  - **Refs**: design.md D1, design.md D1a, design.md D4, design.md D5
  - **Boundary**: `src/webview/worktree/worktreeView/viewDialogs.ts` is under 500 lines, and `src/webview/worktree/WorktreeView.ts` never grows
  - **Acceptance**:
    - Outcome: the cut lands and the 510-case net is unchanged.
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeView.test.ts src/webview/worktree/WorktreeController.test.ts src/webview/worktree/WorktreeController.state.test.ts src/webview/worktree/controller/dialogChannels.test.ts src/webview/worktree/worktreeView/actionNotices.test.ts src/webview/worktree/worktreeTreeView.test.ts src/webview/worktree/WorktreeContextMenu.test.ts
  - **Plan**:
    1. Enumerate free names in both directions (D1a): compile the block in isolation and read the `TS2304` list for direction A — for a class member, every `this.` reference it makes — then `grep -n` every member it declares across `src/webview/worktree/WorktreeView.ts` for direction B.
    2. Create `src/webview/worktree/worktreeView/viewDialogs.ts` with the the dialogs (`closeDialog`, `beginDialog`, `openCreateDialog`, `openLaunchDialog`, `openPruneDialog`, `openRemoveDialog`, `openRemoveReport`), moving them out of `src/webview/worktree/WorktreeView.ts`; a `this.x` read becomes an accessor call and its negation sites are checked by hand (D4).
    3. Trim the imports the cut leaves unused in `src/webview/worktree/WorktreeView.ts`.
    4. Run `bun run asm refactor shape src/webview/worktree/WorktreeView.ts src/webview/worktree/worktreeView/viewDialogs.ts` and split `src/webview/worktree/worktreeView/viewDialogs.ts` again if it fires.

- [ ] 3_10 Extract the query, the idle tail and the render cap
  - **Deps**: 3_9
  - **Refs**: design.md D1, design.md D1a, design.md D4, design.md D5
  - **Boundary**: `src/webview/worktree/worktreeView/viewFilter.ts` is under 500 lines, and `src/webview/worktree/WorktreeView.ts` never grows
  - **Acceptance**:
    - Outcome: the cut lands and the 510-case net is unchanged.
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeView.test.ts src/webview/worktree/WorktreeController.test.ts src/webview/worktree/WorktreeController.state.test.ts src/webview/worktree/controller/dialogChannels.test.ts src/webview/worktree/worktreeView/actionNotices.test.ts src/webview/worktree/worktreeTreeView.test.ts src/webview/worktree/WorktreeContextMenu.test.ts
  - **Plan**:
    1. Enumerate free names in both directions (D1a): compile the block in isolation and read the `TS2304` list for direction A — for a class member, every `this.` reference it makes — then `grep -n` every member it declares across `src/webview/worktree/WorktreeView.ts` for direction B.
    2. Create `src/webview/worktree/worktreeView/viewFilter.ts` with the the filter (`query`, `uncapped`, `setQuery`, `matches`, `isIdle`, `isIdleIn`, `toggleIdleTail`, `idleTailFolded`, `shownWorktrees`), moving them out of `src/webview/worktree/WorktreeView.ts`; a `this.x` read becomes an accessor call and its negation sites are checked by hand (D4).
    3. Trim the imports the cut leaves unused in `src/webview/worktree/WorktreeView.ts`.
    4. Run `bun run asm refactor shape src/webview/worktree/WorktreeView.ts src/webview/worktree/worktreeView/viewFilter.ts` and split `src/webview/worktree/worktreeView/viewFilter.ts` again if it fires.

- [ ] 3_11 Extract the render pass and its memo
  - **Deps**: 3_10
  - **Refs**: design.md D1, design.md D1a, design.md D4, design.md D5, design.md § Obligation ledger
  - **Boundary**: `src/webview/worktree/worktreeView/treeRender.ts` is under 500 lines, and `src/webview/worktree/WorktreeView.ts` never grows
  - **Acceptance**:
    - Outcome: the cut lands and the 510-case net is unchanged.
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeView.test.ts src/webview/worktree/WorktreeController.test.ts src/webview/worktree/WorktreeController.state.test.ts src/webview/worktree/controller/dialogChannels.test.ts src/webview/worktree/worktreeView/actionNotices.test.ts src/webview/worktree/worktreeTreeView.test.ts src/webview/worktree/WorktreeContextMenu.test.ts
  - **Plan**:
    1. Enumerate free names in both directions (D1a): compile the block in isolation and read the `TS2304` list for direction A — for a class member, every `this.` reference it makes — then `grep -n` every member it declares across `src/webview/worktree/WorktreeView.ts` for direction B.
    2. Create `src/webview/worktree/worktreeView/treeRender.ts` with the the render pass (`signature`, `applyAt`, `repaint`, `render`, `restoreFocus`, `renderListing`, `renderListingInner`, `renderedWorktreeIds`, `renderedWorktreeRows`, `renderRepo`) — NOT the row builder, which is `3_13`, moving them out of `src/webview/worktree/WorktreeView.ts`; a `this.x` read becomes an accessor call and its negation sites are checked by hand (D4).
    3. Trim the imports the cut leaves unused in `src/webview/worktree/WorktreeView.ts`.
    4. Run `bun run asm refactor shape src/webview/worktree/WorktreeView.ts src/webview/worktree/worktreeView/treeRender.ts` and split `src/webview/worktree/worktreeView/treeRender.ts` again if it fires.
    5. `rowMemo` stays a `Map` FIELD on `WorktreeView` — `WorktreeView.test.ts:2250-2272` reads it on BOTH the empty-listing and the dispose path, and OBL-4 forbids editing that (D5, OBL-1).


## 3. `actionNotices.ts` — the sentences


- [ ] 3_12 Extract the sentences a result is summarised into
  - **Deps**: none
  - **Refs**: design.md D1, design.md D1a, design.md D4, design.md D5
  - **Boundary**: `src/webview/worktree/worktreeView/actionNotices/summaries.ts` is under 500 lines, and `src/webview/worktree/worktreeView/actionNotices.ts` never grows
  - **Acceptance**:
    - Outcome: the cut lands and the 510-case net is unchanged.
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeView.test.ts src/webview/worktree/WorktreeController.test.ts src/webview/worktree/WorktreeController.state.test.ts src/webview/worktree/controller/dialogChannels.test.ts src/webview/worktree/worktreeView/actionNotices.test.ts src/webview/worktree/worktreeTreeView.test.ts src/webview/worktree/WorktreeContextMenu.test.ts
  - **Plan**:
    1. Enumerate free names in both directions (D1a): compile the block in isolation and read the `TS2304` list for direction A — for a class member, every `this.` reference it makes — then `grep -n` every member it declares across `src/webview/worktree/worktreeView/actionNotices.ts` for direction B.
    2. Create `src/webview/worktree/worktreeView/actionNotices/summaries.ts` with the the summaries (`portSummary`, `provisionSummary` and the sentence builders beside them), moving them out of `src/webview/worktree/worktreeView/actionNotices.ts`; a `this.x` read becomes an accessor call and its negation sites are checked by hand (D4).
    3. Trim the imports the cut leaves unused in `src/webview/worktree/worktreeView/actionNotices.ts`.
    4. Run `bun run asm refactor shape src/webview/worktree/worktreeView/actionNotices.ts src/webview/worktree/worktreeView/actionNotices/summaries.ts` and split `src/webview/worktree/worktreeView/actionNotices/summaries.ts` again if it fires.
    5. The timer map and `dispose` stay in `src/webview/worktree/worktreeView/actionNotices.ts` — separating them is OBL-2's defeater.

- [ ] 3_13 Extract the per-worktree row builder
  - **Deps**: 3_11
  - **Refs**: design.md D1, design.md D1a, design.md D4, design.md D5, design.md § Obligation ledger
  - **Boundary**: `src/webview/worktree/WorktreeView.ts` and every file under `src/webview/worktree/worktreeView/` is under 500 lines
  - **Acceptance**:
    - Outcome: the cut lands and the 510-case net is unchanged.
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeView.test.ts src/webview/worktree/WorktreeController.test.ts src/webview/worktree/WorktreeController.state.test.ts src/webview/worktree/controller/dialogChannels.test.ts src/webview/worktree/worktreeView/actionNotices.test.ts src/webview/worktree/worktreeTreeView.test.ts src/webview/worktree/WorktreeContextMenu.test.ts
  - **Plan**:
    1. Enumerate free names in both directions (D1a), as in 3_11.
    2. Create `src/webview/worktree/worktreeView/worktreeRow.ts` with `worktreeMemoKey`, `renderWorktree` and `buildWorktree`, moving them out of `src/webview/worktree/WorktreeView.ts`.
    3. The memo KEY must still cover every field the row's renderers and their listeners read, including the clock-derived strings — a key that narrows is a retained subtree that differs from a full repaint.
    4. Trim the imports the cut leaves unused in `src/webview/worktree/WorktreeView.ts`.
    5. Record `wc -l` for `src/webview/worktree/WorktreeView.ts` and every file under `src/webview/worktree/worktreeView/` in workflow.md Notes. Any file at 500 or above is split before ticking.
    6. Confirm OBL-5 by running design.md § Frozen inventory's view command verbatim; it must print nothing.
    7. Run design.md OBL-4's BOTH diff forms, `&&`-joined.

