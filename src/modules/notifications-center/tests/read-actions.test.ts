import { beforeEach, describe, expect, it, vi } from "vitest";

import { systemClock } from "@/core/time";

const { revalidatePath, revalidateTag, markOne, markAll, markRecord } = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  markOne: vi.fn(),
  markAll: vi.fn(),
  markRecord: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath, revalidateTag }));
vi.mock("@/core/auth/server", () => ({ getCurrentMember: async () => ({ id: "m1" }) }));
vi.mock("@/core/notifications/inbox", () => ({
  markOneRead: markOne,
  rpcMarkAllRead: markAll,
  rpcMarkRecordRead: markRecord,
}));

import { markAllNotificationsRead, markNotificationRead, markRecordRead } from "../actions/inbox";

const ID = "6f1c2c1e-3a0b-4c4e-9a43-0d3f1c2b9e10";

/**
 * Owner decision 2026-10-01: marking notifications read never refreshes or reloads the page, so
 * no read answers with a revalidation (an answer that re-renders the page reloads it when it
 * lands after a view switch). Each says how many it marked and when.
 */
describe("the read actions revalidate nothing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markOne.mockResolvedValue({ link: "/tasks/x", marked: true });
    markAll.mockResolvedValue(4);
    markRecord.mockResolvedValue(2);
  });

  it("a row tapped", async () => {
    const result = await markNotificationRead({ id: ID });
    expect(result).toMatchObject({ ok: true, data: { marked: 1 } });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("Mark all read", async () => {
    const result = await markAllNotificationsRead();
    expect(result).toMatchObject({ ok: true, data: { marked: 4 } });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("a record opened, with the server's clock after the write", async () => {
    const before = systemClock().getTime();
    const result = await markRecordRead({ entity: "tasks", id: ID });
    expect(result).toMatchObject({ ok: true, data: { marked: 2 } });
    if (!result.ok) throw new Error("expected ok");
    expect(result.data.writtenAt).toBeGreaterThanOrEqual(before);
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("a failed write answers an error, never a revalidation", async () => {
    markRecord.mockRejectedValue(new Error("down"));
    const result = await markRecordRead({ entity: "tasks", id: ID });
    expect(result.ok).toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
