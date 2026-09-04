# Proposal: bind a picked copy to its source leaf

## Why

A system picker returns a path before the create runs. Reopening that path later lets a replacement
file inherit the user's choice, while `dev`/`ino` metadata cannot prove identity on every supported
filesystem. The exact regular handle opened from the picker result must therefore be the source the
create eventually reads.

## Appetite

L (≤2w)

## Scope

### In scope

- Hold the no-follow regular source handle selected by the host in a globally bounded pool.
- Associate that handle with an offer row through private sidecar metadata that survives item-id
  reminting but is never posted to the webview.
- Transfer a selected handle exactly once as discriminated material through the host, mutation
  service, and apply stack.
- Copy from that held handle only after it still reports a regular file, before creating any
  destination, and request cleanup on every completion, refusal, supersede, cancellation, or disposal path while keeping all live or closing handles under one hard cap.

### Out of scope

- Adding the file picker, its per-opening record, or create-dialog controls; the dependent change owns
  those and the pool's admission policy.
- Snapshotting bytes: in-place edits visible through the held file remain visible at Create.
- Changing path-based authorization for provider and detector rows.
- Closing Node's existing transient intermediate-component containment window during initial picker
  admission.

### Must not

- Source authority may not be inferred from `ProvisionEntry.path`, `source`, another display field, or
  any webview value.
- A selected held-file row whose handle cannot be claimed or read may not degrade to model material.
- Ordinary model material may not enter the held-handle branch or change its current Windows behavior.
- Open or closing handles may not exceed the pool ceiling or be reused after ownership is disposed.

## Risk Level

HIGH — this introduces a bounded live filesystem resource that crosses an asynchronous create and must retain exact provenance and deterministic ownership.
