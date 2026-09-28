#!/usr/bin/env bash
# Restore a fetched backup into a FRESH database, then verify it against the manifest.
#
#   scripts/backup/restore.sh <backup dir> <target connection string>
#   (RESTORE_DUMP_PATH: the dump's path as the pg_restore command sees it, when that runs in a
#   container with the directory mounted; default <backup dir>/db.dump)
#
# The target is a database nothing runs against: a fresh Postgres container from the Supabase
# image (the drill), or a new Supabase project (a real recovery; docs/runbooks/backup-restore.md).
# Never the live production database.
#
# Order (so no trigger fires on the load and no `--disable-triggers` is needed, which a hosted
# project's `postgres` role could not do): schema first (pre-data), then every row (data), then
# indexes, constraints, triggers and RLS policies (post-data). The `auth` schema exists on any
# Supabase database: on a bare container (which started with GoTrue's initial five tables) its
# objects are dropped and re-created from the dump, AUTH_MODE=schema (the default, the drill); on
# a real project only its data is loaded, GoTrue owns the shape there, AUTH_MODE=data.
#
# Verifies: every table's row count in public and auth equals the manifest's, the applied
# migrations equal the manifest's, and RLS still refuses: anon cannot read members, and the
# authenticated role with no JWT reads no expense claim.
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=lib.sh
. ./lib.sh

dir="${1:?usage: restore.sh <backup dir> <target connection string>}"
target="${2:?usage: restore.sh <backup dir> <target connection string>}"
: "${AUTH_MODE:=schema}"
dump="$dir/db.dump"
manifest="$dir/manifest.json"
[ -f "$dump" ] && [ -f "$manifest" ] || die "$dir must hold db.dump and manifest.json (fetch.sh)"
# When pg_restore runs in a container, the dump's path as that container sees it.
: "${RESTORE_DUMP_PATH:=$dump}"

say "target: $($PSQL "$target" -X -At -c "select current_database() || '@' || coalesce(inet_server_addr()::text, 'local') || ':' || coalesce(inet_server_port()::text, '')")"
if [ "$($PSQL "$target" -X -At -c "select count(*) from pg_tables where schemaname = 'public'")" != "0" ]; then
  die "the target already has public tables: restore only into a fresh database"
fi

# The TOC drives what is restored: pg_restore's --schema selects objects *inside* a schema and
# never the schema itself, so the schemas are created here and the SCHEMA entries left out; on a
# real project (AUTH_MODE=data) every auth object is left out as well, GoTrue owns that shape.
# Written beside the dump so a containerised pg_restore sees it at the same relative place.
toc="$dir/restore.toc"
toc_in_client="$(dirname "$RESTORE_DUMP_PATH")/restore.toc"
trap 'rm -f "$toc"' EXIT
$PG_RESTORE --list "$RESTORE_DUMP_PATH" > "$toc.all"
awk -v mode="$AUTH_MODE" '
  /^;/ { print; next }
  $4 == "SCHEMA" { next }
  ($4 == "ACL" || $4 == "COMMENT") && $5 == "-" && $6 == "SCHEMA" { next }
  mode == "data" && $5 == "auth" { next }
  { print }
' "$toc.all" > "$toc"
rm -f "$toc.all"
$PSQL "$target" -X -q -v ON_ERROR_STOP=1 -c "create schema if not exists app; create schema if not exists supabase_migrations; create schema if not exists auth;"

say "1/3 schema (pre-data)"
if [ "$AUTH_MODE" = "schema" ]; then
  # A bare container starts with GoTrue's first five auth tables: they make way for the dump's.
  $PG_RESTORE --dbname="$target" --no-owner --section=pre-data --use-list="$toc_in_client" --clean --if-exists --exit-on-error "$RESTORE_DUMP_PATH"
else
  $PG_RESTORE --dbname="$target" --no-owner --section=pre-data --use-list="$toc_in_client" --exit-on-error "$RESTORE_DUMP_PATH"
fi

say "2/3 data"
$PG_RESTORE --dbname="$target" --no-owner --section=data --exit-on-error "$RESTORE_DUMP_PATH"

say "3/3 indexes, constraints, triggers, policies (post-data)"
$PG_RESTORE --dbname="$target" --no-owner --section=post-data --use-list="$toc_in_client" --exit-on-error "$RESTORE_DUMP_PATH"

say "verifying"
expected_counts="$(python3 -c 'import json,sys; m=json.load(open(sys.argv[1])); print(json.dumps(m["row_counts"], sort_keys=True))' "$manifest")"
actual_counts="$(row_counts "$target" | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin), sort_keys=True))')"
if [ "$expected_counts" != "$actual_counts" ]; then
  python3 - "$expected_counts" "$actual_counts" <<'PY' >&2
import json, sys
a, b = json.loads(sys.argv[1]), json.loads(sys.argv[2])
for k in sorted(set(a) | set(b)):
    if a.get(k) != b.get(k):
        print(f"  {k}: manifest {a.get(k)} vs restored {b.get(k)}")
PY
  die "row counts differ from the manifest"
fi
say "row counts match the manifest ($(python3 -c 'import json,sys; print(len(json.loads(sys.argv[1])))' "$expected_counts") tables)"

expected_migrations="$(python3 -c 'import json,sys; print("\n".join(json.load(open(sys.argv[1]))["migrations"]))' "$manifest")"
actual_migrations="$(migration_versions "$target")"
[ "$expected_migrations" = "$actual_migrations" ] || die "the migration list differs from the manifest"
say "migration list matches ($(printf '%s\n' "$actual_migrations" | wc -l) migrations, last $(printf '%s\n' "$actual_migrations" | tail -n 1))"

anon_result="$($PSQL "$target" -X -At -v ON_ERROR_STOP=0 -c "set role anon; select count(*) from public.members" 2>&1 | tail -n 1)"
case "$anon_result" in
  *"permission denied"*|0) ;;
  *) die "RLS: anon read members ($anon_result)" ;;
esac
auth_result="$($PSQL "$target" -X -At -v ON_ERROR_STOP=1 -c "set role authenticated; select count(*) from public.expense_claims" | tail -n 1)"
[ "$auth_result" = "0" ] || die "RLS: the authenticated role with no JWT read $auth_result expense claims"
say "RLS still refuses (anon: ${anon_result:-0}; authenticated without a JWT: 0 claims)"
say "restore verified"
