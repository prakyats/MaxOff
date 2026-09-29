import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { EmptyState } from "@/core/ui/composites/empty-state";
import { PageHeader } from "@/core/ui/composites/page-header";

import type { StandIn } from "./stand-ins";

/**
 * Stand-in for a screen a later roadmap task builds. It says in plain words what the screen will
 * be for and that it is coming (`stand-ins.ts`, kickoff 3c amendment (3e)); the task that replaces
 * it is named in a comment at each caller, never on screen.
 */
export function PlaceholderPage({
  title,
  copy,
  icon,
  greet,
  children,
  footer,
  actions,
}: {
  title: string;
  /** What the screen says until it arrives, from `STAND_INS`. */
  copy: StandIn;
  icon: LucideIcon;
  /** The signed-in member's name: the dashboards greet the person, never a hard-coded name. */
  greet?: string;
  /** The parts of the screen that are already built (e.g. the attendance strip, 2.2/2.3). */
  children?: ReactNode;
  /** The bottom of the screen, below the stand-in. */
  footer?: ReactNode;
  /** The screen's one action, already built (Tasks' "New task", 4.3): a FAB on a phone. */
  actions?: ReactNode;
}) {
  return (
    <>
      <PageHeader
        title={title}
        description={greet ? `Hello, ${greet}. ${copy.description}` : copy.description}
        actions={actions}
      />
      {children}
      <EmptyState icon={icon} title={copy.title} description={copy.message} />
      {footer}
    </>
  );
}
