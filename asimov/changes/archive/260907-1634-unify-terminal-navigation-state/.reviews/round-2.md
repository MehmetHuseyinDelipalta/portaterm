# Review Round 2

- Date: 2026-09-07
- Cycle: 1
- Mode: verification
- Scope: remediation range `2d86c713..HEAD` plus prior F001/F002 witnesses and behavioral impact cone
- Head: `0a55a30070058d527e0becb448bc5be1d6f12b1c` (tree dirty outside the reviewed range: `.gitignore`, `asimov/changes/unify-terminal-navigation-state/analytics.json`, `asimov/debug/260907-new-terminal-worktree-scope/notes.md`, `docs/audit/2026-09-05-performance-hunt.md`)
- Reviewable lines: 363
- Large change: no
- Recorded Verify Gate: `bun run asm change verify-status unify-terminal-navigation-state` reports tasks `1_1` through `5_2` exit 0; caller reports check-types, Biome check with nine existing warnings, 333-file/8078-test suite, bundle require gate, fs-deletion gate, I18-I22, OBL-1 through OBL-7, and exact F001/F002 witnesses passing; review ran no project verify command
- Agents spawned:
  - `asm-review-logic` — F001/F002 split lifecycle and effect-recovery cone — `gpt-5.6-sol[1M]`
  - `asm-review-contracts` — split-result and navigation-pair contract cone — `gpt-5.6-terra[1M]`
- Agents skipped:
  - `asm-review-data-security` — no data, auth, permission, secret, or path boundary in the remediation cone
  - `asm-review-frontend` — no independent rendering/a11y change outside the controller-driven attachment cone
  - `asm-review-performance` — prior performance findings remain audit backlog and the remediation adds capped collections
  - `asm-review-reuse` — F005/F007 remediation is direct and no new extraction surface warrants a separate lens
- Verdict: BLOCK
- Counts: 2 BLOCK, 0 WARN, 0 SUGGEST

## Findings

### F001
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`; `chair`; `asm-review-contracts`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/TerminalViewProvider.ts:1173`
- Title: A split response can still arrive after its host child was destroyed
- Evidence: The remediation clears the destructive delivery timer only after the in-flight `webview.postMessage` Thenable resolves true. At five seconds, the timer deletes the pending entry and destroys the child but cannot cancel the already-running post attempt. `postWithRetry` checks `shouldAbort` only before awaiting an attempt, not while it is pending. If that attempt later resolves true before the webview's fifteen-second request deadline, the message was posted; the host `.then` returns because the pending entry is gone, while the webview still has the request and attaches the response. The installed VS Code contract at `node_modules/@types/vscode/index.d.ts:9955` permits this ordering: the Thenable resolves when a message is posted or dropped, and true does not mean it was received. Invariant inventory — required invariant: host destruction must fence every response that can still be accepted by the webview. Boundaries searched: request capture, in-flight post, delivery timer, retry abort, late Thenable completion, webview request deadline, attachment, acknowledgement, source loss, and disposal. Affected: an in-flight post that completes after the host deadline but before the webview deadline. Verified safe: delivery completion before five seconds followed by delayed acknowledgement; explicit rejection with or without child id; resolved false delivery; source loss; disposal; capped pending maps.
- Impact: The webview can attach topology and an xterm instance for a session the host already destroyed, reproducing F001's visible dead-pane/unreachable-child failure through the late-delivery boundary.
- Reach: 1. The user requests a split. 2. The host-to-webview post remains pending beyond five seconds. 3. The host deadline destroys the child. 4. The same in-flight post resolves true before fifteen seconds. 5. The webview accepts and attaches the now-dead child.
- Adjudicated-by: `asm-review-contracts`
- Adjudication: Independently traced `postWithRetry` and the installed VS Code API contract. The in-flight attempt has no cancellation or stale-delivery fence, and a later true resolution means the response can still reach the webview after host rollback. The shipped path still reaches a broken split, so severity remains BLOCK despite the original delayed-ack witness now passing.
- Witness: `pnpm exec vitest run src/providers/TerminalViewProvider.test.ts -t "rejects a split response delivered after the host delivery deadline"` — catches an unresolved post timing out, then resolving true while the webview request is still live
- SuggestedFix: Do not destroy while an in-flight response can still be accepted. Rely on the webview's explicit request-deadline rejection and disposal/source cleanup, or add a cancellation/generation fence that makes every post completing after host expiry rejectable by the webview before local attachment.
- Status: accepted
- Triage: Persists from round 1. The delivered-before-deadline/late-ack boundary is fixed, but the same unilateral-timeout mechanism remains for delivery completion after the host deadline. The existing timeout test leaves the Thenable unresolved forever and therefore cannot witness the late-true completion.

- Status: accepted
- Triage: Author triage — remove unilateral wall-clock destruction while `postMessage` remains in flight; resolved false, explicit webview rejection, source loss before delivery, and surface disposal remain cleanup boundaries.

### F002
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`; `asm-review-logic`; `chair`; `asm-review-contracts`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/navigation/TerminalNavigationComposition.ts:51`
- Title: Persistent effect failure leaves an attached split without a terminal protocol result
- Evidence: `runRecoverableNavigationTransaction` catches the first post-commit effect failure, retries the retained batch once, then converts another failure to `false`. Its caller has already cleared and deleted the webview request deadline. When topology attachment set `attached = true`, the caller ignores the false result and sends neither attached nor rejected. The acknowledgement remains in `pendingSplitAttachmentAcks`, which is flushed only by a future successful host-echo effect; meanwhile `TerminalNavigationController.enqueue` refuses every later transaction until the same pending effects succeed. The new persistent-failure test asserts only that no acknowledgement is emitted, leaving convergence and cleanup unproved. Invariant inventory — required invariant: every locally attached child must eventually complete its committed effects and acknowledge, or be removed locally and rejected. Boundaries searched: transient and persistent failures at every ordered effect, replay, queued reentrant intents, new catalog mutation, webview request deadline, host pending ownership, source close, and disposal. Affected: persistent failure after local attachment. Verified safe: transient failure followed by successful replay; queue order after successful recovery; refusal to mutate the catalog before recovery; ordinary attached/rejected flows.
- Impact: The local child and host session remain indefinitely pending, one of 64 slots is consumed, and all subsequent navigation/catalog mutations are blocked behind the same failing batch. Source close or disposal may later destroy a child that had already appeared locally attached.
- Reach: 1. The user creates a split while a required effect such as checkpoint persistence fails persistently. 2. The child is attached locally and two effect attempts fail. 3. The request deadline is gone and no attachment result is sent. 4. Later navigation retries the same failure before accepting any new intent, leaving the surface's primary navigation flow blocked and the child indefinitely pending.
- Adjudicated-by: `chair`
- Adjudication: The logic specialist independently reproduced the non-converging state and proposed BLOCK; the contracts specialist confirmed the implementation contradicts OBL-7's terminal-state claim. This is the same effect-failure mechanism as round 1, with the false-success branch fixed but the persistent-failure boundary still open, so F002 and its severity remain stable.
- Witness: `pnpm exec vitest run src/webview/navigation/TerminalNavigationComposition.test.ts -t "rejects and removes an attached split when effect recovery remains failed"` — catches ignored recovery failure, cleared request deadline, and indefinite pending ownership
- SuggestedFix: Give persistent recovery a bounded lifecycle independent of future navigation. Retry on a scheduled bound; if recovery remains impossible, remove/dispose the locally attached child, clear its queued acknowledgement, and send a correlated rejection. Do not convert the second failure into an unowned boolean result.
- Status: accepted
- Triage: Persists from round 1. Transient failure replay and queued-intent preservation are fixed; persistent failure still reaches neither attachment success nor rollback/rejection.

- Status: accepted
- Triage: Author triage — add one independently scheduled recovery attempt; if it still fails, abandon only the failed effect batch, detach/dispose the provisional child locally, clear its queued acknowledgement, and send correlated rejection.

## Carried findings

### F003
- Status: audit-backlog

### F004
- Status: audit-backlog

### F005
- Status: fixed

### F006
- Status: audit-backlog

### F007
- Status: fixed
