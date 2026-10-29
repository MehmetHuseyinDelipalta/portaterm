// @vitest-environment jsdom
// src/webview/terminal/TerminalFactory.broadcast.test.ts — where a pane's onData goes.
//
// Typed input goes to `sendUserInput` (which broadcasts); everything else xterm
// emits on its own goes to the pane's own PTY only, exactly as before.

import { beforeEach, describe, expect, it, vi } from "vitest";
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

const CONFIG = { fontSize: 14, fontFamily: "monospace", cursorBlink: false, scrollback: 1000 };

function setup(withSendUserInput = true) {
  const postMessage = vi.fn();
  const sendUserInput = vi.fn();
  const store = {
    terminals: new Map(),
    tabLayouts: new Map(),
    tabActivePaneIds: new Map(),
    activeTabId: null,
    currentConfig: CONFIG,
    persist: vi.fn(),
  };
  const deps: TerminalFactoryDeps = {
    themeManager: { getTheme: () => ({}), getMinimumContrastRatio: () => 1 } as never,
    store: store as never,
    postMessage,
    onTabBarUpdate: vi.fn(),
    getIsComposing: () => false,
    getHoverPreviewTheme: () => "dark",
    getHoverPreviewSettings: () => ({ enabled: true, delay: 300, blockSensitive: true }),
    ...(withSendUserInput ? { sendUserInput } : {}),
  };
  const factory = new TerminalFactory(deps);
  const instance = factory.createTerminal("p1", "Terminal 1", CONFIG, true);
  store.terminals.set("p1", instance);
  const handle = xterm.handles.get(instance.terminal as object);
  if (!handle?.data || !handle.userInput) {
    throw new Error("factory did not subscribe to onData and onUserInput");
  }
  const { data, userInput } = handle;
  const typed = (chunk: string): void => {
    instance.container.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    userInput();
    data(chunk);
  };
  const reply = (chunk: string): void => data(chunk);
  const inputPosts = () => postMessage.mock.calls.map(([m]) => m).filter((m) => m.type === "input");
  return { instance, sendUserInput, typed, reply, inputPosts };
}

beforeEach(() => {
  document.body.innerHTML = '<div id="terminal-container"></div>';
  xterm.handles.clear();
});

describe("TerminalFactory input routing", () => {
  it("hands typed input to sendUserInput and nothing else", () => {
    const { sendUserInput, typed, inputPosts } = setup();
    typed("ls\r");
    expect(sendUserInput).toHaveBeenCalledWith("p1", "ls\r");
    expect(inputPosts()).toEqual([]);
  });

  it("posts xterm's own replies to the pane's PTY only", () => {
    const { sendUserInput, reply, inputPosts } = setup();
    reply("\x1b[1;1R");
    expect(sendUserInput).not.toHaveBeenCalled();
    expect(inputPosts()).toEqual([{ type: "input", tabId: "p1", data: "\x1b[1;1R" }]);
  });

  it("posts user input that came from the pointer to the pane only", () => {
    const { instance, sendUserInput, inputPosts } = setup();
    const handle = xterm.handles.get(instance.terminal as object)!;
    instance.container.dispatchEvent(new MouseEvent("mousedown"));
    handle.userInput!();
    handle.data!("\x1b[<0;1;1M");
    expect(sendUserInput).not.toHaveBeenCalled();
    expect(inputPosts()).toEqual([{ type: "input", tabId: "p1", data: "\x1b[<0;1;1M" }]);
  });

  it("drops input to an exited pane without leaving the typed flag for the next chunk", () => {
    const { instance, sendUserInput, typed, reply, inputPosts } = setup();
    instance.exited = true;
    typed("x");
    instance.exited = false;
    reply("\x1b[0n");
    expect(sendUserInput).not.toHaveBeenCalled();
    expect(inputPosts()).toEqual([{ type: "input", tabId: "p1", data: "\x1b[0n" }]);
  });

  it("posts typed input directly when no sendUserInput is wired", () => {
    const { typed, inputPosts } = setup(false);
    typed("a");
    expect(inputPosts()).toEqual([{ type: "input", tabId: "p1", data: "a" }]);
  });
});
