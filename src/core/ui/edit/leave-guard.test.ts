import { describe, expect, it } from "vitest";

import { anyEditDirty, setEditDirty } from "./edit-guard";
import { isLeavingClick } from "./leave-guard";

const ORIGIN = "https://maxoff.test";
const click = {
  defaultPrevented: false,
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
};
const anchor = (href: string, { target = "", download = false } = {}) => ({
  href,
  target,
  hasAttribute: (name: string) => name === "download" && download,
});

describe("isLeavingClick (task 2.9, §14.2 f)", () => {
  it("holds a plain click on an in-app link", () => {
    expect(isLeavingClick(click, anchor(`${ORIGIN}/today`), ORIGIN)).toBe(true);
    expect(isLeavingClick(click, anchor("/leave"), ORIGIN)).toBe(true);
  });

  it("lets modified clicks, other buttons and handled clicks through", () => {
    for (const modifier of ["metaKey", "ctrlKey", "shiftKey", "altKey"] as const) {
      expect(isLeavingClick({ ...click, [modifier]: true }, anchor("/today"), ORIGIN)).toBe(false);
    }
    expect(isLeavingClick({ ...click, button: 1 }, anchor("/today"), ORIGIN)).toBe(false);
    expect(isLeavingClick({ ...click, defaultPrevented: true }, anchor("/today"), ORIGIN)).toBe(
      false,
    );
  });

  it("lets new tabs, downloads and other origins through: this page stays", () => {
    expect(isLeavingClick(click, anchor("/today", { target: "_blank" }), ORIGIN)).toBe(false);
    expect(isLeavingClick(click, anchor("/file.csv", { download: true }), ORIGIN)).toBe(false);
    expect(isLeavingClick(click, anchor("https://elsewhere.test/x"), ORIGIN)).toBe(false);
  });
});

describe("the unsaved-edits registry", () => {
  it("is dirty while any editor is, and clean once each clears", () => {
    expect(anyEditDirty()).toBe(false);
    setEditDirty("a", true);
    setEditDirty("b", true);
    setEditDirty("a", false);
    expect(anyEditDirty()).toBe(true);
    setEditDirty("b", false);
    expect(anyEditDirty()).toBe(false);
  });
});
