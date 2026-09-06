# No spec delta

Behaviour-preserving decomposition of `src/providers/WorktreeHost.ts` and
`src/webview/worktree/WorktreeController.ts`. No externally verifiable behaviour and no
externally mandated constraint changes: the extension↔webview wire contract
(`src/types/messages.ts`) is frozen by design.md D2, and every existing suite must pass
unchanged.
