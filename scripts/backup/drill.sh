#!/usr/bin/env bash
# The restore drill, end to end, on this machine (3c.2): dump the local database → encrypt →
# upload to the local MinIO → download → decrypt → restore into a FRESH Postgres container from
# the local stack's own image → verify. The production drill runs the same fetch.sh + restore.sh
# against the production bucket (docs/runbooks/backup-restore.md).
#
#   scripts/backup/drill.sh [schema|data|both]     (default: both)
#
#   schema  a bare container as its superuser supabase_admin: the dump's auth objects replace
#           the image's initial ones (AUTH_MODE=schema).
#   data    the shape of a hosted project, a real recovery's mode (AUTH_MODE=data): the fresh
#           container first gets GoTrue's own migrations (the stack's gotrue image, `auth
#           migrate`: every auth table, its constraints and auth.schema_migrations, owned by
#           supabase_auth_admin) and pg_cron, and the restore runs as the non-superuser
#           `postgres`, which is what the session pooler's postgres.<ref> is.
#
# Needs the local stack (`pnpm db:start`, `pnpm storage:start`), Docker and age. Leaves nothing:
# the throwaway age key, the temp dirs and the target container are removed at the end.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"

modes="${1:-both}"
case "$modes" in
  schema|data) ;;
  both) modes="schema data" ;;
  *) die "usage: drill.sh [schema|data|both]" ;;
esac

DB_IMAGE="${DRILL_DB_IMAGE:-$(docker inspect supabase_db_maxoff --format '{{.Config.Image}}')}"
GOTRUE_IMAGE="${DRILL_GOTRUE_IMAGE:-$(docker inspect supabase_auth_maxoff --format '{{.Config.Image}}')}"
TARGET_NAME="maxoff-restore-drill"
TARGET_PORT="${DRILL_TARGET_PORT:-55432}"
work="$(mktemp -d)"
cleanup() {
  docker rm -f "$TARGET_NAME" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

# Postgres 17 clients through the stack's own image (the host may carry an older client).
export PG_DUMP="docker run --rm --network host $DB_IMAGE pg_dump"
export PG_RESTORE="docker run --rm --network host -v $work:/drill $DB_IMAGE pg_restore"
export PSQL="docker run --rm -i --network host $DB_IMAGE psql"

export BACKUP_DATABASE_URL="${DRILL_SOURCE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
export BACKUP_S3_ENDPOINT="${S3_ENDPOINT:-http://127.0.0.1:9000}"
export BACKUP_S3_BUCKET="${S3_BUCKET:-maxoff}"
export BACKUP_S3_ACCESS_KEY_ID="${S3_ACCESS_KEY_ID:-maxoff}"
export BACKUP_S3_SECRET_ACCESS_KEY="${S3_SECRET_ACCESS_KEY:-maxoff-local-secret}"
export BACKUP_PREFIX="drill/$(date -u +%Y%m%dT%H%M%SZ)"

say "drill: a throwaway age key pair"
age-keygen -o "$work/drill.key" 2>/dev/null
BACKUP_AGE_RECIPIENT="$(grep -o 'age1[a-z0-9]*' "$work/drill.key" | head -n 1)"
export BACKUP_AGE_RECIPIENT
export BACKUP_AGE_IDENTITY="$work/drill.key"

say "drill: 1. dump, encrypt, upload"
key="$("$here/dump.sh")"

say "drill: 2. download, decrypt"
mkdir -p "$work/fetched"
"$here/fetch.sh" "$work/fetched" "$key" >/dev/null
[ -s "$work/fetched/db.dump" ] || die "no dump came back"

# A fresh container of the stack's image, waited for; $1 = the mode it is prepared for.
fresh_target() {
  docker rm -f "$TARGET_NAME" >/dev/null 2>&1 || true
  docker run -d --name "$TARGET_NAME" -e POSTGRES_PASSWORD=postgres -p "127.0.0.1:$TARGET_PORT:5432" "$DB_IMAGE" >/dev/null
  for _ in $(seq 1 60); do
    docker exec "$TARGET_NAME" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1 && break
    sleep 1
  done
  # The image's init keeps running a moment after pg_isready answers.
  sleep 2
  if [ "$1" = "data" ]; then
    docker exec "$TARGET_NAME" psql -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1 \
      -c "alter role supabase_auth_admin password 'postgres'" \
      -c "create extension if not exists pg_cron with schema pg_catalog"
    # `auth migrate` only needs a database; the JWT secret and URLs are throwaway values its
    # config loader insists on (GoTrue itself never runs against this container).
    docker run --rm --network host \
      -e GOTRUE_DB_DRIVER=postgres \
      -e DATABASE_URL="postgres://supabase_auth_admin:postgres@127.0.0.1:$TARGET_PORT/postgres" \
      -e GOTRUE_JWT_SECRET=drill-only-drill-only-drill-only-drill \
      -e GOTRUE_SITE_URL=http://localhost -e API_EXTERNAL_URL=http://localhost:9999 \
      "$GOTRUE_IMAGE" auth migrate > "$work/gotrue.log" 2>&1 \
      || { tail -n 5 "$work/gotrue.log" >&2; die "GoTrue's migrations failed on the target ($GOTRUE_IMAGE)"; }
    say "drill: GoTrue's shape: $(docker exec "$TARGET_NAME" psql -U supabase_admin -d postgres -X -At -c "select count(*) || ' auth tables, ' || (select count(*) from auth.schema_migrations) || ' GoTrue migrations, pg_cron with ' || (select count(*) from cron.job) || ' jobs' from pg_tables where schemaname = 'auth'")"
  fi
}

n=0
for mode in $modes; do
  n=$((n + 1))
  say "drill: 3. a fresh Postgres ($DB_IMAGE) on 127.0.0.1:$TARGET_PORT for AUTH_MODE=$mode"
  fresh_target "$mode"
  # schema mode as the image's superuser; data mode as the non-superuser postgres, the pooler's role.
  role=supabase_admin; [ "$mode" = "data" ] && role=postgres
  target="postgresql://$role:postgres@127.0.0.1:$TARGET_PORT/postgres"

  say "drill: 4. restore and verify (AUTH_MODE=$mode, as $role)"
  cp "$work/fetched/db.dump" "$work/fetched/manifest.json" "$work/"
  AUTH_MODE="$mode" RESTORE_DUMP_PATH=/drill/db.dump "$here/restore.sh" "$work" "$target"
  say "drill: AUTH_MODE=$mode passed"
done

say "drill: 5. tidy the bucket"
s3_delete "$key"
say "drill passed ($n mode(s): $modes)"
