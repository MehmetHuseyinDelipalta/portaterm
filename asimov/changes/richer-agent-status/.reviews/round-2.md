# Review Round 2: richer-agent-status

**Date**: 2026-09-06
**Cycle**: 1
**Mode**: verification
**Scope**: range `0de80546..1c8a579a`
**Head**: `1c8a579a8b9900f89bdbdc5e9eed101dbfb3c28f` (explicit committed range; working tree dirty only outside the reviewed feature range)
**Reviewable lines**: 324
**Agents spawned**: `asm-review-logic`, `asm-review-data-security`, `asm-review-frontend`, `asm-review-contracts`
**Agents skipped**: `asm-review-performance` (registry scan growth remains per live PID record and unchanged; presentation derivations are O(1) per row with static cached icons), `asm-review-reuse` (the new lifecycle helper is the intended single shared mapper and no parallel capability was added)
**Verdict**: **BLOCK**
**Counts**: 1 BLOCK, 0 WARN, 0 SUGGEST

## Scope and prior finding

Round 1 F001 was a scope-only machinery blocker. This round applies its accepted remedy by reviewing the full committed implementation range against approved D1-D5 and task Acceptance/Boundary fields. No production code changed after the range Head, so the scope lock passes. F001 is fixed by this review scope.

## Risk map

- Untrusted registry lifecycle: exact status/timestamp parsing drives both visible external activity and destructive-removal refusal.
- Completion state machine: ordinary done, duplicate reports, stale reports, later work, identity replacement, session boundaries, shell-title reclaim, and pty exit all interact with retained timestamps.
- Presentation contract: done is presentation-only, must remain exhaustive in aggregate, summary, labels, accessibility, render signatures, and motion rules.
- Cross-consumer consistency: display and removal must use one registry mapping while retaining different fail-safe consequences for unknown evidence.

## Data scalability pass

The registry collection grows per live PID record and is structurally bounded by live Claude processes; the existing one-scan-per-snapshot mechanism is unchanged. Status mapping and presented-state derivation add O(1) work per record/row. Waiting and done use trusted static SVG constants through the existing icon cache and add no JavaScript clock or recurring work.

## Full-flow trace

1. External display: Claude PID file -> `parseRecord` exact status/timestamp guards -> snapshot -> `registrySessionActivity` -> external presence row -> `presentedActivity` -> worktree/agent glyph, aggregate, summary, and age. Recognized states and unknown fallback remain consistent.
2. Removal safety: the same registry scan -> `canonicalLiveSessions` -> `composeSessionViews` -> the same `registrySessionActivity` -> `evaluateRemoval`. Running/waiting/unknown refuse; idle remains visible as an external-session confirmation risk rather than being counted twice as a window-owned busy row.
3. Local completion: hook request -> Claude reducer's locally minted `stateStartedAt` -> pane report -> `readActivity` -> `stamp.finishedAt` -> host `WorktreePresence` -> presentation-only done -> glyph/summary/age. Ordinary, repeated, later-work, identity-change, and pty-exit paths behave as designed. The shell-title path returns before extracting completion or boundary metadata, producing F002.

## Verification evidence

`bun run asm change verify-status richer-agent-status` records all tasks passing their declared focused verification and the workflow's aggregate verify gate complete. The changed tests contain no `.only` or `.skip`. The recorded suites do not cover a fresh done or session-boundary report arriving while activity inference is specifically `shell-title`; the existing shell-title test exercises only a stale `working` report.

## Findings

### F001

- Status: fixed

### F002

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: asm-review-logic; asm-review-contracts; chair
- Class: feature
- File: src/worktree/presenceProjector.ts:860
- Title: Shell-title precedence discards completion and boundary facts
- Evidence: `readActivity()` returns `inferred` immediately when `reading.rule === "shell-title"`, before calling `freshTurn()` and before producing either `completionAt` or `sessionBoundary`. A targeted runtime probe with a fresh ordinary `done` report and shell-title inference produced `{activity:"idle", activitySource:"title", stateStartedAt:100000}` with no `finishedAt`. A second probe first established `finishedAt:90000`, then supplied a fresh `sessionBoundary: true` done report under shell-title inference; the row retained `finishedAt:90000`. The changed test for “inference already made the row idle” uses rule `quiet`, and the existing shell-title test uses only a `working` report, so neither reaches this branch combination. Both logic and contracts specialists independently identified the early return; the chair widened the same causal mechanism to the missed boundary-clear path.
- Impact: A valid completed turn can remain plain idle when the first projection after Stop observes a reclaimed shell title. Conversely, a resume, clear, or compaction boundary can retain the preceding turn's green completion check, falsely presenting a new session boundary as already completed. Both outcomes violate D2 and the explicit boundary rule.
- Reach: 1. A user completes a turn and the row records done. 2. The user resumes or clears the same session while the shell title has reclaimed the pane and output/semantic evidence still makes the rule `shell-title`. 3. The fresh boundary report is ignored by the early return. 4. The old `finishedAt` survives, so the resumed or cleared session is falsely shown as completed.
- Adjudicated-by: chair
- Adjudication: Walked hook report -> `readActivity` -> `stamp` -> `presentedActivity` and ran two direct Bun probes against the shipped projector. The boundary probe exited 1 with `{"activity":"idle","activitySource":"title","finishedAt":90000}`; the ordinary-completion probe exited 1 with no `finishedAt`. This establishes a reachable wrong-state primary flow, so the specialist WARN proposals are elevated to BLOCK under the chair's Reach rule.
- Witness: `bun --cwd /Users/huybuidac/Projects/ai-oss/anywhere-terminal -e 'import { createPresenceProjector } from "./src/worktree/presenceProjector.ts"; let now=100000; let rule="quiet"; let pane={paneId:"p",cwd:"/repo/wt",title:"claude",turn:{receivedAt:now,report:{state:"done",stateStartedAt:90000,subagents:[]}}}; const projector=createPresenceProjector({panes:()=>[pane],activityFor:()=>({activity:"idle",rule}),openSnapshot:async()=>({resolve:async()=>({kind:"absent"}),sessions:async()=>({kind:"ok",sessions:[]})}),normalize:(p)=>p,now:()=>now}); let row=(await projector.project(["/repo/wt"])).rowsByWorktreeId["/repo/wt"][0]; if(row.finishedAt!==90000) throw new Error("setup failed"); now+=1000; rule="shell-title"; pane={...pane,title:"zsh",turn:{receivedAt:now,report:{state:"done",stateStartedAt:now,sessionBoundary:true,subagents:[]}}}; row=(await projector.project(["/repo/wt"])).rowsByWorktreeId["/repo/wt"][0]; if(row.finishedAt!==undefined) process.exit(1);'` — catches shell-title inference retaining completion across a session boundary
- SuggestedFix: Keep shell-title precedence for current wire activity, but extract and carry authoritative completion/boundary metadata independently of that activity override. Add regressions proving shell-title plus ordinary `done` records the report transition time, shell-title plus `sessionBoundary` clears a prior completion, and shell-title still overrides a stale/fresh `working` activity claim without retaining its prompt or delegations.
- Status: accepted
- Triage: Accepted — preserve shell-title wire-activity precedence while extracting only authoritative completion and boundary metadata from a fresh report; add all three requested regressions and rerun the witness plus completion boundary inventory.

## Invariant inventory for F002

- Invariant: only an explicit ordinary done report creates completion, and every session boundary clears it.
- Boundaries searched: ordinary done creation, duplicate done projection, later running/waiting work, report staleness, identity replacement, session boundary, shell-title reclaim, pty exit, webview presentation, render signature, collapsed aggregation.
- Affected: shell-title plus ordinary done; shell-title plus session boundary.
- Verified safe: quiet inference plus done/boundary, later running/waiting work, identity replacement, pty exit, stale-report fallback, webview done derivation, render signature, grouping, labels, and reduced-motion behavior.

## Specialist question responses

- `asm-review-logic`: Registry status handling and ordinary completion transitions are otherwise consistent; shell-title bypasses session-boundary clearing and can retain stale completion.
- `asm-review-data-security`: Exact parsing and the shared mapper preserve fail-closed removal behavior; no security finding.
- `asm-review-frontend`: Done is exhaustive across presentation, aggregation, labels, signatures, static shapes, and reduced motion; no frontend finding.
- `asm-review-contracts`: The wire union stays unchanged and registry mapping is owned once; shell-title bypasses authoritative completion extraction and contradicts D2.
