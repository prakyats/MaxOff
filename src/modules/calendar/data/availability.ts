import "server-only";

import { createServerSupabase } from "@/core/db/server";
import { addISTDays, type ISODate } from "@/core/time";

import type { AvailabilitySource } from "../domain/calendar";

/** The most rows one call may answer (PostgREST's `max_rows` is 1000): a longer read is cut. */
const ROWS_PER_CALL = 900;

/**
 * An Admin's view of everyone (`member_availability()`, `availability.view`; Kickoff 6
 * decision 13; the Owner too since 6b.2): per person per IST day, the approved leave as a fact
 * and every event task as a block with its type and who booked it (v6.0; a date-only event has no
 * start: busy all day), never a title, a client, a location or an id. One row per person per day, so the range is read in slices that
 * each stay under PostgREST's row limit (6A mechanics (1): a cut answer would hide someone's
 * block). `memberIds` keeps the read to these people (a person filter); null reads everyone.
 */
export async function listAvailability(
  from: ISODate,
  to: ISODate,
  memberIds: readonly string[] | null,
): Promise<AvailabilitySource[]> {
  if (to < from) return [];
  const supabase = await createServerSupabase();
  const people = memberIds ? [...new Set(memberIds)] : null;
  if (people && people.length === 0) return [];
  const calls: { from: ISODate; to: ISODate; ids: string[] | null }[] = [];
  if (people) {
    for (let first = 0; first < people.length; first += ROWS_PER_CALL) {
      const ids = people.slice(first, first + ROWS_PER_CALL);
      const perCall = Math.max(1, Math.floor(ROWS_PER_CALL / ids.length));
      for (let start = from; start <= to; start = addISTDays(start, perCall)) {
        const end = addISTDays(start, perCall - 1);
        calls.push({ from: start, to: end < to ? end : to, ids });
      }
    }
  } else {
    // Everyone: the team is well under a hundred, so a week at a time stays under the limit.
    for (let start = from; start <= to; start = addISTDays(start, 7)) {
      const end = addISTDays(start, 6);
      calls.push({ from: start, to: end < to ? end : to, ids: null });
    }
  }
  const answers = await Promise.all(
    calls.map((call) =>
      supabase.rpc("member_availability", {
        from_date: call.from,
        to_date: call.to,
        ...(call.ids ? { member_ids: call.ids } : {}),
      }),
    ),
  );
  return answers.flatMap(({ data, error }) => {
    if (error) throw error;
    return data.map((row) => ({
      memberId: row.member_id,
      day: row.day,
      leave: row.leave,
      blocks: parseBlocks(row.event_blocks),
    }));
  });
}

/**
 * A block as the function writes it (v6.0): `{start_at, end_at, all_day, type_id, type_name,
 * booked_by, booked_by_name}`; a date-only event has no start or end. Anything else is no block; a
 * key an older function leaves out reads as null.
 */
function parseBlocks(value: unknown): AvailabilitySource["blocks"] {
  if (!Array.isArray(value)) return [];
  const text = (field: unknown) => (typeof field === "string" ? field : null);
  return value.flatMap((item) => {
    if (item === null || typeof item !== "object") return [];
    const block = item as Record<string, unknown>;
    return [
      {
        startAt: text(block.start_at),
        endAt: text(block.end_at),
        typeId: text(block.type_id),
        typeName: text(block.type_name),
        bookedById: text(block.booked_by),
        bookedByName: text(block.booked_by_name),
      },
    ];
  });
}
