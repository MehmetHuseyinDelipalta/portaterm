// src/providers/surfaceSignals.ts — What the terminal surfaces tell the window
// about the user, for listeners that are not a surface themselves.
//
// The sidebar, the bottom panel, and every editor panel each see their own
// slice: which tab is active, whether they are on screen, what was typed. Agent
// attention needs all of it in one place, so each surface reports here and the
// one listener the extension installs hears every surface alike.

import type { ExtensionToWebViewMessage } from "../types/messages";

export interface SurfaceSignalListener {
  /** What is on screen may have changed: a surface shown or hidden, or a tab switched. */
  displayChanged(): void;
  /** The user typed into a pane. Called per keystroke, so it must stay cheap. */
  paneInput(paneId: string): void;
  /** A surface's webview finished loading; `post` delivers its first state. */
  surfaceReady(post: (message: ExtensionToWebViewMessage) => void): void;
}

let listener: SurfaceSignalListener | undefined;

/** Install (or remove, with `undefined`) the window's one listener. */
export function setSurfaceSignalListener(next: SurfaceSignalListener | undefined): void {
  listener = next;
}

export function signalDisplayChanged(): void {
  listener?.displayChanged();
}

/**
 * What the terminal sends on its own rather than from the user's keys: focus
 * reports (an agent that asks for them gets one each time its tab is opened),
 * mouse reports, and replies to the program's queries — cursor position, device
 * attributes, mode reports, OSC and DCS strings. None of them answers a wait.
 */
const TERMINAL_REPORT =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching escape sequences is the point
  /\x1b\[[IO]|\x1b\[<\d+;\d+;\d+[Mm]|\x1b\[M[\s\S]{3}|\x1b\[\d+;\d+R|\x1b\[[?>]?[\d;]*c|\x1b\[\??[\d;]+\$y|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1bP[\s\S]*?\x1b\\/g;

/** True when `data` holds something the user typed, not only terminal reports. */
export function isUserInput(data: string): boolean {
  return data.replace(TERMINAL_REPORT, "").length > 0;
}

/** Report what was written to a pane; terminal-generated reports are not the user typing. */
export function signalPaneInput(paneId: string, data: string): void {
  if (isUserInput(data)) {
    listener?.paneInput(paneId);
  }
}

export function signalSurfaceReady(post: (message: ExtensionToWebViewMessage) => void): void {
  listener?.surfaceReady(post);
}
