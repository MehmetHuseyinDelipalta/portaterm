import { describe, expect, it } from "vitest";
import { TAB_ICONS } from "../shared/tabAppearance";
import { tabIconSvg } from "./tabIcons";

describe("tabIconSvg", () => {
  it("has a distinct, currentColor-stroked glyph for every listed icon", () => {
    const glyphs = TAB_ICONS.map(({ id }) => tabIconSvg(id));
    for (const glyph of glyphs) {
      expect(glyph).toMatch(/^<svg [^>]*stroke="currentColor"[^>]*aria-hidden="true">.+<\/svg>$/);
    }
    expect(new Set(glyphs).size).toBe(TAB_ICONS.length);
  });

  it("is undefined for none and for an id this build does not know", () => {
    expect(tabIconSvg(undefined)).toBeUndefined();
    expect(tabIconSvg("unicorn")).toBeUndefined();
    // Not an own key of the glyph table either.
    expect(tabIconSvg("constructor")).toBeUndefined();
  });
});
