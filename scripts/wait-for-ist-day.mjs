// Holds a CI e2e run that would cross midnight IST until the new day has begun
// (`lib/ist-midnight.mjs` has the rule). Runs before the local stack starts, so the database
// and the run live in one business day.
import { setTimeout as sleep } from "node:timers/promises";

import { waitBeforeE2e } from "./lib/ist-midnight.mjs";

// eslint-disable-next-line no-restricted-syntax -- the real instant is the point: this is about when the run happens, never a business date
const wait = waitBeforeE2e(new Date());
if (wait > 0) {
  const minutes = Math.ceil(wait / 60_000);
  process.stdout.write(
    `::notice::Waiting ${minutes} min so the e2e run does not cross midnight IST (18:30 UTC).\n`,
  );
  await sleep(wait);
}
