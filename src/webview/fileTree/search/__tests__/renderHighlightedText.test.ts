// src/webview/fileTree/search/__tests__/renderHighlightedText.test.ts —
// Unit tests for the inline highlight renderer used in flat-list rows.

// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { FILE_TREE_SEARCH_MATCH_CLASS, renderHighlightedText } from "../renderHighlightedText";

function makeContainer(): HTMLElement {
  return document.createElement("div");
}

function structure(el: HTMLElement): Array<{ kind: "text" | "match"; text: string }> {
  return Array.from(el.childNodes).map((n) => {
    if (n.nodeType === Node.TEXT_NODE) {
      return { kind: "text" as const, text: n.textContent ?? "" };
    }
    return { kind: "match" as const, text: n.textContent ?? "" };
  });
}

describe("renderHighlightedText", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders one text node when matches is undefined", () => {
    const el = makeContainer();
    renderHighlightedText(el, "FileTreePanel.ts", undefined);
    expect(structure(el)).toEqual([{ kind: "text", text: "FileTreePanel.ts" }]);
  });

  it("wraps matched ranges in highlight spans, interleaved with text nodes", () => {
    const el = makeContainer();
    renderHighlightedText(el, "FileTreePanel.ts", [
      { start: 0, end: 1 }, // F
      { start: 4, end: 6 }, // Tr
    ]);
    expect(structure(el)).toEqual([
      { kind: "match", text: "F" },
      { kind: "text", text: "ile" },
      { kind: "match", text: "Tr" },
      { kind: "text", text: "eePanel.ts" },
    ]);
    // Spans get the documented CSS class.
    const spans = Array.from(el.querySelectorAll("span"));
    expect(spans).toHaveLength(2);
    for (const s of spans) {
      expect(s.className).toBe(FILE_TREE_SEARCH_MATCH_CLASS);
    }
  });

  it("clamps out-of-range starts/ends", () => {
    const el = makeContainer();
    renderHighlightedText(el, "abc", [
      { start: 0, end: 100 }, // end past length → clamped to 3
    ]);
    expect(structure(el)).toEqual([{ kind: "match", text: "abc" }]);
  });

  it("skips zero-length and out-of-order overlapping ranges", () => {
    const el = makeContainer();
    renderHighlightedText(el, "abcdef", [
      { start: 0, end: 2 }, // ab
      { start: 1, end: 1 }, // empty
      { start: 0, end: 1 }, // overlaps with previous — skipped
      { start: 4, end: 6 }, // ef
    ]);
    expect(structure(el)).toEqual([
      { kind: "match", text: "ab" },
      { kind: "text", text: "cd" },
      { kind: "match", text: "ef" },
    ]);
  });

  it("preserves astral Unicode characters intact", () => {
    const el = makeContainer();
    renderHighlightedText(el, "😀本.md", [{ start: 0, end: 2 }]);
    expect(structure(el)).toEqual([
      { kind: "match", text: "😀" },
      { kind: "text", text: "本.md" },
    ]);
  });
});
