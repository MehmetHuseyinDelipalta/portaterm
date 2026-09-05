## 1. Add the pathless wire contract

- [x] 1_1 Route a copy-file ask and presentation-only added origin — verified: VITEST_MAX_THREADS=6 pnpm exec vitest run src/types/messages.contract.test.ts src/providers/TerminalViewProvider.worktree.test.ts src/providers/WorktreeHost.actions.test.ts && pnpm run check-types && VITEST_MAX_THREADS=6 pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#{a-file-can-be-added-to-copy-for-this-create-only, a-picked-copy-is-spent-only-through-private-host-held-provenance}; design.md D2, D4
  - **Acceptance**:
    - Outcome: the inbound ask carries no path and display origin grants no copy authority
    - Verify: command VITEST_MAX_THREADS=6 pnpm exec vitest run src/types/messages.contract.test.ts src/providers/TerminalViewProvider.worktree.test.ts src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. In src/types/messages.ts add `WorktreeCopyFileAskMessage`, route registration, and presentation-only `ProvisionEntry.addedForCreate`; cover forbidden path and handle fields in src/types/messages.contract.test.ts.
    2. In src/providers/WorktreeHost.ts add the host-held picker result and action seam, strict validator, and route shell; update src/providers/TerminalViewProvider.worktree.test.ts and src/providers/WorktreeHost.actions.test.ts for repository-root forwarding and extra-key refusal.

## 2. Safely hold the picker result

- [x] 2_1 Return one resolved in-repository holder from the system picker — verified: VITEST_MAX_THREADS=6 pnpm exec vitest run src/extension.worktreeActions.test.ts && pnpm run check-types && VITEST_MAX_THREADS=6 pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#a-file-can-be-added-to-copy-for-this-create-only; design.md D1
  - **Acceptance**:
    - Outcome: picker success returns one content-unread held file only after two matching resolved-containment answers
    - Verify: command VITEST_MAX_THREADS=6 pnpm exec vitest run src/extension.worktreeActions.test.ts
  - **Plan**:
    1. In src/extension.ts create one activation-scoped held-file pool, dispose it on teardown, and implement `pickCopyFile` with files-only `showOpenDialog`, pre-operation lifecycle reservation, a five-second admission race over canonical containment and original-path hold, exact canonical relative derivation, and late holder disposal.
    2. In src/test/__mocks__/vscode.ts expose deterministic open-dialog answers; update src/extension.worktreeActions.test.ts for cancel, outside and equal, final symlink, containment drift, macOS aliases, unsupported no-follow, pool cap, never-settling admission with fresh form answer, late cleanup, no content read, and canonical transfer.

## 3. Compose and retain the opening record

- [x] 3_1 Issue added copy rows with private sidecars and provider precedence — verified: VITEST_MAX_THREADS=6 pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts && pnpm run check-types && VITEST_MAX_THREADS=6 pnpm run test:unit exit 0
  - **Deps**: 2_1
  - **Refs**: specs/worktree-panel/spec.md#{a-picked-copy-is-spent-only-through-private-host-held-provenance, picked-files-survive-only-their-opening-s-compatible-reissues, save-defaults-never-persists-a-picked-file}; design.md D2, D3, D4, D6
  - **Acceptance**:
    - Outcome: compatible reissues retain bounded picked holders outside Save and provider authority
    - Verify: command VITEST_MAX_THREADS=6 pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. In src/providers/WorktreeHost.ts store at most 32 `{ path, canonicalPath, file }` records per opening, dispose rejected, stale, and retired results, and extend every offer issue site to compose exact entry-object sidecars within the shared row bound.
    2. In src/providers/WorktreeHost.ts reject current entries, exclusions, record duplicates, and possible folds; withhold later conflicting prefixes without truncating the record; filter current sidecar ids before Save divergence.
    3. In src/providers/WorktreeHost.actions.test.ts cover all picker outcomes, every issue site, source and Save ordering, lifecycle disposal, pool, record, and model caps, provider precedence, prefix restoration, private provenance, Create-then-close ownership across migration probing, synchronous transactional claims and rollback, repeated submit, and selected and unticked Save refusal.

## 4. Gate and render the dialog

- [ ] 4_1 Add the copy control with full-record tick carry
  - **Deps**: 1_1, 3_1
  - **Refs**: specs/worktree-panel/spec.md#{a-file-can-be-added-to-copy-for-this-create-only, picked-files-survive-only-their-opening-s-compatible-reissues, an-opened-copy-file-picker-holds-the-form-until-it-is-answered}; design.md D5
  - **Acceptance**:
    - Outcome: a newly added row is selected and every form control remains held until its fresh answer
    - Verify: command VITEST_MAX_THREADS=6 pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts src/webview/worktree/WorktreeController.test.ts
  - **Plan**:
    1. In src/webview/worktree/WorktreeCreateDialog.ts render `Add file to copy…`, use `addedForCreate` for display and defaults, add copy pending state and full-record tick vectors, extend the shared form gate, restore eligible focus, and update the Save note.
    2. In src/webview/worktree/WorktreeController.ts forward the ask with opening captured at compose time; update src/webview/worktree/WorktreeController.test.ts.
    3. In src/webview/worktree/WorktreeCreateDialog.test.ts cover pathless posting, selected default, secret warning, cancel, cross-repository hold, setup and copy mutual exclusion, switch and Save prefix tick carry, and focus restoration and withdrawal.

## 5. Prove Save then Create end to end

- [ ] 5_1 Spend the held file only after Save leaves configuration unchanged
  - **Deps**: 4_1
  - **Refs**: specs/worktree-panel/spec.md#{a-picked-copy-is-spent-only-through-private-host-held-provenance, save-defaults-never-persists-a-picked-file}; design.md D6
  - **Acceptance**:
    - Outcome: Save records no picked path and subsequent Create copies only the exact held object
    - Verify: command VITEST_MAX_THREADS=6 pnpm exec vitest run src/extension.worktreeAssembly.test.ts
  - **Plan**:
    1. In src/extension.worktreeAssembly.test.ts drive picker → Save → reread → Create, assert no native added path, replace and unlink the source pathname after the holder is issued, and prove copied bytes came from the held object through opaque ids only.
    2. In src/extension.worktreeAssembly.test.ts cover unsupported safe hold and multi-claim failure with no create, no leaked pool slot, and no private handle and path on either wire direction.
