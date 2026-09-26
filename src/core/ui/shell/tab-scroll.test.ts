import { describe, expect, it } from "vitest";

import { reachable, saveTabScroll, takeTabScroll } from "./tab-scroll";

describe("tab scroll memory (ARCHITECTURE §14.2 g)", () => {
  it("keeps each tab's place separately", () => {
    saveTabScroll("/today", 640);
    saveTabScroll("/approvals", 120);
    expect(takeTabScroll("/approvals")).toBe(120);
    expect(takeTabScroll("/today")).toBe(640);
  });

  it("gives a place back once: the next arrival without leaving again is at the top", () => {
    saveTabScroll("/people", 300);
    expect(takeTabScroll("/people")).toBe(300);
    expect(takeTabScroll("/people")).toBeUndefined();
  });

  it("knows nothing of a tab never left", () => {
    expect(takeTabScroll("/calendar")).toBeUndefined();
  });

  it("stores whole, non-negative pixels (iOS rubber-band reports negatives)", () => {
    saveTabScroll("/today", -24);
    expect(takeTabScroll("/today")).toBe(0);
    saveTabScroll("/today", 99.6);
    expect(takeTabScroll("/today")).toBe(100);
  });

  it("never asks for more than the page can scroll", () => {
    expect(reachable(900, 1500, 800)).toBe(700);
    expect(reachable(400, 1500, 800)).toBe(400);
    expect(reachable(400, 600, 800)).toBe(0);
  });
});
