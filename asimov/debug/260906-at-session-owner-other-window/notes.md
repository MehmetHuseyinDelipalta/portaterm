# 260906-at-session-owner-other-window

## Symptom (verbatim)

> tao đang test anywhere terminal bằng cách chạy debug trong vscode; tao thấy
> session f0c6ab01-86a5-4b9d-98ce-7bfbd2728820 dù đang được orca xử lý, nhưng
> trong anywhere-terminal có vẻ thể hiện là do AT làm chủ, ko hiện "OTHER WINDOW"?

## Repro

`bun run asimov/debug/260906-at-session-owner-other-window/repro.ts`

```
OBSERVES 1: RED — pane-shell entryId="claude:f0c6ab01-…" agentSource="registry" scope="window"
OBSERVES 2: RED — row scope="window" rowId="window:pane-shell" chip=""
```

Production wiring end to end: a registry file on disk, `createPresenceProjectorDeps`,
`createPresenceProjector`, and the row drawn by the shipped `renderAgentRow` under
jsdom — because the report is about what the panel shows, not about a projection.

## Root cause

`resolveClaudeSession` asked the process table and then ignored what it said.

Step 1 intersects the pane's pty subtree with the running-session registry. When the
intersection is empty it falls through to step 2, which matches a **live** registry
session on cwd alone. The two cases that reach that fall-through are not the same:

- the table could not be read (Windows, a missing or timed-out `ps`) — nothing was
  learned, and the directory is the only evidence there is;
- the table WAS read and placed the session's pid somewhere else — the claim the
  directory would make has already been refuted by the same read.

`ResolveClaudeSessionDeps.descendantPids` returned `number[]`, so the two arrived
identically as `[]` and the second one silently borrowed the first one's licence.

Downstream that is not a soft guess but ownership. `presenceProjector.projectPanes`
puts every matched `entryId` in `claimed`; `externalRows` skips a claimed session
outright ("a session a pane already proved is that pane's row, never a second one
telling the user it is running somewhere else"). `settleContestedSessions` only
adjudicates when **two** panes claim one session, so a single directory-only guess
wins uncontested. The session therefore renders `scope: "window"` and the chip —
which `worktreeTreeView.ts:638` draws strictly on `scope === "external"` — never
appears.

The reporter's machine, exactly: pid 16716 (`ps`: 16716 → 16179 → login → 84446
`daemon-entry.js` → Orca.app) runs in
`/Users/huybuidac/Projects/cyberk/cyberk-skills-workspace/cyberk-skills`, where an
AT pane also sits. Four registry sessions share that cwd; step 2 tie-breaks on
newest transcript mtime, which is the busy one — f0c6ab01.

## The fix

`PaneSubtree = { kind: "known"; pids } | { kind: "unknown" }` replaces the
`number[]` dep. `known` with no pids is an answer, and step 2 stands down on it:
every candidate step 2 offers is a live session with a pid, and the same read that
found none under this pty found all of them elsewhere. Step 3 still runs after a
refusal — a transcript on disk carries no pid, so there was nothing to refute.

- `src/session/resolveClaudeSession.ts` — the type, and the `refuted` gate on step 2.
- `src/worktree/presenceDeps.ts` — `ok` → known, `unsupported` → unknown; `failed`
  already degraded the whole pane read before resolution and still does.
- `src/providers/webviewRequests.ts` — the subagent-preview path now reads through
  `createProcessTableSnapshot` for the same reason.
- `src/pty/processTree.ts` — `descendantPids` has no production caller left; its
  docstring now says why, and points at the snapshot.

Verified: repro GREEN both observations, `--reconfirm` RED without the fix, and the
full `pnpm run test:unit` green (309 files, 7913 tests).

## Sibling sweep

- `descendantPids` was the only other site collapsing "empty" into "unknown". No
  production caller remains; the docstring is now a warning rather than an invitation.
- `presenceProjector`'s `sessionUnderCwd` guess (evidence `"directory"`) is a
  different animal: it serves agents that publish no registry at all, so no process
  evidence exists to refute it, and it is consulted only for a pane already proven
  to hold that agent. Untouched, and still the gap `260827-worktree-row-session-claim`
  recorded.

## What the verified run did not settle

- **A pane whose claude is not its pty descendant now loses the claim.** tmux, screen,
  or any launcher that reparents the agent puts the pid outside the subtree, and on
  darwin/linux the table will now refute the directory match instead of rescuing it.
  That session renders as an external "other window" row. This is honest — AT cannot
  prove it — but it is a visible behaviour change for anyone running claude under a
  multiplexer inside an AT pane.
- **The spec is now out of date and was NOT edited** (`asimov/` is outside the declared
  scope, and specs belong to a change, not to a debug session):
  `asimov/specs/claude-running-session-map/spec.md` step 2 still reads as though it runs
  whenever step 1 finds nothing. It needs a condition: only where the subtree walk could
  not be performed. `docs/design/worktree-agent-presence.md` § 3.2's Windows caveat
  survives unchanged — it was already the only case the fallback is for.
- **Two panes in one directory, table unreadable**, is unchanged: both still guess, and
  `settleContestedSessions` still cancels them against each other.
- The defensive layer that should have caught this is the type: `number[]` could not
  express "we did not look", and `DescendantsOutcome` already had the right shape one
  module away. The gap was that the shape was flattened at the seam between them.
