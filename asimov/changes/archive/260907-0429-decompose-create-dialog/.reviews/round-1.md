# Review round 1 — decompose-create-dialog

- Date: 2026-09-06
- Cycle: 1
- Mode: discovery
- Scope: commit range `fe49091f..HEAD`
- Head: 914dbb2b (working tree carried unrelated edits — `.gitignore`, `docs/audit/2026-09-05-performance-hunt.md` — reviewed the range, not the tree)
- Reviewable lines: 4862 added (non-test, `src/webview/worktree/`) — large change, accuracy may decrease
- Agents spawned: 6 specialists + 1 reach adjudicator; none skipped
- Verdict: WARN
- Counts: 0 blocking · 1 warning · 3 suggestions

## Obligations verified by the chair

- OBL-4 pass — `git diff --exit-code fe49091f -- src/webview/worktree/WorktreeCreateDialog.test.ts` exits 0; the inherited 386-case net is byte-identical.
- OBL-5 pass — a per-identifier grep for all 24 moved bindings returns zero `let`/`const` declarations in the facade. The facade's only `let` is `repoSelect`, the element it builds itself.
- OBL-3 pass — `bringContention.test.ts` and `bringSummaries.test.ts` declare no `@vitest-environment` pragma; `provisionState.test.ts` references `document` zero times.
- D4 negation trap — every `!`-applied operand across all 21 modules was enumerated and each resolves to a local `let` or a genuine boolean. No instance of `!fn` where `!fn()` was meant. Notably `submission.ts:151` (`!nameLeft || !baseLeft`), `branchList.ts:212,228` (`!listOpen`) and `resolutionAsks.ts:316` (`!outstanding && !resolutionOutstanding`) read module-local `let` bindings, not the accessors the facade exposes.
- Late-bound deps / TDZ — no factory invokes a thunk in its constructor body. The only construction-time calls are DOM assembly plus `sections.ts:130 agentBox.setVisible(...)`, which matches base `:2165`. `syncDerived`, `submit`, `derive.destExact`, `recover.withdraw` and `destination.pickAsking` are reachable only from listeners and render passes that run after the facade returns.
- Dialog-level append order — `title, nameField, destWrap, repoField, migrationField, bringField, afterField, folderField, agentBox, advanced, actions` in both base and head.
- Event handlers — `branchList.onNameKeyDown` is byte-identical to base `:3389-3407`, including `preventDefault` before `commit`; disposal paths (`onDismiss`, `disposeAll`) are unchanged.

## Findings

### F001
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: asm-review-logic (facade/composition); corroborated by chair
- Class: feature
- File: src/webview/worktree/createDialog/formFields.ts:242
- Title: The destination-override hint now renders above its input instead of below it
- Evidence: Base built `pathField` as one block — `pathField.appendChild(pathRow)` at `/tmp/dcd/base.ts:1412`, then `pathField.appendChild(pathNote)` at `:1427`. The cut split those two adjacent appends across two modules that run 133 facade lines apart: `formFields.ts:242` appends `pathNote` when `createFormFields()` runs (facade:113), while `destinationField.ts:164` appends `pathRow` only when `createDestinationField()` runs (facade:246). `appendChild` appends at the end, so the note lands first. A runtime probe (scratch jsdom test, created and deleted in one command) returns `pathField.children` = `["LABEL.wt-flabel","P.wt-fhint","DIV.wt-path-row"]`; base was `[label, pathRow, pathNote]`. `pathField` is the only parent in the whole change appended into from two different modules in an order base did not have. The facade comment at `WorktreeCreateDialog.ts:243-245` states the invariant that broke — "Built HERE, where the pick button's append into `pathRow` stood: the field order is the order of the appends" — and both halves of it are now false: the construction moved past two dialog-level appends (`migrationField` at facade:210, `bringField` via `createProvisionView` at facade:232), and the field order is no longer the order of the appends.
- Impact: `derivePass.ts:192-193` unhides `pathNote` from the `DEST_REFUSED_BY` table (`:127-133`), which carries entries only for `reattach` and `adopt`. In those two modes the refusal sentence now paints between the "Destination override" label and the disabled input rather than beneath the input, and a screen reader in document order announces the refusal before reaching the control it describes. The inherited 386-case suite never asserts this order — its only reference to these elements is a CSS-text assertion at `WorktreeCreateDialog.test.ts:5987` — which is why the move is green.
- Reach: none — the `aria-describedby="wt-path-note"` association still resolves, no production code reads `firstChild`/indexed children/`nextElementSibling` on these elements, `worktreePanel.css` carries no sibling-combinator or `:first-child`/`:last-child` rule over `.wt-path-row`/`.wt-fhint`/`.wt-flabel`, and `focusTrap.ts:16-20` queries focusable descendants so a non-focusable `<p>` cannot alter tab order. Visual and announcement order only; not data loss, wrong target, security boundary, or a broken create.
- Adjudicated-by: asm-review-logic (adjudicator, independent of both finders)
- Adjudication: Read `derivePass.ts:127-133` to establish the note is visible only under `reattach`/`adopt`; confirmed `formFields.ts:237-242` retains `id="wt-path-note"` and the input's `aria-describedby`; ran a selector search across production TS and `worktreePanel.css` finding no order-sensitive dependency (only generic `.wt-flabel` `:859-865`, `.wt-fhint` `:926-934`, `.wt-path-row` layout `:1637-1652`); read `focusTrap.ts:16-20` to rule out tab-order impact.
- Witness: `pnpm exec vitest run <scratch>` asserting `Array.from(fields.pathField.children).map(c => c.className)` equals `["wt-flabel","wt-path-row","wt-fhint"]` after `createFormFields()` + `createDestinationField()` — catches the append-order inversion; currently returns `["wt-flabel","wt-fhint","wt-path-row"]`.
- SuggestedFix: Move the `pathNote` creation and its `pathField.appendChild(pathNote)` out of `formFields.ts` into `destinationField.ts` immediately after `pathField.appendChild(pathRow)` (line 164), keeping `pathNote` on the returned `FormFields` record for the render pass. That restores base order and reunites the note with the `round-4 B3` rationale stranded by F002. Then correct or delete the claim at `WorktreeCreateDialog.ts:243-245`.
- Status: accepted
- Triage: Real drift, and the facade comment asserting the invariant made it worse by claiming the opposite. Fixed at `destinationField.ts` with `insertBefore(pathRow, fields.pathNote)`; a runtime probe now returns `[LABEL.wt-flabel, DIV.wt-path-row, P.wt-fhint]`, matching base. The comment is rewritten to say why the insert is not an append.

### F002
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: asm-review-logic (facade/composition); corroborated by chair
- Class: feature
- File: src/webview/worktree/WorktreeCreateDialog.ts:141
- Title: Three comments left in the facade now describe code that lives in other modules
- Evidence: Each was verified against its base home. (1) `:141` — `/** Which row is active while the list is open; -1 when none is. */` documented `let activeAt`, which is now `branchList.ts:65`; it dangles above `shell.dialog.appendChild(nameField)`. (2) `:204-208` — the "A repair acts on the registration's own directory, and an override here displayed one path while the request carried another (round-4 B3)" note sat directly above `const pathNote` at `/tmp/dcd/base.ts:1417-1421`; `pathNote` moved to `formFields.ts:237` without it, so the rationale now reads as if it explains `shell.dialog.appendChild(migrationField)` on the next line, and `formFields.ts` carries no trace of it. (3) `:400-404` — the `/** Re-derive the path and its hint from the branch… */` block documented `syncDerived`, whose body is now `derivePass.ts:143`; it dangles above the unrelated `const edited`.
- Impact: A reader of the facade is told an invariant about the element on the following line that in fact belongs to a different element in a different file. Case (2) is the costly one: it is the only written record of why the destination override refuses in `reattach`/`adopt`, and it is now filed against the wrong control — the same region F001 shows was mis-assembled.
- Reach: none — comments do not execute.
- Adjudicated-by: chair
- Adjudication: Read each comment against its base line range (`/tmp/dcd/base.ts:1417-1421`, `:2989-2997`) and grepped `formFields.ts` for `round-4 B3`, confirming zero hits — the rationale did not travel with the element it describes.
- Witness: none — documentation defect, no behavioural mutation to catch.
- SuggestedFix: Delete (1) and (3); move (2) to sit above `const pathNote` in `formFields.ts:237`, or above the relocated append if F001 is fixed.
- Status: accepted
- Triage: All three removed or moved. The `round-4 B3` rationale now sits beside `pathNote` in `formFields.ts:237-241`, which is what it explains; the listbox `activeAt` docstring and the render-pass docstring are deleted, since `branchList.ts` and `derivePass.ts` carry their own.

### F003
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: asm-review-logic (facade/composition); corroborated by chair
- Class: feature
- File: src/webview/worktree/createDialog/afterCreate.ts:23
- Title: Five deps are declared and supplied but never read by the module that receives them
- Evidence: A field-by-field scan of every `*Deps` interface against its module body found five unread fields. `afterCreate.ts:23 canLaunch()` — the facade supplies it at `WorktreeCreateDialog.ts:340` (`() => currentRepo().agents.length > 0`), but the module computes the same thing inline at `:78` via `deps.agents().length > 0`, matching base `/tmp/dcd/base.ts:2136,2427`. `derivePass.ts:61 releaseDestTip()` and `:67 openAfterOptions` — supplied at facade `:383` and `:388`; base's `syncDerived` called only `ensureDestTip()` (`/tmp/dcd/base.ts:3173`), and `releaseDestTip` was only ever a disposal-path call (`:1011`, `:1036`), so nothing was dropped. `provisionState.ts:45-46 canAskStep`/`canAskCopy` — the row gating that reads them lives in `provisionView.ts:356-357`; `provisionState`'s own asks go through `deps.onSetupStepAsk?.`/`deps.onCopyFileAsk?.`, matching base's guards at `/tmp/dcd/base.ts:1535-1545,1573-1583`.
- Impact: None behavioural — each was checked against base and no reader was lost. The cost is that an unread dep is indistinguishable from a dropped behaviour at a glance, which is exactly the signal a reviewer of the next cut in this series needs to stay sharp.
- Reach: none — dead parameters cannot execute.
- Adjudicated-by: chair
- Adjudication: Ran a scripted deps-interface-versus-body scan over all 21 modules, then traced each of the five hits back to its base line range to confirm the behaviour it once fed is either computed elsewhere or never existed on that path. `dialogDeps.ts` hits were discarded as expected — it is a pure type module.
- Witness: none — removing an unread parameter cannot change behaviour, so no mutation exists to catch.
- SuggestedFix: Drop the five fields from their `*Deps` interfaces and from the facade call sites at `WorktreeCreateDialog.ts:340,383,388` and `:237-238`.
- Status: accepted in part
- Triage: `canLaunch`, `releaseDestTip` and `openAfterOptions` removed from their deps and call sites. `canAskStep`/`canAskCopy` KEPT: dropping them requires editing `provisionState.test.ts`, which is above the trivial bar a SUGGEST is auto-fixed at. They now carry a comment saying they are the channel set's shape, not a dropped reader.

### F004
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: chair
- Class: feature
- File: src/webview/worktree/createDialog/provisionState.ts:263
- Title: Two DOM writes moved from before the host notification to after it
- Evidence: The "factory returns a boolean, caller does the DOM" seam inverted two orderings. (1) Save-defaults: base `/tmp/dcd/base.ts:1495-1523` ran `pendingSave.set(...)` → `saveButton.disabled = true` → `deps.onProvisionSave?.({...})`; now `provisionState.ts:263-277` (`askSave`) runs `pendingSave.set(...)` → `deps.onProvisionSave?.({...})` → returns true, and `provisionView.ts:115-119` disables the button afterwards. (2) Provider switch: base `:2093-2100` ran `switchSeq += 1` → `pendingSwitch.set(...)` → `saveRow.remove()` → `deps.onProvisionSwitch?.({...})`; now `provisionState.ts:325-333` (`takeSwitch`) notifies the host before returning, and `provisionView.ts:349-354` removes the row afterwards. The guards themselves are faithful — `armable()` (`:215-229`) reproduces base's five-way predicate, and `askCopy`/`askStep` add back the `pickAsking()` conjunct that base's copy/step handlers carried and its save handler did not. Only the two DOM writes moved.
- Impact: The dialog no longer guarantees its own DOM invariant before telling the host. If either callback were ever made synchronously re-entrant, the host would observe a save button still enabled and a save row still attached, and a re-entrant render could act on that stale state.
- Reach: none — both callbacks are `deps.postMessage` at `WorktreeController.ts:538,581`, wired to `vscode.postMessage` at `main.ts:1095`; replies return through a separate `onDidReceiveMessage` path and `surface.post` (`WorktreeHost.ts:2256-2263`), never a synchronous dialog callback. No shipped sequence reaches data loss, a wrong target, a security boundary, or a broken create.
- Adjudicated-by: asm-review-logic (adjudicator, independent of the chair)
- Adjudication: Walked the full production path — the sole non-test `openWorktreeCreateDialog` site at `WorktreeView.ts:618`, its deps from `WorktreeController.createDialogDeps()` at `:479`, the mount at `main.ts:1093-1095`, and the inbound host path at `TerminalViewProvider.ts:219-221` / `TerminalEditorProvider.ts:402-404`, with switch handling asynchronous from `worktreeHost/actions/provision.ts:250-252` and save handling awaiting `previewProvisioning` at `:534-550`. Confirmed no synchronous re-entry is possible and that all other matches are tests.
- Witness: none — the reordering has no observable mutation under a non-reentrant host, which is why the inherited 386 cases stay green.
- SuggestedFix: Move the two DOM writes back inside the state methods, before the `deps.on*?.()` call, or have the methods return the arming decision without performing the notification so the caller keeps base's write-then-notify order.
- Status: rejected
- Triage: The reviewer adjudicated Reach `none` itself: both notifications are `vscode.postMessage`, which is non-reentrant, so no observer exists for the intermediate state. Restoring base's order needs either a second copy of `armable()` in the view or a callback through `askSave` — the first is exactly the duplicated predicate OBL-5 exists to prevent, and the second is an interface change for zero observable difference. Recorded rather than fixed.
