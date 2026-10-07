import { beforeEach, describe, expect, it, vi } from "vitest";

import { systemClock } from "@/core/time";

const { revalidatePath, revalidateTag, markOne, markAll } = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  markOne: vi.fn(),
  markAll: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath, revalidateTag }));
vi.mock("@/core/auth/server", () => ({ getCurrentMember: async () => ({ id: "m1" }) }));
vi.mock("@/core/notifications/inbox", () => ({
  markOneRead: markOne,
  rpcMarkAllRead: markAll,
}));

import { markAllNotificationsRead, markNotificationRead } from "../actions/inbox";

const ID = "6f1c2c1e-3a0b-4c4e-9a43-0d3f1c2b9e10";

/**
 * Owner decision 2026-10-01: marking notifications read never refreshes or reloads the page, so
 * no read answers with a revalidation (an answer that re-renders the page reloads it when it
 * lands after a view switch). Each says how many it marked and when. Opening a record is a
 * background call, not an action (`app/api/notifications/read-record/route.test.ts`).
 */
describe("the read actions revalidate nothing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markOne.mockResolvedValue({ link: "/tasks/x", marked: true });
    markAll.mockResolvedValue(4);
  });

  it("a row tapped", async () => {
    const result = await markNotificationRead({ id: ID });
    expect(result).toMatchObject({ ok: true, data: { marked: 1 } });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("Mark all read, with the server's clock after the write", async () => {
    const before = systemClock().getTime();
    const result = await markAllNotificationsRead();
    expect(result).toMatchObject({ ok: true, data: { marked: 4 } });
    if (!result.ok) throw new Error("expected ok");
    expect(result.data.writtenAt).toBeGreaterThanOrEqual(before);
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("a failed write answers an error, never a revalidation", async () => {
    markAll.mockRejectedValue(new Error("down"));
    const result = await markAllNotificationsRead();
    expect(result.ok).toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
