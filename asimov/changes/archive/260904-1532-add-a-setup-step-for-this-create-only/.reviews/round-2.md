# Review round 2 — add-a-setup-step-for-this-create-only

- Date: 2026-09-04
- Cycle: 2
- Mode: discovery
- Lane: fastlane
- Head reviewed: `8567ce1e6b6aec4fc8ed7d89f90f19ebf03f4a8a` (the checkout was dirty only in `asimov/changes/add-a-setup-step-for-this-create-only/analytics.json`; the requested committed range excluded that working-tree delta)
- Diff scope: `git diff edc455a7..8567ce1e6b6aec4fc8ed7d89f90f19ebf03f4a8a`
- Reviewable lines: 854 added/modified across 7 reviewable production/data files, with 25 removed lines; 820 added test lines reviewed inline; Markdown/design artifacts were intent or skipped support sources
- Large change: yes — accuracy may decrease
- Verdict: **BLOCK**
- Counts: 1 BLOCK · 1 WARN · 1 SUGGEST
- Split over gating blockers: 1 feature / 0 machinery

## Agents

| Agent | Region | Lens | Model |
|---|---|---|---|
| asm-review-data-security | inbound ask, host-held text, offer redemption, save boundary | security/privacy and host authority | `opus[1M]` |
| asm-review-logic | setup ask, switch, save, close, reissue, selection carry | async ordering and edge cases | `gpt-5.6-terra[1M]` |
| asm-review-frontend | dialog pending state, controls, tick carry, accessibility | rendering, state, events, accessibility | `sonnet[1M]` |
| asm-review-contracts | message union, validator, routing, optional capability, bounds | API and contract agreement | `gpt-5.6-terra[1M]` |
| asm-review-performance | added-step record and final offer model | growth axes and model-wide bounds | `gpt-5.6-luna[1M]` |
| asm-review-reuse | picker pattern, row budget, carry helpers, shared limits | reuse and cohesion | `gpt-5.6-luna[1M]` |
| asm-finder | ask-to-execution/save/retirement/caller trace | full-flow support trace | `gpt-5.6-luna[1M]` |
| chair | full committed range | all lenses and full-flow trace | `gpt-5.6-sol[1M]` |

Verify-gate evidence is the recorded `bun run asm change verify-status add-a-setup-step-for-this-create-only`: tasks `1_1` through `4_2` are `[x]` with exit 0. `workflow.md` records 7750/7750 tests, type check, I10, fs-deletion, and bundle gates green; Biome carries only the same pre-existing diagnostics, none in touched files. The chair ran no project verify command, lint, type check, or test suite.

---

## Findings

### [F001] Duplicate added scripts can silently transfer selection and execute an unticked command

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair + asm-review-frontend + asm-review-logic
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:1688-1694,1946-1950,2036-2041`
- Title: Duplicate added scripts can silently transfer selection and execute an unticked command
- Evidence: The pending operation now snapshots every added row's tick by ordinal. `settleStep` applies that vector unchanged for add/edit and splices the removed ordinal for remove; source switch separately records and reapplies `addedTicksAtSwitch`. Descriptor carry remains only for provider rows and is overridden for every added ordinal.
- Impact: The round-1 witness no longer moves a removed or edited duplicate's tick onto its sibling, so an explicitly unticked surviving command is not silently selected.
- SuggestedFix: None; retain the ordinal witnesses when changing offer reconciliation.
- Status: fixed
- Triage: Fixed by task 4_2 (`ea5e499d`). The duplicate-script remove witness is covered in both tick directions and the implementation applies the same complete ordinal vector to edit.

### [F002] Changing repository escapes the pending-input gate and can open a second input or create early

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:1702-1720,1811-1813,3209-3218,3337-3370`
- Title: Changing repository escapes the pending-input gate and can open a second input or create early
- Evidence: `anyAsking()` is now form-wide. It disables the repository selector and is checked by add/edit/remove, save, source switch, and Create. Both active-repository and non-active-repository offer callbacks delete the owning pending record, settle its selection, and re-derive the form once no ask remains.
- Impact: A live input now holds the whole create form until its answer, including forced repository changes in the regression witness.
- SuggestedFix: None; keep every future form action on the same form-wide predicate.
- Status: fixed
- Triage: Fixed by task 4_2 (`ea5e499d`).

### [F003] The combined-model cap still fails after a source switch and for provider problem rows

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair + asm-review-logic + asm-review-performance + asm-review-reuse + asm-review-contracts
- Class: feature
- File: `src/providers/WorktreeHost.ts:984-986,3200,3276-3281,3377`
- Title: The combined-model cap still fails after a source switch and for provider problem rows
- Evidence: `roomFor` is consulted only while adding against the model currently shown, and it counts entries, ports, setup, and excluded rows but not `model.problems`. A supported sequence starts on a sparse provider, adds 32 selected steps, then switches to a provider whose bounded model has 199 selectable rows. The switch path at line 3200 calls `withAdded` without any capacity check and issues 231 selectable rows. The dialog can then submit all 231 ids to Save, while `isKnownSave` rejects `kept.length > MAX_MODEL_ROWS` at line 2011 before the save arm posts an answer, leaving the dialog's `pendingSave` set. Independently, a current provider model containing problem rows passes `roomFor` because those rendered rows are omitted from its second budget formula.
- Impact: F003 persists from round 1: a normal source switch can deterministically recreate the over-budget offer and permanently stall a valid save, while problem-heavy offers can exceed the established payload/DOM row cap even without switching.
- SuggestedFix: Make the existing provider budget the single model-row accounting owner and enforce the final combined bound at every `withAdded` issue/reissue boundary, including `problems`. Define and witness the insufficient-room outcome for a source switch or save reread without dropping the user's added steps; the accepted obligations currently require both switch survival and a bounded final offer.
- Status: accepted
- Triage: Persists from round 1. The fix in task 4_1 (`76fecbad`) closed only “add against this current problem-free model”; the prior invariant inventory explicitly included switch and save reissues. This is the same invariant and causal mechanism, not a new finding. Because the remaining source-switch outcome is not specified, hand back to planning rather than applying another call-site patch.
- Author status: accepted
- Author triage: real — the bound was enforced at one call site of four and counted four of the five row kinds. Needs a D3 amendment (what a reissue does when the record does not fit), so landed after a design handback: the bound moves into `withAdded` itself, counts rows the way providerKit's budget does through one exported counter, offers the record's longest fitting prefix and states the remainder as a problem row; the record itself is never dropped.

**Invariant.** Every host-issued provisioning model, after appending the per-opening record, stays within the shared model-wide bound, and every full selection the UI can legitimately produce from it is accepted by the matching save validator.

**Boundary inventory.** Affected: source switch from a sparse model to a denser provider; save reread or report composition that returns a denser/problem-bearing model; add against a current model containing problem rows. Verified safe: the initial offer before any record exists; add against an unchanged problem-free model with canonical room; edit/remove, which do not grow the record; create redemption, which does not use the save-array bound. Every issue site uses `withAdded`, but that propagates the record rather than enforcing the final bound.

### [F004] An optional prompt capability is advertised as a working action when absent

- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: asm-review-contracts
- Class: feature
- File: `src/providers/WorktreeHost.ts:487,3284-3316`
- Title: An optional prompt capability is advertised as a working action when absent
- Evidence: `promptSetupStep?` follows the accepted `pickFolder?` capability-injection pattern. If absent, the host mutates no record and still reissues the unchanged offer, releasing the form. The sole production `createWorktreeActions` construction requires `WorktreeActionDeps.promptSetupStep` and wires `showInputBox`; no alternate shipped embedding omits it.
- Impact: There is no inert shipped control and no stranded form. Optionality supports host/test construction without weakening production behavior.
- SuggestedFix: None.
- Status: rejected
- Triage: Author rebuttal sustained. F004 is overruled by the production caller inventory and the already accepted picker contract.
- Author status: rejected (sustained)

### [F005] The setup-script character limit has two independent owners

- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: asm-review-reuse
- Class: feature
- File: `src/types/messages.ts:1317,src/extension.ts:583,src/providers/WorktreeHost.ts:3296`
- Title: The setup-script character limit has two independent owners
- Evidence: `MAX_SETUP_STEP_CHARS` is now exported once from `messages.ts` and read by both the host refusal and `showInputBox.validateInput`.
- Impact: The input hint and authoritative host admission can no longer drift independently.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed by task 4_1 (`76fecbad`).

### [F006] Edit and remove expose the full script as the control's accessible name

- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: asm-review-frontend
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:955-958`
- Title: Edit and remove expose the full script as the control's accessible name
- Evidence: Both icon buttons interpolate `row.subject` directly into `aria-label` and `title`. The same change explicitly permits one script to contain up to 4096 UTF-16 code units, so focusing either action can make assistive technology announce an arbitrary full command before identifying the control.
- Impact: Long but valid setup commands make the added-row action surface disproportionately difficult to traverse with a screen reader, repeated once for Edit and once for Remove.
- SuggestedFix: Give each button a bounded accessible name, such as the action plus row ordinal and a short, ellipsized command summary; keep the full script in the row's existing code cell rather than duplicating it into the control name.
- Status: open
- Triage: Pending author triage.
- Author status: accepted
- Author triage: real — a 4096-character command is a 4096-character accessible name, twice per row. Fixed as 5_2: the name is the action, the row's ordinal among added steps and a clipped summary; the full script stays in the row's code cell.

### [F007] An edit or remove answer destroys the focused action without restoring focus

- Severity: SUGGEST
- Confidence: MEDIUM
- Priority: P4
- Agent: asm-review-frontend
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:2060-2083`
- Title: An edit or remove answer destroys the focused action without restoring focus
- Evidence: The user activates an added-row action, the host input resolves, and the answering offer rebuilds the section with `bringBox.replaceChildren`. The focused edit/remove button is removed and no successor control is focused. The dialog's trap refreshes its inventory but does not restore active focus.
- Impact: Keyboard and screen-reader users can lose their position after each edit or remove and must navigate back into the row list.
- SuggestedFix: Record the action and added-row ordinal that initiated the ask, then after the answer focus the corresponding surviving action, the next row after remove, or the Add control as a fallback.
- Status: open
- Triage: Pending author triage.
- Author status: accepted
- Author triage: real — `replaceChildren` drops the focused action and nothing takes its place. Fixed as 5_2: the pending record remembers the action and ordinal, and the answer focuses the same row's action, the successor row's after a remove, or the Add control.

## Adjudication notes

- F003 is sustained at BLOCK, not the performance specialist's initial WARN, because the source-switch witness produces 231 selectable rows and reaches the unchanged `isKnownSave` hard cap, recreating the exact unanswered-save impact from round 1. The performance specialist confirmed the stronger witness and the logic/reuse specialists independently recommended enforcement at the final composition boundary.
- F004 rebuttal is sustained and the finding rejected. Both data/security and contracts confirmed the one production construction wires the capability and the absent internal capability answers unchanged, matching `pickFolder?`.
- F001, F002, and F005 close at their stated invariants. No agent found a webview-text-to-script path, a lifecycle leak, or configuration persistence of the typed step.
- Changed tests contain no `.only`/`.skip`; async changed cases await their witnesses. The near-budget host test exercises only a problem-free current model and does not cover F003's denser-source switch.
- No formatting/style findings were considered.

## Full-flow trace

- **Entry and authority:** The added-row controls post only `kind` and, for edit/remove, the current offer/item ids. `WorktreeController` adds the compose-time opening. Provider routing reaches `WorktreeHost`; `isKnownStepAsk` applies `onlyKeys` at both levels and rejects unknown kinds or smuggled text.
- **Host state and ordering:** The host requires a live opening, known repository, current offer, and a sequence higher than the shared switch/save ceiling. Add/edit text comes only from `promptSetupStep`; rejection, cancellation, empty/overlong input, absent capability, or stale item reissue unchanged. `stillMine()` runs after the input and before mutation. Close, supersede, and detach sweep the per-opening record.
- **Offer and dialog:** `withAdded` strips prior marker rows and reapplies the record at initial, switch, save, and ask issue sites. Offer reminting returns through the existing provisioning channel. The dialog releases the form-wide hold and reconciles added rows by ordinal, including forced non-active-repository answers. The final composition is not bounded at switch/save/problem boundaries (F003).
- **Redemption and side effect:** Create submits only the current offer id and selected item ids. The host resolves that scoped current offer, filters its held setup rows, and hands the resulting steps through the mutation service to sequential setup execution in the created worktree. No webview-originated text is consumed as a script.
- **Save and lifecycle:** `divergenceOf` reads entries only, so no setup command reaches `.vscode/worktree.json` or any provider file. A successful save rereads the model and reapplies the per-opening record; close/supersede/detach forget the offer and added scripts. Source switch retains the record and UI tick vector, but a denser replacement exposes F003.
