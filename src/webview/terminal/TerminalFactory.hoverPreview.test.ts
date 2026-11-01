// @vitest-environment jsdom
// src/webview/terminal/TerminalFactory.hoverPreview.test.ts — the hover popup a
// terminal builds renders code through `renderLive` (perf D1), so a long file is
// highlighted in slices and a file hovered again comes from memory.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HoverPreviewPopupDeps } from "../links/HoverPreviewPopup";
import { TerminalFactory, type TerminalFactoryDeps } from "./TerminalFactory";

const xterm = vi.hoisted(() => {
  const handles = new Map<object, { data?: (d: string) => void; userInput?: () => void }>();

  class FakeTerminal {
    element = document.createElement("div");
    options: Record<string, unknown> = {};
    rows = 24;
    cols = 80;
    buffer = { active: { cursorY: 0, length: 0, getLine: () => undefined, viewportY: 0 } };
    parser = { registerOscHandler: () => ({ dispose: () => {} }) };
    _core = {
      coreService: {
        onUserInput: (listener: () => void) => {
          handles.set(this, { ...handles.get(this), userInput: listener });
          return { dispose: () => {} };
        },
      },
    };
    loadAddon = () => {};
    open = () => {};
    focus = () => {};
    resize = () => {};
    write = () => {};
    dispose = () => {};
    attachCustomKeyEventHandler = () => {};
    registerLinkProvider = () => ({ dispose: () => {} });
    onData = (listener: (d: string) => void) => {
      handles.set(this, { ...handles.get(this), data: listener });
      return { dispose: () => {} };
    };
    onResize = () => ({ dispose: () => {} });
    onTitleChange = () => ({ dispose: () => {} });
  }

  return { FakeTerminal, handles };
});

vi.mock("@xterm/xterm", () => ({ Terminal: xterm.FakeTerminal }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class {} }));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    onContextLoss() {}
    dispose() {}
  },
}));

const seen = vi.hoisted(() => ({
  popupDeps: [] as Array<Record<string, unknown>>,
  renderLive: [] as unknown[][],
}));

vi.mock("../links/HoverPreviewPopup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../links/HoverPreviewPopup")>();
  class RecordingPopup extends actual.HoverPreviewPopup {
    constructor(deps: HoverPreviewPopupDeps) {
      super(deps);
      seen.popupDeps.push(deps as unknown as Record<string, unknown>);
    }
  }
  return { ...actual, HoverPreviewPopup: RecordingPopup };
});

vi.mock("../links/syntaxRenderer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../links/syntaxRenderer")>();
  return {
    ...actual,
    createSyntaxRenderer: (deps: Parameters<typeof actual.createSyntaxRenderer>[0]) => {
      const renderer = actual.createSyntaxRenderer(deps);
      return {
        ...renderer,
        renderLive: (...args: Parameters<typeof renderer.renderLive>) => {
          seen.renderLive.push(args);
          const el = document.createElement("div");
          el.dataset.live = "yes";
          return el;
        },
      };
    },
  };
});

const CONFIG = { fontSize: 14, fontFamily: "monospace", cursorBlink: false, scrollback: 1000 };

beforeEach(() => {
  document.body.innerHTML = '<div id="terminal-container"></div>';
  seen.popupDeps.length = 0;
  seen.renderLive.length = 0;
});

describe("TerminalFactory hover preview", () => {
  it("renders a code preview through renderLive, passing the popup's re-mark along", () => {
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
      getHoverPreviewSettings: () => ({ enabled: true, delay: 300, blockSensitive: true }),
    };
    new TerminalFactory(deps).createTerminal("p1", "Terminal 1", CONFIG, true);
    expect(seen.popupDeps).toHaveLength(1);
    const renderCode = seen.popupDeps[0].renderCode as (
      content: string,
      languageId: string,
      theme: string,
      onAsyncRefresh?: () => void,
    ) => HTMLElement;
    const remark = vi.fn();
    const el = renderCode("const a = 1;", "typescript", "hc-dark", remark);
    expect(el.dataset.live).toBe("yes");
    expect(seen.renderLive).toEqual([["const a = 1;", "typescript", "hc-dark", remark]]);
  });
});
