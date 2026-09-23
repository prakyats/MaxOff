import { PageLoading } from "@/core/ui/composites/loading-state";

/**
 * The task list (4.5) is a card list on a phone, so the load traces cards. This is the screen
 * that used to show an avatar list: five circles and two lines, which is a People list.
 */
export default function Loading() {
  return <PageLoading title="Tasks" shape="cards" />;
}
