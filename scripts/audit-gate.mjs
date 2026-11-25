#!/usr/bin/env node
/**
 * `pnpm audit:gate` (v7.5 plan §2.1): fails on a critical advisory in the production dependencies
 * that `scripts/audit-allowlist.json` does not name, or on an allowlist entry past its expiry.
 * `--summary` prints the high and critical advisories as Markdown instead (the weekly audit's
 * issue) and always exits 0. The audit itself needs the registry; its answer is read as JSON.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { advisoriesOf, gate, summary } from "./lib/audit-gate.mjs";

let raw;
try {
  raw = execFileSync("pnpm", ["audit", "--prod", "--json"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
} catch (error) {
  // `pnpm audit` exits non-zero when it finds anything; its JSON is still on stdout.
  raw = error.stdout;
}
const advisories = advisoriesOf(JSON.parse(raw));
const allowlist = JSON.parse(
  readFileSync(new URL("./audit-allowlist.json", import.meta.url), "utf8"),
).advisories;
// The IST date the run happens on (an allowlist entry expires at the end of its IST day).
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
  // eslint-disable-next-line no-restricted-syntax -- the real instant is the point: when the run happens, never a business date
  new Date(),
);

if (process.argv.includes("--summary")) {
  process.stdout.write(`${summary(advisories, allowlist, today)}\n`);
  process.exit(0);
}

const result = gate(advisories, allowlist, today);
for (const advisory of result.failing) {
  console.error(
    `::error::${advisory.severity}: ${advisory.module} ${advisory.id} ${advisory.title} (fixed in ${advisory.patched}). Upgrade, or allowlist it with an expiry and a reason.`,
  );
}
for (const entry of result.expired) {
  console.error(
    `::error::The allowlist entry ${entry.id} (${entry.module}) expired on ${entry.expires}: fix it, or renew it with the owner's OK.`,
  );
}
for (const entry of result.stale) {
  process.stdout.write(
    `::notice::${entry.id} (${entry.module}) no longer appears: remove it from scripts/audit-allowlist.json.\n`,
  );
}
process.stdout.write(
  result.ok
    ? "✓ no unlisted critical advisory in the production dependencies\n"
    : "✗ dependency audit gate failed\n",
);
process.exit(result.ok ? 0 : 1);
