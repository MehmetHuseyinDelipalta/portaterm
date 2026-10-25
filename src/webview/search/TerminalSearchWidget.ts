// src/webview/search/TerminalSearchWidget.ts — Cmd+F / Ctrl+F find widget for the terminal.
//
// One widget per webview, floating over the top-right corner of
// `#terminal-container`. It is never bound to a fixed terminal: every operation
// resolves the ACTIVE pane through `getTarget()`, so switching tabs or panes
// while it is open moves the search with the focus. When the target changes,
// the previous terminal's highlights are cleared first.
//
// Keyboard contract (input focused):
//   - Enter, Cmd+G (F3 off macOS)              → next match
//   - Shift+Enter, Shift+Cmd+G (Shift+F3 off macOS) → previous match
//   - Escape                   → close, focus returns to the terminal
//   - Alt+R / Alt+C / Alt+W    → toggle regex / case / whole word (VS Code's bindings)
//
// Highlighting uses @xterm/addon-search decorations, which need the terminal's
// `allowProposedApi` option (TerminalFactory sets it).

import type { ISearchOptions, ISearchResultChangeEvent } from "@xterm/addon-search";
import type { HoverPreviewThemeKind } from "../links/HoverPreviewController";

/** The subset of `SearchAddon` the widget drives. */
export interface SearchAddonLike {
  findNext(term: string, options?: ISearchOptions): boolean;
  findPrevious(term: string, options?: ISearchOptions): boolean;
  clearDecorations(): void;
  onDidChangeResults(listener: (e: ISearchResultChangeEvent) => void): { dispose(): void };
}

/** The subset of the xterm `Terminal` the widget touches. */
export interface SearchTerminalLike {
  focus(): void;
  hasSelection(): boolean;
  getSelection(): string;
}

/** A searchable pane: the session id identifies it across retargets. */
export interface SearchTarget {
  id: string;
  terminal: SearchTerminalLike;
  searchAddon: SearchAddonLike;
}

export interface TerminalSearchWidgetDeps {
  /** The element the widget mounts into (positioned; `#terminal-container`). */
  host: HTMLElement;
  /** The active pane, or undefined when no terminal is showing. */
  getTarget: () => SearchTarget | undefined;
  /** Current VS Code theme kind — picks the highlight palette. */
  getThemeKind: () => HoverPreviewThemeKind;
}

type ToggleKey = "regex" | "caseSensitive" | "wholeWord";

/**
 * Match colours. Backgrounds must be `#RRGGBB` (the addon feeds them to the
 * renderer as cell colours); borders are plain CSS. Values follow VS Code's
 * terminal find defaults. Overview-ruler colours are required by the addon's
 * type but the ruler is hidden in this webview.
 */
function decorationsFor(kind: HoverPreviewThemeKind): NonNullable<ISearchOptions["decorations"]> {
  const light = kind === "light" || kind === "hc-light";
  return {
    matchBorder: light ? "#B86A00" : "#EA5C00",
    matchOverviewRuler: "#D18616",
    activeMatchBackground: light ? "#A8AC94" : "#515C6A",
    activeMatchBorder: light ? "#5C5C5C" : "#F2CC60",
    activeMatchColorOverviewRuler: "#F2CC60",
  };
}

const ICON_ARROW_UP =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 13V3"/><path d="M3.5 7.5 8 3l4.5 4.5"/></svg>';
const ICON_ARROW_DOWN =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3v10"/><path d="M3.5 8.5 8 13l4.5-4.5"/></svg>';
const ICON_CLOSE =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8"/><path d="M12 4l-8 8"/></svg>';

export class TerminalSearchWidget {
  private readonly deps: TerminalSearchWidgetDeps;
  private root: HTMLDivElement | null = null;
  private input: HTMLInputElement | null = null;
  private count: HTMLSpanElement | null = null;
  private readonly toggleButtons = new Map<ToggleKey, HTMLButtonElement>();
  private readonly toggles: Record<ToggleKey, boolean> = { regex: false, caseSensitive: false, wholeWord: false };

  /** The pane the current highlights live in, and its results subscription. */
  private bound: { target: SearchTarget; subscription: { dispose(): void } } | null = null;

  constructor(deps: TerminalSearchWidgetDeps) {
    this.deps = deps;
  }

  /** Whether the widget is currently shown. */
  get isOpen(): boolean {
    return this.root !== null && !this.root.hidden;
  }

  /** Whether `node` lives inside the widget — the document key router uses this to stand aside. */
  contains(node: EventTarget | null): boolean {
    return this.root !== null && node instanceof Node && this.root.contains(node);
  }

  /**
   * Show the widget and focus its input. A single-line terminal selection seeds
   * the query (like VS Code); otherwise the last query is kept and selected.
   */
  open(): void {
    const target = this.deps.getTarget();
    if (!target) {
      return;
    }
    this.mount();
    const input = this.input as HTMLInputElement;
    if (target.terminal.hasSelection()) {
      const selection = target.terminal.getSelection();
      if (selection && !selection.includes("\n")) {
        input.value = selection;
      }
    }
    (this.root as HTMLDivElement).hidden = false;
    input.focus();
    input.select();
    if (input.value) {
      this.search("next", true);
    } else {
      this.renderCount(null);
    }
  }

  /** Hide the widget, clear highlights, and hand focus back to the terminal. */
  close(): void {
    if (!this.isOpen) {
      return;
    }
    (this.root as HTMLDivElement).hidden = true;
    const target = this.bound?.target ?? this.deps.getTarget();
    this.unbind();
    target?.terminal.focus();
  }

  findNext(): void {
    this.search("next", false);
  }

  findPrevious(): void {
    this.search("previous", false);
  }

  /**
   * Re-run the search if the active pane changed while the widget is open, so
   * the counter and highlights follow the user. Cheap when nothing changed —
   * safe to call from every tab-bar update.
   */
  sync(): void {
    if (!this.isOpen || !this.bound) {
      return;
    }
    const target = this.deps.getTarget();
    if (target?.id === this.bound.target.id) {
      return;
    }
    this.unbind();
    if (target && this.input?.value) {
      this.search("next", true);
    } else {
      this.renderCount(null);
    }
  }

  dispose(): void {
    this.unbind();
    this.root?.remove();
    this.root = null;
    this.input = null;
    this.count = null;
    this.toggleButtons.clear();
  }

  // ─── Internals ────────────────────────────────────────────────────

  private search(direction: "next" | "previous", incremental: boolean): void {
    const term = this.input?.value ?? "";
    const target = this.bind();
    if (!target) {
      this.renderCount(null);
      return;
    }
    if (!term) {
      target.searchAddon.clearDecorations();
      this.setInvalid(false);
      this.renderCount(null);
      return;
    }
    const options: ISearchOptions = {
      regex: this.toggles.regex,
      caseSensitive: this.toggles.caseSensitive,
      wholeWord: this.toggles.wholeWord,
      incremental: incremental && direction === "next",
      decorations: decorationsFor(this.deps.getThemeKind()),
    };
    if (this.toggles.regex && !isValidRegex(term)) {
      target.searchAddon.clearDecorations();
      this.setInvalid(true);
      this.renderCount(null, "Invalid regex");
      return;
    }
    this.setInvalid(false);
    try {
      const found =
        direction === "next"
          ? target.searchAddon.findNext(term, options)
          : target.searchAddon.findPrevious(term, options);
      if (!found) {
        this.renderCount({ resultIndex: -1, resultCount: 0 });
      }
    } catch {
      // The addon builds the RegExp itself; anything it still rejects lands here.
      target.searchAddon.clearDecorations();
      this.setInvalid(true);
      this.renderCount(null, "Invalid regex");
    }
  }

  /** Resolve the active pane, moving the results subscription to it if it changed. */
  private bind(): SearchTarget | undefined {
    const target = this.deps.getTarget();
    if (this.bound && this.bound.target.id === target?.id) {
      return target;
    }
    this.unbind();
    if (!target) {
      return undefined;
    }
    const subscription = target.searchAddon.onDidChangeResults((e) => this.renderCount(e));
    this.bound = { target, subscription };
    return target;
  }

  private unbind(): void {
    if (!this.bound) {
      return;
    }
    this.bound.subscription.dispose();
    try {
      this.bound.target.searchAddon.clearDecorations();
    } catch {
      // The terminal may already be disposed — its decorations went with it.
    }
    this.bound = null;
  }

  private renderCount(e: ISearchResultChangeEvent | null, message?: string): void {
    if (!this.count) {
      return;
    }
    let text: string;
    if (message !== undefined) {
      text = message;
    } else if (e === null || !this.input?.value) {
      text = "";
    } else if (e.resultCount === 0) {
      text = "No results";
    } else if (e.resultIndex < 0) {
      // The addon stops highlighting past its limit and reports no index.
      text = `${e.resultCount}+ results`;
    } else {
      text = `${e.resultIndex + 1} of ${e.resultCount}`;
    }
    this.count.textContent = text;
    this.count.classList.toggle("terminal-search-count-empty", e !== null && e.resultCount === 0);
  }

  private setInvalid(invalid: boolean): void {
    this.input?.classList.toggle("terminal-search-input-invalid", invalid);
    this.input?.setAttribute("aria-invalid", String(invalid));
  }

  private setToggle(key: ToggleKey, value: boolean): void {
    this.toggles[key] = value;
    const button = this.toggleButtons.get(key);
    button?.classList.toggle("terminal-search-toggle-on", value);
    button?.setAttribute("aria-pressed", String(value));
    this.search("next", true);
  }

  private mount(): void {
    if (this.root) {
      return;
    }
    const root = document.createElement("div");
    root.className = "terminal-search";
    root.setAttribute("role", "search");
    root.hidden = true;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "terminal-search-input";
    input.placeholder = "Find";
    input.setAttribute("aria-label", "Find in terminal");
    input.spellcheck = false;
    input.autocomplete = "off";
    root.appendChild(input);

    const toggles: { key: ToggleKey; label: string; title: string }[] = [
      { key: "caseSensitive", label: "Aa", title: "Match Case (Alt+C)" },
      { key: "wholeWord", label: "ab", title: "Match Whole Word (Alt+W)" },
      { key: "regex", label: ".*", title: "Use Regular Expression (Alt+R)" },
    ];
    for (const { key, label, title } of toggles) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `terminal-search-toggle terminal-search-toggle-${key}`;
      button.textContent = label;
      button.title = title;
      button.setAttribute("aria-label", title);
      button.setAttribute("aria-pressed", "false");
      // Keep focus in the input so typing continues after a click.
      button.addEventListener("mousedown", (e) => e.preventDefault());
      button.addEventListener("click", () => this.setToggle(key, !this.toggles[key]));
      this.toggleButtons.set(key, button);
      root.appendChild(button);
    }

    const count = document.createElement("span");
    count.className = "terminal-search-count";
    count.setAttribute("aria-live", "polite");
    root.appendChild(count);

    const actions: { className: string; icon: string; title: string; run: () => void }[] = [
      {
        className: "terminal-search-prev",
        icon: ICON_ARROW_UP,
        title: "Previous Match (Shift+Enter)",
        run: () => this.findPrevious(),
      },
      {
        className: "terminal-search-next",
        icon: ICON_ARROW_DOWN,
        title: "Next Match (Enter)",
        run: () => this.findNext(),
      },
      { className: "terminal-search-close", icon: ICON_CLOSE, title: "Close (Escape)", run: () => this.close() },
    ];
    for (const { className, icon, title, run } of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `terminal-search-action ${className}`;
      button.innerHTML = icon;
      button.title = title;
      button.setAttribute("aria-label", title);
      button.addEventListener("mousedown", (e) => e.preventDefault());
      button.addEventListener("click", run);
      root.appendChild(button);
    }

    input.addEventListener("input", () => this.search("next", true));
    root.addEventListener("keydown", (e) => this.onKeyDown(e));

    this.deps.host.appendChild(root);
    this.root = root;
    this.input = input;
    this.count = count;
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.isComposing) {
      return;
    }
    const isMac = navigator.platform.includes("Mac");
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const key = e.key.toLowerCase();
    let handled = true;
    if (e.key === "Escape") {
      this.close();
    } else if (e.key === "Enter") {
      if (e.shiftKey) {
        this.findPrevious();
      } else {
        this.findNext();
      }
    } else if (isFindStepShortcut(e, isMac)) {
      if (e.shiftKey) {
        this.findPrevious();
      } else {
        this.findNext();
      }
    } else if (mod && key === "f") {
      this.input?.select();
    } else if (e.altKey && !mod && (e.code === "KeyR" || e.code === "KeyC" || e.code === "KeyW")) {
      // `e.code`, not `e.key`: on macOS Option+R types "®", so the key name is useless.
      const toggle: ToggleKey = e.code === "KeyR" ? "regex" : e.code === "KeyC" ? "caseSensitive" : "wholeWord";
      this.setToggle(toggle, !this.toggles[toggle]);
    } else {
      handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }
}

/**
 * Step to the next match, or the previous one with Shift: Cmd+G on macOS (like
 * every macOS find bar), F3 elsewhere (like VS Code), since Ctrl+G is the
 * shell's abort key there.
 */
export function isFindStepShortcut(e: KeyboardEvent, isMac: boolean): boolean {
  if (isMac) {
    return e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === "g";
  }
  return !e.ctrlKey && !e.metaKey && !e.altKey && e.key === "F3";
}

function isValidRegex(source: string): boolean {
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
}
