import { describe, expect, it } from "vitest";

import {
  noteNotificationsChanged,
  noteOwnRead,
  ownReadWithin,
  staleSinceDrawn,
} from "./live-state";

describe("staleSinceDrawn", () => {
  it("a drawing shown again after a change is stale once, then fresh", () => {
    expect(staleSinceDrawn("a")).toBe(false);
    expect(staleSinceDrawn("a")).toBe(false);
    noteNotificationsChanged();
    expect(staleSinceDrawn("a")).toBe(true);
    expect(staleSinceDrawn("a")).toBe(false);
  });

  it("a new drawing is never stale on its first showing", () => {
    noteNotificationsChanged();
    expect(staleSinceDrawn("b")).toBe(false);
  });
});

describe("ownReadWithin", () => {
  it("is quiet for the window after the member's own read, and marks a change", () => {
    expect(ownReadWithin(1_000, 3_000)).toBe(false);
    expect(staleSinceDrawn("c")).toBe(false);
    noteOwnRead(10_000);
    expect(ownReadWithin(12_999, 3_000)).toBe(true);
    expect(ownReadWithin(13_000, 3_000)).toBe(false);
    expect(staleSinceDrawn("c")).toBe(true);
  });
});
