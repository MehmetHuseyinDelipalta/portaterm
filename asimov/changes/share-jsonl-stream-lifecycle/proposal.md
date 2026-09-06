# Proposal: share-jsonl-stream-lifecycle

## Why

Eight sites across four vault readers repeat the same JSONL stream frame — open a read stream,
wrap it in `readline` with `crlfDelay: Infinity`, iterate, trim, skip blanks, `JSON.parse` inside
a try/catch that swallows corrupt lines, and clean up in a `finally`. Each copy is ~10 lines of
lifecycle around a few lines of caller-specific work. Slop audit
`docs/audit/2026-09-05-slop-audit.md` finding U-07.

Unlike the two audit items already closed, this one edits production code, so the bar is the
readers returning identical values for identical files — including malformed, truncated and
unreadable ones.

## Appetite

S (≤1d)

## Scope

### In scope

- One new module owning the JSONL stream lifecycle, with a lines-only seam and a
  parsed-objects seam built on it.
- Migrating the eight `readline.createInterface` sites in `src/vault/readers/` onto it.
- A direct test for the new module covering the lifecycle properties the callers rely on.

### Out of scope

- `src/vault/readers/recordLine.ts`. Its byte-bounded head/tail read is a different mechanism,
  not a variant of this frame — the audit says to leave it separate.
- The readers' parsing, classification and bounding logic. Only the stream frame moves; what
  each caller does per record stays exactly where it is.
- The Cursor and OpenCode readers, which do not stream JSONL this way.

### Must not

- Change what any reader returns for any input, including a missing file, a directory, a
  zero-byte file, a file of only blank lines, a file whose every line is corrupt, and a file
  truncated mid-line.
- Collapse the failure sentinels. They differ per function, not per module: most answer `null`,
  `collectMemberTurns` answers the turns it accumulated before the failure, and `readFirstLine`
  answers `undefined`. All three must survive.
- Change which exceptions each caller swallows. `streamClaudeRecords` currently runs its
  `onRecord` hook inside the per-line catch, so a throwing hook loses one record and reading
  continues; `readFirstUserRecord` currently has no object guard, so a line that is literally
  `null` throws and ends the read. Both are load-bearing today and stay.
- Change the line ordinal stamped on Codex records. It is a physical line position that counts
  blank and corrupt lines, and it is user-visible as a transcript locator.
- Leak a file handle. Every early exit — `break`, `return`, or a throw from the caller's body —
  must still close the readline interface and destroy the stream.

## Risk Level

MEDIUM — production code on the vault read path, and the properties at stake are the
error-handling ones that tests exercise least: what happens on a corrupt line, an unreadable
file, and an early exit. A regression here degrades transcripts silently rather than loudly.
