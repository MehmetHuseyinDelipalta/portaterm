// src/webview/terminal/canvasFontFix.ts — keep the WebGL renderer's glyphs at the
// configured size on a Chromium that rejects a canvas font with leading whitespace.
//
// Chromium 150.0.7871.250 (Electron 43.8.9, shipped in Cursor 3.30.x) and Electron
// 45.2.3 carry a ParseFont backport without its follow-up fix: assigning
// `ctx.font = " 14px Menlo"` is rejected and the context keeps "10px sans-serif".
// `@xterm/addon-webgl` builds its glyph-atlas font as `${fontStyle} ${fontWeight}
// ${size}px ${family}` and passes the result through, so every glyph is drawn at
// 10px inside a cell measured for the configured font: tiny letters spread across
// the line. xterm.js#6297, electron/electron#55616. VS Code works around it the
// same way in microsoft/vscode#348269.

const LEADING_CSS_WHITESPACE = /^[ \t\r\n\f]+/;

/** Windows whose canvas contexts already trim — patching twice would wrap the setter twice. */
const patchedWindows = new WeakSet<Window>();

/** What the probe found per window: the parser cannot change while the page lives. */
const probed = new WeakMap<Window, boolean>();

type CanvasWindow = Window & {
  CanvasRenderingContext2D?: { prototype: object };
  OffscreenCanvasRenderingContext2D?: { prototype: object };
};

/** True when `win`'s canvas drops a font string that starts with whitespace. */
function rejectsLeadingWhitespace(win: Window): boolean {
  const cached = probed.get(win);
  if (cached !== undefined) {
    return cached;
  }
  let rejects = false;
  const ctx = win.document.createElement("canvas").getContext("2d");
  if (ctx) {
    ctx.font = " 24px monospace";
    rejects = ctx.font === "10px sans-serif";
  }
  probed.set(win, rejects);
  return rejects;
}

function trimLeadingWhitespace(value: unknown): unknown {
  return typeof value === "string" ? value.replace(LEADING_CSS_WHITESPACE, "") : value;
}

/**
 * Make `win`'s 2D canvas contexts accept a font string with leading whitespace,
 * when — and only when — this Chromium rejects one. Call before the WebGL addon
 * builds its glyph atlas. Safe to call any number of times.
 */
export function ensureCanvasFontLeadingWhitespaceFix(win: Window): void {
  if (patchedWindows.has(win) || !rejectsLeadingWhitespace(win)) {
    return;
  }
  patchedWindows.add(win);
  const canvasWindow = win as CanvasWindow;
  for (const ctor of [canvasWindow.CanvasRenderingContext2D, canvasWindow.OffscreenCanvasRenderingContext2D]) {
    const proto = ctor?.prototype;
    const originalSet = proto ? Object.getOwnPropertyDescriptor(proto, "font")?.set : undefined;
    if (!proto || !originalSet) {
      continue;
    }
    // Redefining only `set` keeps the native getter and the property's attributes.
    Object.defineProperty(proto, "font", {
      set(this: unknown, value: unknown) {
        originalSet.call(this, trimLeadingWhitespace(value));
      },
    });
  }
}
