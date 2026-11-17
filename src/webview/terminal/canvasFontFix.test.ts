// src/webview/terminal/canvasFontFix.test.ts — on a Chromium whose canvas rejects a
// font with leading whitespace (Electron 43.8.9 / 45.2.3, xterm.js#6297), every 2D
// context trims that whitespace before the native setter sees it, so the WebGL
// glyph atlas draws at the configured size instead of 10px sans-serif.

import { describe, expect, it } from "vitest";
import { ensureCanvasFontLeadingWhitespaceFix } from "./canvasFontFix";

const DEFAULT_FONT = "10px sans-serif";

/**
 * A 2D context class whose `font` accessor parses like the affected Chromium:
 * a value starting with whitespace (`broken`) or an empty one is rejected and the
 * previous font stays; anything else is taken as given.
 */
function contextClass(broken: boolean) {
  const assigned: unknown[] = [];
  class Ctx {
    private current = DEFAULT_FONT;
    get font(): string {
      return this.current;
    }
    set font(value: string) {
      assigned.push(value);
      if (typeof value !== "string" || value === "" || (broken && /^\s/.test(value))) {
        return;
      }
      this.current = value;
    }
  }
  return { Ctx, assigned };
}

/** A window whose canvas hands out a `Canvas2D` context, with an optional offscreen class. */
function fakeWindow(opts: { broken: boolean; offscreen?: boolean; noContext?: boolean }) {
  const onscreen = contextClass(opts.broken);
  const offscreen = contextClass(opts.broken);
  let probes = 0;
  const win = {
    CanvasRenderingContext2D: onscreen.Ctx,
    OffscreenCanvasRenderingContext2D: opts.offscreen === false ? undefined : offscreen.Ctx,
    document: {
      createElement: () => ({
        getContext: () => {
          probes++;
          return opts.noContext ? null : new onscreen.Ctx();
        },
      }),
    },
  };
  return {
    win: win as unknown as Window,
    onscreen,
    offscreen,
    probes: () => probes,
    fontDescriptor: () => Object.getOwnPropertyDescriptor(onscreen.Ctx.prototype, "font"),
  };
}

describe("ensureCanvasFontLeadingWhitespaceFix", () => {
  it("trims leading whitespace on both context kinds when the canvas rejects it", () => {
    const f = fakeWindow({ broken: true });
    ensureCanvasFontLeadingWhitespaceFix(f.win);

    const ctx = new f.onscreen.Ctx();
    ctx.font = " normal 14px Menlo, monospace";
    expect(ctx.font).toBe("normal 14px Menlo, monospace");

    const off = new f.offscreen.Ctx();
    off.font = " bold 28px Menlo";
    expect(off.font).toBe("bold 28px Menlo");
  });

  it("trims every CSS whitespace kind, and leaves whitespace inside the value alone", () => {
    const f = fakeWindow({ broken: true });
    ensureCanvasFontLeadingWhitespaceFix(f.win);
    const ctx = new f.onscreen.Ctx();
    ctx.font = " \t\r\n\f14px 'Fira Code', monospace ";
    expect(ctx.font).toBe("14px 'Fira Code', monospace ");
  });

  it("passes a value without leading whitespace, an empty one, and a non-string through unchanged", () => {
    const f = fakeWindow({ broken: true });
    ensureCanvasFontLeadingWhitespaceFix(f.win);
    const ctx = new f.onscreen.Ctx();
    f.onscreen.assigned.length = 0;
    ctx.font = "14px Menlo";
    ctx.font = "";
    (ctx as unknown as { font: unknown }).font = 42;
    expect(f.onscreen.assigned).toEqual(["14px Menlo", "", 42]);
    expect(ctx.font).toBe("14px Menlo");
  });

  it("keeps the getter and the property's attributes", () => {
    const f = fakeWindow({ broken: true });
    const before = f.fontDescriptor();
    ensureCanvasFontLeadingWhitespaceFix(f.win);
    const after = f.fontDescriptor();
    expect(after?.get).toBe(before?.get);
    expect(after?.set).not.toBe(before?.set);
    expect({ enumerable: after?.enumerable, configurable: after?.configurable }).toEqual({
      enumerable: before?.enumerable,
      configurable: before?.configurable,
    });
  });

  it("leaves a canvas that accepts leading whitespace untouched", () => {
    const f = fakeWindow({ broken: false });
    const before = f.fontDescriptor();
    const offscreenBefore = Object.getOwnPropertyDescriptor(f.offscreen.Ctx.prototype, "font");
    ensureCanvasFontLeadingWhitespaceFix(f.win);
    expect(f.fontDescriptor()).toEqual(before);
    expect(Object.getOwnPropertyDescriptor(f.offscreen.Ctx.prototype, "font")).toEqual(offscreenBefore);
    const off = new f.offscreen.Ctx();
    f.offscreen.assigned.length = 0;
    off.font = " 14px Menlo";
    expect(f.offscreen.assigned).toEqual([" 14px Menlo"]);
  });

  it("patches once and probes once per window, however often it is called", () => {
    const f = fakeWindow({ broken: true });
    ensureCanvasFontLeadingWhitespaceFix(f.win);
    const firstSetter = f.fontDescriptor()?.set;
    ensureCanvasFontLeadingWhitespaceFix(f.win);
    ensureCanvasFontLeadingWhitespaceFix(f.win);
    expect(f.fontDescriptor()?.set).toBe(firstSetter);
    expect(f.probes()).toBe(1);

    const ctx = new f.onscreen.Ctx();
    f.onscreen.assigned.length = 0;
    ctx.font = " 14px Menlo";
    expect(f.onscreen.assigned).toEqual(["14px Menlo"]);
  });

  it("probes a healthy window once too", () => {
    const f = fakeWindow({ broken: false });
    ensureCanvasFontLeadingWhitespaceFix(f.win);
    ensureCanvasFontLeadingWhitespaceFix(f.win);
    expect(f.probes()).toBe(1);
  });

  it("still patches the on-screen context when there is no OffscreenCanvasRenderingContext2D", () => {
    const f = fakeWindow({ broken: true, offscreen: false });
    ensureCanvasFontLeadingWhitespaceFix(f.win);
    const ctx = new f.onscreen.Ctx();
    ctx.font = " 14px Menlo";
    expect(ctx.font).toBe("14px Menlo");
  });

  it("skips a context class whose font has no setter, and patches the rest", () => {
    const f = fakeWindow({ broken: true });
    Object.defineProperty(f.offscreen.Ctx.prototype, "font", {
      get: () => DEFAULT_FONT,
      set: undefined,
      configurable: true,
    });
    ensureCanvasFontLeadingWhitespaceFix(f.win);
    expect(Object.getOwnPropertyDescriptor(f.offscreen.Ctx.prototype, "font")?.set).toBeUndefined();
    const ctx = new f.onscreen.Ctx();
    ctx.font = " 14px Menlo";
    expect(ctx.font).toBe("14px Menlo");
  });

  it("does nothing when the probe gets no 2D context", () => {
    const f = fakeWindow({ broken: true, noContext: true });
    const before = f.fontDescriptor();
    expect(() => ensureCanvasFontLeadingWhitespaceFix(f.win)).not.toThrow();
    expect(f.fontDescriptor()).toEqual(before);
  });
});
