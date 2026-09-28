#!/usr/bin/env bash
# The restore drill, end to end, on this machine (3c.2): dump the local database → encrypt →
# upload to the local MinIO → download → decrypt → restore into a FRESH Postgres container from
# the local stack's own image → verify. The production drill runs the same fetch.sh + restore.sh
# against the production bucket (docs/runbooks/backup-restore.md).
#
#   scripts/backup/drill.sh
#
# Needs the local stack (`pnpm db:start`, `pnpm storage:start`), Docker and age. Leaves nothing:
# the throwaway age key, the temp dirs and the target container are removed at the end.
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=lib.sh
. ./lib.sh

DB_IMAGE="${DRILL_DB_IMAGE:-$(docker inspect supabase_db_maxoff --format '{{.Config.Image}}')}"
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
export BACKUP_AGE_RECIPIENT="$(grep -o 'age1[a-z0-9]*' "$work/drill.key" | head -n 1)"
export BACKUP_AGE_IDENTITY="$work/drill.key"

say "drill: 1. dump, encrypt, upload"
key="$(./dump.sh)"

say "drill: 2. download, decrypt"
mkdir -p "$work/fetched"
./fetch.sh "$work/fetched" "$key" >/dev/null
[ -s "$work/fetched/db.dump" ] || die "no dump came back"

say "drill: 3. a fresh Postgres ($DB_IMAGE) on 127.0.0.1:$TARGET_PORT (as supabase_admin, the image's superuser)"
docker rm -f "$TARGET_NAME" >/dev/null 2>&1 || true
docker run -d --name "$TARGET_NAME" -e POSTGRES_PASSWORD=postgres -p "127.0.0.1:$TARGET_PORT:5432" "$DB_IMAGE" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$TARGET_NAME" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1 && break
  sleep 1
done
target="postgresql://supabase_admin:postgres@127.0.0.1:$TARGET_PORT/postgres"

say "drill: 4. restore and verify"
cp "$work/fetched/db.dump" "$work/fetched/manifest.json" "$work/"
export PG_RESTORE="docker run --rm --network host -v $work:/drill $DB_IMAGE pg_restore"
AUTH_MODE=schema RESTORE_DUMP_PATH=/drill/db.dump ./restore.sh "$work" "$target"

say "drill: 5. tidy the bucket"
s3_delete "$key"
say "drill passed"
