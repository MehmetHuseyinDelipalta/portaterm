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
// Tokenizing is the cost of a preview: about 180 ms for a 1000-line TypeScript
// file, all of it on the webview's one thread. So a short file is highlighted at
// once, and a longer one is shown as plain lines first and highlighted in
// slices of `SLICE_LINES`, yielding between them and carrying the grammar state
// across, so the result is exactly what one pass would have produced. Finished
// renders are remembered by theme, grammar and content: hovering the same file
// again costs nothing.
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

/**
 * Unhighlighted, shaped like Shiki's output — one `span.line` per line — so the
 * line-number gutter and the active-line mark work before any highlighting.
 */
function plainHtml(content: string): string {
  const lines = content.split("\n").map((line) => `<span class="line">${escapeHtml(line)}</span>`);
  return `<pre class="anywhere-hover-preview-plain"><code>${lines.join("\n")}</code></pre>`;
}

/** Content up to this many characters is highlighted at once: ~25 ms for dense code. */
export const SYNC_HIGHLIGHT_CHARS = 6_000;
/** Lines tokenized per slice of a longer file: ~13 ms for dense code. */
export const SLICE_LINES = 50;
/** Finished renders remembered, least recently used dropped first. */
export const MAX_REMEMBERED_RENDERS = 16;

/** Finished HTML by `renderKey`. A Map iterates in insertion order: the first key is the least recently used. */
const rememberedRenders = new Map<string, string>();
/** Sliced renders under way, so a second hover on the same file joins the first. */
const slicedRenders = new Map<string, Promise<string | null>>();

function renderKey(content: string, lang: string, theme: HoverPreviewThemeKind): string {
  return `${themeFor(theme)}\0${lang}\0${content}`;
}

function recallRender(key: string): string | undefined {
  const html = rememberedRenders.get(key);
  if (html !== undefined) {
    rememberedRenders.delete(key);
    rememberedRenders.set(key, html);
  }
  return html;
}

/** Only called for a key that missed, so `set` adds it as the most recent. */
function rememberRender(key: string, html: string): void {
  rememberedRenders.set(key, html);
  if (rememberedRenders.size > MAX_REMEMBERED_RENDERS) {
    rememberedRenders.delete(rememberedRenders.keys().next().value as string);
  }
}

/** Let the host paint and handle input before the next slice. */
const yieldToHost = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

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
/** The bundle the highlighter came from, once loaded: its `hastToHtml` serializes sliced renders. */
let bundleSync: ShikiBundle | null = null;

/**
 * The highlighter, loading Shiki on first call. Never rejects: a load that fails
 * answers `null` — every caller then renders plain text — and the next call
 * tries again.
 */
function getHighlighter(): Promise<HighlighterCore | null> {
  if (!_highlighterPromise) {
    _highlighterPromise = loadBundleScript()
      .then((bundle) => {
        bundleSync = bundle;
        return bundle.createHighlighter();
      })
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
    return plainHtml(content);
  }
  const key = renderKey(content, lang, theme);
  const known = recallRender(key);
  if (known !== undefined) {
    return known;
  }
  try {
    const html = cached.codeToHtml(content, { lang, theme: themeFor(theme) });
    rememberRender(key, html);
    return html;
  } catch (err) {
    console.warn("[Portaterm] Shiki render failed:", err);
    return plainHtml(content);
  }
}

/**
 * The final HTML when it costs little now — remembered, too short to matter
 * (plain lines, for a language without a grammar) — else `null`: the
 * highlighter is still loading, or the content is long enough to be
 * highlighted in slices.
 */
function quickHtml(content: string, languageId: string, theme: HoverPreviewThemeKind): string | null {
  if (!highlighterSync) {
    return null;
  }
  const known = recallRender(renderKey(content, normalizeLanguage(languageId), theme));
  if (known !== undefined) {
    return known;
  }
  return content.length <= SYNC_HIGHLIGHT_CHARS ? renderHtml(content, languageId, theme) : null;
}

/** Shiki's root → `pre` → `code` element, whose children are the `span.line`s and the newlines between. */
type HastRoot = ReturnType<HighlighterCore["codeToHast"]>;
type HastParent = { children: HastRoot["children"] };

function codeElementOf(root: HastRoot): HastParent {
  return (root.children[0] as HastParent).children[0] as HastParent;
}

/**
 * Highlight `content` a slice at a time, yielding to the host before each, and
 * resolve with the same HTML `codeToHtml` gives for the whole — the grammar
 * state at the end of one slice starts the next. `null` when there is no
 * highlighter or no grammar for the language. The result is remembered, and a
 * second request for the same render while one runs shares it.
 */
export async function highlightInSlices(
  content: string,
  languageId: string,
  theme: HoverPreviewThemeKind,
): Promise<string | null> {
  const lang = normalizeLanguage(languageId);
  const highlighter = lang ? await getHighlighter() : null;
  if (!highlighter) {
    return null;
  }
  const key = renderKey(content, lang, theme);
  const known = recallRender(key);
  if (known !== undefined) {
    return known;
  }
  let render = slicedRenders.get(key);
  if (!render) {
    render = sliceRender(highlighter, content, lang, theme, key).finally(() => slicedRenders.delete(key));
    slicedRenders.set(key, render);
  }
  return render;
}

async function sliceRender(
  highlighter: HighlighterCore,
  content: string,
  lang: string,
  theme: HoverPreviewThemeKind,
  key: string,
): Promise<string | null> {
  try {
    const lines = content.split("\n");
    let root: HastRoot | undefined;
    let code: HastParent | undefined;
    let grammarState: ReturnType<HighlighterCore["getLastGrammarState"]> | undefined;
    for (let start = 0; start < lines.length; start += SLICE_LINES) {
      await yieldToHost();
      const slice = highlighter.codeToHast(lines.slice(start, start + SLICE_LINES).join("\n"), {
        lang,
        theme: themeFor(theme),
        grammarState,
      });
      grammarState = highlighter.getLastGrammarState(slice);
      const sliceCode = codeElementOf(slice);
      if (code) {
        code.children.push({ type: "text", value: "\n" }, ...sliceCode.children);
      } else {
        root = slice;
        code = sliceCode;
      }
    }
    // Loaded with the highlighter, so present whenever there is one.
    const html = (bundleSync as ShikiBundle).hastToHtml(root as HastRoot);
    rememberRender(key, html);
    return html;
  } catch (err) {
    console.warn("[Portaterm] Shiki render failed:", err);
    return null;
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
  renderLive(
    content: string,
    languageId: string,
    theme: HoverPreviewThemeKind,
    onHighlighted?: () => void,
  ): HTMLElement;
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
    /**
     * The preview's element, filled with its final HTML when that is cheap, and
     * otherwise with plain lines that the highlighted HTML replaces once ready
     * — if the element is still on the page. `onHighlighted` runs after that
     * replacement, so the caller can mark the active line again.
     */
    renderLive(content, languageId, theme, onHighlighted): HTMLElement {
      const wrapper = document.createElement("div");
      wrapper.className = "anywhere-hover-preview-code";
      const quick = quickHtml(content, languageId, theme);
      wrapper.innerHTML = quick ?? plainHtml(content);
      if (quick === null) {
        void highlightInSlices(content, languageId, theme).then((html) => {
          if (html === null || !wrapper.isConnected) {
            return;
          }
          wrapper.innerHTML = html;
          try {
            onHighlighted?.();
          } catch {
            // Best-effort — the popup's re-mark must never throw out of here.
          }
        });
      }
      return wrapper;
    },
  };
}

/** Test-only override — never call in production. */
export function __setHighlighterForTests(h: HighlighterCore | null): void {
  highlighterSync = h;
  rememberedRenders.clear(); // renders by another highlighter
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
