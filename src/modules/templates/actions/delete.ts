"use server";

import { z } from "zod";

import { action, ok, type Result } from "@/core/errors";
import type { TemplateUsage } from "@/core/lib/owner-delete";
import { revalidateScreens } from "@/core/lib/revalidate-screens";
import { assertOwner } from "@/core/permissions/server";

import * as repo from "../data/delete";

/**
 * The Owner-only Delete of project and deliverable templates (v1.8 V5a 6b, owner 2026-10-22):
 * any time, used or not; the database (`template_delete`) checks the Owner again and does it in one
 * transaction. The usage is what the confirm says first.
 */
const schema = z.object({ templateId: z.uuid() });
export type TemplateIdInput = z.input<typeof schema>;

export const projectTemplateUsage = action(
  async (input: TemplateIdInput): Promise<Result<TemplateUsage>> => {
    const { templateId } = schema.parse(input);
    await assertOwner();
    return ok(await repo.templateUsage("project", templateId));
  },
);

export const deleteProjectTemplate = action(
  async (input: TemplateIdInput): Promise<Result<null>> => {
    const { templateId } = schema.parse(input);
    await assertOwner();
    await repo.deleteTemplate("project", templateId);
    revalidateScreens();
    return ok(null);
  },
);

export const deleteDeliverableTemplate = action(
  async (input: TemplateIdInput): Promise<Result<null>> => {
    const { templateId } = schema.parse(input);
    await assertOwner();
    await repo.deleteTemplate("deliverable", templateId);
    revalidateScreens();
    return ok(null);
  },
);
