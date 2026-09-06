# Proposal: share-provider-request-mechanics

## Why

`TerminalEditorProvider` and `TerminalViewProvider` each carry the same nine preview/vault
request members. Three are byte-identical, two differ only in where the webview comes from, and
the four request handlers differ in threading and comments but — with one exception — not in
logic. Slop audit `docs/audit/2026-09-05-slop-audit.md` finding U-11.

The audit rates this MEDIUM on the claim that "the editor/view retry asymmetry is real and must
be parameterised". Measured against `8484a26f`, that claim is **half wrong in a way that matters
to the design**, so the plan is built on the measurements, not the rating:

- `safeSendWithRetry` and `safePostMessage` are identical in both providers — same loop bound,
  same `maxRetries = 2`, same pre-attempt `shouldAbort` bail, same 50 ms delay skipped on the
  last attempt. There is no retry *policy* to parameterise; the seam is a webview **source**.
- But there **is** one real posting asymmetry, and the audit's location for it is wrong. It sits
  at the call sites in `handleRequestSubagentPreview`: the editor posts every one of its four
  replies through `safePostMessage` (one attempt, no retry), the view posts all four through
  `safeSendWithRetry` (up to three attempts). An extraction that unifies these silently changes
  when a subagent preview reaches the webview.

Two other per-provider differences survive and are not drift: the `(editor)` suffix on two log
messages, and `_vaultRefreshSeq`, which the view provider also drives from four rename/refresh
methods outside this scope while the editor provider drives it from one.

## Appetite

S (≤1d)

## Scope

### In scope

- One shared module owning the request mechanics, with the webview passed in per call.
- Migrating all nine members in both providers onto it.
- Direct tests for the shared module covering supersession, disposal, the per-attempt abort bail
  and the subagent posting asymmetry.

### Out of scope

- `_vaultRefreshSeq`'s ownership. It stays on each provider: the view provider has four more
  callers of it than the editor provider does, and moving it would widen the change past U-11.
- The view provider's rename-push and idle-refresh paths, which use that field but are not
  duplicated members.
- Unifying the subagent-preview posting difference. Preserving it is the point; changing it is a
  behaviour change with its own spec delta.

### Must not

- Change what either provider posts, when it posts it, or what it answers on a disposed webview.
- Collapse the subagent-preview posting asymmetry. Editor = one attempt, view = up to three.
- Retry the vault-sessions **cache** post. It is deliberately best-effort in both providers so a
  retried stale list cannot land after the fresh one.
- Change the supersession rules: a `_previewTokens` entry is removed only when it is still the
  one this call installed, and each call always disposes its own token source.
- Change any log message text, including the `(editor)` suffix the editor provider uses.

## Risk Level

MEDIUM — production code on two user-facing webview paths, and the properties at stake are
ordering and lifecycle ones that fire under races: supersession, cancellation, disposal and
retry timing. A regression here shows up as a stale or missing preview, not as a crash.
