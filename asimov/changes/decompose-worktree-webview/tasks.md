# Tasks: decompose-worktree-webview

## 1. WorktreeView collaborators

- [ ] 1_1 Extract the fold state
  - **Deps**: none
  - **Refs**: design.md D1, design.md D2, design.md D4
  - **Boundary**: no `Set` or `Map` is copied at the factory boundary — references only
  - **Acceptance**:
    - Outcome: `WorktreeView` no longer declares the fold sets, and a prune made after wiring is visible to the render-side read.
    - Verify: command pnpm exec vitest run src/webview/worktree/worktreeView/foldState.test.ts src/webview/worktree/WorktreeView.test.ts
  - **Plan**:
    1. Create `src/webview/worktree/worktreeView/foldState.ts` exporting `FoldStateDeps` and `createFoldState(deps)`, holding `collapsed`, `expandedRows`, `seeded`, `uncapped`, `idleSeeded` and `restored`.
    2. Move `toggleCollapsed`, `toggleKey`, `toggleRow`, `isExpanded`, `toggleIdleTail`, `idleTailFolded` and `pruneStaleState` out of `src/webview/worktree/WorktreeView.ts` into it, bodies verbatim.
    3. Grep the moved bodies for every `let` that became an accessor and confirm each reads as `x()` — including inside `!x &&`, which TypeScript does not flag (design.md D4).
    4. Add `src/webview/worktree/worktreeView/foldState.test.ts` proving OBL-1: wire the collaborator, THEN prune, then assert the render-side read reflects the prune. Build the collaborator before the mutation or the test cannot tell a reference from a copy.
    5. Close with `git diff --exit-code -- src/types/messages.ts` (OBL-5).

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
    3. Pass the host element and the collaborator from task 1_1 as deps; the module reads no `WorktreeViewData`.
    4. Add `src/webview/worktree/worktreeView/keyboardNav.test.ts` proving OBL-2: repaint between reading the rows and dispatching the key, assert focus lands on a row currently in the DOM.
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
    3. Keep `infoFor` on `WorktreeView` if the render path still calls it; pass it as a dep rather than duplicating it.
    4. Add `src/webview/worktree/worktreeView/actionNotices.test.ts` proving OBL-3: arm a dismiss, drop the result, advance the clock, assert nothing ran.
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
    1. Create `src/webview/worktree/createDialog/draftModel.ts` exporting `createDraftModel(...)` over `draft`, `pathIsDerived`, `usingChosen`, `destExact`, `supplied`, `pickAsks`, `pickAsked` and `afterChoice`/`folderMode`.
    2. Move the destination-derivation logic out of `src/webview/worktree/WorktreeCreateDialog.ts` into it, body verbatim; the DOM layer reads the model and writes inputs from it.
    3. Add `src/webview/worktree/createDialog/draftModel.test.ts` proving OBL-4, running under the NODE environment rather than jsdom — a `document` reference in the module then throws rather than passing silently.
    4. Do not edit `WorktreeCreateDialog.test.ts`; it is the regression net for this task.
    5. Close with `git diff --exit-code -- src/types/messages.ts` (OBL-5).

- [ ] 2_2 Extract the branch choice list
  - **Deps**: 2_1
  - **Refs**: design.md D1, design.md D2, design.md D4
  - **Boundary**: the choice list's ORDER and its fork-head resolution are unchanged
  - **Acceptance**:
    - Outcome: `choice`, `choices`, `forkHead`, `activeAt` and `listOpen` live beside the draft model, and the dialog reads them.
    - Verify: command pnpm exec vitest run src/webview/worktree/createDialog src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. Move `choice`, `choices`, `forkHead`, `activeAt` and `listOpen` and the functions that maintain them out of `src/webview/worktree/WorktreeCreateDialog.ts` into `src/webview/worktree/createDialog/draftModel.ts`, or a sibling if the two states share nothing.
    2. Add cases to `src/webview/worktree/createDialog/draftModel.test.ts` pinning the list order and the fork-head resolution.
    3. Run `bun run asm refactor shape` on both targets and every destination; RECORD the output in workflow.md Notes rather than chasing it (design.md Risk Map).
    4. Close with `git diff --exit-code -- src/types/messages.ts` (OBL-5).
