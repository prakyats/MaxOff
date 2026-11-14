import "server-only";

import { cache } from "react";

import type { Database } from "@/core/db/database.types";
import { createServerSupabase } from "@/core/db/server";

type Functions = Database["public"]["Functions"];

/**
 * The Owner's Today board in one read (v2.0 X3, `attendance_board_today()`; ARCHITECTURE §19 "Six
 * connections"): today's people (`attendance_today_detail()`'s rows) and everyone's working hours
 * (`attendance_hours_today()`'s rows), once per request, so `getTodayPeople` and `getHoursToday`
 * share it. A caller without `attendance.view_all` gets `refused` (as those functions would raise)
 * and neither part.
 */
export const readBoardToday = cache(
  async (): Promise<{
    people: Functions["attendance_today_detail"]["Returns"] | null;
    hours: Functions["attendance_hours_today"]["Returns"] | null;
    refused: string | null;
  }> => {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc("attendance_board_today");
    if (error) throw error;
    return data as {
      people: Functions["attendance_today_detail"]["Returns"] | null;
      hours: Functions["attendance_hours_today"]["Returns"] | null;
      refused: string | null;
    };
  },
);

/** A part of the board, or the refusal its own function would have raised. */
export async function boardPart<K extends "people" | "hours">(
  part: K,
): Promise<NonNullable<Awaited<ReturnType<typeof readBoardToday>>[K]>> {
  const board = await readBoardToday();
  const rows = board[part];
  if (board.refused || !rows) throw new Error(board.refused ?? "FORBIDDEN");
  return rows as NonNullable<Awaited<ReturnType<typeof readBoardToday>>[K]>;
}
