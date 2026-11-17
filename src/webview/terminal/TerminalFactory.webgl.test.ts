// @vitest-environment jsdom
// src/webview/terminal/TerminalFactory.webgl.test.ts — every path that loads the
// WebGL renderer applies the canvas font fix to this window first, so the glyph
// atlas is never built while the canvas still rejects a font with leading
// whitespace (xterm.js#6297), and a failure turns WebGL off for later terminals.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalFactory, type TerminalFactoryDeps } from "./TerminalFactory";

const seen = vi.hoisted(() => ({
  log: [] as string[],
  fixTargets: [] as unknown[],
  fixThrows: false,
  contextLoss: [] as Array<() => void>,
  disposed: 0,
}));

const xterm = vi.hoisted(() => {
  class FakeTerminal {
    element = document.createElement("div");
    options: Record<string, unknown> = {};
    rows = 24;
    cols = 80;
    buffer = { active: { cursorY: 0, length: 0, getLine: () => undefined, viewportY: 0 } };
    parser = { registerOscHandler: () => ({ dispose: () => {} }) };
    _core = { coreService: { onUserInput: () => ({ dispose: () => {} }) } };
    loadAddon = (addon: unknown) => {
      if ((addon as { kind?: string }).kind === "webgl") {
        seen.log.push("loadAddon webgl");
      }
    };
    open = () => {
      seen.log.push("open");
    };
    focus = () => {};
    resize = () => {};
    write = () => {};
    dispose = () => {};
    attachCustomKeyEventHandler = () => {};
    registerLinkProvider = () => ({ dispose: () => {} });
    onData = () => ({ dispose: () => {} });
    onResize = () => ({ dispose: () => {} });
    onTitleChange = () => ({ dispose: () => {} });
  }
  return { FakeTerminal };
});

vi.mock("@xterm/xterm", () => ({ Terminal: xterm.FakeTerminal }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class {} }));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    kind = "webgl";
    constructor() {
      seen.log.push("new WebglAddon");
    }
    onContextLoss(listener: () => void) {
      seen.contextLoss.push(listener);
    }
    dispose() {
      seen.disposed++;
    }
  },
}));
vi.mock("./canvasFontFix", () => ({
  ensureCanvasFontLeadingWhitespaceFix: (target: unknown) => {
    seen.log.push("canvas font fix");
    seen.fixTargets.push(target);
    if (seen.fixThrows) {
      throw new Error("defineProperty refused");
    }
  },
}));

const CONFIG = { fontSize: 14, fontFamily: "monospace", cursorBlink: false, scrollback: 1000 };

function makeFactory(): TerminalFactory {
  const deps: TerminalFactoryDeps = {
    themeManager: { getTheme: () => ({}), getMinimumContrastRatio: () => 1 } as never,
    store: {
      terminals: new Map(),
      tabLayouts: new Map(),
      tabActivePaneIds: new Map(),
      activeTabId: null,
      currentConfig: CONFIG,
      persist: vi.fn(),
    } as never,
    postMessage: vi.fn(),
    onTabBarUpdate: vi.fn(),
    getIsComposing: () => false,
    getHoverPreviewTheme: () => "dark",
    getHoverPreviewSettings: () => ({ enabled: false, delay: 300, blockSensitive: true }),
  };
  return new TerminalFactory(deps);
}

beforeEach(() => {
  document.body.innerHTML = '<div id="terminal-container"></div>';
  seen.log.length = 0;
  seen.fixTargets.length = 0;
  seen.fixThrows = false;
  seen.contextLoss.length = 0;
  seen.disposed = 0;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("TerminalFactory WebGL loading", () => {
  it("applies the canvas font fix to this window before creating the WebGL addon", () => {
    makeFactory().createTerminal("t1", "Terminal 1", CONFIG, true);
    expect(seen.log).toEqual(["open", "canvas font fix", "new WebglAddon", "loadAddon webgl"]);
    expect(seen.fixTargets).toEqual([window]);
  });

  it("does the same for a deferred terminal when it is attached", () => {
    const factory = makeFactory();
    const instance = factory.createTerminal("t1", "Terminal 1", CONFIG, true, null, { deferOpen: true });
    expect(seen.log).toEqual([]);
    factory.attachDeferredTerminal(instance);
    expect(seen.log).toEqual(["open", "canvas font fix", "new WebglAddon", "loadAddon webgl"]);
    expect(seen.fixTargets).toEqual([window]);
  });

  it("turns WebGL off for later terminals, on both paths, when loading it throws", () => {
    const factory = makeFactory();
    seen.fixThrows = true;
    factory.createTerminal("t1", "Terminal 1", CONFIG, true);
    expect(seen.log).toEqual(["open", "canvas font fix"]);

    seen.fixThrows = false;
    seen.log.length = 0;
    factory.createTerminal("t2", "Terminal 2", CONFIG, true);
    const deferred = factory.createTerminal("t3", "Terminal 3", CONFIG, true, null, { deferOpen: true });
    factory.attachDeferredTerminal(deferred);
    expect(seen.log).toEqual(["open", "open"]);
    expect(console.warn).toHaveBeenCalledWith(
      "[Portaterm] WebGL renderer failed, using canvas fallback for all future terminals",
    );
  });

  it("disposes the addon on context loss and skips WebGL for later terminals", () => {
    const factory = makeFactory();
    factory.createTerminal("t1", "Terminal 1", CONFIG, true);
    expect(seen.contextLoss).toHaveLength(1);
    seen.contextLoss[0]();
    expect(seen.disposed).toBe(1);

    seen.log.length = 0;
    factory.createTerminal("t2", "Terminal 2", CONFIG, true);
    expect(seen.log).toEqual(["open"]);
  });
});
