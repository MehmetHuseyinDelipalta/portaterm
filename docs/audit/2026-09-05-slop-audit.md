# Audit — slop: redundant code and tests

**Date**: 2026-09-05
**Base commit**: `8222f6dc`
**Companion to**: `2026-09-05-performance-hunt.md`.
**Method**: six axis agents plus one adversarial verifier; static reading only, no source edits and
no test runs. Line counts are estimates, not measured deletions. Read the provenance section before
relying on the counts.

## Executive summary

1. Reviewed 135 P1/P2 candidates; the verifier returned 125 CONFIRMED, 8 DOWNGRADED and 2 REJECTED before cross-axis merging.
2. Final cleanup pool: 119 distinct opportunities, about 2,461 net lines (~1% of the non-vendored TypeScript tree); estimates, not measured deletions.
3. Top cut 1: remove simulated webview integration coverage (T1-G07/G08), ~195 lines; low risk once the real module-owner tests remain.
4. Top cut 2: remove split persistence harness-only and subsumed cases (T1-F05/F06/F07), ~127 lines; low risk.
5. Top cut 3: prune dead exports, the unused showError seam and unused mock members (A-01..04, D-01/03/07, I-01/02), ~98 lines; low risk.
6. Top cut 4: share list-widget polyfills and provider contexts (U-16/U-17), ~90 lines; low-risk extraction, not a no-refactor delete.
7. Top cut 5: share SessionManager storage/headless fixtures (U-18), ~200 lines; low-to-medium risk, preserving generation and serialization controls.
8. Separate decisions: fork-mode retirement and renameTab contributions/retirement could remove up to ~338 more lines; timestamp unification (~8) changes behavior.
9. Keep error-code/hierarchy contracts, cache-version ratchets, per-file isolation, invariant gates and condition-based settlement; P3 candidates are excluded.
10. Static audit only: no source edits, commits, typecheck or tests; Axis1A needed concurrent-write reconciliation and a second verifier pass.

## Execution follow-up — 2026-09-06

The pool was revalidated against `0de80546` before editing. This follow-up supersedes the original priority and line-saving estimates for execution; the original sections remain as audit provenance.

### Applied

- Repaired every actionable non-observing assertion and stale live document identified by T1-A01, T1-F13, T1-G09, T2-03, T2-04 and C-01..05.
- Applied the validated Axis 1A/1B test cuts, including the now-reproducible T1-B08 replacement witness, while retaining or transferring every unique assertion found during the HEAD pass.
- Removed the validated dead/test-only surfaces in Axes 2, 3 and 5, including A-01..07, A-10..12, A-14..16, D-01/03/07..10 and I-01/02/05.
- Applied the behavior-neutral consolidation subset: U-01, U-02's exact plain converters, U-03..06's equivalent leaves, U-05, U-09/10, U-16/17, U-19's three exact helpers and U-20's scheduler-preserving pumps.
- After product review, resolved D-11 by retiring the unreleased receiver-only Vault fork path end-to-end; the shipped Vault remains Resume/Continue only.
- Resolved D-12 by contributing the already-implemented `renameTab` command to the Command Palette and root-tab context menu, with cold activation and no default keybinding.

### Retained or deferred after HEAD revalidation

| IDs | Disposition |
|---|---|
| A-08 | Keep. It is the exact composition production uses; deleting it only recreates the wrapper in tests or makes them noisier. |
| A-09 | Keep. Replacing it with lower-level test exports grows the test-only API and saves no lines. |
| U-02 remainder | Keep provider-specific context and the migration coercion asymmetry; only the exact plain converters were shared. |
| U-07 | Defer. The seven JSONL sites differ in partial/null failure, early termination, line numbering and buffering; the original ~80 was an opportunity ceiling. |
| U-08 | Withdraw the blanket cut. The predicates implement different lexical, resolved, case-folding and platform contracts. |
| U-11 | Defer pending a dedicated lifecycle/retry refactor; the ~180 estimate is not one safe deletion block. |
| U-18 / I-06 | Defer pending a dedicated fixture design. Current variants carry generation, serialization, addon, disposal and control semantics that a generic helper could hide. |
| I-08 | Keep. Moving single-consumer fixtures saves no lines and is not evidence of waste. |

### Product and behavior decisions

U-12 remains intentionally unmodified pending resolution of the timestamp input contract. Static cleanup evidence is not authorization for those behavior changes.

### Verification outcome

- Source delta: 493 added and 2,392 deleted tracked lines, plus 213 lines in seven new shared helper/test files — **~1,686 net source lines removed** across 150 source files. This is measured from the implementation diff, not the original estimate.
- `tsc --noEmit`: pass.
- Biome: all changed TypeScript files pass; the full `src/` check passes with 12 pre-existing warnings and one informational diagnostic.
- `fsDeletionGate`: pass.
- Every edited batch's scoped Vitest suites pass.
- Full `pnpm run test:unit`: **301 files, 7,822 tests passed**. The first run exposed a pre-existing stale `SetupTerminal` fake missing the live `retire()` method; adding that API-compatible no-op to the fake made its 17-test owner suite and the full gate pass.
- Subsequent D-11 retirement removed another 418 net lines across 54 files. Focused Vault/provider verification passed 529 tests; the post-retirement full suite passed **301 files, 7,801 tests**. TypeScript, Biome check mode, `fsDeletionGate` and `git diff --check` also passed; Biome retained seven pre-existing warnings in touched files.

## Scope, method and confidence

The inspected snapshot is branch `main`, initial commit `8222f6dc`. `src/vendor` is excluded. The tree contains 104,636 production/helper TypeScript lines and 143,920 test lines (248,556 total); 300 non-host, non-vendored Vitest files. Size is context, not evidence of waste.

Every source-rated P1/P2 was independently opened by the verifier after an incomplete first pass was sent back. Counts refer to candidate IDs, not unique defects: A-01=D-02, A-02=D-04 and A-03=D-05+D-06 are merged. U-06’s estimate excludes reader guards already counted in U-04. Superseded T1-01..12 are not additional findings.

**Final-priority normalization:** shared-helper extraction is P2 even when the axis called it P1. “CONFIRMED” establishes the stated redundancy or weak assertion; it does not certify a patch as safe. Estimates subtract moved/rewritten lines, preserve unique assertions, and include implementation judgement for larger extractions. No timing improvement or test-pass result is claimed.

The verifier’s 2,473-line estimate is reduced here to **2,461**: T1-A01 should be repaired rather than deleted (−4); U-12 is semantic timestamp normalization, outside behavior-preserving cleanup (−8). Round this to **~2,460**, not a precise savings promise. The separate product bucket is an upper bound, not authorization to delete features.

### Provenance and limitations

**Axis1A was reconciled after concurrent writes.** Its initial reader coordinator spawned seven nested readers and returned early; a mistaken restart ran against the same output path. The compiler and second pass reconciled Groups A–G plus three T1-H additions. The verifier checked all 110 entries for ID continuity, real files/ranges and traceability: no missing, duplicate or spliced entry was found. This checks final integrity, not that no useful draft observation was lost.

All Axis1A P1/P2 evidence was subsequently reopened, but its 34 P3 entries received **integrity/traceability checks only**. They are not independently evidence-verified and are rejected from the actionable pool; the same exclusion applies to the other axes’ P3 candidates. The requested all-entry evidence recheck was therefore not completed for P3. Do not use raw Axis1A counts as equally reliable evidence.

The seven-agent cap was breached: eight direct launches plus seven nested readers (15 total). The nested readers did not specify a model override; their actual resolved model IDs are unverified. This is disclosed rather than presented as compliant. Repeated unnecessary polling was stopped following user intervention. No further agents were launched for repair; the existing verifier was resumed.

Supporting scratch files: `VERDICTS.md` contains per-ID adjudication; `axis*.md` contain raw reports and superseded claims. **Use this report’s corrected cut/scope over a raw report.** `provenance.txt` records actual launch configuration.

## Prioritized findings by axis

Each finding records its final priority, verified evidence, precise cut or repair, estimated net deletion and risk. P1 = directly removable dead/redundant code; P2 = repair, consolidation or a cut requiring limited judgement. Zero-line entries improve truthfulness/locality rather than shrink the tree.

## Axis 1A — webview and vault tests

### T1-A01 [P2] A refusal test queries a selector that exists nowhere, so its "no confirm button" assertion cannot fail.

- **Location:** src/webview/worktree/WorktreeRemoveDialog.test.ts:202-205
- **Verifier:** CONFIRMED (range 202-205). **Evidence:** `grep -rn wt-dialog-confirm src` → one hit, the test line itself. The real confirm button is `.wt-btn--danger`.
- **Cut / repair:** Prefer fixing the selector to button.wt-btn--danger so the containment-refusal case becomes meaningful. Deleting the four-line case is the alternative estimate, not the recommended repair.
- **Estimated net lines removed:** ~0. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### T1-A03 [P2] Three tests assert the shared ContextMenuShell's own behaviour (first-item focus, arrow wrap, Escape restore, outside pointer-down) through the worktree menu; the shell has its own tests for each.

- **Location:** src/webview/worktree/WorktreeContextMenu.test.ts:176-202,214-223
- **Verifier:** CONFIRMED. **Evidence:** `contextMenuShell.test.ts` owns all four claims: `:52` "focuses the first item on open", `:58` "moves between items with the arrow keys, wrapping at both ends", `:72` "restores focus to the anchor row on Escape", `:101` "dismisses on a pointer-down outside itself". The three worktree cases drive them through a one-line delegate.
- **Cut / repair:** delete "lands focus on the first item and moves with the arrows", "returns focus to the anchor row on Escape", "closes on Escape and on a pointer-down outside".
- **Estimated net lines removed:** ~36. **Risk:** low — the worktree menu constructs the shell in its constructor; a broken delegation would already fail "raises the action and closes" (127-133) and every clickItem test.

### T1-A04 [P2] "closes before the action runs" re-tests the shell's close-then-act ordering and carries a 30-line harness that exists only for it.

- **Location:** src/webview/worktree/WorktreeContextMenu.test.ts:50-81,204-212
- **Verifier:** CONFIRMED. **Evidence:** `grep -n setupObservingAction` → defined at :51, used at :208 only. Shell test `:82` "is gone before the item's action runs" owns the ordering.
- **Cut / repair:** delete the case and `setupObservingAction`.
- **Estimated net lines removed:** ~41. **Risk:** low — same reasoning as A03; "raises the action and closes" keeps the menu-level close witness.

### T1-A05 [P2] Menu-level gating cases duplicate the builder-level cases for the same rules through the same code path.

- **Location:** src/webview/worktree/WorktreeContextMenu.test.ts:101-125 vs 512-521
- **Verifier:** CONFIRMED, credit 24→16. **Evidence:** The menu cases assert 2 things the builder case does not (`not.toContain("Reveal in Finder")`, `toContain("Remove Worktree…")`), so this is a fold: 18 lines out, 2 lines added to the builder test.
- **Cut / repair:** Fold the two redundant menu cases into builder coverage, transferring BOTH unique assertions: Reveal in Finder absent and Remove Worktree present. These assertions must not be discarded.
- **Estimated net lines removed:** ~16. **Risk:** low — the builder is the only producer; the menu's only added behaviour (prunableCount plumbing) is covered by 438-474.

### T1-A06 [P2] The mutating-action existence loop is subsumed by actual menu construction and item assertions.

- **Location:** src/webview/worktree/WorktreeContextMenu.test.ts:357-365; behavioral witness:331-346; src/webview/worktree/WorktreeController.ts:130
- **Verifier:** CONFIRMED (SUT cite :59-75 → :130). **Evidence:** The behavioural witness is 331-346, which builds the real menu and asserts "Lock Worktree" and "Remove Worktree…" render. The `toBeDefined` loop adds nothing.
- **Cut / repair:** delete the case.
- **Estimated net lines removed:** ~9. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### T1-A08 [P2] "re-sends the fingerprint the user was shown" is a strict subset of "[1_2] asks the user to type the name when a confirmable risk failed".

- **Location:** src/webview/worktree/WorktreeRemoveDialog.test.ts:293-304 vs 676-700
- **Verifier:** CONFIRMED. **Evidence:** 293-304 and 676-700 both `open(confirmableBlocker)`, type `SPIKE.branch`, click `.wt-btn--danger`, assert the same fingerprint; 676-700 additionally drives the wrong-name gate before and after. Strict superset.
- **Cut / repair:** delete 293-304.
- **Estimated net lines removed:** ~12. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### T1-A09 [P2] Two exact-duplicate pairs among the warning-box cases.

- **Location:** src/webview/worktree/WorktreeRemoveDialog.test.ts:571-575 (vs 262-271) and 721-726 (vs 602-607)
- **Verifier:** CONFIRMED. **Evidence:** (a) 571-575 `toMatch(/files written after you confirm/i)` ⊂ 262-271's `toContain("including files written after you confirm")` on the same fixture. (b) 721-726's `toContain("Force remove")` ⊂ 602-607's `toBe("Force remove")` on `button.wt-btn--danger`, same fixture.
- **Cut / repair:** delete 571-575 and 721-726.
- **Estimated net lines removed:** ~11. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### T1-A11 [P2] The empty-section sentence is asserted twice on the same model in two describes.

- **Location:** src/webview/worktree/WorktreeCreateDialog.test.ts:1812-1819 vs 2025-2033
- **Verifier:** CONFIRMED. **Evidence:** Both assert the same "No configured items or supported repository-root suggestions" on an `emptyProvisionModel()`; each has one unique extra assertion, so it is a fold (8 out, 1 in).
- **Cut / repair:** delete 1812-1819; move the `not.toContain("no .env")` line into 2025-2033.
- **Estimated net lines removed:** ~7. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### T1-A12 [P2] The save note's exact text is asserted identically in two describes.

- **Location:** src/webview/worktree/WorktreeCreateDialog.test.ts:2669-2678 vs 6570-6575
- **Verifier:** CONFIRMED. **Evidence:** Both assert `toBe("Added files, setup steps and ports apply to this create only.")` on `.wt-bring-save-note`; the SUT assigns it on one line.
- **Cut / repair:** delete 6570-6575 (the "file added to copy" describe has no copy-specific wording to pin).
- **Estimated net lines removed:** ~6. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### T1-A13 [P2] "still offers Create when the repository declares nothing to bring over" opens with no offer at all, so the section it names is hidden and the test is the default-state Create gate.

- **Location:** src/webview/worktree/WorktreeCreateDialog.test.ts:2006-2012
- **Verifier:** CONFIRMED. **Evidence:** Setup is `open({repos:[createDefaults()]})` with no `provisioning`, and 2040-2045 proves `.wt-bring` is `hidden` in exactly that state. The assertion is identical to 397-403's Create gate.
- **Cut / repair:** either delete, or open with `provisionOffer({ model: emptyProvisionModel() })` so the name is true.
- **Estimated net lines removed:** ~7. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### T1-A14 [P2] Two CSS-source assertions check only that a declaration/selector exists, not what it says.

- **Location:** src/webview/worktree/WorktreeCreateDialog.test.ts:5474,5495
- **Verifier:** CONFIRMED. **Evidence:** 5474 `toMatch(/font-size:/)` passes for any value; 5495 `toBeTruthy()` on `ruleOf(...)` passes for an empty block. The 8 neighbouring `ruleOf` uses each assert a specific declaration and are correctly left alone.
- **Cut / repair:** delete the two lines, or assert the declaration they mean (`font-size: 11px`; a `color:`/`font-size:` for the note).
- **Estimated net lines removed:** ~2. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### T1-B01 [P1] "writes a collapse the user made back to the store" passes before the click, and the click cannot collapse anything

- **Location:** src/webview/worktree/WorktreeController.test.ts:457-464
- **Verifier:** CONFIRMED. **Evidence:** Read 457-464. `WorktreeController.state.test.ts:69-72` asserts the strictly stronger `worktreeCollapsed?.length > 0` on the same seed write.
- **Cut / repair:** delete the test; its true content (the seed write) is already covered by WorktreeController.state.test.ts:69-73, and the real collapse round-trip by WorktreeView.test.ts:2114-2145.
- **Estimated net lines removed:** ~8. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### T1-B02 [P1] Two activatePane tests have byte-identical setup, call and expectation

- **Location:** src/webview/worktree/activatePane.test.ts:61-69
- **Verifier:** CONFIRMED. **Evidence:** 35-42 and 62-70 have identical statements and `toEqual`; only comments differ. `ActivatePaneDeps` has no `terminals` map.
- **Cut / repair:** delete 61-69; move its comment onto the test at 35-40 if the round-2 B2 provenance is worth keeping.
- **Estimated net lines removed:** ~9. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### T1-B03 [P1] Two function-existence assertions are subsumed by neighboring tests that invoke both dependencies.

- **Location:** src/webview/worktree/WorktreeController.test.ts:680-687
- **Verifier:** CONFIRMED (framing note). **Evidence:** Two `typeof … === "function"` checks. These *can* fail; the correct argument is subsumption (a dozen tests invoke both deps), not vacuity. Delete is still zero-risk.
- **Cut / repair:** delete the test.
- **Estimated net lines removed:** ~8. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### T1-B04 [P2] Two "offers no retry" cases are vacuous — the view was given no retry capability at all

- **Location:** src/webview/worktree/WorktreeView.test.ts:3291-3308
- **Verifier:** CONFIRMED. **Evidence:** `mount()` (70-90) supplies no `onRetryAction`; SUT gate `WorktreeView.ts:1702` is `actions: retry ? [...] : undefined` with `retry = … this.deps.onRetryAction`. No retry button can render for any outcome under this mount. 3393-3400 mounts `{onRetryAction: () => {}}` and covers both results.
- **Cut / repair:** delete both tests; 3393-3400 already covers both outcomes with the capability supplied.
- **Estimated net lines removed:** ~18. **Risk:** low — needs the reader to confirm 3393-3400 covers both `removeErrorResult` and `removeIndeterminateResult`, which it does in one `actionResults` array.

### T1-B06 [P2] "renders no preview line when there is no preview" duplicates two existing cases

- **Location:** src/webview/worktree/WorktreeView.test.ts:1558-1574
- **Verifier:** CONFIRMED. **Evidence:** `worktreeTreeView.test.ts:42-45` asserts `previewOf` null for both `{}` and `{preview:""}`; the view-level absent case survives at 1547-1556.
- **Cut / repair:** delete 1558-1574; keep 1547-1556 as the view-level witness.
- **Estimated net lines removed:** ~17. **Risk:** low — three surviving assertions across two files cover both `undefined` and `""`.

### T1-B07 [P2] "[1_4] holds the offer" is strictly subsumed by "[1_4] keeps the offer"

- **Location:** src/webview/worktree/WorktreeController.test.ts:1724-1738
- **Verifier:** CONFIRMED. **Evidence:** 1775-1793 performs the identical 5-call sequence plus one extra `handleCreateDefaults`, asserting the same `toHaveLength(5)`. Nothing fails the first that does not fail the second.
- **Cut / repair:** delete 1724-1738; the survivor's comment already explains the offer/destination split.
- **Estimated net lines removed:** ~15. **Risk:** low — judgement call on keeping an "arrives" case separate from a "survives" case, but the setups are identical so no path is lost.

### T1-C01 [P1] Dead test helper `_mount` in VaultPanel.test.ts is never called

- **Location:** src/webview/vault/VaultPanel.test.ts:499-507
- **Verifier:** CONFIRMED. **Evidence:** `grep -n _mount` → one hit, the definition at 499.
- **Cut / repair:** delete the `_mount` function.
- **Estimated net lines removed:** ~9. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### T1-C02 [P1] The no-post/no-label context-menu case is redundant after the preceding menu-absence assertions.

- **Location:** src/webview/vault/VaultContextMenu.test.ts:182-187
- **Verifier:** CONFIRMED (framing note). **Evidence:** The preceding test asserts `.vault-context-menu` null and `isOpen() === false`; `labels(host)` queries inside that node. The `posts` half is vacuous; the `labels` half is subsumption.
- **Cut / repair:** delete the whole `it`; the preceding test (171-180) already proves menu absence and `menu.isOpen() === false`.
- **Estimated net lines removed:** ~7. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### T1-C03 [P2] FloatingPreviewShell "attaches no key listener" test never observes a key listener, and duplicates the Escape test

- **Location:** src/webview/vault/FloatingPreviewShell.test.ts:75-83
- **Verifier:** CONFIRMED. **Evidence:** 75-83's body is `make()` (no `onKeyDown`), render, show, Escape, `expect(onRequestClose).toHaveBeenCalledTimes(1)` — the byte-identical assertion of 136-142. Nothing observes a listener. The real witness is 56-73, which counts `onKeyDown` invocations.
- **Cut / repair:** delete the test, or (if the no-listener claim matters) replace with a spy on `document.addEventListener` counting keydown registrations.
- **Estimated net lines removed:** ~9. **Risk:** low — the Escape path stays covered by 136-142.

### T1-C04 [P2] VaultPanel.test.ts re-asserts VaultContextMenu's whole item set and entryId-only posting

- **Location:** src/webview/vault/VaultPanel.test.ts:518-544, 571-598
- **Verifier:** CONFIRMED, credit 55→44; one sub-claim REJECTED. **Evidence:** 518-533's exact 7-label array is duplicated verbatim at `VaultContextMenu.test.ts:71-84`; 571-598 is subsumed by `:110-126` (4 labels, exact ordered `toEqual`, same no-path check). But 535-544 must be kept — it asserts an exact 4-element array where the menu test asserts only three `not.toContain` plus an `hr` count, so it is strictly stronger.
- **Cut / repair:** Delete only VaultPanel.test.ts:518-533 and 571-598 after preserving right-click wiring, Cursor re-render and dismissal coverage. KEEP 535-544: its exact four-element label array is stronger than the supposed replacement.
- **Estimated net lines removed:** ~44. **Risk:** low — item-set regressions still fail VaultContextMenu.test.ts; the panel→menu edge stays covered.

### T1-C05 [P2] The create-worktree control's body gate is asserted in three places

- **Location:** src/webview/vault/VaultPanel.test.ts:4194-4201, 4289-4303
- **Verifier:** CONFIRMED, credit 25→22. **Evidence:** 4194-4201 ⊂ 4102-4126's folderToggle half; 4289-4293's `toBeDefined` is subsumed because 4295-4303 dereferences `btn(host)?.hidden` and asserts `.toBe(true)`; 4295-4303 ≡ 4216-4232 minus the click. 4305-4314 (availability gate) correctly kept.
- **Cut / repair:** delete 4194-4201, 4289-4293, 4295-4303.
- **Estimated net lines removed:** ~22. **Risk:** low — every assertion removed exists verbatim in a surviving test.

### T1-C06 [P2] "idempotent + inert afterwards" — the `not.toThrow` cannot fail for the reason the name gives

- **Location:** src/webview/vault/VaultPanel.test.ts:3991-3997
- **Verifier:** CONFIRMED. **Evidence:** Opened 3981-3997. If the listeners leaked, the survivors (`ContextMenuShell.onDocKeyDown`, `FloatingPreviewShell.onDocKeyDown/onDocPointerDown`) are all guarded idempotent no-ops, so the leak the comment names still passes. Nothing observes inertness.
- **Cut / repair:** Keep disposal-close/idempotence coverage; remove only the unobserving stray-event block, or replace it with a real listener-removal witness. Do not claim another no-post/no-DOM assertion proves the listeners were detached.
- **Estimated net lines removed:** ~7. **Risk:** low — dispose's real effect is asserted above it, and by "closes an open preview via the dispose chain" (3971-3979).

### T1-C07 [P2] messageActions "is offered on an assistant message" duplicates the hidden-flag branch already asserted

- **Location:** src/webview/vault/messageActions.test.ts:335-339
- **Verifier:** CONFIRMED. **Evidence:** 335-339 asserts `action("continue")?.hidden === false` on an assistant message; 341-349 asserts the same on a user message through the same role-blind `action.hidden = !isMessage`.
- **Cut / repair:** delete the `it` at 335-339.
- **Estimated net lines removed:** ~6. **Risk:** low — no branch loses its only witness (the `!isMessage` false-branch is covered by the compaction case at 192-209, which asserts `action("continue")?.hidden === true`).

### T1-D01 [P1] `build: cursor` asserts the identical canonical-Resume build twice under two names

- **Location:** src/vault/LaunchBuilder.test.ts:285-295
- **Verifier:** CONFIRMED. **Evidence:** 235-246 and 285-295: byte-identical 6-arg `build(...)`; the second asserts only `spec.args`.
- **Cut / repair:** delete the second `it` (285-295); the first already names both facets.
- **Estimated net lines removed:** ~11. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### T1-D02 [P1] "leaves resume and fork argv untouched" re-asserts two earlier assertions verbatim

- **Location:** src/vault/LaunchBuilder.test.ts:191-194
- **Verifier:** CONFIRMED. **Evidence:** 190-193's two assertions are verbatim lines 31 and 53 with the same `entry()`.
- **Cut / repair:** delete the `it` at 191-194.
- **Estimated net lines removed:** ~5. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### T1-D03 [P1] Two `getEntry` tests are strict subsets of the two `lookupEntry` tests above them

- **Location:** src/vault/VaultService.test.ts:230-242
- **Verifier:** CONFIRMED. **Evidence:** 230-234 / 236-242 are strict subsets of 179-186 / 197-206.
- **Cut / repair:** delete both `it`s at 230-234 and 236-242.
- **Estimated net lines removed:** ~13. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### T1-D04 [P1] The same no-anchor case is asserted twice, in two describes

- **Location:** src/vault/ContinuationPrompt.test.ts:127-131
- **Verifier:** CONFIRMED. **Evidence:** Verified `const claude = entry` at :141 — same fixture, same path, same two assertions.
- **Cut / repair:** delete one of the two (127-131 reads as the weaker-named one).
- **Estimated net lines removed:** ~5. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### T1-D05 [P2] registry "single source, no gap" is fully subsumed by the two `it`s around it

- **Location:** src/vault/registry.test.ts:27-34
- **Verifier:** CONFIRMED. **Evidence:** `AGENT_DEFINITIONS` is derived from `VAULT_AGENT_IDS` (registry.ts:229), so line 28 is implied by line 24; line 30's `toBeDefined` is subsumed by 36-40's `?.id === id`.
- **Cut / repair:** delete the `it` at 27-34; move its "single source" comment onto the `it` at 22-25.
- **Estimated net lines removed:** ~8. **Risk:** low — the invariant is still enforced by lines 24 and 38, plus the `satisfies Record<VaultAgentId, …>` at registry.ts:224.

### T1-D06 [P2] watchTargets' find-by-glob test adds nothing over the whole-set test right below it

- **Location:** src/vault/VaultService.watchTargets.test.ts:18-32
- **Verifier:** CONFIRMED. **Evidence:** The second `it` pins the whole 4-element set with `toEqual` plus `toHaveLength(8)`, and its own comment says the `find`-by-glob form above is the weaker one.
- **Cut / repair:** delete the first `it` (18-32); if the suffix strictness matters, change those two matchers in the surviving test to `expect.stringMatching(/sessions$/)` / `/opencode$/`.
- **Estimated net lines removed:** ~15. **Risk:** low — one matcher is loosened unless the stringMatching swap is made.

### T1-D07 [P2] Four cache tests spell out one `version === 8` equality; two of them build irrelevant fixtures

- **Location:** src/vault/VaultCacheStore.test.ts:152-208
- **Verifier:** CONFIRMED. **Evidence:** `grep -n version VaultCacheStore.ts` → lines 6, 218, 231 only; the sole logic is `parsed.version === VAULT_CACHE_VERSION`. All four tests pass for one reason; the v1/v3 `entries` fixtures are never inspected.
- **Cut / repair:** collapse to one `it.each([1, 3, 5, 6, VAULT_CACHE_VERSION + 1])("discards version %s", …)` over `doc()`, keeping the two explanatory comments above it.
- **Estimated net lines removed:** ~45. **Risk:** low — the surviving parameterized case covers every version the four named.

### T1-D08 [P2] Two `readSqlite` tests assert no-db from the same dep shape

- **Location:** src/vault/sqlite.test.ts:123-130
- **Verifier:** CONFIRMED. **Evidence:** 95-102 (`exists: p => p.includes(":memory:")`) and 123-130 (`exists: async () => false`) both reach the boolean seam with no `access` dep. The two `access`-supplying tests between them are not duplicates and stay.
- **Cut / repair:** keep one (the 123-130 wording explains the seam better) and delete the other, or give 95-102 an `access: async () => "absent"` so the two seams differ.
- **Estimated net lines removed:** ~8. **Risk:** low.

### T1-D09 [P2] Two snapshot-failure tests are covered by the later "both entry points" pair

- **Location:** src/vault/sqlite.test.ts:429-438
- **Verifier:** CONFIRMED, credit 21→23. **Evidence:** 1008-1019 runs `readSqlite` and `withSqliteSnapshot` against `failingDeps` asserting `query-error` + `rows: []` — strictly subsuming 429-438 and 487-497.
- **Cut / repair:** delete 429-438 and 487-497; the 980-1020 describe already pairs the open-refusal and generic-failure mappings across both entry points.
- **Estimated net lines removed:** ~23. **Risk:** low — the surviving pair asserts the same statuses on both entry points.

### T1-D10 [P2] "lets the next reader retry after a failed production" is a subset of "propagates a production failure"

- **Location:** src/vault/snapshotPool.test.ts:241-257
- **Verifier:** CONFIRMED, credit 17→19. **Evidence:** 167-184 does the reject + second borrow + `toHaveLength(1)` plus `fs.access(after.file)` resolves; 241-257 is that minus the fs assertion.
- **Cut / repair:** delete 241-257.
- **Estimated net lines removed:** ~19. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### T1-D11 [P2] "returns null when the reader confirmed nothing" flips a flag the guard never reaches

- **Location:** src/vault/ContinuationPrompt.test.ts:133-135
- **Verifier:** CONFIRMED. **Evidence:** SUT `ContinuationPrompt.ts:56-59` returns null on the trimmed-empty instruction before `confirmIntent` is read at :112+. So the flag is inert and this is 91-93 again.
- **Cut / repair:** delete 133-135, or keep one and rename it "returns null for an empty instruction, whatever the confirm flag".
- **Estimated net lines removed:** ~3. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### T1-D12 [P2] "carries the reader's instruction rather than the stored text" checks only the half already covered

- **Location:** src/vault/ContinuationPrompt.test.ts:99-102
- **Verifier:** CONFIRMED. **Evidence:** 25-35 already asserts `toContain(<its own instruction>)`. `ContinuationRequest` carries no stored message, so "rather than the stored text" is unexpressible.
- **Cut / repair:** delete 99-102 (the property it names cannot be expressed with this API).
- **Estimated net lines removed:** ~4. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### T1-E01 [P1] `expect(unsupported).toBeTruthy()` asserts the test helper's return value (a path string) — cannot fail.

- **Location:** src/vault/readers/cursorReader.test.ts:1292-1293
- **Verifier:** CONFIRMED. **Evidence:** `writeChat` always returns `path.join(...)`, a non-empty string.
- **Cut / repair:** delete L1293 (keep the `await writeChat(...)` call, drop the `const unsupported =` binding).
- **Estimated net lines removed:** ~1. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### T1-E02 [P1] "returns a partial detail with an empty timeline and a limited-reason notice" is fully subsumed by the next test's `toEqual(limitedDetail(...))` + `expectDetailContract`.

- **Location:** src/vault/readers/cursorReader.test.ts:1456-1466
- **Verifier:** CONFIRMED. **Evidence:** The next test asserts `toEqual(limitedDetail(...))` + `expectDetailContract`, covering every field.
- **Cut / repair:** delete the test at L1456-1466.
- **Estimated net lines removed:** ~11. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### T1-E03 [P1] `readCursorEntry` unknown-id → null is asserted twice under two names.

- **Location:** src/vault/readers/cursorReader.test.ts:788-790
- **Verifier:** CONFIRMED (adversarial check passed). **Evidence:** Checked whether `"nope"` takes a different branch than the UUID: `CURSOR_CHAT_ID_RE = /^[A-Za-z0-9._-]{1,200}$/` accepts both ⇒ same absent path.
- **Cut / repair:** delete L788-790 (the copy inside the `lookupCursorEntry` describe documents why it is nullable).
- **Estimated net lines removed:** ~3. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### T1-E04 [P1] `readClaudeEntry` missing-session → null is asserted twice under two names.

- **Location:** src/vault/readers/claudeReader.test.ts:141-143
- **Verifier:** CONFIRMED. **Evidence:** Same function, same missing-id path, different fixture root.
- **Cut / repair:** delete L141-143.
- **Estimated net lines removed:** ~3. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### T1-E05 [P1] "correlates by agent when the source rewrote the child's title" is a weaker re-run of "still falls back to the agent for a child whose title the source rewrote".

- **Location:** src/vault/readers/opencodeReader.detail.test.ts:1120-1125
- **Verifier:** CONFIRMED. **Evidence:** 1044-1053 and 1120-1125: same `mapOpencodeRows` shape; the second asserts a strict subset.
- **Cut / repair:** delete L1120-1125.
- **Estimated net lines removed:** ~6. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### T1-E07 [P1] "keeps a record whose filename stem agrees with its payload" restates what every positive test in the file already proves.

- **Location:** src/vault/readers/runningSessions.test.ts:374-377
- **Verifier:** CONFIRMED. **Evidence:** The helper always names the file from its first arg; every positive test already writes an agreeing stem.
- **Cut / repair:** delete L374-377.
- **Estimated net lines removed:** ~4. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### T1-E08 [P2] Trailing describe "a child query that failed is not a session that delegated nothing" re-asserts `partial` falsy for children-ok-empty, already asserted twice earlier in the file.

- **Location:** src/vault/readers/opencodeReader.detail.test.ts:959-980
- **Verifier:** CONFIRMED, credit 22→24. **Evidence:** 820 and 489 assert `partial).toBeFalsy()` on the same children-ok-empty routing; `finalizeDetail` only ever sets `partial: true` or omits it, so falsy ⟺ undefined.
- **Cut / repair:** delete L959-980 (and the describe wrapper). If the negative-pair reading matters, move one `expect(detail?.partial).toBeUndefined()` into L780-821 instead.
- **Estimated net lines removed:** ~24. **Risk:** low — the property stays covered at L820 and L489.

### T1-E09 [P2] "opens a Codex child id through the normal detail path" is the rollout-by-filename test again with a different label; `readCodexDetail` has no child-id branch.

- **Location:** src/vault/readers/codexReader.detail.test.ts:451-465
- **Verifier:** CONFIRMED. **Evidence:** 451-465 (`no-db`) and 308-328 (`no-sqlite3`) both write a rollout jsonl named by the id and assert entryId + firstPrompt; 308-328 asserts strictly more.
- **Cut / repair:** delete L451-465.
- **Estimated net lines removed:** ~15. **Risk:** low — the only input delta (`no-db` vs `no-sqlite3`) is the same branch; if a reviewer wants both statuses covered, fold `no-db` into L308 as an `it.each` (net negative lines).

### T1-E10 [P2] Standalone "satisfies the shared detail contract" is subsumed by the paging test: `expectLimitGrowth` calls `expectDetailContract` on every read, including the final non-truncated one.

- **Location:** src/vault/readers/claudeReader.detail.test.ts:371-381
- **Verifier:** CONFIRMED. **Evidence:** `detailContract.testkit.ts:66,75` runs `expectDetailContract` on every read and returns on the first non-truncated one, so the standalone contract test is a subset of the walk's last round.
- **Cut / repair:** merge L371-381 into L383-397 as the siblings do (one `it("satisfies the shared detail contract, and pages to the end")`), dropping the 2-record fixture.
- **Estimated net lines removed:** ~11. **Risk:** low — the small-fixture contract check is a strict subset of the walk's last round.

### T1-F01 [P1] TabBar.test.ts re-tests the same visibility rule under four extra names, with byte-identical setups

- **Location:** src/webview/TabBar.test.ts:233-258, 938-947
- **Verifier:** CONFIRMED. **Evidence:** 235-240 ≡ 64-69; 242-250 ≡ 71-79; 252-258 ≡ 56-62 + a `tabs.length` line; 938-947 is a third copy of the 2-tab case. Nothing is removed in the "after removal" block.
- **Cut / repair:** Delete redundant after-removal cases at 233-258, transferring the zero-tab row count to 56-62; delete the duplicate two-tab case at 938-947 while keeping the original 71-79 witness. The 919-936 matrix itself only covers sizes zero and one.
- **Estimated net lines removed:** ~34. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### T1-F02 [P2] "renders updated tab names from OSC title changes" never involves an OSC title change — it is the plain name test with different strings

- **Location:** src/webview/TabBar.test.ts:298-308
- **Verifier:** CONFIRMED. **Evidence:** 298-308 is structurally identical to 106-116 with different string literals; one `renderTabBar`, no mutation, no re-render.
- **Cut / repair:** delete 298-308.
- **Estimated net lines removed:** ~13. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### T1-F05 [P1] Four "layout persistence" tests in splitIntegrationEdgeCases call no production code at all

- **Location:** src/webview/splitIntegrationEdgeCases.test.ts:250-306
- **Verifier:** CONFIRMED. **Evidence:** Bodies build `new Map()` in the test, never write to it, assert `size === 0`; the `try { … throw } catch {}` is dead. No SUT import participates.
- **Cut / repair:** delete 250-306 wholesale.
- **Estimated net lines removed:** ~57. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### T1-F06 [P2] `getAllSessionIds` is re-tested in a second file with the same tree shapes

- **Location:** src/webview/splitIntegrationEdgeCases.test.ts:311-342
- **Verifier:** CONFIRMED. **Evidence:** `SplitModel.test.ts:89-108` already asserts leaf, flat branch and nested branch against the same `getAllSessionIds`; the extra `toHaveLength` lines restate the preceding `toEqual`.
- **Cut / repair:** delete the `resize propagation` describe (311-342); if the 4-leaf shape is wanted, add one case to SplitModel.test.ts:89-108.
- **Estimated net lines removed:** ~32. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### T1-F07 [P2] The split layout round-trip repeats a stronger SplitModel round-trip test; it does import production helpers.

- **Location:** src/webview/splitIntegrationEdgeCases.test.ts:210-248
- **Verifier:** CONFIRMED, evidence corrected. **Evidence:** `SplitModel.test.ts:149-159` does `toEqual(original)` on a nested branch with both ratios, subsuming every field checked. But the report's "No AT module participates in the serialization" is wrong — `createBranch`, `createLeaf` and `getAllSessionIds` are production imports. Survives as subsumption, not as "no SUT".
- **Cut / repair:** Delete only splitIntegrationEdgeCases.test.ts:210-248; keep SplitModel.test.ts:149-159’s nested round-trip with both ratios. This is subsumption, not absence of a SUT.
- **Estimated net lines removed:** ~38. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### T1-F08 [P1] `createLeaf` "has type discriminant 'leaf'" is subsumed by the `toEqual` in the test above it

- **Location:** src/webview/SplitModel.test.ts:29-32
- **Verifier:** CONFIRMED. **Evidence:** 24-27's `toEqual` already pins `type`.
- **Cut / repair:** delete 29-32.
- **Estimated net lines removed:** ~5. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### T1-F09 [P1] Exact duplicate drop test — "OS-drag without Shift remains a no-op" repeats "does not post message on drop without Shift key"

- **Location:** src/webview/DragDropHandler.test.ts:376-381
- **Verifier:** CONFIRMED. **Evidence:** 260-264 and 376-381: same dataTransfer, same `shiftKey:false`, same `not.toHaveBeenCalled()`.
- **Cut / repair:** delete 376-381.
- **Estimated net lines removed:** ~7. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### T1-F10 [P2] "OS-drag with Shift still uses extractPathsFromDrop + active pane" repeats the Shift+drop test minus its overlay half

- **Location:** src/webview/DragDropHandler.test.ts:383-391
- **Verifier:** CONFIRMED. **Evidence:** Identical dataTransfer and identical `toHaveBeenCalledWith` as 243-258, which additionally asserts the overlay teardown.
- **Cut / repair:** delete 383-391; the "(existing behavior unchanged)" intent is already carried by 243-258.
- **Estimated net lines removed:** ~10. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### T1-F11 [P2] `waitingPanes()` test asserts the set the test just handed in, and the accessor has no production caller

- **Location:** src/webview/tabBarScope.test.ts:351-359; src/webview/tabBarScope.ts:179
- **Verifier:** CONFIRMED (accessor confirmed dead). **Evidence:** `grep -rn waitingPanes src` → only the test line 359 and the definition `tabBarScope.ts:179`. The test reads back the field `setAttribution` just wrote. 9 test lines + ~5 accessor lines.
- **Cut / repair:** Remove the read-back test and otherwise unreferenced waitingPanes accessor only after keeping behavioral attribution/marker tests. Check the whole test block, not the outdated 351-355 cut range.
- **Estimated net lines removed:** ~14. **Risk:** low — removing the accessor is a source edit; the test deletion alone is zero-risk.

### T1-F12 [P2] WebviewStateStore.searchMode tests exercise a generic object spread three times for a field the store has no code for

- **Location:** src/webview/state/WebviewStateStore.searchMode.test.ts:22-62
- **Verifier:** CONFIRMED, credit 35→15. **Evidence:** `grep -c searchMode WebviewStateStore.ts` → 0; the SUT has no such code. Lines 34-35 compute `?? "filter"` in the test body over an `undefined` the test wrote. But test 1 (legacy blob) and test 2 (round-trip) both earn their keep, so only test 3 (~13) plus those 2 lines go.
- **Cut / repair:** Keep the legacy-blob and round-trip cases. Remove only the third test that computes the fallback in its own body and the redundant test-side fallback at lines 34-35.
- **Estimated net lines removed:** ~15. **Risk:** low — the surviving case still pins that `updateState`/`getState` do not strip unknown nested fields.

### T1-F13 [P2] "preserves multi-byte unicode characters intact" documents surrogate pairs and then tests a BMP character

- **Location:** src/webview/fileTree/search/__tests__/renderHighlightedText.test.ts:76-86
- **Verifier:** CONFIRMED, credit 11→0. **Evidence:** `日` is a single UTF-16 code unit, so the lone-surrogate failure the comment describes is unreachable with `{start:0,end:1}`. Correction of a misleading comment; deleting would lose the only non-ASCII case.
- **Cut / repair:** Keep the non-ASCII case; correct its misleading surrogate-pair comment/name. A real surrogate case would need an astral character and a two-code-unit range.
- **Estimated net lines removed:** ~0. **Risk:** low — a name/comment that overstates the assertion is what a later reader trusts.

### T1-G01 [P1] "popup.onDismiss callback is invoked on self-dismiss paths" is the union of two neighbouring tests with the unmount assertion dropped.

- **Location:** src/webview/links/HoverPreviewPopup.test.ts:440-456
- **Verifier:** CONFIRMED. **Evidence:** 440-456 repeats both stimuli and asserts only the onDismiss counts; 402-412 / 476-484 additionally assert unmount.
- **Cut / repair:** delete 440-456.
- **Estimated net lines removed:** ~17. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### T1-G02 [P1] "link.leave still dismisses when cursor never reaches the popup" is byte-for-byte the same scenario as "hides the popup on leave".

- **Location:** src/webview/links/HoverPreviewController.test.ts:549-572
- **Verifier:** CONFIRMED. **Evidence:** 346-371 and 549-572: identical construction and call order; the second omits the intermediate `showCalls` assert.
- **Cut / repair:** delete 549-572 (or fold its title into 346's).
- **Estimated net lines removed:** ~24. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### T1-G03 [P1] "dedups suffixed against bare on same span" asserts what "path:N" already asserts.

- **Location:** src/webview/links/filePathParser.test.ts:385-389
- **Verifier:** CONFIRMED. **Evidence:** Both `toHaveLength(1)` + the same `text`; 21-26's length assertion is already the dedup witness.
- **Cut / repair:** delete 385-389.
- **Estimated net lines removed:** ~5. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### T1-G04 [P1] Two applyTitleChange tests are strict subsets of "does not re-render when only the spinner frame advanced".

- **Location:** src/webview/terminal/titleSignature.test.ts:44-49, 131-139
- **Verifier:** CONFIRMED. **Evidence:** 44-49 is 51-58's first statement; 131-139 is 51-58 with more frames from the same `[⠀-⣿]` class.
- **Cut / repair:** delete 44-49 and 131-139.
- **Estimated net lines removed:** ~17. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### T1-G05 [P1] "begins with row-overlay + SGR reset" re-asserts a prefix of the exact string asserted three tests earlier.

- **Location:** src/webview/terminal/restoreDivider.test.ts:32-35
- **Verifier:** CONFIRMED. **Evidence:** `startsWith("\r\x1b[2K\x1b[0m")` is a literal prefix of the exact `toBe` three tests above, same input.
- **Cut / repair:** delete 32-35 (move its comment onto 9-12 if the "overwrites inherited prompt row" note is wanted).
- **Estimated net lines removed:** ~4. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### T1-G06 [P1] "does not send ack when accumulated chars are below threshold" is lines 26-27 of the next test.

- **Location:** src/webview/flow/FlowControl.test.ts:13-20
- **Verifier:** CONFIRMED. **Evidence:** 13-20 is character-for-character the first two statements of 22-36.
- **Cut / repair:** delete 13-20.
- **Estimated net lines removed:** ~8. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### T1-G07 [P1] Two webviewFlows “integration” cases assert test-authored Map mutations and configuration assignment rather than production wiring.

- **Location:** src/webview/integration/webviewFlows.test.ts:79-133, 172-219
- **Verifier:** CONFIRMED. **Evidence:** 172-219 writes `term.options.fontSize = store.currentConfig.fontSize` in its own loop ("like main.ts would", :207) then asserts it back. 79-133 sets/deletes a public `Map` and reads the field back.
- **Cut / repair:** delete both describes.
- **Estimated net lines removed:** ~103. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### T1-G08 [P2] The remaining two webviewFlows "integration" tests wire modules together with glue the test writes, so they re-run two unit tests under one name.

- **Location:** src/webview/integration/webviewFlows.test.ts:22-77, 135-170
- **Verifier:** CONFIRMED. **Evidence:** 22-77's `onOutput` handler is authored in the test; the only production code is `createMessageRouter` dispatch + `FlowControl.ackChars`, each unit-tested. 135-170 is SplitModel + `Map` wrappers plus a bare `expect(api.setState).toHaveBeenCalled()` with no payload check. main.ts is never imported.
- **Cut / repair:** After T1-G07, remove the remaining simulated-glue cases and file scaffolding only while retaining MessageRouter, FlowControl, SplitModel and persistence payload coverage in their owners. The file imports production leaf modules but not the production main.ts wiring.
- **Estimated net lines removed:** ~92. **Risk:** low — if a real main.ts-level wiring test is wanted it should import main's wiring, which this file does not.

### T1-G09 [P2] "render() … uses getTheme by default" cannot observe whether getTheme is consulted.

- **Location:** src/webview/links/markdownRenderer.test.ts:81-94
- **Verifier:** CONFIRMED, credit 4→0. **Evidence:** Both assertions are `toMatch(/shiki/)`, which a hard-coded theme also satisfies; the test's own comment says "non-strict assertion". A rewrite to `expect(elLight.innerHTML).not.toBe(elDark.innerHTML)`, not a deletion.
- **Cut / repair:** replace 86 and 89-93 with `expect(elLight.innerHTML).not.toBe(elDark.innerHTML)`; that is the only assertion that makes the name true.
- **Estimated net lines removed:** ~0. **Risk:** low — a small edit, not a deletion.

### T1-G10 [P2] "whenHighlighterReady resolves after the highlighter loads" cannot fail on the ordering it names.

- **Location:** src/webview/links/syntaxRenderer.test.ts:133-138
- **Verifier:** CONFIRMED. **Evidence:** SUT `syntaxRenderer.ts:199-201` is `getHighlighter().then(() => undefined)`, and `getHighlighter()` starts creation itself, so `resolves.toBeUndefined()` holds with or without preload; the `isHighlighterReady()` half is the previous test (127-131).
- **Cut / repair:** delete 133-138, or make it real: resolve-order test that asserts `isHighlighterReady()` is true inside the `.then` of `whenHighlighterReady()` without awaiting preload first.
- **Estimated net lines removed:** ~7. **Risk:** low.

### T1-G11 [P2] Three paneEvidenceReporting tests cross no seam; each repeats a unit test that the file's own header says the unit suite owns.

- **Location:** src/webview/integration/paneEvidenceReporting.test.ts:215-223, 243-254, 256-265
- **Verifier:** CONFIRMED. **Evidence:** Opened 213-223 and 241-266; both describe bodies are as reported.
- **Cut / repair:** delete 215-223 and the whole `forget drops local dedup state only` describe (242-266).
- **Estimated net lines removed:** ~31. **Risk:** low — every claim remains in the two unit files.

### T1-G12 [P2] "drops a nested response after dispose without throwing" has no input that makes it fail.

- **Location:** src/webview/links/SubagentPreviewPopup.test.ts:173-182
- **Verifier:** CONFIRMED, credit 10→13. **Evidence:** `popupEl()` is null because `dispose()` removed it, independent of the call under test; the guard-removal chain still does not throw. Neither assertion observes "dropped".
- **Cut / repair:** delete 173-182, or assert the observable: keep a handle on the nested body element before dispose and assert its `textContent` is unchanged after the late response.
- **Estimated net lines removed:** ~13. **Risk:** low.

### T1-G14 [P2] "respects the parser's 10-result cap" re-tests filePathParser's cap through a pass-through.

- **Location:** src/webview/links/FilePathLinkProvider.test.ts:291-303
- **Verifier:** CONFIRMED, credit 13→14. **Evidence:** Byte-identical input construction to `filePathParser.test.ts:339-343`, same `toHaveLength(10)`; the provider has no cap of its own.
- **Cut / repair:** delete 291-303.
- **Estimated net lines removed:** ~14. **Risk:** low.

**Axis estimate:** ~1,123 net lines.


## Axis 1B — worktree, provider and remaining tests

### T2-01 [P2] Four pairs of byte-identical tests (same setup, same assertion, two names)

- **Location:** `src/worktree/ignoredMaterial.test.ts:200-206` and `:281-289`; `src/worktree/orphanProofs.test.ts:57-63` and `:308-317`; `src/worktree/worktreeBlockers.test.ts:284-290` and `:368-372`; `src/session/SessionStorage.test.ts:277-293` and `:382-399`
- **Verifier:** CONFIRMED. **Evidence:** All four pairs `diff`ed: `ignoredMaterial` 200/281 differ only in name+comment (both `withManifest(undefined)` → same `toEqual`); `orphanProofs` 57/308 same deps + assertion; `worktreeBlockers` 284/368 both `input({porcelain:{ok:false}})`; `SessionStorage` 277/382 differ by one comment + one blank line. Every "negative control" passes the same input as the case it contrasts.
- **Cut / repair:** delete `ignoredMaterial:281`, `orphanProofs:308`, `worktreeBlockers:368`, `SessionStorage:382`; or, where the named control is genuinely wanted, give it the input its name claims (a present-directory target that differs from the default; an rm that succeeds while a Memento update is made to reject).
- **Estimated net lines removed:** ~40. **Risk:** low — behavioural coverage is unchanged by construction; the only risk is losing the *intent* of a control, which is why "give it its input" is the alternative. ---

### T2-03 [P2] `SettingsReader.test.ts:192-200` — the name promises detected args, the body only proves an array exists

- **Location:** `src/settings/SettingsReader.test.ts:192-200`
- **Verifier:** CONFIRMED, credit 8→0. **Evidence:** `expect(settings.shellArgs).toBeDefined()` genuinely cannot fail (both `resolveShell` branches return an array; field typed `string[]`). But the Cut the report prefers is a rewrite to assert the value. Deleting outright would leave the detected-args branch unasserted.
- **Cut / repair:** Rewrite the assertion to pin the expected detected arguments on a controlled fixture. Keep the fallback scenario; an existence assertion cannot distinguish detected args from an empty array.
- **Estimated net lines removed:** ~0. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### T2-04 [P2] `src/test/invariants/sourceBytes.test.ts` is a structural matcher with no not-vacuous check

- **Location:** `src/test/invariants/sourceBytes.test.ts:27-41`
- **Verifier:** CONFIRMED, credit −4 → 0. **Evidence:** Read the whole file: the only assertion is `expect(offenders()).toEqual([])`; `hasControlByte` is module-private and never fed a violating buffer. Real gap, but the fix adds ~4 lines. A finding that adds code earns no deletable credit.
- **Cut / repair:** Keep the source-control-byte scan and add a positive violating buffer plus legal-tab/newline controls for hasControlByte. The helper is in this test file and can be called locally. Adds approximately four lines; deletes none.
- **Estimated net lines removed:** ~0. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

**Axis estimate:** ~40 net lines.


## Axis 2 — abstraction and test-only surfaces

### A-01 [P1] `noopVaultCustomNameStorage` is a dead export — nothing, prod or test, ever references it

- **Location:** src/vault/VaultCustomNameRegistry.ts:38-42
- **Verifier:** CONFIRMED. **Evidence:** `grep -rnw noopVaultCustomNameStorage src` → 1 hit (the definition). Sole ctor site `extension.ts:660` passes a real Memento; ctor has no default param.
- **Cut / repair:** delete the const and its doc comment.
- **Estimated net lines removed:** ~5. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### A-02 [P1] `affectsWorktreeCreateRoot` is a dead one-line settings wrapper

- **Location:** src/settings/SettingsReader.ts:191-194
- **Verifier:** CONFIRMED. **Evidence:** `grep -rnw affectsWorktreeCreateRoot src` → 1 hit. Sibling `affectsWorktreeRowActivation:196` has 2 prod callers.
- **Cut / repair:** delete function + doc comment.
- **Estimated net lines removed:** ~4. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### A-03 [P1] Two exported union types with no referent anywhere

- **Location:** src/types/messages.ts:674-675, src/agentHooks/agents/cursor.ts:7
- **Verifier:** CONFIRMED (4→3). **Evidence:** `grep -rnw` each → 1 hit. messages.ts:674-675 (2) + cursor.ts:7 (1).
- **Cut / repair:** delete both aliases and their doc comments.
- **Estimated net lines removed:** ~3. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### A-04 [P1] `OpenFileLinkDeps.showError` is an injected dependency the module never reads

- **Location:** src/providers/openFileLink.ts:57-58
- **Verifier:** CONFIRMED (30→28). **Evidence:** `grep -n showError src/providers/openFileLink.ts` → only `:58`, the declaration. No call path ⇒ 22 (not 25) `not.toHaveBeenCalled` are unfalsifiable, + 2 wiring lines + 2 `expect.any(Function)` + the field.
- **Cut / repair:** Remove the unused showError dependency, its two provider wiring sites, 22 negative-call assertions, and the redundant wiring matchers. Keep all real open-file behavior tests.
- **Estimated net lines removed:** ~28. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### A-05 [P2] `readClaudeEntry` / `readCursorEntry` / `readOpenCodeEntry` — a three-file "entry-or-nothing" layer with zero production callers

- **Location:** src/vault/readers/claudeReader.ts:461-468, src/vault/readers/cursorReader.ts:656-662, src/vault/readers/opencodeReader.ts:316-324
- **Verifier:** CONFIRMED. **Evidence:** Non-test grep → own definition only (+1 comment). Prod uses `lookupXEntry` (VaultService.ts:202,240,260). Test-only export ⇒ P2 correct.
- **Cut / repair:** delete the three wrappers; port their tests onto `lookupXEntry` (a `.status`/`.entry` check).
- **Estimated net lines removed:** ~24. **Risk:** low — mechanical test edit at three call groups.

### A-06 [P2] `detectContinuationTargets` — one-line wrapper whose only callers are its tests

- **Location:** src/vault/registry.ts:294-299
- **Verifier:** CONFIRMED. **Evidence:** Non-test grep → definition only. Body: `return detectLaunchTargets("continue", deps)`.
- **Cut / repair:** delete; have the tests call `detectLaunchTargets("continue", deps)`.
- **Estimated net lines removed:** ~6. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### A-07 [P2] `buildWorktreeTree` — the `.tree` projection has no production caller

- **Location:** src/worktree/WorktreeDiscovery.ts:363-372
- **Verifier:** CONFIRMED. **Evidence:** Non-test grep → def + a comment in worktreeDeps.ts:4. `scale.bench.ts:132` is a real non-vitest caller and must be edited in the same change.
- **Cut / repair:** Remove buildWorktreeTree; obtain .tree from the underlying builder in BOTH its tests and scale.bench.ts:132. The benchmark is a real caller, although outside test:unit.
- **Estimated net lines removed:** ~10. **Risk:** low — bench file is out of `test:unit` (documented), so touch it in the same edit.

### A-08 [P2] `resolveRepoRoots` — a composed one-liner nobody in production composes through

- **Location:** src/worktree/repoRoots.ts:228-236
- **Verifier:** CONFIRMED. **Evidence:** Non-test grep → def + own `{@link}`. Prod composes both halves at `WorktreeDiscovery.ts:333-334`.
- **Cut / repair:** delete; the test composes the two exports (which it already imports).
- **Estimated net lines removed:** ~9. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### A-09 [P2] `readMigrationSnapshot` and `migrationSourceStillAuthorized` are exported only for `migrateChanges.test.ts`

- **Location:** src/worktree/migrateChanges.ts:604-616, 950-956
- **Verifier:** CONFIRMED, credit 20→0. **Evidence:** Both test-only, but the fix is "pick one surface": retargeting ~25 test call sites means exporting `readMigrationSnapshotWithin`/`captureSourceEvidence` instead. A rename, not a removal.
- **Cut / repair:** Choose one tested surface and retarget the ~25 test calls if consolidating. Do not simply remove the wrappers and lose their tests; this earns zero net deletion credit.
- **Estimated net lines removed:** ~0. **Risk:** low — judgement call about which surface the suite should target.

### A-10 [P2] `readAsimovProvisioning` + `AsimovProviderDeps` — a second, test-only entry point beside the adapter every other provider uses

- **Location:** src/worktree/provisioning/asimovProvider.ts:38-44, 57-73
- **Verifier:** CONFIRMED. **Evidence:** `readAsimovProvisioning` non-test grep → def + own comment; consumers are 2 test files. No peer provider has a `readXProvisioning` free fn. `asimovProvider.test.ts:2-8` imports `MAX_MODEL_ROWS, MAX_SCAN` via the hop; 5 peer test files import them from `./providerKit`.
- **Cut / repair:** delete `readAsimovProvisioning`, the `AsimovProviderDeps` alias and the constants re-export; the suite drives `asimovAdapter.read` and imports the budgets from `providerKit`, like its peers.
- **Estimated net lines removed:** ~23. **Risk:** low — one test file to retarget.

### A-11 [P2] `reportableDisposition` has no production caller; the host narrows the disposition itself

- **Location:** src/worktree/createResolution.ts:100-110
- **Verifier:** CONFIRMED. **Evidence:** Non-test grep → definition only; `WorktreeHost.ts:58` imports only `resolveSelection`.
- **Cut / repair:** Remove reportableDisposition and retarget its tests to the actual production resolution surface; preserve assertions of the disposition rule.
- **Estimated net lines removed:** ~10. **Risk:** low — deciding which of the two directions is intended needs a read of the design note.

### A-12 [P2] Six deps/options-bag fields that no caller — production OR test — ever sets

- **Location:** src/agentHooks/AgentHookRuntime.ts:190,250,342; src/worktree/sessionPreviewService.ts:51,235; src/worktree/gitExclude.ts:30,63; src/session/SessionManager.ts:77,201; src/worktree/worktreeMutationService.ts:509,586; src/worktree/worktreeDeps.ts:18-19,35
- **Verifier:** CONFIRMED. **Evidence:** Each grep returns declaration + `?? default` + internal reads only. `createWorktreeTreeDeps` is called 3 ways (`extension.ts:1099 ({pathMemo})`, `scale.bench.ts:131 ()`, 8× tests `()`) — never with `git`.
- **Cut / repair:** delete each optional field and inline its default as the constant it already is.
- **Estimated net lines removed:** ~18. **Risk:** low — each has exactly one read site; the default becomes a literal.

### A-14 [P2] `DragDropHandler` re-exports `escapePathForShell` so its test can import it from the wrong module

- **Location:** src/webview/DragDropHandler.ts:12,16
- **Verifier:** CONFIRMED, credit 31→1. **Evidence:** Re-export's only consumer is the test file. But only 4 of the 8 escaping assertions overlap `shellEscape.test.ts`; the other 4 (`$(echo evil)`, backslashes, double-quotes, the metachar string) exist only here and must move, which deletes nothing.
- **Cut / repair:** Remove only the re-export at DragDropHandler.ts:16. Import from the origin and move, rather than delete, the four unique escaping scenarios into shellEscape.test.ts.
- **Estimated net lines removed:** ~1. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### A-15 [P2] `SessionManager`'s re-export block ships a type nobody imports and a function only one test imports

- **Location:** src/session/SessionManager.ts:45-48
- **Verifier:** CONFIRMED. **Evidence:** `CustomNameStorage` re-export has zero importers. `truncateSnapshotBuffer` re-export's only importer is `SessionManager.snapshot.test.ts:19`.
- **Cut / repair:** delete lines 47-48; retarget one test import.
- **Estimated net lines removed:** ~2. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### A-16 [P2] `projectPaneActivity` is a one-line wrapper with only test callers, beside `explainPaneActivity` which has the production one

- **Location:** src/shared/paneEvidence.ts:133-139
- **Verifier:** CONFIRMED. **Evidence:** Non-test grep → def + a comment at :141. `explainPaneActivity` has the prod caller.
- **Cut / repair:** delete `projectPaneActivity`; tests read `.activity` off `explainPaneActivity`.
- **Estimated net lines removed:** ~7. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

**Axis estimate:** ~150 net lines.


## Axis 3 — dead code and message seams

### D-01 [P1] `resolveCursorChatCandidate` has zero callers — the only mention is a stale doc comment

- **Location:** src/vault/readers/cursorPaths.ts:287-299; stale reference src/vault/readers/cursorReader.ts:625
- **Verifier:** CONFIRMED (287-300→287-299). **Evidence:** `grep -rnw resolveCursorChatCandidate` → def + one prose mention. Live callers use `lookupCursorChatCandidate`.
- **Cut / repair:** delete the function and its doc block; fix cursorReader.ts:625 to name `lookupCursorChatCandidate`.
- **Estimated net lines removed:** ~13. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### D-03 [P1] `messageSourceOf` is dead — every reader uses `actionSourceOf` directly

- **Location:** src/webview/vault/renderAtoms.ts:205-208
- **Verifier:** CONFIRMED (5→4). **Evidence:** `grep -rnw messageSourceOf` → 1 hit
- **Cut / repair:** delete the function.
- **Estimated net lines removed:** ~4. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### D-07 [P1] `IMatch` / `IMatchData` "backwards compatibility" aliases have no consumer to be compatible with

- **Location:** src/webview/fileTree/Tree.ts:40-42 (and the claim at src/webview/fileTree/ITreeRenderer.ts:58-64)
- **Verifier:** CONFIRMED. **Evidence:** `grep -rnwE 'IMatch\|IMatchData'` → 2 aliases + the compatibility comment. Zero users.
- **Cut / repair:** delete both aliases and the trailing sentence of the ITreeRenderer doc block that promises them.
- **Estimated net lines removed:** ~3. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### D-08 [P2] `CURSOR_HOOK_EVENTS` is defined twice, byte-identical, in two modules

- **Location:** src/agentHooks/agents/cursor.ts:22-36 and src/cursor/CursorHookInstaller.ts:7-21
- **Verifier:** CONFIRMED. **Evidence:** `diff` of the two extracted ranges printed IDENTICAL. Neither module imports the other.
- **Cut / repair:** delete the installer's copy; import `CURSOR_HOOK_EVENTS` from `../agentHooks/agents/cursor`.
- **Estimated net lines removed:** ~15. **Risk:** low — same values, but the installer's test (`CursorHookInstaller.test.ts:23`) imports the installer's symbol, so the import path in the test moves too.

### D-09 [P2] `persistPanelId` is a message the webview sends and nothing receives

- **Location:** src/types/messages.ts:1954-1965,1812; src/webview/main.ts:796
- **Verifier:** CONFIRMED (1955→1954; sender 795→796). **Evidence:** `grep -rn persistPanelId src` → exactly 2 hits: the type literal and the sender. No `case` anywhere.
- **Cut / repair:** delete `PersistPanelIdMessage`, its union member (messages.ts:1812), the `postMessage` call, and the §8.1 row.
- **Estimated net lines removed:** ~14. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### D-10 [P2] `closeSplitPane` (the no-argument E→W variant) is never posted by the host

- **Location:** src/types/messages.ts:2177-2180,3092; src/webview/messaging/MessageRouter.ts:86,202-204; src/webview/main.ts:679-689
- **Verifier:** CONFIRMED, ranges ~15 lines off. **Evidence:** Real ranges: messages.ts:2177-2180, union :3092. `grep -rn '"closeSplitPane"'` → only the literal, the router `case`, and the router test. Prod posts `closeSplitPaneById`.
- **Cut / repair:** Retire the unused no-argument host-to-webview message, its union member, router callback/case and main.ts implementation. Keep closeSplitPaneById and its tests; retarget/remove tests of only the retired route.
- **Estimated net lines removed:** ~25. **Risk:** low — verify no `postMessage` builds the type string dynamically (grep above shows none).

**Axis estimate:** ~74 net lines.


## Axis 4 — duplicated implementation and fixtures

### U-01 [P2] Both file-link resolvers duplicate the timeout/cancellation body, with an async-signature difference.

- **Location:** src/providers/openFileLink.ts:97-132 ; src/providers/previewFileLink.ts:266-301
- **Verifier:** CONFIRMED — low-risk refactor, not zero-refactor. **Evidence:** Diff: only the `async` keyword and a 2-line comment differ. Requires extracting a shared module and rewiring 2 imports.
- **Cut / repair:** Extract a shared timeout core and rewire both callers. Preserve cancellation/error behavior; account for the async wrapper and its promise-settlement ordering rather than claiming byte-identical public semantics.
- **Estimated net lines removed:** ~36. **Risk:** low — extraction/import changes; async wrapper semantics must be checked.

### U-02 [P2] Error-to-message conversion is repeated, including two migration formatters with a catch asymmetry.

- **Location:** src/vault/sqlite.ts:253-255 (`errorMessage`) ; src/worktree/adoptWorktree.ts:726-728 (`reasonOf`) ; src/worktree/migrateChanges.ts:1030-1033 (`reasonOf`, adds trim/slice/fallback) ; src/worktree/worktreeMutationService.ts:160-166 (`migrationReasonOf`, same trim/slice/fallback and the SAME fallback string) ; src/vault/readers/runningSessions.ts:336-340 (`describeReadFailure` inlines it)
- **Verifier:** CONFIRMED, risk none→low; asymmetry must be preserved. **Evidence:** `migrationReasonOf` (worktreeMutationService.ts:160) is not identical to `reasonOf` (migrateChanges.ts:1030) — it wraps the same expression in `try/catch`. The merged helper must keep that catch. See notes.
- **Cut / repair:** Reuse messageOf for plain conversions; consolidate migration formatting without dropping worktreeMutationService.migrationReasonOf’s try/catch fallback. Do not naively replace it with the unguarded function.
- **Estimated net lines removed:** ~15. **Risk:** low to medium — preserve error/coercion behavior; not an identical substitution.

### U-03 [P2] `isNotFound` is exported from `utils/lockedFile.ts` and re-declared three more times, once in a file that already imports from that module.

- **Location:** src/utils/lockedFile.ts:587-589 (exported) ; src/cursor/CursorHookInstaller.ts:445-447 ; src/worktree/migrateChanges.ts:145-149 ; src/worktree/worktreePorts.ts:132-134
- **Verifier:** CONFIRMED — low-risk refactor. **Evidence:** 4 copies of the ENOENT predicate; migrateChanges adds a cast. Requires import rewiring in 3 files.
- **Cut / repair:** delete the three local copies; import `isNotFound` from `../utils/lockedFile` (or move it to `src/utils/fsPresence.ts` next to `provesAbsence`, which is the natural home).
- **Estimated net lines removed:** ~9. **Risk:** low — shared-helper extraction/import rewiring; preserve the verified variant differences.

### U-04 [P2] The codex and opencode readers carry byte-identical private field coercers that `detail.ts` already has.

- **Location:** src/vault/readers/codexReader.ts:84-92 (`asString`), 635-641 (`objField`, `num`) ; src/vault/readers/opencodeReader.ts:93-101 (`asString`), 345-355 (`strField`, `objField`, `num`) ; src/vault/readers/detail.ts:304-314 (`str`, `asObj`, `num`)
- **Verifier:** CONFIRMED — low-risk refactor. **Evidence:** `diff codexReader.ts:84-92 opencodeReader.ts:93-101` → empty. `objField`/`num` byte-identical across three files. Requires exporting from `detail.ts` (or a new module) and rewiring.
- **Cut / repair:** export `str`, `asObj`, `num`, `asString` from detail.ts (or a new `src/vault/readers/fields.ts`); delete the six private copies.
- **Estimated net lines removed:** ~30. **Risk:** low — shared-helper extraction/import rewiring; preserve the verified variant differences.

### U-05 [P2] `leafSegment` and `folderLabel` are the same five lines in two sibling webview files.

- **Location:** src/webview/vault/format.ts:8-12 (`export function leafSegment`) ; src/webview/vault/grouping.ts:29-33 (`function folderLabel`)
- **Verifier:** CONFIRMED. **Evidence:** Bodies byte-identical; one import added.
- **Cut / repair:** delete `folderLabel`; `import { leafSegment } from "./format"`.
- **Estimated net lines removed:** ~5. **Risk:** low — shared-helper extraction/import rewiring; preserve the verified variant differences.

### U-06 [P2] Twelve private "is this a plain object" guards under six names.

- **Location:** src/vault/messageText.ts:95 (`asObject`) ; src/vault/readers/cursorNormalization.ts:92 (`asObject`) ; cursorStore.ts:86 (`asObject`) ; cursorIdeReader.ts:77 (`asObject`) ; codexReader.ts:635 (`objField`) ; opencodeReader.ts:349 (`objField`) ; detail.ts:308 (`asObj`) ; claudeChildren.ts:70 (typed `ManifestObj`) ; src/vault/VaultCacheStore.ts:71 (`isRecord`) ; src/cursor/CursorHookInstaller.ts:441 (`isObject`, plus a private `type JsonObject` at :27 that duplicates the exported one at agentHooks/install/claudeConfig.ts:9) ; src/agentHooks/install/claudeConfig.ts:154 (`isJsonObject`) ; src/worktree/provisioning/suggestProvisioning.ts:134 (`recordOf`) ; inline in orcaProvider.ts:170, vscodeTasksProvider.ts:108, cursorReader.ts:186, detail.ts:289
- **Verifier:** CONFIRMED, credit 30→18. **Evidence:** Overlaps U-04 on the four reader copies, which U-06's 30 does not subtract.
- **Cut / repair:** one `isRecord(v): v is Record<string, unknown>` + `asRecord(v): Record<string,unknown>|undefined` in `src/utils/record.ts` (must stay node-free so the webview can import). Overlaps U-04 for the four reader copies; count once.
- **Estimated net lines removed:** ~18. **Risk:** low — pure predicates; `claudeChildren.ts` keeps its narrower `ManifestObj` type via a cast at the call site.

### U-07 [P2] Eight readline sites repeat JSONL stream setup, parsing and cleanup across the Claude and Codex readers.

- **Location:** src/vault/readers/claudeRecords.ts:182-218 (`streamClaudeRecords`), 221-255 (`readFirstUserRecord`) ; src/vault/readers/claudeTeam.ts:152-225 (`readClaudeTeamSegment`), 245-294 (`readTeamMemberInfo`), 351-399 (`collectMemberTurns`) ; src/vault/readers/claudeReader.ts:106-190 (`parseClaudeFile`) ; src/vault/readers/codexReader.ts:380-399 (`readFirstLine`), 1058-1091 (`streamCodexRecords`)
- **Verifier:** CONFIRMED. **Evidence:** `grep -n readline.createInterface src/vault/readers/*.ts` → 8 sites, matching the claim.
- **Cut / repair:** Extract only genuinely shared stream lifecycle/parsing; preserve each caller’s limits, early-return cleanup, malformed-record handling and error/partial-result semantics. Leave byte-bounded recordLine.ts separate.
- **Estimated net lines removed:** ~80. **Risk:** low — the frame is behaviourally identical (skip blank, skip corrupt, null on open failure); early `return`/`break` inside `for await` of a generator still runs the generator's `finally`.

### U-08 [P2] Eight ad-hoc "same path / inside path" predicates alongside the documented one owner `src/utils/pathBoundary.ts`, with two of them disagreeing.

- **Location:** src/providers/openFileLink.ts:195-210 (`samePath`, `isInside` via `path.relative`) ; src/providers/previewFileLink.ts:161-168 (`isInside` via `startsWith` + sep) ; src/providers/fileTreeHost.ts:594-602 (`samePath`, `isSameOrInside`) ; src/worktree/worktreePorts.ts:391-393 (`samePath` = `path.resolve` equality) ; src/vault/readers/cursorReader.ts:279-282 (`isWithin`), 294-296 (`sameCwd` = `path.resolve` equality) ; src/webview/vault/format.ts:51-66 (`isWithin`, strip trailing seps + startsWith)
- **Verifier:** CONFIRMED. **Evidence:** `grep -rnE "^function samePath\|^function isInside\|..."` → 8 hits across 5 files beside `pathBoundary.isPathInside:53`. Risk stays low-medium (lexical vs `path.relative`).
- **Cut / repair:** Audit differing lexical path contracts first, then share only equivalent predicates through pathBoundary. Preserve containment/platform semantics and leave realpath identity in worktree/normalizePath.ts untouched. Differing answers need explicit behavior review, not blind substitution.
- **Estimated net lines removed:** ~40. **Risk:** low-medium — `isPathInside` is lexical; callers that pass already-`path.resolve`d strings keep semantics; a verifier should diff the win32 branch of previewFileLink (which tolerates a base ending in `/` or `\`, which `compareBoundary` also does).

### U-09 [P2] `utils/fsPresence.provesAbsence` ("ENOENT || ENOTDIR") is re-declared four times.

- **Location:** src/utils/fsPresence.ts:17-20 (owner) ; src/extension.ts:1176-1179 (`readsAsAbsent`) ; src/worktree/adoptWorktree.ts:721-724 (`readsAsAbsent`) ; src/worktree/provisioning/providerKit.ts:121-124 (`isAbsence`) ; src/worktree/worktreeMutationService.ts:156-158 (`existenceFromStatError`, returns `false | null`)
- **Verifier:** CONFIRMED. **Evidence:** ENOENT/ENOTDIR pair at 5 sites: owner `fsPresence.ts:18` + 4 copies.
- **Cut / repair:** the three boolean copies → `provesAbsence(err)`; `existenceFromStatError` → `provesAbsence(error) ? false : null`.
- **Estimated net lines removed:** ~12. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### U-10 [P2] Two dialogs implement the same focus-trap (same selector string, same Tab/Shift-Tab wrap).

- **Location:** src/webview/worktree/worktreeDialogShell.ts:63-66 (`focusable`), 86-113 (`onKeyDown` Tab branch) ; src/webview/vault/ContinueDialog.ts:217-220 (`focusable`), 237-260 (`onKeyDown`)
- **Verifier:** CONFIRMED. **Evidence:** Ranges resolve; selector string and Tab-wrap shape as described.
- **Cut / repair:** export `trapTabFocus(container: HTMLElement, ev: KeyboardEvent)` (+ the selector) from `worktreeDialogShell.ts` or a new `src/webview/ui/focusTrap.ts`; ContinueDialog calls it.
- **Estimated net lines removed:** ~25. **Risk:** low — ContinueDialog keeps its own Escape handling (`stopPropagation`).

### U-11 [P2] The two terminal providers duplicate preview/vault request mechanics, with provider-specific retry and posting behavior.

- **Location:** src/providers/TerminalEditorProvider.ts:541-558 (`cancelPreviewToken`, `cancelAllPreviewTokens`), 561-613 (`handleRequestFilePreview`), 930-959 (`handleRequestVaultSessions`), 963-988 (`handleRequestVaultSessionDetail`), 990-1026 (`handleRequestSubagentPreview`), 1029-1052 (`subagentResolveDeps`), 1241-1249 (`safePostMessage`), 1266-1290 (`safeSendWithRetry`) ; src/providers/TerminalViewProvider.ts:427-444, 357-419, 453-497, 623-661, 830-869, 872-895, 1671-1679, 1693-1720 respectively
- **Verifier:** CONFIRMED (spot-verified), risk medium. **Evidence:** `diff` of the two `subagentResolveDeps` extractions → empty. The editor/view retry asymmetry is real and must be parameterised.
- **Cut / repair:** Extract shared preview/vault request mechanics behind provider-specific post/retry adapters. Preserve editor/view retry differences, cancellation, supersession and disposal. The ~180-line estimate is a refactor opportunity, not a proven removable block.
- **Estimated net lines removed:** ~180. **Risk:** medium — lifecycle and retry behavior differ; representative duplication verified, extraction not implemented.

### U-16 [P2] The JSDOM `ResizeObserver`/`matchMedia` polyfill block is pasted verbatim into four test files, one of which says so.

- **Location:** src/webview/fileTree/Tree.test.ts:37-57 ; src/webview/fileTree/Tree.flat-list.test.ts:17-37 ; src/webview/fileTree/FileTreePanel.test.ts:26-46 ; src/test/vendor-import.test.ts:26-46
- **Verifier:** CONFIRMED. **Evidence:** `grep -rln` → exactly the 4 named files. `diff Tree.test.ts:37-57 vendor-import.test.ts:26-46` → empty.
- **Cut / repair:** Extract an explicitly invoked installListViewPolyfills helper used by the four suites. Preserve per-file isolation and setup ordering; do not silently introduce global environment setup.
- **Estimated net lines removed:** ~60. **Risk:** low — shared-helper extraction/import rewiring; preserve the verified variant differences.

### U-17 [P2] Six provider suites duplicate createMockContext, with four byte-identical bodies and two variants.

- **Location:** src/providers/TerminalEditorProvider.panelId.test.ts:10-16 ; TerminalEditorProvider.undo.test.ts:20-26 ; TerminalEditorProvider.scheduledDestroy.test.ts:10-16 ; TerminalEditorProvider.onReady.test.ts:70-76 ; TerminalPanelSerializer.test.ts:10-16 ; TerminalEditorProvider.test.ts:91-96 (differs only in `fsPath` string and lacks `workspaceState`)
- **Verifier:** CONFIRMED ("five"→four). **Evidence:** md5 of extracted bodies: `447d8bb2…` ×4, `cd6317ab…` (undo), and TerminalEditorProvider.test.ts differs.
- **Cut / repair:** Share mockExtensionContext with explicit overrides for the two variants; preserve workspaceState and fsPath differences.
- **Estimated net lines removed:** ~30. **Risk:** low — shared-helper extraction/import rewiring; preserve the verified variant differences.

### U-18 [P2] `makeStorageMock` ×6 and `makeFactories` ×7 are hand-rolled in SessionManager split tests that all already import `src/test/sessionMocks.ts`.

- **Location:** makeStorageMock — src/session/SessionManager.settingToggle.test.ts:21-60 ; editorPanels.test.ts:14-55 ; persist.test.ts:15-66 ; deactivate.test.ts:15-54 ; shutdownLifecycle.test.ts:25-74 ; hydrate.test.ts:38-83. makeFactories — settingToggle.test.ts:62-94 ; agentHooks.test.ts:81-97 ; deactivate.test.ts:56-72 ; shutdownLifecycle.test.ts:76-109 ; snapshot.test.ts:22-79 ; persist.test.ts:68-88 ; exit.test.ts:16-34
- **Verifier:** CONFIRMED. **Evidence:** Ranges resolve across all 13 files. Chair opened makeStorageMock in SessionManager.deactivate.test.ts:14-53 and settingToggle.test.ts:21-60: the same bufferGens/sidecarGen transitions and stale-skipped decisions, differing only in an unused parameter. Headless factories vary in disposed tracking and serialize output and need overrides.
- **Cut / repair:** add `storageMock(overrides?)` and `headlessFactories({ serialize?, onWrite? })` to sessionMocks.ts; the snapshot and shutdownLifecycle variants keep their bespoke serialize hooks as overrides.
- **Estimated net lines removed:** ~200. **Risk:** low to medium — preserve generation invalidation, disposed-state tracking, output sinks and per-suite serialization overrides; not every factory is interchangeable.

### U-19 [P2] `Tree.flat-list.test.ts` re-declares the whole Tree test kit from `Tree.test.ts`.

- **Location:** src/webview/fileTree/Tree.flat-list.test.ts:45-97 (`buildTree`, `makeDataSource`, `makeRenderer`, `flushMicrotasks`, `makeHost`, `readRowLabels`) vs src/webview/fileTree/Tree.test.ts:69-82, 102-129, 182-194
- **Verifier:** CONFIRMED. **Evidence:** Ranges resolve. Axis diff identified identical makeHost and line-identical makeRenderer, flushMicrotasks and readRowLabels; buildTree differs in the node fixture.
- **Cut / repair:** `src/webview/fileTree/treeTestKit.ts` exporting the six helpers; flat-list passes its own node list to `buildTree`.
- **Estimated net lines removed:** ~55. **Risk:** low — fixture extraction; keep each suite’s distinct data nodes.

### U-20 [P2] `settle()` — eight private copies of "await N macrotask turns" in provider tests.

- **Location:** src/providers/TerminalEditorProvider.vault.test.ts:84-88 ; WorktreeHost.delegations.test.ts:73-77 ; WorktreeHost.invalidation.test.ts:125-129 ; WorktreeHost.presence.test.ts:153-157 ; WorktreeHost.test.ts:100-104 ; TerminalViewProvider.worktree.test.ts:158-162 ; WorktreeHost.actions.test.ts:214-218 ; (src/extension.worktreeAssembly.test.ts:892-929 is the documented exception and is NOT counted)
- **Verifier:** CONFIRMED. **Evidence:** `grep -rln "^async function settle()"` → 8 files, one being the brief's documented exception ⇒ 7 removable copies.
- **Cut / repair:** Share the simple provider-test macrotask pump only if retaining each caller’s turn count; never replace settleUntil or extension.worktreeAssembly.test.ts’s documented settlement logic. Pump consolidation does not fix load-flakiness.
- **Estimated net lines removed:** ~35. **Risk:** low — unifying 6→8 turns only waits longer.

**Axis estimate:** ~830 net lines.


## Axes 5–6 — mock/fixture infrastructure and stale comments

### I-01 [P1] Four capabilities in the `vscode` mock have zero users

- **Location:** src/test/__mocks__/vscode.ts:246-247,282-284,308-310,363,533-538,587-602
- **Verifier:** CONFIRMED. **Evidence:** `grep -rn <name> src \| grep -v __mocks__/vscode.ts` → zero output for all four helpers.
- **Cut / repair:** delete `__setFindFiles`, `__setShowQuickPick`, `__fireTabGroupChange`, the `__disposeHandlers` field, and inline the two impl variables as plain default implementations.
- **Estimated net lines removed:** ~25. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### I-02 [P2] Three TabInput mock constructor classes have no users; TabInputTextDiff is live and must stay.

- **Location:** src/test/__mocks__/vscode.ts:463-479
- **Verifier:** DOWNGRADED, 4 classes→3, 18→13. **Evidence:** `TabInputTextDiff` is used — see notes.
- **Cut / repair:** Delete only TabInputNotebookDiff, TabInputTerminal and TabInputWebview. Keep TabInputTextDiff, imported and constructed by ActiveFileRevealer.test.ts:15,159.
- **Estimated net lines removed:** ~13. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### I-05 [P1] MockPtyHandle is unnecessarily exported, but its local type is live.

- **Location:** src/test/sessionMocks.ts:12-17
- **Verifier:** CONFIRMED, credit 5→0. **Evidence:** The type is live inside its own module: `sessionMocks.ts:19` is `export const mockPtySessions: MockPtyHandle[]`. Only the `export` keyword is dead. Dropping one token deletes no lines.
- **Cut / repair:** Remove only the export keyword. Keep the interface because mockPtySessions uses it at sessionMocks.ts:19. No whole-line deletion.
- **Estimated net lines removed:** ~0. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### I-06 [P2] Five test files re-declare the PtyManager/PtySession/OutputBuffer mock trio that `sessionMocks.ts` exists to be the superset of

- **Location:** src/providers/TerminalEditorProvider.onReady.test.ts:7-60, src/providers/TerminalViewProvider.restore.test.ts:7-60, src/providers/TerminalEditorProvider.test.ts:12-66, src/providers/TerminalViewProvider.test.ts:12-95, src/session/SessionManager.test.ts:23-133
- **Verifier:** CONFIRMED. **Evidence:** `grep -c sessionMocks` = 0 for all five named files while 16 others use the shared factories.
- **Cut / repair:** replace the two byte-identical copies (`onReady`, `restore`) with the shared factories outright; for the other three, extend the factory the way `agentHooks.test.ts:29-31` already does (shared factories for two modules, local override for the one that needs a control).
- **Estimated net lines removed:** ~200. **Risk:** low for the two identical copies; medium for the three that carry extra controls.

### I-08 [P2] Six worktree fixture builders each serve exactly one test file

- **Location:** src/webview/worktree/worktreeFixtures.ts:127-129,131-146,148-150,213-220,222-231,344-355,357-367
- **Verifier:** CONFIRMED, credit 45→0. **Evidence:** All six fixtures do have exactly one consumer file, but the Cut is a move into that file. No duplication is eliminated, so no line stops existing.
- **Cut / repair:** Optional locality change only: move the six single-consumer fixture builders beside their consumers. Their single-consumer status is not proof they are dead. No net lines saved; do not prioritize this over actual duplication.
- **Estimated net lines removed:** ~0. **Risk:** low — pure data, no behaviour.

### C-01 [P1] `AGENTS.md` sends every agent to a path that does not exist

- **Location:** AGENTS.md:9
- **Verifier:** CONFIRMED. **Evidence:** `AGENTS.md:9` says `cyberk-flow/project.md`; `ls cyberk-flow` → No such file or directory; `asimov/project.md` exists. One line changed, none deleted.
- **Cut / repair:** repoint to `asimov/project.md`.
- **Estimated net lines removed:** ~0. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### C-02 [P2] Two message contracts document an error code no handler emits

- **Location:** src/types/messages.ts:2327,2346; src/providers/fileTreeHost.test.ts:69; historical explanation src/test/fileTreeRpc.integration.test.ts:151
- **Verifier:** CONFIRMED, evidence corrected. **Evidence:** The report's "grep returns only those two comment lines" is false — 5 hits exist. But the claim holds: `grep -rn 'code: "'` over the handlers emits only `STALE_ROOT`, `FS_ERROR`, `INTERNAL`. `fileTreeRpc.integration.test.ts:151` says outright the code was dropped; `fileTreeHost.test.ts:69`'s comment is equally stale and should be fixed too.
- **Cut / repair:** Remove obsolete OUT_OF_WORKSPACE contract bullets and correct the stale fileTreeHost test comment. Preserve the integration test’s historical explanation; actual handlers return STALE_ROOT, FS_ERROR or INTERNAL.
- **Estimated net lines removed:** ~2. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### C-03 [P2] `ActiveFileRevealer`'s class JSDoc names a VS Code API the file itself says does not exist

- **Location:** src/providers/ActiveFileRevealer.ts:59
- **Verifier:** CONFIRMED. **Evidence:** Line 59 JSDoc names `onDidChangeActiveTab`; the ctor comment at :77-79 says it does not exist; real subscriptions at :81-82. One line rewritten.
- **Cut / repair:** rewrite line 59 to name the two real events.
- **Estimated net lines removed:** ~0. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### C-04 [P2] `Tree.appendRows` JSDoc describes a filter the class does not have

- **Location:** src/webview/fileTree/Tree.ts:1075-1078
- **Verifier:** CONFIRMED (stronger than claimed). **Evidence:** `grep -nE "_filter\|shouldRender" Tree.ts` → exactly one line, 1075 — the comment itself. No member, method, or parameter.
- **Cut / repair:** delete the `_filter`/`shouldRender` paragraph; the match-data sentence can stay if reworded to the map the code actually reads.
- **Estimated net lines removed:** ~4. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

### C-05 [P2] An orphaned doc block in `fsDeletionGate.ts` leaves `EXPECTED_GAPS` undocumented and double-heads `ALLOWED_DELETERS`

- **Location:** src/test/invariants/fsDeletionGate.ts:52-71
- **Verifier:** CONFIRMED. **Evidence:** Two doc blocks back-to-back at 52-58 and 59-70, `ALLOWED_DELETERS` at :71, undocumented `EXPECTED_GAPS` at :73. The Cut is a move.
- **Cut / repair:** move lines 52-58 to immediately above `EXPECTED_GAPS` (:73).
- **Estimated net lines removed:** ~0. **Risk:** low — no behavior loss identified by static review; preserve the stated surviving coverage.

**Axis estimate:** ~244 net lines.


## Separate product and behavior decisions

These are not included in the cleanup pool. A registered command can be invoked programmatically or bound by a user even without shipped contributions; absence from package.json is not a proof that removing registration affects nobody.

### D-11 [RESOLVED] Retire the receiver-only `vaultFork` path

- **Location:** src/types/messages.ts:388-393; handler src/providers/TerminalViewProvider.ts:1166-1170
- **Verifier:** CONFIRMED — product decision, excluded from the safe total. **Evidence:** `grep -rn vaultFork src` non-test → the type literal + the `case`; no webview sender. `VaultPanel.test.ts:255` pins the absence.
- **Cut / repair:** either restore a fork affordance or retire the mode end-to-end (message, case, `LaunchMode` arm, `forkCommand` templates, `forkSupport.ts` + its probe call, `canFork` plumbing).
- **Estimated net lines removed:** ~180. **Risk:** medium — this is a product decision, not a mechanical delete; `forkSupport`'s memoized probe can also cost one subprocess per extension process, so leaving it is not free.
- **Resolution (2026-09-06):** RETIRE. Fork UI was explicitly removed before the first Vault release; remove the preserved backend, capability plumbing and stale user-facing claims so the implementation matches the shipped Resume/Continue product.

### D-12 [RESOLVED] Contribute the registered renameTab command

- **Location:** src/extension.ts:2181-2216; src/providers/resolveRenameTarget.ts:1-38; src/providers/resolveRenameTarget.test.ts:1-84; package.json contributions
- **Verifier:** CONFIRMED — product decision, excluded from the safe total. **Evidence:** `grep -n "renameTab\|terminalTab" package.json` → no output, exit 1. Registration at `extension.ts:2192`. `resolveRenameTarget.ts` is 38 real lines, its test 84.
- **Cut / repair:** Product decision: contribute the intended palette/menu/F2 entry points, OR explicitly retire the registered command and helper/test. Correct the advertised behavior in either case. Registration means executeCommand or a user-defined binding may still reach it; absence from contributes is not proof of universal unreachability.
- **Estimated net lines removed:** ~158. **Risk:** medium — this is dead *wiring*, so the fix direction (contribute vs. delete) is a product call. Note the `webviewSection: "terminalTab"` dataset is dead either way unless a menu clause uses it.
- **Resolution (2026-09-06):** CONTRIBUTE without a default keybinding. Git history and the accepted tab-rename design require double-click, root-tab context menu and Command Palette entry points; F2 was explicitly dropped because xterm passthrough was unreliable. The missing manifest entries were an implementation omission, not a later retirement.

### U-12 [P2] `claudeRecords.ts` inlines a weaker copy of its own exported `coerceTimestamp`; codex has a third.

- **Location:** src/vault/readers/claudeRecords.ts:36-49 (owner) ; src/vault/readers/claudeRecords.ts:243-245 (inline: `typeof t === "string" ? Date.parse(t) : typeof t === "number" ? t : Number.NaN` → `Number.isNaN(ts) ? 0 : ts`) ; src/vault/readers/codexReader.ts:643-651 (`parseTs`, same shape returning 0)
- **Verifier:** CONFIRMED. **Evidence:** `coerceTimestamp` has the epoch-ms-string branch at :41-44; the inline copy at :244 drops it; `codexReader.parseTs:643-651` drops it too. Real behavioural drift.
- **Cut / repair:** Resolve the differing epoch-millisecond-string timestamp contract before choosing one coercer. Sharing coerceTimestamp may change accepted inputs; retain provider-specific cases and verify intended outputs.
- **Estimated net lines removed:** ~8. **Risk:** medium — demonstrated semantic drift; not a behavior-neutral cleanup.


## Looks like slop but is not — rejected or deferred

| Candidate | Decision and reason |
|---|---|
| T2-02 error-code / error-class tests | REJECTED. Renaming the code string, changing the base class or copying rather than retaining the paths array produces a concrete regression mutation. These pin contracts, not the fixture. |
| T1-E11 cache-version floor | REJECTED. `VAULT_CACHE_VERSION >= 3` is a documented safety ratchet preventing reuse of pre-fix caches. Keep it. |
| T1-A02 initial detached toggle | DOWNGRADED to P3, excluded. The title-attribute reads are inert, but its aria-pressed assertion is the only initial-state pin in that suite. Rename; do not delete. |
| T1-E06 default record-size constant; T1-G13 popup dimensions | DOWNGRADED to P3, excluded. Neighboring behavior tests derive expectations from constants or pass explicit limits; the literal pins can catch a changed default. |
| T1-A07 fingerprint forwarding pair | DOWNGRADED; proposed deletion of 770–779 rejected. Different fingerprint values through the same path distinguish forwarding from returning a constant. Keep both. |
| T1-B05 / T1-B08 claimed subsuming tests | REJECTED AS CUTS by the chair. The verifier downgraded these to P3, but the cited replacement tests were not reproducible at the named ranges. Misleading names do not justify removing un-replaced coverage. |
| A-13 lockedJsonFile compatibility shim | DOWNGRADED to P3. Two-line live re-export, five import rewrites and disagreement between axes: negligible payoff, not a prioritized cut. |
| I-02 TabInputTextDiff | Keep it: ActiveFileRevealer.test.ts imports and constructs it. Only the other three unused classes are removable. |
| A-14 shell-escaping tests | Four scenarios occur only in DragDropHandler.test.ts. Move them to the owner; do not delete them. |
| T1-C04 VaultPanel exact four-label menu | Keep 535–544: stricter than the supposed replacement. Only the remaining identified duplicates are cuts. |
| T1-F13 non-ASCII file link | Keep the case; a BMP character is not a surrogate pair. Correct the comment, do not discard the only non-ASCII witness. |
| WorktreeCreate refusal tests | The suites open real forms before submit; the opening guard does not silently disarm these negative tests. |
| ProviderDeps case-fold fakes | The former filesystem case-fold probe was removed. providerKit.ts:340–360 documents name-based identity with no filesystem call; readProvisioning tests defend it. The old memory note describes a superseded mechanism. |
| Vitest isolate | cachedNodePty still exists at module scope. A fresh registry per file is required; do not disable isolation for perceived test overhead. |
| settleUntil and invariant reporter | Condition-based settlement is intentional; the invariant reporter intentionally declines filtered runs. The benchmark and Mocha host lane are deliberately outside test:unit. |
| Structural oneOwner/readOnly tests | Deliberate architecture guards with violating-fixture checks. They are not redundant behavior tests. sourceBytes is the specific missing-positive-control exception (T2-04). |
| Provider dispatch tests / activation tests / real-fs integration | Different dispatchers and cross-layer wiring require separate witnesses. Same names do not establish duplication. |
| Lexical containment vs realpath identity | Different contracts; preserve the documented boundary. Shared helper work must not merge them blindly. |
| Vault reader parsers | SQL, JSONL, malformed-record and bounded-byte semantics differ. Only the identified common leaves/lifecycle are candidates; do not unify entire readers. |
| Archived plans and renamed cyberk-flow references | Old plan versions are referenced history. Fix the live AGENTS.md pointer, not historical archives merely because they use the old name. |

## Verification before any cut lands

1. Make source changes only after the user selects a cut; no changes were made during this audit.
2. For test deletion, retain the named stronger witness and every unique input/output assertion. A different value can expose hard-coding even when it follows the same branch.
3. For test-only wrappers, move the tests onto the production surface; deleting their callers is not an acceptable shortcut. Preserve the benchmark caller and shared-mock lifecycle controls.
4. For shared helpers, preserve cancellation, rejection, disposal, per-file isolation, path/platform behavior and variant overrides. U-11 requires a lifecycle/retry-focused review; U-12 needs a behavior decision.
5. Before any scoped Vitest run, check `pgrep -f "vitest run" || true` and coordinate with the performance audit. Never start the full suite for this findings task. Follow the repo’s type/lint/invariant gates when implementing approved cuts.

## Agents and models

| Launch | Assignment | Configured model |
|---|---|---|
| Direct 1 | Axis1A initial compiler | claude-fable-5-1[1m] |
| Direct 2 | Axis1B tests | claude-fable-5-1[1m] |
| Direct 3 | Axis2 abstraction | claude-fable-5-1[1m] |
| Direct 4 | Axis3 dead code | claude-fable-5-1[1m] |
| Direct 5 | Axis4 duplication | claude-fable-5-1[1m] |
| Direct 6 | Axes5/6 infrastructure/comments | claude-fable-5-1[1m] |
| Direct 7 | Axis1A redo/reconciliation | claude-opus-5[1m] |
| Direct 8 | Adversarial verifier, resumed for completion | claude-opus-5[1m] |
| Nested A | Worktree dialog tests | No override; resolved model unverified |
| Nested B | Worktree view/controller tests | No override; resolved model unverified |
| Nested C | Webview vault tests | No override; resolved model unverified |
| Nested D | Vault service/store tests | No override; resolved model unverified |
| Nested E | Vault reader tests | No override; resolved model unverified |
| Nested F | Webview core/fileTree tests | No override; resolved model unverified |
| Nested G | Webview links/messaging tests | No override; resolved model unverified |

**Total:** 15 launches. Resuming the verifier did not add an agent. This exceeded the requested cap; nested model compliance is not claimed.
