# Proposal: decompose-worktree-host

## Why

`createWorktreeHost` is one 2234-line function inside a 2724-line file, and it is the
extension side of every worktree the user can see: the projection that publishes the
tree, the timers that decide when to rescan, the openings that correlate a webview's
question with an answer, the provisioning offers, and the routing of every action.
`asm refactor shape` measures the largest body at 82% of the module's statements
against a 25% bar. Its two action factories have the same shape — `create.ts` at 91%,
`provision.ts` at 70%.

Nothing in it can be asked a question without building a host. That is what the 519-case
regression net compensates for, and it is why a change to one concern is read against
2234 lines of unrelated closure.

This is change B of the four in the user's standing goal. Change A took
`WorktreeCreateDialog.ts` from 3872 lines to 474 on the same seam.

## Scope

- `src/providers/WorktreeHost.ts` (2724) → under 500.
- `src/providers/worktreeHost/actions/create.ts` (1423) → under 500.
- `src/providers/worktreeHost/actions/provision.ts` (637) → under 500.
- Every file extracted from those three is also under 500.

## Non-goals and must-nots

- **No behaviour change.** Not a fix, not a rename of anything on the wire, not a
  different timer bound. A defect found on the way is recorded, never repaired here.
- **The regression net is not touched.** The seven `WorktreeHost.*.test.ts` suites stay
  byte-identical (design.md OBL-4). A cut that needs a test edited is the wrong cut.
- **No new abstraction.** The seam is the one three archived changes and change A used:
  a factory per module. Nothing here introduces a pattern, a base class, or a registry.
- **`worktreeHost/` siblings already under 500 are left alone** — `messageGuards.ts`
  (350), `hostTypes.ts` (315), `actions/shell.ts` (240), `actions/removal.ts` (152),
  `openingLifecycle.ts` (139). They are not in the goal and moving them would widen the
  diff the review has to read.

## Appetite

18 tasks, one module each, in coupling order. Each is a move plus its verification, and
each ends green — a task that cannot end green is a wrong boundary, not a long task.

## Risk

| Risk | Why it is bearable here |
|---|---|
| The host has no unit-level seams; everything is closure state | The 519-case net runs in 591 ms, so every task is verified in seconds, not minutes |
| Timers and async projection make ordering load-bearing | D4 names the only transformations allowed; anything else stops the task |
| 22 read-sites for `presence`, 10 for `broadcast` | Those stay in the facade as accessors; the modules that need them are handed a thunk, never a copy |
