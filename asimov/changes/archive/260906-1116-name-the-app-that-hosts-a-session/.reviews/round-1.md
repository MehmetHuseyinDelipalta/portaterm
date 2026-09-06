# Review round 1 — name-the-app-that-hosts-a-session

- Date: 2026-09-06
- Cycle: 1
- Mode: discovery
- Scope: working tree for `name-the-app-that-hosts-a-session`; excluded the pre-existing unstaged `.gitignore` and `docs/audit/2026-09-05-performance-hunt.md` as directed
- Head: `a3f5a20ac5b9c400c7b0899e5b3ee6075145564b` (working tree dirty; reviewed final tracked state from `git diff HEAD`)
- Reviewable lines: 320 across TypeScript production and JSON telemetry; changed tests reviewed inline
- Verify evidence: `bun run asm change verify-status name-the-app-that-hosts-a-session` returned exit 1 because tasks 1_1 and 1_2 have no machine verify record; the chair ran no project verify gate
- Agents spawned: `asm-review-logic` (process ancestry, snapshot and external-row flow; `gpt-5.6-sol[1M]`), `asm-review-frontend` (row filtering, host chip and view behavior; `gpt-5.6-terra[1M]`), `asm-review-contracts` (accepted presence/panel contracts; `sonnet[1M]`), `asm-review-performance` (process-table and projection growth axes; `gpt-5.6-luna[1M]`), `asm-review-reuse` (process helpers and display-funnel cohesion; `gpt-5.6-luna[1M]`)
- Agents skipped: `asm-review-data-security` — no persistence, auth, secret, public API, or untrusted execution boundary changed
- Verdict: **BLOCK**
- Counts: 1 BLOCK · 0 WARN · 0 SUGGEST
- Split: 1 feature · 0 machinery

## Accepted obligations

Gate 2 accepts tasks 1_1 and 1_2 and their delta specs. The applicable obligations are: derive an external session's host from the same pinned process-table read without guessing; keep window rows unchanged; and exclude an agent-less pane at one view-level funnel so drawing, summaries, navigation, and the panel's established agentless-worktree behavior agree.

## Full-flow trace

- Host naming: `createPresenceProjectorDeps.openSnapshot` lazily opens one `ProcessTableReading`; pane resolution and external host lookup share its parsed child/parent/command maps. The external pass first removes claimed and unattributed sessions, walks each remaining PID upward with a 24-hop cap, carries optional `host` through `WorktreeAgentRow`, keys it in the render signature, and renders it as DOM text or the neutral fallback. Failure, unsupported platform, missing PID, and unbundled ancestry all preserve the row without a host. No defect found in this flow.
- Agent-only panel: presence deliberately retains pane rows. `WorktreeView.rowsFor` filters them for row drawing, summaries, search, strongest activity, and DOM-backed keyboard navigation. The established idle-tail classifier and display-update guards still consume raw presence rows, so the new display predicate is not the single funnel it claims to be. A focused scratch probe reproduced the idle misclassification.

## Findings

### F001
- Severity: BLOCK
- Confidence: HIGH
- Priority: P2
- Agent: `chair; asm-review-frontend; asm-review-contracts; asm-review-reuse`
- Class: feature
- File: `src/webview/worktree/WorktreeView.ts:775`
- Title: Agent-less pane rows still control agentless-worktree behavior
- Evidence: The changed `rowsFor` at line 775 removes rows whose `agent` is absent, but `isIdleIn` still tests the raw `presence.rowsByWorktreeId[info.id].length` at line 1186. Because `presenceProjector` intentionally continues to emit one row per pane, a worktree containing only a plain shell has zero displayed agent rows while `isIdleIn` returns false. `shownWorktrees` and the idle-tail builder therefore keep that agentless worktree in the active partition and out of the fold. The same split predicate remains in display-support paths: `nextCeilingCrossing` iterates raw rows at lines 581–595, and `worktreeSignature` hashes raw rows at `worktreeRenderSignature.ts:64-72`, so hidden pane activity can still arm timers and invalidate the full render guard. A targeted scratch Vitest probe called `isIdleIn` with one `agentSource: "none"` pane row and expected the worktree to be agentless; current code returned false.
- Impact: The accepted agent-only panel is internally inconsistent. Worktrees with no shown agents can be presented and ordered as active, avoid the exact idle-tail folding required by the existing panel contract, and continue causing redraw/timer work from rows the panel no longer displays.
- Reach: 1. Open the Worktree panel with intact presence data. 2. Have a worktree containing only a non-agent shell pane, plus enough other agentless worktrees to form the idle tail. 3. The shell row is correctly hidden by `rowsFor`. 4. `isIdleIn` sees the retained raw pane row and classifies the worktree as non-idle. 5. The primary panel ordering/folding flow presents an agentless worktree as active and omits it from the idle disclosure.
- Adjudicated-by: `chair`
- Adjudication: Walked the shipped path from presence projection through `rowsFor`, `isIdleIn`, `shownWorktrees`, and idle-tail rendering; the focused scratch probe failed with `expected false to be true`, establishing the current accepted scenario rather than a future-maintenance risk.
- Witness: `pnpm exec vitest run src/webview/worktree/WorktreeView.test.ts -t "classifies a worktree with only an agent-less pane as idle"` — catches `isIdleIn` or another display-support consumer reading raw pane rows instead of the canonical agent-only set
- SuggestedFix: Extract one canonical display-row predicate/accessor that can operate on both `this.data` and an incoming data envelope. Use it in `rowsFor`, `isIdleIn`, ceiling-timer candidate selection, and the render-signature row input; keep raw reads only for model reconciliation such as stale expanded-row cleanup. Add explicit coverage for a worktree whose presence array contains only an agent-less pane, including idle ordering/folding and hidden-row render/timer behavior.
- Status: accepted
- Triage: New gating discovery finding. Invariant: every display-derived decision must use the same agent-only row set. Boundary inventory searched: row rendering, count/header, collapsed pill, search, strongest activity, keyboard navigation, idle classification/order/fold, full-render signature, ceiling timer, and model reconciliation. Affected: idle classification/order/fold, signature invalidation, and ceiling timer. Verified safe: row rendering, count/header, collapsed pill, search, strongest activity, and DOM-backed navigation; raw model reconciliation is intentionally separate.

## Adjudication notes

- The performance specialist's proposed serialization warning was rejected: the first host lookup awaits the one shared `ProcessTableReading`; every later lookup performs only a synchronous bounded map walk plus a promise continuation. Concurrent wrapping cannot remove the required `O(sessions × bounded ancestry)` work, and no additional I/O or concrete latency defect was established.
- Host propagation, neutral fallback, leftmost bundle extraction, one-read semantics, unsupported/failure behavior, and changed host-chip tests were confirmed across chair and specialist review.

---

## Author response — round 1

**F001 — ACCEPTED, fixed.** Verified independently before accepting: `isIdleIn`
(`WorktreeView.ts:1186`) read `presence.rowsByWorktreeId` raw, so a worktree holding only an
agent-less pane drew zero rows and still sorted into the active part, ahead of the idle tail.

Two corrections to the finding as written:

- The render signature was NOT a raw consumer. It is handed `rowsFor(info.id)` by its caller and
  was already filtered; only `isIdle`, reached from inside it, carried the fault.
- The ceiling timer WAS one, and the finding's own reasoning covers it even though its evidence
  did not name the line: `nextCeilingCrossing` (`WorktreeView.ts:581`) iterated raw rows behind a
  comment that already claimed to be "scoped to what is drawn".

Fix: one `WorktreeView.displayRows(data, worktreeId)` accessor, parameterized on the envelope
because `isIdleIn` runs against the incoming one. `rowsFor`, `isIdleIn` and `nextCeilingCrossing`
all read through it. `pruneStaleState` deliberately keeps its raw read — it reconciles retained
state against the presence MODEL, and pruning by what is drawn would discard a pane's expansion
and roster state the moment it stopped proving an agent.

Witness (chair's, added by this rework — `asm review rework` therefore refused it as a changed
claim and asked for a verification round):
`pnpm exec vitest run src/webview/worktree/WorktreeView.test.ts -t "classifies a worktree with only an agent-less pane as idle"`
Confirmed to FAIL on the pre-fix line and PASS after.

Two ceiling-timer tests were repaired, not weakened: their fixtures built rows with no `agent`,
which this change makes undrawn. Each row gained `agent: "claude"` — the timer contract they
assert is unchanged.

Verification: `npx tsc --noEmit` clean, `biome check` no new findings, `node esbuild.js` exit 0,
full suite 311 files / 7936 tests, all passing.
