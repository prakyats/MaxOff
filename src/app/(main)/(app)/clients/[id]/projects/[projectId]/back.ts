import type { BackOrigin } from "@/core/ui/composites/back-link";

/**
 * The other screens a project is opened from besides its client's Projects (§14.2 k, 6b.12):
 * back returns to the one it came from and names it; from anywhere else it replaces with the
 * client's Projects.
 */
export const PROJECT_ORIGINS: readonly BackOrigin[] = [
  { path: "/calendar", label: "Calendar" },
  { path: "/today", label: "Today" },
  { path: "/clients/items", label: "Client deliverables" },
  { path: "/clients/items/decide", label: "Unfinished deliverables" },
];
