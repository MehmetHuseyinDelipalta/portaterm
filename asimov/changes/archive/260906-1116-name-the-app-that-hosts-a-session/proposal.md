# Proposal: name-the-app-that-hosts-a-session

## Why

A user watching the Worktree panel saw four rows badged `OTHER WINDOW` — every one of them a
claude session run by **Orca**, not by any VS Code window. The chip's tooltip said, in so many
words, *"Running in another VS Code window"*. That sentence is false, and it is what sent the
user looking for a bug in this extension.

The same screenshot carried two more over-claims, all of the same kind — the panel asserting
more than it knows:

- The group header read `5 agents`. One of those five was a plain zsh pane with no agent in it.
- That pane's row read `(untitled)`, describing a terminal as a nameless agent. Until
  `refuse-a-directory-match-the-process-table-refuted` it had been wearing an Orca session's
  name, borrowed by a directory match; removing the borrowed name left the placeholder, because
  a pane's only title source is an OSC title that zsh never sets.

None of the three is a mechanism failure. All three are the panel saying something it cannot
support, and each has an honest answer available for the cost of using what is already read.

## Scope

- **Name the host.** `ps` already runs once per presence rebuild for the subtree walk; adding
  `comm=` to that same invocation lets an external row's pid be walked up its ancestry to the
  bundled application that owns it (`/Applications/Orca.app/…` → `Orca`). The chip names it.
- **Neutral wording when it cannot be named.** No bundle in the chain (Linux, a bare login
  shell), or no readable table → `other window` / "Running outside this window". Never
  "another VS Code window", which was never something this extension could know.
- **A pane with no agent is named by its shell**, not by a placeholder.
- **The group header counts by what a row is** — `4 agents · 1 terminal`.

## Non-goals and must-nots

- **Must not invent an owner.** The chip falls back to the neutral phrase rather than guessing;
  an unbundled chain is a real answer and is left as one.
- **Must not add a second `ps`.** The command column rides the existing read. A window drawing
  only external rows now opens that table where before it opened none — that is the one cost
  this change accepts, and it is TTL-paced and only while the view is shown.
- No change to which sessions are external. That is settled by
  `refuse-a-directory-match-the-process-table-refuted` and untouched here.
- No attempt to name the owner of a *window* row. A pane of this window is hosted by this
  window by construction.
- Not a claim about *which* window when the owner is another editor: `Code` names the
  application, not the workspace.

## Appetite

S. One `ps` column, one ancestry walk, one wire field, and the three strings that were wrong.
