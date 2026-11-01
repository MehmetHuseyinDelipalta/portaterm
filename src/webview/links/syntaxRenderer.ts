// src/webview/links/syntaxRenderer.ts — Shiki rendering for the hover preview
// popup, with Shiki itself loaded on first use.
//
// The curated 20-grammar + 4-theme bundle (design.md D1) is composed statically
// at build time — but into its own IIFE, `media/shiki.js` (`shikiBundle.ts`),
// not into `webview.js`. It is about 2.2 MB of the 4.2 MB a webview used to
// parse on every open, for a popup most panes never show. The first render that
// wants it adds one `<script>` carrying this page's nonce, so the nonce-CSP
// admits it; this module still makes no dynamic `import()` (D11).
//
// See: asimov/changes/add-hover-file-preview/design.md D1, D8, D11
// See: docs/research/20260521-shiki-v3-api.md (exact API surface)

import type { HighlighterCore } from "shiki/core";
import type { HoverPreviewThemeKind } from "./HoverPreviewController";
import { SHIKI_GLOBAL, type ShikiBundle } from "./shikiGlobal";

/** Curated language set bundled into the webview at build time. */
export const SUPPORTED_LANGUAGES = new Set<string>([
  "c",
  "cpp",
  "css",
  "go",
  "html",
  "java",
  "javascript",
  "json",
  "jsx",
  "kotlin",
  "markdown",
  "php",
  "python",
  "ruby",
  "rust",
  "shellscript",
  "sql",
  "tsx",
  "typescript",
  "yaml",
]);

/** Map common VSCode + Shiki aliases to the curated grammar id. */
const LANGUAGE_ALIASES: Record<string, string> = {
  // VSCode language ids that map onto our curated names
  typescriptreact: "tsx",
  javascriptreact: "jsx",
  // Common short aliases for fenced code blocks
  ts: "typescript",
  js: "javascript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  // Shell aliases
  sh: "shellscript",
  shell: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  // Markdown short alias
  md: "markdown",
  // YAML short alias
  yml: "yaml",
  // C++ aliases
  "c++": "cpp",
  cxx: "cpp",
  cc: "cpp",
  // Kotlin short alias
  kt: "kotlin",
};

/** Pick the Shiki theme name for the current VSCode theme kind. */
function themeFor(kind: HoverPreviewThemeKind): string {
  switch (kind) {
    case "light":
      return "github-light";
    case "dark":
      return "github-dark";
    case "hc-light":
      return "light-plus";
    case "hc-dark":
      return "dark-plus";
  }
}

/** Normalize the language id to a curated grammar name, or "" when unsupported. */
function normalizeLanguage(languageId: string | undefined): string {
  if (!languageId) {
    return "";
  }
  const lower = languageId.toLowerCase();
  const aliased = LANGUAGE_ALIASES[lower] ?? lower;
  return SUPPORTED_LANGUAGES.has(aliased) ? aliased : "";
}

function escapeHtml(input: string): string {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface SyntaxRendererDeps {
  /** Latest theme kind. Read fresh on every render. */
  getTheme: () => HoverPreviewThemeKind;
}

/**
 * The `<script>` running this bundle — only knowable while it evaluates, so it
 * is captured at module load. Its `src` locates `shiki.js` beside `webview.js`,
 * and its nonce is what the CSP admits.
 */
let hostScript: HTMLScriptElement | null =
  typeof document !== "undefined" && document.currentScript instanceof HTMLScriptElement
    ? document.currentScript
    : null;

/** `shiki.js` beside the given `webview.js` URL, keeping its cache-busting query. */
export function shikiBundleUrl(webviewScriptSrc: string): string {
  return webviewScriptSrc.replace(/webview\.js(?=$|[?#])/, "shiki.js");
}

/** Add `media/shiki.js` to the page once, and resolve with what it publishes. */
function loadBundleScript(): Promise<ShikiBundle> {
  const published = (globalThis as Record<string, unknown>)[SHIKI_GLOBAL] as ShikiBundle | undefined;
  if (published) {
    return Promise.resolve(published);
  }
  const host = hostScript;
  if (!host?.src) {
    return Promise.reject(new Error("the webview script is unknown, so shiki.js cannot be located"));
  }
  return new Promise<ShikiBundle>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = shikiBundleUrl(host.src);
    script.nonce = host.nonce;
    script.addEventListener("load", () => {
      const bundle = (globalThis as Record<string, unknown>)[SHIKI_GLOBAL] as ShikiBundle | undefined;
      if (bundle) {
        resolve(bundle);
      } else {
        reject(new Error("shiki.js ran without publishing its bundle"));
      }
    });
    script.addEventListener("error", () => {
      script.remove();
      reject(new Error("shiki.js failed to load"));
    });
    document.head.appendChild(script);
  });
}

/** Singleton highlighter — created lazily on first render. */
let _highlighterPromise: Promise<HighlighterCore | null> | null = null;

/**
 * The highlighter, loading Shiki on first call. Never rejects: a load that fails
 * answers `null` — every caller then renders plain text — and the next call
 * tries again.
 */
function getHighlighter(): Promise<HighlighterCore | null> {
  if (!_highlighterPromise) {
    _highlighterPromise = loadBundleScript()
      .then((bundle) => bundle.createHighlighter())
      .then(
        (highlighter) => {
          highlighterSync = highlighter;
          return highlighter;
        },
        (err: unknown) => {
          console.warn("[Portaterm] Shiki failed to load; previews stay plain text:", err);
          _highlighterPromise = null; // the next render tries again
          return null;
        },
      );
  }
  return _highlighterPromise;
}

/**
 * Synchronous render to an HTML string. Returns a `<pre>` plain-text wrapper
 * when the highlighter hasn't loaded yet or the language is unsupported —
 * the popup falls back transparently in those cases.
 */
export function renderHtml(content: string, languageId: string, theme: HoverPreviewThemeKind): string {
  const lang = normalizeLanguage(languageId);
  // Touch the highlighter to start initialization (idempotent).
  void getHighlighter();
  const cached = highlighterSync;
  if (!cached || !lang) {
    return `<pre class="anywhere-hover-preview-plain">${escapeHtml(content)}</pre>`;
  }
  try {
    return cached.codeToHtml(content, { lang, theme: themeFor(theme) });
  } catch (err) {
    console.warn("[Portaterm] Shiki render failed:", err);
    return `<pre class="anywhere-hover-preview-plain">${escapeHtml(content)}</pre>`;
  }
}

/**
 * Synchronous accessor populated as a side effect of the first async render.
 * Once `getHighlighter()` resolves we cache the result here so `renderHtml`
 * can run sync. Tests can also set this via `__setHighlighterForTests`.
 */
let highlighterSync: HighlighterCore | null = null;

/** True iff the singleton highlighter has finished loading. */
export function isHighlighterReady(): boolean {
  return highlighterSync !== null;
}

/**
 * Resolves when the singleton highlighter is loaded — callers (the popup) use
 * this to re-render once Shiki is available. Cheap to await repeatedly: the
 * promise is cached. See review round-1 W4.
 */
export function whenHighlighterReady(): Promise<void> {
  return getHighlighter().then(() => undefined);
}

/** Load Shiki now rather than on the first render that wants it. */
export async function preloadSyntaxHighlighter(): Promise<void> {
  await getHighlighter();
}

/**
 * Render content to a DOM element. Wraps the Shiki HTML in a container div.
 */
export function createSyntaxRenderer(deps: SyntaxRendererDeps): {
  render(content: string, languageId: string): Promise<HTMLElement>;
  renderHtml(content: string, languageId: string, theme?: HoverPreviewThemeKind): string;
  renderElement(content: string, languageId: string, theme?: HoverPreviewThemeKind): HTMLElement;
} {
  return {
    async render(content: string, languageId: string): Promise<HTMLElement> {
      await getHighlighter();
      return this.renderElement(content, languageId);
    },
    renderHtml(content: string, languageId: string, theme?: HoverPreviewThemeKind): string {
      return renderHtml(content, languageId, theme ?? deps.getTheme());
    },
    renderElement(content: string, languageId: string, theme?: HoverPreviewThemeKind): HTMLElement {
      const wrapper = document.createElement("div");
      wrapper.className = "anywhere-hover-preview-code";
      wrapper.innerHTML = renderHtml(content, languageId, theme ?? deps.getTheme());
      return wrapper;
    },
  };
}

/** Test-only override — never call in production. */
export function __setHighlighterForTests(h: HighlighterCore | null): void {
  highlighterSync = h;
  if (h === null) {
    _highlighterPromise = null;
  }
}

/** Test-only: replace how the bundle is obtained (jsdom loads no script). */
export type { ShikiBundle };

/** Test-only: the script `shiki.js` is located from (module load captured none under jsdom). */
export function __setHostScriptForTests(script: HTMLScriptElement | null): void {
  hostScript = script;
}
