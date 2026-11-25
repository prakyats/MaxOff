import { can } from "@/core/permissions";
import type { DrawVariant } from "@/core/ui/navigation/tap-drawings";
import type { ShellRole } from "@/core/ui/shell/viewer";
import { DayColumns, ThisWeekSkeleton } from "@/modules/dashboards/components/tap-kit";
import {
  TaskPageSkeleton,
  TaskRowsSkeleton,
  TaskSectionHeadingSkeleton,
} from "@/modules/tasks/components/tap-kit";
import type { TaskView } from "@/modules/tasks/components/task-tap";

import { TasksListSkeleton } from "../tasks/(list)/tasks-list-skeleton";

/** The Tasks tab's tap drawing (v7.0): its loading screen, per role. */
export function drawTasks(role: ShellRole): DrawVariant {
  const drawing: DrawVariant = () => (
    <TasksListSkeleton
      parts={{ DayColumns, TaskRowsSkeleton, TaskSectionHeadingSkeleton, ThisWeekSkeleton }}
      team={can(role, "tasks.create")}
    />
  );
  return drawing;
}

/** A task's tap drawing (#143): the task page's own skeleton, for the view the link opens. */
export function drawTask(role: ShellRole): DrawVariant {
  const drawing: DrawVariant = (view) => (
    <TaskPageSkeleton manages={can(role, "tasks.create")} view={view as TaskView} />
  );
  return drawing;
}
