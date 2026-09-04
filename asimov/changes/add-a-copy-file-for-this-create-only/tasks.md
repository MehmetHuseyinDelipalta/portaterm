## 1. Wire and shared marker

- [ ] 1_1 Add the pathless copy-file ask and generic added-item marker
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#a-picked-copy-is-spent-only-through-the-host-held-offer; design.md D1, D2
  - **Acceptance**:
    - Outcome: the inbound ask routes with no field capable of carrying a file path
    - Verify: command VITEST_MAX_THREADS=6 pnpm exec vitest run src/types/messages.contract.test.ts src/providers/TerminalViewProvider.worktree.test.ts src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. In src/types/messages.ts rename the setup-specific marker to `PROVISION_ADDED_SOURCE`, update its current consumers, and add `WorktreeCopyFileAskMessage` to the inbound union and type list.
    2. In src/providers/WorktreeHost.ts add `isKnownCopyFileAsk`, the route and empty handler case; reject extra keys.
    3. Add negative type and routing samples in src/types/messages.contract.test.ts and src/providers/TerminalViewProvider.worktree.test.ts.

## 2. Host record and compositor

- [ ] 2_1 Add picked copy files to the host-held offer
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#{a-file-can-be-added-to-copy-for-this-create-only, picked-copy-is-spent-only-through-the-host-held-offer}; design.md D1, D2, D3, D5
  - **Acceptance**:
    - Outcome: an inside picked file becomes one selected current-opening copy row and never enters Save defaults
    - Verify: command VITEST_MAX_THREADS=6 pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/worktree/provisioning/writeNativeConfig.test.ts
  - **Plan**:
    1. In src/providers/WorktreeHost.ts add the bounded per-slot copy record, extend `withoutAdded`/`withAdded` over both record kinds, sweep it in `retireOpening`, and implement the picker ask per design.md D1-D3.
    2. In src/worktree/provisioning/writeNativeConfig.ts ignore marker entries in `divergenceOf`.
    3. Add host tests covering every refusal, ordering, lifecycle, duplicate, contender and combined-record boundary; add pure divergence tests.

## 3. Dialog and controller

- [ ] 3_1 Offer Add file to copy and hold the whole form while it answers
  - **Deps**: 1_1, 2_1
  - **Refs**: specs/worktree-panel/spec.md#{a-file-can-be-added-to-copy-for-this-create-only, an-opened-copy-file-picker-holds-the-form-until-it-is-answered}; design.md D4
  - **Acceptance**:
    - Outcome: a picked copy appears selected after every offer reissue
    - Verify: command VITEST_MAX_THREADS=6 pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts src/webview/worktree/WorktreeController.test.ts
  - **Plan**:
    1. In src/webview/worktree/WorktreeCreateDialog.ts render `Add file to copy…`, add `pendingCopy` and `addedCopyTicks`, extend the form-wide gate, selection reconciliation, focus restore and Save note per design.md D4.
    2. In src/webview/worktree/WorktreeController.ts forward the ask with the opening captured at compose time.
    3. Add dialog tests for posting no path, selected default, form-wide hold, cancel, cross-repository answer, dense-source tick carry and focus; add controller forwarding test.

## 4. Extension picker and end-to-end authority

- [ ] 4_1 Wire the system file picker through create and save
  - **Deps**: 2_1, 3_1
  - **Refs**: specs/worktree-panel/spec.md#a-picked-copy-is-spent-only-through-the-host-held-offer; design.md D1, D5
  - **Acceptance**:
    - Outcome: the picker-chosen file is copied by selected offer id and is absent from saved configuration
    - Verify: command VITEST_MAX_THREADS=6 pnpm exec vitest run src/extension.worktreeAssembly.test.ts src/extension.worktreeActions.test.ts
  - **Plan**:
    1. In src/extension.ts and src/test/__mocks__/vscode.ts add `pickCopyFile` using a files-only single-selection `showOpenDialog` rooted at the main checkout.
    2. Update src/extension.worktreeActions.test.ts fakes and add assembly tests that choose `.env`, create and observe the copied selection, then save defaults and read no recorded path.
