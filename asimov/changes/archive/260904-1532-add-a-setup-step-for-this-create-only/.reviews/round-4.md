# Review round 4 — add-a-setup-step-for-this-create-only

- Date: 2026-09-04
- Cycle: 3
- Mode: verification
- Lane: fastlane
- Arbiter: no
- Head reviewed: `e9f5058e7f705d9ec8a230249cca743c9158c1fd` (clean tree before this round file was written)
- Requested diff scope: `git diff edc455a7..e9f5058e7f705d9ec8a230249cca743c9158c1fd`
- Verification delta: `git diff 4db569c45c2b98f55600c17b0b8fd172c688783d..e9f5058e7f705d9ec8a230249cca743c9158c1fd`, narrowed to round-3 F003/F008 and the dependent change's integration seam
- Reviewable lines in the remediation delta: 27 added production lines in `providerKit.ts`; 4 production lines removed from `WorktreeCreateDialog.ts`; 124 added and 8 removed test lines reviewed inline. Unchanged `WorktreeHost.ts` composition paths were reviewed as the behavioral impact cone.
- Large cumulative range: yes; the verification cone itself is small and scope-locked
- Verdict: **APPROVE**
- Counts: 0 BLOCK · 0 WARN · 0 SUGGEST

## Scope lock

The new invariant owner identified in round 3 was not patched into this parent change. It was extracted as `reserve-the-host-s-rows-in-the-model-budget`, reviewed independently to **APPROVE** with zero findings, and archived at `asimov/changes/archive/260904-1520-reserve-the-host-s-rows-in-the-model-budget/`. This round therefore reviews only the parent integration seam promised by the round-3 handback plus F008's inert cleanup. No further capability, contract, task, or invariant owner was introduced in the parent.

## Agents

| Agent | Region | Lens | Model |
|---|---|---|---|
| asm-review-logic | reader reservation through save reread/fallback and every offer issue | boundary arithmetic, report replacement, reissue ordering | `gpt-5.6-sol[1M]` |
| asm-review-contracts | read allowance, final model, save admission, accepted D3 | cross-layer model/save contract | `gpt-5.6-terra[1M]` |
| asm-review-performance | repository-row growth through host composition | structural cap, amplification, duplicate accumulation | `sonnet[1M]` |
| chair | F003/F008 remediation delta and impact cone | all applicable lenses | `gpt-5.6-sol[1M]` |

Data/security was skipped because the remediation changes no inbound shape, authority, filesystem path, persistence, secret handling, or command execution. Frontend was skipped because its only production delta removes the already-proven inert class toggle; the chair checked that removal and the unchanged tick-carry cone. Reuse was skipped because no parallel helper, parser, mapper, split, or duplicated capability was introduced. No finder was needed: the four `offers.issue` sites, both composition helpers, save admission, and the relevant witnesses were directly traceable.

## Gate evidence

`bun run asm change verify-status add-a-setup-step-for-this-create-only` exits 0 with tasks `1_1` through `5_2` complete. `workflow.md` records the clean-tree re-observation at `5ab4baf5`: 7759/7759 tests, clean types, I10, filesystem-deletion, and bundle gates green; Biome carried only the two pre-existing errors and 14 warnings in untouched files. The chair ran no project test, lint, type-check, bundle, or verify command. A zero-file arithmetic probe independently enumerated 19,602 valid read/report/record cardinality states and found a maximum final model size of exactly 200 rows.

## Risk map

- **F003 invariant seam:** repository-controlled provisioning rows grow per read. `providerKit.full()` must leave enough structural room for save refusal, lock, and one added-step withholding statement before `WorktreeHost` publishes.
- **Composition and fallback:** normal reread and thrown-reread fallback may carry prior marker rows, a prior withholding statement, or prior save reports. Recomposition must replace rather than stack them.
- **Save contract:** a legitimate offer may still expose 200 selectable rows, so `isKnownSave` must retain `MAX_MODEL_ROWS` rather than the smaller reader allowance.
- **Prior witnesses:** reducing the provider allowance by four rows must not disturb added-row ordinal tick carry, source-switch survival, or a full-selection save.
- **F008 cleanup:** removing the only-add class toggle must not remove a selector-observed state or behavior.

## Findings

### [F001] Duplicate added scripts can silently transfer selection and execute an unticked command

- ID: F001
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair + asm-review-frontend + asm-review-logic
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:1853-1893,2019-2028`
- Title: Duplicate added scripts can silently transfer selection and execute an unticked command
- Evidence: The remediation delta does not touch `addedTickRecord`, ordinal splice/application, or any answering-offer reconciliation path. The existing duplicate-script and hidden-suffix witnesses remain in the recorded 7759-test gate.
- Impact: No tick can newly move between duplicate added rows through this dependency; selected setup execution remains tied to the user's explicit per-record ordinal state.
- SuggestedFix: None.
- Status: fixed
- Triage: Remains fixed from rounds 2 and 3; no evidence in this cone reopens it.

### [F002] Changing repository escapes the pending-input gate and can open a second input or create early

- ID: F002
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:1685-1753,1849-1851,3270-3295,3411-3444`
- Title: Changing repository escapes the pending-input gate and can open a second input or create early
- Evidence: The remediation removes only the inert `wt-bring-box--only-add` toggle. `anyAsking()` and every form-wide gate remain unchanged, and their witnesses are in the re-observed gate.
- Impact: The dependency cannot re-arm another repository, Create, save, source switch, or a second input while an ask is live.
- SuggestedFix: None.
- Status: fixed
- Triage: Remains fixed; no intersecting behavior changed.

### [F003] Final-model cap still fails when save reports are appended to a capped reread

- ID: F003
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair + asm-review-logic + asm-review-contracts
- Class: feature
- File: `src/worktree/provisioning/providerKit.ts:80-100,290-310; src/providers/WorktreeHost.ts:200-205,987-1052,3396-3482`
- Title: Final-model cap still fails when save reports are appended to a capped reread
- Evidence: The dependent owner now enforces `MAX_READ_ROWS = 200 - 3 - 1 = 196`. `full()` admits at most 196 ordinary rows and, only when a further append is refused, adds exactly one cap problem, so a production read reaches at most 197 rows. Save adds at most a refusal and a lock report. `withAdded()` strips prior marker/withholding rows, computes room from the report-decorated base through `rowsOf`, and adds either fitting marker rows or at most one withholding statement. All four form publications still pass through `withAdded()`. `withSaveReports()` removes prior save-created problem identities before adding the current attempt, so repeated fallback does not stack reports. Exhaustive arithmetic over read rows 0–197, reports 0–2, and records 0–32 produced no final state over 200. The new normal-reread and thrown-reread witnesses retain the cap, refusal, lock, and withholding statements.
- Impact: Round 3's 202-row save witness is closed at the reader/host seam. Every production initial, switch, ask, normal-save, and fallback-save offer is structurally bounded by `rowsOf(model) <= MAX_MODEL_ROWS`; a legitimate 200-row selection remains admitted because `isKnownSave` still permits 200 ids.
- SuggestedFix: None; keep the reader reservation and host-composed-row inventory coupled through the seam witness.
- Status: fixed
- Triage: Fixed by dependent change `reserve-the-host-s-rows-in-the-model-budget` (`97cbc1a2`, `6f7903e0`; archived by `6b36a22d`), independently reviewed APPROVE with zero findings. The invariant owner is correctly outside this parent change; the parent D3 now names the dependency.

**Invariant.** Every host-issued provisioning model, after added-step decoration and current save-result reports, stays within `MAX_MODEL_ROWS`, and every selectable id the UI may legitimately return remains inside save admission.

**Boundary inventory.** Verified safe: provider append/report choke point and cap statement; initial read; source switch; ask/repeated cancellation; normal save reread; thrown-reread fallback; zero, one, and two save reports; prior save-report replacement; marker/withholding stripping and recomposition; full-selection save at 200; switch back to the full added-step record. No affected boundary remains open.

### [F004] An optional prompt capability is advertised as a working action when absent

- ID: F004
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: asm-review-contracts
- Class: feature
- File: `src/providers/WorktreeHost.ts:487,3262-3357`
- Title: An optional prompt capability is advertised as a working action when absent
- Evidence: The dependency changes only provider row budgeting and removes an inert class toggle. It adds no caller, construction path, capability advertisement, or absence behavior.
- Impact: There is no materially new evidence against the production caller inventory or accepted picker-style capability pattern.
- SuggestedFix: None.
- Status: rejected
- Triage: Round-1 rebuttal remains sustained for a third round; the prior rejected disposition is unchanged.

### [F005] The setup-script character limit has two independent owners

- ID: F005
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: asm-review-reuse
- Class: feature
- File: `src/types/messages.ts:1317; src/extension.ts:572-587; src/providers/WorktreeHost.ts:3330`
- Title: The setup-script character limit has two independent owners
- Evidence: `MAX_SETUP_STEP_CHARS` and both consumers are unchanged by this cone.
- Impact: Input guidance and authoritative host admission still share one owner.
- SuggestedFix: None.
- Status: fixed
- Triage: Remains fixed from round 2.

### [F006] Edit and remove expose the full script as the control's accessible name

- ID: F006
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: asm-review-frontend
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:902-929,975-981`
- Title: Edit and remove expose the full script as the control's accessible name
- Evidence: The remediation removes only a class toggle after the controls have been rendered; bounded `stepName` construction and button naming are unchanged.
- Impact: Long scripts do not regain unbounded accessible names.
- SuggestedFix: None.
- Status: fixed
- Triage: Remains fixed from round 3.

### [F007] An edit or remove answer destroys the focused action without restoring focus

- ID: F007
- Severity: SUGGEST
- Confidence: MEDIUM
- Priority: P4
- Agent: asm-review-frontend
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:1685-1732,1834-1847,2005-2017,2154-2157`
- Title: An edit or remove answer destroys the focused action without restoring focus
- Evidence: The removed class toggle neither reads nor writes pending focus state. Press eligibility, withdrawal on `focusin`, and post-answer focus restoration remain unchanged.
- Impact: Keyboard and screen-reader position still survives the answering redraw.
- SuggestedFix: None.
- Status: fixed
- Triage: Remains fixed from round 3.

### [F008] The only-add state toggle has no consumer

- ID: F008
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P5
- Agent: chair
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:2157` (deleted)
- Title: The only-add state toggle has no consumer
- Evidence: Commit `6f7903e0` removes the sole `classList.toggle("wt-bring-box--only-add", ...)` call. A repository-wide search finds no remaining production selector, reader, test, or symbol occurrence.
- Impact: The inert branch no longer obscures the empty/only-add rendering path; no rendered behavior changes because nothing consumed the class.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed by the dependent change as declared in round 3.

## Adjudication

The chair and all three specialists found no new defect. F003 closes because the read side now owns the allowance it alone can enforce: 196 ordinary rows plus its cap statement leaves all three host-composed slots before publication. The host side retains one final `withAdded` boundary over all four issue sites, including save fallback, and save admission intentionally remains at 200. F008 is removed exactly as triaged. No earlier finding's evidence intersects a changed mechanism except F003, and its full boundary inventory now closes.

Changed tests contain no `.only` or `.skip`; both added asynchronous host cases await settlement before assertion. The near-budget, dense-source, full-selection save, repeated-cancellation, sparse-switch-back, and added-step tick witnesses remain in the green recorded gate. No fixture or mock change carries PII, credentials, destructive behavior, or a changed contract.

There is no accepted risk and no audit backlog.
