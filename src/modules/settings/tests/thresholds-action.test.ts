import { beforeEach, describe, expect, it, vi } from "vitest";

const { revalidatePath, getCurrentMember, getSettings, updateThresholds } = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  getCurrentMember: vi.fn(),
  getSettings: vi.fn(),
  updateThresholds: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/core/auth/server", () => ({ getCurrentMember }));
vi.mock("../data/settings", () => ({ getSettings, updateThresholds }));

import { updateThresholds as saveThresholds } from "../actions/settings";

const input = {
  logoutReminderTime: "20:30",
  endDayCutoffTime: "05:00",
  ackRepeatHours: "2",
  ackEscalateHours: "4",
  ackEscalateOwnerHours: "8",
  overdueEscalateHours: "24",
  emailDailyCapPerMember: "20",
  workloadWarningThreshold: "4",
  quietHoursStart: "23:00",
  quietHoursEnd: "06:30",
};

/**
 * The quiet-hours editor (5B decision 6): Settings → Thresholds, the Owner only
 * (`settings.manage`); the two IST times reach the repository with the rest of the form.
 */
describe("updateThresholds: quiet hours", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettings.mockResolvedValue({ orgId: "org-1" });
    updateThresholds.mockResolvedValue(undefined);
  });

  it("saves the Owner's quiet hours with the other thresholds", async () => {
    getCurrentMember.mockResolvedValue({ id: "o1", role: "owner" });
    const result = await saveThresholds(input);
    expect(result).toEqual({ ok: true, data: null });
    expect(updateThresholds).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({ quietHoursStart: "23:00", quietHoursEnd: "06:30" }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/settings/thresholds");
  });

  it("refuses an Admin and a Crew member before anything is written", async () => {
    for (const role of ["admin", "staff"] as const) {
      getCurrentMember.mockResolvedValue({ id: "m1", role });
      const result = await saveThresholds(input);
      expect(result).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    }
    expect(updateThresholds).not.toHaveBeenCalled();
  });

  it("answers the same start and end with a field error, writing nothing", async () => {
    getCurrentMember.mockResolvedValue({ id: "o1", role: "owner" });
    const result = await saveThresholds({ ...input, quietHoursEnd: "23:00" });
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION",
        fieldErrors: {
          quietHoursEnd: ["Quiet hours need an end time different from the start."],
        },
      },
    });
    expect(updateThresholds).not.toHaveBeenCalled();
  });
});
