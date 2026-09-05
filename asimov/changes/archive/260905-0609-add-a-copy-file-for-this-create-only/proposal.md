# Proposal: add a copy file for this create only

## Why

The create dialog can select only files a provider or detector already offered. A user who notices one
missing file must leave the flow and make a permanent configuration change even when the need applies
to this create only.

## Appetite

L (≤2w)

## Scope

### In scope

- Add `Add file to copy…` wherever a provisioning offer is shown.
- Let the extension-owned system picker safely hold one ordinary in-repository file without reading
  its contents, then show it selected as a current-create Copy row.
- Preserve the bounded holder record and checkbox state across source switches and save rereads in the
  same opening; dispose it on every retirement or failed answer.
- Spend the exact held source only through the current host offer's private opaque-id sidecar.
- Keep added files out of Save defaults and let explicit current source configuration or exclusion win
  over a duplicate ad-hoc row.

### Out of scope

- Directories, globs, editing an added path, Windows fallback where safe no-follow hold is unavailable,
  or persistence across openings.
- Reading or snapshotting file bytes before Create.
- Overriding a configured/excluded path or a possible destination contender.
- Moving the existing visible secret warning; a later webview change may move it to an icon hint but
  may not remove its accessible description.

### Must not

- No path, handle, source marker, or command supplied by the webview may become authority.
- No source path may be reopened after the picker has safely held its exact regular object.
- Cancellation, stale answers, duplicate/contending rows, cap refusal, failed claim, Save, Create, close,
  supersede, detach, or extension teardown must request holder cleanup and release the form; live or closing handles remain under the prerequisite cap.
- Existing setup-step ordering, row capacity, provider precedence, and destructive confirmations may
  not weaken.

## Risk Level

HIGH — this combines secret-file selection, a live filesystem handle, private offer provenance, and asynchronous form lifecycle across extension and webview boundaries.
