import { describe, expect, it } from "vitest";
import type { VaultTimelineItem } from "../../vault/types";
import { MIN_FOLLOW_OVERLAP, mergeFollowTimeline } from "./followMerge";

const user = (text: string): VaultTimelineItem => ({ kind: "message", role: "user", text });
const reply = (text: string): VaultTimelineItem => ({ kind: "message", role: "assistant", text });
const tool = (name: string, detail?: string): VaultTimelineItem => ({
  kind: "tool",
  tool: name,
  ...(detail ? { detail } : {}),
});

/** `n` distinct turns: user, reply, user, reply… */
const turns = (n: number, tag = "t"): VaultTimelineItem[] =>
  Array.from({ length: n }, (_, i) => (i % 2 === 0 ? user(`${tag}${i}`) : reply(`${tag}${i}`)));

describe("mergeFollowTimeline", () => {
  it("appends what the push adds when it drops nothing", () => {
    const shown = turns(4);
    const merge = mergeFollowTimeline(shown, [...shown, reply("new")], 3);
    expect(merge).toEqual({ timeline: [...shown, reply("new")], dropped: 0, added: 1 });
  });

  it("keeps the shown top when the push's window has slid past it", () => {
    const shown = turns(40);
    const next = [...shown.slice(3), user("n1"), reply("n2"), user("n3")];
    const merge = mergeFollowTimeline(shown, next, 39);
    expect(merge?.dropped).toBe(3);
    expect(merge?.added).toBe(3);
    expect(merge?.timeline).toEqual([...shown, user("n1"), reply("n2"), user("n3")]);
  });

  it("keeps history the reader loaded beyond the push's window", () => {
    const shown = turns(800); // two windows loaded
    const next = [...shown.slice(401), reply("latest")]; // one window, ending at the new item
    const merge = mergeFollowTimeline(shown, next, 799);
    expect(merge?.dropped).toBe(401);
    expect(merge?.timeline).toEqual([...shown, reply("latest")]);
  });

  it("takes the last unit's items from the push, where they may have changed", () => {
    // The last unit is a run starting at index 2; its tool call completed since.
    const shown = [user("u"), reply("r"), tool("Bash", "running"), tool("Read")];
    const next = [user("u"), reply("r"), tool("Bash", "done"), tool("Read"), tool("Edit")];
    const merge = mergeFollowTimeline(shown, next, 1);
    expect(merge?.timeline).toEqual(next);
    expect(merge?.added).toBe(1);
  });

  it("refuses when an item before the last unit changed", () => {
    const shown = turns(20);
    const next = [...shown, reply("new")];
    next[5] = reply("edited");
    expect(mergeFollowTimeline(shown, next, 19)).toBeNull();
  });

  it("refuses when the oldest item of the overlap changed", () => {
    const shown = turns(20);
    const next = [...shown, reply("new")];
    next[0] = user("edited");
    expect(mergeFollowTimeline(shown, next, 19)).toBeNull();
  });

  it("refuses when the first item of the last unit changed", () => {
    const shown = [user("u"), reply("r"), tool("Bash")];
    expect(mergeFollowTimeline(shown, [user("u"), reply("changed"), tool("Bash"), tool("Read")], 1)).toBeNull();
  });

  it("refuses a push that has nothing new", () => {
    const shown = turns(10);
    expect(mergeFollowTimeline(shown, shown, 9)).toBeNull();
    expect(mergeFollowTimeline(shown, shown.slice(2), 9)).toBeNull();
  });

  it("accepts a push whose tail changed without growing", () => {
    const shown = [user("u"), tool("Read"), tool("Bash", "running")];
    const next = [user("u"), tool("Read"), tool("Bash", "done")];
    expect(mergeFollowTimeline(shown, next, 1)).toEqual({ timeline: next, dropped: 0, added: 0 });
  });

  it("does not trust a short overlap of a long transcript", () => {
    const shown = turns(100);
    // Only the last MIN_FOLLOW_OVERLAP - 1 shown items reappear: too few to trust.
    const tail = shown.slice(100 - (MIN_FOLLOW_OVERLAP - 1));
    expect(mergeFollowTimeline(shown, [...tail, reply("new")], 99)).toBeNull();
    // One more and it is enough.
    const enough = shown.slice(100 - MIN_FOLLOW_OVERLAP);
    expect(mergeFollowTimeline(shown, [...enough, reply("new")], 99)?.dropped).toBe(100 - MIN_FOLLOW_OVERLAP);
  });

  it("requires a short shown prefix to reappear whole", () => {
    const shown = [tool("ls"), user("u"), reply("r")];
    // `next` happens to start at shown[1]: a coincidence a 2-item overlap cannot rule out.
    expect(mergeFollowTimeline(shown, [user("u"), reply("r"), reply("new")], 2)).toBeNull();
    expect(mergeFollowTimeline(shown, [...shown, reply("new")], 2)?.dropped).toBe(0);
  });

  it("drops the fewest items it can when several alignments agree", () => {
    const same = Array.from({ length: 30 }, () => tool("ls"));
    const merge = mergeFollowTimeline(same, [...same, reply("new")], 29);
    expect(merge?.dropped).toBe(0);
    expect(merge?.timeline).toHaveLength(31);
  });

  it("refuses an out-of-range anchor or an empty push", () => {
    const shown = turns(4);
    expect(mergeFollowTimeline(shown, [...shown, reply("x")], -1)).toBeNull();
    expect(mergeFollowTimeline(shown, [...shown, reply("x")], 4)).toBeNull();
    expect(mergeFollowTimeline(shown, [], 3)).toBeNull();
  });
});
