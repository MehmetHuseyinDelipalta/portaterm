// @vitest-environment jsdom
//
// src/webview/worktree/worktreeView/actionNotices.test.ts — OBL-3: a dropped
// result's dismiss timer is CANCELLED, not merely left with nothing to do.
//
// "Advance the clock and assert nothing was dismissed" would pass either way:
// the callback looks the result up and finds it gone. So these assert the
// cancellation itself — the map entry and the live timer count.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorktreeViewData } from "../WorktreeView";
import type { WorktreeActionResult } from "../worktreeViewTypes";
import { type ActionNotices, createActionNotices, resultKey } from "./actionNotices";

let host: HTMLElement;
let notices: ActionNotices;
let data: WorktreeViewData;

/** A create that succeeded: the one shape `armAutoDismiss` gives a countdown. */
const result = (worktreeId: string): WorktreeActionResult =>
  ({ action: "create", outcome: "ok", worktreeId, title: worktreeId }) as unknown as WorktreeActionResult;

function place(...results: WorktreeActionResult[]): void {
  data = { ...data, actionResults: results };
  notices.placeResults();
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.replaceChildren();
  host = document.createElement("div");
  document.body.append(host);
  data = { tree: null, presence: null } as unknown as WorktreeViewData;
  notices = createActionNotices({
    data: () => data,
    element: () => host,
    disposed: () => false,
    view: { onDismissActionResult: () => {} } as never,
    repoOf: () => undefined,
    repoAnchors: new Map(),
    renderedWorktreeRows: () => new Map(),
    openRemoveReport: () => {},
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("auto-dismiss", () => {
  it("arms one timer per result and places a notice for each", () => {
    place(result("w1"), result("w2"));
    expect(notices.armedKeys()).toHaveLength(2);
    expect(host.children.length).toBe(2);
  });

  it("cancels the timer of a result that is no longer there (OBL-3)", () => {
    place(result("w1"), result("w2"));
    const armedBefore = vi.getTimerCount();
    expect(armedBefore).toBeGreaterThanOrEqual(2);

    // The next push carries only one of them.
    place(result("w1"));

    // The key that SURVIVED, not how many did: a count is also satisfied by
    // cancelling the wrong one (.reviews/round-1.md F003).
    expect(notices.armedKeys()).toEqual([resultKey(result("w1"))]);
    // The handle itself is gone, which is the half "nothing ran" cannot see.
    expect(vi.getTimerCount()).toBeLessThan(armedBefore);
  });

  it("does not re-arm a result that is still there, so its countdown is not restarted", () => {
    place(result("w1"));
    const armed = notices.armedKeys();
    vi.advanceTimersByTime(4000);

    place(result("w1"));
    expect(notices.armedKeys()).toEqual(armed);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("clears every armed timer on dispose, which is all the view's dispose does now", () => {
    place(result("w1"), result("w2"));
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    notices.dispose();

    expect(notices.armedKeys()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
