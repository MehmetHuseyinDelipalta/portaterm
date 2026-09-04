# Proposal: add-a-setup-step-for-this-create-only

## Why
The create form shows setup steps but offers no way to add one, so a repository with no provisioning file, or one whose file lacks the command the user wants, forces the user to create first and run the command by hand. The user asked for setup to be editable; the chosen shape (Gate 1, answered by the user) is a step that applies to this create only and is never written to a provider file.

## Appetite
M (≤3d)

## Scope

### In scope
- One action in the Bring over section that asks the host for a command and adds it to the offer as a setup step, selected, attributed as "added for this create".
- Editing and removing a step added this way, before the create is submitted.
- The added step surviving a source switch and a save within the same opening, and running through the same host-held offer every other setup step runs through.

### Out of scope
- Editing or removing a step a provider file or a suggestion supplied.
- Persisting an added step anywhere: not the native file, not workspace state, not the next opening.
- Reordering steps, multi-line editors, or a shell chooser; the input is the host's single-line input box.
- Adding entries or ports the same way.

### Must not
- Carry command text in any webview → host message. Adding, editing, removing and creating name an offer or an item the host already holds.
- Start an added step unselected: typing it is the consent; a pre-ticked provider step remains forbidden.
- Let a save record an added step, or an unselected provider step, in any configuration file.
- Honour an add, edit or remove for a retired opening, a superseded offer, or a row the host did not mark as added.

## Risk Level
MEDIUM — a new inbound message on the worktree wire that, done wrong, would make the webview the authority on what runs (worktree-provisioning.md § 4.0); mitigated by keeping the text on the host side of the boundary from the first keystroke.
