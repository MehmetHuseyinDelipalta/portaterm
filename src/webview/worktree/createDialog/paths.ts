// src/webview/worktree/createDialog/paths.ts — Reading a filesystem path back to
// the user: split it, shorten it, or name its last segment.
//
// Extracted from `WorktreeCreateDialog.ts` by change `decompose-create-dialog`
// (task 1_5). Three pure functions with no import of their own, wanted by two
// destinations — the recover offer names the directory it would clear, and the
// destination line shortens the path the create lands on — so they are a shared
// seam rather than something to thread through a deps interface.

/**
 * The destination, shortened for reading. Two trailing segments: one is not
 * enough to tell `…/anywhere-terminal-feat-x` in one root from the same name in
 * another, and the exact value is a focus or a hover away regardless.
 */
function segments(path: string): string[] {
  // Both separators. The host builds these with `node:path`, which produces `\\`
  // on Windows — splitting on `/` alone leaves such a path whole, so the line
  // renders unshortened and the collision note restates it in full: the two
  // things this form exists to stop doing. Same idiom the file-tree panel and
  // its data source already use, both module-private to their own files.
  return path.split(/[/\\]/).filter(Boolean);
}

export function shortPath(path: string): string {
  const parts = segments(path);
  return parts.length <= 2 ? path : `…/${parts.slice(-2).join("/")}`;
}

export function lastSegment(path: string): string {
  return segments(path).at(-1) ?? path;
}
