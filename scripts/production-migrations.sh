#!/usr/bin/env bash
# Applies the migrations the **production** database is missing. Called by deploy.yml's production
# job (a `v*` tag on `main`), after the tag guard and the Worker build, before the deploy.
# Production only: staging has its own script (scripts/staging-migrations.sh), and this one is
# stricter, because production only ever receives released tags and nothing else writes to it.
#
# Why not a plain `supabase db push`: v1.3.0 (unit 5A) carries migrations that sort *before*
# production's newest. Phase 5 began beside phase 4, so its `20260930050132_notifications_core` and
# `20260930073623_notifications_review_fixes` are older than phase 4's last fix,
# `20260930070616_phase4_review_fixes`, which reached production first (v1.2.0). `db push` refuses
# a local version older than the remote's newest unless told `--include-all`, and stops the deploy.
# The combining migration `20260930180227_notifications_phase4_combined` re-creates the task
# functions with phase 4's fixes and the notification calls, so applying the pending files in
# version order ends where a fresh, in-order build ends (proved locally before v1.3.0; PROGRESS).
#
# What it does, from `supabase migration list` (pending = versions in this checkout production
# lacks; ahead = versions production holds that this checkout lacks):
#   listing unreadable  -> FAIL: nothing says what production holds.
#   ahead               -> FAIL: production only receives released tags, so a version it holds and
#                          this tag lacks means something is wrong (a hand-applied migration, the
#                          wrong tag). Nothing is applied and nothing stands in for it.
#   nothing pending     -> skip.
#   pending             -> print the pending versions in order, then
#                          `supabase migration up --linked --include-all`: the CLI applies only the
#                          missing files, in version order, each in its own transaction, and records
#                          each in production's history exactly as `db push` does.
#   afterwards          -> list again and FAIL if anything is still pending.
# It never runs `migration repair`, never reverts, edits or re-runs an applied migration, never
# writes the history by hand and never touches `supabase/migrations`.
#
# Dry run (CI-free): DRY_RUN_LIST=<file with a captured listing> bash scripts/production-migrations.sh
# prints the decision and runs no supabase command (exit status is the real one).
# Local proof against the local stack: MIGRATIONS_TARGET=local bash scripts/production-migrations.sh
# Otherwise needs SUPABASE_ACCESS_TOKEN, SUPABASE_DB_PASSWORD and SUPABASE_PROJECT_REF.
set -euo pipefail

tmp="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
list="$tmp/production-migrations.list"
target="${MIGRATIONS_TARGET:-linked}"
case "$target" in
  linked) target_flags=(--linked) ;;
  local) target_flags=(--local) ;;
  *) echo "::error::MIGRATIONS_TARGET is 'linked' (default) or 'local', not '$target'."; exit 1 ;;
esac
supabase() { pnpm supabase --agent no "$@"; }
summary() { if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then cat >>"$GITHUB_STEP_SUMMARY"; else cat >/dev/null; fi; }

list_migrations() { # $1 = where the listing goes
  if [ "$target" = "linked" ]; then
    supabase migration list --linked --password "$SUPABASE_DB_PASSWORD" | tee "$1"
  else
    supabase migration list --local | tee "$1"
  fi
}

# One row per version: Local | Remote | Time, versions in backticks (CLI 2.117; older builds drew
# the table with │). A local version with an empty remote column is pending; a remote version with
# an empty local column is production being ahead.
versions() { # $1 = listing, $2 = column to print when $3 is empty
  sed 's/│/|/g' "$1" | awk -F'|' -v keep="$2" -v empty="$3" '
    NF >= 2 {
      gsub(/[[:space:]`]/, "", $1); gsub(/[[:space:]`]/, "", $2)
      if ($keep ~ /^[0-9]{14}$/ && $empty == "") print $keep
    }' | sort
}
rows() {
  sed 's/│/|/g' "$1" | awk -F'|' 'NF >= 2 { gsub(/[[:space:]`]/, "", $1); gsub(/[[:space:]`]/, "", $2); if ($1 ~ /^[0-9]{14}$/ || $2 ~ /^[0-9]{14}$/) c++ } END { print c + 0 }'
}
oneline() { tr '\n' ' ' | sed 's/ $//'; }

if [ -n "${DRY_RUN_LIST:-}" ]; then
  cp "$DRY_RUN_LIST" "$list"
  echo "(dry run: listing from $DRY_RUN_LIST, no supabase command runs)"
else
  [ "$target" = "local" ] || supabase link --project-ref "$SUPABASE_PROJECT_REF"
  list_migrations "$list"
fi

if [ "$(rows "$list")" = "0" ]; then
  echo "::error::Could not read production's migration list. Nothing was applied; re-run the job."
  echo "decision: fail (listing unreadable)"
  exit 1
fi

pending="$(versions "$list" 1 2)"
ahead="$(versions "$list" 2 1)"

if [ -n "$ahead" ]; then
  echo "::error::Production holds migrations this tag does not have: $(echo "$ahead" | oneline). Production only receives released tags, so this needs a person: nothing was applied."
  echo "decision: fail (production ahead)"
  exit 1
fi

if [ -z "$pending" ]; then
  echo "Production has every migration of this tag; nothing to apply."
  echo "decision: skip (nothing pending)"
  echo "Production already had every migration of this tag." | summary
  exit 0
fi

echo "Pending on production, applied in this order:"; echo "$pending"

if [ -n "${DRY_RUN_LIST:-}" ]; then
  echo "decision: apply $(echo "$pending" | oneline)"
  exit 0
fi

supabase migration up "${target_flags[@]}" --include-all

list_migrations "$list.after"
left="$(versions "$list.after" 1 2)"
if [ -n "$left" ]; then
  echo "::error::Still missing on production after applying: $(echo "$left" | oneline)"
  echo "decision: fail (still pending)"
  exit 1
fi
echo "decision: applied"
{ echo "### Applied to production"; echo; echo "$pending" | sed 's|^|- `|; s|$|`|'; } | summary
