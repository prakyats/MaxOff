import { readHandin } from "@/modules/handin";
import { HandinCard, type HandinCardProps } from "@/modules/handin/components/handin-card";

/**
 * v5.0 hand-in files on the task's Work view (WORKFLOWS §5C), streamed in its own Suspense
 * boundary: the task's first byte never waits on it, and its skeleton (`HandinCardSkeleton`)
 * holds the card's place. A task with nothing to show and nothing to add renders nothing.
 */
export async function HandinFiles(props: Omit<HandinCardProps, "read">) {
  const read = await readHandin(props.taskId);
  return <HandinCard {...props} read={read} />;
}
