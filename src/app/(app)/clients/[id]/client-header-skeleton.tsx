import { PageHeader } from "@/core/ui/composites/page-header";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import { CLIENT_BACK } from "./back";

/**
 * A client's header while it streams in (the layout's fallback): the name, the state chip's line
 * under it (X5+ M7: without it the page below moved 13 px down when the header streamed in),
 * History and, for whoever edits the client, ⋯. Also the tap drawing's header (v7.0).
 */
export function ClientHeaderSkeleton() {
  return (
    <PageHeader
      // The title's own line height (24 px, 32 from md), as the project's loading screen.
      title={
        <span className="flex h-6 items-center md:h-8">
          <Skeleton className="h-5 w-40 max-w-full" />
        </span>
      }
      // A span: the description is a <p>.
      description={
        <Skeleton as="span" className="inline-block h-5 w-16 rounded-full align-middle" />
      }
      back={CLIENT_BACK}
      className="flex-wrap"
      // History, always there; the ⋯ follows only for whoever edits the client.
      menu={<Skeleton aria-hidden className="size-11 rounded-lg" />}
    />
  );
}
