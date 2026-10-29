// @vitest-environment jsdom
// src/webview/main.tabAppearance.test.ts — tab color and icon through the shipped webview.
//
// The pieces have their own tests; this boots the real `main.ts` inside the real
// webview HTML and drives it the way the host does, so the wiring between them —
// the init mirror, the router entry, the tab-bar render and the stylesheet rules
// that place the color — cannot break silently.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { getTerminalHtml } from "../providers/webviewHtml";

// Every test re-imports the whole webview bundle entry; under a loaded full-suite
// run that cold import alone can pass the 5s default (seen at load ~11).
vi.setConfig({ testTimeout: 30_000 });

// ─── xterm stand-in ─────────────────────────────────────────────────
// Records each terminal's onData and private onUserInput listeners so a test
// can emit "typed" chunks (user-input flag, then data) and xterm's own replies.

const xterm = vi.hoisted(() => {
  const byElement = new Map<Element, { data?: (d: string) => void; userInput?: () => void }>();
  const all: Array<{ container?: Element; data?: (d: string) => void; userInput?: () => void }> = [];

  class FakeTerminal {
    element: HTMLDivElement | undefined;
    textarea: HTMLTextAreaElement | undefined;
    options: Record<string, unknown> = {};
    rows = 24;
    cols = 80;
    modes = { bracketedPasteMode: false };
    buffer = {
      active: { cursorY: 0, cursorX: 0, length: 0, getLine: () => undefined, viewportY: 0, baseY: 0, type: "normal" },
      onBufferChange: () => ({ dispose: () => {} }),
    };
    parser = {
      registerOscHandler: () => ({ dispose: () => {} }),
      registerCsiHandler: () => ({ dispose: () => {} }),
      registerDcsHandler: () => ({ dispose: () => {} }),
      registerEscHandler: () => ({ dispose: () => {} }),
    };
    unicode = { activeVersion: "6" };
    private readonly handle: { container?: Element; data?: (d: string) => void; userInput?: () => void } = {};
    _core = {
      coreService: {
        onUserInput: (listener: () => void) => {
          this.handle.userInput = listener;
          return { dispose: () => {} };
        },
      },
    };
    constructor() {
      all.push(this.handle);
    }
    open(container: HTMLElement) {
      this.element = document.createElement("div");
      this.textarea = document.createElement("textarea");
      this.element.appendChild(this.textarea);
      container.appendChild(this.element);
      this.handle.container = container;
      byElement.set(container, this.handle);
    }
    loadAddon() {}
    focus() {}
    blur() {}
    resize() {}
    write(_d: unknown, cb?: () => void) {
      cb?.();
    }
    writeln() {}
    clear() {}
    reset() {}
    refresh() {}
    scrollToBottom() {}
    select() {}
    selectAll() {}
    clearSelection() {}
    hasSelection() {
      return false;
    }
    getSelection() {
      return "";
    }
    dispose() {}
    attachCustomKeyEventHandler() {}
    attachCustomWheelEventHandler() {}
    registerLinkProvider() {
      return { dispose: () => {} };
    }
    registerMarker() {
      return undefined;
    }
    registerDecoration() {
      return undefined;
    }
    onData(listener: (d: string) => void) {
      this.handle.data = listener;
      return { dispose: () => {} };
    }
    onResize() {
      return { dispose: () => {} };
    }
    onTitleChange() {
      return { dispose: () => {} };
    }
    onWriteParsed() {
      return { dispose: () => {} };
    }
    onRender() {
      return { dispose: () => {} };
    }
    onScroll() {
      return { dispose: () => {} };
    }
    onSelectionChange() {
      return { dispose: () => {} };
    }
    onBell() {
      return { dispose: () => {} };
    }
    onKey() {
      return { dispose: () => {} };
    }
    onLineFeed() {
      return { dispose: () => {} };
    }
    onCursorMove() {
      return { dispose: () => {} };
    }
  }
  return { FakeTerminal, byElement, all };
});

vi.mock("@xterm/xterm", () => ({ Terminal: xterm.FakeTerminal }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class {} }));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));
vi.mock("@xterm/addon-search", () => ({
  SearchAddon: class {
    onDidChangeResults() {
      return { dispose: () => {} };
    }
    findNext() {
      return false;
    }
    findPrevious() {
      return false;
    }
    clearDecorations() {}
  },
}));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    onContextLoss() {}
    dispose() {}
  },
}));

// ─── Harness ────────────────────────────────────────────────────────

let posted: Array<{ type: string; [key: string]: unknown }> = [];

// `main.ts` installs its listeners on the long-lived window and document. Each
// test boots a fresh copy, so the previous copy's listeners are removed after
// every test — otherwise two webviews would answer one message.
const installed: Array<[EventTarget, string, EventListenerOrEventListenerObject, unknown]> = [];
for (const target of [window, document] as EventTarget[]) {
  const add = target.addEventListener.bind(target);
  target.addEventListener = (type: string, listener: EventListenerOrEventListenerObject, options?: unknown) => {
    installed.push([target, type, listener, options]);
    add(type, listener, options as AddEventListenerOptions);
  };
}

function host(msg: unknown): void {
  window.dispatchEvent(new MessageEvent("message", { data: msg }));
}

async function boot(tabs: Array<Record<string, unknown>>) {
  const html = getTerminalHtml(
    { cspSource: "mock", asWebviewUri: (u: { fsPath: string }) => u.fsPath } as never,
    vscode.Uri.file("/ext"),
    "sidebar",
  );
  document.documentElement.innerHTML = new DOMParser()
    .parseFromString(html, "text/html")
    .documentElement.innerHTML.replace(/<script[\s\S]*?<\/script>/g, "");
  await import("./main");
  host({
    type: "init",
    tabs: tabs.map((t, i) => ({
      name: `Terminal ${i + 1}`,
      customName: null,
      isActive: i === 0,
      isSplitPane: false,
      ...t,
    })),
    config: { fontSize: 14, cursorBlink: false, scrollback: 1000, fontFamily: "" },
    rootGeneration: 0,
    workspaceRoot: null,
    resolvedWorkspaceRoot: null,
    worktreeHasRepo: false,
    worktreeRowActivation: "focus",
    vaultActionsAvailable: true,
  });
  await vi.waitFor(() => expect(document.querySelectorAll("#tab-bar .tab-item")).toHaveLength(tabs.length));
}

beforeEach(() => {
  vi.resetModules();
  xterm.all.length = 0;
  posted = [];
  (globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({
    postMessage: (m: { type: string }) => posted.push(m),
    getState: () => undefined,
    setState: () => {},
  });
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  })) as never;
  (globalThis as Record<string, unknown>).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  for (const [target, type, listener, options] of installed.splice(0)) {
    target.removeEventListener(type, listener, options as EventListenerOptions);
  }
  vi.restoreAllMocks();
});

const tab = (id: string) => document.querySelector<HTMLElement>(`#tab-bar .tab-item[data-tab-id="${id}"]`)!;
const icon = (id: string) => tab(id).querySelector<HTMLElement>(".tab-icon")!;

describe("tab color and icon in the shipped webview", () => {
  it("draws what init says each tab wears, and nothing on a tab that wears none", async () => {
    await boot([{ id: "t1", tabColor: "red", tabIcon: "rocket" }, { id: "t2" }]);

    expect(tab("t1").classList.contains("tab-colored")).toBe(true);
    expect(tab("t1").style.getPropertyValue("--tab-color")).toBe("var(--vscode-terminal-ansiRed, #cd3131)");
    expect(icon("t1").hidden).toBe(false);
    expect(icon("t1").dataset.icon).toBe("rocket");

    expect(tab("t2").classList.contains("tab-colored")).toBe(false);
    expect(icon("t2").hidden).toBe(true);
  });

  it("follows tabAppearance: sets, switches and clears on the tab it names only", async () => {
    await boot([{ id: "t1" }, { id: "t2" }]);

    host({ type: "tabAppearance", tabId: "t2", tabColor: "green", tabIcon: "bug" });
    expect(tab("t2").dataset.tabColor).toBe("green");
    expect(icon("t2").dataset.icon).toBe("bug");
    expect(tab("t1").classList.contains("tab-colored")).toBe(false);
    expect(icon("t1").hidden).toBe(true);

    host({ type: "tabAppearance", tabId: "t2", tabColor: "blue", tabIcon: null });
    expect(tab("t2").dataset.tabColor).toBe("blue");
    expect(icon("t2").hidden).toBe(true);

    host({ type: "tabAppearance", tabId: "t2", tabColor: null, tabIcon: "globe" });
    expect(tab("t2").classList.contains("tab-colored")).toBe(false);
    expect(tab("t2").style.getPropertyValue("--tab-color")).toBe("");
    expect(icon("t2").dataset.icon).toBe("globe");
  });

  it("keeps the color when the tab is re-rendered for another reason", async () => {
    await boot([{ id: "t1", tabColor: "magenta" }, { id: "t2" }]);
    host({ type: "tabRenamed", tabId: "t1", customName: "api" });
    host({ type: "tabPinned", tabId: "t1", pinned: true });
    expect(tab("t1").dataset.tabColor).toBe("magenta");
    expect(tab("t1").classList.contains("tab-colored")).toBe(true);
  });

  it("draws what a tabCreated says a resumed tab opens wearing", async () => {
    await boot([{ id: "t1" }]);
    host({
      type: "tabCreated",
      tabId: "t2",
      name: "Terminal 2",
      customName: null,
      tabColor: "yellow",
      tabIcon: "beaker",
    });
    await vi.waitFor(() => expect(document.querySelectorAll("#tab-bar .tab-item")).toHaveLength(2));
    expect(tab("t2").dataset.tabColor).toBe("yellow");
    expect(icon("t2").dataset.icon).toBe("beaker");
  });

  it("ignores a tabAppearance for a tab it does not have", async () => {
    await boot([{ id: "t1" }]);
    expect(() => host({ type: "tabAppearance", tabId: "gone", tabColor: "red", tabIcon: "bug" })).not.toThrow();
    expect(tab("t1").classList.contains("tab-colored")).toBe(false);
  });

  it("ships the stylesheet rules that place the color and hide an unset icon", async () => {
    await boot([{ id: "t1", tabColor: "cyan", tabIcon: "server" }, { id: "t2" }]);
    const colored = window.getComputedStyle(tab("t1"));
    expect(colored.backgroundSize).toBe("100% 2px");
    expect(colored.backgroundRepeat).toBe("no-repeat");
    expect(window.getComputedStyle(tab("t2")).backgroundSize).not.toBe("100% 2px");
    expect(window.getComputedStyle(icon("t1")).display).toBe("flex");
    expect(window.getComputedStyle(icon("t2")).display).toBe("none");
  });
});
