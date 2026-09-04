# Review round 1 — reserve-the-host-s-rows-in-the-model-budget

- Date: 2026-09-04
- Cycle: 1
- Mode: discovery
- Lane: fastlane
- Arbiter: no
- Head reviewed: `8e9ef2081ff5a35bafcd383c56b171093501e443` (the checkout was dirty only in `asimov/changes/reserve-the-host-s-rows-in-the-model-budget/analytics.json` from the active review session; the requested committed range excluded that working-tree delta)
- Diff scope: `git diff b2ce8b95~1..HEAD` (`aac5e9dc9cdea2e1048de9fdab42cb486fd7a938..8e9ef2081ff5a35bafcd383c56b171093501e443`)
- Reviewable lines: 95 added/modified across 3 reviewable production/data files, with 8 removed lines; 124 added test lines and 8 removed test lines reviewed inline; 213 added Markdown change artifacts were accepted context or skipped support sources
- Large change: no
- Verdict: **APPROVE**
- Counts: 0 BLOCK · 0 WARN · 0 SUGGEST
- Split over gating blockers: 0 feature / 0 machinery

## Agents

| Agent | Region | Lens | Model |
|---|---|---|---|
| asm-review-logic | provider read allowance through every host publication and fallback | boundary arithmetic, report replacement, async/error paths | `gpt-5.6-sol[1M]` |
| asm-review-contracts | model budget, offer/save admission, accepted D1–D3 | cross-layer contract and test obligations | `gpt-5.6-terra[1M]` |
| asm-review-performance | repository-controlled model rows and derived structures | structural growth bounds and amplification | `sonnet[1M]` |
| chair | full committed range | all applicable lenses and full-flow trace | `gpt-5.6-sol[1M]` |

Support discovery used `asm-finder` on `gpt-5.6-luna[1M]` to inventory every provisioning-model publication, host row-composition site, offer-store boundary, fallback, and relevant witness. Data/security was skipped because the diff changes no authority, persistence, filesystem access, or input shape; frontend was skipped because the only UI hunk removes a class with no selector or reader; reuse was skipped because the change adds no parallel implementation, helper family, parser, mapper, or split.

## Gate evidence

`bun run asm change verify-status reserve-the-host-s-rows-in-the-model-budget` exits 0 for tasks `1_1` and `2_1`. `workflow.md` records the clean-tree gate at `6f7903e0`: 7759/7759 tests, clean types, I10, fs-deletion, and bundle gates green; Biome check mode carried only two pre-existing errors in untouched files. The chair ran no project tests, lint, type check, bundle, or verify command. A zero-file arithmetic probe independently enumerated the read/report/record bounds and found no state above 200 rows.

## Risk map

- **Shared invariant owner:** `providerKit.full()` owns the repository-controlled read allowance while `WorktreeHost` owns later row composition. The load-bearing seam is the arithmetic between those owners.
- **Cross-boundary output:** the complete `ProvisionModel` is stored as a host offer, sent through `postMessage`, and rendered in the webview; its row growth axis is repository declarations per provisioning read and must be structurally capped.
- **Fallback and replacement:** a save reread may fail and reuse an already host-composed model. Prior save reports and prior added-step decoration must be removed before current reports and the record are recomposed.
- **Admission contract:** a legitimate full model may expose 200 selectable rows, so the inbound `kept` count remains bounded at `MAX_MODEL_ROWS`, not the reader's smaller allowance.
- **Low-risk cleanup:** `wt-bring-box--only-add` had no selector, reader, or test and its removal changes no rendered behavior.

The growth inventory is structurally bounded: entries, setup, ports, excluded rows, and problems share one reader budget; contender memberships partition the bounded entry set; providers are a fixed adapter set; port preview and offer reminting preserve cardinality; host-added marker rows fit only in actual remaining room.

## Findings

None.

## Adjudication

The chair, logic specialist, and contracts specialist independently reached the same bound. `full()` accepts at most 196 ordinary read rows, then records exactly one cap problem on the first refused append, so a capped read carries at most 197 rows. A save contributes at most two reports. `withAdded()` first removes prior marker/withholding rows, then uses the final remaining room for marker rows or one truthful withholding statement. Initial, provider-switch, setup-ask, unknown-save refresh, successful save reread, and thrown-reread fallback publications all call `withAdded()` before the only four `offers.issue()` sites. Port preview and reminting preserve cardinality, and migration is a different message.

`postedBySave` marks only save-created problem object identities. On fallback it removes the prior attempt's reports while retaining genuine reader problems, then appends the current attempt's refusal and lock together; existing fallback tests cover replacement and clean-save clearing, and the changed cap witnesses cover the final row bound. `isKnownSave` correctly remains at 200 because selectable marker rows can legitimately fill a complete 200-row model and every returned id is still resolved against the current host-held offer.

No specialist finding survived adjudication. There is no accepted risk or audit backlog.

## Inline support review

- Changed production behavior has corresponding provider-budget and host-seam witnesses.
- Changed tests contain no `.only` or `.skip`; asynchronous host cases await settlement before assertions.
- The cap witness reaches 200 rows while preserving the reader statement, refusal, lock report, and added-step withholding statement.
- The fallback witness remains bounded and verifies one lock report; existing tests separately prove stale-report replacement and clearing on repeated failed rereads.
- No changed fixture, seed, or mock introduces credentials or destructive behavior.
- The analytics file is process metadata and does not affect product behavior.

## Full-flow trace

1. **Entry/read:** repository-controlled provider files and suggestions allocate one shared `ProviderBudget`. Every entry, port, setup step, excluded source row, and problem append reaches `full()` through the budgeted appenders. At 196 accepted rows, the next append is refused and exactly one cap problem is charged, for 197 rows maximum.
2. **Contract/identity:** opening, surface, repository, monotonic switch, and current offer are host-validated. Offer issue remints selectable ids without changing cardinality; the webview returns ids only, with `kept.length <= 200`.
3. **Host composition:** port preview replaces port values one-for-one. `withAdded()` strips earlier marker rows and its withholding problem, then fits the current record into the room left by the base. Save outcomes add zero, one, or two current-attempt reports before that final composition.
4. **Hot and cold paths:** initial defaults, provider switch, setup ask, unknown-offer refresh, normal save reread, and reread fallback all route through `withAdded()` and then `offers.issue()`; no provisioning publication bypasses that seam.
5. **Fallback/error:** a failed provider switch or initial read publishes nothing new. A save reread failure falls back to the shown model, removes prior save reports by identity, applies the latest attempt's whole report, strips old added decoration, and recomposes once.
6. **Output:** the issued model sent by `worktreeProvisionOffer` has `rowsOf(model) <= 200` in every supported mode. Refusal, lock, cap, and withholding statements are retained rather than dropped to make room.
