// src/webview/worktree/createDialog/bringContention.test.ts — Which provisioning
// rows collide, and which of them yield.
//
// NO environment pragma, deliberately. `vitest.config.mts` sets no environment
// and no match rule, so the vitest default (node) applies and `document` is
// undefined here — a DOM reference creeping into `bringContention.ts` throws in
// whichever function holds it rather than passing quietly under the dialog
// suite's jsdom (OBL-3). Every export is exercised for that reason as much as
// for its own assertion: an unexercised function cannot throw.

import { describe, expect, it } from "vitest";
import type { ProvisionEntry } from "../../../types/messages";
import type { WorktreeProvisionOffer } from "../worktreeViewTypes";
import { bothOrAll, claimingPerGroup, contenderPartners, groupIndex, refusedEntire, yieldsTo } from "./bringContention";

type Model = WorktreeProvisionOffer["model"];

const entry = (id: string, path: string): ProvisionEntry => ({ id, path }) as ProvisionEntry;

function model(over: Partial<Model> = {}): Model {
  return {
    entries: [],
    setup: [],
    ports: [],
    providers: [],
    excluded: [],
    contenders: [],
    problems: [],
    ...over,
  } as Model;
}

/** One group of `members`, of which `natives` are the repository's own. */
const contest = (members: string[], natives: string[]) => ({ members, natives });

const twoSpellings = model({
  entries: [entry("a", ".env"), entry("b", ".ENV")],
  contenders: [contest(["a", "b"], ["a"])],
});

describe("the module is headless", () => {
  it("has no DOM to reach for", () => {
    expect(typeof globalThis.document).toBe("undefined");
  });
});

describe("who yields to whom", () => {
  it("names the surviving spelling for the row that loses to it", () => {
    const losers = yieldsTo(twoSpellings, new Set(["a", "b"]));
    expect(losers.get("b")).toEqual({ id: "a", path: ".env" });
    // The favoured declaration is not a loser to itself.
    expect(losers.has("a")).toBe(false);
  });

  it("names nobody while the repository's own declaration is unticked", () => {
    // Nothing claims priority, so nothing yields — the state the apply applies.
    expect(yieldsTo(twoSpellings, new Set(["b"])).size).toBe(0);
  });

  it("names nobody when more than one of the repository's own is selected", () => {
    const two = model({
      entries: [entry("a", ".env"), entry("b", ".ENV"), entry("c", ".Env")],
      contenders: [contest(["a", "b", "c"], ["a", "b"])],
    });
    // No single row can be unticked to rescue the group; `refusedEntire` carries it.
    expect(yieldsTo(two, new Set(["a", "b", "c"])).size).toBe(0);
  });
});

describe("what a group is refused entire", () => {
  it("refuses every member once two of the repository's own are selected", () => {
    const two = model({
      entries: [entry("a", ".env"), entry("b", ".ENV"), entry("c", ".Env")],
      contenders: [contest(["a", "b", "c"], ["a", "b"])],
    });
    expect([...refusedEntire(two, new Set(["a", "b", "c"]))].sort()).toEqual(["a", "b", "c"]);
    // Unticking one settles it — the refusal is read from the SELECTION, not the offer.
    expect(refusedEntire(two, new Set(["a", "c"])).size).toBe(0);
  });

  it("refuses nothing for a group with one declaration", () => {
    expect(refusedEntire(twoSpellings, new Set(["a", "b"])).size).toBe(0);
  });
});

describe("the selection each group still holds", () => {
  it("reports the repository's own declarations that are still ticked", () => {
    const two = model({
      entries: [entry("a", ".env"), entry("b", ".ENV")],
      contenders: [contest(["a", "b"], ["a", "b"])],
    });
    expect(claimingPerGroup(two, new Set(["a", "b"]))).toEqual([["a", "b"]]);
    expect(claimingPerGroup(two, new Set(["b"]))).toEqual([["b"]]);
    expect(claimingPerGroup(two, new Set())).toEqual([[]]);
  });
});

describe("the spellings a row may collide with", () => {
  it("lists each member's partners by path, never itself", () => {
    const partners = contenderPartners(twoSpellings);
    expect(partners.get("a")).toEqual([".ENV"]);
    expect(partners.get("b")).toEqual([".env"]);
  });
});

describe("which group an entry belongs to", () => {
  it("carries the index and whether the entry is the repository's own", () => {
    const at = groupIndex(twoSpellings);
    expect(at.get("a")).toEqual({ group: 0, native: true });
    expect(at.get("b")).toEqual({ group: 0, native: false });
    expect(at.has("missing")).toBe(false);
  });
});

describe("how a set of paths is said", () => {
  it("says both for two and all for more", () => {
    expect(bothOrAll([".env", ".ENV"])).toBe(".env and .ENV are both selected");
    expect(bothOrAll([".env", ".ENV", ".Env"])).toBe(".env, .ENV and .Env are all selected");
  });
});
