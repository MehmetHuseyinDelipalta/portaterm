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

export function signalPaneInput(paneId: string): void {
  listener?.paneInput(paneId);
}

export function signalSurfaceReady(post: (message: ExtensionToWebViewMessage) => void): void {
  listener?.surfaceReady(post);
}
