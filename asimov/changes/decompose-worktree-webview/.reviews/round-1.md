# Review round 1 — decompose-worktree-webview

- Date: 2026-09-07
- Cycle: 1
- Mode: discovery
- Head: 841c74b5f9dad6d3055422046aec509a85eff7dd (tree dirty outside the reviewed scope only — `.gitignore`, `analytics.json`, an untracked `docs/audit/` note; no `src/` path is uncommitted)
- Scope: range `a4b4adf77852a7da4a900c47f5624b950b30f5e0..HEAD`
- Reviewable lines: 1742 added across 7 non-test source files (2 modified, 5 new) — over the 800 threshold, NOTE: large change, accuracy may decrease
- Agents spawned: 6 (logic ×3, frontend, reuse, contracts) + 1 reach adjudication
- Verdict: APPROVE
- Blocking: 0 | Warnings: 0 | Suggestions: 3 | Rejected: 3

## Class

Behaviour-preserving refactor. No new capability, no contract change, no new invariant owner. The scope lock is not engaged (this is the cycle's first round).

## Obligation ledger — chair verification

Every OBL was checked by the chair independently of the author's report.

- **OBL-1** (`foldState` is the sole owner of the fold sets) — **verified**. `WorktreeView.ts` retains no `collapsed`/`expandedRows`/`seeded`/`idleSeeded`/`restored` field; every render read goes through `this.fold.*`. Chair re-ran the ledger's own defeater as a scratch mutation (a private `collapsedCopy` set backing the two render reads at `WorktreeView.ts:1083,1206`): `pnpm exec vitest run src/webview/worktree/WorktreeView.test.ts` → **2 of 243 red**. Mutation created and deleted in one command; tree restored clean. The existing suite really is the independent oracle the ledger claims.
- **OBL-2** (nav refuses to focus an unrendered row) — **verified**. Chair re-ran the defeater (memoise `navRows()` at factory construction): `pnpm exec vitest run src/webview/worktree/worktreeView/keyboardNav.test.ts` → **2 of 6 red**, failing on `expect(fresh).toContain(document.activeElement)` at `keyboardNav.test.ts:94`. Mutation created and deleted in one command.
- **OBL-3** (a dropped result's timer is cancelled, not inert) — **verified by reading**. `actionNotices.ts:147-153` clears every non-held handle before deleting the key; `:356-363` does the same on dispose; `:129-135` clears before replacing with `"held"`; `armAutoDismiss` arms only under `!autoDismiss.has(key)`, so no handle is ever overwritten unclosed. The witness observes cancellation through `vi.getTimerCount()` — vitest's own scheduler, independent of the module's map — not merely an absence of effect. See F003 for the one precision gap.
- **OBL-4** (`draftModel` holds the answer with no DOM reference) — **verified**. `grep -E '\bdocument\b|\bHTMLElement\b|\bwindow\b|Event\b'` over `draftModel.ts`, `branchChoices.ts` and `foldState.ts` returns only two prose mentions inside `draftModel.ts`'s header comment. `vitest.config.ts` sets no `environment` and no `setupFiles`, so the default really is node and a DOM reference in these modules throws — the missing pragma is a live witness, not a formality. The deps closures were checked too: `refs: () => offeredRefs()` reads `currentRepo().refs?.list`, `repoId: () => draft.repoId`, `pullRequests: () => currentRepo().pullRequests` — plain data, no DOM. The DOM values these modules need (`nameInput.value`) are passed IN as arguments. The modules are headless in fact, not only textually.
- **OBL-5** (`src/types/messages.ts` frozen) — **verified**. Both forms run: `git diff --exit-code a4b4adf7..HEAD -- src/types/messages.ts` and the tree form. Both clean.

## Registry audit

`docs/DESIGN.md` exists but carries no `§ Cross-Cutting Invariants` section, so the touched-row set is the obligation ledger alone. Nothing owed.

## Verify gate

`bun run asm change verify-status decompose-worktree-webview` — all five tasks `[x] exit 0`. Task 2_1 carries an author-declared `suite changed` on `actionNotices.test.ts`; the chair checked the claim rather than accepting it: that file has exactly one commit (`ab0e44e1`), its assertion count is 10 as declared, and `git diff HEAD` on it is empty. The declaration is accurate.

## Preservation arithmetic

Base 7963 tests / 314 files → 8017 / 319. The five new suites contain exactly 12 + 23 + 9 + 6 + 4 = **54** `it(` blocks, which accounts for the delta with nothing left over. `git diff --name-only ... -- 'src/**/*.test.ts'` lists only the five new files, so no existing suite was edited, retargeted, or weakened — D3's "expected test moves" table stayed empty because nothing needed to move. No `.only`, no `.skip`, no `it.todo`, no async test in the new suites.

## Findings

### F001

- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: asm-review-reuse; asm-review-frontend; chair
- Class: machinery
- File: src/webview/worktree/worktreeView/keyboardNav.ts:48
- Title: Accessors on the new factory interfaces that no production code consumes
- Evidence: `grep -rn "setFocusedKey" src/` matches only the declaration at `keyboardNav.ts:48` and the implementation at `:265-267` — no caller anywhere, not even its own suite. `branchChoices.choice()` (`branchChoices.ts:176`) is called only by `branchChoices.test.ts:137`. `draftModel.usingChosen()` (`draftModel.ts:63`) is called only by `draftModel.test.ts:56` — production reads that state exclusively through `destinationCandidate()`. All three are new surface the pre-refactor code did not have.
- Impact: `setFocusedKey` is the specific footgun task 1_2 was written to close: it lets a future caller write `focusedKey` without the tab-stop pass that `focusRow`/`syncRovingTabindex` always pair with it, which is exactly the split ownership of roving focus the task consolidated. `choice()` and `usingChosen()` are milder — they let a test assert against internal state rather than through the seam production actually uses, so a change that broke the production path while leaving the accessor correct would stay green.
- Reach: none — `setFocusedKey` has no caller, so no shipped behaviour depends on it; the other two are read-only and test-scoped.
- Adjudicated-by: chair (finder was asm-review-reuse, corroborated independently by asm-review-frontend)
- Adjudication: Chair walked the grep itself across all of `src/`. `setFocusedKey` has zero references outside its own two lines. `setRowTabStop` and `choiceMode`, also flagged by the reuse specialist, were checked and are used internally by their own modules — exported but not dead, so they are excluded from this finding.
- Witness: `grep -rn "setFocusedKey" src/ | grep -v "worktreeView/keyboardNav.ts"` returns nothing — catches the accessor gaining a real caller (at which point the finding is superseded rather than fixed).
- SuggestedFix: Drop `setFocusedKey` from `KeyboardNav` until a caller needs it; if one ever does, give it a method that re-syncs the tab stops in the same call. For `choice()` and `usingChosen()`, either drop them or retarget the two assertions onto the production seam (`mode()` and `destinationCandidate()` respectively).
- Status: accepted
- Triage: Accepted in full, including the half the chair called milder. Checked each: `setFocusedKey` has no caller and is a WRITER that bypasses the tab-stop pass, which is the ownership split task 1_2 existed to close — dropped. `choice()` and `usingChosen()` are read-only, but their two assertions are redundant where they stand: `branchChoices.test.ts:137` asserts the refusal did not move the choice, which `mode()` states just as exactly, and the line above `draftModel.test.ts:56` already asserts `destinationCandidate()` equals `{ candidatePath }`, which entails `usingChosen` false. Retargeting loses no coverage and removes three members of new surface, so there is no reason to keep them.

### F002

- Severity: SUGGEST
- Confidence: HIGH
- Priority: P5
- Agent: asm-review-reuse
- Class: machinery
- File: src/webview/worktree/worktreeView/actionNotices.ts:28
- Title: The notices collaborator takes the whole `WorktreeViewDeps` where it uses a handful of callbacks
- Evidence: `ActionNoticesDeps` declares `view: WorktreeViewDeps` and the facade hands over the complete object at `WorktreeView.ts:268-276`, while the module reads only the notice-related callbacks (`onDismissActionResult` at `:95`, and the retry/output/prune handlers the notice buttons invoke).
- Impact: The extracted module stays coupled to the facade's entire dependency surface, so a field added to `WorktreeViewDeps` for unrelated view behaviour still widens this module's contract. It is the one cut of the five whose deps are not narrowed to what it uses.
- Reach: none — no behavioural difference; the same object was reachable as `this.deps` before the cut.
- Adjudicated-by: chair
- Adjudication: Chair refutes the WARN the specialist proposed and downgrades it. The original class read `this.deps` at exactly these points, so the coupling is not introduced by this diff — it is carried across unchanged, which is what a verbatim move is supposed to do. D5 admits no richer pattern, and there is no concrete defect, so this is a cohesion observation for the follow-up split, not an obligation on this change.
- Witness: none — no behavioural claim to falsify; this is a contract-surface observation.
- SuggestedFix: If a later change touches this module anyway, replace `view: WorktreeViewDeps` with the named callbacks it actually invokes and let the facade adapt. Not worth a commit on its own.
- Status: audit-backlog
- Triage: Valid and non-gating; the chair's own adjudication establishes it cannot falsify anything this change claims — the original class read `this.deps` at exactly these points, so the coupling is carried across, and the finding has `Witness: none` because there is no behavioural claim to falsify. Owner: the follow-up decomposition of `WorktreeView`'s render path, which is the next change to open `actionNotices.ts`. Reactivation trigger: that change reaching Stage 3, or any change that adds a field to `WorktreeViewDeps` for non-notice behaviour.

### F003

- Severity: SUGGEST
- Confidence: HIGH
- Priority: P5
- Agent: chair
- Class: machinery
- File: src/webview/worktree/worktreeView/actionNotices.test.ts:65
- Title: OBL-3's surviving-timer assertion names a count, not the key that survived
- Evidence: The cancellation test asserts `expect(notices.armedKeys()).toHaveLength(1)` and `expect(vi.getTimerCount()).toBeLessThan(armedBefore)`. Both are true if the WRONG timer was cancelled — if `w1`'s handle were cleared and `w2`'s left armed, the length is still 1 and the count still dropped.
- Impact: The witness proves that a timer was cancelled and that the map shrank, which is the half OBL-3 was written to catch. It does not prove the cancelled one was the dropped result's. A mutation that inverted the liveness test in `pruneAutoDismiss` would keep this test green.
- Reach: none — a witness-precision gap, not a defect in shipped code. `pruneAutoDismiss` (`actionNotices.ts:139-155`) was read directly and its `!live.has(key)` condition is correct.
- Adjudicated-by: asm-review-logic (independent of the chair, which found it)
- Adjudication: The adjudicator established that `armedKeys()` reads the module's `autoDismiss` map while `vi.getTimerCount()` queries vitest's fake-timer scheduler, so the two are genuinely independent oracles and the test is not self-oracled — clearing the map without `clearTimeout`, or vice versa, fails one of them. It confirmed the count-only assertion proves a cancellation occurred but does not identify the survivor, and classed the gap as test-strengthening with no reachable bug.
- Witness: `pnpm exec vitest run src/webview/worktree/worktreeView/actionNotices.test.ts` after inverting `!live.has(key)` to `live.has(key)` at `actionNotices.ts:148` — catches the wrong-timer-cancelled mutation only once the assertion names the key.
- SuggestedFix: Change the assertion to `expect(notices.armedKeys()).toEqual([resultKey(result("w1"))])`. One line, and it closes the last gap between the witness and the obligation.
- Status: accepted
- Triage: Accepted as a precision improvement; its stated defeater is REFUTED. I ran the exact mutation the finding names — `!live.has(key)` -> `live.has(key)` at `actionNotices.ts:148` — and the OBL-3 test goes red as it stands (`x cancels the timer of a result that is no longer there (OBL-3)`, 1 of 4). The chair's reasoning missed that the inverted prune DELETES the surviving result's entry, so the same `placeResults` call re-arms it and `armedKeys()` is length 2, not 1; the count assertion never gets the chance to be fooled. So there is no gap and no wrong-timer mutation that survives this witness. The one-line change is still taken, because naming the survivor states the obligation directly instead of inferring it from a count that happens to also move — but it closes nothing, and the round file should not record a hole that was never there.

### F004

- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: asm-review-contracts
- Class: machinery
- File: src/webview/worktree/worktreeView/foldState.test.ts:1
- Title: (rejected) `foldState.test.ts` missing the jsdom environment pragma
- Evidence: The specialist read task 1_1's plan step 5 as requiring `// @vitest-environment jsdom` on line 1 of all three `worktreeView/` suites, and `foldState.test.ts` opens with a descriptive comment instead.
- Impact: none.
- Reach: none.
- Adjudicated-by: chair
- Adjudication: Refuted on the task text. Task 1_1 plan step 5 reads "with `// @vitest-environment jsdom` on line 1 **if it touches the DOM**" — a conditional the specialist's brief (written by the chair) flattened into an unconditional requirement. `foldState.ts` references no DOM global and neither does its suite, so the condition is not met. Adding the pragma would be actively wrong: running under node is what proves this module headless, exactly as it does for `draftModel.ts` and `branchChoices.ts`. The suite's own header comment states this reasoning. The chair's ReviewContext caused this finding.
- Witness: none — no defect.
- SuggestedFix: none — do not add the pragma.
- Status: rejected
- Triage: rejected

### F005

- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: asm-review-contracts
- Class: machinery
- File: src/webview/worktree/worktreeView/foldState.test.ts:54
- Title: (rejected) The fold-state suite cannot witness OBL-1
- Evidence: The specialist observed that every test in `foldState.test.ts` constructs `createFoldState` directly and none instantiates `WorktreeView`, so a facade retaining its own fold sets would pass the whole suite.
- Impact: none — the observation about that one suite is true but does not bear on the obligation.
- Reach: none.
- Adjudicated-by: chair
- Adjudication: Refuted on the ledger. OBL-1's recorded witness is not `foldState.test.ts` — design.md names `X: pnpm exec vitest run src/webview/worktree/WorktreeView.test.ts`, with the rationale that the EXISTING suite is the independent oracle precisely because the new one cannot see the facade. The specialist adjudicated the wrong witness. The chair then ran the ledger's defeater rather than trusting either party: planting a private `collapsedCopy` set behind the two render reads at `WorktreeView.ts:1083,1206` turns 2 of `WorktreeView.test.ts`'s 243 tests red. Mutation created and deleted in one command, tree restored clean and confirmed by `git diff --exit-code`. OBL-1 is witnessed.
- Witness: `pnpm exec vitest run src/webview/worktree/WorktreeView.test.ts` with a facade-local `collapsed` copy planted — catches a retained facade copy; reproduced by the chair at 2/243 red.
- SuggestedFix: none — no defect.
- Status: rejected
- Triage: rejected

### F006

- Severity: SUGGEST
- Confidence: MEDIUM
- Priority: P5
- Agent: asm-review-logic; chair
- Class: machinery
- File: src/webview/worktree/WorktreeCreateDialog.ts:2434
- Title: (rejected) `retargetAfterChoice`'s fallback is now evaluated eagerly
- Evidence: The original computed `initialSafeAgentId(currentRepo().agents) === undefined ? "terminal" : "agent"` only inside the `if (!offered.some(...))` guard; the refactor passes it as an argument, so it runs on every call to `rebuildAfterOptions`.
- Impact: none established.
- Reach: none — `rebuildAfterOptions` has one production caller (the repository `<select>` change handler at `WorktreeCreateDialog.ts:1233`), whose first statement already evaluates `currentRepo().agents.length`; `initialSafeAgentId` is `agents.find(a => initialPosture(a) !== undefined)?.id` and `initialPosture` is `agent?.permissionChoices.find(c => !c.dangerous)?.id` — `Array.find` over plain declared data with no writes, callbacks, timers or throws. `retargetAfterChoice` ignores the fallback while the current choice is still offered.
- Adjudicated-by: asm-review-logic (independent of the chair and of the specialist that raised it)
- Adjudication: The adjudicator walked the single call path from `WorktreeView.ts:600-633` through `WorktreeCreateDialog.ts:1230-1241` to `:2426-2444` and read both `worktreeAgentBox.ts:53-60` and `draftModel.ts:163-170`. It found no user sequence in which the extra pure read changes the rendered form or the submitted `draft.openAfter`, and recommended not reporting it as a defect.
- Witness: none — no behavioural claim survives.
- SuggestedFix: none.
- Status: rejected
- Triage: rejected

## What the round checked and found clean

The caller's five named risks, each verified independently of the author's report:

1. **Accessor rewrite drift.** All 26 occurrences of the seven moved names in the head file are either `model.*()` calls or prose in comments — no bare-identifier read survives. The `!x &&` hazard D4 names has no site: `grep -E '!\w+\s*(&&|\?|\)|;|\|\|)'` over the dialog returns 17 hits and none is a moved name. The comment rewordings were read against what they now document and none misdescribes the code.
2. **`commit()` in `branchChoices.ts`.** The full `{new, existing, pr, prsUnavailable, out-of-range} × {already found, not found} × {heldBy set, unset} × {fromFork, not}` matrix was walked against `a4b4adf7`'s inline body. Every reachable cell agrees on `choice`, `nameInput.value`, `baseInput.value`, `forkHead`, `nameError` and `draft.branchMode`. The double `nameInput.value` write does collapse: `already` is found by `refs.find(ref => ref.name === named)`, so `already.name === named` holds by construction. The refusal path returns before `forkHead` is written in both versions, and `ignored` decisions still perform no `closeList`/`focus`/`syncDerived`.
3. **`draftModel` initial `openAfter`.** The original type-checked because TypeScript narrows a `const` with a union annotation to its initializer's type, so `initialAfterChoice` reads as `"terminal" | "agent"` and `"folder"` was never assignable in practice. The new ternary's `"folder"` arm is unreachable from the only call site (`WorktreeCreateDialog.ts:1069`), so it produces the identical value; it is exercised only by `draftModel.test.ts:104`. No caller can observe a difference.
4. **Ownership leaks.** `draft.path` is written only by `model.statePath()` and `draft.openAfter` only by `model.applyOpenAfter()`; the dialog and the model touch disjoint field sets through the `model.draft` alias. `repoAnchors` crosses as a reference to a `private readonly` map that is only `clear()`ed and `set()` — never reassigned — so it cannot go stale. The `data`/`element`/`disposed` accessors re-read at the same points the original read the fields, including inside the auto-dismiss timer callback, which still resolves the LIVE result by key rather than the captured object.
5. **Test vacuity.** No suite computes an expected value by calling the module under test, none asserts only that a call did not throw, and each of OBL-2/3/4 has a witness that fails under its own defeater — two of which the chair reproduced. The one gap found is F003.

Verbatim-move spot checks the chair ran directly: `resultKey`, `setupSummary`, `portSummary`, `provisionSummary`, `branchDeleteLine`, `branchDeleteReason` diff byte-identical against `a4b4adf7` modulo the `export` keyword; `armAutoDismiss`, `pruneAutoDismiss`, `groupEndFor` and the dispose loop likewise. `pruneStaleState`'s reordering (build all live sets, then call `fold.prune`) is safe because the original consumed `liveIds`/`liveRowIds`/`sessionRowIds` only after its loop completed.

## Sub-agents spawned

- asm-review-logic: `WorktreeCreateDialog.ts` accessor rewrite + `draftModel.ts` — behaviour drift — opus[1M]
- asm-review-logic: `branchChoices.ts` + its dialog call sites — decision-matrix equivalence — gpt-5.6-terra[1M]
- asm-review-frontend: `keyboardNav.ts` + `WorktreeView` focus/aria paths — roving focus, a11y — sonnet[1M]
- asm-review-logic: `foldState.ts` + `actionNotices.ts` + facade call sites — state ownership, timers — gpt-5.6-terra[1M]
- asm-review-reuse: whole diff — cohesion of the split, duplication, dead surface — gpt-5.6-luna[1M]
- asm-review-contracts: five new modules + five new suites — module contracts, test rigour — gpt-5.6-luna[1M]
- asm-review-logic (resumed): reach adjudication for the two chair-only findings — gpt-5.6-terra[1M]
