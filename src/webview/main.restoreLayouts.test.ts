// @vitest-environment jsdom
// src/webview/main.restoreLayouts.test.ts — persisted split layouts meet the
// host's live sessions on `init`.
//
// Boots the real `main.ts` with a persisted webview state (`getState`) and an
// `init` naming the sessions the host still has, the way a window reload does.

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
/** What the webview persisted before the reload. */
let persisted: unknown;

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

beforeEach(() => {
  vi.resetModules();
  xterm.all.length = 0;
  posted = [];
  (globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({
    postMessage: (m: { type: string }) => posted.push(m),
    getState: () => persisted,
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

type Tab = { id: string; isSplitPane: boolean; rootTabId?: string };

async function bootWith(state: unknown, tabs: Tab[]): Promise<void> {
  persisted = state;
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
      id: t.id,
      name: t.id,
      customName: null,
      isActive: i === 0,
      isSplitPane: t.isSplitPane,
      ...(t.rootTabId ? { rootTabId: t.rootTabId } : {}),
    })),
    config: { fontSize: 14, cursorBlink: false, scrollback: 1000, fontFamily: "" },
    rootGeneration: 0,
    workspaceRoot: null,
    resolvedWorkspaceRoot: null,
    worktreeHasRepo: false,
    worktreeRowActivation: "focus",
    vaultActionsAvailable: true,
  });
}

const leafIds = () =>
  [...document.querySelectorAll<HTMLElement>(".split-leaf")].map((el) => el.dataset.sessionId).sort();
const barTabs = () => [...document.querySelectorAll<HTMLElement>("#tab-bar .tab-item")].map((el) => el.dataset.tabId);

const branch = (a: string, b: string) => ({
  type: "branch",
  direction: "vertical",
  ratio: 0.5,
  children: [
    { type: "leaf", sessionId: a },
    { type: "leaf", sessionId: b },
  ],
});

describe("restoring split layouts against the live sessions", () => {
  it("renders the live panes of a split whose other pane died while away — no empty leaf", async () => {
    await bootWith({ tabLayouts: { t1: branch("t1", "p2"), t3: branch("t3", "p4") } }, [
      { id: "t1", isSplitPane: false },
      { id: "t3", isSplitPane: false },
      { id: "p4", isSplitPane: true },
      // p2 is gone
    ]);
    await vi.waitFor(() => expect(leafIds()).toEqual(["p4", "t3"]));
    expect(barTabs()).toEqual(["t1", "t3"]);
  });

  it("keeps a tab whose root pane was closed, showing its live split after a reload", async () => {
    // Before the reload: t1's root pane was closed, leaving p2 in the tab.
    // The host sends p2 only — t1 is not a live session any more.
    await bootWith({ tabLayouts: { t1: { type: "leaf", sessionId: "p2" } }, tabActivePaneIds: { t1: "p2" } }, [
      { id: "t0", isSplitPane: false },
      { id: "p2", isSplitPane: true },
    ]);
    await vi.waitFor(() => expect(barTabs().sort()).toEqual(["t0", "t1"]));
    // And it is a real tab: its close button closes it.
    posted = [];
    document.querySelector<HTMLElement>('#tab-bar .tab-item[data-tab-id="t1"] .tab-close')!.click();
    expect(posted).toContainEqual({ type: "closeTab", tabId: "t1" });
  });

  it("drops a persisted layout none of whose panes is alive", async () => {
    await bootWith({ tabLayouts: { t9: branch("t9", "p9") } }, [{ id: "t1", isSplitPane: false }]);
    await vi.waitFor(() => expect(barTabs()).toEqual(["t1"]));
    expect(leafIds()).toEqual([]);
  });

  it("puts a live split pane the persisted layout lost back into its tab", async () => {
    // No persisted state at all (it was cleared), but the host still has t1 + p2.
    await bootWith(undefined, [
      { id: "t1", isSplitPane: false },
      { id: "p2", isSplitPane: true, rootTabId: "t1" },
    ]);
    await vi.waitFor(() => expect(leafIds()).toEqual(["p2", "t1"]));
    expect(barTabs()).toEqual(["t1"]);
  });
});
