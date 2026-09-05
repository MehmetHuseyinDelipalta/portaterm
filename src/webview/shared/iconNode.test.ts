// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { setIcon } from "./iconNode";

const GLYPH = '<svg viewBox="0 0 16 16"><path d="M1 1h14v14H1z"/></svg>';

describe("setIcon", () => {
  it("parses a glyph once, however many hosts receive it", () => {
    const hosts = Array.from({ length: 5 }, () => document.createElement("span"));
    const original = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    if (!original?.set) {
      throw new Error("jsdom lost innerHTML");
    }
    let parses = 0;
    const setter = original.set;
    Object.defineProperty(Element.prototype, "innerHTML", {
      ...original,
      set(this: Element, value: string) {
        parses += 1;
        setter.call(this, value);
      },
    });
    try {
      const glyph = `${GLYPH}<!-- unique per test: ${Math.random()} -->`;
      for (const host of hosts) {
        setIcon(host, glyph);
      }
    } finally {
      Object.defineProperty(Element.prototype, "innerHTML", original);
    }
    expect(parses).toBe(1);
    for (const host of hosts) {
      expect(host.firstElementChild?.tagName.toLowerCase()).toBe("svg");
    }
  });

  it("gives every host its own node, isolated from the others and from the template", () => {
    const a = document.createElement("span");
    const b = document.createElement("span");
    setIcon(a, GLYPH);
    setIcon(b, GLYPH);
    const svgA = a.firstElementChild as SVGElement;
    const svgB = b.firstElementChild as SVGElement;
    expect(svgA).not.toBe(svgB);
    expect(svgA.outerHTML).toBe(svgB.outerHTML);

    svgA.setAttribute("data-mutated", "1");
    expect(svgB.hasAttribute("data-mutated")).toBe(false);
    const c = document.createElement("span");
    setIcon(c, GLYPH);
    expect(c.firstElementChild?.hasAttribute("data-mutated")).toBe(false);
  });

  it("replaces whatever the host held, and empties it for markup with no element", () => {
    const host = document.createElement("span");
    host.textContent = "old";
    setIcon(host, GLYPH);
    expect(host.childNodes).toHaveLength(1);
    expect(host.textContent).toBe("");
    setIcon(host, "   ");
    expect(host.childNodes).toHaveLength(0);
  });

  it("renders the same markup innerHTML would", () => {
    const viaInner = document.createElement("span");
    viaInner.innerHTML = GLYPH;
    const viaIcon = document.createElement("span");
    setIcon(viaIcon, GLYPH);
    expect(viaIcon.innerHTML).toBe(viaInner.innerHTML);
    vi.restoreAllMocks();
  });
});
