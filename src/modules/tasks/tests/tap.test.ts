import { describe, expect, it } from "vitest";

import { NAV_PENDING_ATTRIBUTE } from "@/core/ui/navigation/progress";

import { NAV_PENDING, taskTapTarget } from "../domain/tap";

const ORIGIN = "https://app.example";
const ID = "c3d26307-1f2a-4b5c-8d9e-0a1b2c3d4e5f";

describe("taskTapTarget (#143)", () => {
  it("a task's page opens on Work", () => {
    expect(taskTapTarget(`/tasks/${ID}`, ORIGIN)).toEqual({
      pathname: `/tasks/${ID}`,
      href: `/tasks/${ID}`,
      view: "work",
    });
  });

  it("the view the address asks for", () => {
    expect(taskTapTarget(`/tasks/${ID}?tab=chat`, ORIGIN)).toMatchObject({
      href: `/tasks/${ID}?tab=chat`,
      view: "chat",
    });
    expect(taskTapTarget(`${ORIGIN}/tasks/${ID}?tab=details`, ORIGIN)?.view).toBe("details");
  });

  it("not a sheet's address, a filter or another query", () => {
    expect(taskTapTarget(`/tasks/${ID}?sheet=history`, ORIGIN)).toBeNull();
    expect(taskTapTarget(`/tasks/${ID}?tab=chat&sheet=hold`, ORIGIN)).toBeNull();
    expect(taskTapTarget("/tasks/all?state=review", ORIGIN)).toBeNull();
  });

  it("not another screen, another site or a malformed id", () => {
    expect(taskTapTarget("/tasks", ORIGIN)).toBeNull();
    expect(taskTapTarget("/tasks/all", ORIGIN)).toBeNull();
    expect(taskTapTarget("/tasks/requests", ORIGIN)).toBeNull();
    expect(taskTapTarget(`/clients/${ID}`, ORIGIN)).toBeNull();
    expect(taskTapTarget(`/tasks/${ID}/edit`, ORIGIN)).toBeNull();
    expect(taskTapTarget(`https://elsewhere.example/tasks/${ID}`, ORIGIN)).toBeNull();
    expect(taskTapTarget("/tasks/not-an-id", ORIGIN)).toBeNull();
  });
});

describe("the navigation-pending attribute (#143)", () => {
  it("is the one the progress bar sets", () => {
    expect(NAV_PENDING).toBe(NAV_PENDING_ATTRIBUTE);
  });
});
