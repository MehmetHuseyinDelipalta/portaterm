// src/shared/titleDecorations.ts — The decorative frames agents print in front
// of a pane title, and the one rule for dropping them.
//
// Shared by the webview (worktree rows, the tab label a rename is seeded with)
// and the extension host (the rename seed when no label rides along), so a
// title reads the same wherever it is shown. Pure and dependency-free by
// contract: imported from both bundles.

/**
 * Decorative animation frames agents print in front of a pane title. Stripped
 * before display AND before the render signature, so a spinner tick can never
 * repaint the tree at animation rate (worktree-panel-ui § 4.6).
 */
const GLYPH_FRAMES = /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⣾⣽⣻⢿⡿⣟⣯⣷◐◓◑◒◜◝◞◟✻✽✢✶✳*\s]+/;

/**
 * `|`, `/`, `\` and `-` are also spinner frames, but they are ordinary title
 * characters too — a title that starts `/Users/…` is a path, not an animation. Only
 * a lone one followed by whitespace is treated as a frame.
 */
const ASCII_FRAME = /^[|/-]\s+/;

/** Drop a leading run of decorative frames. A title that is ONLY frames becomes "". */
export function stripDecorations(title: string | undefined): string {
  if (!title) {
    return "";
  }
  return title.replace(GLYPH_FRAMES, "").replace(ASCII_FRAME, "").trim();
}
