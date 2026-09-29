#!/usr/bin/env bash
# Shared by the backup scripts (3c.2, ARCHITECTURE §17, docs/runbooks/backup-restore.md).
#
# Postgres client commands are overridable so the same scripts run with a local client, a
# Docker image (the GitHub runner: `docker run --rm --network host postgres:17 pg_dump …`) or
# the local stack's own image. Defaults are the binaries on PATH.
#   PG_DUMP, PG_RESTORE, PSQL   the commands (may hold spaces)
#
# S3-compatible storage through curl's own SigV4 (no SDK): R2 in production, MinIO locally.
#   BACKUP_S3_ENDPOINT          https://<account>.r2.cloudflarestorage.com | http://127.0.0.1:9000
#   BACKUP_S3_BUCKET            maxoff-backups-production | maxoff (local MinIO)
#   BACKUP_S3_ACCESS_KEY_ID / BACKUP_S3_SECRET_ACCESS_KEY
#   BACKUP_S3_REGION            auto (R2 and MinIO both accept it)
set -euo pipefail

: "${PG_DUMP:=pg_dump}"
: "${PG_RESTORE:=pg_restore}"
: "${PSQL:=psql}"
: "${BACKUP_S3_REGION:=auto}"

say() { printf '%s\n' "backup: $*" >&2; }
warn() { printf '%s\n' "backup: WARNING: $*" >&2; }
die() { printf '%s\n' "backup: $*" >&2; exit 1; }

require_env() {
  local name
  for name in "$@"; do
    [ -n "${!name:-}" ] || die "$name is not set"
  done
}

s3_url() { printf '%s/%s/%s' "${BACKUP_S3_ENDPOINT%/}" "$BACKUP_S3_BUCKET" "$1"; }

# curl with SigV4 for the bucket. Extra arguments go to curl.
s3_curl() {
  curl -sS --fail-with-body --aws-sigv4 "aws:amz:${BACKUP_S3_REGION}:s3" \
    --user "${BACKUP_S3_ACCESS_KEY_ID}:${BACKUP_S3_SECRET_ACCESS_KEY}" "$@"
}

s3_put() { s3_curl -X PUT --data-binary "@$1" -H "content-type: application/octet-stream" "$(s3_url "$2")" -o /dev/null; }
s3_get() { s3_curl "$(s3_url "$1")" -o "$2"; }
s3_delete() { s3_curl -X DELETE "$(s3_url "$1")" -o /dev/null; }

# Keys under a prefix, one per line with their last-modified instant: "<key> <iso>". Sorted by key.
# An empty prefix prints nothing and succeeds (grep alone would fail the pipeline under pipefail
# and hide the caller's own message); a failed request still fails it.
s3_list() {
  local prefix="$1"
  s3_curl "$(s3_url "")?list-type=2&prefix=$(printf '%s' "$prefix" | sed 's/\//%2F/g')" \
    | tr -d '\n' | sed 's/<Contents>/\n<Contents>/g' | { grep '<Contents>' || true; } \
    | sed -E 's/.*<Key>([^<]*)<\/Key>.*<LastModified>([^<]*)<\/LastModified>.*/\1 \2/' | sort
}

# The tables whose row counts the manifest records and the drill compares: everything in public
# and auth (auth carries the sign-ins; storage, cron and the rest are re-created by the platform).
COUNT_SCHEMAS="'public', 'auth'"

row_counts_sql() {
  cat <<'SQL'
select json_object_agg(t.name, t.n order by t.name)
from (
  select c.relnamespace::regnamespace::text || '.' || c.relname as name,
         (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %s', c.oid::regclass), false, true, '')))[1]::text::bigint as n
  from pg_class c
  where c.relkind = 'r' and c.relnamespace::regnamespace::text in (COUNT_SCHEMAS)
) t;
SQL
}

# JSON: {"<schema.table>": <count>, …} for the database at $1 (a connection string).
row_counts() {
  row_counts_sql | sed "s/COUNT_SCHEMAS/$COUNT_SCHEMAS/" | $PSQL "$1" -X -At -v ON_ERROR_STOP=1
}

# The applied migrations, one version per line.
migration_versions() {
  $PSQL "$1" -X -At -v ON_ERROR_STOP=1 -c "select version from supabase_migrations.schema_migrations order by version"
}

# The pg_cron jobs as JSON, [{"jobname", "schedule", "command"}, …] by name, or null when the
# database has no pg_cron. The cron schema is the platform's (its run history is not ours) and is
# never dumped, and a restored migration history re-runs no migration, so a recovery re-creates
# the jobs from this list by hand (docs/runbooks/backup-restore.md); restore.sh checks them.
cron_jobs() {
  if [ "$($PSQL "$1" -X -At -v ON_ERROR_STOP=1 -c "select to_regclass('cron.job') is not null")" = "t" ]; then
    $PSQL "$1" -X -At -v ON_ERROR_STOP=1 -c "select coalesce(json_agg(json_build_object('jobname', jobname, 'schedule', schedule, 'command', command) order by jobname), '[]'::json) from cron.job"
  else
    printf 'null\n'
  fi
}
