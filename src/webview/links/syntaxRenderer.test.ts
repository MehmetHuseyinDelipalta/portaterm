// @vitest-environment jsdom
// src/webview/links/syntaxRenderer.test.ts — Curated language set + static-import
// audit + plain-text fallback. See: design.md D1, D11.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shikiBundle } from "./shikiBundle";
import { SHIKI_GLOBAL } from "./shikiGlobal";
import {
  __setHighlighterForTests,
  __setHostScriptForTests,
  createSyntaxRenderer,
  isHighlighterReady,
  preloadSyntaxHighlighter,
  SUPPORTED_LANGUAGES,
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
