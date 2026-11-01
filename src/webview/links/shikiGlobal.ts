// src/webview/links/shikiGlobal.ts — The contract between `webview.js` and the
// separately built `media/shiki.js`: the global the latter publishes itself
// under, and what it publishes. Kept apart so neither bundle pulls in the other.

import type { HighlighterCore } from "shiki/core";

/** What `media/shiki.js` publishes on `globalThis[SHIKI_GLOBAL]` once it has run. */
export interface ShikiBundle {
  createHighlighter(): Promise<HighlighterCore>;
  /** Shiki's own serializer, for HTML assembled from highlighted slices. */
  hastToHtml(root: ReturnType<HighlighterCore["codeToHast"]>): string;
}

/** The global `media/shiki.js` publishes itself under. */
export const SHIKI_GLOBAL = "__portatermShiki";
