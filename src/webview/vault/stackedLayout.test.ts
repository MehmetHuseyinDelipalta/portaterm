// @vitest-environment jsdom
//
// The layout-axis read. Extracted from the bootstrap so it can be verified at
// all — see the module comment.

import { describe, expect, it } from "vitest";
import { isStackedLayout } from "./stackedLayout";

function layoutWith(className: string): HTMLElement {
  const el = document.createElement("div");
  el.className = className;
  return el;
}

describe("[2_1] the layout axis", () => {
  it("knows which layouts stack", () => {
    expect(isStackedLayout(layoutWith("file-tree--top"))).toBe(true);
    expect(isStackedLayout(layoutWith("file-tree--bottom"))).toBe(true);
    expect(isStackedLayout(layoutWith("file-tree--left"))).toBe(false);
    expect(isStackedLayout(layoutWith("file-tree--right"))).toBe(false);
  });
});
