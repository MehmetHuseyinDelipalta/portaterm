// @vitest-environment jsdom
// src/webview/links/markdownRenderer.memory.test.ts — One MarkdownIt per theme,
// and finished renders remembered (perf D1). markdown-it is real but counted;
// the code highlighter is a stand-in whose readiness each test sets.

import { beforeEach, describe, expect, it, vi } from "vitest";

const counts = vi.hoisted(() => ({ built: 0, rendered: 0, ready: true }));

vi.mock("markdown-it", async (importOriginal) => {
  const Actual = ((await importOriginal()) as { default: new (...args: unknown[]) => { render(s: string): string } })
    .default;
  class Counted extends Actual {
    constructor(...args: unknown[]) {
      super(...args);
      counts.built++;
    }
    override render(src: string): string {
      counts.rendered++;
      return super.render(src);
    }
  }
  return { default: Counted };
});

vi.mock("./syntaxRenderer", () => ({
  isHighlighterReady: () => counts.ready,
  renderHtml: vi.fn((code: string, lang: string, theme: string) => `<pre data-theme="${theme}">${lang}:${code}</pre>`),
}));

type Module = typeof import("./markdownRenderer");
let renderMarkdownElement: Module["renderMarkdownElement"];
let MAX_REMEMBERED_MARKDOWN: number;

beforeEach(async () => {
  counts.built = 0;
  counts.rendered = 0;
  counts.ready = true;
  vi.resetModules();
  ({ renderMarkdownElement, MAX_REMEMBERED_MARKDOWN } = await import("./markdownRenderer"));
});

describe("markdownRenderer — instances and remembered renders", () => {
  it("builds one MarkdownIt per theme, not one per render", () => {
    renderMarkdownElement("# a", "dark");
    renderMarkdownElement("# b", "dark");
    renderMarkdownElement("# c", "light");
    renderMarkdownElement("# d", "light");
    expect(counts.built).toBe(2);
  });

  it("keeps each theme's code blocks in that theme", () => {
    const fence = "```ts\nconst x = 1;\n```";
    expect(renderMarkdownElement(fence, "dark").querySelector("pre")?.dataset.theme).toBe("dark");
    expect(renderMarkdownElement(fence, "hc-light").querySelector("pre")?.dataset.theme).toBe("hc-light");
    expect(renderMarkdownElement(`${fence}\n`, "dark").querySelector("pre")?.dataset.theme).toBe("dark");
  });

  it("renders the same content in the same theme once", () => {
    const first = renderMarkdownElement("# same", "dark");
    const second = renderMarkdownElement("# same", "dark");
    expect(second.innerHTML).toBe(first.innerHTML);
    expect(second).not.toBe(first);
    expect(second.className).toBe("anywhere-hover-preview-md");
    expect(counts.rendered).toBe(1);
    renderMarkdownElement("# same", "light");
    expect(counts.rendered).toBe(2);
  });

  it("does not remember a render made before the code highlighter was ready", () => {
    counts.ready = false;
    renderMarkdownElement("# early", "dark");
    renderMarkdownElement("# early", "dark");
    expect(counts.rendered).toBe(2);
    counts.ready = true;
    renderMarkdownElement("# early", "dark");
    renderMarkdownElement("# early", "dark");
    expect(counts.rendered).toBe(3);
  });

  it("forgets the least recently used render past its bound", () => {
    for (let i = 0; i <= MAX_REMEMBERED_MARKDOWN; i++) {
      renderMarkdownElement(`# ${i}`, "dark");
    }
    expect(counts.rendered).toBe(MAX_REMEMBERED_MARKDOWN + 1);
    renderMarkdownElement("# 1", "dark"); // still remembered: now the most recent
    expect(counts.rendered).toBe(MAX_REMEMBERED_MARKDOWN + 1);
    renderMarkdownElement("# 0", "dark"); // dropped when the bound was passed
    expect(counts.rendered).toBe(MAX_REMEMBERED_MARKDOWN + 2);
    renderMarkdownElement("# 1", "dark");
    expect(counts.rendered).toBe(MAX_REMEMBERED_MARKDOWN + 2);
  });

  it("remembers eight renders", () => {
    expect(MAX_REMEMBERED_MARKDOWN).toBe(8);
  });
});
