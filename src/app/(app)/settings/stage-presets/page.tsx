import type { Metadata } from "next";

import { checkThenRead } from "@/core/lib/start-early";
import { requirePermission } from "@/core/permissions/server";
import { PageHeader } from "@/core/ui/composites/page-header";
import { listStagePresets } from "@/modules/settings";
import {
  AddStagePresetButton,
  StagePresetManager,
} from "@/modules/settings/components/stage-preset-manager";
import { listDirectory } from "@/modules/team";

import { SETTINGS_HEADERS } from "../headers";

export const metadata: Metadata = { title: "Stage presets" };

/**
 * Settings → Stage presets (7.4; PRODUCT §4.16, kickoff 7 decision 22, PERMISSIONS ⁴):
 * `lists.manage` (the Owner and Admins). An Admin edits and archives their own, the Owner any; RLS
 * decides again. The seeded "Video" preset is data like any other (owner note 3).
 */
export default async function StagePresetsPage() {
  const [viewer, [presets, directory]] = await checkThenRead(
    requirePermission("lists.manage"),
    Promise.all([listStagePresets(), listDirectory()]),
  );
  return (
    <>
      <PageHeader
        back={{ href: "/settings", label: "Settings" }}
        title="Stage presets"
        {...SETTINGS_HEADERS.stagePresets}
        actions={<AddStagePresetButton />}
      />
      <div className="max-w-2xl">
        <StagePresetManager
          presets={presets}
          viewer={{ id: viewer.id, role: viewer.role }}
          names={Object.fromEntries(directory.map((member) => [member.id, member.fullName]))}
        />
      </div>
    </>
  );
}
