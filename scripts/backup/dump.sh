#!/usr/bin/env bash
# Nightly backup (3c.2, ARCHITECTURE §17): pg_dump → age-encrypt → the private bucket.
#
#   scripts/backup/dump.sh
#
# Environment (see lib.sh for the S3 and Postgres client variables):
#   BACKUP_DATABASE_URL     the source, e.g. "host=… port=5432 user=postgres.<ref> dbname=postgres sslmode=require"
#                           (key=value form: the password goes in PGPASSWORD, never in a URL)
#   BACKUP_AGE_RECIPIENT    the age public key (age1…) the archive is encrypted to; the private
#                           key stays offline with the Owner and never reaches CI
#   BACKUP_PREFIX           object prefix, e.g. postgres/peshoflxypujbzecgwqq
#   BACKUP_RETENTION_DAYS   optional: delete objects under the prefix older than this many days,
#                           at least 7 (the bucket's lifecycle rule is the primary retention; this
#                           is the belt to its braces); empty prunes nothing; the object this run
#                           uploads is never a candidate
#   BACKUP_OUT              optional: keep the local encrypted archive here instead of a temp dir
#
# What goes in the archive (a tar, then age): db.dump, a pg_dump custom-format dump of the schemas
# public, app, auth and supabase_migrations (schema and data; restore decides what to use), and
# manifest.json with the instant, the server version, the applied migrations, the row count of
# every table in public and auth, and the pg_cron jobs (the cron schema itself is never dumped),
# so a restore can be verified without the source.
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=lib.sh
. ./lib.sh

require_env BACKUP_DATABASE_URL BACKUP_AGE_RECIPIENT BACKUP_PREFIX \
  BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY
command -v age >/dev/null || die "age is not installed (apt install age)"
# A floor under pruning: a mistyped retention (0, 1, "3O") must never empty the bucket.
if [ -n "${BACKUP_RETENTION_DAYS:-}" ]; then
  [[ "$BACKUP_RETENTION_DAYS" =~ ^[0-9]+$ ]] && [ "$BACKUP_RETENTION_DAYS" -ge 7 ] \
    || die "BACKUP_RETENTION_DAYS must be a whole number of days, at least 7 (got '$BACKUP_RETENTION_DAYS'); leave it empty to prune nothing"
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
name="${stamp}.tar.age"
key="${BACKUP_PREFIX%/}/${name}"

say "dumping (public, app, auth, supabase_migrations)"
$PG_DUMP --format=custom --no-owner \
  --schema=public --schema=app --schema=auth --schema=supabase_migrations \
  --dbname="$BACKUP_DATABASE_URL" > "$work/db.dump"
[ -s "$work/db.dump" ] || die "the dump is empty"

say "writing the manifest"
server_version="$($PSQL "$BACKUP_DATABASE_URL" -X -At -c 'show server_version')"
migrations="$(migration_versions "$BACKUP_DATABASE_URL" | sed 's/.*/"&"/' | paste -sd, -)"
counts="$(row_counts "$BACKUP_DATABASE_URL")"
cron="$(cron_jobs "$BACKUP_DATABASE_URL")"
printf '{"dumped_at":"%s","server_version":"%s","dump_bytes":%s,"migrations":[%s],"row_counts":%s,"cron_jobs":%s}\n' \
  "$stamp" "$server_version" "$(stat -c %s "$work/db.dump")" "$migrations" "$counts" "$cron" > "$work/manifest.json"
python3 -c 'import json, sys; m = json.load(open(sys.argv[1])); assert m["row_counts"] and m["migrations"], "empty manifest"' "$work/manifest.json" \
  || die "the manifest is not valid (is PSQL reading its query from stdin?)"
say "manifest: $(python3 - "$work/manifest.json" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
print(len(m["row_counts"]), "tables,", len(m["migrations"]), "migrations,",
      "no pg_cron" if m["cron_jobs"] is None else f'{len(m["cron_jobs"])} cron jobs,', "Postgres", m["server_version"])
PY
)"

say "encrypting to the recipient"
tar -C "$work" -cf "$work/backup.tar" db.dump manifest.json
age -r "$BACKUP_AGE_RECIPIENT" -o "$work/$name" "$work/backup.tar"

say "uploading $key ($(stat -c %s "$work/$name") bytes)"
s3_put "$work/$name" "$key"
s3_list "${BACKUP_PREFIX%/}/" | grep -q "^$key " || die "the upload is not listed"

if [ -n "${BACKUP_RETENTION_DAYS:-}" ]; then
  cutoff="$(date -u -d "-${BACKUP_RETENTION_DAYS} days" +%Y-%m-%dT%H:%M:%S)"
  while read -r old_key modified; do
    # Never the object just uploaded, whatever the listing says its instant is.
    if [ "$old_key" != "$key" ] && [[ "$modified" < "$cutoff" ]]; then
      say "pruning $old_key ($modified)"
      s3_delete "$old_key"
    fi
  done < <(s3_list "${BACKUP_PREFIX%/}/")
fi

total="$(s3_list "${BACKUP_PREFIX%/}/" | wc -l)"
say "done: $key; $total object(s) under ${BACKUP_PREFIX%/}/"
if [ -n "${BACKUP_OUT:-}" ]; then
  mkdir -p "$BACKUP_OUT"
  cp "$work/$name" "$BACKUP_OUT/"
fi
printf '%s\n' "$key"
