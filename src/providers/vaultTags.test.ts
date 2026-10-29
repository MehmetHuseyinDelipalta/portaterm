import { describe, expect, it, vi } from "vitest";
import {
  editVaultTags,
  NEW_TAG_DESCRIPTION,
  pickVaultTags,
  type TagPickItem,
  type TagQuickPick,
  tagPickItems,
} from "./vaultTags";

/** A QuickPick that behaves like VS Code's where the picker depends on it. */
class FakeQuickPick implements TagQuickPick {
  title: string | undefined;
  placeholder: string | undefined;
  canSelectMany = false;
  items: readonly TagPickItem[] = [];
  value = "";
  shown = false;
  disposed = false;
  private selected: readonly TagPickItem[] = [];
  private readonly valueListeners: Array<(v: string) => unknown> = [];
  private readonly selectionListeners: Array<(items: readonly TagPickItem[]) => unknown> = [];
  private readonly acceptListeners: Array<() => unknown> = [];
  private readonly hideListeners: Array<() => unknown> = [];

  get selectedItems(): readonly TagPickItem[] {
    return this.selected;
  }
  set selectedItems(items: readonly TagPickItem[]) {
    this.selected = items;
  }

  onDidChangeValue(l: (v: string) => unknown) {
    this.valueListeners.push(l);
    return { dispose: () => this.valueListeners.splice(this.valueListeners.indexOf(l), 1) };
  }
  onDidChangeSelection(l: (items: readonly TagPickItem[]) => unknown) {
    this.selectionListeners.push(l);
    return { dispose: () => this.selectionListeners.splice(this.selectionListeners.indexOf(l), 1) };
  }
  onDidAccept(l: () => unknown) {
    this.acceptListeners.push(l);
    return { dispose: () => this.acceptListeners.splice(this.acceptListeners.indexOf(l), 1) };
  }
  onDidHide(l: () => unknown) {
    this.hideListeners.push(l);
    return { dispose: () => this.hideListeners.splice(this.hideListeners.indexOf(l), 1) };
  }
  show() {
    this.shown = true;
  }
  hide() {
    for (const l of [...this.hideListeners]) {
      l();
    }
  }
  dispose() {
    this.disposed = true;
  }

  // ── what the user does ──
  type(value: string) {
    this.value = value;
    for (const l of [...this.valueListeners]) {
      l(value);
    }
  }
  toggle(label: string) {
    const item = this.items.find((i) => i.label === label);
    if (!item) {
      throw new Error(`no item ${label}`);
    }
    this.selected = this.selected.includes(item) ? this.selected.filter((i) => i !== item) : [...this.selected, item];
    for (const l of [...this.selectionListeners]) {
      l(this.selected);
    }
  }
  accept() {
    for (const l of [...this.acceptListeners]) {
      l();
    }
  }
  labels() {
    return this.items.map((i) => i.label);
  }
  checked() {
    return this.selected.map((i) => i.label);
  }
  listenerCount() {
    return (
      this.valueListeners.length +
      this.selectionListeners.length +
      this.acceptListeners.length +
      this.hideListeners.length
    );
  }
}

describe("tagPickItems", () => {
  it("lists the session's own tags first, then the other tags in use, each once", () => {
    const { items, fresh } = tagPickItems(["alpha", "Beta", "gamma"], ["gamma", "beta"], "");
    expect(items.map((i) => i.label)).toEqual(["gamma", "beta", "alpha"]);
    expect(fresh).toEqual([]);
  });

  it("offers typed tags not yet in use first, marked new and always shown", () => {
    const { items, fresh } = tagPickItems(["api"], [], " new one, #API , other");
    expect(items.map((i) => i.label)).toEqual(["new-one", "other", "api"]);
    expect(fresh.map((i) => i.label)).toEqual(["new-one", "other"]);
    expect(fresh.every((i) => i.description === NEW_TAG_DESCRIPTION && i.alwaysShow)).toBe(true);
  });

  it("auto-checks a new tag only when it matches no tag in use", () => {
    const { autoCheck } = tagPickItems(["frontend"], [], "fro, zzz");
    expect(autoCheck.map((i) => i.label)).toEqual(["zzz"]);
  });
});

describe("pickVaultTags", () => {
  it("opens multi-select with the session's tags checked", () => {
    const qp = new FakeQuickPick();
    void pickVaultTags(qp, ["b"], ["a", "b"]);
    expect(qp.shown).toBe(true);
    expect(qp.canSelectMany).toBe(true);
    expect(qp.title).toBe("Session Tags");
    expect(qp.labels()).toEqual(["b", "a"]);
    expect(qp.checked()).toEqual(["b"]);
  });

  it("resolves the checked tags on accept, and disposes everything", async () => {
    const qp = new FakeQuickPick();
    const result = pickVaultTags(qp, ["b"], ["a", "b"]);
    qp.toggle("a");
    qp.toggle("b");
    qp.accept();
    await expect(result).resolves.toEqual(["a"]);
    expect(qp.disposed).toBe(true);
    expect(qp.listenerCount()).toBe(0);
  });

  it("adds a typed new tag, checked, on accept", async () => {
    const qp = new FakeQuickPick();
    const result = pickVaultTags(qp, ["b"], ["b"]);
    qp.type("urgent, later");
    expect(qp.checked()).toEqual(["urgent", "later", "b"]);
    qp.accept();
    await expect(result).resolves.toEqual(["urgent", "later", "b"]);
  });

  it("does not add the filter text when the user was picking an existing tag", async () => {
    const qp = new FakeQuickPick();
    const result = pickVaultTags(qp, [], ["frontend"]);
    qp.type("fro");
    expect(qp.checked()).toEqual([]);
    qp.toggle("frontend");
    qp.accept();
    await expect(result).resolves.toEqual(["frontend"]);
  });

  it("keeps the user's checks across typing", async () => {
    const qp = new FakeQuickPick();
    const result = pickVaultTags(qp, ["a"], ["a", "b"]);
    qp.toggle("a");
    qp.toggle("b");
    qp.type("c");
    qp.type("");
    expect(qp.checked()).toEqual(["b"]);
    qp.accept();
    await expect(result).resolves.toEqual(["b"]);
  });

  it("drops a new tag the user unchecked", async () => {
    const qp = new FakeQuickPick();
    const result = pickVaultTags(qp, [], []);
    qp.type("oops");
    qp.toggle("oops");
    qp.accept();
    await expect(result).resolves.toEqual([]);
  });

  it("resolves undefined when dismissed", async () => {
    const qp = new FakeQuickPick();
    const result = pickVaultTags(qp, ["a"], ["a"]);
    qp.hide();
    await expect(result).resolves.toBeUndefined();
    expect(qp.disposed).toBe(true);
  });
});

describe("editVaultTags", () => {
  function deps(current: string[] | undefined) {
    const qp = new FakeQuickPick();
    const vaultService = {
      marksOf: vi.fn(() => (current ? { tags: current } : undefined)),
      knownTags: vi.fn(() => ["x", "y"]),
      setTags: vi.fn(),
    };
    return { qp, vaultService, d: { vaultService, createQuickPick: () => qp } };
  }

  it("saves the picked tags for the entry", async () => {
    const { qp, vaultService, d } = deps(["x"]);
    const done = editVaultTags("claude:a", d);
    expect(qp.checked()).toEqual(["x"]);
    qp.toggle("y");
    qp.accept();
    await done;
    expect(vaultService.setTags).toHaveBeenCalledWith("claude:a", ["x", "y"]);
  });

  it("saves an empty list when every tag is unchecked — that clears them", async () => {
    const { qp, vaultService, d } = deps(["x"]);
    const done = editVaultTags("claude:a", d);
    qp.toggle("x");
    qp.accept();
    await done;
    expect(vaultService.setTags).toHaveBeenCalledWith("claude:a", []);
  });

  it("changes nothing when the picker is dismissed", async () => {
    const { qp, vaultService, d } = deps(undefined);
    const done = editVaultTags("claude:a", d);
    qp.hide();
    await done;
    expect(vaultService.setTags).not.toHaveBeenCalled();
  });
});
