# Tasks: refuse-a-directory-match-the-process-table-refuted

## 1. The rule the fix established

- [x] 1_1 Separate a process table that answered from one that could not be read, and stand step 2 down on the former — verified: bun run asimov/debug/260906-at-session-owner-other-window/repro.ts && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/claude-running-session-map/spec.md#map-a-terminal-to-its-claude-session; specs/worktree-agent-presence/spec.md#a-session-this-window-is-measurably-not-running-is-claimed-by-no-pane-of-it; asimov/debug/260906-at-session-owner-other-window/notes.md
  - **Acceptance**:
    - Outcome: another application's session is drawn as an outside-this-window row
    - Verify: command bun run asimov/debug/260906-at-session-owner-other-window/repro.ts
  - **Plan**: landed under debug session 260906-at-session-owner-other-window.
    1. `src/session/resolveClaudeSession.ts` — `PaneSubtree = { kind: "known"; pids } | { kind: "unknown" }` replaces the `number[]` dep, and step 2 is skipped once a `known` subtree has held no running session.
    2. `src/worktree/presenceDeps.ts` — maps the snapshot's `ok` to `known` and `unsupported` to `unknown`; `failed` still degrades the whole pane read before resolution.
    3. `src/providers/webviewRequests.ts` — the subagent-preview path reads through `createProcessTableSnapshot` for the same distinction.
    4. `src/pty/processTree.ts` — `descendantPids` has no production caller left; its docstring says why and points at the snapshot.
    5. Tests: two cases in `resolveClaudeSession.test.ts` pinning the refusal and the on-disk fallback after it; one in `presenceDeps.test.ts` pinning the refusal end to end, with the old cwd-fallback case re-pointed at an unreachable table.
  - **Boundary**: the cwd fallbacks stay whole where no process table is reachable, step 3 is never gated, and the two-panes-contest rule is untouched
