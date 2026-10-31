// @vitest-environment jsdom
// src/webview/main.paneEngaged.test.ts — which clicks tell the host a pane was looked at.
//
// A turn that finished while the user was elsewhere stays marked done until the
// user clicks its pane or its tab (or types into it). This boots the real
// `main.ts` inside the real webview HTML and clicks the way the user does, so a
// pane the click cannot be traced to — a single-pane tab mounts its terminal
// with no split leaf around it — or a focus that is not a click cannot slip by.

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
      this.textarea.className = "xterm-helper-textarea"; // what real xterm calls its input
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

/** The terminal container mounted for `sessionId`, found through its context. */
function terminalOf(sessionId: string): HTMLElement {
  for (const handle of xterm.all) {
    const container = handle.container as HTMLElement | undefined;
    const context = container?.dataset.vscodeContext;
    if (container && context && JSON.parse(context).paneSessionId === sessionId) {
      return container;
    }
  }
  throw new Error(`no terminal mounted for ${sessionId}`);
}

async function boot(tabs: string[]) {
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
    tabs: tabs.map((id, index) => ({
      id,
      name: `Terminal ${index + 1}`,
      customName: null,
      isActive: index === 0,
      isSplitPane: false,
    })),
    config: { fontSize: 14, cursorBlink: false, scrollback: 1000, fontFamily: "" },
    rootGeneration: 0,
    workspaceRoot: null,
    resolvedWorkspaceRoot: null,
    worktreeHasRepo: false,
    worktreeRowActivation: "focus",
    vaultActionsAvailable: true,
  });
  await vi.waitFor(() => tabs.forEach(terminalOf));
  posted = [];
}

/** Split t1's active pane the way the host does: request, then the created session. */
async function split(newSessionId: string): Promise<void> {
  posted = [];
  host({ type: "splitPane", direction: "vertical" });
  const request = posted.find((m) => m.type === "requestSplitSession");
  if (!request) {
    throw new Error("splitPane posted no requestSplitSession");
  }
  host({
    type: "splitPaneCreated",
    requestId: request.requestId,
    sourceTabId: "t1",
    sourcePaneId: request.sourcePaneId,
    newSessionId,
    newSessionName: newSessionId,
    direction: "vertical",
  });
  await vi.waitFor(() => expect(document.querySelectorAll(".split-leaf")).toHaveLength(2));
  posted = [];
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

const press = (el: Element) => el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
const engaged = () => posted.filter((m) => m.type === "paneEngaged").map((m) => m.paneIds);
const tabItem = (id: string) => document.querySelector<HTMLElement>(`#tab-bar .tab-item[data-tab-id="${id}"]`)!;
const textarea = (sessionId: string) => terminalOf(sessionId).querySelector("textarea")!;

describe("pane engagement in the shipped webview", () => {
  it("counts a click inside a single-pane tab's terminal as a look at that pane", async () => {
    await boot(["t1"]);
    expect(terminalOf("t1").closest(".split-leaf")).toBeNull();
    press(textarea("t1"));
    expect(engaged()).toEqual([["t1"]]);
  });

  it("names the pane whose terminal was clicked, not the first one mounted", async () => {
    await boot(["t1", "t2"]);
    press(textarea("t2"));
    expect(engaged()).toEqual([["t2"]]);
  });

  it("counts a click on a tab as a look at every pane it holds", async () => {
    await boot(["t1", "t2"]);
    press(tabItem("t2"));
    expect(engaged()).toEqual([["t2"]]);
    await split("p2");
    press(tabItem("t1"));
    expect(engaged()).toEqual([["t1", "p2"]]);
  });

  it("counts a click in a split pane as a look at that pane alone", async () => {
    await boot(["t1"]);
    await split("p2");
    press(textarea("p2"));
    expect(engaged()).toEqual([["p2"]]);
  });

  it("does not count focus coming back with the window, or leaving it", async () => {
    await boot(["t1"]);
    window.dispatchEvent(new FocusEvent("focus"));
    textarea("t1").dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    window.dispatchEvent(new FocusEvent("blur"));
    expect(posted.some((m) => m.type === "focus")).toBe(true);
    expect(engaged()).toEqual([]);
  });

  it("does not count a click outside every pane and tab", async () => {
    await boot(["t1"]);
    press(document.getElementById("tab-bar")!);
    press(document.body);
    expect(engaged()).toEqual([]);
  });
});
