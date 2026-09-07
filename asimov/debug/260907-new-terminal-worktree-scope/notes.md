# 260907-new-terminal-worktree-scope

## Symptom — IMMUTABLE
The reporter's words, unedited. If this needs changing, the report was
misrecorded; open a new session rather than rewriting history.

> khi click new terminal thì ko dispalay trong worktree mode; có vẻ chưa làm quản lý terminal? map terminal vào các worktree

## Current focus — OVERWRITE
The immediate `+` defect is fixed and verified. The reporter then replaced the wider ALL-versus-selected filtering model with a separate stable terminal-ownership design: main terminals versus linked-worktree terminals, including resume/restore fallback. That broader model is not claimed by this fix.

## Evidence — APPEND ONLY
- Baseline: `pnpm exec vitest run src/webview/TabBar.test.ts -t 'hands New Terminal the selected worktree' --reporter=default` failed because the scoped `+` callback received `[]` instead of `['/repo-wt/feat']`.
- `src/webview/main.ts` wired the tab-bar `+` unconditionally to `{ type: "createTab" }`; that message carries no worktree identity.
- `src/providers/TerminalViewProvider.ts` handles generic `createTab` with configured/default cwd, while the existing `worktreeOpenTerminal` path resolves and creates at a specific worktree cwd.
- `src/webview/worktree/controller/agentActions.ts` derives pane attribution only from worktree presence rows for hosted agents. Ordinary terminals have no first-class worktree membership there.
- Verified fix: the scope chip now carries its canonical worktree id, the `+` callback receives it, and `main.ts` routes scoped creation through `worktreeOpenTerminal`; closing the last scoped tab reuses the same request helper.
- `bun run asm debug verify` passed the reporter-visible repro and the green regression suites `tabBarScopeWiring.test.ts` plus `TerminalViewProvider.worktree.test.ts`.

## Eliminated — APPEND ONLY
- Terminal-to-worktree mapping is entirely absent: agent panes already receive presence-derived attribution and a dedicated worktree-aware terminal creation route exists. The missing piece for the immediate symptom was identity loss at generic tab creation.

## Root cause — OVERWRITE
`renderTabBar` invoked New Terminal without the selected worktree id, so `main.ts` always sent generic `createTab`; the host then used default cwd and later scope filtering could remove the new tab from the worktree the user was viewing.

## Scope
The verified immediate fix is limited to `src/webview`: carry the selected id through the tab control and reuse the existing host-validated `worktreeOpenTerminal` route.

## Side-effect risk
Every render caller now provides an identity-bearing scope. Unscoped creation remains generic. The broader stable owner model still needs explicit design and coverage for main filtering, splits, restore, resume, missing-worktree fallback, and worktree removal.

## Defensive layer
The tab-bar interaction test should have existed when worktree scoping was introduced: it verifies the actual `+` gesture carries the scope identity rather than only testing the dedicated empty-state action.
