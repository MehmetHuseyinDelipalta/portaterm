// src/webview/vault/stackedLayout.ts — which way the aux region is stacked.
//
// It lives here rather than inline in the bootstrap because `main.ts` exports
// nothing and runs the whole webview on import, so an invariant written there
// cannot be tested at all.

/**
 * Whether the aux region is stacked above/below the terminal rather than docked
 * beside it — the axis the collapse animator measures.
 */
export function isStackedLayout(layout: HTMLElement): boolean {
  return layout.classList.contains("file-tree--top") || layout.classList.contains("file-tree--bottom");
}
