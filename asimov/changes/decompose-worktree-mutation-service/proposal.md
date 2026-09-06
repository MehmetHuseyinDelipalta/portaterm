# Proposal: decompose-worktree-mutation-service

## Why

`src/worktree/worktreeMutationService.ts` is 1853 lines, of which `createWorktreeMutationService` is
1177 (64%) — one closure holding four mutable stores and eleven service members. It is the last file
of the standing goal; the other four are archived as `decompose-worktree-host-controller` and
`decompose-worktree-webview`.

The size is the symptom. The cost is that no question about this module can be asked without building
the whole service: "is a setup retry still one-shot", "does an adoption refuse a carried clearance",
"what does a removal assessment read" are each answerable only through a fully wired factory.

## Scope

Three responsibilities leave the closure, each with the state it owns:

- **setup execution and its retry capability** — the rotating one-shot authority
- **removal assessment** — what a removal would destroy, read without performing it
- **registering a checkout already on disk** — adopt and reattach, the two modes that create nothing

## Non-goals

- **Must not** change what any surface observes: same outcomes, same messages, same ordering.
- **Must not** edit `src/types/messages.ts`.
- **Must not** split the create-proper path (`createWorktree`'s two-phase body, ~413 lines). Its
  seam is real but unverified, and its body captures the closure heavily. It is recorded as a
  follow-up, not attempted here.
- **Must not** extract debris clearance. `issueDebrisAuthorization` is ~25 lines over a store that
  already lives in its own module; a wrapper around it would be a file, not a boundary.
- **Must not** chase `asm refactor shape` into silence. Its `long-function` verdict is a percentage
  heuristic that a closure-factory module fires at any size — the same finding both archived changes
  recorded rather than pursued.

## Appetite

Three extraction tasks plus a review round. Comparable to `decompose-worktree-webview`, which moved
five modules.

## Risk

The moved code is the destructive path. `pnpm run gate:fs-deletion` (I10) scopes its scan by a stated
path list, so a new module under `src/worktree/` is covered by the existing prefix rule — but the
scan must be re-run and its module count checked to grow, not merely pass.
