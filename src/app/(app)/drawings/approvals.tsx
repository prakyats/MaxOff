import { can } from "@/core/permissions";
import type { DrawVariant } from "@/core/ui/navigation/tap-drawings";
import type { ShellRole } from "@/core/ui/shell/viewer";

import { ApprovalsSkeleton } from "../approvals/approvals-skeleton";

/** Approvals' tap drawing (v7.0): its loading screen, per role. */
export function drawApprovals(role: ShellRole): DrawVariant {
  const drawing: DrawVariant = () => <ApprovalsSkeleton decides={can(role, "attendance.decide")} />;
  return drawing;
}
