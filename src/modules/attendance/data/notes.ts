import "server-only";

import { getCurrentMember } from "@/core/auth/server";
import { createServerSupabase } from "@/core/db/server";
import { addISTDays, isWorkingDay, type WeekdayIndex } from "@/core/time";
import { displayName } from "@/core/lib/display-name";

import {
  type ExtraWorkKind,
  type ExtraWorkNote,
  NOTE_DAYS_BACK,
  type NoteDay,
  type NoteDecision,
  noteDays,
} from "../domain/notes";

/**
 * Extra work notes (CLAUDE.md rule 3; DATA-MODEL §3 `extra_work_notes`). Reads go through RLS
 * (own rows, or everyone's for `attendance.view_all`); every write is a transition function.
 */

const NOTE_COLUMNS =
  "id, member_id, work_date, kind, duration_minutes, note, state, decision, day_marked_worked, created_at, credit:comp_leave_credits(days, expires_on)";

type NoteRow = {
  id: string;
  member_id: string;
  work_date: string;
  kind: string;
  duration_minutes: number | null;
  note: string;
  state: string;
  decision: string | null;
  day_marked_worked: boolean;
  created_at: string;
  credit:
    | { days: number | string; expires_on: string }[]
    | { days: number | string; expires_on: string }
    | null;
};

function toKind(value: string): ExtraWorkKind {
  if (value === "overtime" || value === "day_off") return value;
  throw new Error(`Unknown extra work kind: ${value}`);
}

function toNote(row: NoteRow): ExtraWorkNote {
  const embedded = row.credit;
  const credit = Array.isArray(embedded) ? (embedded[0] ?? null) : embedded;
  return {
    id: row.id,
    memberId: row.member_id,
    workDate: row.work_date,
    kind: toKind(row.kind),
    durationMinutes: row.duration_minutes,
    note: row.note,
    state: row.state === "reviewed" ? "reviewed" : "submitted",
    decision: row.decision === "granted" || row.decision === "no_comp_leave" ? row.decision : null,
    dayMarkedWorked: row.day_marked_worked,
    createdAt: row.created_at,
    credit: credit ? { days: Number(credit.days), expiresOn: credit.expires_on } : null,
  };
}

/** One member's notes, newest day first (the member's Extra work tab; 60 is over two months). */
export async function listOwnNotes(memberId: string): Promise<ExtraWorkNote[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("extra_work_notes")
    .select(NOTE_COLUMNS)
    .eq("member_id", memberId)
    .order("work_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(60);
  if (error) throw error;
  return (data as unknown as NoteRow[]).map(toNote);
}

/** At most this many waiting notes are listed; nobody decides more in one sitting. */
const PENDING_LIMIT = 200;

/** Every note waiting for the Owner, oldest first, with the person's name. */
export async function listPendingNotes(): Promise<(ExtraWorkNote & { memberName: string })[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("extra_work_notes")
    .select(`${NOTE_COLUMNS}, member:members!member_id(full_name)`)
    .eq("state", "submitted")
    .order("created_at", { ascending: true })
    .limit(PENDING_LIMIT);
  if (error) throw error;
  return (data as unknown as (NoteRow & { member: { full_name: string } | null })[]).map((row) => ({
    ...toNote(row),
    memberName: displayName(row.member?.full_name),
  }));
}

/** How many notes wait for the Owner: part of the Approvals badge. */
export async function countPendingNotes(): Promise<number> {
  const supabase = await createServerSupabase();
  const { count, error } = await supabase
    .from("extra_work_notes")
    .select("id", { count: "exact", head: true })
    .eq("state", "submitted");
  if (error) throw error;
  return count ?? 0;
}

export async function rpcSubmitNote(input: {
  kind: ExtraWorkKind;
  workDate: string;
  note: string;
  durationMinutes: number | null;
}): Promise<string> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("extra_work_note_submit", {
    kind: input.kind,
    work_date: input.workDate,
    note: input.note,
    ...(input.durationMinutes ? { duration_minutes: input.durationMinutes } : {}),
  });
  if (error) throw error;
  return data;
}

export async function rpcDecideNote(input: {
  noteId: string;
  decision: NoteDecision;
  markDayWorked: boolean;
  note: string | null;
}): Promise<string | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("extra_work_note_decide", {
    note_id: input.noteId,
    decision: input.decision === "no_comp_leave" ? "no_comp_leave" : "grant",
    ...(input.decision === "grant_half" ? { days: 0.5 } : {}),
    ...(input.decision === "grant_full" ? { days: 1 } : {}),
    mark_day_worked: input.markDayWorked,
    ...(input.note ? { note: input.note } : {}),
  });
  if (error) throw error;
  return data;
}

/** Whether the caller already noted overtime on that day (End day then offers no note). */
export async function hasOvertimeNote(workDate: string): Promise<boolean> {
  const member = await getCurrentMember();
  if (!member) return false;
  const supabase = await createServerSupabase();
  const { count, error } = await supabase
    .from("extra_work_notes")
    .select("id", { count: "exact", head: true })
    .eq("member_id", member.id)
    .eq("work_date", workDate)
    .eq("kind", "overtime");
  if (error) throw error;
  return (count ?? 0) > 0;
}

/** The days a note may be about, today first, each with the kind of note it takes. */
export async function getNoteDays(today: string): Promise<NoteDay[]> {
  const isWorking = await getWorkingDayRule(addISTDays(today, -NOTE_DAYS_BACK), today);
  return noteDays(today, isWorking);
}

/**
 * The calendar the note dialog needs to tell an overtime day from a day off, as the database
 * tells them (`app.is_working_day`): the weekly off days and the holidays around today. Both
 * tables are readable by every active member (DATA-MODEL §1).
 */
async function getWorkingDayRule(from: string, to: string): Promise<(date: string) => boolean> {
  const supabase = await createServerSupabase();
  const [settings, holidays] = await Promise.all([
    supabase.from("org_settings").select("weekly_off_days").limit(1).maybeSingle(),
    supabase.from("holidays").select("date").gte("date", from).lte("date", to),
  ]);
  if (settings.error) throw settings.error;
  if (holidays.error) throw holidays.error;
  const rules = {
    weeklyOffDays: (settings.data?.weekly_off_days ?? []) as WeekdayIndex[],
    holidays: holidays.data.map((row) => row.date),
  };
  return (date) => isWorkingDay(date, rules);
}
