import { describe, expect, it } from "vitest";

import { istInstant } from "@/core/time";

import { whoIsFree } from "../domain/who-free";

const TODAY = "2026-10-15";
const people = [
  { id: "a", name: "Asha" },
  { id: "k", name: "Kiran" },
];
const OWNER = [{ id: "o", name: "Owner One" }];

describe("the Owner in Who's free (6b.2, owner 2026-10-07)", () => {
  it("an Admin sees the Owner's shoot as Busy, from availability (a time, never a title)", () => {
    const who = whoIsFree({
      date: TODAY,
      scope: "admin",
      viewerId: "a",
      people,
      events: [],
      leave: [],
      availability: [
        {
          memberId: "o",
          day: TODAY,
          leave: null,
          blocks: [{ startAt: istInstant(TODAY, "10:00"), endAt: istInstant(TODAY, "13:00") }],
        },
      ],
      busyOnly: OWNER,
    });
    expect(who).toEqual({
      free: ["Asha", "Kiran"],
      busy: [{ when: "10–1", names: ["Owner One"] }],
      onLeave: [],
    });
  });

  it("never lists the Owner as Free or on leave", () => {
    const who = whoIsFree({
      date: TODAY,
      scope: "admin",
      viewerId: "a",
      people,
      events: [],
      leave: [],
      availability: [{ memberId: "o", day: TODAY, leave: "leave", blocks: [] }],
      busyOnly: OWNER,
    });
    expect(who).toEqual({ free: ["Asha", "Kiran"], busy: [], onLeave: [] });
  });

  it("the Owner's own view counts the Owner's events the same way", () => {
    const who = whoIsFree({
      date: TODAY,
      scope: "owner",
      viewerId: "o",
      people,
      events: [
        {
          id: "s",
          title: "Shoot",
          eventDate: TODAY,
          eventStartAt: istInstant(TODAY, "09:00"),
          eventEndAt: istInstant(TODAY, "10:00"),
          state: "todo",
          location: null,
          clientId: null,
          taskTypeId: "t",
          primaryOwnerId: "o",
          assigneeIds: ["o"],
        },
      ],
      leave: [],
      availability: null,
      busyOnly: OWNER,
    });
    expect(who?.busy).toEqual([{ when: "9–10", names: ["Owner One"] }]);
    expect(who?.free).toEqual(["Asha", "Kiran"]);
  });
});
