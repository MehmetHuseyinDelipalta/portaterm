// src/webview/worktree/createDialog/formFields.ts — Building the create form's
// elements: the branch box, the destination line, the mode toggle, the base and
// override inputs, and the uncommitted-work row.
//
// Extracted from `openWorktreeCreateDialog` by change `decompose-create-dialog`
// (design.md D1, task 1_9). Construction only, and it takes no dependencies at
// all — no draft, no host callbacks, no shell. Every `addEventListener`, every
// `explain` tooltip, every collaborator factory and every append into the dialog
// stays in the facade, because each of those decides something a collaborator
// owns (task Boundary).
//
// What that buys is a witness rather than a convention: a module with no deps
// parameter cannot read form state, so nothing here can quietly start deriving
// what `draftModel` or `resolutionAsks` is the source of.
//
// The appends that ARE here are the ones internal to a field — `nameField`
// gathering its input, list, hint and error; `destWrap` gathering the lines it
// stacks. Those are the field's own shape. The appends into `shell.dialog` are
// not, because their ORDER is the form's layout and the repository picker is
// conditionally one of them.
//
// No suite beside this file (design.md D2): it returns elements and asserts
// nothing, and the 386-case dialog suite reads every id, class and ARIA
// attribute below through the rendered form.

import { field } from "../worktreeDialogShell";

/**
 * Every element the form is built from, at its own type — `nameInput` is an
 * `HTMLInputElement` here, not an `HTMLElement`, because the facade reads
 * `.value` off it. Derived from the factory rather than declared beside it, so
 * the two cannot drift.
 */
/**
 * A git term of art, explained where it is used.
 *
 * `title` is the hover; the same words go on `aria-description` because a screen
 * reader announces `title` only for a control it can focus, and two of the three
 * places this is used sit on a plain `<label>`.
 */
export function explain(el: HTMLElement | null, text: string): void {
  if (!el) {
    return;
  }
  el.setAttribute("title", text);
  el.setAttribute("aria-description", text);
}

/** The label inside a field wrapper, which is what `explain` is usually given. */
export function labelOf(wrap: HTMLElement): HTMLElement | null {
  return wrap.querySelector(".wt-flabel");
}

export type FormFields = ReturnType<typeof createFormFields>;

export function createFormFields() {
  // ── Branch name — the lead input, with nothing above it ──────────────────
  // It is the one thing only the user can supply; everything else on this form
  // is derived, defaulted, or advanced (worktree-actions § 3.2.1).
  const nameField = field("Branch name", "wt-branch");
  const nameInput = document.createElement("input");
  nameInput.className = "wt-input";
  nameInput.id = "wt-branch";
  nameInput.type = "text";
  nameInput.placeholder = "feat/…";
  const nameError = document.createElement("span");
  nameError.className = "wt-ferror";
  nameError.hidden = true;

  // ── The branch list — one box, refs and create-new together ─────────────
  // Plain listbox markup rather than the vendored virtualized widget: the list
  // is capped host-side, and the widget brings its own focus and keyboard model
  // into a dialog that already owns a focus trap and an Escape contract (D6).
  nameInput.setAttribute("role", "combobox");
  nameInput.setAttribute("aria-autocomplete", "list");
  nameInput.setAttribute("aria-expanded", "false");
  nameInput.setAttribute("aria-controls", "wt-branch-list");
  // Described by the notice, so the "this list is partial" claim reaches a
  // reader who never sees it rendered (round-1 S1).
  nameInput.setAttribute("aria-describedby", "wt-branch-partial");
  nameInput.autocomplete = "off";

  const listBox = document.createElement("ul");
  listBox.className = "wt-branch-list";
  listBox.id = "wt-branch-list";
  listBox.setAttribute("role", "listbox");
  listBox.setAttribute("aria-label", "Branches");
  listBox.hidden = true;

  const partialNote = document.createElement("span");
  partialNote.className = "wt-fhint";
  partialNote.id = "wt-branch-partial";
  partialNote.hidden = true;

  // The popup is positioned against this field, so the field is the containing
  // block. Scoped to a class rather than `.wt-field` — every other field on the
  // form would inherit a positioning context it has no use for.
  nameField.classList.add("wt-field--combo");
  nameField.append(nameInput, listBox, partialNote, nameError);

  // ── Destination — one derived line, not a field ─────────────────────────
  // Stated once, shortened. `aria-label` and the tooltip carry the exact value,
  // so shortening costs nothing: the safety property is that the user sees where
  // the write lands before authorizing it, not that they read it in full.
  const destWrap = document.createElement("div");
  destWrap.className = "wt-dest-wrap";
  const dest = document.createElement("div");
  dest.className = "wt-dest";
  // `attachTooltip` exposes its target on focus, but does not make it focusable.
  // Without this the exact value is a mouse-only affordance.
  dest.tabIndex = 0;
  /** The shortened text, which is for reading and not for announcing. */
  const destShort = document.createElement("span");
  destShort.setAttribute("aria-hidden", "true");
  /**
   * The exact value, for assistive tech only. NOT `aria-label` on `dest`: its
   * implicit role is `generic`, which prohibits naming, so the attribute is
   * simply not exposed — the attribute stays for tests and for anything reading
   * the DOM, but this element is what actually announces the path.
   */
  const destExactText = document.createElement("span");
  destExactText.className = "wt-visually-hidden";
  dest.append(destShort, destExactText);
  const destNote = document.createElement("div");
  destNote.className = "wt-dest-note";
  destNote.hidden = true;
  /**
   * What the create would DO, stated where the destination is.
   *
   * The spec requires the form to say which of create / check out / repair the
   * create performs, and the base-ref rule to be legible. Both lived inside the
   * collapsed Advanced body, so neither was discoverable without expanding
   * unrelated content (round-1 B3, W6).
   */
  const actionNote = document.createElement("div");
  actionNote.className = "wt-dest-note";
  actionNote.id = "wt-action-note";
  actionNote.hidden = true;
  /**
   * The recover offer: a destination the suffixing skipped because a directory
   * with no `.git` sits there (worktree-create.md § 2.2).
   *
   * A checkbox rather than a bare statement, because accepting it is what asks
   * the host for the authorization — the offer is the question, and Create is
   * the authorization. It sits with the destination because it CHANGES the
   * destination: recovered, the create takes the skipped path, not the suffix.
   */
  /**
   * The fork remote, stated before the create is authorized (§ 5, D5).
   *
   * With the destination rather than in the list, because it describes what the
   * create would DO to the repository — configuring a remote is a
   * repository-level side effect, and § 5 requires it to be legible while the
   * create can still be abandoned rather than reported after it.
   */
  const forkNote = document.createElement("div");
  forkNote.className = "wt-dest-note";
  forkNote.id = "wt-fork-note";
  forkNote.hidden = true;
  /**
   * What an adoption cannot restore, stated before it is authorized (D8).
   *
   * A fixed list rather than a probe result: the directory that held the
   * evidence is exactly what was deleted, so none of the five can be checked
   * after the fact — and a check that cannot fail is worse than a stated
   * limitation (worktree-create.md § 2.4).
   */
  const adoptLosses = document.createElement("p");
  adoptLosses.className = "wt-fhint";
  adoptLosses.id = "wt-adopt-losses";
  adoptLosses.hidden = true;
  const recoverField = document.createElement("div");
  recoverField.className = "wt-recover";
  recoverField.id = "wt-recover";
  recoverField.hidden = true;
  const recoverLabel = document.createElement("label");
  recoverLabel.className = "wt-recover-label";
  recoverLabel.htmlFor = "wt-recover-accept";
  const recoverBox = document.createElement("input");
  recoverBox.type = "checkbox";
  recoverBox.id = "wt-recover-accept";
  const recoverText = document.createElement("span");
  recoverLabel.append(recoverBox, recoverText);
  /** What is there, or why it will not be cleared. Never a claim about a path this create left behind. */
  const recoverNote = document.createElement("p");
  recoverNote.className = "wt-fhint";
  recoverNote.id = "wt-recover-note";
  recoverNote.hidden = true;
  recoverField.append(recoverLabel, recoverNote);
  destWrap.append(dest, destNote, actionNote, forkNote, adoptLosses, recoverField);

  // ── Repository (only with more than one) ────────────────────────────────
  // Below the destination it derives, never above the lead input.
  const repoHint = document.createElement("span");
  repoHint.className = "wt-fhint";

  const modeField = field("Branch source");
  const detachToggle = document.createElement("button");
  detachToggle.type = "button";
  detachToggle.className = "vault-segmented";
  detachToggle.id = "wt-detached";
  detachToggle.dataset.mode = "detached";
  detachToggle.setAttribute("aria-pressed", "false");
  detachToggle.textContent = "Detach at a ref instead";

  const baseField = field("Base ref", "wt-base", true);
  const baseInput = document.createElement("input");
  baseInput.className = "wt-input wt-input--mono";
  baseInput.id = "wt-base";
  baseInput.type = "text";
  baseInput.placeholder = "HEAD";
  baseField.appendChild(baseInput);

  // Disabled, never hidden (D5): a field that vanishes when the mode changes
  // reads as a bug, and a base ref silently ignored is what § 2.1 forbids.
  const baseNote = document.createElement("p");
  baseNote.className = "wt-fhint";
  baseNote.id = "wt-base-note";
  baseNote.hidden = true;
  baseInput.setAttribute("aria-describedby", "wt-base-note");
  baseField.appendChild(baseNote);

  // The override, which is a different thing from a statement of where the
  // worktree will go — hence its home here rather than on the form's face.
  const pathField = field("Destination override", "wt-path", true);
  const pathInput = document.createElement("input");
  pathInput.className = "wt-input wt-input--mono";
  pathInput.id = "wt-path";
  pathInput.type = "text";
  // The input and the action sit on one line: the action states a destination
  // into that field, so putting it anywhere else would read as a second way to
  // say a different thing.
  const pathRow = document.createElement("div");
  pathRow.className = "wt-path-row";
  pathRow.appendChild(pathInput);

  // The refusal sentence under the destination input. The same rule the base ref
  // carries, for the same reason: a mode whose target is not the user's to choose
  // says so rather than accepting a value it will not use. A repair acts on the
  // registration's own directory, and an override here displayed one path while
  // the request carried another (round-4 B3).
  const pathNote = document.createElement("p");
  pathNote.className = "wt-fhint";
  pathNote.id = "wt-path-note";
  pathNote.hidden = true;
  pathInput.setAttribute("aria-describedby", "wt-path-note");
  pathField.appendChild(pathNote);

  const migrationField = field("Uncommitted work", "wt-migrate-changes");
  migrationField.classList.add("wt-migration");
  migrationField.hidden = true;
  const migrationRow = document.createElement("label");
  migrationRow.className = "wt-check-row";
  const migrationBox = document.createElement("input");
  migrationBox.type = "checkbox";
  migrationBox.id = "wt-migrate-changes";
  const migrationText = document.createElement("span");
  migrationRow.append(migrationBox, migrationText);
  migrationField.appendChild(migrationRow);
  // `recoverLabel` and `migrationRow` are not returned: they are wrappers this
  // module already appended into their fields, and nothing outside reads them.
  return {
    nameField,
    nameInput,
    nameError,
    listBox,
    partialNote,
    destWrap,
    dest,
    destShort,
    destExactText,
    destNote,
    actionNote,
    forkNote,
    adoptLosses,
    recoverField,
    recoverBox,
    recoverText,
    recoverNote,
    repoHint,
    modeField,
    detachToggle,
    baseField,
    baseInput,
    baseNote,
    pathField,
    pathInput,
    pathRow,
    pathNote,
    migrationField,
    migrationBox,
    migrationText,
  };
}
