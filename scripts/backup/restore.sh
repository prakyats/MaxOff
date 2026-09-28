#!/usr/bin/env bash
# Restore a fetched backup into a FRESH database, then verify it against the manifest.
#
#   scripts/backup/restore.sh <backup dir> <target connection string>
#   (RESTORE_DUMP_PATH: the dump's path as the pg_restore command sees it, when that runs in a
#   container with the directory mounted; default <backup dir>/db.dump)
#
# <backup dir> is taken relative to the caller's directory (the script never changes directory).
#
# The target is a database nothing runs against: a fresh Postgres container from the Supabase
# image (the drill), or a new Supabase project (a real recovery; docs/runbooks/backup-restore.md).
# Never the live production database.
#
# Order (so no trigger fires on the load and no `--disable-triggers` is needed, which a hosted
# project's `postgres` role could not do): schema first (pre-data), then every row (data), then
# indexes, constraints, triggers and RLS policies (post-data). The `auth` schema exists on any
# Supabase database: on a bare container (which started with GoTrue's initial five tables) its
# objects are dropped and re-created from the dump, AUTH_MODE=schema (the default); on a real
# project GoTrue has already created every auth table, constraint and its own migration ledger,
# and `postgres` owns none of it, so only auth's rows are loaded, AUTH_MODE=data. The drill runs
# both (scripts/backup/drill.sh).
#
# Verifies: every table's row count in public and auth equals the manifest's (in data mode
# without auth.schema_migrations, which is GoTrue's own), the applied migrations equal the
# manifest's, RLS still refuses (anon cannot read members, and the authenticated role with no JWT
# reads no expense claim), and the pg_cron jobs of the manifest exist on the target. A missing
# cron job is a WARNING with the exact `cron.schedule` call to run, not a failure: the cron schema
# is the platform's and never dumped, a restored migration history re-runs nothing, and a drill
# container has no jobs at all, so re-creating them is the runbook's next step, never this
# script's. The last line then reads "restore verified, with N warning(s)" instead of "restore
# verified".
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

dir="${1:?usage: restore.sh <backup dir> <target connection string>}"
target="${2:?usage: restore.sh <backup dir> <target connection string>}"
: "${AUTH_MODE:=schema}"
[ "$AUTH_MODE" = "schema" ] || [ "$AUTH_MODE" = "data" ] || die "AUTH_MODE must be schema or data (got '$AUTH_MODE')"
[ -d "$dir" ] || die "$dir is not a directory (fetch.sh writes it)"
dir="$(cd "$dir" && pwd)"
dump="$dir/db.dump"
manifest="$dir/manifest.json"
[ -f "$dump" ] && [ -f "$manifest" ] || die "$dir must hold db.dump and manifest.json (fetch.sh)"
# When pg_restore runs in a container, the dump's path as that container sees it.
: "${RESTORE_DUMP_PATH:=$dump}"
warnings=0

say "target: $($PSQL "$target" -X -At -c "select current_database() || '@' || coalesce(inet_server_addr()::text, 'local') || ':' || coalesce(inet_server_port()::text, '') || ' as ' || current_user") (auth: $AUTH_MODE)"
if [ "$($PSQL "$target" -X -At -c "select count(*) from pg_tables where schemaname = 'public'")" != "0" ]; then
  die "the target already has public tables: restore only into a fresh database"
fi

# The TOC drives what is restored: pg_restore's --schema selects objects *inside* a schema and
# never the schema itself, so the schemas are created here and the SCHEMA entries left out.
# A TOC line is "<id>; <catalog> <oid> <TYPE WORDS> <namespace> <name…> <owner>", and the type
# is one or more upper-case words (TABLE DATA, FK CONSTRAINT, SEQUENCE SET, SEQUENCE OWNED BY,
# ROW SECURITY, DEFAULT ACL), so the namespace is the first lower-case field, never field 5.
# In data mode every auth entry is left out except the rows themselves (TABLE DATA, minus
# GoTrue's own schema_migrations, whose rows the target already has) and the sequence values
# (SEQUENCE SET, so the next refresh token gets a fresh id); and the platform's default
# privileges (DEFAULT ACL owned by supabase_admin) are left out too: they exist on every Supabase
# database and `postgres` is not allowed to re-state them.
# Written beside the dump so a containerised pg_restore sees it at the same relative place.
toc="$dir/restore.toc"
toc_in_client="$(dirname "$RESTORE_DUMP_PATH")/restore.toc"
trap 'rm -f "$toc" "$toc.all" "$toc.order"' EXIT

# $1 = the target: its auth tables, parents before children, one name per line (the order the
# rows must load in while GoTrue's foreign keys stand).
auth_data_order() {
  $PSQL "$1" -X -At -v ON_ERROR_STOP=1 <<'SQL'
with recursive fk as (
  select cn.nspname || '.' || c.relname as child, pn.nspname || '.' || p.relname as parent
  from pg_constraint k
  join pg_class c on c.oid = k.conrelid join pg_namespace cn on cn.oid = c.relnamespace
  join pg_class p on p.oid = k.confrelid join pg_namespace pn on pn.oid = p.relnamespace
  where k.contype = 'f' and cn.nspname = 'auth' and pn.nspname = 'auth' and c.oid <> p.oid
), t as (
  select n.nspname || '.' || c.relname as name
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'auth' and c.relkind = 'r'
), lvl as (
  select name, 0 as level from t where name not in (select child from fk)
  union all
  select fk.child, lvl.level + 1 from fk join lvl on lvl.name = fk.parent where lvl.level < 32
)
select substr(name, 6) from lvl group by name order by max(level), name;
SQL
}
$PG_RESTORE --list "$RESTORE_DUMP_PATH" > "$toc.all"
awk -v mode="$AUTH_MODE" '
  /^;/ { print; next }
  $4 == "SCHEMA" { next }
  ($4 == "ACL" || $4 == "COMMENT") && $5 == "-" && $6 == "SCHEMA" { next }
  mode == "data" && $0 ~ /^[0-9]+; [0-9]+ [0-9]+ [A-Z ]+ auth / {
    if ($0 ~ /^[0-9]+; [0-9]+ [0-9]+ TABLE DATA auth / && $0 !~ /^[0-9]+; [0-9]+ [0-9]+ TABLE DATA auth schema_migrations /) print
    else if ($0 ~ /^[0-9]+; [0-9]+ [0-9]+ SEQUENCE SET auth /) print
    next
  }
  mode == "data" && $0 ~ /^[0-9]+; [0-9]+ [0-9]+ DEFAULT ACL / && $NF != "postgres" { next }
  { print }
' "$toc.all" > "$toc"
rm -f "$toc.all"
if [ "$AUTH_MODE" = "data" ]; then
  # GoTrue's foreign keys are already in place on the target (nothing is deferred), so auth's
  # rows must load parents first: users before identities and sessions, sessions before
  # refresh_tokens, and so on. pg_restore follows the list's order, so the TABLE DATA auth
  # entries are re-ordered by the target's own constraints (pg_restore's own order is by name,
  # which put identities before users: the first data-mode drill, 2026-09-28).
  auth_data_order "$target" > "$toc.order"
  python3 - "$toc" "$toc.order" <<'PY'
import re, sys
toc, order = sys.argv[1], [l for l in open(sys.argv[2]).read().split("\n") if l]
rank = {name: i for i, name in enumerate(order)}
entry = re.compile(r"^[0-9]+; [0-9]+ [0-9]+ TABLE DATA auth (\S+) ")
data, out, slot = {}, [], None
for line in open(toc).read().splitlines():
    m = entry.match(line)
    if m:
        data[m.group(1)] = line
        if slot is None:
            slot = len(out)
            out.append(None)
    else:
        out.append(line)
ordered = [data[k] for k in sorted(data, key=lambda k: (rank.get(k, len(rank)), k))]
with open(toc, "w") as f:
    for line in out:
        f.write("\n".join(ordered) + "\n" if line is None else line + "\n")
PY
  rm -f "$toc.order"
fi
$PSQL "$target" -X -q -v ON_ERROR_STOP=1 -c "create schema if not exists app; create schema if not exists supabase_migrations; create schema if not exists auth;"

say "1/3 schema (pre-data)"
if [ "$AUTH_MODE" = "schema" ]; then
  # A bare container starts with GoTrue's first five auth tables: they make way for the dump's.
  $PG_RESTORE --dbname="$target" --no-owner --section=pre-data --use-list="$toc_in_client" --clean --if-exists --exit-on-error "$RESTORE_DUMP_PATH"
else
  $PG_RESTORE --dbname="$target" --no-owner --section=pre-data --use-list="$toc_in_client" --exit-on-error "$RESTORE_DUMP_PATH"
fi

say "2/3 data"
$PG_RESTORE --dbname="$target" --no-owner --section=data --use-list="$toc_in_client" --exit-on-error "$RESTORE_DUMP_PATH"

say "3/3 indexes, constraints, triggers, policies (post-data)"
$PG_RESTORE --dbname="$target" --no-owner --section=post-data --use-list="$toc_in_client" --exit-on-error "$RESTORE_DUMP_PATH"

say "verifying"
# In data mode auth.schema_migrations is GoTrue's own ledger on the target (not restored, and a
# newer GoTrue has more rows), so it is left out of the comparison.
skip_table=""; [ "$AUTH_MODE" = "data" ] && skip_table="auth.schema_migrations"
expected_counts="$(python3 -c 'import json,sys; m=json.load(open(sys.argv[1]))["row_counts"]; m.pop(sys.argv[2], None); print(json.dumps(m, sort_keys=True))' "$manifest" "$skip_table")"
actual_counts="$(row_counts "$target" | python3 -c 'import json,sys; m=json.load(sys.stdin); m.pop(sys.argv[1], None); print(json.dumps(m, sort_keys=True))' "$skip_table")"
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
say "row counts match the manifest ($(python3 -c 'import json,sys; print(len(json.loads(sys.argv[1])))' "$expected_counts") tables${skip_table:+; $skip_table belongs to GoTrue, not compared})"

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

# The pg_cron jobs: compared with the manifest, a warning when one is missing (see the header).
# $1 = the manifest's jobs, $2 = the target's (JSON): one `cron.schedule` line per job that is
# missing or differs, ready to paste.
cron_missing() {
  python3 - "$1" "$2" <<'PY'
import json, sys
want, have = json.loads(sys.argv[1]), json.loads(sys.argv[2]) or []
have = {j["jobname"]: j for j in have}
for j in want:
    h = have.get(j["jobname"])
    if h is None or h["schedule"] != j["schedule"] or h["command"] != j["command"]:
        print("  select cron.schedule('%s', '%s', $$%s$$);" % (j["jobname"], j["schedule"], j["command"]))
PY
}
expected_cron="$(python3 -c 'import json,sys; print(json.dumps(json.load(open(sys.argv[1])).get("cron_jobs"), sort_keys=True))' "$manifest")"
if [ "$expected_cron" = "null" ]; then
  say "cron jobs: the manifest records none (the source had no pg_cron, or the backup predates the list), nothing to check"
else
  actual_cron="$(cron_jobs "$target")"
  to_schedule="$(cron_missing "$expected_cron" "$actual_cron")"
  n_expected="$(python3 -c 'import json,sys; print(len(json.loads(sys.argv[1])))' "$expected_cron")"
  if [ "$actual_cron" = "null" ]; then
    warnings=$((warnings + 1))
    warn "cron jobs: pg_cron is not installed on the target, so none of the manifest's $n_expected job(s) exist there (a drill container: expected; a new project: enable pg_cron and pg_net, then run the runbook's cron.schedule calls):"
    printf '%s\n' "$to_schedule" >&2
  elif [ -n "$to_schedule" ]; then
    warnings=$((warnings + 1))
    warn "cron jobs: $(printf '%s\n' "$to_schedule" | wc -l) of the manifest's $n_expected job(s) are missing or differ on the target (the cron schema is never dumped); run:"
    printf '%s\n' "$to_schedule" >&2
  else
    say "cron jobs match the manifest ($n_expected jobs)"
  fi
fi

if [ "$warnings" = 0 ]; then
  say "restore verified"
else
  say "restore verified, with $warnings warning(s): read the WARNING lines above before going live"
fi
