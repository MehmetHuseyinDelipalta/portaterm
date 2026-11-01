// src/session/ScrollbackCache.test.ts — bounded recent output: oldest pieces
// dropped first, small writes joined, the backing array kept small (perf A5).

import { describe, expect, it } from "vitest";
import { COALESCE_CHARS, ScrollbackCache } from "./ScrollbackCache";

describe("ScrollbackCache", () => {
  it("keeps what was written, in order, and its size", () => {
    const cache = new ScrollbackCache(100);
    cache.append("hello ");
    cache.append("world");
    expect(cache.text()).toBe("hello world");
    expect(cache.size).toBe(11);
  });

  it("starts and clears to nothing", () => {
    const cache = new ScrollbackCache(100);
    expect(cache.text()).toBe("");
    expect(cache.size).toBe(0);
    cache.append("abc");
    cache.clear();
    expect(cache.text()).toBe("");
    expect(cache.size).toBe(0);
    expect(cache.pieceCount).toBe(0);
    cache.append("d");
    expect(cache.text()).toBe("d");
  });

  it("joins small writes into one piece, up to the coalescing bound", () => {
    const cache = new ScrollbackCache(1_000_000);
    cache.append("a".repeat(COALESCE_CHARS - 1));
    cache.append("b");
    expect(cache.pieceCount).toBe(1); // exactly at the bound: joined
    cache.append("c");
    expect(cache.pieceCount).toBe(2); // past it: a new piece
    expect(cache.text()).toBe(`${"a".repeat(COALESCE_CHARS - 1)}bc`);
  });

  it("drops whole oldest pieces until within the bound", () => {
    const cache = new ScrollbackCache(524_288);
    cache.append("x".repeat(520_000));
    cache.append("y".repeat(10_000));
    expect(cache.size).toBe(10_000);
    expect(cache.text()).toBe("y".repeat(10_000));
  });

  it("keeps exactly the bound", () => {
    const cache = new ScrollbackCache(COALESCE_CHARS * 2);
    cache.append("a".repeat(COALESCE_CHARS));
    cache.append("b".repeat(COALESCE_CHARS));
    expect(cache.size).toBe(COALESCE_CHARS * 2);
    cache.append("c");
    expect(cache.text()).toBe(`${"b".repeat(COALESCE_CHARS)}c`);
  });

  it("drops a single write larger than the bound, as it drops any oldest piece", () => {
    const cache = new ScrollbackCache(10);
    cache.append("0123456789ABC");
    expect(cache.text()).toBe("");
    expect(cache.size).toBe(0);
  });

  it("does not join a write onto a piece already dropped", () => {
    const cache = new ScrollbackCache(COALESCE_CHARS);
    cache.append("a".repeat(COALESCE_CHARS));
    cache.append("b".repeat(COALESCE_CHARS)); // drops the a's
    cache.append("c".repeat(COALESCE_CHARS)); // drops the b's
    cache.append("d");
    expect(cache.text()).toBe("d");
  });

  it("holds a bounded array however many tiny writes arrive", () => {
    const max = 512 * 1024;
    const cache = new ScrollbackCache(max);
    for (let i = 0; i < 200_000; i++) {
      cache.append(`frame ${i % 10}\r`);
    }
    expect(cache.size).toBeLessThanOrEqual(max);
    expect(cache.size).toBeGreaterThan(max - COALESCE_CHARS);
    expect(cache.pieceCount).toBeLessThanOrEqual(2 * Math.ceil(max / COALESCE_CHARS) + 2);
    expect(cache.text().endsWith("frame 9\r")).toBe(true);
  });

  it("compacts once the dropped pieces outweigh the kept ones", () => {
    const cache = new ScrollbackCache(COALESCE_CHARS * 2);
    for (const fill of ["a", "b", "c", "d"]) {
      cache.append(fill.repeat(COALESCE_CHARS));
    }
    expect(cache.pieceCount).toBe(2);
    expect(cache.text()).toBe(`${"c".repeat(COALESCE_CHARS)}${"d".repeat(COALESCE_CHARS)}`);
  });

  it("leaves dropped pieces in place until they outweigh the kept ones", () => {
    const cache = new ScrollbackCache(COALESCE_CHARS * 3);
    for (const fill of ["a", "b", "c", "d"]) {
      cache.append(fill.repeat(COALESCE_CHARS));
    }
    expect(cache.pieceCount).toBe(4); // one dropped, three kept: no copy yet
    expect(cache.text()).toBe(["b", "c", "d"].map((f) => f.repeat(COALESCE_CHARS)).join(""));
  });

  it("clears pieces it had dropped but not yet compacted away", () => {
    const cache = new ScrollbackCache(COALESCE_CHARS * 3);
    for (const fill of ["a", "b", "c", "d"]) {
      cache.append(fill.repeat(COALESCE_CHARS));
    }
    cache.clear();
    cache.append("e");
    expect(cache.text()).toBe("e");
    expect(cache.size).toBe(1);
  });

  it("joins 4 KB at most", () => {
    expect(COALESCE_CHARS).toBe(4096);
  });
});
