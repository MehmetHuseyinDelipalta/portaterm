import { afterEach, describe, expect, it, vi } from "vitest";
import { isUserInput, type SurfaceSignalListener, setSurfaceSignalListener, signalPaneInput } from "./surfaceSignals";

describe("isUserInput", () => {
  it.each([
    ["focus in", "\x1b[I"],
    ["focus out", "\x1b[O"],
    ["SGR mouse press", "\x1b[<0;12;5M"],
    ["X10 mouse", "\x1b[M #!"],
    ["cursor position report", "\x1b[12;40R"],
    ["primary device attributes", "\x1b[?1;2c"],
    ["secondary device attributes", "\x1b[>0;276;0c"],
    ["mode report", "\x1b[?2026;2$y"],
    ["OSC color reply", "\x1b]11;rgb:1e1e/1e1e/1e1e\x1b\\"],
    ["OSC reply ended by BEL", "\x1b]10;rgb:cccc/cccc/cccc\x07"],
    ["DCS reply", "\x1bP1$r0m\x1b\\"],
    ["several reports at once", "\x1b[I\x1b[12;40R"],
  ])("does not count a %s", (_name, data) => {
    expect(isUserInput(data)).toBe(false);
  });

  it.each([
    ["a letter", "y"],
    ["Enter", "\r"],
    ["an arrow key", "\x1b[B"],
    ["Escape", "\x1b"],
    ["a key that follows a focus report", "\x1b[I1"],
  ])("counts %s", (_name, data) => {
    expect(isUserInput(data)).toBe(true);
  });
});

describe("signalPaneInput", () => {
  afterEach(() => setSurfaceSignalListener(undefined));

  it("tells the listener about typing, not about a focus report", () => {
    const paneInput = vi.fn();
    setSurfaceSignalListener({ displayChanged: vi.fn(), paneInput, surfaceReady: vi.fn() } as SurfaceSignalListener);
    signalPaneInput("a", "\x1b[I");
    expect(paneInput).not.toHaveBeenCalled();
    signalPaneInput("a", "1");
    expect(paneInput).toHaveBeenCalledWith("a");
  });
});
