// src/webview/terminal/userInputSignal.ts — Was this `onData` chunk typed by the user?
//
// xterm's public `onData` carries two kinds of traffic on one channel: what the
// user typed or pasted, and replies the terminal sends by itself — cursor
// position and device-attribute reports, focus in/out, mouse reports, the
// wheel's arrow keys in the alternate screen. Broadcast input may only mirror
// the first kind: a reply answers one program's query, and in another pane it
// is a stray keystroke.
//
// Two signals, both needed:
// - `coreService.onUserInput` (private API) fires synchronously right before
//   `onData` for every chunk xterm flags `wasUserInput` — and never for its own
//   reports. That alone still admits mouse reports and wheel scrolling, which
//   xterm also flags as user input.
// - So the last DOM event that reached the pane must be a keyboard-family one
//   (key, paste, IME composition), not a pointer one. xterm emits from inside
//   those handlers (composition from a timer right after `compositionend`), so
//   a capture listener on the pane's container has always seen the event first.
//
// All xterm private API access for this is isolated here. If a future xterm
// drops `onUserInput`, nothing is classified as typed: broadcasting degrades to
// sending only to the focused pane, never to mirroring terminal replies.

import type { Terminal } from "@xterm/xterm";

export interface UserInputSignal {
  /** Call once per `onData` chunk: true when that chunk was typed or pasted. */
  consume(): boolean;
  dispose(): void;
}

const KEYBOARD_EVENTS = ["keydown", "keypress", "paste", "compositionstart", "compositionend", "beforeinput"] as const;
const POINTER_EVENTS = ["mousedown", "mouseup", "mousemove", "wheel", "touchstart", "touchmove"] as const;

interface Disposable {
  dispose(): void;
}

type OnUserInput = (listener: () => void) => Disposable;

/** The private `coreService.onUserInput` event, or undefined if this xterm has none. */
function userInputEvent(terminal: Terminal): OnUserInput | undefined {
  // xterm private API — intentional
  const event = (terminal as unknown as { _core?: { coreService?: { onUserInput?: unknown } } })._core?.coreService
    ?.onUserInput;
  return typeof event === "function" ? (event as OnUserInput) : undefined;
}

let warnedMissing = false;

export function trackUserInput(terminal: Terminal, container: HTMLElement): UserInputSignal {
  const onUserInput = userInputEvent(terminal);
  if (!onUserInput) {
    if (!warnedMissing) {
      warnedMissing = true;
      console.warn("[Portaterm] xterm has no onUserInput; broadcast input will reach only the focused pane");
    }
    return { consume: () => false, dispose: () => {} };
  }

  let flaggedUserInput = false;
  let lastOrigin: "keyboard" | "pointer" = "keyboard";
  const subscription = onUserInput(() => {
    flaggedUserInput = true;
  });
  const fromKeyboard = (): void => {
    lastOrigin = "keyboard";
  };
  const fromPointer = (): void => {
    lastOrigin = "pointer";
  };
  for (const type of KEYBOARD_EVENTS) {
    container.addEventListener(type, fromKeyboard, true);
  }
  for (const type of POINTER_EVENTS) {
    container.addEventListener(type, fromPointer, { capture: true, passive: true });
  }

  return {
    consume: () => {
      const typed = flaggedUserInput && lastOrigin === "keyboard";
      flaggedUserInput = false;
      return typed;
    },
    dispose: () => {
      subscription.dispose();
      for (const type of KEYBOARD_EVENTS) {
        container.removeEventListener(type, fromKeyboard, true);
      }
      for (const type of POINTER_EVENTS) {
        container.removeEventListener(type, fromPointer, true);
      }
    },
  };
}
