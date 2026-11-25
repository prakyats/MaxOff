import { can } from "@/core/permissions";
import type { DrawVariant } from "@/core/ui/navigation/tap-drawings";
import type { ShellRole } from "@/core/ui/shell/viewer";

import { ClientHeaderSkeleton } from "../clients/[id]/client-header-skeleton";
import { ClientTabs } from "../clients/[id]/client-nav";
import { ClientOverviewSkeleton } from "../clients/[id]/client-overview-skeleton";
import { ProjectSkeleton } from "../clients/[id]/projects/[projectId]/project-skeleton";

/**
 * Two class strings the loading screens take from modules the screens load in the browser
 * (`row-metrics.ts`, `client-work`'s `deliverable-columns.ts`): copied here, since importing
 * either would join those screens' first load (one more export there, or the module no longer
 * folded into its screen's). `drawings.test.tsx` keeps them equal.
 */
export const PROJECT_ROW_STATE_COPY =
  "ml-auto flex w-[9.5rem] shrink-0 items-center justify-end gap-2";
export const DELIVERABLE_COLUMNS_COPY =
  "lg:grid lg:grid-cols-[minmax(8rem,1.2fr)_minmax(11rem,2fr)_minmax(8rem,9.5rem)_minmax(6.5rem,8rem)_4.5rem] lg:gap-x-4";

/**
 * A client's tap drawing (v7.0): the layout's header while it streams in, the tabs on Overview
 * (their links inert in the copy) and the Overview's loading screen.
 */
export function drawClient(role: ShellRole): DrawVariant {
  const drawing: DrawVariant = () => (
    <>
      <ClientHeaderSkeleton />
      <ClientTabs clientId="client" />
      <ClientOverviewSkeleton
        parts={{ PROJECT_ROW_STATE: PROJECT_ROW_STATE_COPY }}
        ownerNotes={can(role, "clients.private_notes")}
        projects={can(role, "projects.manage")}
      />
    </>
  );
  return drawing;
}

/** A project's tap drawing (v7.0): its loading screen. */
export function drawProject(): DrawVariant {
  const drawing: DrawVariant = () => (
    <ProjectSkeleton parts={{ DELIVERABLE_COLUMNS: DELIVERABLE_COLUMNS_COPY }} />
  );
  return drawing;
}
