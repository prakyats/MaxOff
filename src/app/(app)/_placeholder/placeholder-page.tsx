import { HammerIcon, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { EmptyState } from "@/core/ui/composites/empty-state";
import { PageHeader } from "@/core/ui/composites/page-header";

/**
 * Stand-in for a screen a later roadmap task builds. Each page names its task so the
 * "filled in task N" note stays visible until the real screen replaces it.
 */
export function PlaceholderPage({
  title,
  description,
  task,
  icon = HammerIcon,
  greet,
  children,
  footer,
}: {
  title: string;
  description: string;
  /** Roadmap task that builds this screen, e.g. "6.1". */
  task: string;
  icon?: LucideIcon;
  /** The signed-in member's name: the dashboards greet the person, never a hard-coded name. */
  greet?: string;
  /** The parts of the screen that are already built (e.g. the attendance strip, 2.2/2.3). */
  children?: ReactNode;
  /** The bottom of the screen, below the placeholder (e.g. the quiet Log out row). */
  footer?: ReactNode;
}) {
  return (
    <>
      <PageHeader
        title={title}
        description={greet ? `Hello, ${greet}. ${description}` : description}
      />
      {children}
      <EmptyState
        icon={icon}
        title={`${title} is filled in task ${task}`}
        description="The shell, navigation and shared components are in place. This screen arrives with its module."
      />
      {footer}
    </>
  );
}
