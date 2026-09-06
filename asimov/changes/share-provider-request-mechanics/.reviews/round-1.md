# Review round 1 — share-provider-request-mechanics

- Date: 2026-09-06
- Cycle: 1
- Mode: discovery
- Scope: commit range `8484a26f..HEAD` (8 commits, `4b19525c..1115ddd7`)
- Head: `1115ddd703aa1404d7352d854e37a001904a1717`
- Tree state: dirty at review time, but only `.gitignore` and `asimov/changes/share-provider-request-mechanics/analytics.json` — neither is in the reviewed range and neither was reviewed.
- Reviewable lines: 449 added (`webviewRequests.ts` 361, `TerminalEditorProvider.ts` 43, `TerminalViewProvider.ts` 45; 479 deleted)
- Test files (Phase 2.5 + one dedicated specialist): `webviewRequests.test.ts` (+393), `providerRequestWiring.test.ts` (+210)
- Skipped: `proposal.md`, `design.md`, `tasks.md`, `workflow.md`, `specs/NO-DELTA.md`, `analytics.json`
- Agents spawned: 5 (logic ×2, reuse, contracts, data-security). Frontend and performance skipped — no React/UI-state surface, no growth axis, no persistence or list endpoint in the diff.
- Verdict: WARN
- Counts: 0 BLOCK / 2 WARN / 4 SUGGEST

## Verification evidence cited (not re-run)

Per the chair rule, the build's Verify Gate is the evidence: `bun run asm change verify-status share-provider-request-mechanics` reports all six tasks exit 0. `workflow.md` records `check-types`, `biome check src`, `gate:fs-deletion` and `build:check-requires` clean; `pnpm run test:unit` has 2 failures in `src/worktree/adoptWorktree.integration.test.ts`, reproduced on a clean detached worktree at base `8484a26f`, and that file is untouched by this change.

## Chair full-flow trace

Traced end to end for both providers, per supported mode: webview message entry (`onDidReceiveMessage` → `isValidPreviewRequest` gate, unchanged) → session/vault-service guards → shared handler → cancellation registry → collaborator resolve → post (once vs retry) → error path → `finally` disposal → webview-dispose `cancelAll`. No divergence found.

The chair also machine-checked the extraction's own premise at base: a normalised diff of the four handlers between `8484a26f:TerminalEditorProvider.ts` and `8484a26f:TerminalViewProvider.ts` shows the three "logic-identical" handlers differ ONLY by the `webview: vscode.Webview` parameter and its threading, and `handleRequestSubagentPreview` differs ONLY by `safePostMessage` vs `void safeSendWithRetry` on all four reply paths. No unlisted behavioural difference existed for the extraction to silently unify. The three preserved asymmetries (`post`, `isCurrent()`, `logSuffix`) are each wired to the correct side.

## Findings

### F001

- Severity: WARN
- Confidence: HIGH
- Priority: P1
- Agent: chair; asm-review-logic (test-vacuity)
- Class: feature
- File: src/providers/providerRequestWiring.test.ts (missing case); src/providers/TerminalEditorProvider.ts:546
- Title: OBL-8's wiring half does not exist for the file-preview label, and workflow.md records it as passing
- Evidence: `providerRequestWiring.test.ts` contains no `requestFilePreview` case at all — its five tests cover OBL-4 (subagent 1-vs-3), OBL-8's vault-list pair, and OBL-6. `grep -rn "requestFilePreview failed" src/` returns exactly three hits: the production template at `webviewRequests.ts:172` and two assertions at `webviewRequests.test.ts:390-391`, which drive the shared handler directly with `logSuffix: " (editor)"` and `logSuffix: ""` supplied by the test itself. design.md OBL-8 states the requirement in its own words — "Wiring: `providerRequestWiring.test.ts` (1_3) — force both failures through each real provider and assert the four exact strings; the module test alone stays green under a swapped label" — and tasks.md `1_3` Plan step 4 repeats it. workflow.md's `Witnesses:` line records `OBL-8 pass (both halves)`.
- Impact: Change `logSuffix: " (editor)"` to `logSuffix: ""` at `TerminalEditorProvider.ts:546` and the entire suite stays green: the module test never reads a provider, the wiring test has no file-preview case, and no other test in `src/` asserts that string. Half of the log pair the design calls "how these paths get diagnosed" is unpinned, and the workflow record overstates the evidence.
- Reach: none — a wrong suffix in the output channel degrades maintainer diagnostics; no user data, wrong target, security boundary, or primary flow is affected.
- Adjudicated-by: asm-review-logic (test-vacuity assignment, gpt-5.6-luna[1m])
- Adjudication: Independently located the same hole and established the mechanism: the module test at `webviewRequests.test.ts:370-392` "verifies only that the shared handler accepts and emits suffixes; it cannot detect provider wiring", and no `requestFilePreview` case reaches either real provider. It also named the mirror mutation (giving the view the editor suffix), which survives equally. Reach adjudicated as none — diagnostics only.
- Witness: none today. After the fix: `pnpm exec vitest run src/providers/providerRequestWiring.test.ts` — catches `logSuffix: " (editor)"` → `""` at `src/providers/TerminalEditorProvider.ts:546`, and `logSuffix: ""` → `" (editor)"` at `src/providers/TerminalViewProvider.ts:368`.
- SuggestedFix: Add the file-preview wiring case tasks.md `1_3` step 4 already specifies — force `previewFileLink` to reject through each real provider's `requestFilePreview` entry point and assert both exact warning strings, exactly as the vault-list pair is done at `providerRequestWiring.test.ts:144-175`. Then correct the `Witnesses:` line in workflow.md, which currently claims a witness that is not there.
- Status: accepted
- Triage: The record is wrong, not just thin: workflow.md's `Witnesses:` line asserts OBL-8 passes in both halves and the wiring half for the file-preview label does not exist. tasks.md 1_3 Plan step 4 required all four strings and I shipped two. Adding both provider cases and correcting the workflow.md line.
- Triage: pending

### F002

- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair; asm-review-logic (test-vacuity)
- Class: feature
- File: src/providers/webviewRequests.test.ts:128-144
- Title: OBL-2's "disposes exactly once" half is a tautological witness — only `cancel()` is pinned
- Evidence: The test spies `dispose` on a source it owns, asserts 0 calls after `registry.cancel("s1")` (this half is sound and does kill the "cancel disposes" mutation), then the TEST ITSELF calls `source.dispose()` at `:142` and asserts the count is 1 at `:143`. The second assertion observes only the call the test just made; it cannot fail unless `vi.spyOn` is broken. The production disposal lives at `webviewRequests.ts:178-182`, in a `finally` whose source is constructed internally at `:138` (`new vscode.CancellationTokenSource()`), and no test spies the mocked constructor.
- Impact: Deleting `source.dispose()` from `handleFilePreviewRequest`'s `finally` fails nothing in the suite. The shipped code is correct — this is a witness gap, not a live defect — but OBL-2's claim is "every request disposes its own token source exactly once" and only the first clause is established. A leaked `CancellationTokenSource` per hover preview would ship undetected.
- Reach: none — the shipped code disposes correctly; the gap is in the evidence, not the behaviour.
- Adjudicated-by: asm-review-logic (test-vacuity assignment, gpt-5.6-luna[1m])
- Adjudication: Reached the same conclusion from the code: "the assertion of one call at `:143` only proves that the spy counts the test's own call. Removing `source.dispose()` from `handleFilePreviewRequest`'s `finally` block would therefore pass this test and is not covered by another cited test." Confirmed no other test in the change covers it. Reach none — cleanup only.
- Witness: none today. After the fix: `pnpm exec vitest run src/providers/webviewRequests.test.ts` — catches deleting `source.dispose()` from the `finally` at `src/providers/webviewRequests.ts:178-182`.
- SuggestedFix: Spy the mocked `vscode.CancellationTokenSource` constructor (`src/test/__mocks__/vscode.ts`) inside a `handleFilePreviewRequest` case and assert exactly one `dispose()` on the constructed source after the handler resolves. Keep the existing `cancel()`-does-not-dispose assertion — it carries the other half.
- Status: accepted
- Triage: Correct and it is my recurring defect: the second assertion observes the test's own `source.dispose()` call, so the handler's `finally` disposal has no witness at all. Spying the mocked `CancellationTokenSource` constructor inside a `handleFilePreviewRequest` case fixes it.
- Triage: pending

### F003

- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: asm-review-logic (test-vacuity); chair
- Class: feature
- File: src/providers/providerRequestWiring.test.ts:204-207
- Title: OBL-6's wiring witness is a pure negative assertion with no positive control
- Evidence: The only assertion is `expect(delivered).not.toContain("claude:stale")`. A negative `toContain` passes on an empty array, so any future change that stops the provider delivering a `vaultSessionsResponse` at all leaves the test green while OBL-6 goes unwitnessed.
- Impact: Latent only. The chair traced the current path: `mountView`'s `send({type:"ready"})` does not touch the vault (`onReady` has no vault call), so `refresh` call 1 is the request's and stays pending; the rename lands on the overlay path (`TerminalViewProvider.ts:638-648`), where `listCached()` returns undefined and `refresh()` call 2 resolves `claude:renamed` and posts it. `delivered` is `["claude:renamed"]` today, so the named second-counter mutation IS caught.
- Reach: none
- Adjudicated-by: chair (finder was asm-review-logic)
- Adjudication: Walked the `mountView` → `ready` → `requestVaultSessions` → `vaultRenameSession` path against `TerminalViewProvider.ts:596-653` and confirmed `delivered` is non-empty at assertion time, so the witness is weak rather than vacuous. Downgraded from the finder's WARN/P2 on that evidence delta; the finder's own disposition agrees the counter mutation is caught.
- Witness: `pnpm exec vitest run src/providers/providerRequestWiring.test.ts` — currently catches a second counter in the shared module; would not catch a total delivery failure.
- SuggestedFix: One line — add `expect(delivered).toContain("claude:renamed")` before the negative assertion.
- Status: accepted
- Triage: Weak rather than vacuous, as the chair traced — but one line closes it, and OBL-6 is the row whose whole point is that a delivery happened and the RIGHT one won.
- Triage: pending

### F004

- Severity: SUGGEST
- Confidence: MEDIUM
- Priority: P4
- Agent: asm-review-contracts; chair
- Class: feature
- File: src/providers/webviewRequests.ts:98-101
- Title: `PreviewTokenRegistry.begin` diverges from the approved D1 signature, moving source ownership to the caller
- Evidence: design.md D1 declares `begin(sessionId: string): vscode.CancellationTokenSource` — the registry constructs and returns the source. The shipped shape is `begin(sessionId: string, source: vscode.CancellationTokenSource): void`, with the only caller constructing it five lines earlier at `webviewRequests.ts:138`.
- Impact: The designed factory shape made "one fresh, un-cancelled source per `begin`" structural — a caller never sees a constructor, so it cannot pass a stale, already-cancelled, or shared source. The implemented shape permits a future caller to reuse one source across two `sessionId`s, which would cross-wire cancellation between unrelated sessions. Behaviour today is identical to `8484a26f`.
- Reach: none
- Adjudicated-by: asm-review-contracts (sonnet[1m])
- Adjudication: "Reach: none today — the single caller (`handleFilePreviewRequest`) always constructs a fresh source immediately before calling `begin`, so no current behavior differs from `8484a26f`. This is a latent contract weakening, not a live bug." Chair downgraded the specialist's proposed WARN/P3 to SUGGEST on the evidence delta that exactly one caller exists and it sits in the same file, five lines above the call.
- Witness: none — no behavioural difference exists to witness.
- SuggestedFix: Either match D1 (`begin(sessionId): CancellationTokenSource`, registry constructs and returns) or record the deviation in design.md D1 before archive, so the accepted anchor and the code agree.
- Status: accepted
- Triage: Fixing the code to match D1 rather than the doc: `begin(sessionId)` will create, install and return the source. That keeps design.md untouched (no D# decision moves, so no handback) and removes the caller's ability to install a source the registry did not make.
- Triage: pending

### F005

- Severity: SUGGEST
- Confidence: HIGH
- Priority: P5
- Agent: asm-review-reuse
- Class: feature
- File: src/providers/webviewRequests.ts:24-33
- Title: A third copy of the swallow-both-failures webview post survives in `src/extension.ts`
- Evidence: `postOnce` repeats the sync-throw + rejected-thenable swallowing already at `src/extension.ts:2306-2313` (`safePostMessage`, typed `vscode.Webview | MessageSender`).
- Impact: One delivery primitive maintained in two places after a change whose purpose was consolidation.
- Reach: none — maintenance drift only.
- Adjudicated-by: chair (finder was asm-review-reuse)
- Adjudication: `git diff --stat 8484a26f..HEAD -- src/extension.ts` is empty — that copy is unchanged code, and it predates this change. The diff took the copy count from three to two rather than creating one, and proposal.md § Scope explicitly bounds the change to the two providers. Downgraded from the finder's WARN/P3 to SUGGEST and recorded as out-of-scope follow-up, per the chair rule against flagging unchanged code.
- Witness: none — no behavioural claim.
- SuggestedFix: Follow-up change, not this one: move the `extension.ts` helper onto `postOnce` (widening its parameter to `vscode.Webview | MessageSender`) and delete the local copy.
- Status: audit-backlog
- Triage: Valid and out of this change's declared scope: `src/extension.ts:2306` is untouched by the diff and proposal.md scopes this change to the two providers. It cannot falsify any obligation row here. Owner: next slop-audit pass. Reactivation trigger: any change that edits `src/extension.ts`'s webview posting path.
- Triage: pending

### F006

- Severity: SUGGEST
- Confidence: MEDIUM
- Priority: P5
- Agent: asm-review-logic (test-vacuity)
- Class: feature
- File: src/providers/webviewRequests.test.ts:188; src/providers/providerRequestWiring.test.ts:125,137
- Title: Fixed 300 ms settle windows in the retry witnesses are absolute margins in a suite documented as load-flaky
- Evidence: `settleRetries()` and the two inline `setTimeout(resolve, 300)` waits must cover two real 50 ms retry sleeps plus their promise continuations. That is 3× headroom, but it is an absolute wall-clock budget, and `asimov/project.md` documents `pnpm run test:unit` as load-flaky under 12 workers.
- Impact: A correct implementation could report the wrong attempt count under heavy load, and a failure here would be ambiguous between a regression and the environment.
- Reach: none
- Adjudicated-by: chair (finder was asm-review-logic)
- Adjudication: Half the finder's evidence is refuted. The OBL-3 case at `webviewRequests.test.ts:89-101` is NOT margin-dependent: the 20 ms abort timer and the loop's 50 ms sleep are armed in the same event-loop turn, so Node runs the 20 ms callback first whenever both are due — loop starvation delays both equally. Only the 300 ms budgets survive as a real risk. The finder's proposed remedy (fake timers) is refuted by design.md D6's measured note that the retry loop interleaves sleeps with promise resolutions a fake clock does not drive. Downgraded WARN/P2 → SUGGEST/P5 on that evidence delta; the workable remedy is an injected sleeper, which is a design change beyond this change's scope.
- Witness: none — no behavioural claim.
- SuggestedFix: If this ever flakes, inject the sleeper into `postWithRetry` rather than reaching for fake timers, which D6 already measured and rejected.
- Status: audit-backlog
- Triage: Half already refuted by the chair (OBL-3 is timer-ordering, not margin-based, and D6 measured and rejected fake timers). The remaining half — 300 ms absolute budgets — is real but the fixed wait is inherent where the claim is the ABSENCE of further posts, which polling cannot establish. Owner: whoever next converts this suite off wall-clock waits. Reactivation trigger: a CI failure in either file that is a timeout rather than an assertion.
- Triage: pending

## Checked and clean

- Message shapes: `filePreviewResponse`, `vaultSessionsResponse` (both `fromCache` values), `vaultSessionDetailResponse` (detail / not-found / error), `subagentPreviewResponse` (all four branches), and the `error` notice are identical in type, field set, field order and values to `8484a26f` for both providers, including the `...echo` `requestId` spread position and the conditional `entryId` spread.
- Ordering and delivery policy: cache post never retried (OBL-5); fresh post retried with the `!isCurrent()` abort; `handleVaultSessionDetailRequest` retries all three reply paths as both originals did; the editor's subagent replies post once and the view's retry on all four paths (OBL-4).
- Lifecycle: `cancel` does not dispose; `end` is identity-guarded (OBL-1); `cancelAll` copies the key list; each request's `finally` disposes exactly once; `cancelAll` on webview dispose leaves in-flight `end()` a harmless no-op. Constructing the source before cancelling the prior one (`begin` does cancel-then-set) is not observably different — the cancel→set order that matters is preserved inside `begin`.
- The editor's eager `this._panel.webview` capture is safe: `_panel` is `private readonly` (`TerminalEditorProvider.ts:119`), assigned once (`:218`), and `WebviewPanel.webview` is a stable readonly property.
- Guards: `!this.vaultService` still precedes `++this._vaultRefreshSeq` in both providers, so a request with no vault service does not burn a token; `!sessionManager.getSession(...)` still runs before any resolution work or token creation (the forged/stale-id hole round-2 W3 plugged).
- Security: the `previewFileLink` dependency object moved verbatim — `blockSensitive`, bounded reads, workspace fs handles, cwd resolvers, directory/symlink FileTypes all unchanged; `readHoverPreviewSettings()` reads the same scope; `subagentResolveDeps` resolves PID/cwd/mtime from the same sources and its export widens no extension surface; no error path posts or logs more than before.
- Dead code: no dangling reference to the removed `cancelPreviewToken` / `cancelAllPreviewTokens` / `subagentResolveDeps` members anywhere in `src/`; every import dropped from the providers has a corresponding use in the new module; every import kept still has a use. The stale editor JSDoc that described the subagent handler while sitting above the vault-list method was removed — a pre-existing defect this change cleaned up.
- No circular import introduced: `webviewRequests.ts` imports nothing from either provider.
- Cohesion: the module is inbound webview request mechanics; `subagentResolveDeps` is used only by `handleSubagentPreviewRequest`, so colocating it is not a grab-bag.
