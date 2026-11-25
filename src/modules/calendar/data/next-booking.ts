import "server-only";

import { createServerSupabase } from "@/core/db/server";
import type { ISODate } from "@/core/time";

/** One person's first booking after a day, as `member_next_booking()` answers (v6.5 unit 13). */
export type NextBookingRow = {
  memberId: string;
  onDate: ISODate;
  /** Null for a date-only event (all day). */
  startAt: string | null;
  endAt: string | null;
  typeId: string | null;
  typeName: string | null;
  bookedById: string | null;
  bookedByName: string | null;
};

/**
 * People's "Next booked" for an Admin (v6.5 unit 13; `availability.view`): per active person the
 * first booking after `after` within `days` (1–62), from `member_next_booking()`, one row per
 * person: the date, type, start and who booked it, never a title, client or location.
 */
export async function listNextBookings(after: ISODate, days: number): Promise<NextBookingRow[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("member_next_booking", { after_date: after, days });
  if (error) throw error;
  // The generated row type says string; a date-only event, an unknown type or creator is null.
  const text = (value: string | null | undefined) => value ?? null;
  return data.map((row) => ({
    memberId: row.member_id,
    onDate: row.on_date as ISODate,
    startAt: text(row.start_at),
    endAt: text(row.end_at),
    typeId: text(row.type_id),
    typeName: text(row.type_name),
    bookedById: text(row.booked_by),
    bookedByName: text(row.booked_by_name),
  }));
}
