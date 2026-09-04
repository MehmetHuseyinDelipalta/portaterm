# Proposal: add a copy file for this create only

## Why

The create dialog can select copy rows a provider or detector already offered, and it can add a
setup step for this create. It cannot add one missing file. A user who notices an unlisted `.env`
must leave the create flow, edit a provider file, reopen the form, then remember whether that edit
was meant to be permanent.

The file picker can follow the setup-step precedent: the webview asks for an operation, VS Code owns
the picker, the host converts the chosen path to a repository-relative entry in its current offer,
and Create spends only that offer's opaque id.

## Scope

- Add `Add file to copy…` beside the setup-step action whenever a provisioning offer is shown.
- Use VS Code's system file picker rooted at the main checkout; admit only a file syntactically
  inside that checkout.
- Add the chosen file as a selected Copy row for this opening only.
- Keep added files across provider switches and save rereads in the same opening, including their
  checkbox state; drop them when the opening retires.
- Never write an added file into provisioning configuration through Save defaults.

## Non-goals

- Reading the selected file's contents before Create, guessing whether it is secret, or adding a
  directory/glob picker.
- Editing/removing the row through another picker; unticking it is the removal from this create.
- Changing the existing apply-time source/destination containment and no-follow checks.
- Making the choice persistent.

## Must not

- No path supplied by the webview may become copy authority.
- A file outside the repository, an empty relative path, a duplicate, or a possible destination
  contender must not enter the offer.
- No picker cancellation/refusal may leave the form held.
- The existing setup-step record, row cap, switch ordering and save semantics must not weaken.

## Appetite

Large but narrow: one new operation follows existing picker and host-held-record patterns.

## Risk

This touches the same `withAdded` compositor whose bound took three review cycles to settle. The
copy record therefore composes at that single owner, shares the generic source marker and row budget,
and is reviewed as a security/privacy and API-contract change.
