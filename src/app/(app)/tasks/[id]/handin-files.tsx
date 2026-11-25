import { formatDateTime } from "@/core/time";
import { readHandin } from "@/modules/handin";

import { HandinView, type HandinViewProps } from "./handin-view";

/**
 * v5.0 hand-in files on the task's Work view (WORKFLOWS §5C), streamed in its own Suspense
 * boundary: the task's first byte never waits on it, and its skeleton (`HandinCardSkeleton`)
 * holds the card's place. A task with nothing to show and nothing to add renders nothing. Times
 * are formatted here, so the card's client code carries no date library.
 */
export async function HandinFiles(props: Omit<HandinViewProps, "read" | "handedInAt">) {
  const read = await readHandin(props.taskId);
  const handedInAt = Object.fromEntries(
    read.versions.flatMap((version) =>
      version.submittedAt ? [[version.version, formatDateTime(version.submittedAt)]] : [],
    ),
  );
  return <HandinView {...props} read={read} handedInAt={handedInAt} />;
}
