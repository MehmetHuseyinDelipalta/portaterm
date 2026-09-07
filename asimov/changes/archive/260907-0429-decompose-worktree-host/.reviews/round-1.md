# Review round 1 — decompose-worktree-host

- Date: 2026-09-07
- Cycle: 1
- Mode: discovery
- Scope: commit range `112e02842a77bc0b513dd8e4006b23e5c6ffe034..1f21b202976e45ebc9abe3795d61821609475331`
- Head: 1f21b202976e45ebc9abe3795d61821609475331 (range endpoint pinned when review began; repository HEAD advanced afterward with unrelated `decompose-worktree-view` work, which was not reviewed)
- Reviewable lines: 5925 added/modified across reviewable files — large change, accuracy may decrease
- Agents spawned: 6 specialists; none skipped
- Verdict: APPROVE
- Counts: 0 blocking · 0 warnings · 0 suggestions

## Obligations and flows verified by the chair

- Intent reconstruction: the range is a factory-per-subject decomposition matching approved D1/D4. Public host exports remain re-exported, message discriminants and routing inventory are unchanged, and the only support-test edit follows `forgetDepartedRepos` to its new owner.
- OBL-4 pass: both working-tree and cached `git diff --exit-code 914dbb2b -- <seven WorktreeHost suites>` forms exit 0; all seven frozen suites are byte-identical.
- OBL-5 pass: the accepted frozen-inventory grep prints nothing from `src/providers/WorktreeHost.ts`; all target files are below 500 lines (`WorktreeHost.ts` is 432).
- OBL-1/2/3/6/7 evidence: `bun run asm change verify-status decompose-worktree-host` records every task at exit 0, and `workflow.md` records all seven obligation witnesses passing. Per review policy, project tests/typecheck/lint were not re-run.
- Late-bound dependency audit: no factory invokes a forward accessor during construction. `createCreateSurface`, `createActionRouting`, `createScanReconcile`, `createProjectionLoop`, and `createSurfaceDelivery` only retain those callbacks until a message, timer, rebuild, or projection runs after composition completes. The sole construction-time collaborator read, `projector.rankRevision()`, has no intervening await or callback compared with the base constructor.
- Projection/delivery flow: attach or tree request → rebuild gate → cache write/version bump → watch reconciliation → single-flight projection → envelope commit → gated broadcast. Dispose still flips the fence before cancelling timers/gate/watches and clearing surface/opening/roster state; post-await projection and roster completions re-check it.
- Create/provision flow: inbound surface message → unchanged message-kind guard set → action router → opening/offer/token checks → probe/defaults/refs or provision arm → capability execution through `perform` → existing mutation/provision report path. Stale openings, replaced records, sequence ceilings, and offer redemption remain checked on both sides of awaits.
- Removal flow: inbound assessment/removal → repository-scoped lane → current action-path re-check → capability → attached-surface re-check → response. Detach removes pending surface work without changing the one-outstanding-job serialization rule.
- Support test: `oneOwner.test.ts` now scans the provider tree for destination-conflict duplicates and selects the outermost callable when a module-scope owner is re-exposed by a factory delegate; the negative controls remain independent of production source.

## Findings

Findings: none

## Sub-agents spawned

- asm-review-logic: host composition, timers, projection, presence, and delivery — logic/state/async — gpt-5.6-sol[1M]
- asm-review-logic: create probe/defaults/refs/picker/debris/submit split — logic/state/async — gpt-5.6-terra[1M]
- asm-review-logic: opening registry, routing, assessments, offers, and provisioning — logic/state/async — sonnet[1M]
- asm-review-contracts: public exports and factory dependency contracts — contracts/patterns — gpt-5.6-terra[1M]
- asm-review-performance: projection, scans, maps, queues, and cleanup growth axes — performance — gpt-5.6-luna[1M]
- asm-review-reuse: extraction ownership, duplication, and split cohesion — reuse — gpt-5.6-luna[1M]
