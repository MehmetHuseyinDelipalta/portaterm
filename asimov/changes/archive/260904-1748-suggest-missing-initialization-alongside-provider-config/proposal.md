# Proposal: suggest missing initialization alongside provider config

## Why

The detector already knows how to find a fixed set of environment files without reading their
contents, and how to map root lockfiles to static install commands. It runs only when no supported
provisioning source exists. The moment a repository adds `.vscode/worktree.json`,
`asimov/worktree.yaml`, or an Orca source, every otherwise useful unchecked suggestion disappears —
including `pnpm install` when the provider says nothing about setup.

A provider answer and an opt-in suggestion are not competing sources. The provider remains
configured truth; the detector can fill only rows it does not already express, unchecked.

## Scope

- Append missing environment-file and package-manager setup suggestions to a readable provider
  answer.
- Suppress any environment suggestion whose destination is already declared, deliberately
  excluded, or could fold onto an existing spelling.
- Suppress any setup suggestion whose exact command is already present.
- Keep every suggestion unchecked and host-issued; saving positive file consent keeps the current
  native-config behavior, while setup consent remains current-create-only.

## Non-goals

- Reading environment-file contents, scanning arbitrary filenames, or following symlinks.
- Guessing one package manager when several lockfiles exist.
- Replacing, reordering, checking, or otherwise overruling configured rows.
- Suggesting over a source that could not be read at all.

## Must not

- No secret file content may be read to decide whether to suggest it.
- No suggested command may start selected or run without current-offer consent.
- No suggestion may duplicate or contend with a configured or excluded file row.
- Provider switching must still show the chosen provider's answer, merely supplemented with its
  own missing unchecked rows.

## Appetite

Medium. Reuse the existing detector; change when it is composed, not what it probes.

## Risk

The old fallback contract deliberately suppressed suggestions whenever any source was present.
This change reverses that one condition while preserving provider precedence and consent. The high
risk is duplicate destination authority, so admission is fail-closed: a possible fold suppresses
the suggestion.
