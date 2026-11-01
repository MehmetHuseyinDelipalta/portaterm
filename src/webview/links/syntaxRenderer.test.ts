// @vitest-environment jsdom
// src/webview/links/syntaxRenderer.test.ts — Curated language set + static-import
// audit + plain-text fallback. See: design.md D1, D11.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { HighlighterCore } from "shiki/core";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { shikiBundle } from "./shikiBundle";
import { SHIKI_GLOBAL, SHIKI_GLOBAL as SHIKI_GLOBAL_KEY, type ShikiBundle } from "./shikiGlobal";
import {
  __setHighlighterForTests,
  __setHostScriptForTests,
  createSyntaxRenderer,
  highlightInSlices,
  isHighlighterReady,
  MAX_REMEMBERED_RENDERS,
  preloadSyntaxHighlighter,
  SLICE_LINES,
  SUPPORTED_LANGUAGES,
  SYNC_HIGHLIGHT_CHARS,
  shikiBundleUrl,
  whenHighlighterReady,
} from "./syntaxRenderer";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("syntaxRenderer — static-import audit (D11)", () => {
  it.each([
    "syntaxRenderer.ts",
    "shikiBundle.ts",
    "shikiGlobal.ts",
  ])("%s contains zero dynamic import() or require() calls", (file) => {
    const sourcePath = resolve(__dirname, file);
    const raw = readFileSync(sourcePath, "utf-8");
    // Strip comment / string contexts so we only audit real code tokens.
    // Order matters: block comments first (they may contain // sequences),
    // then line comments, then string literals.
    const codeOnly = raw
      .replace(/\/\*[\s\S]*?\*\//g, "") // /* ... */ block comments
      .replace(/\/\/[^\n]*/g, "") // // line comments
      .replace(/`(?:[^`\\]|\\.)*`/g, "``") // template literals
      .replace(/'(?:[^'\\]|\\.)*'/g, "''") // single-quoted strings
      .replace(/"(?:[^"\\]|\\.)*"/g, '""'); // double-quoted strings
    const dynamicImport = /[^a-zA-Z_$]import\s*\(/.test(codeOnly);
    const requireCall = /[^a-zA-Z_$]require\s*\(/.test(codeOnly);
    expect(dynamicImport).toBe(false);
    expect(requireCall).toBe(false);
  });

  it("SUPPORTED_LANGUAGES matches the curated 20-language set from design.md D1", () => {
    const expected = new Set([
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
    expect(SUPPORTED_LANGUAGES).toEqual(expected);
  });
});

describe("syntaxRenderer — rendering", () => {
  beforeEach(() => {
    // jsdom loads no <script>: publish the bundle as running shiki.js would.
    (globalThis as Record<string, unknown>)[SHIKI_GLOBAL] = shikiBundle;
    __setHighlighterForTests(null);
  });
  afterEach(() => {
    __setHighlighterForTests(null);
  });

  it("returns a <pre> plain-text wrapper for unsupported languages even when highlighter is loaded", async () => {
    await preloadSyntaxHighlighter();
    const renderer = createSyntaxRenderer({ getTheme: () => "dark" });
    const html = renderer.renderHtml("foo bar", "this-language-doesnt-exist");
    expect(html.startsWith('<pre class="anywhere-hover-preview-plain">')).toBe(true);
    expect(html).toContain("foo bar");
  });

  it("returns a <pre> plain-text wrapper before the highlighter is loaded", () => {
    __setHighlighterForTests(null);
    const renderer = createSyntaxRenderer({ getTheme: () => "dark" });
    const html = renderer.renderHtml('const x = "hi";', "typescript");
    expect(html.startsWith('<pre class="anywhere-hover-preview-plain">')).toBe(true);
  });

  it("returns Shiki-classed HTML once the highlighter is loaded for a supported language", async () => {
    await preloadSyntaxHighlighter();
    const renderer = createSyntaxRenderer({ getTheme: () => "dark" });
    const html = renderer.renderHtml('const x = "hi";', "typescript");
    expect(html.startsWith("<pre")).toBe(true);
    // Shiki emits <pre class="shiki ...">.
    expect(html).toMatch(/<pre[^>]*class="[^"]*shiki/);
  });

  it("renderElement wraps the html in .anywhere-hover-preview-code", async () => {
    await preloadSyntaxHighlighter();
    const renderer = createSyntaxRenderer({ getTheme: () => "dark" });
    const el = renderer.renderElement("x", "typescript");
    expect(el.tagName).toBe("DIV");
    expect(el.className).toBe("anywhere-hover-preview-code");
    expect(el.querySelector("pre")).toBeTruthy();
  });

  it("normalizes typescriptreact → tsx and bash → shellscript", async () => {
    await preloadSyntaxHighlighter();
    const renderer = createSyntaxRenderer({ getTheme: () => "dark" });
    const tsxHtml = renderer.renderHtml("<Foo />", "typescriptreact");
    const bashHtml = renderer.renderHtml("echo hi", "bash");
    // Both produce Shiki-classed output.
    expect(tsxHtml).toMatch(/<pre[^>]*class="[^"]*shiki/);
    expect(bashHtml).toMatch(/<pre[^>]*class="[^"]*shiki/);
  });

  it("each VSCode theme kind produces a Shiki render (no throw)", async () => {
    await preloadSyntaxHighlighter();
    for (const kind of ["light", "dark", "hc-light", "hc-dark"] as const) {
      const renderer = createSyntaxRenderer({ getTheme: () => kind });
      const html = renderer.renderHtml("x", "typescript");
      expect(html).toMatch(/<pre[^>]*class="[^"]*shiki/);
    }
  });

  it("isHighlighterReady returns false before preload and true after (W4)", async () => {
    expect(isHighlighterReady()).toBe(false);
    await preloadSyntaxHighlighter();
    expect(isHighlighterReady()).toBe(true);
  });

  it("whenHighlighterReady resolves only after readiness is observable (W4)", async () => {
    const preload = preloadSyntaxHighlighter();
    await whenHighlighterReady().then(() => {
      expect(isHighlighterReady()).toBe(true);
    });
    await preload;
  });
});

describe("syntaxRenderer — Shiki is a bundle of its own, loaded on first use (D3)", () => {
  const added = () => Array.from(document.head.querySelectorAll<HTMLScriptElement>("script"));
  let host: HTMLScriptElement;

  beforeEach(() => {
    __setHighlighterForTests(null);
    host = document.createElement("script");
    host.src = "https://file+.vscode-resource.vscode-cdn.net/ext/media/webview.js?v=123-456";
    host.nonce = "abc123";
    __setHostScriptForTests(host);
    delete (globalThis as Record<string, unknown>)[SHIKI_GLOBAL];
  });

  afterEach(() => {
    for (const script of added()) {
      script.remove();
    }
    delete (globalThis as Record<string, unknown>)[SHIKI_GLOBAL];
    __setHostScriptForTests(null);
    __setHighlighterForTests(null);
    vi.restoreAllMocks();
  });

  it("locates shiki.js beside webview.js, keeping its version query", () => {
    expect(shikiBundleUrl("https://x/media/webview.js?v=1-2")).toBe("https://x/media/shiki.js?v=1-2");
    expect(shikiBundleUrl("https://x/media/webview.js")).toBe("https://x/media/shiki.js");
    expect(shikiBundleUrl("https://x/webview.js-dir/media/webview.js#a")).toBe(
      "https://x/webview.js-dir/media/shiki.js#a",
    );
  });

  it("adds nothing to the page until something renders", () => {
    expect(added()).toHaveLength(0);
    expect(isHighlighterReady()).toBe(false);
  });

  it("adds shiki.js once, with this page's nonce, on the first render that wants it", async () => {
    const renderer = createSyntaxRenderer({ getTheme: () => "dark" });
    const plain = renderer.renderHtml("const x = 1;", "typescript");
    expect(plain.startsWith('<pre class="anywhere-hover-preview-plain">')).toBe(true);
    renderer.renderHtml("const y = 2;", "typescript");

    expect(added()).toHaveLength(1);
    const script = added()[0];
    expect(script.src).toBe("https://file+.vscode-resource.vscode-cdn.net/ext/media/shiki.js?v=123-456");
    expect(script.nonce).toBe("abc123");

    // The script runs: it publishes the bundle, then fires `load`.
    (globalThis as Record<string, unknown>)[SHIKI_GLOBAL] = shikiBundle;
    script.dispatchEvent(new Event("load"));
    await whenHighlighterReady();

    expect(isHighlighterReady()).toBe(true);
    expect(renderer.renderHtml("const z = 3;", "typescript")).toMatch(/<pre[^>]*class="[^"]*shiki/);
    expect(added()).toHaveLength(1);
  });

  it("uses a bundle already on the page without adding another", async () => {
    (globalThis as Record<string, unknown>)[SHIKI_GLOBAL] = shikiBundle;
    await whenHighlighterReady();
    expect(isHighlighterReady()).toBe(true);
    expect(added()).toHaveLength(0);
  });

  it("stays plain text when shiki.js fails to load, and tries again on the next render", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const renderer = createSyntaxRenderer({ getTheme: () => "dark" });
    renderer.renderHtml("x", "typescript");
    added()[0].dispatchEvent(new Event("error"));
    await whenHighlighterReady();

    expect(isHighlighterReady()).toBe(false);
    expect(added()).toHaveLength(0); // the failed tag is gone
    expect(warn).toHaveBeenCalledWith("[Portaterm] Shiki failed to load; previews stay plain text:", expect.any(Error));

    renderer.renderHtml("x", "typescript");
    expect(added()).toHaveLength(1);
  });

  it("does not resolve to a highlighter when shiki.js runs without publishing one", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    createSyntaxRenderer({ getTheme: () => "dark" }).renderHtml("x", "typescript");
    added()[0].dispatchEvent(new Event("load"));
    await whenHighlighterReady();
    expect(isHighlighterReady()).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      "[Portaterm] Shiki failed to load; previews stay plain text:",
      expect.objectContaining({ message: "shiki.js ran without publishing its bundle" }),
    );
  });

  it("stays plain text when the webview script cannot be located", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    __setHostScriptForTests(null);
    const html = createSyntaxRenderer({ getTheme: () => "dark" }).renderHtml("x", "typescript");
    await whenHighlighterReady();
    expect(html.startsWith('<pre class="anywhere-hover-preview-plain">')).toBe(true);
    expect(added()).toHaveLength(0);
    expect(isHighlighterReady()).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      "[Portaterm] Shiki failed to load; previews stay plain text:",
      expect.objectContaining({ message: "the webview script is unknown, so shiki.js cannot be located" }),
    );
  });
});

describe("syntaxRenderer — locating shiki.js from the script that loaded it (D3)", () => {
  afterEach(() => {
    delete (document as { currentScript?: unknown }).currentScript;
    for (const script of Array.from(document.head.querySelectorAll("script"))) {
      script.remove();
    }
    vi.resetModules();
  });

  it("remembers the webview script that is running while the module loads", async () => {
    const running = document.createElement("script");
    running.src = "https://res/media/webview.js?v=7";
    running.nonce = "n0nce";
    Object.defineProperty(document, "currentScript", { value: running, configurable: true });
    vi.resetModules();
    const fresh = await import("./syntaxRenderer");
    delete (document as { currentScript?: unknown }).currentScript; // gone once the bundle has run

    fresh.createSyntaxRenderer({ getTheme: () => "dark" }).renderHtml("x", "typescript");

    const added = document.head.querySelector<HTMLScriptElement>("script");
    expect(added?.src).toBe("https://res/media/shiki.js?v=7");
    expect(added?.nonce).toBe("n0nce");
  });
});

/**
 * TypeScript of `lineCount` lines whose multi-line constructs straddle slice
 * boundaries: a template literal and a block comment open before a multiple of
 * `SLICE_LINES` and close after it, so a slice that started from a fresh
 * grammar state would color their insides as code.
 */
function longSource(lineCount: number): string {
  const lines: string[] = [];
  for (let i = 0; lines.length < lineCount; i++) {
    lines.push(`export function f${i}(a: number): string { return \`v\${a}\`; } // ${i}`);
    if (lines.length % SLICE_LINES === SLICE_LINES - 3) {
      lines.push("const text = `", "  if (x) { return 1; }", "  const y = 2;", "  done`;");
    }
    if (lines.length % SLICE_LINES === SLICE_LINES - 20) {
      lines.push("/*", " * function inComment() { return 'x'; }", " */");
    }
  }
  return lines.slice(0, lineCount).join("\n");
}

/**
 * One real highlighter for the whole file, watched. Building one compiles every
 * grammar's expressions, a second or more under a loaded machine: a fresh one
 * per test would spend each test's budget on that.
 */
let sharedHighlighter: Promise<HighlighterCore> | undefined;

/** Code of exactly `length` characters, in short lines as real code comes. */
function sourceOfLength(length: number): string {
  const body = "let v = 0;\n".repeat(Math.floor((length - 40) / 11));
  return `${body}// ${"x".repeat(length - body.length - 3)}`;
}

/** The real bundle, handing out the shared highlighter with its watch reset. */
function watchedBundle(): { bundle: ShikiBundle; highlighters: HighlighterCore[] } {
  const highlighters: HighlighterCore[] = [];
  const bundle: ShikiBundle = {
    hastToHtml: shikiBundle.hastToHtml,
    createHighlighter: async () => {
      sharedHighlighter ??= shikiBundle.createHighlighter().then((h) => {
        vi.spyOn(h, "codeToHast");
        vi.spyOn(h, "codeToHtml");
        return h;
      });
      const h = await sharedHighlighter;
      vi.mocked(h.codeToHast).mockClear();
      vi.mocked(h.codeToHtml).mockClear();
      highlighters.push(h);
      return h;
    },
  };
  return { bundle, highlighters };
}

const settle = async () => {
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
};

describe("syntaxRenderer — slices and remembered renders (perf D1)", () => {
  let watched: ReturnType<typeof watchedBundle>;
  let reference: HighlighterCore;
  const highlighter = () => watched.highlighters[0];

  beforeAll(async () => {
    reference = await shikiBundle.createHighlighter();
  });

  beforeEach(async () => {
    watched = watchedBundle();
    (globalThis as Record<string, unknown>)[SHIKI_GLOBAL_KEY] = watched.bundle;
    __setHighlighterForTests(null);
    await preloadSyntaxHighlighter();
  });

  afterEach(() => {
    __setHighlighterForTests(null);
    // Not restoreAllMocks: that would unwatch the shared highlighter too.
    for (const spied of [console.warn, globalThis.setTimeout]) {
      if (vi.isMockFunction(spied)) {
        spied.mockRestore();
      }
    }
  });

  it("budgets ~25 ms at once and ~13 ms per slice, and remembers 16 renders", () => {
    expect(SYNC_HIGHLIGHT_CHARS).toBe(6_000);
    expect(SLICE_LINES).toBe(50);
    expect(MAX_REMEMBERED_RENDERS).toBe(16);
  });

  it("produces exactly the HTML one pass over the whole file does", async () => {
    const source = longSource(SLICE_LINES * 3 + 7);
    const html = await highlightInSlices(source, "typescript", "dark");
    expect(html).toBe(reference.codeToHtml(source, { lang: "typescript", theme: "github-dark" }));
    expect(highlighter().codeToHast).toHaveBeenCalledTimes(4);
    const sliceSizes = vi.mocked(highlighter().codeToHast).mock.calls.map(([code]) => code.split("\n").length);
    expect(sliceSizes).toEqual([SLICE_LINES, SLICE_LINES, SLICE_LINES, 7]);
  });

  it("uses the theme it is asked for", async () => {
    const source = longSource(SLICE_LINES + 1);
    expect(await highlightInSlices(source, "typescript", "hc-light")).toBe(
      reference.codeToHtml(source, { lang: "typescript", theme: "light-plus" }),
    );
  });

  it("yields to the host before every slice, the first included", async () => {
    const source = longSource(SLICE_LINES * 2 + 1);
    const timeout = vi.spyOn(globalThis, "setTimeout");
    const render = highlightInSlices(source, "typescript", "dark");
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
    expect(highlighter().codeToHast).not.toHaveBeenCalled();
    await render;
    expect(timeout.mock.calls.filter(([, delay]) => delay === 0)).toHaveLength(3);
  });

  it("remembers a finished render, per theme", async () => {
    const source = longSource(SLICE_LINES + 1);
    const first = await highlightInSlices(source, "typescript", "dark");
    expect(await highlightInSlices(source, "typescript", "dark")).toBe(first);
    expect(highlighter().codeToHast).toHaveBeenCalledTimes(2);
    await highlightInSlices(source, "typescript", "light");
    expect(highlighter().codeToHast).toHaveBeenCalledTimes(4);
  });

  it("shares a render in progress with a second request for it", async () => {
    const source = longSource(SLICE_LINES + 1);
    const [a, b] = await Promise.all([
      highlightInSlices(source, "typescript", "dark"),
      highlightInSlices(source, "typescript", "dark"),
    ]);
    expect(a).toBe(b);
    expect(highlighter().codeToHast).toHaveBeenCalledTimes(2);
  });

  it("starts a new render once the shared one has finished and been forgotten", async () => {
    const source = longSource(SLICE_LINES + 1);
    await highlightInSlices(source, "typescript", "dark");
    for (let i = 0; i < MAX_REMEMBERED_RENDERS; i++) {
      createSyntaxRenderer({ getTheme: () => "dark" }).renderHtml(`const n = ${i};`, "typescript");
    }
    await highlightInSlices(source, "typescript", "dark");
    expect(highlighter().codeToHast).toHaveBeenCalledTimes(4);
  });

  it("forgets the least recently used render past its bound", () => {
    const renderer = createSyntaxRenderer({ getTheme: () => "dark" });
    for (let i = 0; i <= MAX_REMEMBERED_RENDERS; i++) {
      renderer.renderHtml(`const n = ${i};`, "typescript");
    }
    renderer.renderHtml("const n = 1;", "typescript"); // still remembered: now the most recent
    renderer.renderHtml("const n = 0;", "typescript"); // dropped when the bound was passed
    expect(highlighter().codeToHtml).toHaveBeenCalledTimes(MAX_REMEMBERED_RENDERS + 2);
    renderer.renderHtml("const n = 1;", "typescript");
    expect(highlighter().codeToHtml).toHaveBeenCalledTimes(MAX_REMEMBERED_RENDERS + 2);
  });

  it("remembers a render made at once, and finds it for a sliced request", async () => {
    const renderer = createSyntaxRenderer({ getTheme: () => "dark" });
    const html = renderer.renderHtml("const x = 1;", "typescript");
    expect(renderer.renderHtml("const x = 1;", "typescript")).toBe(html);
    expect(await highlightInSlices("const x = 1;", "typescript", "dark")).toBe(html);
    expect(highlighter().codeToHtml).toHaveBeenCalledOnce();
    expect(highlighter().codeToHast).not.toHaveBeenCalled();
  });

  it("answers null for a language it has no grammar for, loading nothing", async () => {
    __setHighlighterForTests(null); // the bundle stays on the page: loading would succeed
    expect(await highlightInSlices("x", "brainfuck", "dark")).toBeNull();
    expect(isHighlighterReady()).toBe(false);
  });

  it("remembers a render per language", async () => {
    const renderer = createSyntaxRenderer({ getTheme: () => "dark" });
    const source = "def f(): return 1";
    expect(renderer.renderHtml(source, "python")).toBe(
      reference.codeToHtml(source, { lang: "python", theme: "github-dark" }),
    );
    expect(renderer.renderHtml(source, "typescript")).toBe(
      reference.codeToHtml(source, { lang: "typescript", theme: "github-dark" }),
    );
  });

  it("answers null, and remembers nothing, when a slice fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const source = longSource(SLICE_LINES + 1);
    vi.mocked(highlighter().codeToHast).mockImplementationOnce(() => {
      throw new Error("boom");
    });
    expect(await highlightInSlices(source, "typescript", "dark")).toBeNull();
    expect(warn).toHaveBeenCalledWith("[Portaterm] Shiki render failed:", expect.any(Error));
    expect(await highlightInSlices(source, "typescript", "dark")).toBe(
      reference.codeToHtml(source, { lang: "typescript", theme: "github-dark" }),
    );
  });

  it("answers null when Shiki cannot be loaded, without trying to render", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    __setHighlighterForTests(null);
    __setHostScriptForTests(null);
    delete (globalThis as Record<string, unknown>)[SHIKI_GLOBAL_KEY];
    expect(await highlightInSlices("x", "typescript", "dark")).toBeNull();
    expect(warn).not.toHaveBeenCalledWith("[Portaterm] Shiki render failed:", expect.anything());
  });

  describe("renderLive", () => {
    const renderer = () => createSyntaxRenderer({ getTheme: () => "dark" });
    const mount = (el: HTMLElement) => document.body.appendChild(el);

    afterEach(() => {
      document.body.innerHTML = "";
    });

    it("shows short content highlighted at once, slicing nothing", async () => {
      const source = sourceOfLength(SYNC_HIGHLIGHT_CHARS);
      expect(source.length).toBe(SYNC_HIGHLIGHT_CHARS);
      const onHighlighted = vi.fn();
      const el = mount(renderer().renderLive(source, "typescript", "dark", onHighlighted));
      expect(el.className).toBe("anywhere-hover-preview-code");
      expect(el.innerHTML).toBe(reference.codeToHtml(source, { lang: "typescript", theme: "github-dark" }));
      await settle();
      expect(highlighter().codeToHast).not.toHaveBeenCalled();
      expect(onHighlighted).not.toHaveBeenCalled();
    });

    it("shows longer content as plain lines, then swaps in the highlighted HTML", async () => {
      const source = sourceOfLength(SYNC_HIGHLIGHT_CHARS + 1);
      expect(source.length).toBe(SYNC_HIGHLIGHT_CHARS + 1);
      const onHighlighted = vi.fn(() => expect(el.querySelector("pre.shiki")).not.toBeNull());
      const el = mount(renderer().renderLive(source, "typescript", "dark", onHighlighted));
      expect(el.querySelector("pre.anywhere-hover-preview-plain")).not.toBeNull();
      expect(Array.from(el.querySelectorAll(".line"), (line) => line.textContent)).toEqual(source.split("\n"));
      expect(highlighter().codeToHtml).not.toHaveBeenCalled();
      await settle();
      expect(el.innerHTML).toBe(reference.codeToHtml(source, { lang: "typescript", theme: "github-dark" }));
      expect(onHighlighted).toHaveBeenCalledOnce();
    });

    it("shows a remembered long render at once, asked for by an alias", async () => {
      const source = longSource(SLICE_LINES * 4);
      await highlightInSlices(source, "typescript", "dark");
      const el = mount(renderer().renderLive(source, "ts", "dark"));
      expect(el.querySelector("pre.shiki")).not.toBeNull();
    });

    it("shows a remembered long render at once", async () => {
      const source = longSource(SLICE_LINES * 4);
      await highlightInSlices(source, "typescript", "dark");
      const el = mount(renderer().renderLive(source, "typescript", "dark"));
      expect(el.querySelector("pre.shiki")).not.toBeNull();
    });

    it("leaves an element taken off the page alone", async () => {
      const source = longSource(SLICE_LINES * 4);
      const onHighlighted = vi.fn();
      const el = mount(renderer().renderLive(source, "typescript", "dark", onHighlighted));
      el.remove();
      await settle();
      expect(el.querySelector("pre.shiki")).toBeNull();
      expect(onHighlighted).not.toHaveBeenCalled();
      // The work is kept: hovering the file again shows it highlighted at once.
      expect(mount(renderer().renderLive(source, "typescript", "dark")).querySelector("pre.shiki")).not.toBeNull();
    });

    it("survives a re-mark that throws", async () => {
      const el = mount(
        renderer().renderLive(longSource(SLICE_LINES * 4), "typescript", "dark", () => {
          throw new Error("re-mark failed");
        }),
      );
      await settle();
      expect(el.querySelector("pre.shiki")).not.toBeNull();
    });

    it("keeps the plain lines when Shiki cannot be loaded", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      __setHighlighterForTests(null);
      (globalThis as Record<string, unknown>)[SHIKI_GLOBAL_KEY] = {
        ...shikiBundle,
        createHighlighter: () => Promise.reject(new Error("no wasm today")),
      } satisfies ShikiBundle;
      const onHighlighted = vi.fn();
      const el = mount(renderer().renderLive("const a = 1;", "typescript", "dark", onHighlighted));
      await settle();
      expect(el.querySelectorAll("pre.anywhere-hover-preview-plain .line")).toHaveLength(1);
      expect(onHighlighted).not.toHaveBeenCalled();
    });

    it("shows a language it has no grammar for as plain lines, for good", async () => {
      const el = mount(renderer().renderLive("a <b>\nc", "brainfuck", "dark", vi.fn()));
      expect(el.innerHTML).toBe(
        '<pre class="anywhere-hover-preview-plain"><code><span class="line">a &lt;b&gt;</span>\n<span class="line">c</span></code></pre>',
      );
      await settle();
      expect(el.querySelector("pre.shiki")).toBeNull();
    });

    it("waits for Shiki to load, then highlights", async () => {
      __setHighlighterForTests(null);
      watched = watchedBundle();
      (globalThis as Record<string, unknown>)[SHIKI_GLOBAL_KEY] = watched.bundle;
      const onHighlighted = vi.fn();
      const el = mount(renderer().renderLive("const a = 1;", "typescript", "dark", onHighlighted));
      expect(el.querySelector("pre.anywhere-hover-preview-plain")).not.toBeNull();
      await settle();
      expect(el.querySelector("pre.shiki")).not.toBeNull();
      expect(onHighlighted).toHaveBeenCalledOnce();
    });
  });
});
