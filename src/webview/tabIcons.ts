// src/webview/tabIcons.ts — The glyph drawn for each tab icon id (shared/tabAppearance.ts).
//
// No codicon font is bundled, so each id has its own inline SVG, stroked with
// `currentColor` so the tab's color (or its text color) fills it. STATIC,
// TRUSTED strings only, so they are safe to insert via innerHTML.

import { type TabIconId, toTabIcon } from "../shared/tabAppearance";

const svg = (body: string) =>
  '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" ' +
  `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const TAB_ICON_SVGS: Record<TabIconId, string> = {
  terminal: svg(
    '<rect x="1.5" y="2.5" width="13" height="11" rx="1"/><path d="M4 6l2.5 2L4 10"/><path d="M8 10.5h3"/>',
  ),
  code: svg('<path d="M5.5 4.5 2 8l3.5 3.5"/><path d="M10.5 4.5 14 8l-3.5 3.5"/>'),
  server: svg(
    '<rect x="2" y="2.5" width="12" height="4.5" rx="1"/><rect x="2" y="9" width="12" height="4.5" rx="1"/>' +
      '<path d="M4.5 4.75h.01M4.5 11.25h.01"/>',
  ),
  database: svg(
    '<ellipse cx="8" cy="3.75" rx="5" ry="1.75"/><path d="M3 3.75v8.5c0 .97 2.24 1.75 5 1.75s5-.78 5-1.75v-8.5"/>' +
      '<path d="M3 8c0 .97 2.24 1.75 5 1.75S13 8.97 13 8"/>',
  ),
  globe: svg(
    '<circle cx="8" cy="8" r="6"/><path d="M2 8h12"/><path d="M8 2c1.6 1.7 2.4 3.7 2.4 6S9.6 12.3 8 14c-1.6-1.7-2.4-3.7-2.4-6S6.4 3.7 8 2z"/>',
  ),
  bug: svg(
    '<rect x="5" y="5" width="6" height="8.5" rx="3"/><path d="M6 5V4a2 2 0 0 1 4 0v1"/>' +
      '<path d="M8 8v5.5M2.5 6.5 5 7.5M13.5 6.5 11 7.5M2.5 10H5M13.5 10H11M3 13.5l2.2-1.5M13 13.5 10.8 12"/>',
  ),
  beaker: svg(
    '<path d="M6 1.75h4M6.5 1.75v4.5L2.5 13a1 1 0 0 0 .87 1.5h9.26a1 1 0 0 0 .87-1.5L9.5 6.25v-4.5"/><path d="M4.4 10h7.2"/>',
  ),
  rocket: svg(
    '<path d="M9.5 10.5 5.5 6.5c1.5-3.2 4.3-5 8.25-4.25.75 3.95-1.05 6.75-4.25 8.25z"/>' +
      '<path d="M5.5 6.5H3L1.75 8.75 4.5 9M9.5 10.5V13l-2.25 1.25L7 11.5"/><circle cx="10.5" cy="5.5" r="1"/>' +
      '<path d="M4.5 11.5 2 14"/>',
  ),
  gear: svg(
    '<path d="M14.41 6.43v3.14l-1.72-.15-.37.89 1.32 1.11-2.22 2.22-1.11-1.32-.89.37.15 1.72H6.43l.15-1.72-.89-.37-1.11 1.32-2.22-2.22 1.32-1.11-.37-.89-1.72.15V6.43l1.72.15.37-.89-1.32-1.11 2.22-2.22 1.11 1.32.89-.37-.15-1.72h3.14l-.15 1.72.89.37 1.11-1.32 2.22 2.22-1.32 1.11.37.89z"/>' +
      '<circle cx="8" cy="8" r="2"/>',
  ),
  branch: svg(
    '<circle cx="4.5" cy="3.5" r="1.6"/><circle cx="4.5" cy="12.5" r="1.6"/><circle cx="11.5" cy="6" r="1.6"/>' +
      '<path d="M4.5 5.1v5.8"/><path d="M11.5 7.6c0 2.2-2.3 2.9-4.2 3.2"/>',
  ),
};

/** The SVG for a tab icon id, or undefined for none or an id this build does not know. */
export function tabIconSvg(id: string | undefined): string | undefined {
  const known = toTabIcon(id);
  return known ? TAB_ICON_SVGS[known] : undefined;
}
