#!/usr/bin/env node
/**
 * The Preview workflow's `migration plan` job: counts the migrations this branch adds against its
 * merge base with `main` and decides whether `staging migrations` runs (scripts/lib/migration-plan.mjs).
 * Writes `added`, `apply` and the list to $GITHUB_OUTPUT. Reads git only; no secret, no database.
 * Usage: node scripts/migration-plan.mjs (in a checkout with `origin/main` fetched).
 *        node scripts/migration-plan.mjs --check <added> <the staging migrations job's result>
 *        (the `migrations check` job: fails, loudly, when the preview would build against a
 *        staging without this branch's migrations; `previewMayBuild`).
 */
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

import { appliesStagingMigrations, previewMayBuild } from "./lib/migration-plan.mjs";

if (process.argv[2] === "--check") {
  const added = Number(process.argv[3] ?? "0");
  const migrations = process.argv[4] ?? "";
  if (previewMayBuild({ added, migrations })) {
    process.stdout.write(
      `The preview may build (${added} migration(s) of its own; staging migrations: ${migrations}).\n`,
    );
    process.exit(0);
  }
  process.stderr.write(
    `::error title=Staging lacks this branch's migrations::This branch adds ${added} migration(s) and the staging migrations job ended "${migrations}", so the preview would run against a schema without them. It is not built. Fix the staging migrations job (its log says why), then push again or run Preview → staging-migrations.\n`,
  );
  process.exit(1);
}

const files = execFileSync(
  "git",
  ["diff", "--name-only", "--diff-filter=AR", "origin/main...HEAD", "--", "supabase/migrations"],
  { encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean);
const run = {
  event: process.env.GITHUB_EVENT_NAME ?? "",
  ref: process.env.GITHUB_REF_NAME ?? "",
  job: process.env.INPUT_JOB ?? "",
  added: files.length,
};
const apply = appliesStagingMigrations(run);
const out = process.env.GITHUB_OUTPUT;
if (out) appendFileSync(out, `added=${files.length}\napply=${apply}\n`);
process.stdout.write(
  `${run.ref}: ${files.length} migration(s) of its own${files.map((f) => `\n  ${f}`).join("")}\n` +
    `staging migrations ${apply ? "runs before the preview" : "does not run"} (${run.event}${run.job ? `, ${run.job}` : ""}).\n`,
);
