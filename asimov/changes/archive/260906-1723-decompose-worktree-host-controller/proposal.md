# Proposal: decompose-worktree-host-controller

## Why

`WorktreeHost.ts` is 5225 lines — the largest file in the repository — and 4418 of them are
one function, `createWorktreeHost`. Inside it, `handleAction` is a 1377-line switch over 29
message types that reads and writes ~11 module-level maps, every one of which is also read
outside the switch. `WorktreeController.ts` is 1932 lines across 96 members, of which the
constructor is a single 358-line `new WorktreeView({...})` literal.

Both files are under active change (128 and 91 commits) and both are the landing site for
worktree bug fixes. The cost is paid on every one of them: there is no unit smaller than
"the whole host" to read, and no seam smaller than "the whole controller" to test.

`asm refactor shape` names `long-function` on the host (largest body 85%, bar 25%) and
`god-class` on the controller (class 83%, bar 60%).

## Scope

- Extract the 19 pure `isKnown*` message validators out of the host closure.
- Extract the 8 `bindXxx(apply)` dialog sinks out of the controller.
- Gather the host's cross-cutting mutable state into one passable `HostState`.
- Split `handleAction` into four action modules grouped by the behaviour they own.

## Non-goals / must-not

- **Must not** change `src/types/messages.ts`. Needing to is the signal that the change has
  left its scope: historically these two files only move together when the wire protocol
  moves (26 of their 36 joint commits also touch it), and this change moves no protocol.
- **Must not** change any assertion in any existing test. The suites are the preservation
  proof; adjusting one to fit a cut invalidates the proof.
- **Must not** unify the per-call-site token choice in the controller's outbound requests
  (see design.md D1 § What P1b does not touch).
- Out of scope: `WorktreeCreateDialog.ts` (3872) — dense mutable capture, and 4 of the last
  5 commits are still fixing it; refactoring across that churn destroys the bisect trail.
- Out of scope: `worktreeMutationService.ts` (1852) — it sits in an already-decomposed
  directory (67 files, mean 293 LOC) and is large because its domain is.

## Appetite

Four tasks, ordered. Task 3 (`HostState`) is the critical path and the only one carrying
real risk; tasks 1 and 2 are independent and can run in the same wave.

## Risk

MEDIUM, concentrated in task 3. The host has no direct test of `handleAction` — all 26 test
entry points construct `createWorktreeHost` — so the net is a black-box suite at the factory
boundary. That is the right harness for an internal rearrangement (it cannot couple to the
structure being changed) but it means a wrong seam surfaces as a behavioural failure, not a
compile error. Mitigation in design.md § Risk Map.
