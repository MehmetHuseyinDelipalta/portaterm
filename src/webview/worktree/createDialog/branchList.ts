// src/webview/worktree/createDialog/branchList.ts — The branch popup: which row
// is active, whether it is open, and what taking a row does to the form.
//
// Extracted from `openWorktreeCreateDialog` by change `decompose-create-dialog`
// (design.md D1, task 1_4). `activeAt` and `listOpen` sat in the dialog closure
// while every function that reads them sat 1700 lines below, so "is the popup
// open" was a question only a rendered dialog could answer.
//
// The two bindings do NOT leave as accessors. Every outside reader of them was a
// complete operation already — Escape while open, redraw if open, arrow and
// Enter — so each moved in whole and the facade asks for the operation instead
// (task Boundary). That is also why D4's negation trap has nothing to catch
// here: there is no `!listOpen` left outside this file to read a function as
// truthy.
//
// `onNameKeyDown` takes the raw event rather than a decoded intent, so the two
// branches keep the order they had: `preventDefault` before `commit`, and Enter
// falling through to the form when nothing is active. A listbox that swallowed
// Enter with nothing active would make the keyboard path unable to submit.
//
// DOM-bound throughout, so no suite beside this file (design.md D2): the
// 386-case dialog suite drives the popup through `openWorktreeCreateDialog` —
// ordering, held-by rows, the unavailable row, arrow traversal, Enter, Escape,
// blur, and the redraw a repository switch forces.

import type { WorktreeCreateDraft } from "../worktreeViewTypes";
import { type BranchChoices, CREATE_ROW_LABEL } from "./branchChoices";

export interface BranchListDeps {
  readonly listBox: HTMLUListElement;
  readonly nameInput: HTMLInputElement;
  readonly nameError: HTMLSpanElement;
  readonly baseInput: HTMLInputElement;
  readonly branches: BranchChoices;
  /** Mutated in place — `commit` states the mode the taken row means. */
  readonly draft: WorktreeCreateDraft;
  refreshFocusTrap(): void;
  syncDerived(settled?: boolean): void;
}

export interface BranchList {
  /** Open the popup on the text currently typed. */
  open(): void;
  close(): void;

  /**
   * Escape belongs to the list only while it is open (D7), and the shell needs
   * to be told whether it was taken — so this answers rather than acts blindly.
   */
  escape(): boolean;

  /**
   * Redraw only if the popup is up. Called wherever the OFFER changed under a
   * list the user may or may not be looking at: a repository switch, refs
   * landing, pull requests landing.
   */
  refreshIfOpen(): void;

  /** The whole of the name field's keydown, arrows and Enter both. */
  onNameKeyDown(ev: KeyboardEvent): void;
}

export function createBranchList(deps: BranchListDeps): BranchList {
  const { baseInput, branches, draft, listBox, nameError, nameInput } = deps;
  let activeAt = -1;
  let listOpen = false;

  function setActive(next: number): void {
    activeAt = next;
    const rows = Array.from(listBox.children) as HTMLElement[];
    rows.forEach((row, at) => {
      row.classList.toggle("is-active", at === activeAt);
      row.setAttribute("aria-selected", at === activeAt ? "true" : "false");
    });
    const active = activeAt >= 0 ? rows[activeAt] : undefined;
    if (active === undefined) {
      nameInput.removeAttribute("aria-activedescendant");
    } else {
      nameInput.setAttribute("aria-activedescendant", active.id);
      // The popup scrolls, so past its visible rows Enter would otherwise
      // commit an option the user cannot see (round-2 B1). Guarded because
      // jsdom does not implement it.
      active.scrollIntoView?.({ block: "nearest" });
    }
  }

  /** Redraw the rows for the text currently typed. Does not open or close. */
  function renderList(): void {
    const offered = branches.offer(nameInput.value);
    listBox.replaceChildren();
    offered.forEach((c, at) => {
      const row = document.createElement("li");
      row.id = `wt-branch-opt-${at}`;
      row.className = "wt-branch-opt";
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", "false");
      if (c.kind === "new") {
        row.dataset.kind = "new";
        const typed = nameInput.value.trim();
        row.textContent = typed.length > 0 ? `${CREATE_ROW_LABEL} “${typed}”` : CREATE_ROW_LABEL;
      } else if (c.kind === "prsUnavailable") {
        // A statement, not an offer: announced and reachable, never selectable.
        // Same reason the held-by row stays — saying nothing would leave the
        // user thinking the repository has no pull requests (§ 5).
        row.dataset.kind = "prs-unavailable";
        row.setAttribute("aria-disabled", "true");
        row.textContent = "Pull requests unavailable";
      } else if (c.kind === "pr") {
        row.dataset.kind = "pr";
        row.dataset.branch = `pr-${c.pr.number}`;
        row.dataset.pr = String(c.pr.number);
        row.textContent = `#${c.pr.number} ${c.pr.title}`;
      } else {
        row.dataset.kind = "existing";
        row.dataset.branch = c.ref.name;
        row.textContent = c.ref.name;
        if (c.ref.heldBy !== undefined) {
          // `aria-disabled`, never `disabled`: the row's whole purpose is to say
          // WHY the branch is unavailable and which directory has it, so it has
          // to stay reachable and announced. Removing it would put the name back
          // to looking free, which is the failure this task deletes (D5).
          row.setAttribute("aria-disabled", "true");
          row.dataset.heldBy = c.ref.heldBy;
          const badge = document.createElement("span");
          badge.className = "wt-branch-held";
          // A NAME, never a path — the badge is the narrowest slot in the form
          // and the host already applied the shortening (D2, § 4.2).
          badge.textContent = `in ${c.ref.heldBy}`;
          row.appendChild(badge);
        }
      }
      row.addEventListener("mousedown", (ev) => {
        // `mousedown`, not `click`: the input blurs first otherwise and the
        // blur handler closes the list out from under the pointer.
        ev.preventDefault();
        commit(at);
      });
      listBox.appendChild(row);
    });
    setActive(Math.min(activeAt, offered.length - 1));
  }

  function openList(): void {
    listOpen = true;
    renderList();
    listBox.hidden = false;
    nameInput.setAttribute("aria-expanded", "true");
    measureRoom();
    deps.refreshFocusTrap();
  }

  /**
   * Publish the room actually below the input, for the popup's ceiling.
   *
   * CSS alone cannot express this: a `calc` against `100%` resolves to the
   * FIELD's height, not to where the field sits in the viewport, so the round-2
   * attempt read as a measurement and was not one (round-3 S3). The element is
   * the only thing that knows its own position, so it hands the number over.
   */
  function measureRoom(): void {
    const room = nameInput.getBoundingClientRect?.();
    if (room === undefined) {
      return; // jsdom, or a detached node — the stylesheet's own floor applies
    }
    const below = Math.round(window.innerHeight - room.bottom - 12);
    listBox.style.setProperty("--wt-branch-room", `${Math.max(below, 0)}px`);
  }

  function closeList(): void {
    listOpen = false;
    listBox.hidden = true;
    nameInput.setAttribute("aria-expanded", "false");
    nameInput.removeAttribute("aria-activedescendant");
    activeAt = -1;
    deps.refreshFocusTrap();
  }

  /** Take row `at` as the selection, close the list, and re-derive. */
  function commit(at: number): void {
    const decided = branches.commit(at);
    if (decided.kind === "ignored") {
      return;
    }
    if (decided.kind === "refused") {
      nameError.textContent = decided.message;
      nameError.hidden = false;
      return;
    }
    // `syncDerived` reads both fields back into the draft, so stating them here
    // is the whole of what feeds the existing path — there is no second
    // resolution for pull requests.
    if (decided.branchName !== undefined) {
      nameInput.value = decided.branchName;
    }
    if (decided.baseRef !== undefined) {
      baseInput.value = decided.baseRef;
    }
    if (draft.branchMode !== "detached") {
      draft.branchMode = branches.mode();
    }
    closeList();
    nameInput.focus();
    // Picking a row settles the name in one action — there is no keystroke
    // after it for a `change` event to ride.
    deps.syncDerived(true);
  }
  return {
    open: openList,
    close: closeList,

    escape() {
      if (!listOpen) {
        return false;
      }
      closeList();
      return true;
    },

    refreshIfOpen() {
      if (listOpen) {
        renderList();
      }
    },

    onNameKeyDown(ev) {
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        if (!listOpen) {
          openList();
        }
        if (branches.rows().length > 0) {
          const step = ev.key === "ArrowDown" ? 1 : -1;
          setActive((activeAt + step + branches.rows().length) % branches.rows().length);
        }
        return;
      }
      // Enter takes the ACTIVE row while the list is open, and otherwise falls
      // through to the form — a listbox that swallowed Enter with nothing active
      // would make the keyboard path unable to submit at all.
      if (ev.key === "Enter" && listOpen && activeAt >= 0) {
        ev.preventDefault();
        commit(activeAt);
      }
    },
  };
}
