## 1. Prose in the UI font, values in the editor font

- [x] 1_1 Set every passive sentence in the create dialog in the proportional UI font — verified: VITEST_MAX_THREADS=6 pnpm exec vitest run 'src/webview/worktree/WorktreeCreateDialog.test.ts' && pnpm exec tsc --noEmit -p tsconfig.json && VITEST_MAX_THREADS=6 pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: docs/design/worktree-create.md#4-form-presentation
  - **Acceptance**:
    - Outcome: Every hint and note in the create dialog renders in the UI font
    - Verify: unit src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. `src/webview/worktree/worktreePanel.css` — remove the `font-family: var(--vscode-editor-font-family, monospace)` declaration from `.wt-fhint` (line ~1013) and from `.wt-dest-note` (line ~1190); raise both to `font-size: 11px` so they sit at the same size as `.wt-flabel`. Leave `.wt-dest`, `.wt-input--mono`, `.wt-brow-code`, `.wt-bring-problem-file`, `.wt-kbd`, `.wt-dialog-path`, `.wt-reason`, `.wt-confidence`, `.wt-branch--bare` alone — each carries a path, a command, a key, or a sha, which is what the editor font is for (docs/ui/create-worktree-design-brief.md "Monospace is for editable or copyable values only").
    2. `src/webview/worktree/WorktreeCreateDialog.test.ts` — beside the existing source-read at line ~5390, add one `[1_1]` test that extracts the `.wt-fhint` and `.wt-dest-note` rules from `worktreePanel.css` and asserts neither contains `vscode-editor-font-family`, and that `.wt-dest` still does.
  - **Boundary**: No text changes. No rule outside the two named is edited.

## 2. One bring-over row is one line

- [x] 2_1 Lay each bring-over row on one line: checkbox, verb, subject, then its source at the end — verified: VITEST_MAX_THREADS=6 pnpm exec vitest run 'src/webview/worktree/WorktreeCreateDialog.test.ts' && pnpm exec tsc --noEmit -p tsconfig.json && VITEST_MAX_THREADS=6 pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: docs/design/worktree-create.md#43-bring-over
  - **Acceptance**:
    - Outcome: Each bring-over row is one line with its subject beside its verb
    - Verify: unit src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. `src/webview/worktree/worktreePanel.css` — change `.wt-brow` to `grid-template-columns: 13px auto minmax(0, 1fr) auto` with `gap: 8px` and put `.wt-brow-top`, `.wt-brow-meta`, and `.wt-brow-src` each in its own column: remove `grid-column: 2` from `.wt-brow-meta`, drop `margin-left: auto` from `.wt-brow-src`, and let `.wt-brow-meta` own the flexible column so `.wt-brow-code` truncates there. `.wt-brow--excluded` becomes `auto minmax(0, 1fr) auto` and `.wt-brow--excluded .wt-brow-meta` loses its `grid-column: 1`. Rewrite the section comment at line ~1197 that says "two lines each": it is one line now, and say why (the verb never varies enough to earn a line of its own).
    2. `src/webview/worktree/WorktreeCreateDialog.ts` `bringRow` — move `src` out of `top` and append it as a direct child of `el` after `meta`, so the DOM order is `cb, top, meta, src` (and `top, meta, src` for an excluded row). Keep `aria-labelledby="${topId} ${metaId}"` on the checkbox exactly as it is: `[W3]` names each box by verb AND subject and that is unchanged by where the source badge sits. Update the comment at line ~988 that names "the mockup's two-line shape".
    3. `src/webview/worktree/WorktreeCreateDialog.test.ts` — add a `[2_1]` test asserting that in a rendered row `.wt-brow-src` is a direct child of `.wt-brow` and follows `.wt-brow-meta` in document order, and that the existing `[W3]` names still contain both verb and subject. Update any test asserting `.wt-brow-src` sits inside `.wt-brow-top` (grep first — the `wt-brow-src` reads at lines ~1860, ~1921, ~2212 and `src/extension.worktreeAssembly.test.ts:2413-2466` query by row and should be unaffected).
  - **Boundary**: The `wt-brow-warn` badge, `wt-brow-excluded` marker, `wt-brow-note` family and the checkbox's `aria-labelledby` contract are not changed; `docs/ui/*` mockups are not edited.

## 3. What can be hovered and opened looks like it

- [ ] 3_1 Mark the destination line as one whose exact value is a hover or focus away
  - **Deps**: 2_1
  - **Refs**: docs/design/worktree-create.md#4-form-presentation
  - **Acceptance**:
    - Outcome: Hovering the shortened destination shows a pointer cue before the tooltip appears
    - Verify: unit src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. `src/webview/worktree/worktreePanel.css` `.wt-dest` — add `cursor: help` (the cue `.wt-confidence` already uses for the same "the full value is a hover away" promise) and a `text-decoration: underline dotted` with `text-underline-offset: 2px` and `text-decoration-color` at `color-mix(in srgb, var(--vscode-descriptionForeground) 60%, transparent)`, applied only while the line is not `.wt-dest--pending` (a shape is not a value to reveal).
    2. `src/webview/worktree/WorktreeCreateDialog.test.ts` — add a `[3_1]` source-read test asserting the `.wt-dest` rule carries `cursor: help`.
  - **Boundary**: `attachTooltip`, `tabIndex`, the visually-hidden exact span and the `aria-label` stay exactly as they are — the mechanism already works; only the cue is missing.

- [ ] 3_2 Give the advanced disclosure a real chevron and a control's hover
  - **Deps**: 3_1
  - **Refs**: docs/design/worktree-create.md#4-form-presentation
  - **Acceptance**:
    - Outcome: "Branch source, base ref, and location" reads as an expandable control, with the same chevron the tree's disclosures use
    - Verify: unit src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeCreateDialog.ts` — build the toggle from a `span.wt-chev` whose `innerHTML` is `ICON_CHEVRON_DOWN` from `../vault/icons` (the exact idiom `worktreeTreeView.ts:229-230` uses) followed by a text span; the label text is unchanged. Rotate via `aria-expanded` the way `.wt-idle[aria-expanded="false"] .wt-chev` already does.
    2. `src/webview/worktree/worktreePanel.css` — delete the `::before` content rules for `.wt-advanced-toggle` (lines ~1363-1370); add `.wt-advanced-toggle[aria-expanded="false"] .wt-chev { transform: rotate(-90deg) }`, give the toggle `display: inline-flex; align-items: center; gap: 5px; padding: 3px 6px` and a `:hover { background: var(--vscode-list-hoverBackground); color: var(--vscode-foreground) }` — the same hover every clickable row in the panel carries.
    3. `src/webview/worktree/WorktreeCreateDialog.test.ts` — add a `[3_2]` test asserting `.wt-advanced-toggle` contains a `.wt-chev` with an `svg`, its text still reads "Branch source, base ref, and location", and the existing click-to-expand tests at ~708, ~872, ~887 keep passing.
  - **Boundary**: `aria-expanded`/`aria-controls`/`refreshFocusTrap` wiring and the collapsed-by-default rule are untouched.

- [ ] 3_3 Right-align the destination override and give the picker its folder icon
  - **Deps**: 3_2
  - **Refs**: asimov/specs/worktree-panel/spec.md#a-destination-can-be-chosen-with-the-system-folder-picker
  - **Acceptance**:
    - Outcome: The override input shows its trailing segment and the picker is a folder icon button whose name is still "Choose…"
    - Verify: unit src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. `src/webview/worktree/worktreePanel.css` — `.wt-path-row .wt-input { text-align: right; direction: rtl; unicode-bidi: plaintext }` so an overlong path keeps its last segment visible while typing stays natural — note in the comment why `direction: rtl` is there and that `unicode-bidi: plaintext` keeps the characters in reading order; restyle `.wt-path-pick` as a 22px square icon button (`display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0`) with `svg { width: 14px; height: 14px }`.
    2. `src/webview/worktree/WorktreeCreateDialog.ts` — set `pickDestination.innerHTML = ICON_FOLDER` (from `../vault/icons`, the same constant `worktreeTreeView.ts` imports) instead of `textContent = "Choose…"`, and add `aria-label = "Choose…"` beside the existing `title`, so every test and screen reader that names it by "Choose" still does.
    3. `src/webview/worktree/WorktreeCreateDialog.test.ts` — add a `[3_3]` test asserting `.wt-path-pick` has `aria-label` "Choose…" and contains an `svg`, and that the `.wt-path-row .wt-input` rule carries `text-align: right`.
  - **Boundary**: `pickAsked`, the disabled gate, the `ask` token and the picker's message contract are untouched.
