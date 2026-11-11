import { beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({
  getSessionState: vi.fn(),
  firstReadsStats: vi.fn(),
  getSessionBundle: vi.fn(),
  readOwnPushStatus: vi.fn(),
  getOwnToday: vi.fn(),
  getOwnHours: vi.fn(),
  getEarlyLeaveWait: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/navigation", () => ({ notFound: reads.notFound }));
vi.mock("@/core/auth/server", () => ({
  getSessionState: reads.getSessionState,
  firstReadsStats: reads.firstReadsStats,
}));
vi.mock("@/core/auth/session-bundle", () => ({ getSessionBundle: reads.getSessionBundle }));
vi.mock("@/core/notifications/push/subscriptions", () => ({
  readOwnPushStatus: reads.readOwnPushStatus,
}));
vi.mock("@/modules/attendance", () => ({
  getOwnToday: reads.getOwnToday,
  getOwnHours: reads.getOwnHours,
  getEarlyLeaveWait: reads.getEarlyLeaveWait,
}));

import { GET } from "./route";

/** Data the reads return: none of it may reach the answer. */
const SECRET = "Sample Member";

function member(role: "owner" | "admin" | "staff") {
  return { kind: "member", member: { id: "m-1", role, fullName: SECRET } };
}

describe("GET /diagnostics/day-timing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reads.getSessionState.mockResolvedValue(member("owner"));
    reads.firstReadsStats.mockReturnValue({ holds: 3, waits: 9, valve: 0, longest: 4, total: 11 });
    reads.getSessionBundle.mockResolvedValue({ unread: 1, label: SECRET });
    reads.readOwnPushStatus.mockResolvedValue({ endpoints: ["https://push.example/x"] });
    reads.getOwnToday.mockResolvedValue({ workDate: "2026-11-05", note: SECRET });
    reads.getOwnHours.mockResolvedValue({ workDate: "2026-11-05", reason: SECRET });
    reads.getEarlyLeaveWait.mockResolvedValue(30);
  });

  it("answers numbers and counts only to the Owner, never a row, an id or a name", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const text = await response.text();
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("m-1");
    expect(text).not.toContain("push.example");
    const body = JSON.parse(text) as Record<string, unknown>;
    for (const key of ["member", "today", "push", "bundle", "hours", "early_wait", "shell"]) {
      expect(typeof body[key]).toBe("number");
    }
    expect(body.first_reads).toEqual({ holds: 3, waits: 9, valve: 0, longest: 4, total: 11 });
    expect(body.role).toBe("owner");
  });

  it("reads 0 for the own day and hours of a role without one, and a failed read stays a number", async () => {
    reads.getSessionState.mockResolvedValue(member("owner"));
    reads.getOwnToday.mockRejectedValue(new Error("the Owner has no working day"));
    reads.getOwnHours.mockRejectedValue(new Error("refused"));
    const body = (await (await GET()).json()) as Record<string, number>;
    expect(body.today).toBe(0);
    expect(body.hours).toBe(0);
    expect(body.strip).toBe(0);
  });

  it("404s an Admin and a Crew member: the Owner's only", async () => {
    for (const role of ["admin", "staff"] as const) {
      reads.getSessionState.mockResolvedValue(member(role));
      await expect(GET()).rejects.toThrow("NEXT_NOT_FOUND");
    }
  });

  it("404s anyone who is not an active member", async () => {
    reads.getSessionState.mockResolvedValue({ kind: "none" });
    await expect(GET()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
