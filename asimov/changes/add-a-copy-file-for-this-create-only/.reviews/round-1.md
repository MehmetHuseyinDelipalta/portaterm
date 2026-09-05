# Review Round 1: add-a-copy-file-for-this-create-only

**Date**: 2026-09-05
**Cycle**: 1
**Mode**: discovery
**Scope**: working tree
**Head**: `b57225ef26007bb0405f9d94c8aa2cae820867d0` (working tree dirty; reviewed the final tracked diff from this Head)
**Reviewable lines**: 104
**Agents spawned**: `asm-review-logic`
**Agents skipped**: `asm-review-data-security` (no changed data, storage, API, auth, or validation boundary), `asm-review-contracts` (no changed schema, route, or public contract), `asm-review-frontend` (the changed UI-adjacent line is a pure parser with no React/render lifecycle change), `asm-review-performance` (no changed collection, growth axis, derived-value recompute, or hot-path algorithm), `asm-review-reuse` (no helper, split, or reimplemented capability added)
**Verdict**: **BLOCK**
**Counts**: 1 BLOCK, 0 WARN, 0 SUGGEST
**Blocker split**: 1 feature / 0 machinery

## Scope and accepted obligations

Gate 2 is approved. The accepted change concerns a current-create-only copy-file picker with private host-held authority, pathless wire messages, bounded holder lifecycle, Save exclusion, and synchronous transactional Create claims. The explicit scope was the working-tree diff. Its only production behavior change is outside those obligations: it changes the pre-existing pane-title decoration parser. The telemetry update and formatter-only test reflow do not alter the accepted copy-file behavior.

## Risk map

- Pane-title normalization: the changed regular expression defines which documented ASCII spinner frames are removed before display.
- Render suppression: `worktreeRenderSignature` hashes the normalized title, so a missed frame turns animation ticks into tree repaints.
- Test validity: the existing formatter test exercises `/` only and does not witness the changed backslash member.
- Change telemetry: `analytics.json` records review/build accounting only; no executable consumer changed in this scope.

## Full-flow trace

Pane title -> `stripDecorations` -> `agentRowTitle` for visible text, search, and inspector labels; and pane title -> `stripDecorations` -> `worktreeRenderSignature` for render suppression. The changed class still strips `|`, `/`, and `-`, but no longer strips the documented `\` frame. A direct regex probe confirmed `"\\ work"` changes from `"work"` under the prior expression to `"\\ work"` under the current expression. No auth, persistence, cache, or fallback boundary participates in this flow.

## Verification evidence

`bun run asm change verify-status add-a-copy-file-for-this-create-only` records all five build tasks passing their type, lint, and unit-test gates. Those recorded suites do not refute F001: the unchanged `stripDecorations` test covers `/ compiling`, not `\ compiling`, and no changed test covers a backslash-only render-signature tick.

## Findings

### F001

- ID: F001
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: asm-review-logic, chair
- class: feature
- file: src/webview/worktree/worktreeFormat.ts:30
- title: Backslash spinner frames are no longer recognized
- evidence: The function contract names `|`, `/`, `\`, and `-` as ASCII spinner frames. Replacing `^[|/\\-]\s+` with `^[|/-]\s+` removes `\` from the class. A targeted Node probe showed `stripDecorations`' equivalent replacement now retains `"\\ work"`, while the prior expression produced `"work"`. The existing test covers `/ compiling` only. Both chair and `asm-review-logic` independently reached the same result.
- impact: Backslash-frame titles render with the decorative frame still visible. Because `worktreeRenderSignature` hashes `stripDecorations(row.title)`, a spinner advancing through `\` changes the signature and can repaint the tree on that tick, violating the established decoration and render-suppression contract. The edit is also unrelated to the accepted copy-file change.
- suggestedFix: Restore the backslash member, for example `^[|/\\-]\s+`, and add formatter plus render-signature witnesses for `\ compiling` and a backslash-only spinner-frame change.
- status: audit-backlog
- triage: AUDIT BACKLOG. The defect is valid, but the chair explicitly established that `src/webview/worktree/worktreeFormat.ts` is an unrelated pre-existing working-tree edit outside this change's accepted copy-file implementation and committed range. It must not gate or be modified by this change.

## Specialist question responses

1. The changed class does not recognize every documented frame; it omits backslash.
2. `|`, `/`, and `-` remain stripped and signature-stable. `\` remains visible and changes the render signature.
3. Existing tests do not cover backslash stripping or its render-signature behavior.
