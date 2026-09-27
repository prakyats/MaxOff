#!/usr/bin/env bash
# Applies main's migrations to the shared staging database from deploy.yml — carefully, because
# staging is shared with the phase branches: preview.yml applies a `phase-*` branch's migrations
# to it on every push, so mid-phase the staging database is usually *ahead* of `main`, and a
# blind `supabase db push` refuses with "Remote migration versions not found in local migrations
# directory" (the first `main` hotfix after phase 3 started, 2026-09-27, deploy run 36304315882).
#
# Decision table, from `supabase migration list` (Local | Remote):
#   pending = local versions missing on staging; ahead = staging versions missing locally.
#   none pending                -> nothing to push (a notice names what staging is ahead by).
#   pending, staging not ahead  -> `supabase db push`.
#   pending AND staging ahead   -> FAIL loudly naming both sets: the CLI cannot apply a local
#                                  migration over remote versions it does not know, and applying
#                                  the file by hand would leave the history table wrong. Remedy:
#                                  merge `main` into the open phase branch and push it; preview.yml
#                                  then applies the missing migration to staging; re-run the deploy.
#   listing unreadable          -> push anyway (idempotent) with a warning, as preview.yml does.
# Never skips silently: every path prints what it saw and what it did.
#
# Dry run (CI-free): DRY_RUN_LIST=<file with a captured listing> ./scripts/staging-migrations.sh
# prints the decision and runs no supabase command; exit status is the real one (0 / 1).
# Needs SUPABASE_ACCESS_TOKEN, SUPABASE_DB_PASSWORD and SUPABASE_PROJECT_REF otherwise.
set -euo pipefail

tmp="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
list="$tmp/staging-migrations.list"

if [ -n "${DRY_RUN_LIST:-}" ]; then
  cp "$DRY_RUN_LIST" "$list"
  echo "(dry run: listing from $DRY_RUN_LIST, no supabase command runs)"
else
  pnpm supabase link --project-ref "$SUPABASE_PROJECT_REF"
  pnpm supabase migration list --linked --password "$SUPABASE_DB_PASSWORD" | tee "$list"
fi

# One row per version: Local | Remote | Time, versions in backticks (CLI 2.117; older builds
# drew the table with │). A local version with an empty remote column is pending; a remote
# version with an empty local column is staging being ahead.
sed 's/│/|/g' "$list" >"$list.pipes"
versions() { # $1 = column to print when $2 is empty
  awk -F'|' -v keep="$1" -v empty="$2" '
    NF >= 2 {
      gsub(/[[:space:]`]/, "", $1); gsub(/[[:space:]`]/, "", $2)
      if ($keep ~ /^[0-9]{14}$/ && $empty == "") print $keep
    }' "$list.pipes"
}
rows="$(awk -F'|' 'NF >= 2 { gsub(/[[:space:]`]/, "", $1); gsub(/[[:space:]`]/, "", $2); if ($1 ~ /^[0-9]{14}$/ || $2 ~ /^[0-9]{14}$/) c++ } END { print c + 0 }' "$list.pipes")"
pending="$(versions 1 2)"
ahead="$(versions 2 1)"

if [ "$rows" = "0" ]; then
  echo "::warning::Could not read the migration list; running db push anyway (idempotent)."
  [ -n "${DRY_RUN_LIST:-}" ] || pnpm supabase db push
  echo "decision: push (listing unreadable)"
  exit 0
fi

[ -n "$ahead" ] && echo "::notice::Staging is ahead of main (a phase branch's migrations, applied by preview.yml): $(echo "$ahead" | tr '\n' ' ')"

if [ -z "$pending" ]; then
  echo "Staging has every migration on main; nothing to push."
  echo "decision: skip (nothing pending)"
  exit 0
fi

if [ -n "$ahead" ]; then
  {
    echo "::error::main carries migrations that staging lacks, AND staging carries a phase branch's migrations that main lacks. The CLI cannot apply the first set over the second, and this script will not apply files by hand."
    echo "::error::Missing on staging (main's): $(echo "$pending" | tr '\n' ' ')"
    echo "::error::Ahead on staging (the branch's): $(echo "$ahead" | tr '\n' ' ')"
    echo "::error::Remedy: merge main into the open phase branch and push it; preview.yml's 'staging migrations' job then applies main's migration(s) to staging; re-run this deploy (Actions -> Deploy -> Re-run failed jobs)."
  }
  echo "decision: fail (pending and ahead)"
  exit 1
fi

echo "Pending on staging:"; echo "$pending"
[ -n "${DRY_RUN_LIST:-}" ] || pnpm supabase db push
echo "decision: push"
