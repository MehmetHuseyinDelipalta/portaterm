// @vitest-environment jsdom

// Live follow draws a push by extending the transcript on screen (D2): the
// nodes already there stay, only the last unit is drawn again, and the result
// is what a full render of the same transcript draws.

import { afterEach, describe, expect, it } from "vitest";
import type { VaultSessionDetail, VaultSessionEntry, VaultTimelineItem } from "../../vault/types";
import { resetTooltipForTests } from "../ui/Tooltip";
import { VaultPanel } from "./VaultPanel";

afterEach(() => {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  resetTooltipForTests();
  document.body.replaceChildren();
});

const MODIFIED = Date.now();
const ENTRY: VaultSessionEntry = {
  id: "claude:a",
  agent: "claude",
  sessionId: "a",
  title: "session",
  cwd: "/work/repo",
  modified: MODIFIED,
  flags: {},
};

const user = (text: string): VaultTimelineItem => ({ kind: "message", role: "user", text });
const reply = (text: string): VaultTimelineItem => ({ kind: "message", role: "assistant", text });
const tool = (name: string): VaultTimelineItem => ({ kind: "tool", tool: name });
const turns = (n: number, tag = "t"): VaultTimelineItem[] =>
  Array.from({ length: n }, (_, i) => (i % 2 === 0 ? user(`${tag}${i}`) : reply(`${tag}${i}`)));

function detail(timeline: VaultTimelineItem[], over: Partial<VaultSessionDetail> = {}): VaultSessionDetail {
  return {
    entryId: ENTRY.id,
    contentKind: "timeline",
    recentActivity: [],
    timeline,
    stats: { messageCount: timeline.length, toolCount: 0, subagentCount: 0 },
    ...over,
  };
}

function open(initial: VaultSessionDetail) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const posted: Array<{ type: string; limit?: number }> = [];
  const panel = new VaultPanel({ host, postMessage: (m) => posted.push(m), getInitialCollapsed: () => false });
  panel.render({ entries: [ENTRY], unreadable: { count: 0, reasons: [] } });
  host.querySelector<HTMLElement>(".vault-row")?.click();
  panel.handleSessionDetailResponse({ type: "vaultSessionDetailResponse", entryId: ENTRY.id, detail: initial });
  const body = () => host.querySelector<HTMLElement>(".vault-preview-body");
  const follow = (d: VaultSessionDetail) =>
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: ENTRY.id,
      followUpdate: true,
      detail: d,
    });
  const respond = (d: VaultSessionDetail) =>
    panel.handleSessionDetailResponse({ type: "vaultSessionDetailResponse", entryId: ENTRY.id, detail: d });
  return { host, panel, posted, body, follow, respond };
}

/** Drawn HTML without the one-shot "just arrived" flash only a follow push adds. */
const withoutFlash = (html: string | undefined) => (html ?? "").replaceAll(" is-fresh", "");

/** The body a full render of `d` draws, for comparison. */
function fullRender(d: VaultSessionDetail): string {
  const view = open(d);
  const html = view.body()?.innerHTML ?? "";
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  view.host.remove();
  return html;
}

const texts = (body: HTMLElement | null) =>
  Array.from(body?.querySelectorAll<HTMLElement>(".vault-preview-message") ?? []).map((el) =>
    (el.textContent ?? "").replace(/^(User|Assistant)/, ""),
  );

describe("live follow draws only what changed", () => {
  it("keeps the nodes already on screen and appends the new ones", () => {
    const { body, follow } = open(detail(turns(6)));
    const bodyBefore = body();
    const firstBefore = bodyBefore?.querySelector(".vault-preview-message");

    follow(detail([...turns(6), user("new question"), reply("new answer")]));

    expect(body()).toBe(bodyBefore);
    expect(bodyBefore?.querySelector(".vault-preview-message")).toBe(firstBefore);
    expect(texts(body()).slice(-2)).toEqual(["new question", "new answer"]);
  });

  it("draws exactly what a full render draws, when the new items extend the last run", () => {
    const start = [user("go"), reply("on it"), tool("Read"), tool("Grep")];
    const grown = [...start, tool("Edit"), tool("Bash"), reply("done")];
    const { body, follow } = open(detail(start));

    follow(detail(grown));

    expect(body()?.querySelector(".vault-preview-expand")?.textContent).toMatch(/Show \d+ more step/);
    expect(withoutFlash(body()?.innerHTML)).toBe(fullRender(detail(grown)));
  });

  it("keeps a run the reader expanded expanded after it grows", () => {
    const start = [user("go"), tool("A"), tool("B"), tool("C"), tool("D")];
    const { body, follow } = open(detail(start));
    body()?.querySelector<HTMLElement>(".vault-preview-expand")?.click();
    expect(body()?.querySelector(".vault-preview-expand")).toBeNull();

    follow(detail([...start, tool("E")]));

    expect(body()?.querySelector(".vault-preview-expand")).toBeNull();
    expect(body()?.textContent).toContain("E");
  });

  it("keeps history that slid out of the push's window, and asks for at least it on the next load", () => {
    const shown = turns(40);
    const { body, follow, posted, host } = open(detail(shown, { truncated: true }));

    follow(detail([...shown.slice(5), user("n1"), reply("n2")], { truncated: true }));

    expect(texts(body())).toEqual([...shown.map((t) => (t as { text: string }).text), "n1", "n2"]);
    host.querySelector<HTMLElement>(".vault-preview-loadmore")?.click();
    const request = posted.filter((m) => m.type === "requestVaultSessionDetail").at(-1);
    expect(request?.limit).toBeGreaterThanOrEqual(42);
  });

  it("keeps the whole transcript, and no load-older control, when its start slides out of the push's window", () => {
    // The push is a bounded window, so it reports `truncated` once the session
    // outgrows it — but what is on screen still starts at the first message.
    const shown = turns(40);
    const { body, follow } = open(detail(shown));
    const bodyBefore = body();

    follow(detail([...shown.slice(2), user("n1"), reply("n2")], { truncated: true }));

    expect(body()).toBe(bodyBefore);
    expect(texts(body())).toHaveLength(42);
    expect(body()?.querySelector(".vault-preview-loadmore")).toBeNull();
  });

  it("asks a later load for more than everything on screen, past the default window", () => {
    const shown = turns(410);
    const { follow, posted, host } = open(detail(shown, { truncated: true }));

    follow(detail([...shown.slice(5), user("n1"), reply("n2")], { truncated: true }));
    host.querySelector<HTMLElement>(".vault-preview-loadmore")?.click();

    const request = posted.filter((m) => m.type === "requestVaultSessionDetail").at(-1);
    expect(request?.limit).toBeGreaterThanOrEqual(412 + 400);
  });

  it("does not draw anything again when the same push arrives twice", () => {
    const { body, follow } = open(detail(turns(6)));
    const grown = detail([...turns(6), reply("x")]);
    follow(grown);
    const bodyAfterFirst = body();
    const last = bodyAfterFirst?.lastElementChild;

    follow(grown);

    expect(body()).toBe(bodyAfterFirst);
    expect(bodyAfterFirst?.lastElementChild).toBe(last);
  });

  it("does not write into a transcript that is no longer on screen", () => {
    const { host, body, follow, respond } = open(detail(turns(6), { truncated: true }));
    host.querySelector<HTMLElement>(".vault-preview-loadmore")?.click();
    respond({ ...detail([]), error: "boom" } as never); // the load failed: an error body replaces the transcript
    const errorBody = body();

    follow(detail([...turns(6), reply("x")], { truncated: true }));

    expect(body()).not.toBe(errorBody);
    expect(texts(body()).at(-1)).toBe("x");
  });

  it("draws in full when the last unit's first node was replaced under it", () => {
    const { body, follow } = open(detail([user("go"), reply("a")]));
    const lastFirst = body()?.lastElementChild;
    lastFirst?.replaceWith(lastFirst.cloneNode(true));

    follow(detail([user("go"), reply("a"), reply("b")]));

    expect(texts(body())).toEqual(["go", "a", "b"]);
  });

  it("keeps a later run the reader expanded expanded after it grows", () => {
    const run = (tag: string) => [tool(`${tag}1`), tool(`${tag}2`), tool(`${tag}3`), tool(`${tag}4`)];
    const start = [user("one"), ...run("A"), user("two"), ...run("B")];
    const { body, follow } = open(detail(start));
    const buttons = body()?.querySelectorAll<HTMLElement>(".vault-preview-expand");
    expect(buttons).toHaveLength(2);
    buttons?.[1].click(); // the second run

    follow(detail([...start, tool("B5")]));

    // The first run is still collapsed, the second still expanded.
    expect(body()?.querySelectorAll(".vault-preview-expand")).toHaveLength(1);
    expect(body()?.textContent).toContain("B5");
    expect(body()?.textContent).toContain("B2");
  });

  it("moves the flash to the newest message when the transcript ends past it", () => {
    // A gap breaks the run and is not a message, so the newest message sits in an
    // earlier unit than the one a push redraws.
    const gap: VaultTimelineItem = { kind: "gap" };
    const { body, follow } = open(detail([user("go")]));
    follow(detail([user("go"), reply("r1"), gap]));
    follow(detail([user("go"), reply("r1"), gap, reply("r2"), gap]));

    const fresh = body()?.querySelectorAll(".is-fresh");
    expect(fresh).toHaveLength(1);
    expect(fresh?.[0].textContent).toContain("r2");
  });

  it("draws in full when the partial notice's text would change", () => {
    const reason = (r: string) => ({ partial: true, limitedReason: r });
    const { body, follow } = open(detail(turns(4), reason("first reason")));
    const bodyBefore = body();

    follow(detail([...turns(4), reply("x")], reason("second reason")));

    expect(body()).not.toBe(bodyBefore);
    expect(body()?.textContent).toContain("second reason");
  });

  it("draws in full when an earlier item changed", () => {
    const shown = turns(20);
    const { body, follow } = open(detail(shown));
    const bodyBefore = body();
    const changed = [...shown, reply("new")];
    changed[4] = user("rewritten");

    follow(detail(changed));

    expect(body()).not.toBe(bodyBefore);
    expect(texts(body())[4]).toBe("rewritten");
  });

  it("draws in full when the load-older control would change", () => {
    const { body, follow } = open(detail(turns(4)));
    const bodyBefore = body();

    follow(detail([...turns(4), reply("x")], { truncated: true }));

    expect(body()).not.toBe(bodyBefore);
    expect(body()?.querySelector(".vault-preview-loadmore")).not.toBeNull();
  });

  it("draws in full when the partial notice would change", () => {
    const { body, follow } = open(detail(turns(4)));
    const bodyBefore = body();

    follow(
      detail([...turns(4), reply("x")], { partial: true, limitedReason: "Only part of this session could be read." }),
    );

    expect(body()).not.toBe(bodyBefore);
    expect(body()?.textContent).toContain("Only part of this session could be read.");
  });

  it("refreshes the header from the push", () => {
    const { host, follow } = open(detail(turns(4)));
    const headerBefore = host.querySelector(".vault-preview-header");

    follow(detail([...turns(4), reply("x")], { stats: { messageCount: 4242, toolCount: 0, subagentCount: 0 } }));

    const header = host.querySelector(".vault-preview-header");
    expect(header).not.toBe(headerBefore);
    expect(header?.textContent).toContain("4242");
  });

  it("leaves a title being edited alone", () => {
    const { host, follow } = open(detail(turns(4)));
    host
      .querySelector<HTMLElement>(".vault-preview-title")
      ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const input = host.querySelector<HTMLInputElement>(".vault-preview-header .vault-row-rename-input");
    if (!input) {
      throw new Error("rename input missing");
    }
    input.value = "half-typed";

    follow(detail([...turns(4), reply("x")]));

    expect(host.querySelector<HTMLInputElement>(".vault-preview-header .vault-row-rename-input")?.value).toBe(
      "half-typed",
    );
    expect(texts(host.querySelector(".vault-preview-body")).at(-1)).toBe("x");
  });

  it("counts appended items on the pill when the reader is scrolled up", () => {
    const { host, body, follow } = open(detail(turns(10)));
    const el = body();
    if (!el) {
      throw new Error("body missing");
    }
    Object.defineProperty(el, "scrollHeight", { configurable: true, value: 2000 });
    Object.defineProperty(el, "clientHeight", { configurable: true, value: 300 });
    el.scrollTop = 100;

    follow(detail([...turns(10), user("a"), reply("b"), user("c")]));

    expect(host.querySelector(".is-visible")?.textContent ?? "").toContain("3 new messages");
    expect(el.scrollTop).toBe(100);
  });

  it("keeps working push after push", () => {
    const { body, follow } = open(detail(turns(4)));
    const bodyBefore = body();
    let timeline = turns(4);
    for (let i = 0; i < 5; i++) {
      timeline = [...timeline, user(`q${i}`), tool("Read"), reply(`a${i}`)];
      follow(detail(timeline));
    }
    expect(body()).toBe(bodyBefore); // never fell back to a full render
    // Only the newest message carries the flash.
    expect(body()?.querySelectorAll(".is-fresh")).toHaveLength(1);
    expect(body()?.querySelector(".is-fresh")?.textContent).toContain("a4");
    expect(withoutFlash(body()?.innerHTML)).toBe(fullRender(detail(timeline)));
  });
});

describe("scroll to the first message", () => {
  const users = (n: number, first: string) => Array.from({ length: n }, (_, i) => user(i === 0 ? first : `m${i}`));

  it("draws once, when the walk stops, not at every window", () => {
    const { host, body, respond, posted } = open(detail(users(1, "m0"), { truncated: true }));
    const requests = () => posted.filter((m) => m.type === "requestVaultSessionDetail").length;
    host.querySelector<HTMLElement>(".vault-preview-scroll-top")?.click();
    const bodyDuringWalk = body();

    respond(detail(users(2, "m0"), { truncated: true }));
    respond(detail(users(3, "m0"), { truncated: true }));
    expect(requests()).toBe(4);
    expect(body()).toBe(bodyDuringWalk); // nothing redrawn mid-walk
    expect(texts(body())).toEqual(["m0"]);

    respond(detail(users(4, "FIRST"), { truncated: false }));
    expect(body()).not.toBe(bodyDuringWalk);
    expect(texts(body())).toEqual(["FIRST", "m1", "m2", "m3"]);
    expect(body()?.scrollTop).toBe(0);
  });

  it("draws the last window when the host stops returning more", () => {
    const { host, body, respond } = open(detail(users(2, "m0"), { truncated: true }));
    host.querySelector<HTMLElement>(".vault-preview-scroll-top")?.click();
    respond(detail(users(3, "m0"), { truncated: true }));
    respond(detail(users(3, "CAPPED"), { truncated: true })); // did not grow: the walk ends here
    expect(texts(body())[0]).toBe("CAPPED");
  });

  it("does not let a follow push extend a transcript the walk has not drawn", () => {
    const { host, body, respond, follow } = open(detail(users(2, "m0"), { truncated: true }));
    host.querySelector<HTMLElement>(".vault-preview-scroll-top")?.click();
    respond(detail(users(3, "m0"), { truncated: true }));
    follow(detail([...users(3, "m0"), reply("late")], { truncated: true })); // ignored mid-walk
    respond(detail(users(4, "FIRST"), { truncated: false }));
    expect(texts(body())).toEqual(["FIRST", "m1", "m2", "m3"]);
  });
});
