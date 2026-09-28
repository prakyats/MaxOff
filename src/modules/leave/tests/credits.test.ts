import { describe, expect, it } from "vitest";

import {
  balanceLine,
  type CompCredit,
  compKindsAvailable,
  creditFree,
  creditStatus,
  daysLabel,
  describeCredit,
  formatDays,
} from "../domain/credits";
import {
  grantCompLeaveSchema,
  requestCompLeaveSchema,
  revokeCompLeaveSchema,
} from "../domain/schemas";

const CREDIT: CompCredit = {
  id: "c",
  days: 1,
  usedDays: 0,
  reservedDays: 0,
  grantedOn: "2026-09-12",
  expiresOn: "2026-09-30",
  note: null,
  noteId: null,
  revokedAt: null,
  revokeReason: null,
};
const credit = (patch: Partial<CompCredit>): CompCredit => ({ ...CREDIT, ...patch });
const TODAY = "2026-09-20";

describe("comp leave credits (PRODUCT §4.3a, kickoff 3b decisions 14-17)", () => {
  it("derives the status as the database does: revoked, used, expired, reserved, available", () => {
    expect(creditStatus(credit({}), TODAY)).toBe("available");
    expect(creditStatus(credit({ reservedDays: 1 }), TODAY)).toBe("reserved");
    expect(creditStatus(credit({ reservedDays: 0.5 }), TODAY)).toBe("available");
    expect(creditStatus(credit({ usedDays: 1 }), TODAY)).toBe("used");
    expect(creditStatus(credit({}), "2026-10-01")).toBe("expired");
    expect(creditStatus(credit({ usedDays: 0.5 }), "2026-10-01")).toBe("expired");
    expect(creditStatus(credit({ revokedAt: "2026-09-13T04:00:00Z" }), TODAY)).toBe("revoked");
  });

  it("counts the free days only while the credit lives", () => {
    expect(creditFree(credit({}), TODAY)).toBe(1);
    expect(creditFree(credit({ usedDays: 0.5, reservedDays: 0.5 }), TODAY)).toBe(0);
    expect(creditFree(credit({}), "2026-10-01")).toBe(0);
    expect(creditFree(credit({ revokedAt: "2026-09-13T04:00:00Z" }), TODAY)).toBe(0);
  });

  it("speaks in halves", () => {
    expect(formatDays(0.5)).toBe("½");
    expect(formatDays(1)).toBe("1");
    expect(formatDays(1.5)).toBe("1½");
    expect(daysLabel(0.5)).toBe("½ day");
    expect(daysLabel(1)).toBe("1 day");
    expect(daysLabel(1.5)).toBe("1½ days");
  });

  it("puts the balance in one line", () => {
    expect(balanceLine({ availableDays: 1.5, useBy: "2026-09-30" })).toBe(
      "1½ days of comp leave · use by 30 Sep",
    );
    expect(balanceLine({ availableDays: 0, useBy: null })).toBe("No comp leave available");
  });

  it("describes a credit as a row", () => {
    expect(describeCredit(credit({}), TODAY)).toEqual({
      title: "1 day · granted 12 Sep",
      detail: "use by 30 Sep",
      status: "available",
    });
    expect(describeCredit(credit({ usedDays: 0.5 }), TODAY).detail).toBe("½ left · use by 30 Sep");
    expect(describeCredit(credit({ usedDays: 0.5 }), "2026-10-02").detail).toBe(
      "½ used, the rest expired",
    );
    expect(describeCredit(credit({ days: 0.5 }), TODAY).title).toBe("½ day · granted 12 Sep");
  });

  it("offers comp leave in the leave form only with a credit (decision 16)", () => {
    expect(compKindsAvailable({ availableDays: 0, useBy: null })).toEqual([]);
    expect(compKindsAvailable({ availableDays: 0.5, useBy: "2026-09-30" })).toEqual(["comp_half"]);
    expect(compKindsAvailable({ availableDays: 1, useBy: "2026-09-30" })).toEqual([
      "comp_full",
      "comp_half",
    ]);
  });

  it("checks the request's date against today and the use-by date", () => {
    const schema = requestCompLeaveSchema(TODAY, "2026-09-30");
    expect(schema.safeParse({ date: "2026-09-25", halfDay: false }).success).toBe(true);
    expect(schema.safeParse({ date: "2026-09-19", halfDay: false }).success).toBe(false);
    expect(schema.safeParse({ date: "2026-10-01", halfDay: true }).success).toBe(false);
    expect(schema.parse({ date: "2026-09-25", halfDay: true, reason: "  " }).reason).toBeNull();
  });

  it("grants half a day or one day, and revokes with a reason", () => {
    const member = "00000000-0000-4000-8000-000000000001";
    expect(grantCompLeaveSchema.safeParse({ memberId: member, days: 0.5 }).success).toBe(true);
    expect(
      grantCompLeaveSchema.safeParse({ memberId: member, days: 1, note: "Sunday edit" }).success,
    ).toBe(true);
    expect(grantCompLeaveSchema.safeParse({ memberId: member, days: 2 }).success).toBe(false);
    expect(
      revokeCompLeaveSchema.safeParse({ creditId: member, reason: "Granted by mistake" }).success,
    ).toBe(true);
    expect(revokeCompLeaveSchema.safeParse({ creditId: member, reason: "no" }).success).toBe(false);
  });
});
