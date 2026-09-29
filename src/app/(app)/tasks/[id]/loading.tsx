import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { PageHeader } from "@/core/ui/composites/page-header";
import { Skeleton } from "@/core/ui/primitives/skeleton";

/**
 * A task's page (4.4) traced: the title bar (with the ⋯ an Owner or Admin usually has), the first
 * card (the state and priority chips, the deadline, primary owner, client and approval rows, the
 * status line, the next action), then the sections in their order: stages, people, details,
 * comments, history. Every column is `min-w-0`, so a rem-wide bar never widens a phone at 200%
 * text (3c review).
 */
export default async function Loading() {
  const member = await getCurrentMember();
  const manages = member !== null && can(member.role, "tasks.create");
  return (
    <>
      <PageHeader
        back={{ href: "/tasks", label: "Tasks" }}
        title={<Skeleton className="h-5 w-48" />}
        menu={
          manages ? <Skeleton aria-hidden className="size-11 rounded-lg md:size-8" /> : undefined
        }
      />
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading the task"
        data-slot="loading-task"
        className="flex max-w-3xl min-w-0 flex-col gap-6"
      >
        <div
          aria-hidden
          className="border-border bg-card flex min-w-0 flex-col gap-3 rounded-xl border p-4"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-3.5 w-14" />
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            {["w-44", "w-28", "w-32", "w-56"].map((width, index) => (
              <div key={index} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <Skeleton className="h-4 w-20" />
                <Skeleton className={`h-4 ${width}`} />
              </div>
            ))}
          </div>
          <Skeleton className="h-4 w-64" />
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
            <Skeleton className="h-11 w-full rounded-lg sm:w-36" />
          </div>
        </div>
        <SectionSkeleton rows={3} rowClass="h-12" />
        <SectionSkeleton rows={2} rowClass="h-14" />
        <div aria-hidden className="flex min-w-0 flex-col gap-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
        <div aria-hidden className="flex min-w-0 flex-col gap-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-11 w-40 rounded-lg" />
        </div>
        <SectionSkeleton rows={3} rowClass="h-16" />
        <span className="sr-only">Loading the task</span>
      </div>
    </>
  );
}

function SectionSkeleton({ rows, rowClass }: { rows: number; rowClass: string }) {
  return (
    <div aria-hidden className="flex min-w-0 flex-col gap-2">
      <Skeleton className="h-4 w-20" />
      <div className="border-border divide-border bg-card divide-y rounded-lg border">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className={`flex min-w-0 items-center gap-3 px-3 ${rowClass}`}>
            <Skeleton className="size-4 shrink-0 rounded-[4px]" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-40" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
