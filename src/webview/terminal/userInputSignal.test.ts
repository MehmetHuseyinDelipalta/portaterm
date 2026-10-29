// @vitest-environment jsdom
// src/webview/terminal/userInputSignal.test.ts — typed input vs. xterm's own replies.
//
// Run against the real xterm, not a stand-in: the signal leans on a private
// event, and the test that matters most is the one that fails when an xterm
// upgrade removes it.

import { Terminal } from "@xterm/xterm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { trackUserInput } from "./userInputSignal";

let terminal: Terminal;
let container: HTMLDivElement;
let chunks: Array<{ data: string; typed: boolean }>;

function writeAndFlush(data: string): Promise<void> {
  return new Promise((resolve) => terminal.write(data, resolve));
}

function wire() {
  const signal = trackUserInput(terminal, container);
  terminal.onData((data) => chunks.push({ data, typed: signal.consume() }));
  return signal;
}

beforeEach(() => {
  terminal = new Terminal({ allowProposedApi: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  chunks = [];
});

afterEach(() => {
  terminal.dispose();
  container.remove();
  vi.restoreAllMocks();
});

describe("trackUserInput", () => {
  it("finds the private onUserInput event on this xterm", () => {
    // Guards an xterm upgrade: without it, broadcasting silently degrades.
    const core = (terminal as unknown as { _core?: { coreService?: { onUserInput?: unknown } } })._core;
    expect(typeof core?.coreService?.onUserInput).toBe("function");
  });

  it("classifies a chunk typed after a keyboard event as typed", () => {
    wire();
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "l" }));
    terminal.input("ls", true);
    expect(chunks).toEqual([{ data: "ls", typed: true }]);
  });

  it("classifies a paste as typed", () => {
    wire();
    container.dispatchEvent(new Event("paste"));
    terminal.input("echo hi", true);
    expect(chunks).toEqual([{ data: "echo hi", typed: true }]);
  });

  it("never classifies xterm's cursor-position report as typed", async () => {
    wire();
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await writeAndFlush("\x1b[6n");
    expect(chunks).toEqual([{ data: "\x1b[1;1R", typed: false }]);
  });

  it("never classifies a device-attributes reply as typed", async () => {
    wire();
    await writeAndFlush("\x1b[c");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.typed).toBe(false);
  });

  it("does not classify user input that followed a pointer event (mouse report, wheel)", () => {
    wire();
    container.dispatchEvent(new MouseEvent("mousedown"));
    terminal.input("\x1b[<0;3;4M", true);
    container.dispatchEvent(new WheelEvent("wheel"));
    terminal.input("\x1b[A", true);
    expect(chunks.map((c) => c.typed)).toEqual([false, false]);
  });

  it("returns to typed once a keyboard event follows the pointer", () => {
    wire();
    container.dispatchEvent(new MouseEvent("mousedown"));
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    terminal.input("a", true);
    expect(chunks).toEqual([{ data: "a", typed: true }]);
  });

  it("treats IME composition end as keyboard origin", () => {
    wire();
    container.dispatchEvent(new MouseEvent("mousedown"));
    container.dispatchEvent(new CompositionEvent("compositionend", { data: "ş" }));
    terminal.input("ş", true);
    expect(chunks).toEqual([{ data: "ş", typed: true }]);
  });

  it("judges each chunk on its own: a reply right after a typed chunk is not typed", async () => {
    wire();
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
    terminal.input("x", true);
    await writeAndFlush("\x1b[6n");
    expect(chunks.map((c) => c.typed)).toEqual([true, false]);
  });

  it("classifies nothing after dispose", () => {
    const signal = wire();
    signal.dispose();
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
    terminal.input("x", true);
    expect(chunks).toEqual([{ data: "x", typed: false }]);
  });

  it("degrades to never-typed, with a warning, when the private event is missing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fake = { _core: {} } as unknown as Terminal;
    const first = trackUserInput(fake, container);
    trackUserInput(fake, container);
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
    expect(first.consume()).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  describe("through xterm's own textarea handlers", () => {
    // The tests above flag input with `terminal.input`. These go the way a user
    // does: a DOM event on the textarea xterm opened, and xterm's own handler
    // turning it into data — the path the capture listener has to see first.
    function openTerminal(): HTMLTextAreaElement {
      window.matchMedia ??= ((query: string) => ({
        matches: false,
        media: query,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
      })) as never;
      vi.spyOn(console, "error").mockImplementation(() => {});
      terminal.open(container);
      const textarea = terminal.textarea;
      if (!textarea) {
        throw new Error("xterm opened no textarea");
      }
      return textarea;
    }

    it("classifies Enter pressed in the textarea as typed", () => {
      const textarea = openTerminal();
      wire();
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
      expect(chunks).toEqual([{ data: "\r", typed: true }]);
    });

    it("classifies a paste into the textarea as typed", () => {
      const textarea = openTerminal();
      wire();
      const paste = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(paste, "clipboardData", { value: { getData: () => "echo hi" } });
      textarea.dispatchEvent(paste);
      expect(chunks).toEqual([{ data: "echo hi", typed: true }]);
    });
  });
});
