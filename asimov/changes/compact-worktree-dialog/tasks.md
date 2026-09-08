## 1. Provisioning hierarchy

- [x] 1_1 Replace provisioning checklist chrome with contextual groups — verified: pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#{creation-separates-routine-files-from-setup-consent, provisioning-actions-use-compact-contextual-controls}
  - **Boundary**: No host messages, provisioning policy or repository-write semantics change.
  - **Acceptance**:
    - Outcome: Files collapse safely, setup remains actionable, and compact source/add/defaults controls retain their existing behavior.
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. Replace alternate-source rows in src/webview/worktree/createDialog/bringRowView.ts with a labelled selector wired through src/webview/worktree/createDialog/provisionView.ts.
    2. Group existing row renderers and disclosures in src/webview/worktree/createDialog/provisionGroups.ts; preserve item ids, warnings and source attribution.
    3. Restyle provisioning groups and contextual actions in src/webview/worktree/worktreePanel.css.
    4. Extend src/webview/worktree/WorktreeCreateDialog.test.ts to exercise disclosure visibility, source switching, selected summaries and replaced-offer review.

## 2. Compact launch controls

- [x] 2_1 Flatten the launch form and reveal the optional prompt — verified: pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts src/webview/worktree/worktreeAgentBox.test.ts src/webview/worktree/WorktreeLaunchDialog.test.ts src/webview/worktree/WorktreeView.test.ts src/extension.worktreeAssembly.test.ts exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#creation-uses-a-compact-editor-native-presentation
  - **Acceptance**:
    - Outcome: All launch modes remain reachable through compact controls with an expandable first prompt.
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts src/webview/worktree/worktreeAgentBox.test.ts src/webview/worktree/WorktreeLaunchDialog.test.ts src/webview/worktree/WorktreeView.test.ts src/extension.worktreeAssembly.test.ts
  - **Plan**:
    1. Add a create-specific optional prompt disclosure in src/webview/worktree/worktreeAgentBox.ts using the existing hidden-region focus behavior.
    2. Compose compact after-create and agent controls in src/webview/worktree/createDialog/sections.ts and dynamic primary text in src/webview/worktree/createDialog/afterCreate.ts, wired in src/webview/worktree/WorktreeCreateDialog.ts.
    3. Scope flattened form styling to the create dialog in src/webview/worktree/worktreePanel.css without changing other dialogs.
    4. Extend src/webview/worktree/WorktreeCreateDialog.test.ts and src/webview/worktree/worktreeAgentBox.test.ts for prompt persistence, permission warnings and launch choices; migrate existing control lookups in src/webview/worktree/WorktreeView.test.ts and src/extension.worktreeAssembly.test.ts.
    5. Refine the source and defaults header in src/webview/worktree/createDialog/provisionView.ts and src/webview/worktree/createDialog/bringRowView.ts; preserve active contributors and selected-suggestion visibility in src/webview/worktree/createDialog/provisionGroups.ts.

## 3. Sparse-state refinement

- [x] 3_1 Flatten empty files and single-command suggestions — verified: pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts exit 0
  - **Deps**: 2_1
  - **Refs**: specs/worktree-panel/spec.md#sparse-creation-presents-only-useful-controls
  - **Acceptance**:
    - Outcome: Empty files and a single suggested command render without redundant controls or stacked metadata.
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. Adapt empty-file and single-suggestion rendering in src/webview/worktree/createDialog/provisionGroups.ts without changing row identities or selections.
    2. Render compact suggestion provenance in src/webview/worktree/createDialog/bringRowView.ts and style it in src/webview/worktree/worktreePanel.css.
    3. Add sparse-state and warning-preservation tests in src/webview/worktree/WorktreeCreateDialog.test.ts.

- [x] 3_2 Remove redundant launch hints and relocate defaults — verified: pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts src/webview/worktree/WorktreeView.test.ts src/extension.worktreeAssembly.test.ts exit 0
  - **Deps**: 3_1
  - **Refs**: specs/worktree-panel/spec.md#{repository-defaults-live-with-advanced-creation-settings, agent-startup-honours-the-setup-wait-choice, each-after-create-action-states-its-consequence, a-setup-gate-states-the-resulting-order-as-its-own-line}
  - **Acceptance**:
    - Outcome: Only relevant setup-wait controls appear, and repository defaults remain functional inside advanced settings.
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts src/webview/worktree/WorktreeView.test.ts src/extension.worktreeAssembly.test.ts
  - **Plan**:
    1. Expose a defaults container from src/webview/worktree/createDialog/provisionView.ts and attach it through src/webview/worktree/WorktreeCreateDialog.ts to the advanced region in src/webview/worktree/createDialog/sections.ts.
    2. Update wait visibility and copy in src/webview/worktree/createDialog/sections.ts, and remove the redundant agent-mode hint in src/webview/worktree/createDialog/afterCreate.ts.
    3. Adjust sparse section spacing in src/webview/worktree/worktreePanel.css and migrate affected assertions in src/webview/worktree/WorktreeCreateDialog.test.ts.

## 4. Single-line file choices

- [x] 4_1 Restore compact file rows without duplicate provenance — verified: pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts exit 0
  - **Deps**: 3_2
  - **Refs**: specs/worktree-panel/spec.md#file-choices-use-one-compact-row
  - **Acceptance**:
    - Outcome: Ordinary file choices occupy one row with visible warnings and accessible provenance.
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. Render file choices directly in src/webview/worktree/createDialog/provisionGroups.ts using the existing row renderer.
    2. Mark file rows and suppress duplicate visible source text in src/webview/worktree/createDialog/bringRowView.ts.
    3. Add scoped single-line file styling in src/webview/worktree/worktreePanel.css and regression cases in src/webview/worktree/WorktreeCreateDialog.test.ts.

## 5. Responsive and dense-content corrections

- [x] 5_1 Keep actions clear of the scrolling form — verified: pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts exit 0
  - **Deps**: 4_1
  - **Refs**: specs/worktree-panel/spec.md#creation-remains-navigable-in-short-viewports
  - **Acceptance**:
    - Outcome: Title and footer remain outside the form scroller and branch choices stay navigable.
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. Add a create-only body in src/webview/worktree/WorktreeCreateDialog.ts; bound the popup within it in src/webview/worktree/createDialog/branchList.ts.
    2. Scope scroll and footer styling in src/webview/worktree/worktreePanel.css.
    3. Cover composition in src/webview/worktree/WorktreeCreateDialog.test.ts and browser geometry in asimov/changes/compact-worktree-dialog/verification/density-browser.js.

- [x] 5_2 Isolate file review and clarify setup density — verified: pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts src/webview/worktree/createDialog/bringSummaries.test.ts src/extension.worktreeAssembly.test.ts exit 0
  - **Deps**: 5_1
  - **Refs**: specs/worktree-panel/spec.md#{creation-separates-routine-files-from-setup-consent, shared-folders-have-a-bounded-consequence-summary, setup-availability-and-execution-order-are-explicit, file-choices-use-one-compact-row}
  - **Boundary**: No changes to host execution, selection ownership, offer wire types or consent policy.
  - **Acceptance**:
    - Outcome: Dense offers expose only review files, aggregate links, and preserve visibly ordered setup choices and accurate counts.
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts src/webview/worktree/createDialog/bringSummaries.test.ts src/extension.worktreeAssembly.test.ts
  - **Plan**:
    1. Reuse descriptor matching in src/webview/worktree/createDialog/bringSummaries.ts and pass changed file ids through src/webview/worktree/createDialog/provisionView.ts.
    2. Partition row presentation and setup sequence in src/webview/worktree/createDialog/provisionGroups.ts; style bounded summaries in src/webview/worktree/worktreePanel.css.
    3. Migrate file-order-only assertions in src/extension.worktreeAssembly.test.ts while preserving live-opening and replay checks.
    4. Extend src/webview/worktree/WorktreeCreateDialog.test.ts and browser verification in asimov/changes/compact-worktree-dialog/verification/density-browser.js.

## 6. Adaptive form and narrow Vault header

- [x] 6_1 Fit creation to low horizontal panels — verified: pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts exit 0
  - **Deps**: 5_2
  - **Refs**: specs/worktree-panel/spec.md#{creation-adapts-to-low-horizontal-panels, creation-remains-navigable-in-short-viewports}
  - **Acceptance**:
    - Outcome: Creation fits low horizontal panels.
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. Group existing controls once into primary and secondary columns in src/webview/worktree/WorktreeCreateDialog.ts, retaining shell disposal and focus trapping.
    2. Add create-only full-surface and two-column responsive rules in src/webview/worktree/worktreePanel.css; never add containment to a modal ancestor.
    3. Extend src/webview/worktree/WorktreeCreateDialog.test.ts and verify real browser resize geometry using asimov/changes/compact-worktree-dialog/verification/adaptive-browser.js.

- [x] 6_2 Keep narrow Vault navigation and actions separate — verified: pnpm exec vitest run src/webview/vault/VaultPanel.test.ts exit 0
  - **Deps**: 6_1
  - **Refs**: specs/vault-panel/spec.md#narrow-panel-headers-keep-controls-distinct
  - **Acceptance**:
    - Outcome: Vault header controls remain individually reachable at narrow widths.
    - Verify: command pnpm exec vitest run src/webview/vault/VaultPanel.test.ts
  - **Plan**:
    1. Give view-selector buttons explicit accessible names in src/webview/vault/VaultPanel.ts while retaining existing tooltip disposal.
    2. Contain only the header for width queries and hide selector labels at narrow widths in src/webview/vault/vaultPanel.css.
    3. Extend src/webview/vault/VaultPanel.test.ts and browser coverage in asimov/changes/compact-worktree-dialog/verification/adaptive-browser.js.

- [x] 6_3 Guard the host panel-size action — verified: pnpm exec vitest run src/providers/TerminalViewProvider.test.ts exit 0
  - **Deps**: 6_2
  - **Refs**: specs/worktree-panel/spec.md#panel-expansion-is-explicit
  - **Acceptance**:
    - Outcome: Only the bottom-panel provider executes an explicit panel-size request.
    - Verify: command pnpm exec vitest run src/providers/TerminalViewProvider.test.ts
  - **Plan**:
    1. Add a payload-free panel-size message in src/types/messages.ts and handle it with a panel-location guard in src/providers/TerminalViewProvider.ts.
    2. Cover dispatch and non-panel rejection in src/providers/TerminalViewProvider.test.ts.

- [x] 6_4 Connect the create form panel-size control — verified: pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts src/webview/worktree/WorktreeController.test.ts exit 0
  - **Deps**: 6_3
  - **Refs**: specs/worktree-panel/spec.md#panel-expansion-is-explicit
  - **Acceptance**:
    - Outcome: The panel-size button preserves the active create session.
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts src/webview/worktree/WorktreeController.test.ts
  - **Plan**:
    1. Supply the optional callback in src/webview/worktree/controller/composeCreateDialogDeps.ts through src/webview/worktree/createDialog/dialogDeps.ts.
    2. Add the low-height action to src/webview/worktree/WorktreeCreateDialog.ts and src/webview/worktree/worktreePanel.css.
    3. Cover explicit dispatch and draft preservation in src/webview/worktree/WorktreeCreateDialog.test.ts and src/webview/worktree/WorktreeController.test.ts.

## 7. Scroll isolation and ultra-narrow correction

- [x] 7_1 Isolate preparation scrolling and remove panel-state guessing — verified: pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts exit 0
  - **Deps**: 6_4
  - **Refs**: specs/worktree-panel/spec.md#{two-column-creation-scrolls-preparation-independently, panel-expansion-is-explicit}
  - **Acceptance**:
    - Outcome: Preparation scrolling leaves launch controls stationary.
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. Replace viewport-gated sizing chrome in src/webview/worktree/WorktreeCreateDialog.ts with a neutral toggle, removing its resize listener.
    2. Move two-column overflow ownership into the existing columns in src/webview/worktree/worktreePanel.css.
    3. Update src/webview/worktree/WorktreeCreateDialog.test.ts and add browser scroll and height witnesses in asimov/changes/compact-worktree-dialog/verification/ultranarrow-browser.js.

- [x] 7_2 Wrap ultra-narrow Vault actions without clipping — verified: pnpm exec vitest run src/webview/vault/VaultPanel.test.ts exit 0
  - **Deps**: 7_1
  - **Refs**: specs/vault-panel/spec.md#narrow-panel-headers-keep-controls-distinct
  - **Acceptance**:
    - Outcome: All header controls remain reachable below 150px.
    - Verify: command pnpm exec vitest run src/webview/vault/VaultPanel.test.ts
  - **Plan**:
    1. Let the header and collapsed shell size to their content in src/webview/vault/vaultPanel.css; move actions below navigation via the existing header container query.
    2. Cover named compact controls and wrapping rules in src/webview/vault/VaultPanel.test.ts.
    3. Exercise 80px, 100px and 120px expanded and collapsed headers, both selected bodies, and real click targets in asimov/changes/compact-worktree-dialog/verification/ultranarrow-browser.js.

- [x] 7_3 Retain branch and status in narrow tree rows — verified: pnpm exec vitest run src/webview/worktree/WorktreeView.test.ts exit 0
  - **Deps**: 7_2
  - **Refs**: specs/worktree-panel/spec.md#narrow-worktree-rows-retain-branch-and-status
  - **Acceptance**:
    - Outcome: Narrow tree rows retain visible branches and complete status badges.
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeView.test.ts
  - **Plan**:
    1. Use the existing Vault body container to reflow narrow tree rows in src/webview/worktree/worktreePanel.css.
    2. Add a regression in src/webview/worktree/WorktreeView.test.ts and actual row-renderer badge bounds in asimov/changes/compact-worktree-dialog/verification/ultranarrow-browser.js.

## 8. Repository create footer and trailing chips

- [x] 8_1 Keep a create action below populated repository lists — verified: pnpm exec vitest run src/webview/worktree/WorktreeView.test.ts exit 0
  - **Deps**: 7_3
  - **Refs**: specs/worktree-panel/spec.md#visible-repository-lists-keep-a-create-action-below-their-worktrees
  - **Acceptance**:
    - Outcome: Displayed repository lists retain a correctly targeted create action below their worktrees.
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeView.test.ts
  - **Plan**:
    1. Reuse rowAction for an always-visible footer builder in src/webview/worktree/worktreeTreeView.ts.
    2. Append it after populated lists in src/webview/worktree/worktreeView/treeRender.ts, preserving the existing main-only state and its action.
    3. Style the footer in src/webview/worktree/worktreePanel.css and cover repo targeting, main-only, caps, folds and unavailable states in src/webview/worktree/WorktreeView.test.ts.

- [x] 8_2 Keep status chips at the trailing edge — verified: pnpm exec vitest run src/webview/worktree/WorktreeView.test.ts exit 0
  - **Deps**: 8_1
  - **Refs**: specs/worktree-panel/spec.md#normal-width-status-chips-remain-trailing
  - **Acceptance**:
    - Outcome: Revealing row actions leaves status chips at the trailing edge.
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeView.test.ts
  - **Plan**:
    1. Place row tools within the branch track before the chips in src/webview/worktree/worktreePanel.css, keeping text clearance and the existing narrow fallback.
    2. Add layout-rule regression coverage in src/webview/worktree/WorktreeView.test.ts and actual geometry in asimov/changes/compact-worktree-dialog/verification/create-footer-browser.js.
