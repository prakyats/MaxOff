import { beforeEach, describe, expect, it, vi } from "vitest";

const { assertPermission, availability, rpcMarkRead } = vi.hoisted(() => ({
  assertPermission: vi.fn(),
  availability: vi.fn(),
  rpcMarkRead: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/core/permissions/server", () => ({ assertPermission }));
vi.mock("../data/tasks", () => ({ availability, rpcMarkRead }));

import { markTaskRead, readAvailability } from "../actions/background";

const TASK = "6f1c2c1e-3a0b-4c4e-9a43-0d3f1c2b9e10";
const MEMBER = "0b8a3f7e-1c2d-4e5f-8a9b-1c2d3e4f5a6b";

/**
 * The tasks module's background calls (ARCHITECTURE §4.4): the checks of the server actions they
 * replaced (`loadAvailability`, `markTaskRead`), zod first, then the permission, then the write.
 */
describe("tasks background calls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    availability.mockResolvedValue([]);
  });

  it("the warning check needs availability.view and reads the people on the days", async () => {
    await readAvailability({ memberIds: [MEMBER], days: ["2026-10-06"] });
    expect(assertPermission).toHaveBeenCalledWith("availability.view");
    expect(availability).toHaveBeenCalledWith(["2026-10-06"], [MEMBER]);
  });

  it("the warning check refuses a bad input before the permission or the read", async () => {
    for (const input of [
      { memberIds: [], days: ["2026-10-06"] },
      { memberIds: ["x"], days: ["2026-10-06"] },
      { memberIds: [MEMBER], days: ["06/10/2026"] },
      { memberIds: [MEMBER], days: ["2026-10-06", "2026-10-07", "2026-10-08"] },
      null,
    ]) {
      await expect(readAvailability(input)).rejects.toMatchObject({ name: "ZodError" });
    }
    expect(assertPermission).not.toHaveBeenCalled();
    expect(availability).not.toHaveBeenCalled();
  });

  it("a read of Chat needs tasks.work and marks up to the newest comment shown", async () => {
    const upTo = "2026-10-06T10:00:00.000+05:30";
    expect(await markTaskRead({ taskId: TASK, upTo })).toBeNull();
    expect(assertPermission).toHaveBeenCalledWith("tasks.work");
    expect(rpcMarkRead).toHaveBeenCalledWith(TASK, upTo);
  });

  it("a read of Chat refuses a bad input before the permission or the write", async () => {
    await expect(markTaskRead({ taskId: TASK, upTo: "yesterday" })).rejects.toMatchObject({
      name: "ZodError",
    });
    expect(assertPermission).not.toHaveBeenCalled();
    expect(rpcMarkRead).not.toHaveBeenCalled();
  });

  it("a refused permission stops the write", async () => {
    assertPermission.mockRejectedValueOnce(new Error("FORBIDDEN"));
    await expect(
      markTaskRead({ taskId: TASK, upTo: "2026-10-06T10:00:00.000Z" }),
    ).rejects.toThrow();
    expect(rpcMarkRead).not.toHaveBeenCalled();
  });
});
