// @vitest-environment jsdom
// src/webview/main.editableKeys.test.ts — keys typed into a webview text field
// stay in that field.
//
// The document-level keydown (capture) handler turns Shift+Enter,
// Cmd/Ctrl+Backspace, Cmd+←/→ and Option+←/→ into PTY bytes and takes Cmd+W for
// "close" wherever focus is — on purpose, so they work from the file tree. In a
// text field (the tab rename box, the vault search, the worktree prompt) that
// typed into the shell behind it and closed tabs mid-rename; an image pasted
// into a field went to the terminal. This boots the real `main.ts` in the real
// webview HTML and presses the keys in fields and in xterm's own input.

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
  const all: Array<{ container?: Element; data?: (d: string) => void; userInput?: () => void; disposed?: boolean }> =
    [];

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
    private readonly handle: {
      container?: Element;
      data?: (d: string) => void;
      userInput?: () => void;
      disposed?: boolean;
    } = {};
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
      // What real xterm calls its input element: the one textarea whose keys
      // belong to the PTY.
      this.textarea.className = "xterm-helper-textarea";
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
    dispose() {
      this.handle.disposed = true;
    }
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

/** The fake terminal mounted for `sessionId`, found through its container's context. */
function paneHandle(sessionId: string) {
  for (const handle of xterm.all) {
    const context = (handle.container as HTMLElement | undefined)?.dataset.vscodeContext;
    if (context && JSON.parse(context).paneSessionId === sessionId) {
      return handle as { container: HTMLElement; disposed?: boolean };
    }
  }
  throw new Error(`no terminal mounted for ${sessionId}`);
}

async function bootWithSplit() {
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
    tabs: [{ id: "t1", name: "Terminal 1", customName: null, isActive: true, isSplitPane: false }],
    config: { fontSize: 14, cursorBlink: false, scrollback: 1000, fontFamily: "" },
    rootGeneration: 0,
    workspaceRoot: null,
    resolvedWorkspaceRoot: null,
    worktreeHasRepo: false,
    worktreeRowActivation: "focus",
    vaultActionsAvailable: true,
  });
  await split("p2", 2);
  posted = [];
}

/** Split t1's active pane the way the host does: request, then the created session. */
async function split(newSessionId: string, expectedLeaves: number): Promise<void> {
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
  await vi.waitFor(() => expect(document.querySelectorAll(".split-leaf")).toHaveLength(expectedLeaves));
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

const inputs = () => posted.filter((m) => m.type === "input");
const closes = () => posted.filter((m) => m.type === "closeTab" || m.type === "requestClosePane");

/** A focused field in the webview document, as the vault search or a dialog renders one. */
function field(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  const el = host.firstElementChild as HTMLElement;
  document.body.appendChild(host);
  el.focus();
  return el;
}

function press(target: Element, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

const xtermInput = () => paneHandle("t1").container.querySelector("textarea")!;

const FIELDS = [
  ["an input", "<input type='text'>"],
  ["a textarea", "<textarea></textarea>"],
  ["a contenteditable", "<div contenteditable='true' tabindex='0'></div>"],
] as const;

describe("line-editing shortcuts", () => {
  it("still reach the PTY from xterm's own input", async () => {
    await bootWithSplit();
    const event = press(xtermInput(), { key: "Enter", shiftKey: true });
    expect(inputs()).toEqual([{ type: "input", tabId: expect.any(String), data: "\x1b\r" }]);
    expect(event.defaultPrevented).toBe(true);
  });

  it.each(FIELDS)("stay in %s (Shift+Enter, Ctrl+Backspace)", async (_label, html) => {
    await bootWithSplit();
    const el = field(html);
    const events = [press(el, { key: "Enter", shiftKey: true }), press(el, { key: "Backspace", ctrlKey: true })];
    expect(inputs()).toEqual([]);
    expect(events.map((e) => e.defaultPrevented)).toEqual([false, false]);
  });

  it.each(FIELDS)("stay in %s on macOS (Cmd+←/→/⌫, Option+←/→)", async (_label, html) => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    await bootWithSplit();
    const el = field(html);
    const events = [
      press(el, { key: "ArrowLeft", metaKey: true }),
      press(el, { key: "ArrowRight", metaKey: true }),
      press(el, { key: "Backspace", metaKey: true }),
      press(el, { key: "ArrowLeft", altKey: true }),
      press(el, { key: "ArrowRight", altKey: true }),
    ];
    expect(inputs()).toEqual([]);
    expect(events.every((e) => !e.defaultPrevented)).toBe(true);
  });
});

describe("the close shortcut", () => {
  it("still closes from xterm's own input", async () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    await bootWithSplit();
    press(xtermInput(), { key: "w", metaKey: true });
    expect(closes()).toHaveLength(1);
  });

  it.each(FIELDS)("closes nothing from %s, and still does not reach VS Code", async (_label, html) => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    await bootWithSplit();
    const event = press(field(html), { key: "w", metaKey: true });
    expect(closes()).toEqual([]);
    // Unprevented, the webview hands Cmd+W to VS Code, which closes the editor.
    expect(event.defaultPrevented).toBe(true);
  });

  it("closes nothing from the tab rename box", async () => {
    await bootWithSplit();
    document
      .querySelector('#tab-bar .tab-item[data-tab-id="t1"]')!
      .dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    const rename = document.querySelector<HTMLInputElement>("input.tab-rename-overlay");
    expect(rename).not.toBeNull();

    press(rename!, { key: "w", ctrlKey: true, shiftKey: true });
    press(rename!, { key: "Enter", shiftKey: true });

    expect(closes()).toEqual([]);
    expect(inputs()).toEqual([]);
  });
});

describe("pasting an image", () => {
  function pasteImage(target: Element): Event {
    const file = new File([new Uint8Array([137, 80, 78, 71])], "shot.png", { type: "image/png" });
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: {
        items: Object.assign([{ kind: "file", type: "image/png", getAsFile: () => file }], { length: 1 }),
        getData: () => "",
        types: ["Files"],
      },
    });
    target.dispatchEvent(event);
    return event;
  }

  it("still goes to the terminal from xterm's own input", async () => {
    await bootWithSplit();
    const event = pasteImage(xtermInput());
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(posted.some((m) => m.type === "pasteClipboardImage")).toBe(true));
  });

  it("is left to the field it was pasted into", async () => {
    await bootWithSplit();
    const event = pasteImage(field("<input type='text'>"));
    expect(event.defaultPrevented).toBe(false);
    await new Promise((r) => setTimeout(r, 50));
    expect(posted.filter((m) => m.type === "pasteClipboardImage")).toEqual([]);
  });

  it("does not probe the clipboard for the terminal on a paste shortcut in a field", async () => {
    // macOS Ctrl+V: the keydown probe asks the host for a preview of the
    // clipboard image for the ACTIVE PANE — not what a field paste is about.
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    await bootWithSplit();
    press(field("<input type='text'>"), { key: "v", ctrlKey: true });
    await new Promise((r) => setTimeout(r, 250));
    expect(posted.filter((m) => m.type === "requestClipboardImagePreview")).toEqual([]);

    // Non-vacuous: the same key in xterm's input does probe.
    press(xtermInput(), { key: "v", ctrlKey: true });
    await vi.waitFor(() => expect(posted.some((m) => m.type === "requestClipboardImagePreview")).toBe(true));
  });
});
