# Tasks: decompose-worktree-webview

## 1. WorktreeView collaborators

- [ ] 1_1 Extract the fold state
  - **Deps**: none
  - **Refs**: design.md D1, design.md D2, design.md D4
  - **Boundary**: `pruneStaleState` and `uncapped` stay on the facade — they are not fold-only
  - **Acceptance**:
    - Outcome: no path reads the fold sets except through the collaborator.
    - Verify: command pnpm exec vitest run src/webview/worktree/worktreeView/foldState.test.ts src/webview/worktree/WorktreeView.test.ts
  - **Plan**:
    1. Create `src/webview/worktree/worktreeView/foldState.ts` exporting `FoldStateDeps` and `createFoldState(deps)`, holding `collapsed`, `expandedRows`, `seeded` and `idleSeeded`. Not `uncapped` — no method in this cluster touches it and the facade reads it directly.
    2. Move `toggleCollapsed`, `toggleKey`, `toggleRow`, `isExpanded`, `toggleIdleTail` and `idleTailFolded` out of `src/webview/worktree/WorktreeView.ts` into it, bodies verbatim.
    3. Leave `pruneStaleState` on the facade and give the collaborator a fold-only `prune(...)` it calls. The rest of that method clears `selectedWorktreeId`, calls `deps.onSelectWorktree` and reconciles `RosterRequests`, none of which is fold state.
    4. Replace every remaining direct read of `collapsed` and `expandedRows` in `src/webview/worktree/WorktreeView.ts` with a collaborator call. Sole ownership is the obligation; a retained copy is what OBL-1 catches.
    5. Add `src/webview/worktree/worktreeView/foldState.test.ts` with `// @vitest-environment jsdom` on line 1 if it touches the DOM — the pragma is per file and the existing suites' does not carry.
    6. Close with `git diff --exit-code $(git rev-parse HEAD)..HEAD -- src/types/messages.ts` against this change's base, then the tree form (OBL-5).

- [ ] 1_2 Extract keyboard navigation
  - **Deps**: 1_1
  - **Refs**: design.md D1, design.md D2, design.md D4
  - **Boundary**: no row list is captured — `navRows()` is read at the moment of the event
  - **Acceptance**:
    - Outcome: `WorktreeView` delegates every key event, and focus after a repaint lands on a live row.
    - Verify: command pnpm exec vitest run src/webview/worktree/worktreeView/keyboardNav.test.ts src/webview/worktree/WorktreeView.test.ts
  - **Plan**:
    1. Create `src/webview/worktree/worktreeView/keyboardNav.ts` exporting `KeyboardNavDeps` and `createKeyboardNav(deps)`.
    2. Move `navRows`, `syncRovingTabindex`, `keyOf`, `stampLevels`, `depthOf`, `parentOf`, `focusRow`, `onKeyDown` and `expandOrDescend` out of `src/webview/worktree/WorktreeView.ts` into it, bodies verbatim, keeping each branch of `onKeyDown` in its existing order.
    2b. Move the roving-focus half of the constructor's `focusin` delegate and of render focus restoration with them. Both use `keyOf`, `focusedKey` and `navRows`; leaving them behind splits ownership of the same state.
    3. Pass the host element and the collaborator from task 1_1 as deps; the module reads no `WorktreeViewData`.
    4. Add `src/webview/worktree/worktreeView/keyboardNav.test.ts` with `// @vitest-environment jsdom` on line 1, proving OBL-2: wire against one set of rows, REPLACE the host's children, dispatch a key, assert `document.activeElement` is among the replacement host's current rows.
    5. Close with `git diff --exit-code -- src/types/messages.ts` (OBL-5).

- [ ] 1_3 Extract the action notices
  - **Deps**: 1_2
  - **Refs**: design.md D1, design.md D2, design.md D4
  - **Boundary**: the auto-dismiss map crosses by reference; no timer is re-armed by the move
  - **Acceptance**:
    - Outcome: notice placement, naming and auto-dismiss live in one module, and a dropped result leaves no timer behind.
    - Verify: command pnpm exec vitest run src/webview/worktree/worktreeView/actionNotices.test.ts src/webview/worktree/WorktreeView.test.ts
  - **Plan**:
    1. Create `src/webview/worktree/worktreeView/actionNotices.ts` exporting `ActionNoticesDeps` and `createActionNotices(deps)`, holding the `autoDismiss` map.
    2. Move `placeResults`, `armAutoDismiss`, `pruneAutoDismiss`, `groupEndFor`, `repoAnchorFor`, `nameFor` and `buildActionNotice` out of `src/webview/worktree/WorktreeView.ts` into it, bodies verbatim.
    3. Keep `infoFor` on `WorktreeView` if the render path still calls it; pass it as a dep rather than duplicating it. Move the `autoDismiss` clearing out of `dispose` with the map.
    4. Add `src/webview/worktree/worktreeView/actionNotices.test.ts` with `// @vitest-environment jsdom` on line 1, proving OBL-3 by observing CANCELLATION: after dropping a result, assert the `autoDismiss` map holds no entry for it and `vi.getTimerCount()` has dropped. "Advance the clock and assert nothing ran" passes even when the timer leaked, because its callback finds no live result.
    5. Close with `git diff --exit-code -- src/types/messages.ts` (OBL-5).

## 2. Create dialog

- [ ] 2_1 Extract the headless draft model
  - **Deps**: 1_3
  - **Refs**: design.md D1, design.md D2, design.md D4
  - **Boundary**: `draftModel.ts` references no DOM global — no `document`, no `HTMLElement`, no event type
  - **Acceptance**:
    - Outcome: the destination derivation runs and is asserted with no DOM present.
    - Verify: command pnpm exec vitest run src/webview/worktree/createDialog/draftModel.test.ts src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. Create `src/webview/worktree/createDialog/draftModel.ts` exporting `createDraftModel(...)` over `draft`, `pathIsDerived`, `usingChosen`, `supplied`, `afterChoice`, `folderMode` and `closed`.
    2. Do NOT move the destination derivation. It reads `nameInput.value` and writes `pathInput.value`, so it cannot be headless; it stays in the DOM layer and reads the model instead. `destExact`, `activeAt` and `listOpen` are DOM presentation and stay too; `pickAsks`/`pickAsked` are request correlation and stay.
    3. Add `src/webview/worktree/createDialog/draftModel.test.ts` with NO environment pragma, so it runs under node and any DOM reference in the module throws (OBL-4).
    4. Do not edit `WorktreeCreateDialog.test.ts`; it is the regression net for this task.
    5. Close with `git diff --exit-code -- src/types/messages.ts` (OBL-5).

- [ ] 2_2 Extract the branch choice list
  - **Deps**: 2_1
  - **Refs**: design.md D1, design.md D2, design.md D4
  - **Boundary**: the choice list's ORDER and its fork-head resolution are unchanged
  - **Acceptance**:
    - Outcome: the branch choice list and its fork-head resolution live outside the dialog closure.
    - Verify: command pnpm exec vitest run src/webview/worktree/createDialog src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. Move `choice`, `choices` and `forkHead` and the functions that maintain them out of `src/webview/worktree/WorktreeCreateDialog.ts` into a sibling `src/webview/worktree/createDialog/branchChoices.ts`. `activeAt` and `listOpen` are the dropdown's presentation and stay with the DOM.
    2. Add cases to `src/webview/worktree/createDialog/draftModel.test.ts` pinning the list order and the fork-head resolution.
    3. Run `bun run asm refactor shape` on both targets and every destination; RECORD the output in workflow.md Notes rather than chasing it (design.md Risk Map).
    4. Close with `git diff --exit-code -- src/types/messages.ts` (OBL-5).
