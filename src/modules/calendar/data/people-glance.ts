import "server-only";

import { createServerSupabase } from "@/core/db/server";
import type { ISODate } from "@/core/time";

/**
 * One person on People for an Admin (v6.5 unit 13), as `member_people_glance()` answers: their
 * first booking after the day (`onDate` null when none in the window) and, when on full-day leave
 * that day, the first working day they are back (`backOn`).
 */
export type PeopleGlanceRow = {
  memberId: string;
  onDate: ISODate | null;
  /** Null for a date-only event (all day). */
  startAt: string | null;
  endAt: string | null;
  typeId: string | null;
  typeName: string | null;
  bookedById: string | null;
  bookedByName: string | null;
  backOn: ISODate | null;
};

/**
 * People's "Next booked" and "back on" for an Admin (v6.5 unit 13; `availability.view`): one call,
 * one row per person with either, from `member_people_glance()` (never a title, client or
 * location; the fact of leave, never its type).
 */
export async function listPeopleGlance(after: ISODate, days: number): Promise<PeopleGlanceRow[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("member_people_glance", { after_date: after, days });
  if (error) throw error;
  // The generated row type says string; a missing booking, type, creator or return day is null.
  const text = (value: string | null | undefined) => value ?? null;
  return data.map((row) => ({
    memberId: row.member_id,
    onDate: text(row.on_date) as ISODate | null,
    startAt: text(row.start_at),
    endAt: text(row.end_at),
    typeId: text(row.type_id),
    typeName: text(row.type_name),
    bookedById: text(row.booked_by),
    bookedByName: text(row.booked_by_name),
    backOn: text(row.back_on) as ISODate | null,
  }));
}
