import { describe, expect, it } from "vitest";

import { isInAppPath, openUrl, parentOf } from "./deep-link";

describe("deep-link entry", () => {
  it("accepts only in-app paths", () => {
    expect(isInAppPath("/tasks/abc")).toBe(true);
    expect(isInAppPath("/notifications")).toBe(true);
    expect(isInAppPath("/tasks/abc?view=chat#c")).toBe(true);
    expect(isInAppPath("//evil.example/x")).toBe(false);
    expect(isInAppPath("https://evil.example/x")).toBe(false);
    expect(isInAppPath("/api/cron/push-dispatch")).toBe(false);
    expect(isInAppPath("/open")).toBe(false);
    expect(isInAppPath("/open?to=/tasks")).toBe(false);
    expect(isInAppPath("tasks")).toBe(false);
    expect(isInAppPath("/tasks/a b")).toBe(false);
  });

  it("finds the parent list, and the home for a top-level screen", () => {
    expect(parentOf("/tasks/abc", "/my-day")).toBe("/tasks");
    expect(parentOf("/tasks/abc?view=chat", "/my-day")).toBe("/tasks");
    expect(parentOf("/people/p1", "/today")).toBe("/people");
    expect(parentOf("/leave/expenses", "/my-day")).toBe("/leave");
    expect(parentOf("/settings/templates/t1", "/today")).toBe("/settings/templates");
    expect(parentOf("/approvals", "/today")).toBe("/today");
    expect(parentOf("/notifications", "/my-day")).toBe("/my-day");
    expect(parentOf("/", "/today")).toBe("/today");
  });

  it("builds the entry URL", () => {
    expect(openUrl("/tasks/abc?view=chat")).toBe("/open?to=%2Ftasks%2Fabc%3Fview%3Dchat");
  });
});
