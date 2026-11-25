"use client";

import type { TapSpec } from "@/core/ui/navigation/tap-skeleton";

import { taskBackLabel, taskTapTarget } from "../domain/tap";
import { TASK_VIEWS } from "../domain/views";

/**
 * The task page in the tap-skeleton engine (#143, v7.0; `app/(app)/tap-drawings.tsx`): a plain
 * tap on a link to `/tasks/<id>` (`taskTapTarget`) draws the task's own skeleton, by view. Its own
 * file, apart from the skeletons (`tap-kit.tsx`), so the engine's list of screens loads no drawing.
 */
export const TASK_TAP: Omit<TapSpec, "drawing" | "prepare"> = {
  key: "task",
  match: (href, origin) => {
    const target = taskTapTarget(href, origin);
    return target ? { pathname: target.pathname, href: target.href, variant: target.view } : null;
  },
  screen: '[data-slot="loading-task"], [data-slot="task-page"]',
  backLabel: taskBackLabel,
};

/** The task page's views, one drawing each (a task opened on Chat loads in Chat's shape). */
export const TASK_TAP_VIEWS = TASK_VIEWS;
export type { TaskView } from "../domain/views";
