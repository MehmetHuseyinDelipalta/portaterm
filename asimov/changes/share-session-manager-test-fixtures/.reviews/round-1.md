# Review round 1 — share-session-manager-test-fixtures

- Date: 2026-09-06
- Cycle: 1
- Mode: discovery
- Scope: commit range `34a7680d..HEAD`
- Head: a4b5e61e948ac957d4b42d876bc65f1828a48ebe (tree clean for `src/**`; unrelated untracked `docs/audit/2026-09-05-performance-hunt.md` and modified `.gitignore` are outside the reviewed range)
- Reviewable lines: 0 production. Entire diff is test/fixture (`src/test/**`, `*.test.ts`) plus skipped `*.md` artifacts — reviewed inline per Phase 2.5 with a full specialist roster because fixture-equivalence is the whole risk
- Agents spawned: 5 (2 logic, 2 contracts, 1 reuse) + chair self-review
- Verdict: APPROVE
- Counts: 0 blocking / 0 warnings / 4 suggestions
- Split: n/a (no gating blockers)

## Verify-gate evidence (not re-run by review)

`bun run asm change verify-status share-session-manager-test-fixtures` — all 7 tasks `[x] exit 0`, each with a recorded suite-change justification and a token-diff claim that no assertion, `it()` or `describe()` line changed. workflow.md records check-types clean, `biome check src` exit 0, `gate:fs-deletion` ok, `test:unit` 305 files / 7862 tests against a 304 / 7845 baseline (growth confined to the new `src/test/sessionMocks.test.ts`).

## Central risk — adjudicated

The stated risk was **a migrated suite that still passes but for a different reason**: the shared double answering where a local one refused. Every widening was enumerated against the deleted body and traced to a production call site. All were found inert:

- `scheduleLivePanelsWrite` added to 4 suites that lacked it — reachable only through `EditorPanelRegistry.notify()`, called from `register`/`attachSession`/`unregister` (`EditorPanelRegistry.ts:28,42,50`), wired at `SessionManager.ts:205-212`. None of `deactivate`/`settingToggle`/`persist`/`shutdownLifecycle` touches the editor-panel API (grep: zero hits), so no previously-throwing call is now silently succeeding. `notify()` has no `try/catch`, so a reachable call would have failed loudly before, not silently.
- `isOutputPaused` `undefined` → `false` — sole reader `SessionManager.ts:736` uses it as a plain truthy test (`wasOutputPaused ? {flush:false} : undefined`, `if (wasOutputPaused)`); no `=== undefined` distinction exists.
- `pid` `undefined` → `99000` in the two provider suites — the only branch on it is `SessionManager.getLiveCwd` (`:939-943`), reached only via `openFileLink`/`previewFileLink` deps (both `vi.mock`ed to no-ops in those suites, `getLiveCwd` asserted as `expect.any(Function)` and never invoked) or `handleRequestVaultContextCwd` (no `requestVaultContextCwd` message in any provider suite). `paneEvidence` is never wired into the `SessionManager` instances those suites build, so `SessionManager.ts:607 ptyPid: pty.pid` reaches no store.
- `bufferFilePath` prefix collapse (`/tmp/snap/${id}` → `/tmp/${id}`) — no production file reads `bufferFilePath` off the *injected* double; `SessionStorage` calls only its own (`:224,245,312,336,379`). The one path member the SUT reads off the double is `bufferFileRelativePath` (`SnapshotPersistence.ts:901`), unchanged.
- `onData`/`onExit` plain field (`null`/`undefined`) → mirroring getter/setter — no production or test code distinguishes `null` from `undefined` for these.
- `readBufferFile`/`listBufferFiles` plain fn → `vi.fn` — identical return values; `vi.fn` only adds recording, and no suite asserts on those spies.
- `outputBufferMock` superset in `TerminalEditorProvider.test.ts` (which had only `append`/`handleAck`/`dispose`) — `pauseOutput`/`resumeOutput`/`updateWebview` live in `respawnFallbackShell` and the `restoreFrom` branch of `createSession`; neither is exercised by that suite. The two suites that do exercise `restoreFrom` (`onReady`, `restore`) already carried those members.

## Explicit judgments the caller asked for

**design.md § D6 — the five removed obligation claims.** Four are sound as argued. The fifth is under-argued but its conclusion is still correct:

- *bufferFilePath option dropped* — verified independently (see above). Correct, and correctly shrinks the change.
- *ptyManagerMock widening dropped* — verified: `PtyManager.loadNodePty()` results at `SessionManager.ts:467,699` are handed to `PtySession.spawn`, which is mocked in all five I-06 suites; nothing dereferences `loadNodePty().spawn` itself. Correct, and correctly shrinks the change.
- *default storage refuses to read back* and *per-suite `mockPtySessions` reset* — both kept anyway; removal changed no code.
- *generation bookkeeping is identical* — the stated justification ("the two suites that assert concurrency replace the decision outright with `mockImplementation`") does not cover the four migrated suites that do **not** override it. The conclusion survives for a different reason: no suite in the set asserts on `currentBufferGen`/`currentSidecarGen` (grep: zero hits), those are read only by production to capture `capturedGen`, and the bookkeeping was kept verbatim regardless. Under-argued, not wrong; nothing was wrongly removed.

**`asm refactor shape` reporting `test-bloat` at 252 lines.** Author's judgment upheld, not overruled. The shape's own prescribed remedy is "share fixtures and factories"; this file is the fixture owner that remedy produces, holds doubles rather than assertions, and its members are one cohesive concern (the SessionManager/Pty test surface). Firing the shape on the destination of its own remedy is a false positive here.

**`mockPtySessions` reset coverage.** All four adopting suites reset it in `beforeEach` before any pty is constructed (`TerminalEditorProvider.test.ts:33`, `TerminalViewProvider.test.ts:43`, `onReady:57`, `restore:70`). `TerminalViewProvider.test.ts`'s reset predates the change (it had a local array), which is why it shows no diff hunk. No cross-test handle leakage: the mirror lookup is `find(p => p.id === this.id)` and every adopting case uses a fresh UUID or a single fixed id within one test.

**The `SessionManager.test.ts` split (OBL-10), both directions.** Correct both ways. Its retained local `PtySession` captures `spawn`/`write`/`resize`/`kill`/`setShellIntegrationSink` plus the captured sink, which the shared 3-field handle cannot express and which its own assertions drive; nothing it retained is already expressible by `ptySessionMock()`. It also correctly kept writable `bufferSize`/`unackedCharCount` — the shared mock's plain public fields are equally writable, so `getMemoryMetrics` tests are unaffected. No adopting suite lost instrumentation it needs.

**Does the new contract test actually fail on mutation?** Yes, for 9 of 10 mutations probed against a scratch copy of the module: per-call vs per-addon index, cached-vs-live serialize, changed default, dropped `cb?.()`, unconditional `track` push, mis-set `disposed`, unbacked read-back leak, dropped `bumpBuffer` in `dropBuffer`/`commitBufferSync`, and an inverted stale check. It is not a restatement of the implementation. Two gaps recorded below.

## Findings

### F001
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P5
- Agent: asm-review-logic; chair
- Class: machinery
- File: src/test/sessionMocks.ts:141
- Title: `commitBufferSync` declares `data?: string`, widening past the interface it stands for
- Evidence: the real `SessionStorage.commitBufferSync(sessionId: string, data: string)` (`SessionStorage.ts:311`) has a required `data`. All three production call sites pass a non-optional `string` — `SnapshotPersistence.ts:318,728` pass `result.buffer` from `generateSnapshotMetadata(): { metadata; buffer: string } | null`, `:383` passes the literal `""`. The `data !== undefined` guard is therefore an unreachable branch.
- Impact: none observable. The double stops matching the shape it substitutes for, and the dead guard invites a future reader to believe `undefined` is a real case.
- Reach: none — test-double only, no production path can pass `undefined`.
- Adjudicated-by: asm-review-logic (opus)
- Adjudication: enumerated all three production call sites and their return types; `generateSnapshotMetadata`'s `buffer` is typed `string` and `""` is `!== undefined`, so the guarded branch is unreachable from production.
- Witness: none — an unreachable branch has no behavioral witness by construction.
- SuggestedFix: `commitBufferSync: vi.fn((id: string, data: string) => { if (backed) buffers.set(id, data); bumpBuffer(id); })`
- Status: accepted
- Triage: Accepted. The double should match the shape it substitutes for, and a guard no production path can reach is exactly the kind of dead branch this change exists to remove. Trivial fix.

### F002
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: asm-review-contracts; chair
- Class: machinery
- File: src/test/sessionMocks.test.ts
- Title: the backed `commitBufferAsync` success-write is pinned by nothing
- Evidence: every async test in `sessionMocks.test.ts` uses the default unbacked `sessionStorageMock()`, so deleting `buffers.set(id, data)` from the success path (`sessionMocks.ts:152`) leaves the contract test green. No consumer catches it either — the sole backed consumer, `SessionManager.hydrate.test.ts`, never reads `_buffers` and never asserts on `commitBufferAsync` (grep: zero hits for both).
- Impact: one line of the shared factory is unwitnessed. The file's stated purpose is to pin the factory so an edit cannot silently change what 18 consumer suites observe; this behavior falls outside that net, and a future suite that opts into `buffers` and relies on async commits landing would inherit a silently-broken double.
- Reach: none — test-only.
- Adjudicated-by: asm-review-contracts (luna)
- Adjudication: applied the mutation to a scratch copy of the module and ran the suite — green. Confirmed the gap independently against `hydrate.test.ts` by grep for `_buffers` / `commitBufferAsync`.
- Witness: none — the gap is the absence of a witness; adding one is the fix.
- SuggestedFix: add a case to the backed-storage block: `commitBufferAsync(id, "v2", gen)` at the current generation returns `"renamed"` **and** `readBufferFile(id)` then returns `"v2"`.
- Status: accepted
- Triage: Accepted. This is a gap in my own contract test, not in the factory: the file's whole purpose is to pin the factory, and the backed success-write falls outside the net. The reviewer reproduced it by mutation on a scratch copy.

### F003
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P5
- Agent: asm-review-contracts
- Class: machinery
- File: src/test/sessionMocks.ts:218
- Title: `onWrite`-before-`cb` ordering is deliberate but unpinned
- Evidence: `headless(...).write` runs `options.onWrite?.(data)` then `cb?.()`. Swapping the two leaves `sessionMocks.test.ts` green — no test observes the sink from inside the write callback. `SessionManager.exit.test.ts`'s deleted local copy pushed before calling `cb`, so the order is a preserved property, not an accident.
- Impact: none today — no consumer reads `writes` from inside the callback. It becomes load-bearing the moment one does, and the contract test would not defend it.
- Reach: none — test-only; OBL-6 as written claims write order and callback firing, not their relative order, so this is a gap in the obligation's statement rather than a violation of it.
- Adjudicated-by: asm-review-contracts (luna)
- Adjudication: applied the swap to a scratch copy and ran the suite — green; read OBL-6's wording and confirmed it does not assert relative order.
- Witness: none — no consumer currently distinguishes the orders.
- SuggestedFix: in the `onWrite` test, assert from inside the `write` callback that the sink already contains the payload.
- Status: accepted
- Triage: Accepted. The order is a property the deleted exit.test.ts copy had, so preserving it silently is exactly the drift this change is meant to prevent. Pinning it also closes the wording gap the reviewer found in OBL-6.

### F004
- Severity: SUGGEST
- Confidence: MEDIUM
- Priority: P5
- Agent: asm-review-contracts
- Class: machinery
- File: src/test/sessionMocks.ts:83
- Title: superset adoption grows unexercised mock surface in the two provider suites
- Evidence: `TerminalEditorProvider.test.ts` and `TerminalViewProvider.test.ts` now inherit `flush`, `pauseOutput`, `resumeOutput`, `updateWebview`, `isOutputPaused`, `bufferSize` and `unackedCharCount`, none of which any test in those files reaches (verified per member above). `flush` in particular has no production caller at all — `dispose({ flush: false })` is an unrelated option, not a call to this member.
- Impact: the "superset double" rule is explicitly accepted in design D1, and the same was already true of the two suites that carried these members before, so this is not a regression. It does mean future `OutputBuffer` wiring can land in those providers without any of these tests noticing the new call.
- Reach: none.
- Adjudicated-by: asm-review-contracts (sonnet)
- Adjudication: traced each added member to its production call sites and confirmed neither suite exercises the enclosing branch (`respawnFallbackShell`, the `restoreFrom` arm of `createSession`, `getMemoryMetrics`).
- Witness: none — dead mock surface has no behavioral witness.
- SuggestedFix: none required. If it is worth acting on later, drop `flush` from `outputBufferMock()` — it has no production counterpart being stood in for.
- Status: audit-backlog
- Triage: Valid and non-gating: it falsifies no accepted obligation and no load-bearing path — design D1's superset rule accepts unexercised members, and both suites already carried some before this change. Not fixed now because dropping `flush` from the shared `outputBufferMock` reaches all 18 consumer suites, which is disproportionate to a P5 with Reach: none at the end of a cycle. Owner: whoever next wires OutputBuffer into TerminalEditorProvider or TerminalViewProvider. Reactivation trigger: the first production call to flush/pauseOutput/resumeOutput/updateWebview added to either provider, or any test in those two suites that begins asserting on one of these members.

## Sub-agents spawned

- asm-review-logic: `sessionStorageMock` + its 6 consumers — storage-double equivalence, generation bookkeeping, backing store — opus[1M]
- asm-review-logic: `headlessFactories` + its 6 consumers + the bespoke snapshot suite — serialize closure contract, `track`, `onWrite` — gpt-5.6-terra[1M]
- asm-review-contracts: the 5 I-06 suites — module-mock member-set contract, `mockPtySessions` global, `vi.mock` laziness — sonnet[1M]
- asm-review-contracts: `sessionMocks.test.ts` — mutation sensitivity of the new contract test — gpt-5.6-luna[1M]
- asm-review-reuse: whole diff — consolidation completeness, residual duplication, module cohesion, `test-bloat` shape — gpt-5.6-luna[1M]
