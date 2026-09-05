// src/webview/shared/iconNode.ts — Parse each static SVG glyph once, clone after.
//
// The icon strings in vault/icons.ts + worktree/worktreeIcons.ts are STATIC and
// TRUSTED, and every row of the worktree tree, the vault list and the file tree
// re-parses several of them through `el.innerHTML = ICON_*`. `innerHTML` runs the
// HTML parser on every assignment; a cached template plus `cloneNode(true)` skips
// it. Same trust boundary as before — this module only ever sees module-level
// constants, never session data.

const templates = new Map<string, Element>();

/** Replace `el`'s children with a clone of the parsed glyph. */
export function setIcon(el: Element, svg: string): void {
  let tpl = templates.get(svg);
  if (tpl === undefined) {
    const host = el.ownerDocument.createElement("div");
    host.innerHTML = svg;
    const first = host.firstElementChild;
    if (first === null) {
      el.replaceChildren();
      return;
    }
    tpl = first;
    templates.set(svg, tpl);
  }
  el.replaceChildren(tpl.cloneNode(true));
}
