# Review Round 1

- Date: 2026-09-07
- Cycle: 1
- Mode: discovery
- Scope: range `748de452..HEAD`
- Head: `2d86c713e32681ca7f420837391f1522aa4fb224` (tree dirty outside the reviewed range: `.gitignore`, `asimov/changes/unify-terminal-navigation-state/analytics.json`, `asimov/debug/260907-new-terminal-worktree-scope/notes.md`, `docs/audit/2026-09-05-performance-hunt.md`)
- Reviewable lines: 2677
- Large change: yes — accuracy may decrease
- Recorded Verify Gate: `bun run asm change verify-status unify-terminal-navigation-state` reports tasks `1_1` through `4_2` exit 0; review ran no project verify command
- Agents spawned:
  - `asm-review-logic` — split lifecycle and async races — `gpt-5.6-sol[1M]`
  - `asm-review-logic` — navigation state, transactions, and restore — `gpt-5.6-terra[1M]`
  - `asm-review-contracts` — routing IPC and SessionManager contracts — `sonnet[1M]`
  - `asm-review-frontend` — tab, split, empty-owner, and worktree projections — `gpt-5.6-terra[1M]`
  - `asm-review-performance` — per-surface growth and hot paths — `gpt-5.6-luna[1M]`
  - `asm-review-reuse` — extracted navigation helpers and provider duplication — `gpt-5.6-luna[1M]`
- Agents skipped: `asm-review-data-security` — no data store, auth, permission, secret, or untrusted-path surface changed
- Verdict: BLOCK
- Counts: 2 BLOCK, 2 WARN, 3 SUGGEST
- Split: 2 feature blockers, 0 machinery blockers

## Findings

### F001
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`; `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/TerminalViewProvider.ts:1173`
- Title: Attachment timeout can destroy a split the webview already attached
- Evidence: The host starts an unconditional five-second timer before sending `splitPaneCreated`; expiry calls `rollbackPendingSplitChild`, removes the pending entry, and destroys the child session. The webview independently keeps the correlated request valid for fifteen seconds and can attach the delivered child before posting `splitPaneAttachmentResult`. Extension-host and webview event loops are independent, so a response queued to a busy webview can be attached near the deadline while the host timer runs before the acknowledgement is handled. The late acknowledgement is then ignored because the pending entry is gone. Invariant inventory — required invariant: a delivered split is never destroyed while attachment status is ambiguous. Boundaries searched: request capture, host source validation, response delivery/retry, webview correlation and topology attach, acknowledgement, timeout, source close, surface disposal. Affected: timeout and disposal after delivery but before acknowledgement. Verified safe: explicit rejection, failed outbound delivery before attachment, acknowledged attachment, missing source before creation, and bounded pending collections.
- Impact: The webview retains topology and an xterm instance whose host PTY/session was destroyed, leaving a visible dead pane or an unreachable split child and violating D7/I21.
- Reach: 1. The user requests a split. 2. The response is delivered to a busy webview near the five-second host deadline. 3. The webview attaches the pane, but the host timeout runs before its acknowledgement is processed. 4. The visible child loses its host session.
- Adjudicated-by: `chair`
- Adjudication: Traced the two clocks and both message handlers. `setTimeout(..., 5000)` destroys without checking whether delivery occurred; the webview request remains acceptable for 15000 ms; and `splitPaneAttachmentResult` requires the still-present pending entry. This establishes a shipped path from one split action to a broken pane.
- Witness: `pnpm exec vitest run src/providers/TerminalViewProvider.test.ts -t "retains a delivered child while attachment acknowledgement is delayed"` — catches unilateral host timeout destruction after webview attachment but before acknowledgement
- SuggestedFix: Add a correlated cancellation/status phase or distinguish undelivered from delivered-pending. On timeout/disposal, first make the webview reject/remove the local attachment or report that it is already attached; destroy only after a correlated rejection. Never unilaterally destroy a response that may already be attached.
- Status: accepted
- Triage: Confirmed against D7 and I21. The existing timeout test covers a never-acknowledged child but not a delivered-and-attached child whose acknowledgement is delayed. Remediation stays inside the accepted split-completion contract.

- Status: accepted
- Triage: Author triage — confirmed independently. F001 exposes a conflict with design OBL-7: unilateral fixed-deadline destruction and never destroying a possibly attached child cannot both hold across independent event loops. Replan the cancellation handshake before remediation.

### F002
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`; `asm-review-logic`; `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/main.ts:772`
- Title: Split completion acknowledges success after required commit effects fail
- Evidence: `TerminalNavigationController` commits state, then runs projection, display, visual, focus, Vault, persistence, and host-echo effects sequentially. Any throw clears queued intents and skips every later effect. `onSplitPaneCreated` swallows that exception and sends `status: "attached"` solely because the topology mutation set `attached = true`. `WebviewStateStore.updateState` lets `vscode.setState` failures propagate, so persistence is a concrete failure boundary after local attachment. No retry or reconciliation completes the missing checkpoint/echo, and a later structural no-op cannot replay the skipped effects. Invariant inventory — required invariant: an attached child is acknowledged only after the committed topology and navigation result have completed their required projections, persistence, and host echo. Boundaries searched: catalog mutation, state validation/commit, each ordered effect, synchronous queued intents, acknowledgement, reload restore. Affected: every throwing effect after attachment, especially persistence and host echo. Verified safe: the ordinary no-throw effect sequence and mutation failure before attachment.
- Impact: The host permanently retains a child while the webview may lack rendered topology, a persisted split/checkpoint, or the routing echo. After a persistence failure followed by reload, the host can revive a split session that the restored webview topology cannot reach; before reload, host commands can continue targeting the previous pane.
- Reach: 1. The user creates a split. 2. A required navigation effect throws after topology attachment, for example the synchronous webview-state write. 3. The handler suppresses the failure and tells the host the child is attached. 4. A reload restores stale topology or host routing, leaving the retained child unreachable or commands aimed at the prior pane.
- Adjudicated-by: `chair`
- Adjudication: Walked `main.ts` attachment through controller commit/effects and `WebviewStateStore.updateState`. The state commit precedes the uncaught synchronous persistence boundary, the handler converts that failure to success, and the controller drops queued recovery work. This establishes a primary split/restore and command-routing failure.
- Witness: `pnpm exec vitest run src/webview/navigation/TerminalNavigationComposition.test.ts -t "recovers an attached split when a required commit effect throws"` — catches success acknowledgement with skipped persistence/host echo and discarded queued intents
- SuggestedFix: Make post-commit effect completion explicit and recoverable. Preserve the attached child, but do not acknowledge success until an idempotent reconciliation has completed projection, persistence, and host echo; if that cannot complete, remove local child facts and send a correlated rejection. Do not silently clear queued intents.
- Status: accepted
- Triage: Confirmed. One specialist proposed WARN and one BLOCK; adjudicated Reach through the existing throwing persistence boundary and reload/routing consumers sustains BLOCK. Remediation stays inside D3/D7 rather than changing the design.

### F003
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-performance`; `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/navigation/TerminalNavigationController.ts:123`
- Title: Navigation and recurring projection events repeatedly rescan full per-surface state
- Evidence: `readCatalog` rebuilds `ownerByPaneId` from every terminal for every transaction. Focus transitions then search all tab layouts, normalization sanitizes every tab, and validation traverses them again. On presence/tree changes, `currentSignature` runs `buildTabBarData`, traverses layouts again for the JSON signature, and a changed render recomputes that signature from the full graph again; `syncEmptyScope` adds another full pass through the same render path. Growth inventory — axis: user-created tabs and split panes per surface, with no structural cap. Affected boundaries: focus/tab navigation, topology reconciliation, and recurring presence/tree projection. Verified safe: pending split request maps are capped and cleaned; no persistent collection growth was found.
- Impact: Interactive focus/navigation and recurring presence pushes grow linearly with all tabs/panes and perform several redundant full traversals per event, increasing UI latency as a surface accumulates terminals.
- Reach: none — the growth axis is unbounded, but the review has no measurement establishing a pane count at which the primary flow breaks.
- Adjudicated-by: `chair`
- Adjudication: Confirmed the repeated full traversals and merged the navigation-catalog and projection-signature reports under one full-recompute invariant. Downgraded the proposed performance BLOCK because no benchmark or shipped threshold demonstrates adjudicated Reach to a broken flow.
- Witness: none — static complexity finding; a benchmark should define the supported tab/pane envelope before gating
- SuggestedFix: Maintain or cache pane-to-owner and pane-to-tab indexes across mutations, validate only affected topology, and compute one tab-bar projection/signature per presence/tree event to pass through rendering rather than reconstructing it multiple times.
- Status: accepted
- Triage: Confirmed as an unbounded hot-path cost; non-gating until measured Reach is established.

- Status: audit-backlog
- Triage: Author triage — valid static full-recompute cost, but it cannot falsify a functional obligation without a supported-scale benchmark. Owner: terminal navigation performance. Reactivate when a benchmark establishes the supported pane envelope or p95 navigation exceeds one frame.

### F004
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-performance`; `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/main.ts:527`
- Title: Every pane-focus commit hides every non-active tab container
- Evidence: `displayNavigationState` iterates all `store.tabLayouts` and calls `hideTabContainer` plus root-container style updates for every non-active tab on every committed transition. Pane focus inside the already-active tab still runs this full DOM loop even though tab visibility did not change.
- Impact: Synchronous DOM work grows with tabs per surface on the most frequent navigation path and is paid for split-pane focus changes that require no tab visibility update.
- Reach: none — the code establishes linear DOM work, but no measurement shows a supported workload where it breaks the primary flow.
- Adjudicated-by: `chair`
- Adjudication: Confirmed the loop is in the ordered effect batch for every non-noop focus commit. Kept WARN because the finding lacks a measured user-visible failure threshold.
- Witness: none — static hot-path finding; add a focused render-count or latency benchmark before making it gating
- SuggestedFix: Track the previously displayed tab and update visibility only when `activeTabId` changes; pane-only focus commits should skip tab-container hiding entirely.
- Status: accepted
- Triage: Confirmed; non-gating performance remediation.

- Status: audit-backlog
- Triage: Author triage — valid linear DOM work, but no measured Reach or functional divergence. Owner: terminal navigation performance. Reactivate with a render-count/latency benchmark or a reported focus-lag reproduction.

### F005
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P3
- Agent: `asm-review-reuse`; `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/navigation/TerminalNavigationState.ts:93`
- Title: Navigation duplicates the canonical pane-to-tab lookup
- Evidence: `tabContainingPane` independently loops over every split layout and calls `getAllSessionIds(...).includes`, while `src/webview/SplitModel.ts:62` already exports `tabOwningPane` with the same ownership semantics and `SplitTreeRenderer` continues using it.
- Impact: Focus navigation and split close maintain parallel definitions of pane-to-tab ownership that can drift if topology lookup semantics change.
- Reach: none — both implementations are equivalent in the reviewed revision.
- Adjudicated-by: `chair`
- Adjudication: Verified byte-equivalent traversal semantics and no current behavioral divergence, so reduced the specialist WARN to a reuse suggestion.
- Witness: none — no current defect
- SuggestedFix: Reuse `tabOwningPane(catalog.tabLayouts, paneId)` and retain the separate live-owner guard where required.
- Status: accepted
- Triage: Confirmed reuse cleanup; non-gating.

### F006
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P3
- Agent: `asm-review-reuse`; `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/TerminalEditorProvider.ts:110`
- Title: Active navigation fallback policy is copied across provider types
- Evidence: `TerminalEditorProvider` and `TerminalViewProvider` contain the same null handling, pane-existence check, and SessionManager fallback in both `getActiveTabId` and `getActiveSessionId`, differing only in how the view id is obtained.
- Impact: A future stale-echo or fallback fix can land in one surface type and leave editor versus sidebar/panel command routing inconsistent.
- Reach: none — both provider implementations agree in the reviewed revision.
- Adjudicated-by: `chair`
- Adjudication: Confirmed duplicated policy but no present command-routing divergence; reduced to SUGGEST.
- Witness: none — no current defect
- SuggestedFix: Extract one active-navigation resolver that accepts the view id and cached nullable pair; keep provider methods as thin adapters.
- Status: accepted
- Triage: Confirmed reuse cleanup; non-gating.

- Status: audit-backlog
- Triage: Author triage — duplication is real but current editor and view-provider behavior agrees and cannot falsify this change’s accepted obligations. Owner: provider routing. Reactivate when either fallback policy changes.

### F007
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P3
- Agent: `asm-review-contracts`; `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/types/messages.ts:191`
- Title: The navigation message type admits invalid half-null pairs
- Evidence: `TerminalNavigationCommittedMessage` types `activeTabId` and `activePaneId` as independently nullable, so TypeScript accepts one-null/one-string messages. Both providers compensate with duplicated runtime pair guards, and the current producer emits coherent pairs.
- Impact: The atomic nullable-pair invariant is not encoded at the contract boundary, making a future producer or consumer easier to implement incorrectly.
- Reach: none — every current consumer validates the pair and the sole current producer emits both fields together.
- Adjudicated-by: `chair`
- Adjudication: Confirmed the type-level hole but also confirmed current runtime guards and producer behavior, so reduced the specialist WARN to a contract suggestion.
- Witness: none — no current defect
- SuggestedFix: Define the message as a discriminated union of `{ activeTabId: string; activePaneId: string }` and `{ activeTabId: null; activePaneId: null }`, or centralize an exported type predicate used by every consumer.
- Status: accepted
- Triage: Confirmed contract hardening; non-gating.
