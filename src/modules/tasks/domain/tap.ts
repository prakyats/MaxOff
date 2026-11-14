import { TASK_BACK } from "./back";
import { parseTaskView, type TaskView } from "./views";

const TASK_PAGE = /^\/tasks\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A tap that opens a task's page: its path, its full address and the view it opens on. */
export interface TaskTap {
  pathname: string;
  href: string;
  view: TaskView;
}

/**
 * Whether a link's `href` opens a task's own page (#143, `TaskTapSkeleton`): the same origin, the
 * path `/tasks/<id>` and no query but the view (`?tab=`). Anything else (a sheet's address, a
 * filter, another site, `/tasks/all`) is not this page and gets no task skeleton. Pure, so it is
 * unit-tested.
 */
export function taskTapTarget(href: string, origin: string): TaskTap | null {
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin || !TASK_PAGE.test(url.pathname)) return null;
  if ([...url.searchParams.keys()].some((key) => key !== "tab")) return null;
  return {
    pathname: url.pathname,
    href: `${url.pathname}${url.search}${url.hash}`,
    view: parseTaskView(url.searchParams.get("tab")),
  };
}

/**
 * `html[data-nav-pending]`: a navigation is under way (`NAV_PENDING_ATTRIBUTE`,
 * `core/ui/navigation/progress.ts`; a unit test keeps the two equal). Named here because
 * importing `progress.ts` into the part loaded after the page moved it into every screen's first
 * load (1.1 KB; the calendar's budget had 159 bytes left).
 */
export const NAV_PENDING = "data-nav-pending";

/**
 * The name the task page's back control gives the screen a tap came from (`TASK_BACK`): what the
 * route's own skeleton shows there once the task's address is in the history, since `BackLink`
 * names the screen it will land on. A drawing made away from the task page cannot know it
 * (`TaskTapSkeleton` sets it on its copy). `/reports/end-of-day/*` matches every day's report.
 */
export function taskBackLabel(from: string): string {
  const origin = TASK_BACK.from.find(({ path }) =>
    path.endsWith("/*") ? from.startsWith(path.slice(0, -1)) : from === path,
  );
  return origin?.label ?? TASK_BACK.label;
}
