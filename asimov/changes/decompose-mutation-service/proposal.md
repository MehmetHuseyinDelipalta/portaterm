# Proposal: decompose-mutation-service

## Why

`src/worktree/worktreeMutationService.ts` is 1134 lines, of which
`createWorktreeMutationService` is 647 (57% of the module's statements, against
`asm refactor shape`'s 25% bar) and its `createWorktree` method alone is ~430. That one
method is the whole create: two validation phases either side of a coordinator wait, the
worktree creation, the exclusion writes, the ports, the setup steps, and the agent
launch. It is also 28% types — `MutationServiceDeps` is 189 lines on its own.

This is the last of the four changes in the user's standing goal, and the smallest:
three cuts.

## Scope

- `src/worktree/worktreeMutationService.ts` (1134) → under 500.
- Every file extracted from it is also under 500.

## Non-goals and must-nots

- **No behaviour change.** The two-phase validation, the coordinator's ordering and the
  `finally` that disposes provision materials all keep their exact shape.
- **The regression net is not touched** — `worktreeMutationService.test.ts`,
  `mutationService/{removal,registerExisting,setupExecution}.test.ts` and
  `extension.worktreeMutations.test.ts` stay byte-identical (design.md OBL-3).
- **`src/worktree/mutationService/` siblings already under 500 are left alone** —
  `registerExisting.ts` (413), `removal.ts` (349), `setupExecution.ts` (276),
  `outcomes.ts` (25). Not in the goal.
- **No new abstraction.** The seam is the series' settled one: a factory per module.

## Appetite

Three tasks. The types first because nothing depends on them moving, then the two halves
of the create.

## Risk

| Risk | Why it is bearable here |
|---|---|
| `createWorktree` spans a coordinator await; splitting it could reorder work | The cut is along the closure's own stages, and the coordinator call itself is not moved — only the body it is handed |
| A destructive path (`node:fs` removal) runs under this service | `pnpm run gate:fs-deletion` is a repo tripwire and runs in the Verify Gate; the I10 carve-out list must not grow |
