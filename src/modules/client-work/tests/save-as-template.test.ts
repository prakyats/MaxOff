import { describe, expect, it } from "vitest";

import { describeProjectActivity, type ActivityEntry } from "../domain/activity";

function entry(over: Partial<ActivityEntry>): ActivityEntry {
  return {
    id: 1,
    actorId: "r",
    entity: "projects",
    entityId: "p1",
    action: "saved_as_template",
    old: {},
    new: {},
    meta: {},
    at: "2026-10-15T06:00:00Z",
    ...over,
  };
}

const context = { names: { r: "Ravi" }, items: { i1: "Item 1" }, stages: {} };
const say = (over: Partial<ActivityEntry>) => describeProjectActivity(entry(over), context)?.text;

/** Save as template (6b Release 2): one history row on the record, naming the template. */
describe("the history of Save as template", () => {
  it("names the project template", () => {
    expect(say({ meta: { name: "Monthly set" } })).toBe(
      "saved the project as the template Monthly set",
    );
    expect(say({})).toBe("saved the project as a template");
  });

  it("names the deliverable template on the deliverable", () => {
    expect(say({ entity: "project_items", entityId: "i1", meta: { name: "Item kind" } })).toBe(
      "saved Item 1 as the deliverable template Item kind",
    );
  });
});
