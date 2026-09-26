import { existsSync, readFileSync, unlinkSync } from "node:fs";

import { istDate, RUN_STATE_FILE, wallClock } from "./run-state";

/**
 * Says so, loudly, when the run crossed midnight IST (see `global-setup.ts`). It cannot turn a
 * red run green, and must not: it only names the one cause that makes every Admin and Staff
 * test fail at once, so nobody spends an evening reading forty traces of the day gate.
 */
export default function globalTeardown(): void {
  if (!existsSync(RUN_STATE_FILE)) return;
  const { startedOnIST } = JSON.parse(readFileSync(RUN_STATE_FILE, "utf8")) as {
    startedOnIST: string;
  };
  unlinkSync(RUN_STATE_FILE);
  const endedOnIST = istDate(wallClock());
  if (endedOnIST !== startedOnIST) {
    console.error(
      `\n[e2e] This run started on ${startedOnIST} and ended on ${endedOnIST} (IST). The saved ` +
        `Admin and Staff sessions were gated again at midnight, so any failure after that point ` +
        `is the day change, not the code. Run again.\n`,
    );
  }
}
