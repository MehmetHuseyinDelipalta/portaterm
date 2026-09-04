# Proposal: reserve the host's rows in the model budget

## Why

A provisioning model is bounded at `MAX_MODEL_ROWS` (200) because it crosses `postMessage` and
becomes DOM. The reader enforces that bound on itself. The host then composes MORE rows onto the
model it publishes — the save's own refusal and lock reports, and (since
`add-a-setup-step-for-this-create-only`) the added-step marker rows and their withholding
statement — and nothing bounds the total.

The witness predates both changes. At `edc455a7` the save branch published
`withSaveReports(base, posts)` straight through `offers.issue`: a capped read holds
`MAX_MODEL_ROWS` rows, a refused save that also left a lock adds two problems, and the offer ships
202 rows. Its full selection is then refused by `isKnownSave`, which admits at most
`MAX_MODEL_ROWS` kept ids, so a valid save stalls with no answer.

No ordering of host-composed rows can fix this from the host: the reader may legitimately hand
over 199 entry rows plus its cap problem, and two save reports alone pass the bound. The room has
to be reserved where the rows are charged.

## Scope

- `providerKit` reserves the host's slots in the row budget, so a read can never spend the rows
  the host will need.
- One count owns the reservation, read by the reader's cap and by the host's composition.
- The dependent change `add-a-setup-step-for-this-create-only` keeps its `withAdded` bound; it
  becomes provable rather than aspirational.

## Non-goals

- Changing what the cap MEANS to the user: a shortened list still states that it was shortened.
- Raising `MAX_MODEL_ROWS`, or bounding anything the reader does not already bound.
- Touching migration offers, port previews, or any other host message.

## Must not

- No published provisioning model may exceed `MAX_MODEL_ROWS` rows, by any path.
- The save outcome must never be dropped to make room: a refusal or a lock the writer reported is
  what the user acts on.
- The reader's own cap statement must never be dropped either — a silently shorter list is the
  failure the budget exists to prevent.

## Appetite

Small. One reserved count, its two readers, and the witnesses.

## Risk

Low blast radius, high blast precision: every provider suite pins row counts against
`MAX_MODEL_ROWS`, so the reservation moves several expected numbers. Those are the tests that
prove the reservation exists.
