// src/webview/editableTarget.ts — Is a key event aimed at a field the user is
// typing into?
//
// The webview's document-level keydown (capture) handler turns a few shortcuts
// into PTY bytes — Shift+Enter, Cmd/Ctrl+Backspace, Cmd+←/→, Option+←/→ — and
// takes Cmd+W for "close". It does that wherever focus is, on purpose: from
// the file tree or another sibling of xterm's textarea, xterm's own handler
// never sees the key. But a text field is different. A newline in the
// worktree prompt, a word-jump in the vault search, Cmd+W while renaming a tab
// belong to that field, not to the shell (or the tab) behind it.
//
// xterm's own input element is a <textarea> too. It is the one field whose
// keys DO go to the PTY, so it is told apart by xterm's class, never treated
// as a field.

/** The class xterm.js gives the hidden textarea it reads keyboard input from. */
export const XTERM_INPUT_CLASS = "xterm-helper-textarea";

/** Whether `target` is a field the user types into — other than xterm's own input. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  if (target.classList.contains(XTERM_INPUT_CLASS)) {
    return false;
  }
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return true;
  }
  // The nearest `contenteditable` decides, so editability inherited from an
  // ancestor counts and an explicit `contenteditable="false"` island does not.
  const host = target.closest("[contenteditable]");
  return host !== null && host.getAttribute("contenteditable") !== "false";
}
