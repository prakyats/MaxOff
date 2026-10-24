import { ChatCount } from "@/core/ui/composites/list-row";

import { unreadLabel } from "../domain/page";

/**
 * A task row's unread comments (Kickoff 4 decision 28), drawn as the one row anatomy's chat count
 * (`ChatCount`, FINAL 5; PP-admin-6, PP-crew-6): a small muted bubble and the count beside the
 * title, spoken as "2 new comments". Never red. No state, no handlers, so the server lists and
 * the client ones (all tasks, Approvals) draw the same one. Nothing when there is nothing unread.
 */
export function UnreadMarker({ count, className }: { count: number; className?: string }) {
  return (
    <ChatCount count={count} label={unreadLabel(count)} slot="task-unread" className={className} />
  );
}
