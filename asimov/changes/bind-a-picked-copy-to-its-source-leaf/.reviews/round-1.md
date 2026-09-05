# Review round 1 — bind-a-picked-copy-to-its-source-leaf

- Date: 2026-09-05
- Cycle: 1
- Mode: discovery
- Lane: fastlane
- Escalation flags: security-privacy, cross-boundary
- Head reviewed: `2ac044fa074a4c6659385b68bf42f8fc5247e1c5` (explicit committed range; the checkout was dirty from review accounting in `asimov/changes/bind-a-picked-copy-to-its-source-leaf/analytics.json` and the caller-excluded working-tree edits `src/agentHooks/AgentHookController.test.ts` and `src/webview/worktree/worktreeFormat.ts`)
- Diff scope: `git diff 54319e80997a1bec172123522e747e6d4409bd63..2ac044fa074a4c6659385b68bf42f8fc5247e1c5`
- Reviewable lines: 1,103 added/modified across 10 reviewable production/data files, including 202 Asimov analytics lines; 1,296 changed test lines reviewed inline; 359 Markdown change-artifact lines were accepted context or skipped support sources
- Note: Large change — accuracy may decrease
- Verdict: **BLOCK**
- Counts: 2 BLOCK · 2 WARN · 0 SUGGEST
- Split over gating blockers: 2 feature / 0 machinery

## Agents

| Agent | Region | Lens | Model |
|---|---|---|---|
| asm-review-logic | held pool, handle/stream ownership, copy teardown | lifecycle races and resource release | `opus[1M]` |
| asm-review-logic | strict held apply and shared budgets | ordering, errors, deadline, accounting | `gpt-5.6-terra[1M]` |
| asm-review-data-security | no-follow admission, private offer sidecars, wire boundary | filesystem authority and privacy | `sonnet[1M]` |
| asm-review-contracts | material union, transactional claims, mutation ownership | cross-layer contracts | `gpt-5.6-terra[1M]` |
| asm-review-performance | pool, sidecars, promises, weak claim records | growth axes and resource bounds | `gpt-5.6-luna[1M]` |
| asm-review-reuse | holding, copy, offer, and queue abstractions | reuse and cohesion | `gpt-5.6-luna[1M]` |
| asm-finder | hold-to-apply and offer-to-wire callers | full-flow support trace | inherited |
| chair | complete committed range | all lenses and full-flow trace | `gpt-5.6-sol[1M]` |

Skipped specialist: `asm-review-frontend` — the explicit range changes no React/webview rendering or client-state implementation; changed webview-facing assertions were reviewed inline.

Verify-gate evidence is the recorded `bun run asm change verify-status bind-a-picked-copy-to-its-source-leaf`: tasks `1_1` through `4_1` are `[x]`, each with exit 0 and scope unchanged. The chair ran no project verify command, lint, type check, or test suite. Targeted one-case runtime probes only were used to confirm F001, F002, and F004.

---

## Findings

### [F001] A read-stream close failure still releases its lifecycle slot

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair + asm-review-logic
- Class: feature
- File: `src/utils/heldRegularFile.ts:260-263,331-335`
- Status: accepted
- Triage: The lifecycle specialist found the stream-close asymmetry. The chair elevated WARN to BLOCK because a targeted Node `FileHandle.createReadStream` probe made `FileHandle.close()` reject and observed `error` followed by `close` while `fstat(fd)` still succeeded; the changed slot code ignores the error, marks `streamClosed`, and releases once the pipeline settles.

**Invariant.** A slot may leave the charged set only after the underlying held descriptor and any registered copy teardown are proven complete; an error or event that does not prove descriptor closure must keep the slot charged.

**Boundary inventory.** Affected: claimed source stream completion and disposal when the stream-owned descriptor close rejects. Verified safe: reserved abandonment; pending admission before and after `onOpen`; held/claimed direct `FileHandle.close()` success; rejected direct handle close; normal source close with pipeline pending; settled source close with normal pipeline; pool disposal before source acquisition. Destination teardown is separately tracked by the registered actual copy promise.

**Evidence.** `acquireSource()` installs `stream.on("error", () => {})`, then treats every `close` event as successful descriptor teardown by setting `streamClosed = true`. `releaseFinishedSource()` asks only for `streamClosed && pipelineDone`. Node emits `error` and then `close` when the stream's `FileHandle.close()` rejects; the descriptor can remain open. The direct-handle path at lines 309-317 correctly does the opposite by retaining the slot on close rejection.

**Impact.** The pool can admit a replacement lifecycle while the failed-close source descriptor remains live, so the stated hard 64-resource ceiling is false on a concrete close-error path. This is one of the accepted change's load-bearing safety boundaries, not a best-effort cleanup preference.

**Suggested fix.** Preserve a positive descriptor-closure witness for the stream-owned `FileHandle` rather than treating `close` alone as proof. For example, retain the transferred `FileHandle` object and release only when its descriptor state proves closed after the stream event; on ambiguity or rejected close, keep the slot charged. Add a close-rejection witness that asserts both the live fd and `pool.charged === 1`.

---

### [F002] A parent refusal spends held bytes that were never written

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair + asm-review-logic
- Class: feature
- File: `src/worktree/provisioning/applyEntries.ts:752-768`
- Status: accepted
- Triage: Independently found by the chair and strict-apply specialist. A targeted mixed-material probe produced a held parent failure with `spent.bytes === 50`; the following one-byte model entry was then refused against a 50-byte budget even though the held entry created no file.

**Invariant.** The shared byte budget accounts for bytes written or conservatively attributable to a transfer; a held source acquired before destination preparation must not charge its entire admission-time size when no copy starts.

**Boundary inventory.** Affected: `ensureParents()` refusal, `claimLost`, and throw after held-source acquisition but before `copyHeldFile`. Verified safe: held source too large before destination effects; successful held copy reconciliation; `EEXIST` reconciliation to zero; transfer failures carrying `withBytesForwarded`; source growth bounded by the remaining ceiling; ordinary model-copy accounting. The held top-level node charge reflects an acquired source and is not part of this finding.

**Evidence.** The held branch calls `spendBytes(heldSource.size)` at line 759 before `ensureParents()`. Every parent early return at lines 762-768 exits without calling either `settleBytes` path at lines 801-813. Ordinary model copies do not precharge file bytes until `walk()` reaches the file after parent preparation.

**Impact.** One held entry that writes zero bytes can consume the entire apply-wide byte budget and falsely reject later selected entries. This violates D4's requirement that held partial-output accounting match ordinary copy semantics and makes mixed-material outcomes depend on a failed predecessor's source size rather than worktree output.

**Suggested fix.** Keep source acquisition before every destination effect, but defer `spendBytes(source.size)` until parent preparation succeeds and immediately before `copyHeldFile`, or explicitly reconcile the precharge to zero on every pre-copy exit. Add shared-budget witnesses for parent refusal, `claimLost`, and parent throw followed by a fitting entry.

---

### [F003] A rejected destination close hides the real error until the deadline

- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: asm-review-logic
- Class: feature
- File: `src/worktree/provisioning/applyEntries.ts:920-928`
- Status: accepted
- Triage: The fail-closed decision to retain the lifecycle slot is correct; the warning is about coupling that retention to the caller-visible `actual` promise.

**Evidence.** If `destinationHandle.close()` rejects while the async copy IIFE is unwinding another open/chmod/abort error, its `finally` awaits a never-settling promise. That prevents `actual` from rejecting with the original failure. Production's deadline signal eventually makes `raceCopyTeardown` reject, but only after the whole entry and per-repository mutation queue wait for the deadline, and it reports a timeout instead of the actual operation error.

**Impact.** A local double failure stalls every later provisioning entry and queued mutation for the remaining deadline and obscures the actionable cause. A direct caller without a signal never receives an answer.

**Suggested fix.** Separate caller settlement from lifecycle retention: reject the caller-visible operation with the original failure while registering a distinct never-settling teardown witness (or explicit retain-indefinitely state) for the slot.

---

### [F004] The already-aborted race can leave its actual rejection unobserved

- Severity: WARN
- Confidence: MEDIUM
- Priority: P3
- Agent: asm-review-logic
- Class: feature
- File: `src/worktree/provisioning/applyEntries.ts:241-249,930-935`
- Status: accepted
- Triage: A targeted direct probe with an already-aborted signal and unavailable `finishWhen` registration observed one `unhandledRejection`. The normal live-slot path registers a rejection handler through `finishWhen`; the failed case requires that registration to no-op, which is reachable after the source lifecycle has already been disposed/released.

**Evidence.** `raceCopyTeardown()` returns immediately from the `signal.aborted` branch before attaching its `actual.then(..., ...)` handler. `copyHeldFile()` relies on `source.finishWhen(actual)` to be the other observer, but the concrete held source implementation silently returns when its slot is no longer in `source` state. The already-started IIFE then rejects from its first aborted check without any handler.

**Impact.** Teardown racing an already-expired copy can surface as an unhandled extension-host rejection instead of only the entry's failed result.

**Suggested fix.** Attach the `actual` fulfillment/rejection observer before branching on `signal.aborted`; the existing settled guard prevents duplicate resolution. Also make failed lifecycle registration explicit rather than a silent void return so copy work cannot depend on it accidentally.

---

## Adjudication notes

- The data/security and chair traces found no route by which `canonicalPath`, held handles, private sidecar maps, or material-origin markers cross the public `ProvisionOffer`, `lookup/current`, or extension-to-webview message boundary. Exact pre-remint entry-object identity carries the sidecar to the fresh id, and scoped `redeem` expires with the same surface/repository/offer rules as lookup.
- Held material does not reopen its source pathname: the held admission gate substitutes the private canonical binding for the exact source candidate, and the held copy binding opens only the destination. Replacement and unlink witnesses distinguish this from model path copy.
- Transactional claims fail closed and roll back earlier claims; no selected sidecar-backed row degrades to model material. The material union remains intact through host, mutation, strict apply, and lowest copy dispatch. Current production is deliberately model-only; no missing positive-redemption finding was filed.
- Mutation cleanup does not run before queue settlement: the wrapper awaits the original `createWorktree` promise, which includes coordinator body, post-attempt rebuild, reporting continuation, and queue release, before its idempotent `finally`. The data/security candidate about `extension.ts`'s `roots === null` branch was rejected because the same request materials remain owned and are disposed by this mutation-level finally; no claim is dropped.
- The performance candidate asking `offerStore` to dispose sidecars on replacement/forget was rejected against approved D2/D6: the offer store is deliberately not the holder owner, and the per-opening record must retain the source across offer reissues. Closing it at offer eviction would break the dependent change's accepted ownership model.
- No reuse defect survived adjudication. The change reuses `openRegularFile`, resolved containment, directory authorization, deadline, contest, offer, mutation coordinator, and one extracted `copyPipeline` for both path and held copies.
- Changed tests include no `.only`; platform `it.skip` use is limited to open-file unlink behavior unsupported on Windows. Changed async cases await their witnesses. Missing close-error and pre-copy accounting witnesses are captured by F001 and F002 rather than duplicated as test-only findings.

## Full-flow trace

- **Held prerequisite path:** one pool reservation charges before `lstat/open/stat`; supported `O_NOFOLLOW` plus opened-handle identity establishes the exact leaf; claim transfers once to an auto-closing source stream; canonical binding and live root authorization run before source acquisition; source acquisition precedes every destination effect; `copyHeldFile` opens only an exclusive destination and registers the actual pipeline/teardown. F001 breaks the final source-close proof, and F002 breaks pre-copy budget reconciliation.
- **Private offer path:** `issue` reads only exact entry-object sidecar keys, remints rows and sidecars together, stores separate public/redeemed views, and scopes both by surface and repository. Public issue/current/lookup and every observed postMessage contain only the model and opaque ids. Positive redemption/claim ownership is intentionally absent from production and remains assigned to `add-a-copy-file-for-this-create-only`.
- **Current production model path:** host validates the live opening and current scoped offer, resolves selected host-held entries, wraps them as explicit model materials, and sends no webview-authored paths. Mutation validation and per-repository coordination run before Git and provisioning. Extension prepares authorized roots, strict apply dispatches model material to the unchanged no-follow pathname copy branch, and existing report/manifest projections retain original entry references and order.
- **Cleanup path:** strict apply disposes claims in its own `finally`; mutation repeats idempotently only after its awaited coordinator/reporting promise settles. Pool disposal closes idle handles and destroys acquired streams while unresolved admission/copy teardown remains charged. F003 delays caller settlement on destination-close rejection; F004 leaves one already-aborted rejection-observation gap when lifecycle registration is unavailable.
