import { unstable_rethrow } from "next/navigation";
import { z } from "zod";

import { countUnreadAbout } from "@/core/notifications/inbox";
import { captureException } from "@/core/observability/capture";

import { MarkRecordRead } from "./mark-record-read";

/**
 * A record's page marks the viewer's notifications about it read (kickoff 5 decision 4): a server
 * component that counts them first, so the bell drops by exactly that many on the device the
 * moment the page opens, and a record with none sends nothing. The page streams it in its own
 * `<Suspense fallback={null}>`: nothing waits for it. A count that cannot be read is reported and
 * marks nothing (the rows stay unread for the next visit), never the page's error screen.
 */
export async function RecordReadReceipt({
  entity,
  id,
}: {
  entity: "tasks" | "clients" | "members" | "projects";
  id: string;
}) {
  // A mistyped address has nothing to mark (the page says it was not found).
  if (!z.uuid().safeParse(id).success) return null;
  const unread = await countUnreadAbout(entity, id).catch((error: unknown) => {
    unstable_rethrow(error);
    captureException(error);
    return 0;
  });
  return unread > 0 ? <MarkRecordRead entity={entity} id={id} unread={unread} /> : null;
}
