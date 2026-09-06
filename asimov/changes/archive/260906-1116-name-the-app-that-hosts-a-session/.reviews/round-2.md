# Review round 2 — name-the-app-that-hosts-a-session

- Date: 2026-09-06
- Cycle: 1
- Mode: verification
- Scope: unstaged remediation delta in `src/webview/worktree/WorktreeView.ts` and `src/webview/worktree/WorktreeView.test.ts`, plus rebutted `src/webview/worktree/worktreeRenderSignature.ts`; pre-existing `.gitignore`, change analytics, and the already-reviewed staged change were excluded
- Head: `a3f5a20ac5b9c400c7b0899e5b3ee6075145564b` (working tree dirty)
- Reviewable lines: 31 TypeScript production lines; 48 changed test lines reviewed inline
- Verify evidence: `bun run asm change verify-status name-the-app-that-hosts-a-session` still returns exit 1 because tasks 1_1 and 1_2 have no machine verify record. The author reports TypeScript, Biome, bundle, focused witness, and the 311-file/7936-test suite green; the chair ran no project verify gate
- Agents spawned: `asm-review-frontend` (display-row behavior and test integrity; `gpt-5.6-terra[1M]`), `asm-review-logic` (state, timer, signature and reconciliation invariants; `sonnet[1M]`)
- Agents skipped: all other lenses — the remediation cone is limited to one webview row predicate, idle/timer consumers, reconciliation, and their tests
- Verdict: **WARN**
- Counts: 0 BLOCK · 1 WARN · 0 SUGGEST

## Verification summary

- F001's gating reach is closed. `displayRows(data, worktreeId)` now supplies `rowsFor`, `isIdleIn` against the incoming envelope, and `nextCeilingCrossing`. A targeted three-assertion scratch probe confirmed that a hidden pane is classified agentless and arms no ceiling timer.
- The timer fixtures were repaired rather than weakened: adding `agent: "claude"` makes the rows displayable, while their causal timer inputs (`activitySource`, `stateStartedAt`, and relative deadlines) are unchanged.
- Coverage was preserved: terminal-icon behavior moved to the direct `renderAgentRow` test; unknown activity now uses a visible registry row; preview absence now uses an explicit visible agent row; the new idle witness is non-vacuous and distinguishes the pre-fix `[a,b,c]` order from the fixed `[b,a,c]` order.
- Keeping `pruneStaleState` on raw rows is correct. It reconciles model identities through `rowId` and `rosterKey(rowId, entryId)`, not what is currently drawn. This is also the exception the round-1 suggested fix allowed. The author's explanation overstates expansion retention: the existing `sessionRowIds` condition deliberately drops expansion once a row truly loses its session, but that does not make the raw reconciliation read defective.

## Findings

### F001
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: `chair; asm-review-logic`
- Class: feature
- File: `src/webview/worktree/worktreeRenderSignature.ts:64`
- Title: Hidden pane activity still invalidates the top-level render guard
- Evidence: The round-1 render-signature statement was not refuted by the remediation. There are two different signatures: `worktreeMemoKey` receives the filtered `rows` argument at `WorktreeView.ts:1434`, but the top-level guard at `WorktreeView.ts:388` calls `worktreeSignature(tree, presence, now)` with raw presence. `worktreeSignature` still maps every raw `presence.rowsByWorktreeId` row at lines 64-71. A focused scratch probe changed only an agent-less pane's hidden activity from idle to running: the fixed `isIdleIn` and ceiling-timer assertions passed, while the expectation that the global signature remain stable failed because both raw and presented activity moved in the key. That key change enters `render`, whose listing path calls `replaceChildren`, even though no displayed row changed; the per-worktree memo can reuse subtrees but cannot prevent the top-level detach/reappend pass.
- Impact: A shell pane that this feature deliberately removed from the panel can still make its output/activity updates traverse and rebuild the whole panel. The displayed result remains correct, but the no-op render guard loses effectiveness on exactly the hidden rows introduced by this change.
- Reach: none — the remaining effect is redundant render work; idle ordering/folding and timer behavior are now correct, with no wrong output or broken primary flow established
- Adjudicated-by: `chair`
- Adjudication: Distinguished the module-level `worktreeSignature` from the filtered per-worktree `worktreeMemoKey`, traced the raw key through `applyAt` to `renderListing.replaceChildren`, and ran the focused probe. Model reconciliation justifies keeping `pruneStaleState` raw; it does not require activity, title, timestamp, and other non-identity fields of hidden rows to invalidate the display key.
- Witness: `pnpm exec vitest run src/webview/worktree/WorktreeView.test.ts -t "does no DOM work when only a hidden pane changes"` — catches the top-level guard hashing hidden pane fields by spying on or observing `replaceChildren` across a hidden-row-only update
- SuggestedFix: Separate the raw model-reconciliation key from the displayed render key, or construct the render signature from `displayRows` while retaining a narrow raw identity key for `pruneStaleState`. Add the hidden-row-only update witness so fixing timer selection cannot be mistaken for fixing render invalidation.
- Status: accepted
- Triage: Persists from round 1 at the render-guard boundary only. Evidence delta: idle classification/order/fold and ceiling timers are fixed, removing F001's adjudicated user reach; severity is therefore downgraded from BLOCK to WARN. Invariant inventory: fixed — row render/count/pill/search/navigation, incoming idle classification/order/fold, per-worktree memo, ceiling timer. Still affected — top-level global render key. Intentionally raw and verified safe — `pruneStaleState` model reconciliation.

## Rebuttal dispositions

- Render signature: refuted as written. The author's statement applies to `worktreeMemoKey`, not the separately imported top-level `worktreeSignature` cited in round 1. The raw global behavior is confirmed, but its remaining impact is performance-only, hence the downgrade.
- Raw `pruneStaleState`: accepted. It is model reconciliation rather than a display decision and should remain raw.

---

## Author response — round 2

**F001 (WARN) — ACCEPTED, fixed.** Verified independently: `worktreeSignature`
(`worktreeRenderSignature.ts:64`) hashed every raw row, and the chair is right that my round-1
correction named the wrong signature — `worktreeMemoKey` is the filtered one, the top-level guard
at `WorktreeView.ts:388` is not. The cost is not only redundant work: a shell pane running a build
emits output for minutes, and every activity flip tore the whole panel down through
`replaceChildren`.

Fix: the display rule now has one home. `displayedRows(rows)` in `worktreeFormat.ts` is the single
statement of it; `WorktreeView.displayRows` and `worktreeSignature` both read through it, so the
view and its render guard cannot drift apart on the question the finding is about.

Motion ACROSS the boundary still moves the key — a pane that proves an agent enters the list — so
only motion within the hidden set is now silent, which is the motion that had nothing to draw.

Coverage the chair said was owed, added to `worktreeRenderSignature.test.ts`:
- a hidden pane changing activity and title does not move the key
- the same row becoming drawn does move it
- a group holding only a hidden pane keys identically to an empty one

Six existing signature tests were repaired, not weakened: their fixtures built rows with no
`agent`, which this change makes undrawn, so both sides of each `not.toBe` collapsed to the empty
signature. Each row gained `agent: "claude"`; every assertion is unchanged and each still
distinguishes exactly the field it names.

**B (`pruneStaleState`) — chair confirms the raw read is correct.** Noted that the rationale
overstated retention: `sessionRowIds` does drop expansion once a row truly loses its session. The
comment in `WorktreeView.displayRows` claims only what the reconciliation actually does.

One consequence worth recording: `pruneStaleState` runs INSIDE the signature guard, so an envelope
whose only change is within the hidden set no longer prunes that cycle. The transition that matters
— a row entering or leaving the drawn set — still moves the key and still prunes.

Verification: `npx tsc --noEmit` clean, `biome check src/` no new findings, `node esbuild.js`
exit 0, full suite 311 files / 7939 tests passing.
