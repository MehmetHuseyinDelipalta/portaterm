// src/webview/vault/format.test.ts — Folder-scope path containment.

import { describe, expect, it } from "vitest";
import { isWithin } from "./format";

describe("isWithin", () => {
  it("matches the folder itself and its subtree, not a sibling prefix", () => {
    expect(isWithin("/a/b", "/a/b")).toBe(true);
    expect(isWithin("/a/b/c", "/a/b/")).toBe(true);
    expect(isWithin("/a/bc", "/a/b")).toBe(false);
    expect(isWithin("/a", "/")).toBe(true);
  });

  it("matches a composed path against the same folder reported decomposed", () => {
    const composed = "/work/0- PHP-8 Geçişi";
    const decomposed = "/work/0- PHP-8 Geçişi";
    expect(isWithin(composed, decomposed)).toBe(true);
    expect(isWithin(`${composed}/best.sinavkoleji.k12.tr`, decomposed)).toBe(true);
    expect(isWithin(decomposed, composed)).toBe(true);
  });
});
