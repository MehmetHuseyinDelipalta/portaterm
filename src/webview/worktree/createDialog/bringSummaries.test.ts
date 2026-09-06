// src/webview/worktree/createDialog/bringSummaries.test.ts — The flat row list,
// what survives a reminted offer, and the sentences that summarise both.
//
// NO environment pragma. `vitest.config.mts` sets no environment and no match
// rule, so the node default applies and `document` is undefined here — a DOM
// reference creeping into `bringSummaries.ts` throws in whichever function
// holds it rather than passing quietly under the dialog suite's jsdom (OBL-3).
// Every export is exercised for that reason as much as for its assertion.

import { describe, expect, it } from "vitest";
import type { ProvisionEntry, ProvisionSetupStep } from "../../../types/messages";
import type { WorktreeProvisionOffer } from "../worktreeViewTypes";
import { type BringRow, bringRows, bringSummary, carryForward } from "./bringSummaries";

type Model = WorktreeProvisionOffer["model"];

const entry = (id: string, path: string, over: Partial<ProvisionEntry> = {}): ProvisionEntry =>
  ({ id, path, mode: "copy", ...over }) as ProvisionEntry;

const step = (id: string, script: string, over: Partial<ProvisionSetupStep> = {}): ProvisionSetupStep =>
  ({ id, script, ...over }) as ProvisionSetupStep;

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

const idsOf = (rows: readonly BringRow[]): string[] => rows.map((r) => r.id);

describe("the module is headless", () => {
  it("has no DOM to reach for", () => {
    expect(typeof globalThis.document).toBe("undefined");
  });
});

describe("the flat row list", () => {
  it("offers one row per item, entries before setup steps", () => {
    const m = model({
      entries: [entry("e1", ".env"), entry("e2", ".npmrc")],
      setup: [step("s1", "pnpm i")],
    });
    expect(idsOf(bringRows(m))).toEqual(["e1", "e2", "s1"]);
  });

  it("offers an entry checked and a suggested setup step unchecked", () => {
    const m = model({
      entries: [entry("e1", ".env")],
      setup: [step("s1", "pnpm i", { suggestion: "found a lockfile" })],
    });
    const rows = bringRows(m);
    expect(rows.find((r) => r.id === "e1")?.checked).toBe(true);
    // Opt-in: the host offered it, nobody configured it.
    expect(rows.find((r) => r.id === "s1")?.checked).toBe(false);
  });

  it("marks the member that yields to the repository's own declaration", () => {
    const m = model({
      entries: [entry("a", ".env"), entry("b", ".ENV")],
      contenders: [{ members: ["a", "b"], natives: ["a"] }],
    } as Partial<Model>);
    const rows = bringRows(m);
    // The loser starts unticked; unticking is what makes its group succeed.
    expect(rows.find((r) => r.id === "b")?.checked).toBe(false);
    expect(rows.find((r) => r.id === "a")?.checked).toBe(true);
  });
});

describe("what carries across a reminted offer (OBL-2)", () => {
  const before = model({ entries: [entry("e1", ".env"), entry("e2", ".npmrc")] });
  const after = model({ entries: [entry("j1", ".env"), entry("j2", ".npmrc")] });

  it("carries a TICK onto the row with the same descriptor under new ids", () => {
    const kept = new Set(["e1", "e2"]);
    expect([...carryForward(before, kept, bringRows(after), after)].sort()).toEqual(["j1", "j2"]);
  });

  it("carries an UNTICK too, which is the half the dialog suite does not assert", () => {
    // `e2` was deliberately unticked. If only ticks travelled, `j2` would come
    // back at its default — ON — and provision a file the user said no to.
    const kept = new Set(["e1"]);
    expect([...carryForward(before, kept, bringRows(after), after)]).toEqual(["j1"]);
  });

  it("gives a row nobody has seen its own default rather than a neighbour's answer", () => {
    const grown = model({ entries: [entry("j1", ".env"), entry("j3", ".tool-versions")] });
    const carried = carryForward(before, new Set(), bringRows(grown), grown);
    // `.env` was seen and unticked; `.tool-versions` is new, so it defaults ON.
    expect([...carried]).toEqual(["j3"]);
  });
});

describe("what the section says about itself", () => {
  it("counts the selection, not the offer", () => {
    const m = model({ entries: [entry("e1", ".env"), entry("e2", ".npmrc")] });
    expect(bringSummary(m, new Set(["e1", "e2"]))).toBe("2 copied");
    expect(bringSummary(m, new Set(["e1"]))).toBe("1 copied");
  });

  it("does not count a yielder whose favoured counterpart is still selected", () => {
    const m = model({
      entries: [entry("a", ".env"), entry("b", ".ENV")],
      contenders: [{ members: ["a", "b"], natives: ["a"] }],
    } as Partial<Model>);
    // Ticking the yielder back on does not make it arrive — the apply refuses
    // it — so the count says one even though two rows are ticked, and the
    // collision is stated beside it rather than folded into the number.
    expect(bringSummary(m, new Set(["a", "b"]))).toBe("1 copied · 2 spellings may be one file");
  });

  it("says the section is empty rather than going silent when nothing is selected", () => {
    const m = model({ entries: [entry("e1", ".env")] });
    // Not "" — an empty summary reads as a section still loading.
    expect(bringSummary(m, new Set())).toBe("Nothing configured");
  });
});
