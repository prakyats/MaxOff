import { useEffect } from "react";

import { markRead } from "../actions/allowed-mark-read";
import type { markRead as MarkRead } from "../actions/allowed-mark-read";

export function Taps({ id, onRead }: { id: string; onRead: typeof MarkRead }) {
  useEffect(() => {
    void fetch(`/api/tasks/${id}`);
  }, [id]);
  return <button onClick={() => void markRead(id).then(onRead)}>Read</button>;
}
