# Tasks: decompose-create-dialog

Every task closes with `git diff --exit-code fe49091f -- src/webview/worktree/WorktreeCreateDialog.test.ts` (OBL-4). The base sha is literal: a form re-deriving it from `HEAD`
compares `HEAD..HEAD` and passes on a committed edit, and the two-command form used in earlier
changes also passes on a STAGED edit.

Every task whose cluster has closure capture opens with D1a's enumeration, in BOTH directions, and
stops if the count disagrees with design.md D1.

## 1. Module-level moves (no closure capture)

- [x] 1_1 Extract the contention model — verified: pnpm exec vitest run src/webview/worktree/createDialog/bringContention.test.ts src/webview/worktree/WorktreeCreateDialog.test.ts && pnpm run check-types exit 0
  - **Deps**: none
  - **Refs**: design.md D1, design.md D4, design.md § Obligation ledger
  - **Boundary**: no reference to `document`, `HTMLElement` or `createElement`
  - **Acceptance**:
    - Outcome: which provisioning rows collide, and which yield, is decided headlessly.
    - Verify: command pnpm exec vitest run src/webview/worktree/createDialog/bringContention.test.ts src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. Create `src/webview/worktree/createDialog/bringContention.ts` with `yieldsTo`, `contenderPartners`, `groupIndex`, `bothOrAll`, `claimingPerGroup` and `refusedEntire` from `src/webview/worktree/WorktreeCreateDialog.ts`. Bodies move unchanged; only imports are rewritten.
    2. Add `src/webview/worktree/createDialog/bringContention.test.ts` with NO `@vitest-environment` pragma (OBL-3). Exercise every exported function — an unexercised one cannot throw on a DOM reference.
    3. Do not edit `src/webview/worktree/WorktreeCreateDialog.test.ts`.

- [x] 1_2 Extract the offer summaries — verified: pnpm exec vitest run src/webview/worktree/createDialog/bringSummaries.test.ts src/webview/worktree/WorktreeCreateDialog.test.ts && pnpm run check-types exit 0
  - **Deps**: 1_1
  - **Refs**: design.md D1, design.md D4, design.md § Obligation ledger
  - **Boundary**: no reference to `document`, `HTMLElement` or `createElement`
  - **Acceptance**:
    - Outcome: what a provisioning offer says about itself is decided headlessly.
    - Verify: command pnpm exec vitest run src/webview/worktree/createDialog/bringSummaries.test.ts src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. Create `src/webview/worktree/createDialog/bringSummaries.ts` with the `BringRow` interface and `bringRows`, `rowDescriptors`, `carryForward`, `bringSummary`, `saveSummary`, moving them out of `src/webview/worktree/WorktreeCreateDialog.ts`. It imports from `bringContention.ts`.
    2. Add `src/webview/worktree/createDialog/bringSummaries.test.ts`, no pragma (OBL-3), exercising every export.
    3. Do not edit `src/webview/worktree/WorktreeCreateDialog.test.ts`.

- [x] 1_3 Extract the row rendering — verified: pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts && pnpm run check-types exit 0
  - **Deps**: 1_2
  - **Refs**: design.md D1, design.md D2
  - **Boundary**: reads `BringRow` flags; recomputes nothing the model owns
  - **Acceptance**:
    - Outcome: how a provisioning row is drawn lives outside the dialog closure.
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. Create `src/webview/worktree/createDialog/bringRowView.ts` with `bringProblem`, `switchRow`, `STEP_NAME_CHARS`, `stepName`, `stepButton`, `bringRow`, moving them out of `src/webview/worktree/WorktreeCreateDialog.ts`.
    2. No new suite: the 386-case suite already drives every one of these through `openWorktreeCreateDialog` (rows at `:2187-2304`, problems and switches at `:2307-2755`, added-step actions at `:6276-6610`), and a second assertion of the same markup proves nothing (D2).
    3. Do not edit `src/webview/worktree/WorktreeCreateDialog.test.ts`.

## 2. Closure collaborators (each invents a deps interface)

- [x] 1_4 Extract the branch listbox — verified: pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts && pnpm run check-types exit 0
  - **Deps**: 1_3
  - **Refs**: design.md D1, design.md D1a, design.md D4
  - **Boundary**: the facade holds no reference to `activeAt` or `listOpen`
  - **Acceptance**:
    - Outcome: the listbox owns which row is active and whether it is open.
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. Enumerate in both directions (D1a) and stop if the count disagrees with design.md D1.
    2. Create `src/webview/worktree/createDialog/branchList.ts` with `setActive`, `renderList`, `openList`, `measureRoom`, `closeList`, `commit` and the two `let` bindings, from `src/webview/worktree/WorktreeCreateDialog.ts`.
    3. Apply D4's negation rule at every site a moved `let` became an accessor.
    4. Do not edit `src/webview/worktree/WorktreeCreateDialog.test.ts`.

- [x] 1_5 Extract the recover offer — verified: pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts && pnpm run check-types exit 0
  - **Deps**: 1_4
  - **Refs**: design.md D1, design.md D1a, design.md D4
  - **Boundary**: the facade holds no reference to `recoverWanted`, `recoverGrant`, `recoverAsked`, `recoverAsks` or `recoverRefused`
  - **Acceptance**:
    - Outcome: the debris clearance offer and its grant live outside the dialog closure.
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. Enumerate in both directions (D1a).
    2. Create `src/webview/worktree/createDialog/recoverOffer.ts` with the five `let` bindings and `debrisOffer`, `settledDisposition`, `withdrawRecover`, `renderRecover`, `listed`, `RECOVER_ENTRY_CAP`, moving them out of `src/webview/worktree/WorktreeCreateDialog.ts`.
    3. Move `segments`, `shortPath` and `lastSegment` to `src/webview/worktree/createDialog/paths.ts`; the offer needs `lastSegment` and threading a pure function through a deps interface would hide a shared seam task 1_9 needs too.
    4. Apply D4's negation rule at every site.
    5. Do not edit `src/webview/worktree/WorktreeCreateDialog.test.ts`.

- [x] 1_6 Extract the resolution asks — verified: pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts && pnpm run check-types exit 0
  - **Deps**: 1_5
  - **Refs**: design.md D1, design.md D1a, design.md D4
  - **Boundary**: the facade holds no reference to `askedFor`, `defaultsAskedFor`, `outstanding`, `effective` or `resolutionOutstanding`
  - **Acceptance**:
    - Outcome: what the host was asked, and what it answered, lives in one module.
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. Enumerate in both directions (D1a).
    2. Create `src/webview/worktree/createDialog/resolutionAsks.ts` with `askKey`, `askForDestination`, `selection`, `probeBase`, `targetOf`, `heldBranch`, `deriveChoice` and the five `let` bindings, moving them out of `src/webview/worktree/WorktreeCreateDialog.ts`.
    3. Apply D4's negation rule at every site.
    4. Do not edit `src/webview/worktree/WorktreeCreateDialog.test.ts`.

- [x] 1_7 Extract the provisioning state — verified: pnpm exec vitest run src/webview/worktree/createDialog/provisionState.test.ts src/webview/worktree/WorktreeCreateDialog.test.ts && pnpm run check-types exit 0
  - **Deps**: 1_6
  - **Refs**: design.md D1, design.md D1a, design.md § Obligation ledger
  - **Boundary**: the facade holds no reference to `pendingSwitch`, `pendingSave`, `pendingStep`, `pendingCopy`, `addedTickRecord`, `addedCopyTickRecord`, `checkedByOffer`, `drawnModel`, `drawnOfferId` or `switchSeq`
  - **Acceptance**:
    - Outcome: pending asks and per-repo tick records live outside the dialog closure.
    - Verify: command pnpm exec vitest run src/webview/worktree/createDialog/provisionState.test.ts src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. Enumerate in both directions (D1a). The first shape of this change put the count at three; it is ~40, spanning `:1395` to `:3490`. Stop and re-plan if the enumeration disagrees with design.md D1 again.
    2. Create `src/webview/worktree/createDialog/provisionState.ts` with the four pending maps and their predicates, the two ordinal tick records with the helpers that apply and record them, `drawnModel`, `drawnOfferId`, `checkedByOffer`, `switchSeq`, `settleStep`, `settleCopy` and `settledProvision`, moving them out of `src/webview/worktree/WorktreeCreateDialog.ts`.
    3. Add `src/webview/worktree/createDialog/provisionState.test.ts`. It declares `// @vitest-environment jsdom` if it touches the DOM, and per `asimov/project.md` its Verify is `command pnpm exec vitest run`, never `unit`. Two obligations drive it: a tick set on repo A is not applied to repo B and survives the return (OBL-1), and an UNTICK survives a reminted offer by descriptor (OBL-2) — the existing `:3040-3078` asserts only the tick half.
    4. Apply D4's negation rule at every site.
    5. Split the two ordinal tick records into `src/webview/worktree/createDialog/tickRecords.ts`; the state module and they came to 544 lines together, over the goal this change exists to meet, and the records are the subject of both obligations.
    6. Do not edit `src/webview/worktree/WorktreeCreateDialog.test.ts`.

- [x] 1_8 Extract the provisioning view — verified: pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts && pnpm run check-types exit 0
  - **Deps**: 1_7
  - **Refs**: design.md D1, design.md D1a, design.md D4
  - **Boundary**: draws from `provisionState`; owns no state of its own beyond what it renders
  - **Acceptance**:
    - Outcome: drawing the provisioning section lives outside the dialog closure.
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. Enumerate in both directions (D1a).
    2. Create `src/webview/worktree/createDialog/provisionView.ts` with `syncBringOver`, `syncYieldNotes`, `restoreStepFocus`, `askStep`, `syncStepControls` and the save, add-copy and add-step handlers, moving them out of `src/webview/worktree/WorktreeCreateDialog.ts`.
    3. If the split from 1_7 forces a circular value import, the seam is wrong: stop and re-plan rather than merging into one module over 500 lines (design.md Risk Map).
    4. Do not edit `src/webview/worktree/WorktreeCreateDialog.test.ts`.

- [x] 1_9 Extract the form fields — verified: pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts && pnpm run check-types exit 0
  - **Deps**: 1_8
  - **Refs**: design.md D1, design.md D1a
  - **Boundary**: builds elements and returns them; decides nothing a collaborator owns
  - **Acceptance**:
    - Outcome: the form field elements are built outside the dialog closure.
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. Enumerate in both directions (D1a).
    2. Create `src/webview/worktree/createDialog/formFields.ts` building the branch, destination, mode, base, path and migration fields and returning them as a record the facade destructures, moving them out of `src/webview/worktree/WorktreeCreateDialog.ts`.
    3. Do not edit `src/webview/worktree/WorktreeCreateDialog.test.ts`.

- [ ] 1_9b Extract the derive pass
  - **Deps**: 1_9
  - **Refs**: design.md D1, design.md D1a, design.md D4
  - **Boundary**: the facade holds no reference to `syncDerived`'s body; the module derives and states, and decides no host ask of its own
  - **Acceptance**:
    - Outcome: the render pass runs from its own module and the facade calls it.
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. Enumerate in both directions (D1a).
    2. Create `src/webview/worktree/createDialog/derivePass.ts` with `syncDerived`, `syncAfterHint`, `syncOpenAfter` and `rebuildAfterOptions`, moving them out of `src/webview/worktree/WorktreeCreateDialog.ts`.
    3. Split it further the moment either file reaches 500 — the destination line and the button gates are two subjects, not one.
    4. Apply D4's negation rule at every site.
    5. Do not edit `src/webview/worktree/WorktreeCreateDialog.test.ts`.

- [ ] 1_10 Extract the host bindings, and confirm every file is under 500
  - **Deps**: 1_9b
  - **Refs**: design.md D1, design.md § Obligation ledger
  - **Boundary**: `src/webview/worktree/WorktreeCreateDialog.ts` and every file under `src/webview/worktree/createDialog/` is under 500 lines
  - **Acceptance**:
    - Outcome: every file this change produced is under 500 lines.
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. Enumerate in both directions (D1a).
    2. Create `src/webview/worktree/createDialog/hostBindings.ts` with the `deps.bind*` channels.
    3. Record `wc -l` for the facade and every module under `src/webview/worktree/createDialog/` in workflow.md Notes. Any file at 500 or above means the cut is unfinished — split it before ticking, do not tick and defer.
    4. Confirm OBL-5 by grep: every identifier a task moved returns zero hits in the facade.
    5. Do not edit `src/webview/worktree/WorktreeCreateDialog.test.ts`.
