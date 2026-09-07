# Review Round 3

- Date: 2026-09-07
- Cycle: 1
- Mode: verification
- Arbiter: yes
- Scope: final remediation range `0a55a300..HEAD` plus prior F001/F002 witnesses and behavioral impact cone
- Head: `f52fa769c0224927d08f4cdf283c101239bef375` (tree dirty outside the reviewed range: `.gitignore`, `asimov/changes/unify-terminal-navigation-state/analytics.json`, `asimov/debug/260907-new-terminal-worktree-scope/notes.md`, `docs/audit/2026-09-05-performance-hunt.md`)
- Reviewable lines: 159
- Large change: no
- Recorded Verify Gate: `bun run asm change verify-status unify-terminal-navigation-state` reports tasks `1_1` through `5_3` exit 0; caller reports check-types, Biome check with nine existing warnings, 333-file/8079-test suite, bundle require gate, fs-deletion gate, and 329 tests across ten invariant/obligation witness files passing; review ran no project verify command
- Agents spawned:
  - `asm-review-logic` — final F001/F002 lifecycle and convergence cone — `gpt-5.6-sol[1M]`
  - `asm-review-contracts` — final split protocol and D3/D7 contract cone — `gpt-5.6-terra[1M]`
- Agents skipped:
  - `asm-review-data-security` — no data, auth, permission, secret, or path boundary in the remediation cone
  - `asm-review-frontend` — no independent UI/a11y behavior outside the lifecycle cone
  - `asm-review-performance` — pending collections remain capped; prior performance findings stay audit backlog
  - `asm-review-reuse` — no new reuse surface in the final fix
- Verdict: BLOCK
- Status: blocked
- Counts: 1 BLOCK, 0 WARN, 0 SUGGEST

## Findings

### F001
- Status: fixed

### F002
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`; `chair`; `asm-review-contracts`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/navigation/TerminalNavigationComposition.ts:73`
- Title: Failed rollback effects leave navigation blocked again
- Evidence: The new bounded recovery correctly abandons the failed attachment-effect batch, fact-only removes the provisional child, clears its queued attachment acknowledgment, and starts a rollback navigation transaction. But `rollbackFailedNavigationTransaction` discards the boolean returned by `runRecoverableNavigationTransaction`. If the same persistent effect failure occurs while committing the rollback state, the controller retains that rollback state in `pendingEffects`; `main.ts` still posts correlated rejection because the child close returned `closed`. The next navigation calls `enqueue`, sees `pendingEffects`, and retries the same failing rollback effects before it can enqueue the user's transaction. `abandonFailedEffects` also clears the pending transition queue rather than only the failed effect batch. Invariant inventory — required invariant: persistent attachment failure must converge both the split protocol and the navigation controller, leaving no failed batch ahead of later intents. Boundaries searched: attachment mutation, immediate replay, animation-frame replay, failed-batch abandonment, fact-only child close, rollback transition, rollback effects, queued reentrant intents, rejection, and the next navigation action. Affected: rollback-effect failure and queued intents held during abandonment. Verified safe: F001 late true/false delivery; transient attachment-effect replay; successful rollback effects; local child disposal; acknowledgment removal; correlated rejection; host cleanup; capped pending collections.
- Impact: The provisional child is removed and the host is told to destroy it, but the surface remains unable to process later tab/pane navigation because every new intent first rethrows the failed rollback effect batch. Independently queued effect-raised intents are silently discarded.
- Reach: 1. The user requests a split while a required navigation effect persistently fails. 2. Immediate and animation-frame recovery fail. 3. The provisional child is detached and rejected. 4. The rollback state's effects fail for the same reason and remain pending. 5. The user's next tab or pane action fails before its transition is enqueued, leaving the primary navigation flow blocked.
- Adjudicated-by: `chair`
- Adjudication: The logic specialist traced the retained rollback `pendingEffects` through the next `enqueue` and established a direct broken-primary-flow Reach. The contracts specialist independently confirmed that persistent abandonment also clears queued intents, contrary to D3's queue contract. F002's child reachability half is now fixed, but its invariant inventory still fails at the rollback-effects boundary through the same persistent-effect mechanism. Severity remains BLOCK under cross-round stability.
- Witness: `pnpm exec vitest run src/webview/navigation/TerminalNavigationComposition.test.ts -t "leaves navigation usable when rollback effects also fail"` — catches a failed rollback batch remaining ahead of the next navigation and loss of queued reentrant intents
- SuggestedFix: Observe the rollback transaction result and make rollback itself terminal. If its catalog mutation committed but its recovery effects still fail, explicitly finalize or abandon that rollback-effect batch before rejection while preserving independently queued transitions in order. Add a witness that performs a new navigation after rollback and proves it is enqueued and committed rather than retrying the abandoned failure.
- Status: accepted
- Triage: Arbiter sustained. Round 3 closes F001 and the provisional-child protocol portion of F002, but the failed-effect invariant moved to the rollback commit. The boundary inventory has expanded in consecutive verification rounds, so patch-level remediation has not closed the controller recovery state machine. The change parks with F002 accepted; return the recovery lifecycle to planning before another user-granted round.

- Status: risk-accepted
- Triage: User explicitly accepted on 2026-09-07. Rationale: persistent synchronous navigation-effect failure is low-likelihood, normal and recovery flows are fully verified, split/host ownership already converges, and reload is an available workaround. Owner: terminal navigation controller. Expiry: 2026-10-07. Reactivate immediately on any navigation-freeze report, persistent `setState`/render/host-echo failure, or change to the navigation effect pipeline.

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

## Arbiter dispositions

- F001 — fixed: the host no longer destroys a child while `Webview.postMessage` is in flight; resolved-false delivery, explicit rejection, source cleanup, and disposal converge, and the late-true witness now closes.
- F002 — accepted: persistent failure now removes and rejects the provisional child, but failed rollback effects remain pending ahead of later navigation and abandonment clears queued intents. The blocker is real, reachable, and load-bearing; the change is parked.
