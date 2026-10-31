// @vitest-environment jsdom
// src/webview/editableTarget.test.ts — which key targets are text fields.

import { describe, expect, it } from "vitest";
import { isEditableTarget, XTERM_INPUT_CLASS } from "./editableTarget";

const make = (html: string): Element => {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host.firstElementChild!;
};

describe("isEditableTarget", () => {
  it.each([
    ["a text input", "<input type='text'>"],
    ["a search input", "<input type='search'>"],
    ["a textarea", "<textarea></textarea>"],
    ["a select", "<select></select>"],
    ["a contenteditable element", "<div contenteditable='true'></div>"],
    ["a bare contenteditable attribute", "<div contenteditable></div>"],
  ])("treats %s as a field", (_label, html) => {
    expect(isEditableTarget(make(html))).toBe(true);
  });

  it("treats an element inside a contenteditable host as a field", () => {
    const host = make("<div contenteditable='true'><span>x</span></div>");
    expect(isEditableTarget(host.querySelector("span"))).toBe(true);
  });

  it("does not treat xterm's own input textarea as a field — its keys belong to the PTY", () => {
    expect(isEditableTarget(make(`<textarea class="${XTERM_INPUT_CLASS}"></textarea>`))).toBe(false);
  });

  it.each([
    ["a button", "<button></button>"],
    ["a plain div (the file tree, a list)", "<div tabindex='0'></div>"],
    ["an element under contenteditable=false", "<div contenteditable='false'><span>x</span></div>"],
  ])("does not treat %s as a field", (_label, html) => {
    const el = make(html);
    expect(isEditableTarget(el.querySelector("span") ?? el)).toBe(false);
  });

  it("does not treat a non-element target as a field", () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(window)).toBe(false);
    expect(isEditableTarget(document)).toBe(false);
  });
});
