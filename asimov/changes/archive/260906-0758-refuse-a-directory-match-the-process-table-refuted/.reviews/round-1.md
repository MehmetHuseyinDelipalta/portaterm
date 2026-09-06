# Review round 1 — refuse-a-directory-match-the-process-table-refuted

- Date: 2026-09-06
- Cycle: 1
- Mode: discovery
- Scope: commit `c46b35b8` only
- Head: `c46b35b84423a26da7f5eb1e7719cf5f701d6380`
- Tree state: dirty only in pre-existing files outside the reviewed commit (`.gitignore`, `docs/audit/2026-09-05-performance-hunt.md`); the review artifact itself was added after review
- Reviewable lines: 326 added/modified across reviewable source, debug-repro, and analytics files; changed tests were reviewed inline; Markdown change/spec/debug records were context or skipped by classification
- Agents spawned: 3
  - `asm-review-logic` — session-resolution fallbacks, error paths, and tests — `gpt-5.6-sol[1M]`
  - `asm-review-contracts` — accepted resolution and presence contracts across both production callers — `gpt-5.6-terra[1M]`
  - `asm-review-reuse` — PaneSubtree/process-table outcome reuse and the retained helper — `gpt-5.6-luna[1M]`
- Agents skipped:
  - `asm-review-data-security` — no auth, persistence, input-validation, secret, or third-party boundary changed
  - `asm-review-frontend` — no frontend implementation changed; the shipped external-row renderer was traced and exercised by the committed repro
  - `asm-review-performance` — no collection growth axis, recompute policy, or hot-path asymptotic bound changed
- Verdict: BLOCK
- Counts: 1 BLOCK, 0 WARN, 0 SUGGEST
- Split: 1 feature / 0 machinery gating blockers
- Protocol note: `asm review round-start` and `asm review round-end` cannot address archived changes; both resolve only `asimov/changes/<id>`. The durable round is therefore persisted in this archive directly, without changing build state.

## Gate and obligation evidence

- Gate 2 is approved in `workflow.md`; task 1_1 Acceptance, Boundary, and both delta specs are binding.
- The archived `workflow.md` records `pnpm run check-types`, `biome check`, and `pnpm run test:unit` (309 files, 7913 tests) exit 0. `bun run asm change verify-status refuse-a-directory-match-the-process-table-refuted` cannot read an archived change and was not used as evidence.
- The accepted map requires both that step 3 remain reachable for an exited transcript and that a readable process table plus an outside-pane live PID must not return that live session.

## Chair full-flow trace

- Worktree presence: `createPresenceProjectorDeps.openSnapshot` reads the live registry, opens one process table, maps a readable miss to `PaneSubtree.kind === "known"`, suppresses step 2, injects no step-3 disk fallback, leaves the live session unclaimed, and lets `externalRows` produce the row rendered with the other-window chip. The committed repro witnesses this path.
- Subagent preview: `handleSubagentPreviewRequest` calls `resolveClaudeSession` through `subagentResolveDeps`; after the same readable miss, step 2 is suppressed but the real `readClaudeSessions` disk fallback can return the same still-live external session as `recent`, after which `resolveSubagentDetail` searches that wrong parent session. This path is not exercised by the committed repro or new unit test.
- Unsupported process tables retain the live cwd fallback. Presence preserves its pre-existing richer handling of a failed `ps` read as degradation; preview degrades that failure to unknown and keeps its fallback.

## Findings

### F001

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: asm-review-contracts; chair; asm-review-logic
- Class: feature
- File: src/session/resolveClaudeSession.ts:147
- Title: Step 3 can reselect the live session the process table just refuted
- Evidence: A `known` subtree with no registry match sets `refuted` and suppresses only `running.byCwd` at lines 142-146. Lines 147-148 then accept any identity returned by `newestSessionUnderCwd`. The subagent-preview production dependency at `src/providers/webviewRequests.ts:301-311` scans every Claude transcript under the cwd and does not exclude IDs in the live running index, so its newest result can be the exact outside-pane live session. Both specialists independently found the same mechanism. The added unit test avoids it by returning a distinct `exited` ID, while the end-to-end repro uses presence, whose disk fallback is deliberately null.
- Impact: A pane can still resolve another application's active Claude session and show or search that session's subagent transcript, merely relabelled as `recent`; if an older eligible exited transcript exists, the newer refuted live transcript also masks it.
- Reach: 1. Leave an Anywhere Terminal pane in a cwd shared with a newer live Claude session owned by another application. 2. Click a Task/subagent preview from that pane. 3. The readable process table excludes the live session, but step 3 selects its on-disk transcript. 4. The preview searches or displays the other session's subagent detail, or returns a misleading not-found result against the wrong parent.
- Adjudicated-by: chair
- Adjudication: Walked the shipped preview path from `handleSubagentPreviewRequest` through `subagentResolveDeps`, `resolveClaudeSession`, and `resolveSubagentDetail`; confirmed the disk selector receives no exclusion set. Ran the focused witness below: actual result was `{ sessionId: "outside", cwd: "/repo", evidence: "recent" }`, proving the refuted live identity is reachable from the changed behavior.
- Witness: `bun -e 'import assert from "node:assert/strict"; import { resolveClaudeSession } from "./src/session/resolveClaudeSession.ts"; import { indexRunningSessions } from "./src/vault/readers/runningSessions.ts"; const live={sessionId:"outside",pid:4242,cwd:"/repo",startedAt:1,kind:"interactive",entrypoint:"cli"}; const got=await resolveClaudeSession("pane",{getPtyPid:()=>1000,getCwd:async()=>"/repo",runningIndex:async()=>indexRunningSessions([live]),paneSubtree:async()=>({kind:"known",pids:[]}),sessionMtime:async()=>1,newestSessionUnderCwd:async()=>({sessionId:"outside",cwd:"/repo"})}); assert.equal(got,null);'` — catches step 3 returning a live session excluded by a conclusive process-table miss
- SuggestedFix: Preserve step 3, but let it choose the newest on-disk session whose ID is not in the live running index after a conclusive miss. Pass an exclusion set into the disk selector or return ordered candidates so a newer refuted live transcript cannot mask an older eligible exited transcript. Add a production-wiring test with the refused live transcript newest and an exited transcript older.
- Status: accepted
- Rework: fixed in change `close-the-disk-door-on-a-refuted-session`. The chair's Witness was run VERBATIM and passes; `bun run asm review rework` could not record it because the command resolves only active `asimov/changes/<id>` directories and this change is archived — the same limitation the chair recorded for `round-start`/`round-end`, so the reserved `rework-verified` token is deliberately NOT written here by hand. Arm-checked both ways: removing the exclusion in the resolver fails 2 of the added resolver cases, removing the skip in the selector fails 2 of the added wiring cases.
- Triage: Reproduced independently before accepting: a focused probe through the changed resolver returned `{sessionId:"outside-live",cwd:"/work/proj",evidence:"recent"}` after a conclusive subtree miss. The finding also exposes a sentence this change wrote into `asimov/specs/claude-running-session-map/spec.md` — "a transcript on disk carries no pid, so a process-table read cannot have refuted it" — which is true of an EXITED session and false of a live one, whose transcript the running registry pairs with a pid. Accepted at both levels: the resolver and the disk selector. Note the Witness asserts `null` while SuggestedFix asks for the older eligible exited transcript; satisfying both means the exclusion is applied in `resolveClaudeSession` itself (so a dep that ignores it cannot leak) AND passed to the selector (so it can walk past the refuted transcript rather than stop at it). Not a regression introduced here — the preview path already reached that session through step 2 — but it is the same rule leaking through the next door, so it belongs to this rule, not to a backlog.
