import { can } from "@/core/permissions";
import type { DrawVariant } from "@/core/ui/navigation/tap-drawings";
import type { ShellRole } from "@/core/ui/shell/viewer";

import { MeSkeleton } from "../me/me-skeleton";

/** Me's tap drawing (v7.0): its loading screen, per role. */
export function drawMe(role: ShellRole): DrawVariant {
  const drawing: DrawVariant = () => (
    <MeSkeleton ownPages={can(role, "attendance.self")} owner={role === "owner"} />
  );
  return drawing;
}
