import { useEffect } from "react";

import * as taskActions from "../actions/allowed-mark-read";
import { markRead } from "../actions/allowed-mark-read";

export function MarksInBackground({ id }: { id: string }) {
  useEffect(() => {
    void markRead(id);
    const timer = setTimeout(() => void taskActions.markRead(id), 250);
    window.setTimeout(markRead, 500);
    return () => clearTimeout(timer);
  }, [id]);
  return null;
}
