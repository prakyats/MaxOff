"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { registerTapSpec } from "@/core/ui/navigation/tap-skeleton";

import { taskBackLabel, taskTapTarget } from "../domain/tap";
import { TASK_VIEWS, type TaskView } from "../domain/views";
import { TaskPageSkeleton } from "./task-page-skeleton";

/** The skeleton of each view as `TaskPageSkeleton` drew it (see `TaskTapSkeleton`). */
const drawings = new Map<TaskView, Element>();
/** For whom `drawings` were made (`manages`), or null before the first drawing. */
let drawnFor: boolean | null = null;

/**
 * The task page in the tap-skeleton engine (`core/ui/navigation/tap-skeleton`, #143): a plain tap
 * on a link to `/tasks/<id>` (`taskTapTarget`) draws the task's skeleton when the router has not
 * answered in time; it goes once the route holds the router's loading screen or the page.
 */
function registerTask(): void {
  registerTapSpec({
    key: "task",
    match: (href, origin) => {
      const target = taskTapTarget(href, origin);
      return target ? { pathname: target.pathname, href: target.href, variant: target.view } : null;
    },
    screen: '[data-slot="loading-task"], [data-slot="task-page"]',
    backLabel: taskBackLabel,
    drawing: (variant) => drawings.get(variant as TaskView),
  });
}

/**
 * **The drawing is the route's own:** this component renders `TaskPageSkeleton` (what the route's
 * `loading.tsx` renders) for each view into a node outside the document, so it is never on screen
 * and no query finds it, and keeps a copy of each; a tap draws that copy (the engine's `show`). A
 * copy rather than this component's own render because the router's first commit can unmount the
 * screen tapped from. Mounted on the screens whose rows open tasks (Tasks, All tasks, Suggested
 * tasks, Today, My Day, Approvals; an alert opens through `/open`, which this does not cover),
 * never in the shared layout: the calendar's first-load budget had no room. Once one of them has
 * loaded it, a task tapped on any screen is covered until the app is closed.
 */
export function TaskTapSkeleton({ manages }: { manages: boolean }) {
  const [offscreen] = useState(() => document.createElement("div"));
  // Drawn once per page load and viewer: a screen mounted later (back to Tasks, the next tab)
  // renders nothing, so the work never lands on a navigation's commit (CI 43376075667, the Crew's
  // next tap 388 ms after back).
  const draws = drawnFor !== manages;
  useEffect(registerTask, []);
  useEffect(() => {
    if (!draws) return;
    for (const view of offscreen.querySelectorAll<HTMLElement>("[data-tap-view]")) {
      const drawing = view.firstElementChild;
      if (drawing)
        drawings.set(view.dataset.tapView as TaskView, drawing.cloneNode(true) as Element);
    }
    drawnFor = manages;
  }, [draws, manages, offscreen]);
  if (!draws) return null;
  return createPortal(
    TASK_VIEWS.map((view) => (
      <div key={view} data-tap-view={view}>
        <TaskPageSkeleton manages={manages} view={view} />
      </div>
    )),
    offscreen,
  );
}
