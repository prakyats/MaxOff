"use server";

import { z } from "zod";

import { revalidateScreens } from "@/core/lib/revalidate-screens";
import { action, AppError, isPostgresError, ok, type Result } from "@/core/errors";
import { assertOwner, assertPermission } from "@/core/permissions/server";

import {
  type CreateHolidayInput,
  createHolidaySchema,
  type HolidayIdInput,
  holidayIdSchema,
  type UpdateCompanyInput,
  updateCompanySchema,
  type UpdateThresholdsInput,
  updateThresholdsSchema,
  type UpdateWeeklyOffInput,
  updateWeeklyOffSchema,
} from "../domain/schemas";
import * as repo from "../data/settings";

/**
 * The company settings (ARCHITECTURE §4.2: zod → `assertPermission()` → repository →
 * revalidate → `Result`). These are plain edits: the audit trigger records them, and every
 * one of them is `settings.manage`, which only the Owner holds (PERMISSIONS §1).
 */

export const updateCompany = action(async (input: UpdateCompanyInput): Promise<Result<null>> => {
  const data = updateCompanySchema.parse(input);
  await assertPermission("settings.manage");
  const company = await repo.getCompany();
  await repo.updateCompany(company.id, { name: data.name });
  revalidateScreens();
  return ok(null);
});

const logoSchema = z.object({ fileId: z.uuid() });
export type SetCompanyLogoInput = z.input<typeof logoSchema>;

/** The company logo (3.3, PRODUCT §4.16): the uploaded original; screens show its preview. */
export const setCompanyLogo = action(async (input: SetCompanyLogoInput): Promise<Result<null>> => {
  const { fileId } = logoSchema.parse(input);
  await assertPermission("settings.manage");
  const company = await repo.getCompany();
  await repo.setCompanyLogo(company.id, fileId);
  revalidateScreens();
  return ok(null);
});

export const removeCompanyLogo = action(async (): Promise<Result<null>> => {
  await assertPermission("settings.manage");
  const company = await repo.getCompany();
  await repo.setCompanyLogo(company.id, null);
  revalidateScreens();
  return ok(null);
});

export const updateWeeklyOffDays = action(
  async (input: UpdateWeeklyOffInput): Promise<Result<null>> => {
    const data = updateWeeklyOffSchema.parse(input);
    await assertPermission("settings.manage");
    const settings = await repo.getSettings();
    await repo.updateWeeklyOffDays(settings.orgId, data.weeklyOffDays);
    revalidateScreens();
    return ok(null);
  },
);

export const updateThresholds = action(
  async (input: UpdateThresholdsInput): Promise<Result<null>> => {
    const data = updateThresholdsSchema.parse(input);
    await assertPermission("settings.manage");
    const settings = await repo.getSettings();
    await repo.updateThresholds(settings.orgId, data);
    revalidateScreens();
    return ok(null);
  },
);

export const createHoliday = action(async (input: CreateHolidayInput): Promise<Result<null>> => {
  const data = createHolidaySchema.parse(input);
  await assertPermission("settings.manage");
  try {
    await repo.createHoliday(data);
  } catch (error) {
    // unique (org_id, date): the generic "This already exists" says nothing about which date.
    if (isPostgresError(error) && error.code === "23505") {
      throw new AppError("CONFLICT", "There is already a holiday on that date.");
    }
    throw error;
  }
  revalidateScreens();
  return ok(null);
});

export const removeHoliday = action(async (input: HolidayIdInput): Promise<Result<null>> => {
  const { holidayId } = holidayIdSchema.parse(input);
  // The Owner only, before the holiday's date (v1.8 V5a 6b); the database checks both again.
  await assertOwner();
  await repo.deleteHoliday(holidayId);
  revalidateScreens();
  return ok(null);
});
