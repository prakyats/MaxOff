import { describe, expect, it } from "vitest";

import type { ActivityEntry } from "@/core/activity";

import { describeMemberActivity } from "../domain/activity";

const entry = (over: Partial<ActivityEntry>): ActivityEntry => ({
  id: 1,
  actorId: "owner",
  onBehalfOfId: null,
  entity: "members",
  entityId: "m",
  action: "update",
  old: {},
  new: {},
  meta: {},
  at: "2026-10-21T09:00:00Z",
  ...over,
});
const names = { owner: "Prishit" };
const text = (over: Partial<ActivityEntry>) => describeMemberActivity(entry(over), names)?.text;

describe("describeMemberActivity (PP-person-1)", () => {
  it("says the lifecycle in words", () => {
    expect(text({ action: "invited" })).toBe("invited them");
    expect(text({ action: "deactivated", new: { status: "deactivated" } })).toBe("deactivated them");
    expect(text({ action: "reactivated" })).toBe("reactivated them");
    expect(text({ action: "freelancer_added" })).toBe("added them as a freelancer");
  });
  it("names what an edit changed, and a new role", () => {
    expect(text({ new: { role: "admin" } })).toBe("changed the role to Admin");
    expect(text({ new: { full_name: "A", phone: "1", job_title_id: "x" } })).toBe(
      "changed the name, the phone number and the job title",
    );
  });
  it("names the actor, or MaxOff for the system", () => {
    expect(describeMemberActivity(entry({ action: "invited" }), names)?.actor).toBe("Prishit");
    expect(describeMemberActivity(entry({ action: "invited", actorId: null }), names)?.actor).toBe(
      "MaxOff",
    );
  });
  it("drops what a reader does not need", () => {
    expect(text({ new: { last_seen_at: "x" } })).toBeUndefined();
    expect(text({ action: "delete" })).toBeUndefined();
  });
});
