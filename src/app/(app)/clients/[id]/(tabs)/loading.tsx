import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { Card, CardContent } from "@/core/ui/primitives/card";
import { Skeleton } from "@/core/ui/primitives/skeleton";

/**
 * A client's Overview (3.4) under the layout's header and tabs (which stay painted), traced:
 * for client work the active projects (L6), the glance card (Admin with the Drive button, the primary contact with Call), the line to the
 * client's open tasks (7.3), the Contacts
 * heading with its button and three contact rows, then the Details record (heading with Edit,
 * the filled-in rows and "Add details"), Requirements and notes ("Add details") and, for the Owner, the
 * Owner's notes (one row; the same permission check as the page).
 */
export default async function Loading() {
  const member = await getCurrentMember();
  const ownerNotes = member !== null && can(member.role, "clients.private_notes");
  const projects = member !== null && can(member.role, "projects.manage");
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading the client"
      data-slot="loading-client-overview"
      className="flex flex-col gap-4"
    >
      {/* L6: the active projects first (heading, two rows with their meter), for client work. */}
      {projects ? (
        <div aria-hidden className="flex flex-col gap-2">
          <div className="flex min-h-11 items-center">
            <Skeleton className="h-4 w-28" />
          </div>
          <ul className="border-border divide-border bg-card divide-y rounded-lg border">
            {[0, 1].map((row) => (
              <li key={row} className="flex min-h-16 items-center gap-3 px-4 py-3">
                <span className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-1/3" />
                  <Skeleton className="h-1.5 w-32 rounded-full" />
                </span>
                <Skeleton className="h-4 w-16 shrink-0" />
                <Skeleton className="size-4 shrink-0 rounded-sm" />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <Card aria-hidden>
        <CardContent className="flex flex-col gap-3">
          {[0, 1].map((row) => (
            <div key={row} className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-col gap-1.5">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-4 w-36" />
              </div>
              <Skeleton className="h-9 w-24 shrink-0 rounded-lg" />
            </div>
          ))}
        </CardContent>
      </Card>
      {/* "N open tasks labelled ‹client›" (kickoff 7 decision 20). */}
      <Skeleton aria-hidden className="h-11 w-full rounded-lg" />
      <div aria-hidden className="flex flex-col gap-2">
        <div className="flex min-h-11 items-center justify-between">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-9 w-32 rounded-lg" />
        </div>
        <ul className="border-border divide-border bg-card divide-y rounded-lg border">
          {[0, 1, 2].map((row) => (
            <li key={row} className="flex min-h-14 items-center gap-3 px-4 py-2">
              <span className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-1/3" />
              </span>
              <Skeleton className="size-4 shrink-0 rounded-sm" />
            </li>
          ))}
        </ul>
      </div>
      {/* L6: the records list what is filled in, the rest folded into "Add details". */}
      <RecordSkeleton rows={2} folded />
      <RecordSkeleton rows={0} folded />
      {ownerNotes ? <RecordSkeleton rows={1} /> : null}
      <span className="sr-only">Loading the client</span>
    </div>
  );
}

/** A record card: the heading row with Edit, then label-over-value rows. */
function RecordSkeleton({ rows, folded = false }: { rows: number; folded?: boolean }) {
  return (
    <Card aria-hidden>
      <CardContent className="flex flex-col gap-3">
        <div className="flex min-h-11 items-center justify-between">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-20 rounded-lg" />
        </div>
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className="flex flex-col gap-1.5">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-4 w-48" />
          </div>
        ))}
        {folded ? (
          <div className="flex min-h-9 items-center gap-2">
            <Skeleton className="h-8 w-28 rounded-md" />
            <Skeleton className="h-3.5 w-20" />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
