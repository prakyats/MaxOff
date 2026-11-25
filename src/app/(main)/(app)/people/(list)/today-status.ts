import type { StatusTone } from "@/core/lib/status-tones";

/** One person on today's IST date, as `member_availability()` answers an Admin (4A). */
export type TodayAvailability = {
  memberId: string;
  leave: "leave" | "half_day" | "comp_leave" | "requested" | null;
  eventBlocks: readonly { startAt: string; endAt: string }[];
};

export type TodayStatus = {
  key: "leave" | "half_day" | "busy" | "available";
  label: string;
  tone: StatusTone;
};

/**
 * The People list's "Today" for an Admin (PP-admin-10): on leave (approved leave or comp leave),
 * a half day, busy (inside one of their timed event tasks right now) or available, from
 * `member_availability()` alone (`availability.view`: the fact of leave and busy blocks, never a
 * pending request or a title; PERMISSIONS §2). The Owner is never "available" or "on leave" to an
 * Admin (6b.2): only busy, else nothing. Pure (`today-status.test.ts`).
 */
export function todayStatus(
  day: TodayAvailability | undefined,
  now: Date,
  isOwner: boolean,
): TodayStatus | null {
  const at = now.getTime();
  const busy = (day?.eventBlocks ?? []).some(
    (block) => Date.parse(block.startAt) <= at && at < Date.parse(block.endAt),
  );
  if (isOwner) return busy ? BUSY : null;
  if (day?.leave === "leave" || day?.leave === "comp_leave") {
    return { key: "leave", label: "On leave", tone: "neutral" };
  }
  if (day?.leave === "half_day") return { key: "half_day", label: "Half day", tone: "attention" };
  if (busy) return BUSY;
  return { key: "available", label: "Available", tone: "success" };
}

const BUSY: TodayStatus = { key: "busy", label: "Busy", tone: "info" };
