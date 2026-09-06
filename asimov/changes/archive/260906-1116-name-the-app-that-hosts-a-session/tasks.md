# Tasks: name-the-app-that-hosts-a-session

## 1. Say only what the panel can support

- [x] 1_1 Name the application running an outside-this-window session, and stop asserting a host that was never established — verified: pnpm exec vitest run src/pty src/worktree/presence src/webview/worktree src/session && pnpm run check-types && node esbuild.js && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-agent-presence/spec.md#an-outside-this-window-row-names-the-application-running-it-where-one-can-be-named; specs/worktree-panel/spec.md#an-outside-this-window-label-names-only-the-host-presence-established
  - **Acceptance**:
    - Outcome: a session another application runs is labelled with that application
    - Verify: unit src/pty/processTree.test.ts
  - **Plan**:
    1. `src/pty/processTree.ts` — `comm=` joins the existing `ps` invocation; `parseProcessRows` returns children, parent and command from one pass (`parseProcessTable` stays, as its children half); `ownerAppOf` walks up and takes the LEFTMOST `.app` on a path, so a helper bundle resolves to the application containing it.
    2. `src/pty/processTableSnapshot.ts` — `ProcessTableReading.ownerAppOf`, answered from the same read as `descendantsOf`.
    3. `src/worktree/presenceDeps.ts` + `presenceProjector.ts` — `ResolutionSnapshot.ownerAppOf`, asked once per rendered external row; `WorktreeAgentRow.host`.
    4. `src/webview/worktree/worktreeTreeView.ts` — the chip draws the host, or `other window` with the tip "Running outside this window".
    5. `worktreeRenderSignature.ts` — `host` keyed, so learning or losing it repaints.
  - **Boundary**: no second `ps`; no invented owner when nothing in the chain is bundled; window rows unaffected

- [x] 1_2 Draw the agents, not the panes — verified: pnpm exec vitest run src/worktree/presence src/webview/worktree src/session src/pty (1945 passed) && pnpm run check-types && biome check && node esbuild.js exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#the-panel-lists-agents-not-panes
  - **Acceptance**:
    - Outcome: a pane with no proven agent is absent from the panel, its count and its navigation
    - Verify: unit src/webview/worktree/WorktreeView.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeView.ts` — `rowsFor` drops rows with no `agent`. It is the one funnel the header count, the collapsed pill, row rendering and `navRows` all read, so a filter there cannot leave them disagreeing.
    2. Presence is left alone: `presenceProjector` still projects a pane row, because activity, exit and attribution are facts about panes that the rest of the model depends on — filtering there broke 53 existing contracts and was reverted.
    3. `src/webview/worktree/worktreeTreeView.test.ts` — the terminal-glyph contract moves down to `renderAgentRow`, the level that still reaches such a row.
  - **Boundary**: no setting; external rows always carry an agent and are unaffected
