# Review round 3 — bind-a-picked-copy-to-its-source-leaf

- Date: 2026-09-05
- Cycle: 1
- Mode: verification
- Lane: fastlane
- Escalation flags: security-privacy, cross-boundary
- Head reviewed: `c861d79b3f264aea706fef382917ee505c02c248` (explicit second-remediation range; the checkout was dirty from review accounting in `asimov/changes/bind-a-picked-copy-to-its-source-leaf/analytics.json` and the caller-excluded working-tree edits `src/agentHooks/AgentHookController.test.ts` and `src/webview/worktree/worktreeFormat.ts`)
- Diff scope: `git diff 5896efd94cac48fe21c5dcee01210289dda47555..c861d79b3f264aea706fef382917ee505c02c248`
- Scope lock: passed — production changes are confined to F001's existing source/destination lifecycle owners and one shared close-proof helper; review/task/analytics updates add no capability, external contract, or new invariant owner
- Reviewable lines: 123 added/modified across 3 reviewable production/data files, including 40 Asimov analytics lines; 76 changed test lines reviewed inline; 125 Markdown review/task lines were prior-round or remediation context
- Verdict: **APPROVE**
- Open counts: 0 BLOCK · 0 WARN · 0 SUGGEST
- Dispositions: 4 fixed
- Arbiter: not invoked — no gating BLOCK remained after ordinary Phase 3 adjudication

## Agents

| Agent | Region | Lens | Model |
|---|---|---|---|
| asm-review-logic | shared source/destination FileHandle close proof | F001 invariant verification | `opus[1M]` |
| chair | complete remediation range and impact cone | cross-round adjudication | `gpt-5.6-sol[1M]` |

Skipped specialists: `asm-review-data-security`, `asm-review-contracts`, `asm-review-frontend`, `asm-review-performance`, and `asm-review-reuse` — the verification cone changes no offer/wire/auth contract, UI behavior, growth axis, or independent abstraction boundary. The shared helper exists solely inside F001's already-owned filesystem lifecycle.

Verify-gate evidence is the latest recorded `bun run asm change verify-status bind-a-picked-copy-to-its-source-leaf`: task `5_1` is `[x]`, exit 0, with the expected lifecycle/apply scope and four added assertions. The author impact manifest reports 4 focused files / 144 tests, type check, 297 files / 7,834 full-suite tests, Biome, production bundle/relative-require, and I10 gates passing on this tree. The chair did not rerun project verification or test suites; targeted runtime inspection only confirmed the close-wrapper's native success ordering and the streamed pipeline's close-settlement semantics.

---

## Findings

No open findings.

## Fixed prior findings

### [F001] Stream-owned close failure can release the lifecycle slot

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair + asm-review-logic
- Class: feature
- File: `src/utils/heldRegularFile.ts:14-49,288-312`; `src/worktree/provisioning/applyEntries.ts:932-958`
- Status: fixed
- Triage: The shared `trackFileHandleClose` mechanism now wraps each source and destination handle before stream ownership transfer and records fulfillment of the actual first close promise. Neither public `fd` bookkeeping, a stream `close` event, nor pipeline rejection can independently release the slot.

**Invariant.** One held lifecycle slot remains charged until the actual close promises for every stream-owned source and destination descriptor fulfill and the registered copy pipeline/lifecycle settles. Pending, synchronous-throwing, or rejected close remains charged.

**Boundary inventory.** Verified safe: source stream construction throw and wrapper restoration; normal, pending, synchronous-throwing, and rejected source close; source disposal and deadline destruction; destination open/abort/chmod/createWriteStream failure; direct destination close fulfillment/rejection; normal and rejected post-transfer destination close; stalled pipeline; repeated close calls; normal pool release only after both source proof and registered destination lifecycle complete.

**Evidence.** `trackFileHandleClose` invokes the original close method and latches the first returned promise before Node can expose its eager `fd = -1` transition. Only promise fulfillment resolves the proof true; synchronous throw and rejection resolve false. Source `streamClosed` is set only by that true result. Destination lifecycle calls `finishLifecycle` after post-transfer tracked close fulfills, while false/pending proof leaves the lifecycle unresolved. The new source and destination witnesses force public fd state to `-1`, then reject close while `fstat(liveFd)` still succeeds, and prove the one-slot pool remains charged and unavailable. Existing normal-copy witnesses prove successful source and destination close still release.

- Impact: The round-1/2 witness no longer reproduces; repeated close-error paths cannot escape the global 64-slot bound.
- Suggested fix: None. Retain the shared close-proof mechanism and both real-order source/destination witnesses.

### [F002] A parent refusal spends held bytes that were never written

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair + asm-review-logic
- Class: feature
- File: `src/worktree/provisioning/applyEntries.ts:750-843`
- Status: fixed
- Triage: Carried forward from round 2; this remediation does not touch byte-accounting state or its witnesses.
- Evidence: Pre-copy exits reconcile the held-size precharge to zero; once copy starts, success, EEXIST, and forwarded-byte failures settle exactly once. The latest verification record retains the round-1 F002 witnesses.
- Impact: No unwritten held bytes consume capacity for later materials.
- Suggested fix: None.

### [F003] A rejected destination close hides the real error until the deadline

- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: asm-review-logic
- Class: feature
- File: `src/worktree/provisioning/applyEntries.ts:917-958`
- Status: fixed
- Triage: The round-3 specialist proposed recurrence because the streamed branch awaits its tracked close proof. Rejected: `copyPipeline` itself awaits Node pipeline completion, and the FileHandle write stream does not settle that pipeline until its close promise settles. A copy whose streamed close is pending has not completed yet; the observed pending operation is the unchanged pipeline contract, not new coupling in `finally`. The pre-stream case from F003 remains separately decoupled and returns its already-known chmod/open/abort error immediately while lifecycle retention stays pending.
- Evidence: Pre-stream direct close rejection is caught without awaiting forever and preserves the original operation error. Post-transfer close rejection settles the pipeline with that close error, the tracked proof resolves false without releasing lifecycle, and the operation rejects rather than becoming a deadline-only answer. A pending streamed close correctly leaves both pipeline and operation pending because destination teardown is part of completion.
- Impact: The original error-hiding witness remains closed; no completed copy result is withheld by the added proof.
- Suggested fix: None. Do not detach caller success from a destination stream whose close has not settled.

### [F004] The already-aborted race can leave its actual rejection unobserved

- Severity: WARN
- Confidence: MEDIUM
- Priority: P3
- Agent: asm-review-logic
- Class: feature
- File: `src/worktree/provisioning/applyEntries.ts:241-249`
- Status: fixed
- Triage: Carried forward from round 2; this remediation does not change `raceCopyTeardown`.
- Evidence: The actual operation observer remains installed before the already-aborted branch returns; the settled guard prevents duplicate answers. The process-level no-unhandled-rejection witness remains in the verified suite.
- Impact: No unobserved rejection remains on the already-aborted path.
- Suggested fix: None.

---

## Adjudication notes

- No Arbiter Mode ran. Ordinary verification closed F001 before Phase 3 completed, leaving no open gating blocker for the round-3 arbiter to disposition.
- The specialist's proposed F003 recurrence was rejected with code/runtime evidence: the pending result occurs inside `copyPipeline` because Node pipeline includes destination close, before the added `finally` branch can run. Returning success while that close is pending would weaken the accepted teardown contract.
- The specialist's proposed audit-backlog item for a permanently charged slot after rejected destination close was rejected against D1, not deferred. The single slot intentionally represents the whole admission/source/copy/destination lifecycle, and rejected close does not prove the destination descriptor was released; retaining the slot through pool disposal is the required bounded fail-closed behavior.
- The helper is used at exactly the two inventoried stream-transfer boundaries. It restores the original close method only when stream construction throws before close begins; repeated closes remain tied to the first actual close promise.
- No admissible finding outside F001's impact cone was found. No audit backlog, external blocker, or accepted risk remains.
- Changed tests add no `.only` or `.skip`, and async close witnesses await their controlled promise transitions and restore real handles/spies in cleanup paths.

## Impact-cone trace

- **Source:** claim installs close tracking before `createReadStream`; construction failure restores the original method for the direct-close path. Normal fulfillment plus registered lifecycle releases; pending/rejected close, pool disposal, and deadline destruction retain until positive proof.
- **Destination before transfer:** open failure owns no handle; abort/chmod/createWriteStream failure stays on the direct-close branch. Successful direct close settles lifecycle; rejected direct close preserves the original operation error and retains lifecycle.
- **Destination after transfer:** the same tracker observes the stream's actual close promise. Pipeline and close fulfillment settle lifecycle; rejection reports the pipeline close error while retaining the slot; pending close remains an unfinished copy and is bounded by the existing caller deadline.
- **Unaffected cone:** F002 byte accounting and F004 rejection observation remain fixed. Fake held copy, model `copyFileNoFollow`, directories, links, contests, source identity, private offer/wire boundaries, mutation ownership, reports, and manifests are unchanged.
