"use client";

import { ENTITY_LABELS, type SettingsEntity } from "@/core/custom-fields";
import { cn } from "@/core/lib/utils";
import { ViewLink } from "@/core/ui/composites/view-link";

/**
 * Which entity's fields the screen shows (3.2). A view control: `ViewLink` replaces the entry,
 * so one back leaves Settings → Custom fields (ARCHITECTURE §14.2 d). Admins see client, contact
 * and task (4B); the Owner also project and item (PERMISSIONS ¹).
 */
export function CustomFieldEntityTabs({
  entities,
  current,
}: {
  entities: readonly SettingsEntity[];
  current: SettingsEntity;
}) {
  return (
    <nav
      aria-label="Field entity"
      data-slot="custom-field-entity-tabs"
      className={cn(
        "bg-muted mb-4 grid gap-1 rounded-lg p-1 md:inline-grid",
        // Admins: three (client, contact, task); the Owner: five, in two rows on a phone.
        entities.length === 3
          ? "grid-cols-3 md:w-[24rem]"
          : "grid-cols-3 md:w-[40rem] md:grid-cols-5",
      )}
    >
      {entities.map((entity) => (
        <ViewLink
          key={entity}
          href={`/settings/custom-fields?entity=${entity}`}
          scroll={false}
          aria-current={entity === current ? "page" : undefined}
          className={cn(
            "focus-visible:ring-ring flex min-h-11 items-center justify-center rounded-md px-3 text-sm font-medium outline-none select-none focus-visible:ring-2",
            entity === current
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground active:bg-background/60",
          )}
        >
          {ENTITY_LABELS[entity].plural}
        </ViewLink>
      ))}
    </nav>
  );
}
