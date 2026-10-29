// @vitest-environment jsdom

// Stars and tags in the vault panel: the row marks, the hover star, the menu
// items, the preview header star, the "Starred only" filter, `#tag` search,
// and starred rows leading their group. The host persists both; the panel only
// posts the change and repaints from the list push that comes back.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebViewToExtensionMessage } from "../../types/messages";
import type { VaultListResult, VaultSessionEntry } from "../../vault/types";
import { resetTooltipForTests } from "../ui/Tooltip";
import { VaultPanel } from "./VaultPanel";

afterEach(() => {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  resetTooltipForTests();
  document.body.replaceChildren();
});

const MODIFIED = Date.now();

function entry(over: Partial<VaultSessionEntry> = {}): VaultSessionEntry {
  return {
    id: "claude:abc",
    agent: "claude",
    sessionId: "abc",
    title: "hello",
    cwd: "/work/repo",
    modified: MODIFIED,
    flags: {},
    ...over,
  };
}

function result(entries: VaultSessionEntry[]): VaultListResult {
  return { entries, unreadable: { count: 0, reasons: [] } };
}

function mount(over: Partial<ConstructorParameters<typeof VaultPanel>[0]> = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const posted: WebViewToExtensionMessage[] = [];
  const panel = new VaultPanel({
    host,
    postMessage: (m) => posted.push(m),
    getInitialCollapsed: () => false,
    // The folder filter defaults on; these tests are about the other filter.
    getInitialFolderOnly: () => false,
    ...over,
  });
  return { host, panel, posted };
}

const rowIds = (host: HTMLElement) =>
  Array.from(host.querySelectorAll<HTMLElement>(".vault-row")).map((r) => r.dataset.entryId);
const row = (host: HTMLElement, id: string) =>
  Array.from(host.querySelectorAll<HTMLElement>(".vault-row")).find((r) => r.dataset.entryId === id);
const starPosts = (posted: WebViewToExtensionMessage[]) => posted.filter((m) => m.type === "vaultSetStarred");

describe("the star on a row", () => {
  it("marks a starred row with a filled star that unstars on click, without opening the preview", () => {
    const { host, panel, posted } = mount();
    panel.render(result([entry({ id: "claude:a", starred: true })]));
    const r = row(host, "claude:a");
    expect(r?.classList.contains("is-starred")).toBe(true);
    const star = r?.querySelector<HTMLButtonElement>(".vault-row-marks .vault-row-star");
    expect(star?.getAttribute("aria-pressed")).toBe("true");
    expect(star?.getAttribute("aria-label")).toBe("Unstar session");
    // A starred row does not offer a second star on hover.
    expect(r?.querySelector(".vault-action--star")).toBeNull();
    star?.click();
    expect(starPosts(posted)).toEqual([{ type: "vaultSetStarred", entryId: "claude:a", starred: false }]);
    expect(host.querySelector(".vault-preview.is-open")).toBeNull();
  });

  it("offers a hover star on an unstarred row, which stars it", () => {
    const { host, panel, posted } = mount();
    panel.render(result([entry({ id: "claude:a" })]));
    const r = row(host, "claude:a");
    expect(r?.querySelector(".vault-row-marks .vault-row-star")).toBeNull();
    const star = r?.querySelector<HTMLButtonElement>(".vault-row-actions .vault-action--star");
    expect(star?.getAttribute("aria-pressed")).toBe("false");
    star?.click();
    expect(starPosts(posted)).toEqual([{ type: "vaultSetStarred", entryId: "claude:a", starred: true }]);
    expect(host.querySelector(".vault-preview.is-open")).toBeNull();
  });

  it("keeps Enter on the star button from opening the preview", () => {
    const { host, panel } = mount();
    panel.render(result([entry({ id: "claude:a", starred: true })]));
    const star = host.querySelector<HTMLButtonElement>(".vault-row-star");
    star?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(host.querySelector(".vault-preview.is-open")).toBeNull();
  });

  it("offers the hover star even on a row that cannot be resumed", () => {
    const { host, panel } = mount();
    panel.render(result([entry({ id: "claude:a", canResume: false })]));
    expect(host.querySelector(".vault-action--resume")).toBeNull();
    expect(host.querySelector(".vault-action--star")).not.toBeNull();
  });

  it("is a mark only, and offers no hover star, on a surface without actions", () => {
    const { host, panel } = mount({ actionsAvailable: false });
    panel.render(result([entry({ id: "claude:a", starred: true }), entry({ id: "claude:b", canResume: false })]));
    const mark = row(host, "claude:a")?.querySelector(".vault-row-star");
    expect(mark?.tagName).toBe("SPAN");
    expect(host.querySelector(".vault-action--star")).toBeNull();
    expect(row(host, "claude:b")?.querySelector(".vault-row-actions")).toBeNull();
  });

  it("repaints when only the star changed", () => {
    const { host, panel } = mount();
    panel.render(result([entry({ id: "claude:a" })]));
    panel.render(result([entry({ id: "claude:a", starred: true })]));
    expect(row(host, "claude:a")?.classList.contains("is-starred")).toBe(true);
  });
});

describe("starred rows lead", () => {
  it("lead the flat list, after a pinned row and ahead of an open one", () => {
    const { host, panel } = mount();
    panel.render(
      result([
        entry({ id: "claude:newest", modified: 50 }),
        entry({ id: "claude:open", modified: 40 }),
        entry({ id: "claude:starred", modified: 10, starred: true }),
        entry({ id: "claude:pinned", modified: 1 }),
      ]),
    );
    panel.setOpenEntryIds(["claude:open"]);
    panel.setPinnedEntryIds(["claude:pinned"]);
    expect(rowIds(host)).toEqual(["claude:pinned", "claude:starred", "claude:open", "claude:newest"]);
  });

  it("lead their group and rank it in Agent mode", () => {
    const { host, panel } = mount();
    panel.render(
      result([
        entry({ id: "codex:newest", agent: "codex", modified: 50 }),
        entry({ id: "claude:new", modified: 30 }),
        entry({ id: "claude:old", modified: 1, starred: true }),
      ]),
    );
    panel.setGroupMode("agent");
    expect(rowIds(host)).toEqual(["claude:old", "claude:new", "codex:newest"]);
  });

  it("are never hidden behind 'Show more'", () => {
    const { host, panel } = mount();
    const many = Array.from({ length: 14 }, (_, i) =>
      entry({ id: `claude:s${i}`, modified: 1000 + i, starred: i < 12 }),
    );
    panel.render(result(many));
    expect(host.querySelectorAll(".vault-row.is-starred")).toHaveLength(12);
    expect(host.querySelector(".vault-show-more")?.textContent).toBe("Show 2 more");
  });
});

describe("tags on a row", () => {
  it("shows up to two #tag chips and folds the rest into +N", () => {
    const { host, panel } = mount();
    panel.render(result([entry({ id: "claude:a", tags: ["api", "review", "wip", "infra"] })]));
    const chips = Array.from(host.querySelectorAll<HTMLElement>(".vault-row-tag"));
    expect(chips.map((c) => c.textContent)).toEqual(["#api", "#review", "+2"]);
    expect(chips[2].dataset.tip).toBe("#wip #infra");
    expect(row(host, "claude:a")?.dataset.tip).toContain("#api #review #wip #infra");
  });

  it("writes a tag as text, never markup", () => {
    const { host, panel } = mount();
    panel.render(result([entry({ id: "claude:a", tags: ["<img src=x onerror=alert(1)>"] })]));
    const chip = host.querySelector(".vault-row-tag");
    expect(chip?.textContent).toBe("#<img src=x onerror=alert(1)>");
    expect(chip?.querySelector("img")).toBeNull();
  });

  it("filters the list to a tag when its chip is clicked, without opening the preview", () => {
    const { host, panel } = mount();
    panel.render(
      result([
        entry({ id: "claude:a", tags: ["api"] }),
        entry({ id: "claude:b", tags: ["apiary"] }),
        entry({ id: "claude:c", title: "api work" }),
      ]),
    );
    row(host, "claude:a")?.querySelector<HTMLButtonElement>(".vault-row-tag")?.click();
    expect(host.querySelector<HTMLInputElement>(".vault-search-input")?.value).toBe("#api");
    expect(host.querySelector<HTMLElement>(".vault-header__search")?.style.display).toBe("flex");
    // `#api` is a tag prefix: the untagged session titled "api work" is not a match.
    expect(rowIds(host)).toEqual(["claude:a", "claude:b"]);
    expect(host.querySelector(".vault-preview.is-open")).toBeNull();
  });

  it("filters by tag on a surface without actions too", () => {
    const { host, panel } = mount({ actionsAvailable: false });
    panel.render(result([entry({ id: "claude:a", tags: ["api"] }), entry({ id: "claude:b" })]));
    const chip = host.querySelector<HTMLButtonElement>(".vault-row-tag");
    expect(chip?.tagName).toBe("BUTTON");
    chip?.click();
    expect(rowIds(host)).toEqual(["claude:a"]);
  });

  it("repaints when only the tags changed", () => {
    const { host, panel } = mount();
    panel.render(result([entry({ id: "claude:a" })]));
    panel.render(result([entry({ id: "claude:a", tags: ["x"] })]));
    expect(host.querySelector(".vault-row-tag")?.textContent).toBe("#x");
  });
});

describe("search over marks and names", () => {
  function search(host: HTMLElement, value: string): void {
    host.querySelector<HTMLButtonElement>(".vault-header__search-btn")?.click();
    const input = host.querySelector<HTMLInputElement>(".vault-search-input");
    if (!input) {
      throw new Error("no search input");
    }
    input.value = value;
    input.dispatchEvent(new Event("input"));
  }

  it("matches a plain query against tags", () => {
    const { host, panel } = mount();
    panel.render(result([entry({ id: "claude:a", tags: ["backend"] }), entry({ id: "claude:b" })]));
    search(host, "backe");
    expect(rowIds(host)).toEqual(["claude:a"]);
  });

  it("matches a plain query against the user's rename", () => {
    const { host, panel } = mount();
    panel.render(result([entry({ id: "claude:a", customName: "Release prep" }), entry({ id: "claude:b" })]));
    search(host, "release");
    expect(rowIds(host)).toEqual(["claude:a"]);
  });

  it("treats a bare # as 'any tagged session'", () => {
    const { host, panel } = mount();
    panel.render(result([entry({ id: "claude:a", tags: ["x"] }), entry({ id: "claude:b", title: "#1 bug" })]));
    search(host, "#");
    expect(rowIds(host)).toEqual(["claude:a"]);
  });

  it("matches a #tag query case-insensitively", () => {
    const { host, panel } = mount();
    panel.render(result([entry({ id: "claude:a", tags: ["Frontend"] }), entry({ id: "claude:b" })]));
    search(host, "#FRONT");
    expect(rowIds(host)).toEqual(["claude:a"]);
  });
});

describe("the context menu", () => {
  function openMenu(host: HTMLElement, id: string): void {
    row(host, id)?.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }),
    );
  }
  function click(host: HTMLElement, label: string): void {
    Array.from(host.querySelectorAll<HTMLButtonElement>(".vault-context-menu button"))
      .find((b) => b.textContent === label)
      ?.click();
  }

  it("stars an unstarred session and unstars a starred one", () => {
    const { host, panel, posted } = mount();
    panel.render(result([entry({ id: "claude:a" }), entry({ id: "claude:b", starred: true })]));
    openMenu(host, "claude:a");
    click(host, "Star");
    openMenu(host, "claude:b");
    click(host, "Unstar");
    expect(starPosts(posted)).toEqual([
      { type: "vaultSetStarred", entryId: "claude:a", starred: true },
      { type: "vaultSetStarred", entryId: "claude:b", starred: false },
    ]);
  });

  it("hands Edit Tags to the host by entry id", () => {
    const { host, panel, posted } = mount();
    panel.render(result([entry({ id: "claude:a" })]));
    openMenu(host, "claude:a");
    click(host, "Edit Tags…");
    expect(posted.filter((m) => m.type === "vaultEditTags")).toEqual([{ type: "vaultEditTags", entryId: "claude:a" }]);
  });
});

describe("the Starred only filter", () => {
  const toggle = (host: HTMLElement) => host.querySelector<HTMLButtonElement>(".vault-starred-toggle");

  it("shows only starred sessions, and persists the choice", () => {
    const persist = vi.fn();
    const { host, panel } = mount({ persistStarredOnly: persist });
    panel.render(result([entry({ id: "claude:a", starred: true }), entry({ id: "claude:b" })]));
    expect(toggle(host)?.getAttribute("aria-pressed")).toBe("false");
    toggle(host)?.click();
    expect(rowIds(host)).toEqual(["claude:a"]);
    expect(toggle(host)?.getAttribute("aria-pressed")).toBe("true");
    expect(panel.isStarredOnly()).toBe(true);
    expect(persist).toHaveBeenLastCalledWith(true);
    toggle(host)?.click();
    expect(rowIds(host)).toEqual(["claude:a", "claude:b"]);
    expect(persist).toHaveBeenLastCalledWith(false);
  });

  it("restores the persisted choice without persisting it again", () => {
    const persist = vi.fn();
    const { host, panel } = mount({ getInitialStarredOnly: () => true, persistStarredOnly: persist });
    panel.render(result([entry({ id: "claude:a", starred: true }), entry({ id: "claude:b" })]));
    expect(rowIds(host)).toEqual(["claude:a"]);
    expect(persist).not.toHaveBeenCalled();
  });

  it("says nothing is starred and offers the way back to every session", () => {
    const { host, panel } = mount({ getInitialStarredOnly: () => true });
    panel.render(result([entry({ id: "claude:a" })]));
    expect(host.querySelector(".vault-status")?.textContent).toContain("No starred sessions");
    const back = Array.from(host.querySelectorAll<HTMLButtonElement>(".vault-status button")).find(
      (b) => b.textContent === "Show all sessions",
    );
    back?.click();
    expect(rowIds(host)).toEqual(["claude:a"]);
    expect(panel.isStarredOnly()).toBe(false);
  });

  it("names the folder when the folder filter is on too", () => {
    const { host, panel } = mount({
      getInitialStarredOnly: () => true,
      getInitialFolderOnly: () => true,
      getContextCwd: () => "/elsewhere",
    });
    panel.render(result([entry({ id: "claude:a", starred: true, cwd: "/work/repo" })]));
    expect(host.querySelector(".vault-status")?.textContent).toContain("No starred sessions in this folder");
  });

  it("leaves a query's no-match state to the query", () => {
    const { host, panel } = mount({ getInitialStarredOnly: () => true });
    panel.render(result([entry({ id: "claude:a", starred: true })]));
    host.querySelector<HTMLButtonElement>(".vault-header__search-btn")?.click();
    const input = host.querySelector<HTMLInputElement>(".vault-search-input");
    if (input) {
      input.value = "zzz";
      input.dispatchEvent(new Event("input"));
    }
    expect(host.querySelector(".vault-status")?.textContent).toContain("No matching sessions");
  });
});

describe("the preview header star", () => {
  function openPreview(host: HTMLElement, panel: VaultPanel, id: string): void {
    row(host, id)?.click();
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: id,
      detail: {
        entryId: id,
        contentKind: "timeline",
        recentActivity: [],
        timeline: [],
        stats: { messageCount: 0, toolCount: 0, subagentCount: 0 },
      },
    });
  }

  it("toggles the star and follows the list push that comes back", () => {
    const { host, panel, posted } = mount();
    panel.render(result([entry({ id: "claude:a" })]));
    openPreview(host, panel, "claude:a");
    const star = () => host.querySelector<HTMLButtonElement>(".vault-preview-star");
    expect(star()?.getAttribute("aria-pressed")).toBe("false");
    expect(star()?.getAttribute("aria-label")).toBe("Star session");
    star()?.click();
    expect(starPosts(posted)).toEqual([{ type: "vaultSetStarred", entryId: "claude:a", starred: true }]);

    // The host persists it and pushes the list; the same button now reads starred.
    const before = star();
    panel.render(result([entry({ id: "claude:a", starred: true })]));
    expect(star()).toBe(before);
    expect(star()?.getAttribute("aria-pressed")).toBe("true");
    expect(star()?.getAttribute("aria-label")).toBe("Unstar session");
    star()?.click();
    expect(starPosts(posted).at(-1)).toEqual({ type: "vaultSetStarred", entryId: "claude:a", starred: false });
  });

  it("is absent on a surface without actions", () => {
    const { host, panel } = mount({ actionsAvailable: false });
    panel.render(result([entry({ id: "claude:a", starred: true })]));
    openPreview(host, panel, "claude:a");
    expect(host.querySelector(".vault-preview.is-open")).not.toBeNull();
    expect(host.querySelector(".vault-preview-star")).toBeNull();
  });
});

describe("the color and icon of the tab that last ran a session", () => {
  it("draws the color as a stripe down the row and the icon ahead of the title", () => {
    const { host, panel } = mount();
    panel.render(result([entry({ id: "claude:a", tabColor: "red", tabIcon: "rocket" }), entry({ id: "claude:b" })]));
    const a = row(host, "claude:a")!;
    expect(a.classList.contains("has-tab-color")).toBe(true);
    expect(a.dataset.tabColor).toBe("red");
    expect(a.style.getPropertyValue("--row-tab-color")).toBe("var(--vscode-terminal-ansiRed, #cd3131)");
    const title = a.querySelector<HTMLElement>(".vault-row-title")!;
    // Ahead of the title text, not after it.
    const icon = title.firstChild as HTMLElement;
    expect(icon.classList.contains("vault-row-tab-icon")).toBe(true);
    expect(icon.dataset.icon).toBe("rocket");
    expect(icon.querySelector("svg")).not.toBeNull();
    expect(title.textContent).toBe("hello");

    const b = row(host, "claude:b")!;
    expect(b.classList.contains("has-tab-color")).toBe(false);
    expect(b.style.getPropertyValue("--row-tab-color")).toBe("");
    expect(b.querySelector(".vault-row-tab-icon")).toBeNull();
  });

  it("repaints when a list push brings a color, and draws nothing for an unknown id", () => {
    const { host, panel } = mount();
    panel.render(result([entry({ id: "claude:a" })]));
    panel.render(result([entry({ id: "claude:a", tabColor: "green" })]));
    expect(row(host, "claude:a")?.dataset.tabColor).toBe("green");

    panel.render(result([entry({ id: "claude:a", tabColor: "plaid", tabIcon: "unicorn" })]));
    expect(row(host, "claude:a")?.classList.contains("has-tab-color")).toBe(false);
    expect(row(host, "claude:a")?.querySelector(".vault-row-tab-icon")).toBeNull();
  });
});
