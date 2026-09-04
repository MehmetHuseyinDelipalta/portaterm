# Review round 1 — add-a-setup-step-for-this-create-only

- Date: 2026-09-04
- Cycle: 1
- Mode: discovery
- Lane: fastlane
- Head reviewed: `d3c3df420b89908c1e6d8bd2ae6026b15c2a743a` (the checkout was dirty only in `asimov/changes/add-a-setup-step-for-this-create-only/analytics.json`; the requested committed range excluded that working-tree delta)
- Diff scope: `git diff edc455a7d6cb219857da0664e53bc06137924d96..d3c3df420b89908c1e6d8bd2ae6026b15c2a743a` (requested `15d352bf^..HEAD`)
- Reviewable lines: 616 added/modified across 7 reviewable production/data files, with 21 removed lines; 705 added test lines reviewed inline; Markdown/design artifacts were intent or skipped support sources
- Verdict: **REJECT**
- Counts: 3 BLOCK · 1 WARN · 1 SUGGEST
- Split over gating blockers: 3 feature / 0 machinery

## Agents

| Agent | Region | Lens | Model |
|---|---|---|---|
| asm-review-data-security | inbound ask, host-held scripts, offer redemption | security/privacy and host authority | `gpt-5.6-sol[1M]` |
| asm-review-logic | setup ask, switch, save, close, and reissue paths | async ordering and edge cases | `gpt-5.6-terra[1M]` |
| asm-review-frontend | dialog pending state, selection carry, controls | rendering, state, events, accessibility | `sonnet[1M]` |
| asm-review-contracts | message union, runtime validator, routing, optional capability | API and contract agreement | `gpt-5.6-terra[1M]` |
| asm-review-reuse | marker decoration, pending state, shared bounds | reuse and cohesion | `gpt-5.6-luna[1M]` |
| asm-review-performance | added-step records and final offer model | growth axes and model-wide bounds | `gpt-5.6-luna[1M]` |
| asm-finder | ask-to-execution/save/retirement trace | full-flow support trace | inherited |
| chair | full committed range | all lenses and full-flow trace | `gpt-5.6-sol[1M]` |

Verify gate evidence is the recorded `bun run asm change verify-status add-a-setup-step-for-this-create-only`: tasks `1_1` through `3_2` are `[x]` with exit 0. `workflow.md` records 7747/7747 tests, type check, I10, and bundle gates green; its Biome observations are pre-existing or unchanged. The chair ran no project verify command, lint, type check, or test suite.

---

## Findings

### [F001] Duplicate added scripts can silently transfer selection and execute an unticked command

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair + asm-review-frontend + asm-review-logic
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:1999-2007`
- Status: accepted
- Triage: The chair traced both edit and remove with two identical added scripts. The frontend specialist independently established the remove witness; the logic specialist confirmed the occurrence-index instability. Existing tests use distinct scripts, so they do not exercise the failed identity boundary.

**Invariant.** An add/edit/remove answer must preserve the explicit tick of every surviving added step; no operation on one row may select a different row the user left unticked.

**Boundary inventory.** Affected: editing or removing an earlier member of a same-script added-row run. Verified safe: adding at the end does not shift existing occurrences; editing/removing the last duplicate does not shift a survivor; source switch uses the separately recorded ordinal tick vector; save and unchanged-offer reissues preserve script/order and therefore descriptors. Provider rows remain isolated by source.

**Evidence.** `rowDescriptors` distinguishes otherwise identical setup rows by occurrence index. For two added rows with the same script, first ticked and second unticked, removing the first makes the second move from occurrence 1 to occurrence 0. `carryForward` therefore matches the survivor to the removed row's old descriptor and ticks it. Editing the first duplicate has the same mechanism: changing its script makes the second duplicate become occurrence 0, inherit the first row's state, and the subsequent `editing.ordinal` override repairs only the edited row, not the shifted sibling.

**Impact.** The answering offer can silently tick a setup command the user explicitly unticked. Create then submits that host-minted item id and the host executes the command, falsifying both the accepted selection-carry obligation and “Only setup the user selected runs.”

**Suggested fix.** Snapshot the complete added-row tick vector for every setup operation. For edit, apply it unchanged by ordinal; for remove, splice the removed ordinal; for add, preserve prior ordinals and let only the new row take its checked default. Continue using descriptor carry only for rows whose identity is stable across the operation. Add duplicate-script witnesses for edit and remove in both tick directions.

- Author status: accepted
- Author triage: real — the occurrence-index descriptor moves a tick between duplicate scripts on remove; fixed by snapshotting every added row's tick by ordinal at ask time and splicing on remove (design.md D5, amended). Needs a D5 amendment, so landed after a design handback.
---

### [F002] Changing repository escapes the pending-input gate and can open a second input or create early

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:1336-1348,1697-1710,3188`
- Status: accepted
- Triage: `showInputBox` is created with `ignoreFocusOut: true`; VS Code's API contract says this keeps the input open when focus moves to another editor part. The repository selector remains enabled, while all new gates ask only `pendingStep.has(draft.repoId)`.

**Invariant.** One live setup input holds the whole create opening: no repository in that form may expose Create, save, source switch, or another setup input until the host answers it.

**Boundary inventory.** Affected: multi-repository forms after moving from the repository that owns the pending ask. Verified safe: single-repository forms; controls and Create while the owning repository stays selected; host retirement drops the late answer after close. The host's per-repository sequence slots do not close the UI hole because a second repository has a different slot.

**Evidence.** An ask on repository A records `pendingStep[A]`. The repository `<select>` is not disabled. Selecting B changes `draft.repoId` and redraws B; `syncStepControls`, `askStep`, and `blockedBy` now test only `pendingStep[B]`, so Add, save, source switch, and Create re-enable. A second ask on B is admitted under its separate host slot while A's input remains open, or B can be created before A's input answers.

**Impact.** The accepted “opened setup input holds the form” behavior is false in a supported multi-repository dialog. The user can open overlapping host prompts or submit a create while another repository's typed setup step is unresolved, dropping the first intent when the opening retires.

**Suggested fix.** Make pending setup input state opening-scoped rather than current-repository-scoped for all gates, and disable the repository selector while any setup ask is pending. Ensure the answer clears that opening-wide state even if the active repository changed; add a two-repository witness covering Create and a second Add.

- Author status: accepted
- Author triage: real — the gate was per repository while the input is per form; fixed by gating on ANY pending ask and disabling the repository selector while one is out (design.md D5, amended).
---

### [F003] Added rows bypass the model cap and make a valid save stall without an answer

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair + asm-review-performance
- Class: feature
- File: `src/providers/WorktreeHost.ts:985-1003`
- Status: accepted
- Triage: The performance specialist confirmed the final offer can contain 232 rows. The chair extended that evidence through the changed save flow: `isKnownSave` still admits at most `MAX_MODEL_ROWS` kept ids and malformed saves are silently dropped, while the dialog has already set `pendingSave`.

**Invariant.** The final issued provisioning model, not merely the provider draft, must stay within the shared `MAX_MODEL_ROWS = 200` bound; every selection the UI can legitimately produce from that model must be accepted by the host's matching save contract.

**Boundary inventory.** Affected: initial, switch, save, and setup-ask reissues because all call `withAdded`; postMessage payload and DOM row count; save validation and pending-save release. Verified safe: create redemption does not apply the 200-id save bound; offers still supersede rather than accumulate; added script storage itself remains capped at 32 × 4096 and is retired with the opening.

**Evidence.** Provider assembly can emit 200 total rows under its shared budget. `withAdded` then appends up to 32 more setup rows outside that budget, producing up to 232 rendered rows. More directly, a valid model with 169 selected configured rows plus 32 selected added rows causes the dialog to send 201 `kept` ids. `isKnownSave` rejects any `kept.length > MAX_MODEL_ROWS` before the save arm runs, posts no answering offer, and leaves the dialog's `pendingSave` set.

**Impact.** A valid repository and valid user-created steps can make “Save current choices as defaults” silently do nothing and remain pending. This violates the accepted save scenario, while also breaking the repository's model-wide payload/DOM bound on every offer reissue.

**Suggested fix.** Enforce `MAX_MODEL_ROWS` after combining provider and added rows, with an explicit capacity outcome rather than silently dropping text the user just entered, and make save validation derive from the actual maximum selectable rows the host can issue. Add a near-cap model witness proving both final row count and save-answer release.

- Author status: accepted
- Author triage: real — `withAdded` appended past the provider budget; fixed by refusing an add that would take the combined model past `MAX_MODEL_ROWS - 1` (design.md D3, amended), so every issued offer stays inside the bound `isKnownSave` admits.
---

### [F004] An optional prompt capability is advertised as a working action when absent

- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: asm-review-contracts
- Class: feature
- File: `src/providers/WorktreeHost.ts:3265-3275`
- Status: accepted
- Triage: Shipped activation supplies the capability, so the main extension path works. However, `WorktreeActions.promptSetupStep` is deliberately optional and valid host constructions may omit it; no capability reaches the controller/dialog.

**Evidence.** `WorktreeController` always supplies `onSetupStepAsk`, and the dialog uses only that callback's presence to render Add/Edit/Remove. If `options.actions?.promptSetupStep` is absent, the host accepts each valid ask, obtains no text, and reissues an unchanged offer.

**Impact.** A supported host embedding without the optional action presents controls that can never perform their stated operation and gives no reason, contrary to the optional-capability contract used to justify hiding unavailable host UI.

**Suggested fix.** Either make `promptSetupStep` required for every host construction, or expose host support as a capability and omit `onSetupStepAsk` so the dialog's existing no-callback path renders no setup-step controls.

- Author status: rejected
- Author rebuttal: this is the contract the accepted folder-picker change shipped and reviewed to APPROVE (`choose-the-destination-with-the-system-picker`, design D3 "a capability nobody wired is still an answer"): `pickFolder?` is optional on `WorktreeActions`, the dialog renders the control on its own deps, and an unwired host answers with nothing so the form is released. `promptSetupStep?` follows it line for line, and the shipped activation wires it (`extension.ts`). Making it required would force every host construction — including the test harness's — to carry an input box, for an embedding that does not exist.
---

### [F005] The setup-script character limit has two independent owners

- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: asm-review-reuse
- Class: feature
- File: `src/extension.ts:578-583`
- Status: accepted
- Triage: Downgraded from the specialist's WARN because both values are currently 4096 and the host remains authoritative; the present behavior is correct, but the duplicated contract has a direct drift mode.

**Evidence.** The input validator embeds `4096`, while `WorktreeHost` independently defines `MAX_ADDED_STEP_CHARS = 4096` and enforces it after the prompt returns.

**Impact.** A later one-sided change can make the input accept text the host silently discards, or reject text the host would admit.

**Suggested fix.** Export one shared provisioning limit for the UI validation and host enforcement, retaining the host check as the authority.

- Author status: accepted
- Author triage: trivial — one exported `MAX_SETUP_STEP_CHARS` in `messages.ts`, read by the host's refusal and the input's `validateInput`.
---

## Adjudication notes

- The data/security specialist found no path by which webview text becomes `ProvisionSetupStep.script`. The runtime validator applies `onlyKeys` at both levels, the prompt return is the sole writer into `addedSteps`, create redeems only the current scoped offer, and `stillMine()` closes stale prompt continuations before mutation.
- F001 was escalated from the logic specialist's WARN to BLOCK using the frontend specialist's opposite-tick witness and the accepted execution invariant: the same occurrence-shift can select an explicitly unticked surviving command, which create will execute.
- F003 was escalated from the performance specialist's WARN because its finite 232-row bound also crosses the existing 200-id save validator. That turns the bound mismatch into a deterministic unanswered save on a valid UI-generated payload.
- No formatting/style findings were considered. Changed tests contain no `.only`/`.skip`; asynchronous changed cases await their witnesses. Their missing duplicate-script and multi-repository pending-input cases are captured by F001 and F002 rather than reported as separate test-only findings.

## Full-flow trace

- **Entry and boundary:** the dialog posts only operation kind and host-minted ids; the controller adds the compose-time opening; provider routing reaches `WorktreeHost`; `isKnownStepAsk` rejects extra keys and unknown kinds. No inbound string is consumed as a script.
- **Host state and ordering:** live opening, current offer, repository, and shared switch sequence are checked before prompt. Add/edit text comes only from `promptSetupStep`; rejection/cancel/bounds reissue unchanged. `stillMine()` rechecks surface, opening, and latest sequence before `addedSteps` mutation. Switch/save/ask use the same slot, and retirement sweeps the record.
- **Offer and dialog:** `withAdded` strips prior marker rows and re-appends the record at all four issue sites, so repeated asks do not duplicate the record. The final model exceeds the shared row budget and its save contract at scale (F003). Offer reminting invalidates prior item ids. Dialog selection reconciliation is correct for distinct scripts and switch/save, but duplicate occurrence shifts break edit/remove identity (F001), and pending state is not opening-wide across repository changes (F002).
- **Redemption and side effect:** Create sends only the current offer id and selected item ids. The host looks up that scoped current offer, filters its held setup rows by those ids, and passes the resulting `ProvisionSetupStep[]` through materialization to sequential setup execution. This preserves the host-text boundary but makes any erroneous re-tick in F001 load-bearing.
- **Save and lifecycle:** `divergenceOf` intentionally ignores setup, so added scripts are not written to native configuration. A successful save rereads and reapplies the per-opening record. Close/supersede forgets offers and sweeps `addedSteps`; stale prompt completions fail `stillMine()`.
