# Proposal: richer-agent-status

## Why

The Worktree view currently collapses process liveness, quiet sessions, and completed turns into too few visual outcomes: external sessions can spin without active work, while a confirmed completion looks like the same muted idle circle as a session merely at rest. Claude's registry and existing hook reports already carry enough evidence to separate these states.

## Appetite

M (≤3d)

## Scope

### In scope

- Preserve Claude registry lifecycle states `busy`, `waiting`, and `idle`, and use one mapping for external presence and removal safety.
- Present a confirmed ordinary turn completion as `done`, distinct from a merely idle live session.
- Apply the shared hybrid Orca presentation to every agent row, while showing only states that agent's evidence can prove.
- Update focused tests and durable Worktree design documentation.

### Out of scope

- Orca's manual Todo / In progress / In review / Done worktree workflow metadata.
- New `monitoring`, `blocked`, `interrupted`, or retained-until-dismissed row lifecycles.
- Status indicators in the Vault Sessions body.
- New external-session discovery or lifecycle transports for Codex, OpenCode, or Cursor.
- Changes to the host/webview row protocol or the wire activity union.

### Must not

- Treat registry `idle`, inferred quiet, shell-title fallback, or a session boundary as a completed turn.
- Continuously rotate any state except confirmed running.
- Replace `unknown` or `running (unconfirmed)` with a simpler but stronger claim.
- Use registry scan time as lifecycle evidence or `statusUpdatedAt` as a heartbeat.
- Add a JavaScript animation clock or hard-coded non-theme colours.

## Risk Level

MEDIUM — completion and waiting states influence both visible attention signals and destructive-removal gating, so every consumer must share one registry mapping.
