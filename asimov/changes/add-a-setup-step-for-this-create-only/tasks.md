## 1. Wire contract

- [x] 1_1 Declare the setup-step ask on the worktree wire and refuse anything carrying text — verified: VITEST_MAX_THREADS=6 pnpm exec vitest run src/types/messages.contract.test.ts src/providers/TerminalViewProvider.worktree.test.ts src/providers/WorktreeHost.actions.test.ts && pnpm run check-types && VITEST_MAX_THREADS=6 pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#a-typed-setup-step-is-spent-only-through-the-host-held-offer; design.md D2, D3
  - **Acceptance**:
    - Outcome: the new message type routes through both providers and a payload with a smuggled text key is refused
    - Verify: command VITEST_MAX_THREADS=6 pnpm exec vitest run src/types/messages.contract.test.ts src/providers/TerminalViewProvider.worktree.test.ts src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. In src/types/messages.ts add `WorktreeSetupStepAskMessage` per design.md D2, export `SETUP_STEP_ADDED_SOURCE`, add the type to `WorktreeInboundMessage` and to `WORKTREE_MESSAGE_TYPES`.
    2. In src/providers/WorktreeHost.ts add `isKnownStepAsk` beside `isKnownSwitch` using `onlyKeys` on the message and on `op` and a literal check that `op.kind` is `add`, `edit` or `remove`, add `worktreeSetupStepAsk` to the route list that calls `handleAction`, and add a `handleAction` case that validates and returns.
    3. Add the `@ts-expect-error` pair to src/types/messages.contract.test.ts and the sample to `SAMPLE` in src/providers/TerminalViewProvider.worktree.test.ts.

## 2. Host and form

- [x] 2_1 Hold added steps per opening on the host and answer every ask with a re-issued offer — verified: VITEST_MAX_THREADS=6 pnpm exec vitest run 'src/providers/WorktreeHost.actions.test.ts' && pnpm run check-types && VITEST_MAX_THREADS=6 pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#{a-typed-setup-step-is-spent-only-through-the-host-held-offer, an-opened-setup-input-holds-the-form-until-it-is-answered, only-setup-the-user-selected-runs, a-choice-that-configuration-cannot-express-is-stated-not-silently-dropped}; design.md D1, D3, D4
  - **Acceptance**:
    - Outcome: an added step runs through the create's offer id, dies with its opening, never duplicates
    - Verify: unit src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. In src/providers/WorktreeHost.ts add `promptSetupStep?(current?: string)` to `WorktreeActions`, the `addedSteps` map keyed by the `provisionBaseline` slot, and `withAdded(slot, model)` that appends marker rows; call it at every `offers.issue` site for a form.
    2. Sweep `addedSteps` in `retireOpening`.
    3. Implement the `worktreeSetupStepAsk` arm: live opening, `provisionSwitch` slot latest-wins checked again after the prompt returns and before the record is touched, `op` resolved against `offers.current`, marker-only for the edit and remove kinds, a rejected prompt treated as cancel, bounds 32 × 4096, then `previewProvisioning` and `offers.issue` on every admitted arm; `withAdded` strips marker rows before appending.
    4. Add the `promptSetupStep` override to `builtHost` in src/providers/WorktreeHost.actions.test.ts and the tests the design ledger names.

- [x] 2_2 Offer add, edit and remove in the Bring over section, gated like a switch — verified: VITEST_MAX_THREADS=6 pnpm exec vitest run 'src/webview/worktree/WorktreeCreateDialog.test.ts' && pnpm run check-types && VITEST_MAX_THREADS=6 pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#{a-setup-step-can-be-added-for-this-create-only, an-opened-setup-input-holds-the-form-until-it-is-answered, only-a-step-the-form-added-can-be-edited-or-removed-in-it, only-setup-the-user-selected-runs}; design.md D5
  - **Acceptance**:
    - Outcome: the form edits only its own steps, keeps ticks across answers, and starts an added step selected
    - Verify: unit src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. In src/webview/worktree/WorktreeCreateDialog.ts add `onSetupStepAsk` to `WorktreeCreateDialogDeps`, a `pendingStep` map, and the add control rendered last in `bringBox` while an offer is drawn.
    2. In `bringRows` set `checked: true` for a step whose `source` is `SETUP_STEP_ADDED_SOURCE`; in `bringRow` render edit and remove icon buttons (`ICON_RENAME`, `ICON_CLOSE`) in the source cell of marker rows only.
    3. Record the edit ordinal and tick on `pendingStep` and the marker rows' ticks on `pendingSwitch`, apply both in `syncBringOver` on the answering offer per design.md D5; clear `pendingStep` on a new offer id; disable the add, edit, remove and save controls and withhold Create while an ask is pending.
    4. Style the controls in src/webview/worktree/worktreePanel.css next to `.wt-bring-save`.

- [x] 2_3 Forward the ask with the opening the form was composed in — verified: VITEST_MAX_THREADS=6 pnpm exec vitest run 'src/webview/worktree/WorktreeController.test.ts' && pnpm run check-types && VITEST_MAX_THREADS=6 pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: design.md D5
  - **Acceptance**:
    - Outcome: the posted ask carries the compose-time opening and the dialog's own switch number unchanged
    - Verify: unit src/webview/worktree/WorktreeController.test.ts
  - **Plan**:
    1. In src/webview/worktree/WorktreeController.ts wire `onSetupStepAsk` beside `onPickDestination`, posting `worktreeSetupStepAsk` with the snapshotted `opening`.

## 3. Wiring and record

- [x] 3_1 Wire the input box and prove the path from typed text to the shell — verified: VITEST_MAX_THREADS=6 pnpm exec vitest run 'src/extension.worktreeAssembly.test.ts' && pnpm run check-types && VITEST_MAX_THREADS=6 pnpm run test:unit exit 0
  - **Deps**: 2_1, 2_2, 2_3
  - **Refs**: specs/worktree-panel/spec.md#{a-setup-step-can-be-added-for-this-create-only, a-typed-setup-step-is-spent-only-through-the-host-held-offer}; design.md D1
  - **Acceptance**:
    - Outcome: in the shipped wiring a typed command runs in the created worktree and a save writes no setup key
    - Verify: unit src/extension.worktreeAssembly.test.ts
  - **Plan**:
    1. In src/extension.ts add `promptSetupStep` to `WorktreeActionDeps`, pass it through `createWorktreeActions`, and implement it with `vscode.window.showInputBox` whose `validateInput` states the empty and 4096 bounds.
    2. Add `showInputBox` to `window` in src/test/__mocks__/vscode.ts and the fake dep in src/extension.worktreeActions.test.ts.
    3. Add the assembly tests: add → create → the setup terminal receives the typed script with the marker source; add → save → the native file has no `setup` key.

- [x] 3_2 Record the added-step boundary in the design docs — verified: manual — docs-only: § 4.0 gains the typed-step paragraph, § 4.3 gains the add bullet and its source-badge bullet now admits the marker
  - **Deps**: 3_1
  - **Refs**: design.md D1, D3
  - **Acceptance**:
    - Outcome: both design docs state a typed step enters through the host's input and lives only in the offer
    - Verify: none — docs-only
  - **Plan**:
    1. Add one paragraph to docs/design/worktree-provisioning.md § 4.0, and in docs/design/worktree-create.md § 4.3 add one bullet and amend "Every row names its source file" so the badge names a file OR the added-for-this-create marker.

## 4. Review fixes (round 1)

- [x] 4_1 Bound the combined model and share the script limit — verified: VITEST_MAX_THREADS=6 pnpm exec vitest run 'src/providers/WorktreeHost.actions.test.ts' && pnpm run check-types && VITEST_MAX_THREADS=6 pnpm run test:unit exit 0
  - **Deps**: 3_1
  - **Refs**: design.md D3
  - **Acceptance**:
    - Outcome: an add past the model budget is refused and answered, and one exported constant bounds the script text
    - Verify: unit src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. In src/types/messages.ts export `MAX_SETUP_STEP_CHARS = 4096`; read it in src/providers/WorktreeHost.ts and in the `validateInput` of src/extension.ts.
    2. In src/providers/WorktreeHost.ts refuse an add when entries, ports, provider setup, excluded rows and the record would exceed `MAX_MODEL_ROWS - 1`, still answering with the offer unchanged.
    3. Add the near-bound host test: fill to the bound, ask once more, assert the offer unchanged and a full-selection save answered.

- [x] 4_2 Carry added-row ticks by ordinal and hold the whole form while an input is open — verified: VITEST_MAX_THREADS=6 pnpm exec vitest run 'src/webview/worktree/WorktreeCreateDialog.test.ts' && pnpm run check-types && VITEST_MAX_THREADS=6 pnpm run test:unit exit 0
  - **Deps**: 3_1
  - **Refs**: specs/worktree-panel/spec.md#{an-opened-setup-input-holds-the-form-until-it-is-answered, only-setup-the-user-selected-runs}; design.md D5
  - **Acceptance**:
    - Outcome: duplicate-script rows keep their own ticks through edit and remove, and no control escapes an open input
    - Verify: unit src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. In src/webview/worktree/WorktreeCreateDialog.ts snapshot every added row's tick on the `pendingStep` record and apply per operation on the answer (splice on remove) per design.md D5.
    2. Gate the add, edit, remove, save, switch and repository controls and the Create button on ANY pending ask; disable the repository selector while one is out.
    3. Add dialog tests: two added rows with the same script, remove the first and edit the first, each in both tick directions; a two-repository form whose selector is held while an ask is out.

## 5. Review fixes (round 2)

- [x] 5_1 Bound every issued offer at withAdded through providerKit's row count — verified: VITEST_MAX_THREADS=6 pnpm exec vitest run 'src/providers/WorktreeHost.actions.test.ts' && pnpm run check-types && VITEST_MAX_THREADS=6 pnpm run test:unit exit 0
  - **Deps**: 4_1
  - **Refs**: design.md D3
  - **Acceptance**:
    - Outcome: every issued offer stays inside the row bound and its full selection saves
    - Verify: unit src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. In src/worktree/provisioning/providerKit.ts export `rowsOf(model)` counting entries, ports, setup, excluded and problems; test in src/worktree/provisioning/providerKit.test.ts that it equals `emitted` for `modelFromDraft` of a draft the budget filled, problems included.
    2. In src/providers/WorktreeHost.ts move the bound into `withAdded` per design.md D3: strip markers and the tagged withholding problem, append the longest fitting prefix, add the tagged problem when any script is withheld, and rewrite the add refusal over `rowsOf`.
    3. Host tests: 32 steps then a switch to a `MAX_MODEL_ROWS - 1`-row source, then a cancelled ask, then a switch back; `MAX_MODEL_ROWS - 1` entries plus one problem refuses an add; a capped `MAX_MODEL_ROWS`-row base withholds everything and adds no problem.

- [x] 5_2 Bound the action names and restore focus after an answer — verified: VITEST_MAX_THREADS=6 pnpm exec vitest run 'src/webview/worktree/WorktreeCreateDialog.test.ts' && pnpm run check-types && VITEST_MAX_THREADS=6 pnpm run test:unit exit 0
  - **Deps**: 4_2
  - **Refs**: specs/worktree-panel/spec.md#only-a-step-the-form-added-can-be-edited-or-removed-in-it; design.md D5
  - **Acceptance**:
    - Outcome: added-row names are bounded, ticks survive a denser switch, focus survives an answer
    - Verify: unit src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. In src/webview/worktree/WorktreeCreateDialog.ts name the buttons `Edit setup step N: <clipped>` / `Remove setup step N: <clipped>` with `STEP_NAME_CHARS`; replace the tick snapshots with `addedTickRecord` per design.md D5; record the pressed action, ordinal and focus eligibility on the pending record and restore focus after the answering redraw.
    2. Dialog tests: a 4096-character script yields a name under 80 characters carrying the ordinal; an unticked second step survives a denser switch that shows one marker and a switch back; focus after edit, after remove of the first of two, after remove of the last, and after add; no focus move when the user had moved to the branch field.
