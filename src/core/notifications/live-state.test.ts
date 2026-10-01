import { describe, expect, it } from "vitest";

import { noteNotificationsChanged, staleSinceDrawn } from "./live-state";

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
