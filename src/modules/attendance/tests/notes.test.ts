import { describe, expect, it } from "vitest";

import {
  canAddNote,
  DURATION_OPTIONS,
  durationLabel,
  type ExtraWorkNote,
  noteDays,
  noteOutcome,
  noteTitle,
} from "../domain/notes";
import { decideNoteSchema, endDaySchema } from "../domain/schemas";

const NOTE: ExtraWorkNote = {
  id: "n",
  memberId: "m",
  workDate: "2026-09-23",
  kind: "overtime",
  durationMinutes: 120,
  note: "Colour grade for Sharma",
  state: "submitted",
  decision: null,
  dayMarkedWorked: false,
  createdAt: "2026-09-23T14:00:00Z",
  credit: null,
};
const note = (patch: Partial<ExtraWorkNote>): ExtraWorkNote => ({ ...NOTE, ...patch });

describe("extra work notes (PRODUCT §4.3a, kickoff 3b decisions 10-13)", () => {
  it("offers today and the 7 days before it, each with the kind the calendar gives it", () => {
    const sunday = "2026-09-27";
    const days = noteDays("2026-09-28", (date) => date !== sunday);
    expect(days).toHaveLength(8);
    expect(days[0]).toEqual({ date: "2026-09-28", label: "Today, 28 Sep", kind: "overtime" });
    expect(days[1]).toEqual({ date: sunday, label: "Yesterday, 27 Sep", kind: "day_off" });
    expect(days[7]?.date).toBe("2026-09-21");
    expect(days[2]?.label).toBe("Sat, 26 Sep");
  });

  it("allows a note for today or up to 7 days back, never tomorrow or 8 days back", () => {
    expect(canAddNote("2026-09-28", "2026-09-28")).toBe(true);
    expect(canAddNote("2026-09-21", "2026-09-28")).toBe(true);
    expect(canAddNote("2026-09-20", "2026-09-28")).toBe(false);
    expect(canAddNote("2026-09-29", "2026-09-28")).toBe(false);
  });

  it("speaks the durations roughly", () => {
    expect(durationLabel(30)).toBe("30 min");
    expect(durationLabel(60)).toBe("1 h");
    expect(durationLabel(90)).toBe("1½ h");
    expect(durationLabel(240)).toBe("4 h");
    expect(DURATION_OPTIONS.every((minutes) => minutes > 0 && minutes <= 1440)).toBe(true);
  });

  it("titles a note with its kind, day and rough duration", () => {
    expect(noteTitle(note({}))).toBe("Overtime · Wed, 23 Sep · 2 h");
    expect(noteTitle(note({ durationMinutes: null }))).toBe("Overtime · Wed, 23 Sep");
    expect(
      noteTitle(note({ kind: "day_off", workDate: "2026-09-27", durationMinutes: null })),
    ).toBe("Worked on a day off · Sun, 27 Sep");
  });

  it("gives the outcome in the member's words (decision 13)", () => {
    expect(noteOutcome(note({}))).toEqual({ text: "Waiting for the Owner", status: "submitted" });
    expect(noteOutcome(note({}), "owner").text).toBe("Waiting for you");
    expect(
      noteOutcome(
        note({
          state: "reviewed",
          decision: "granted",
          credit: { days: 1, expiresOn: "2026-10-31" },
        }),
      ),
    ).toEqual({ text: "1 comp leave granted · use by 31 Oct", status: "approved" });
    expect(
      noteOutcome(
        note({
          state: "reviewed",
          decision: "granted",
          credit: { days: 0.5, expiresOn: "2026-09-30" },
          dayMarkedWorked: true,
        }),
      ).text,
    ).toBe("½ comp leave granted · use by 30 Sep · Counted as a day worked");
    expect(noteOutcome(note({ state: "reviewed", decision: "no_comp_leave" }))).toEqual({
      text: "Reviewed by the Owner",
      status: "none",
    });
    expect(
      noteOutcome(note({ state: "reviewed", decision: "no_comp_leave", dayMarkedWorked: true }))
        .text,
    ).toBe("Reviewed by the Owner · Counted as a day worked");
  });

  it("the Owner's decision needs a choice; the day-off mark and note are optional", () => {
    expect(
      decideNoteSchema.safeParse({
        noteId: "00000000-0000-4000-8000-000000000001",
        decision: "grant_half",
      }).success,
    ).toBe(true);
    expect(
      decideNoteSchema.parse({
        noteId: "00000000-0000-4000-8000-000000000001",
        decision: "no_comp_leave",
        note: "  ",
      }),
    ).toMatchObject({
      markDayWorked: false,
      note: null,
    });
    expect(
      decideNoteSchema.safeParse({ noteId: "00000000-0000-4000-8000-000000000001", decision: "" })
        .success,
    ).toBe(false);
  });

  it("End day takes an optional overtime note with a rough duration", () => {
    expect(endDaySchema.parse({})).toEqual({ overtimeNote: null, overtimeMinutes: null });
    expect(endDaySchema.parse({ overtimeNote: "Late edit", overtimeMinutes: 90 })).toEqual({
      overtimeNote: "Late edit",
      overtimeMinutes: 90,
    });
    expect(endDaySchema.safeParse({ overtimeNote: "Late edit", overtimeMinutes: 45 }).success).toBe(
      false,
    ); // A note that is there says what they worked on; an empty one is no note.
    expect(endDaySchema.safeParse({ overtimeNote: "ab" }).success).toBe(false);
    expect(endDaySchema.parse({ overtimeNote: "   " })).toEqual({
      overtimeNote: null,
      overtimeMinutes: null,
    });
  });
});
