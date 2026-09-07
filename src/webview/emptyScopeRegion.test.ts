// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { mountEmptyScopeRegion, renderEmptyScopeRegion } from "./emptyScopeRegion";
import { MAIN_TERMINAL_OWNER } from "./navigation/TerminalNavigationState";

const linked = { kind: "linked" as const, id: "/wt/x" };

function labels(region: HTMLElement): string[] {
  return [...region.querySelectorAll("button")].map((button) => button.textContent ?? "");
}

function surface(): HTMLElement {
  document.body.replaceChildren();
  const container = document.createElement("div");
  container.id = "terminal-container";
  container.appendChild(document.createElement("canvas"));
  document.body.appendChild(container);
  return container;
}

describe("renderEmptyScopeRegion", () => {
  it("renders linked-owner actions without offering an All/clear control", () => {
    const region = renderEmptyScopeRegion({
      owner: linked,
      label: "feat/x",
      onOpenTerminal: vi.fn(),
      onLaunchAgent: vi.fn(),
    });

    expect(region.textContent).toContain("feat/x");
    expect(labels(region)).toEqual(["Open a terminal", "Launch an agent"]);
    expect(region.textContent).not.toMatch(/all terminals|clear scope/i);
  });

  it("renders the global main owner as a normal empty state", () => {
    const region = renderEmptyScopeRegion({ owner: MAIN_TERMINAL_OWNER, label: "Main", onOpenTerminal: vi.fn() });
    expect(region.textContent).toContain("Nothing running in Main");
    expect(region.getAttribute("role")).toBe("region");
  });

  it("omits unavailable launch actions and carries no error treatment", () => {
    const region = renderEmptyScopeRegion({ owner: linked, label: "feat/x", onOpenTerminal: vi.fn() });
    expect(labels(region)).toEqual(["Open a terminal"]);
    expect(region.outerHTML).not.toMatch(/error|danger|warning/i);
  });

  it("runs each offered action", () => {
    const onOpenTerminal = vi.fn();
    const onLaunchAgent = vi.fn();
    const region = renderEmptyScopeRegion({ owner: linked, label: "feat/x", onOpenTerminal, onLaunchAgent });
    for (const button of region.querySelectorAll("button")) {
      button.click();
    }
    expect(onOpenTerminal).toHaveBeenCalledTimes(1);
    expect(onLaunchAgent).toHaveBeenCalledTimes(1);
  });
});

describe("mountEmptyScopeRegion", () => {
  const deps = { owner: linked, label: "feat/x", onOpenTerminal: () => {} };

  it("hides but does not unmount the terminal container", () => {
    const container = surface();
    const child = container.firstElementChild;
    mountEmptyScopeRegion(container, deps);
    expect(container.style.display).toBe("none");
    expect(container.isConnected).toBe(true);
    expect(child?.isConnected).toBe(true);
  });

  it("restores the container when the owner is no longer empty", () => {
    const container = surface();
    mountEmptyScopeRegion(container, deps);
    mountEmptyScopeRegion(container, null);
    expect(container.style.display).toBe("");
    expect(document.querySelector(".empty-scope")).toBeNull();
  });

  it("preserves the standing element and focus for an identical projection", () => {
    const container = surface();
    mountEmptyScopeRegion(container, deps);
    const first = document.querySelector(".empty-scope");
    const button = first?.querySelector("button");
    button?.focus();
    mountEmptyScopeRegion(container, { ...deps });
    expect(document.querySelector(".empty-scope")).toBe(first);
    expect(document.activeElement).toBe(button);
  });

  it("replaces equal labels when linked owner identity changes", () => {
    const container = surface();
    mountEmptyScopeRegion(container, deps);
    const first = document.querySelector(".empty-scope");
    mountEmptyScopeRegion(container, { ...deps, owner: { kind: "linked", id: "/wt/y" } });
    expect(document.querySelector(".empty-scope")).not.toBe(first);
  });

  it("replaces the region when its available actions change", () => {
    const container = surface();
    mountEmptyScopeRegion(container, deps);
    const first = document.querySelector(".empty-scope");
    mountEmptyScopeRegion(container, { ...deps, onLaunchAgent: () => {} });
    expect(document.querySelector(".empty-scope")).not.toBe(first);
    expect(labels(document.querySelector(".empty-scope") as HTMLElement)).toEqual([
      "Open a terminal",
      "Launch an agent",
    ]);
  });

  it("does not remove a standing region when its container is detached", () => {
    const container = surface();
    mountEmptyScopeRegion(container, deps);
    const standing = document.querySelector(".empty-scope");
    container.remove();
    mountEmptyScopeRegion(container, { ...deps, label: "renamed" });
    expect(document.querySelector(".empty-scope")).toBe(standing);
  });
});
