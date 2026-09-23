"use server";

import { revalidatePath } from "next/cache";

import { action, AppError, isPostgresError, ok, type Result } from "@/core/errors";
import { assertPermission } from "@/core/permissions/server";

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

const COMPANY_PATH = "/settings/company";
const DAYS_OFF_PATH = "/settings/days-off";
const THRESHOLDS_PATH = "/settings/thresholds";

export const updateCompany = action(async (input: UpdateCompanyInput): Promise<Result<null>> => {
  const data = updateCompanySchema.parse(input);
  await assertPermission("settings.manage");
  const company = await repo.getCompany();
  await repo.updateCompany(company.id, { name: data.name });
  revalidatePath(COMPANY_PATH);
  return ok(null);
});

export const updateWeeklyOffDays = action(
  async (input: UpdateWeeklyOffInput): Promise<Result<null>> => {
    const data = updateWeeklyOffSchema.parse(input);
    await assertPermission("settings.manage");
    const settings = await repo.getSettings();
    await repo.updateWeeklyOffDays(settings.orgId, data.weeklyOffDays);
    revalidatePath(DAYS_OFF_PATH);
    return ok(null);
  },
);

export const updateThresholds = action(
  async (input: UpdateThresholdsInput): Promise<Result<null>> => {
    const data = updateThresholdsSchema.parse(input);
    await assertPermission("settings.manage");
    const settings = await repo.getSettings();
    await repo.updateThresholds(settings.orgId, data);
    revalidatePath(THRESHOLDS_PATH);
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
  revalidatePath(DAYS_OFF_PATH);
  return ok(null);
});

export const removeHoliday = action(async (input: HolidayIdInput): Promise<Result<null>> => {
  const { holidayId } = holidayIdSchema.parse(input);
  await assertPermission("settings.manage");
  await repo.deleteHoliday(holidayId);
  revalidatePath(DAYS_OFF_PATH);
  return ok(null);
});
