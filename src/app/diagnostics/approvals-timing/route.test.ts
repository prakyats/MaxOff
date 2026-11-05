import { beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({
  getSessionState: vi.fn(),
  withSessionUserId: vi.fn(),
  getSessionBundle: vi.fn(),
  readOwnPushStatus: vi.fn(),
  getOwnToday: vi.fn(),
  listPendingDays: vi.fn(),
  listPendingNotes: vi.fn(),
  listEarlyLeaveRequests: vi.fn(),
  listPendingClaims: vi.fn(),
  listPendingRequests: vi.fn(),
  listTasksAtBothSteps: vi.fn(),
  listUnreadCounts: vi.fn(),
  listDirectory: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/navigation", () => ({ notFound: reads.notFound }));
vi.mock("@/core/auth/server", () => ({
  getSessionState: reads.getSessionState,
  withSessionUserId: reads.withSessionUserId,
}));
vi.mock("@/core/auth/session-bundle", () => ({ getSessionBundle: reads.getSessionBundle }));
vi.mock("@/core/notifications/push/subscriptions", () => ({
  readOwnPushStatus: reads.readOwnPushStatus,
}));
vi.mock("@/modules/attendance", () => ({
  getOwnToday: reads.getOwnToday,
  listPendingDays: reads.listPendingDays,
  listPendingNotes: reads.listPendingNotes,
  listEarlyLeaveRequests: reads.listEarlyLeaveRequests,
}));
vi.mock("@/modules/expenses", () => ({ listPendingClaims: reads.listPendingClaims }));
vi.mock("@/modules/leave", () => ({ listPendingRequests: reads.listPendingRequests }));
vi.mock("@/modules/tasks", () => ({
  listTasksAtBothSteps: reads.listTasksAtBothSteps,
  listUnreadCounts: reads.listUnreadCounts,
}));
vi.mock("@/modules/team", () => ({ listDirectory: reads.listDirectory }));

import { GET } from "./route";

const KEYS = [
  "member",
  "push",
  "bundle",
  "today",
  "days",
  "requests",
  "notes",
  "claims",
  "directory",
  "early",
  "tasks",
  "unread",
  "shell",
  "page",
];
/** Data the reads return: none of it may reach the answer. */
const SECRET = "Sample Member";

function member(role: "owner" | "admin" | "staff") {
  return { kind: "member", member: { id: "m-1", role, fullName: SECRET } };
}

describe("GET /diagnostics/approvals-timing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reads.getSessionState.mockResolvedValue(member("owner"));
    reads.withSessionUserId.mockImplementation((read: (id: string) => unknown) => read("m-1"));
    reads.getSessionBundle.mockResolvedValue({
      unread: 3,
      pending: { days: 1, requests: 1, notes: 1, claims: 1, earlyLeaves: 1 },
      label: SECRET,
    });
    reads.readOwnPushStatus.mockResolvedValue({
      endpoints: ["https://push.example/x"],
      band: null,
    });
    reads.getOwnToday.mockRejectedValue(new Error("the Owner has no working day"));
    for (const list of [
      reads.listPendingDays,
      reads.listPendingNotes,
      reads.listEarlyLeaveRequests,
      reads.listPendingClaims,
      reads.listPendingRequests,
      reads.listDirectory,
    ]) {
      list.mockResolvedValue([{ id: "row-1", fullName: SECRET, reason: SECRET }]);
    }
    reads.listTasksAtBothSteps.mockResolvedValue({
      final: [{ row: { id: "task-1", title: SECRET } }],
      check: [],
    });
    reads.listUnreadCounts.mockResolvedValue({ "task-1": 2 });
  });

  it("answers numbers only to a member: every read's time, never a row, an id or a name", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const text = await response.text();
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("task-1");
    expect(text).not.toContain("row-1");
    expect(text).not.toContain("m-1");
    const body = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([...KEYS].sort());
    for (const key of KEYS) expect(typeof body[key]).toBe("number");
    // The Owner has no working day: the own day does not hold the shell.
    expect(body.today).toBe(0);
    // The unread counts are read for the rows of the step the role decides.
    expect(reads.listUnreadCounts).toHaveBeenCalledWith(["task-1"]);
  });

  it("404s anyone who is not an active member, signed out included", async () => {
    reads.getSessionState.mockResolvedValue({ kind: "signed_out" });
    await expect(GET()).rejects.toThrow("NEXT_NOT_FOUND");
    reads.getSessionState.mockResolvedValue({ kind: "inactive" });
    await expect(GET()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("counts a working role's own day in the shell, and a failed read stays a number", async () => {
    reads.getSessionState.mockResolvedValue(member("admin"));
    reads.getOwnToday.mockResolvedValue({ workDate: "2026-11-03" });
    reads.listPendingClaims.mockRejectedValue(new Error("refused"));
    const body = (await (await GET()).json()) as Record<string, number>;
    expect(typeof body.today).toBe("number");
    expect(typeof body.claims).toBe("number");
    expect(body.shell).toBeGreaterThanOrEqual(body.today ?? Infinity);
  });
});
