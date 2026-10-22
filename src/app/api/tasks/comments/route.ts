import { getCurrentMember } from "@/core/auth/server";
import { displayName } from "@/core/lib/display-name";
import { backgroundGet } from "@/core/http/background-route";
import { todayIST } from "@/core/time";
import { chatMessages, readEarlierComments, type ChatMessage } from "@/modules/tasks";
import { listDirectoryOf } from "@/modules/team";

/**
 * Chat's "Load earlier" (v1.8 V5b E): `?task=<id>&before=<time>&id=<comment id>` answers the page
 * of messages just before that one, worded like the page's own (`chatMessages`: the IST day, its
 * divider and the time; "You" for the reader), and whether earlier ones remain. The writers'
 * names come from the directory the reader may see (RLS). A background call (ARCHITECTURE §4.4):
 * a plain request, never a server action that could hold a navigation.
 */
export const dynamic = "force-dynamic";

export const GET = backgroundGet(
  async (query): Promise<{ messages: ChatMessage[]; more: boolean }> => {
    const { comments, more } = await readEarlierComments({
      taskId: query.get("task"),
      before: query.get("before"),
      beforeId: query.get("id"),
    });
    const [viewer, people] = await Promise.all([
      getCurrentMember(),
      listDirectoryOf(comments.flatMap((comment) => [comment.authorId, comment.onBehalfOf ?? ""])),
    ]);
    const messages = chatMessages(comments, {
      viewerId: viewer?.id ?? "",
      names: Object.fromEntries(people.map((one) => [one.id, displayName(one.fullName)])),
      photos: Object.fromEntries(people.map((one) => [one.id, one.avatarFileId])),
      today: todayIST(),
    });
    return { messages, more };
  },
);
