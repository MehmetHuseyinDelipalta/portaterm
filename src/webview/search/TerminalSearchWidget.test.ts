// src/webview/search/TerminalSearchWidget.test.ts — Unit tests for the terminal find widget.

// @vitest-environment jsdom

import type { ISearchOptions, ISearchResultChangeEvent } from "@xterm/addon-search";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isFindStepShortcut, type SearchTarget, TerminalSearchWidget } from "./TerminalSearchWidget";

// ─── Helpers ────────────────────────────────────────────────────────

interface FakeTarget extends SearchTarget {
  emit(e: ISearchResultChangeEvent): void;
  findNext: ReturnType<typeof vi.fn>;
  findPrevious: ReturnType<typeof vi.fn>;
  clearDecorations: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  selection: string;
}

function fakeTarget(id: string): FakeTarget {
  const listeners = new Set<(e: ISearchResultChangeEvent) => void>();
  const findNext = vi.fn((_term: string, _options?: ISearchOptions) => true);
  const findPrevious = vi.fn((_term: string, _options?: ISearchOptions) => true);
  const clearDecorations = vi.fn();
  const focus = vi.fn();
  const target: FakeTarget = {
    id,
    selection: "",
    terminal: {
      focus,
      hasSelection: () => target.selection.length > 0,
      getSelection: () => target.selection,
    },
    searchAddon: {
      findNext,
      findPrevious,
      clearDecorations,
      onDidChangeResults: (listener) => {
        listeners.add(listener);
        return { dispose: () => listeners.delete(listener) };
      },
    },
    emit: (e) => {
      for (const listener of listeners) {
        listener(e);
      }
    },
    findNext,
    findPrevious,
    clearDecorations,
    focus,
  };
  return target;
}

let host: HTMLDivElement;
let current: FakeTarget | undefined;
let widget: TerminalSearchWidget;

function input(): HTMLInputElement {
  return host.querySelector(".terminal-search-input") as HTMLInputElement;
}

function count(): string {
  return (host.querySelector(".terminal-search-count") as HTMLElement).textContent ?? "";
}

function type(value: string): void {
  input().value = value;
  input().dispatchEvent(new Event("input"));
}

function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  input().dispatchEvent(event);
  return event;
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  current = fakeTarget("a");
  widget = new TerminalSearchWidget({ host, getTarget: () => current, getThemeKind: () => "dark" });
});

afterEach(() => {
  widget.dispose();
  host.remove();
});

// ─── Tests ──────────────────────────────────────────────────────────

describe("TerminalSearchWidget", () => {
  it("opens focused and searches incrementally as the user types", () => {
    widget.open();
    expect(widget.isOpen).toBe(true);
    expect(document.activeElement).toBe(input());

    type("err");
    expect(current?.findNext).toHaveBeenLastCalledWith(
      "err",
      expect.objectContaining({ incremental: true, regex: false, caseSensitive: false, wholeWord: false }),
    );
    // Highlighting is what makes every match visible, not just the active one.
    expect(current?.findNext.mock.lastCall?.[1]?.decorations?.matchOverviewRuler).toBeTruthy();
  });

  it("does nothing when no terminal is active", () => {
    current = undefined;
    widget.open();
    expect(widget.isOpen).toBe(false);
  });

  it("seeds the query from a single-line selection only", () => {
    if (!current) {
      throw new Error("no target");
    }
    current.selection = "needle";
    widget.open();
    expect(input().value).toBe("needle");
    expect(current.findNext).toHaveBeenCalledWith("needle", expect.anything());

    widget.close();
    current.selection = "two\nlines";
    widget.open();
    expect(input().value).toBe("needle");
  });

  it("Enter steps forward, Shift+Enter backward, without incremental mode", () => {
    widget.open();
    type("x");
    press("Enter");
    expect(current?.findNext).toHaveBeenLastCalledWith("x", expect.objectContaining({ incremental: false }));
    press("Enter", { shiftKey: true });
    expect(current?.findPrevious).toHaveBeenLastCalledWith("x", expect.objectContaining({ incremental: false }));
  });

  it("renders the result counter from the addon's events", () => {
    widget.open();
    type("x");
    current?.emit({ resultIndex: 2, resultCount: 17 });
    expect(count()).toBe("3 of 17");
    current?.emit({ resultIndex: -1, resultCount: 1000 });
    expect(count()).toBe("1000+ results");
    current?.emit({ resultIndex: -1, resultCount: 0 });
    expect(count()).toBe("No results");
  });

  it("toggles regex with Alt+R and passes it through", () => {
    widget.open();
    type("a.c");
    press("®", { code: "KeyR", altKey: true });
    expect(current?.findNext).toHaveBeenLastCalledWith("a.c", expect.objectContaining({ regex: true }));
    const toggle = host.querySelector(".terminal-search-toggle-regex") as HTMLElement;
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
  });

  it("flags an invalid regex instead of searching", () => {
    widget.open();
    (host.querySelector(".terminal-search-toggle-regex") as HTMLButtonElement).click();
    current?.findNext.mockClear();
    type("(unclosed");
    expect(current?.findNext).not.toHaveBeenCalled();
    expect(input().getAttribute("aria-invalid")).toBe("true");
    expect(count()).toBe("Invalid regex");

    type("(closed)");
    expect(input().getAttribute("aria-invalid")).toBe("false");
    expect(current?.findNext).toHaveBeenCalled();
  });

  it("Escape closes, clears highlights, and refocuses the terminal", () => {
    widget.open();
    type("x");
    const event = press("Escape");
    expect(event.defaultPrevented).toBe(true);
    expect(widget.isOpen).toBe(false);
    expect(current?.clearDecorations).toHaveBeenCalled();
    expect(current?.focus).toHaveBeenCalled();
  });

  it("follows the active pane on sync, clearing the old pane's highlights", () => {
    const first = current as FakeTarget;
    widget.open();
    type("x");
    const second = fakeTarget("b");
    current = second;
    widget.sync();
    expect(first.clearDecorations).toHaveBeenCalled();
    expect(second.findNext).toHaveBeenCalledWith("x", expect.anything());

    // The old pane's events no longer drive the counter.
    first.emit({ resultIndex: 0, resultCount: 99 });
    second.emit({ resultIndex: 0, resultCount: 2 });
    expect(count()).toBe("1 of 2");
  });

  it("contains() recognises its own nodes only", () => {
    widget.open();
    expect(widget.contains(input())).toBe(true);
    expect(widget.contains(document.body)).toBe(false);
    expect(widget.contains(null)).toBe(false);
  });
});

describe("isFindStepShortcut", () => {
  const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

  it("is Cmd+G on macOS", () => {
    expect(isFindStepShortcut(key({ key: "g", metaKey: true }), true)).toBe(true);
    expect(isFindStepShortcut(key({ key: "G", metaKey: true, shiftKey: true }), true)).toBe(true);
    expect(isFindStepShortcut(key({ key: "g", ctrlKey: true }), true)).toBe(false);
  });

  it("is F3 elsewhere, never Ctrl+G (the shell's abort)", () => {
    expect(isFindStepShortcut(key({ key: "F3" }), false)).toBe(true);
    expect(isFindStepShortcut(key({ key: "F3", shiftKey: true }), false)).toBe(true);
    expect(isFindStepShortcut(key({ key: "g", ctrlKey: true }), false)).toBe(false);
  });
});
