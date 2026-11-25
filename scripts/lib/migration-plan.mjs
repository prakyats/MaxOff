/**
 * Whether a Preview run applies the migrations staging is missing before the preview builds
 * (advisor 2026-11-26: v2.0.1's preview ran for hours against a staging that lacked its migration,
 * because the job ran on push for `phase-*` branches only, not `claude/*` ones). Pure, so the
 * rule is unit-tested (`tests/migration-plan.test.ts`); `scripts/migration-plan.mjs` feeds it.
 *
 * - A push: a `phase-*` branch always (as since 2026-09-26), and **any** branch that adds a
 *   migration of its own (`added`, the branch's new files under supabase/migrations against its
 *   merge base with `main`). The apply script itself compares staging's history with the branch
 *   and applies only what staging lacks (scripts/staging-migrations.sh).
 * - A manual run: `staging-migrations` always; `preview` when the branch adds a migration, so a
 *   preview never builds against a schema it was not written for.
 * - `main` never: its migrations go out with the staging deploy (deploy.yml).
 * @param {{ event: string, ref: string, job?: string, added: number }} run
 * @returns {boolean}
 */
export function appliesStagingMigrations({ event, ref, job = "", added }) {
  if (ref === "main") return false;
  if (event === "push") return ref.startsWith("phase-") || added > 0;
  if (event === "workflow_dispatch") {
    return job === "staging-migrations" || (job === "preview" && added > 0);
  }
  return false;
}

/**
 * Whether the preview may build: a branch that adds migrations needs them applied by this run's
 * `staging migrations` job ("success"); otherwise a skipped job is fine. A preview that would
 * run against a schema without its migrations is refused, loudly, instead (`migrations-check`).
 * @param {{ added: number, migrations: string }} run `migrations`: that job's result
 */
export function previewMayBuild({ added, migrations }) {
  return added > 0 ? migrations === "success" : ["success", "skipped"].includes(migrations);
}
