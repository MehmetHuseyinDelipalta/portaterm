# Review round 3 — add-a-setup-step-for-this-create-only

- Date: 2026-09-04
- Cycle: 3
- Mode: discovery
- Lane: fastlane
- Arbiter: yes
- Head reviewed: `4db569c45c2b98f55600c17b0b8fd172c688783d` (the checkout was dirty only in `asimov/changes/add-a-setup-step-for-this-create-only/analytics.json`; the requested committed range excluded that working-tree delta)
- Diff scope: `git diff edc455a7..4db569c45c2b98f55600c17b0b8fd172c688783d`
- Reviewable lines: 1,020 added/modified across 8 reviewable production/data files, with 26 removed lines; 1,076 added test lines and 7 removed test lines reviewed inline; Markdown/design artifacts were accepted context or skipped support sources
- Large change: yes — accuracy may decrease
- Verdict: **BLOCK**
- Status: **blocked**
- Counts: 1 BLOCK · 0 WARN · 1 SUGGEST
- Split over gating blockers: 1 feature / 0 machinery

## Agents

| Agent | Region | Lens | Model |
|---|---|---|---|
| asm-review-data-security | inbound ask, host-held text, offer redemption, save boundary | security/privacy and host authority | `gpt-5.6-sol[1M]` |
| asm-review-logic | setup ask, switch, save, close, reissue, selection carry | async ordering and edge cases | `gpt-5.6-terra[1M]` |
| asm-review-frontend | dialog pending state, controls, tick carry, accessibility | rendering, state, events, accessibility | `sonnet[1M]` |
| asm-review-contracts | message union, validator, routing, optional capability, bounds | API and contract agreement | `gpt-5.6-terra[1M]` |
| asm-review-performance | added-step record, final offer model, retained maps | growth axes and model-wide bounds | `gpt-5.6-luna[1M]` |
| asm-review-reuse | picker pattern, offer composition, row budget, reconciliation | reuse and cohesion | `gpt-5.6-luna[1M]` |
| chair | full committed range | all lenses and full-flow trace | `gpt-5.6-sol[1M]` |

The performance assignment's first run hit the runtime watchdog; the same assignment resumed and returned its completed review. No finder was needed because all four issue sites, offer redemption, save composition, and dialog answer paths were directly traceable from the changed files.

Verify-gate evidence is the recorded `bun run asm change verify-status add-a-setup-step-for-this-create-only`: tasks `1_1` through `5_2` are `[x]` with exit 0. `workflow.md` records 7757/7757 tests, clean types, I10, fs-deletion, and bundle gates green; Biome carries only the two diagnostics already present at the base plus the same CSS warnings. The chair ran no project verify command, lint, type check, or test suite.

---

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
- Evidence: `addedTickRecord` now owns one boolean vector per repository by record ordinal. Every added-row toggle records that ordinal; every answering offer reapplies the vector; a valid remove splices the removed ordinal once. Descriptor carry remains only the starting point and is overridden for marker rows.
- Impact: The round-1 duplicate-script edit/remove witnesses keep each surviving row's own explicit tick, so an unticked sibling is not silently selected and executed.
- SuggestedFix: None; retain the duplicate-script witnesses and ordinal ownership.
- Status: fixed
- Triage: Fixed by tasks 4_2 and 5_2. The latest vector also preserves an unshown suffix through a denser source and applies on ask, switch, save, active-repository, and non-active-repository answers.

### [F002] Changing repository escapes the pending-input gate and can open a second input or create early

- ID: F002
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:1685-1753,1849-1851,3270-3295,3411-3444`
- Title: Changing repository escapes the pending-input gate and can open a second input or create early
- Evidence: `anyAsking()` is form-wide. It disables the repository selector and is consulted by Add/Edit/Remove, Save, source-switch controls, and Create. An answer for either the active or a non-active repository deletes the owning pending record, settles its selection, and re-derives the form once no ask remains.
- Impact: One host input now holds the entire form until its answer; another repository cannot expose a second input or an early create.
- SuggestedFix: None; keep future form actions on the same form-wide predicate.
- Status: fixed
- Triage: Fixed by task 4_2 and retained by the task 5_2 redraw/focus changes.

### [F003] Final-model cap still fails when save reports are appended to a capped reread

- ID: F003
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair + asm-review-logic
- Class: feature
- File: `src/providers/WorktreeHost.ts:200-205,1013-1052,3396-3418,3470-3482`
- Title: Final-model cap still fails when save reports are appended to a capped reread
- Evidence: Task 5_1 correctly moved added-record bounding into `withAdded`, but `withSaveReports(base, posts)` can append one refusal/lock problem or both to a provider reread that already carries `MAX_MODEL_ROWS` rows. The save path then calls `publish`, which reaches `withAdded`. With no added record, lines 1016-1021 return that 201- or 202-row model unchanged. With a record, `room` is negative and lines 1041-1043 still retain every base problem, so the same over-cap model is issued. The existing writer contract explicitly permits `{ ok: false, ..., mayStillBeLocked: true }`, and existing tests exercise the two-report outcome, but no test combines it with a capped reread or capped fallback.
- Impact: A valid save-result path falsifies accepted D3's load-bearing invariant that every initial, switch, save, and ask offer has `rowsOf(model) <= MAX_MODEL_ROWS`. The host can send and render 201-202 rows after a refused or lock-bearing save even though the reader and save validator share a 200-row boundary.
- SuggestedFix: Make final composition budget host-added save reports as well as added setup rows before `offers.issue`. Preserve the current save outcome and the reader's cap statement while ensuring the final model remains at most 200; add capped-reread and capped-fallback witnesses for one and two save reports.
- Status: accepted
- Triage: Persists from round 2 under the same F003 invariant and causal mechanism: rows added after the provider budget are not all included in one final composition budget. Task 5_1 fixed marker rows, withholding statements, provider problem rows, and all four `withAdded` call sites, but the save branch adds another host-owned problem layer before that compositor.
- Author status: accepted
- Author triage: real, and older than this change. At the change's base (`edc455a7`) the save branch already published `withSaveReports(base, posts)` straight through `offers.issue` with no bound at all, so a capped read plus a refusal and a lock report shipped 202 rows with no added step involved. The witness also shows entries alone (up to 199, reader-bounded) plus two save reports exceeding any host-side composition, so no ordering of host rows can hold the bound: the reader has to reserve the host's slots. That mints a new invariant owner over a path this change does not own, and the same invariant has now survived two fix attempts (4_1, 5_1) — the thrash stop's third trigger. Handed back as its OWN change, `reserve-the-host-s-rows-in-the-model-budget`, which this change depends on; per the cycle cap no further fix loop is opened here.

**Invariant.** Every host-issued provisioning model, after all host-owned decoration — added setup rows, withholding statements, and save-result reports — stays within `MAX_MODEL_ROWS`, and every selectable id the UI can legitimately return remains within the matching save validator.

**Boundary inventory.** Affected: save reread or fallback at the cap followed by a refusal report, a lock report, or both. Verified safe: initial provider issue; source switch from sparse to dense; ask reissue and repeated cancellation; add against a current problem-bearing model; capped provider base with an added-step record but no save report; sparse-source return of the full record; save response with no appended report. The earlier source-switch and problem-count witnesses now close; the newly traced save-report composition does not.

### [F004] An optional prompt capability is advertised as a working action when absent

- ID: F004
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: asm-review-contracts
- Class: feature
- File: `src/providers/WorktreeHost.ts:487,3262-3357`
- Title: An optional prompt capability is advertised as a working action when absent
- Evidence: `promptSetupStep?` continues to follow the accepted `pickFolder?` capability pattern. The sole production construction requires and wires `WorktreeActionDeps.promptSetupStep`; an absent internal capability reissues unchanged and releases the form.
- Impact: No inert shipped control or stranded form exists.
- SuggestedFix: None.
- Status: rejected
- Triage: Round-1 rebuttal remains sustained. The cumulative caller and routing inventory adds no materially new evidence.

### [F005] The setup-script character limit has two independent owners

- ID: F005
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: asm-review-reuse
- Class: feature
- File: `src/types/messages.ts:1317,src/extension.ts:572-587,src/providers/WorktreeHost.ts:3330`
- Title: The setup-script character limit has two independent owners
- Evidence: One exported `MAX_SETUP_STEP_CHARS` is read by both the host refusal and `showInputBox.validateInput`.
- Impact: Input guidance and authoritative host admission cannot drift independently.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed by task 4_1 and unchanged in this round.

### [F006] Edit and remove expose the full script as the control's accessible name

- ID: F006
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: asm-review-frontend
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:902-929,975-981`
- Title: Edit and remove expose the full script as the control's accessible name
- Evidence: `stepName` now names the action and 1-based added-row ordinal, clips the script to 48 characters with an ellipsis, and both icon buttons use that bounded value. The full script remains in the row's code cell through `textContent`.
- Impact: A valid 4096-character command no longer becomes two 4096-character control names.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed by task 5_2. The targeted long-script witness keeps every name below 80 characters and preserves the full visible code text.

### [F007] An edit or remove answer destroys the focused action without restoring focus

- ID: F007
- Severity: SUGGEST
- Confidence: MEDIUM
- Priority: P4
- Agent: asm-review-frontend
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:1685-1732,1834-1847,2005-2017,2154-2157`
- Title: An edit or remove answer destroys the focused action without restoring focus
- Evidence: The pending record captures the pressed kind, ordinal, and focus eligibility before controls are disabled. A `focusin` elsewhere withdraws restoration. After the answer redraw, focus returns to the same action, the successor after remove, or Add when none remains or after add.
- Impact: Keyboard and screen-reader position survives the answering `replaceChildren` redraw without pulling back a user who moved on.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed by task 5_2. Tests cover edit, first-of-two remove, last remove, add, moved-away focus, and unfocused pointer activation.

### [F008] The only-add state toggle has no consumer

- ID: F008
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P5
- Agent: asm-review-frontend
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:2159-2162`
- Title: The only-add state toggle has no consumer
- Evidence: The dialog toggles `wt-bring-box--only-add` when Add is the box's sole child, but the changed stylesheet and repository contain no selector for that class and no test observes it.
- Impact: No current behavior is wrong; the branch is inert and obscures whether an empty-offer visual treatment was intended.
- SuggestedFix: Remove the toggle, or add the intended rule if this state is meant to render differently.
- Status: open
- Triage: Valid non-gating cleanup from the frontend specialist; it cannot falsify an accepted behavior and does not affect the verdict.
- Author status: accepted
- Author triage: real and inert. The `wt-bring-box--only-add` toggle has no rule and no reader; removed in the dependent change so this cycle's fix loop stays closed.

## Arbiter dispositions

- **F003 — accepted.** The capped-save witness is concrete and reaches the changed `withAdded` composition seam. It directly falsifies approved D3 and therefore cannot be rejected or moved to audit backlog; it is repo-fixable, so it is not external. The change parks with one gating blocker.

## Adjudication notes

- F003 keeps its original BLOCK severity. Persistence does not change severity, and the evidence extends the same final-model invariant to a boundary the task-5_1 tests missed. The prior over-selectable-row save stall is fixed; the remaining witness is still an explicit accepted row-bound violation on a changed, load-bearing save answer path.
- The logic specialist found F003's save-report boundary. Data/security, contracts, performance, and reuse found no separate defect; the chair verified the witness directly against `withSaveReports`, `publish`, `withAdded`, the provider budget, and the writer result union. Evidence overrides the performance no-finding result.
- F006 and F007 close at their stated accessibility/focus witnesses. F001 and F002 remain closed. F004 remains rejected; F005 remains fixed.
- Changed tests contain no `.only` or `.skip`; changed asynchronous cases await their witnesses. The new budget tests cover dense switch, problem-bearing add, capped base, full-selection save, repeated cancellation, and sparse switch-back, but not capped save-result reports.
- No formatting or style findings were considered.

## Full-flow trace

- **Entry and authority:** Add/Edit/Remove controls post only operation kind plus current host-minted offer/item ids. `WorktreeController` adds the compose-time opening. The host's runtime validator applies exact keys at both message and op levels; no inbound text field is admitted. Text originates only from the extension-host `showInputBox` and is bounded again before the host record is mutated.
- **Identity, ordering, and lifecycle:** The host requires a live opening, known repository, current scoped offer, and a sequence higher than the shared ask/switch/save ceiling. Edit/remove target only marker rows in the current offer. After an input returns, `stillMine()` rechecks surface, sequence, and opening before mutation. Close, supersede, and detach sweep the per-opening record, sequence slots, and offers.
- **Composition and output:** Initial read, source switch, setup answer, and save publish all call `withAdded`. Marker rows and the tagged withholding statement are stripped before recomposition; the record remains capped at 32 scripts of at most 4096 code units and dense sources show a bounded prefix. The save branch can append save-result problems before `withAdded`, leaving F003's over-cap base untrimmed.
- **Dialog state:** A pending setup ask holds repository selection, Add/Edit/Remove, Save, source switches, and Create. Tick state is per repository and record ordinal, including hidden suffixes. Active and non-active repository answers settle the same record. Bounded names and focus restoration close F006/F007.
- **Redemption and side effect:** Create resolves the current offer by surface and repository, filters only selected held setup ids, and passes those steps to the existing sequential setup runner. Unknown, stale, foreign, or superseded offers do not run setup. No webview-originated command string reaches execution.
- **Save and persistence:** Save derives only entry/source divergence from the held model; setup and ports are absent from the writer input. The per-opening setup record remains available after a save reread and dies with the opening. Save refusal/lock reporting is truthful but currently breaks the final row cap when the reread or fallback is already full (F003).
