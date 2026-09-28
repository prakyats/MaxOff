#!/usr/bin/env bash
# Download one backup (the latest under the prefix, or the key given) and decrypt it.
#
#   scripts/backup/fetch.sh <out dir> [key]
#
# Environment: the S3 variables (lib.sh), BACKUP_PREFIX, and BACKUP_AGE_IDENTITY: the path of the
# age private key file (the Owner's, kept offline; on the machine only for the drill).
# Leaves <out dir>/db.dump and <out dir>/manifest.json. <out dir> is taken relative to the
# caller's directory (the script never changes directory), so `./restore-2026-10-01` from the
# repository root is that folder, the one the runbook then mounts into the pg_restore container.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

out="${1:?usage: fetch.sh <out dir> [key]}"
key="${2:-}"
mkdir -p "$out"
out="$(cd "$out" && pwd)"
require_env BACKUP_PREFIX BACKUP_AGE_IDENTITY BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY
[ -f "$BACKUP_AGE_IDENTITY" ] || die "BACKUP_AGE_IDENTITY ($BACKUP_AGE_IDENTITY) is not a file"

if [ -z "$key" ]; then
  key="$(s3_list "${BACKUP_PREFIX%/}/" | tail -n 1 | cut -d' ' -f1)"
  [ -n "$key" ] || die "no backup under ${BACKUP_PREFIX%/}/ in $BACKUP_S3_BUCKET"
fi
say "fetching $key"
s3_get "$key" "$out/backup.tar.age"
say "decrypting"
age -d -i "$BACKUP_AGE_IDENTITY" -o "$out/backup.tar" "$out/backup.tar.age"
tar -C "$out" -xf "$out/backup.tar" db.dump manifest.json
rm -f "$out/backup.tar" "$out/backup.tar.age"
say "ready: $out/db.dump, $out/manifest.json"
printf '%s\n' "$key"
