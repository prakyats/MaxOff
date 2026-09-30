#!/usr/bin/env bash
# Applies the migrations the shared **staging** database is missing. Called by deploy.yml's staging
# job (`main`) and by preview.yml's `staging migrations` job (a `phase-*` branch). Staging only:
# production keeps deploy.yml's plain `supabase db push`, and nothing here reads a production value.
#
# Why not a plain `supabase db push`: staging is shared by `main` and every open phase branch, and
# each branch's migrations reach it on push, so staging's history usually holds versions this
# checkout does not have (another branch's). The CLI refuses to apply anything while the remote
# history has a version the local directory lacks ("Remote migration versions not found in local
# migrations directory"; `--include-all` covers only the opposite case), and the remedy it suggests,
# `migration repair --status reverted`, rewrites staging's history: never used here. Seen twice:
# deploy run 36304315882 (2026-09-27, `main` behind a phase branch) and the Preview run on
# `phase-4` 4c3b8b1 (2026-09-30, beside `phase-5`'s 20260930050132 and 20260930073623).
#
# What it does, from `supabase migration list` (pending = local versions staging lacks;
# ahead = staging versions this checkout lacks):
#   nothing pending     -> nothing to apply (a notice names what staging is ahead by).
#   pending             -> copy `supabase/` to a scratch directory; there, for each version staging
#                          is ahead by, add an empty stand-in file (`<version>_on_staging_only.sql`,
#                          never run: that version is already applied), so the CLI's history check
#                          passes; then `supabase migration up --include-all` from the copy. The CLI
#                          applies the pending files in version order, each in its own transaction,
#                          and records each in staging's history exactly as `db push` does
#                          (`--include-all`: a pending version may sort before staging's newest).
#   afterwards          -> list again and FAIL if anything is still pending.
#   listing unreadable  -> FAIL: without the listing nothing says what staging is ahead by.
# It never edits, reverts or re-runs an applied migration, never writes staging's history by hand,
# and never touches the checkout's `supabase/migrations`.
#
# One consequence to know (and the run warns about it): staging holds one copy of each function.
# When a pending file re-creates a function that a staging-only migration also re-creates (two open
# branches changing the same function), staging ends with this run's version; the other branch gets
# its version back only through a new migration of its own. The warning names both files, found
# on the other branches' tips (fetched for this) when the checkout has them.
#
# Dry run (CI-free): DRY_RUN_LIST=<file with a captured listing> bash scripts/staging-migrations.sh
# prints the decision and runs no supabase command (exit status is the real one).
# Local proof against the local stack: MIGRATIONS_TARGET=local bash scripts/staging-migrations.sh
# Otherwise needs SUPABASE_ACCESS_TOKEN, SUPABASE_DB_PASSWORD and SUPABASE_PROJECT_REF.
set -euo pipefail

tmp="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
list="$tmp/staging-migrations.list"
target="${MIGRATIONS_TARGET:-linked}"
case "$target" in
  linked) target_flags=(--linked) ;;
  local) target_flags=(--local) ;;
  *) echo "::error::MIGRATIONS_TARGET is 'linked' (default) or 'local', not '$target'."; exit 1 ;;
esac
supabase() { pnpm supabase --agent no "$@"; }
output() { [ -z "${GITHUB_OUTPUT:-}" ] || echo "$1" >>"$GITHUB_OUTPUT"; }
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
# an empty local column is staging being ahead.
versions() { # $1 = listing, $2 = column to print when $3 is empty
  sed 's/│/|/g' "$1" | awk -F'|' -v keep="$2" -v empty="$3" '
    NF >= 2 {
      gsub(/[[:space:]`]/, "", $1); gsub(/[[:space:]`]/, "", $2)
      if ($keep ~ /^[0-9]{14}$/ && $empty == "") print $keep
    }'
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
  echo "::error::Could not read staging's migration list, so nothing says what staging is ahead by. Nothing was applied; re-run the job."
  echo "decision: fail (listing unreadable)"
  exit 1
fi

pending="$(versions "$list" 1 2)"
ahead="$(versions "$list" 2 1)"
[ -z "$ahead" ] || echo "::notice::Staging also holds migrations this checkout does not have (another branch's, left as they are): $(echo "$ahead" | oneline)"

if [ -z "$pending" ]; then
  echo "Staging has every migration of this checkout; nothing to apply."
  echo "decision: skip (nothing pending)"
  output "applied=false"
  echo "Staging already had every migration of this checkout." | summary
  exit 0
fi

echo "Pending on staging:"; echo "$pending"

# Shared definitions (see the header): a function that a pending file and a staging-only migration
# both re-create. The staging-only files are read from the other branches' tips, best effort.
# deploy.yml's checkout is shallow and holds no other branch: fetch their tips there only.
if [ -n "$ahead" ] && [ -z "${DRY_RUN_LIST:-}" ] && [ "$(git rev-parse --is-shallow-repository 2>/dev/null)" = "true" ]; then
  git fetch --quiet --no-tags --depth=1 origin '+refs/heads/*:refs/remotes/origin/*' 2>/dev/null || true
fi
functions_in() { { grep -ioE 'create (or replace )?function +[a-z_]+\.[a-z_0-9]+' || true; } | awk '{print tolower($NF)}' | sort -u; }
for version in $ahead; do
  found=""
  for ref in $(git for-each-ref --format='%(refname)' refs/remotes/origin 2>/dev/null); do
    path="$(git ls-tree --name-only "$ref" supabase/migrations/ 2>/dev/null | grep "/${version}_" | head -1 || true)"
    if [ -n "$path" ]; then found="$ref:$path"; break; fi
  done
  [ -n "$found" ] || continue
  theirs="$(git show "$found" | functions_in)"
  for v in $pending; do
    file="$(ls supabase/migrations/"${v}"_*.sql)"
    shared="$(comm -12 <(functions_in <"$file") <(echo "$theirs"))"
    [ -z "$shared" ] || echo "::warning::$(basename "$file") re-creates $(echo "$shared" | oneline), which staging's ${found#refs/remotes/} also re-creates: after this run staging runs this checkout's version, until that branch adds a migration of its own."
  done
done

if [ -n "${DRY_RUN_LIST:-}" ]; then
  echo "decision: apply${ahead:+ (with stand-ins for $(echo "$ahead" | oneline))}"
  exit 0
fi

work="$(mktemp -d "$tmp/staging-migrations.XXXXXX")"
trap 'rm -rf "$work"' EXIT
cp -R supabase "$work/"
for version in $ahead; do
  printf -- '-- Stands in for %s, which staging already has (another branch'"'"'s migration).\n-- Never run: scripts/staging-migrations.sh gives the CLI a local file for every version on\n-- staging so it can apply this checkout'"'"'s missing ones. It exists only in a scratch copy.\n' \
    "$version" >"$work/supabase/migrations/${version}_on_staging_only.sql"
done
supabase migration up "${target_flags[@]}" --include-all --workdir "$work"

list_migrations "$list.after"
left="$(versions "$list.after" 1 2)"
if [ -n "$left" ]; then
  echo "::error::Still missing on staging after applying: $(echo "$left" | oneline)"
  echo "decision: fail (still pending)"
  exit 1
fi
echo "decision: applied"
output "applied=true"
{ echo "### Applied to staging"; echo; echo "$pending" | sed 's|^|- `|; s|$|`|'; } | summary
