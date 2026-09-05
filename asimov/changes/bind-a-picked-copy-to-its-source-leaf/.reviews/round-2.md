# Review round 2 — bind-a-picked-copy-to-its-source-leaf

- Date: 2026-09-05
- Cycle: 1
- Mode: verification
- Lane: fastlane
- Escalation flags: security-privacy, cross-boundary
- Head reviewed: `5896efd94cac48fe21c5dcee01210289dda47555` (explicit remediation range; the checkout was dirty from review accounting in `asimov/changes/bind-a-picked-copy-to-its-source-leaf/analytics.json` and the caller-excluded working-tree edits `src/agentHooks/AgentHookController.test.ts` and `src/webview/worktree/worktreeFormat.ts`)
- Diff scope: `git diff 2ac044fa074a4c6659385b68bf42f8fc5247e1c5..5896efd94cac48fe21c5dcee01210289dda47555`
- Scope lock: passed — changed production code is confined to the round-1 lifecycle/accounting owners; the added task is remediation for F001-F004, and review/analytics artifacts add no capability, contract change, or invariant owner
- Reviewable lines: 220 added/modified across 3 reviewable production/data files, including 164 Asimov analytics lines; 129 changed test lines reviewed inline; 149 Markdown review/task lines were prior-round or remediation context
- Verdict: **BLOCK**
- Open counts: 1 BLOCK · 0 WARN · 0 SUGGEST
- Dispositions: 1 persists · 3 fixed
- Split over gating blockers: 1 feature / 0 machinery

## Agents

| Agent | Region | Lens | Model |
|---|---|---|---|
| asm-review-logic | source and destination stream teardown, abort race | F001/F003/F004 invariant verification | `opus[1M]` |
| asm-review-logic | held pre-copy byte accounting and mixed-material cone | F002 invariant verification | `gpt-5.6-terra[1M]` |
| chair | complete remediation range and impact cone | cross-round adjudication | `gpt-5.6-sol[1M]` |

Skipped specialists: `asm-review-data-security`, `asm-review-contracts`, `asm-review-frontend`, `asm-review-performance`, and `asm-review-reuse` — the remediation cone changes no offer/wire/auth contract, frontend behavior, growth axis, or abstraction boundary; lifecycle and accounting logic are the only touched lenses.

Verify-gate evidence is the recorded `bun run asm change verify-status bind-a-picked-copy-to-its-source-leaf`: remediation task `5_1` is `[x]`, exit 0, with the expected lifecycle/apply scope and 15 added assertions. The author impact manifest reports type check, Biome, 7,833 tests, production bundle/relative-require, and I10 gates passing at `5896efd9`; the chair did not rerun any project verify command or test suite. Targeted one-case runtime inspection/probes only were used to adjudicate F001.

---

## Findings

### [F001] Stream-owned close failure can still release the lifecycle slot

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair + asm-review-logic
- Class: feature
- File: `src/utils/heldRegularFile.ts:263-268`; `src/worktree/provisioning/applyEntries.ts:932-950`
- Status: accepted — persists from round 1
- Triage: The original source-stream witness is patched only for a public `handle.close` override that leaves `fd` unchanged. Node's actual close implementation sets the public fd to `-1` before its underlying close promise settles, so `fd === -1` is not proof of successful closure. The same invariant also remains open after destination ownership transfers to `createWriteStream`: the new lifecycle resolves after `copyPipeline` rejects for destination-close failure.

**Invariant.** A held lifecycle slot may release only after both stream-owned source and destination descriptors, plus the registered pipeline, have positively completed teardown. A stream event, public fd bookkeeping transition, or rejected pipeline is not by itself proof that the underlying descriptor closed.

**Boundary inventory.** Affected: source stream's underlying `FileHandle.close()` rejects after Node has set `fd = -1`; destination write-stream close rejects after `createWriteStream` took ownership. Verified safe: reserved/opening/held/claimed direct closure; direct `FileHandle.close()` rejection before stream transfer; normal source and destination stream closure; pending destination open; pre-stream destination close rejection; already-aborted and live-deadline caller settlement. The source and post-transfer destination are the two remaining stream-owned boundaries.

**Evidence.** Node v24.7.0's runtime `FileHandle.close` implementation decrements the reference count, sets its internal fd to `-1`, starts the underlying handle close promise, emits `close`, and only then returns the promise that may reject. Therefore line 267 accepts pending and failed underlying closure as success. The new test replaces the public `close` method entirely, so it never exercises this real ordering. Separately, after line 932 transfers the destination to a write stream and clears `destinationHandle`, `copyPipeline` can reject because the write-stream close failed while the descriptor remains live; lines 937-950 still resolve `lifecycle`. A targeted binding probe observed the destination-close error, `lifecycleSettled === true`, and a successful `fstat` on the destination fd.

**Impact.** Repeating either close-error path can remove slots from the charged set while source or destination descriptors remain live, so the hard 64-resource ceiling is still false. This is the same round-1 invariant and causal mechanism at its source and registered destination-teardown boundaries.

**Suggested fix.** Track the actual close promises for both stream-owned `FileHandle` objects and resolve lifecycle state only from their fulfillment. Do not use the eagerly changed public `fd` as proof. Preserve/capture the source handle's close promise when the stream invokes it, and retain the destination handle after `createWriteStream` so its close fulfillment is independently observable. One shared close-proof mechanism should cover both boundaries. Add real-order witnesses where the public fd has already become `-1` while underlying close later rejects, for source and destination, and assert the pool remains charged.

---

## Fixed prior findings

### [F002] A parent refusal spends held bytes that were never written

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair + asm-review-logic
- Class: feature
- File: `src/worktree/provisioning/applyEntries.ts:750-763,802-843`
- Status: fixed
- Triage: The verification specialist found no surviving accounting defect across the declared impact cone.
- Evidence: The new flags distinguish a valid precharge, copy start, and reconciliation. Every exit before `copyHeldFile` starts reaches the outer `finally` and settles the held size to zero; success, EEXIST, and partial-forwarded errors settle exactly once after start. Parent redirection, parent throw followed by fitting model material, and exclusive EEXIST/claim loss followed by fitting material now witness the shared budget.
- Impact: The prior zero-output budget exhaustion no longer reproduces; later model or held material retains the full unwritten capacity.
- Suggested fix: None; retain the new parent, authorization-loss, claim-loss, success, EEXIST, and partial-forwarding coverage.

### [F003] A rejected destination close hides the real error until the deadline

- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: asm-review-logic
- Class: feature
- File: `src/worktree/provisioning/applyEntries.ts:913-953`
- Status: fixed
- Triage: Caller-visible operation settlement is now separate from the lifecycle promise for the pre-stream destination-handle boundary.
- Evidence: When chmod or another pre-stream operation fails and the destination handle's close rejects, the close rejection leaves `lifecycle` unresolved but no longer awaits forever inside the operation's `finally`; the original operation error returns immediately. The new witness verifies both prompt caller rejection and pending lifecycle.
- Impact: The prior deadline-length mutation-queue stall and replacement of the original error no longer reproduce on this boundary.
- Suggested fix: None for F003. F001 separately covers whether post-stream descriptor teardown is proven before lifecycle release.

### [F004] The already-aborted race can leave its actual rejection unobserved

- Severity: WARN
- Confidence: MEDIUM
- Priority: P3
- Agent: asm-review-logic
- Class: feature
- File: `src/worktree/provisioning/applyEntries.ts:241-249`
- Status: fixed
- Triage: The operation observer is now attached before the already-aborted branch can return.
- Evidence: `actual.then` is registered before `signal.aborted` is examined, and the existing settled guard makes the later actual settlement inert after the abort rejection. The process-level witness records no `unhandledRejection`; live deadline behavior is unchanged.
- Impact: The prior unobserved operation rejection no longer reproduces.
- Suggested fix: None.

---

## Adjudication notes

- F001 keeps its original global ID and BLOCK severity. The source patch does not close the original positive-proof invariant under Node's actual close ordering, and the post-`createWriteStream` destination is another inventoried boundary violating the same invariant through the same stream-close mechanism; it is not a new finding ID.
- F002's source-first ordering remains intact: acquisition and precharge still happen before destination effects, while the outer `finally` refunds only when copy never started. Model copy/directory/link paths are unchanged.
- F003 is fixed at the pre-stream destination boundary. Its lifecycle-retention issue after stream transfer is adjudicated under F001 rather than keeping F003 open, because the caller now receives the correct error promptly.
- F004 is fixed independently of `finishWhen`; `raceCopyTeardown` itself observes the operation before any abort return.
- No admissible new finding outside the remediation cone was found. No audit backlog or accepted risk is open.
- Changed tests contain no `.only` or new `.skip`. Async remediation cases await their witnesses. The missing real-order source close and post-transfer destination close witnesses are evidence for persistent F001 rather than separate test-only findings.

## Impact-cone trace

- **Source lifecycle:** reservation, admission, holder, claim, and normal source-stream completion remain unchanged. The retained source handle adds a check at stream close, but Node's fd bookkeeping precedes and cannot prove underlying close fulfillment, so F001 remains.
- **Destination lifecycle:** pending open and pre-stream handle closure now split operation result from lifecycle retention correctly. After ownership moves to the output stream, pipeline settlement still resolves lifecycle without an independent successful destination-close witness, extending F001 across the registered copy teardown.
- **Apply accounting:** held-source acquisition remains before all destination effects. Parent/refusal/authorization exits refund the precharge; once copy starts, ordinary success/EEXIST/partial-failure accounting remains unchanged. F002 closes.
- **Cancellation/error output:** both actual-operation branches are observed before an already-aborted answer; pre-stream close rejection reports the original error immediately. F003 and F004 close.
- **Unaffected cone:** `ApplyFsDeps.copyHeldFile` signature and fake binding are unchanged; held material remains copy-only; model material still reaches only `copyFileNoFollow`; host, offer, wire/privacy, mutation ownership, reports, and manifests are unchanged.
