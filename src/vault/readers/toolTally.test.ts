import { describe, expect, it } from "vitest";
import { createToolTally, toolStats } from "./toolTally";

describe("createToolTally", () => {
  it("counts each call by name, most-called first, ties by name", () => {
    const tally = createToolTally();
    for (const name of ["Read", "Bash", "Edit", "Bash", "Read", "Bash", "Grep"]) {
      tally.add(name);
    }
    expect(tally.result()).toEqual([
      { name: "Bash", count: 3 },
      { name: "Read", count: 2 },
      { name: "Edit", count: 1 },
      { name: "Grep", count: 1 },
    ]);
  });

  it("is empty before any call", () => {
    expect(createToolTally().result()).toEqual([]);
  });
});

describe("toolStats", () => {
  it("adds the breakdown only when a tool was called", () => {
    expect(toolStats([{ name: "Bash", count: 1 }])).toEqual({ tools: [{ name: "Bash", count: 1 }] });
    expect(toolStats([])).toEqual({});
  });
});
