// @vitest-environment jsdom
// src/webview/terminal/TerminalFactory.fitTerminals.test.ts — a split's panes are
// all measured before any is resized, so no resize forces the layout to be
// computed again for the next measurement (perf D7).

import type { Terminal } from "@xterm/xterm";
import { describe, expect, it, vi } from "vitest";
import { TerminalFactory } from "./TerminalFactory";

/** A pane whose layout reads and resizes are logged, sized 10×20 per cell in a 200×400 box. */
function pane(id: string, log: string[], parented = true) {
  const parent = document.createElement("div");
  const element = document.createElement("div");
  if (parented) {
    parent.appendChild(element);
  }
  parent.getBoundingClientRect = () => {
    log.push(`measure ${id}`);
    return { width: 200, height: 400 } as DOMRect;
  };
  const terminal = {
    element,
    cols: 0,
    rows: 0,
    _core: { _renderService: { dimensions: { css: { cell: { width: 10, height: 20 } } }, clear: vi.fn() } },
    resize: vi.fn((cols: number, rows: number) => log.push(`resize ${id} ${cols}x${rows}`)),
  };
  return { terminal: terminal as unknown as Terminal, container: document.createElement("div") };
}

const fitTerminals = (instances: ReturnType<typeof pane>[]) =>
  TerminalFactory.prototype.fitTerminals.call({} as TerminalFactory, instances);

describe("TerminalFactory.fitTerminals", () => {
  it("measures every pane before resizing any", () => {
    const log: string[] = [];
    fitTerminals([pane("a", log), pane("b", log), pane("c", log)]);
    expect(log).toEqual(["measure a", "measure b", "measure c", "resize a 20x20", "resize b 20x20", "resize c 20x20"]);
  });

  it("skips a pane that is not attached, and one already the right size", () => {
    const log: string[] = [];
    const sized = pane("sized", log);
    (sized.terminal as unknown as { cols: number; rows: number }).cols = 20;
    (sized.terminal as unknown as { cols: number; rows: number }).rows = 20;
    fitTerminals([pane("loose", log, false), sized, pane("b", log)]);
    expect(log).toEqual(["measure sized", "measure b", "resize b 20x20"]);
  });

  it("fits a single terminal the same way", () => {
    const log: string[] = [];
    TerminalFactory.prototype.fitTerminal.call(
      { fitTerminals: TerminalFactory.prototype.fitTerminals } as unknown as TerminalFactory,
      pane("only", log),
    );
    expect(log).toEqual(["measure only", "resize only 20x20"]);
  });

  it("fits a switched-to tab's panes together, then focuses its active pane", () => {
    const log: string[] = [];
    const a = pane("a", log);
    const b = pane("b", log);
    (b.terminal as unknown as { focus: () => void }).focus = vi.fn();
    const fitTerminalsSpy = vi.fn();
    const self = {
      store: {
        tabLayouts: new Map([
          [
            "tab",
            {
              type: "branch",
              direction: "vertical",
              children: [
                { type: "leaf", sessionId: "a" },
                { type: "leaf", sessionId: "b" },
              ],
              ratio: 0.5,
            },
          ],
        ]),
        terminals: new Map([
          ["a", a],
          ["b", b],
        ]),
        tabActivePaneIds: new Map([["tab", "b"]]),
      },
      fitTerminals: fitTerminalsSpy,
    };
    TerminalFactory.prototype.fitAllAndFocus.call(self as unknown as TerminalFactory, "tab", a as never);
    expect(fitTerminalsSpy.mock.calls).toEqual([[[a, b]]]);
    expect((b.terminal as unknown as { focus: ReturnType<typeof vi.fn> }).focus).toHaveBeenCalled();
  });

  it("fits the given terminal when the tab has no split", () => {
    const log: string[] = [];
    const solo = pane("solo", log);
    (solo.terminal as unknown as { focus: () => void }).focus = vi.fn();
    const fitTerminalsSpy = vi.fn();
    const self = {
      store: { tabLayouts: new Map(), terminals: new Map([["solo", solo]]), tabActivePaneIds: new Map() },
      fitTerminals: fitTerminalsSpy,
    };
    TerminalFactory.prototype.fitAllAndFocus.call(self as unknown as TerminalFactory, "solo", solo as never);
    expect(fitTerminalsSpy.mock.calls).toEqual([[[solo]]]);
  });
});
