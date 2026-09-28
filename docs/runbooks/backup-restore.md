# Runbook: backup and restore (3c.2)

On the free plan Supabase keeps no backup of its own (ADR-0003), so the nightly encrypted `pg_dump` in
R2 is the only way back. This page is the whole path: what runs every night, how to restore, the drill
that proves it, and the write-up of the drills done. ARCHITECTURE §17 is the design; README → "Backups" is
the one-time setup.

## What runs every night

`.github/workflows/backup.yml` (02:00 IST; also Actions → Backup → Run workflow), in the GitHub
environment `backups`:

1. `scripts/backup/dump.sh`: `pg_dump --format=custom` of the schemas `public`, `app`, `auth` and
   `supabase_migrations` (schema and data) through the **session pooler** (`postgres.<ref>@<pooler
   host>:5432`, `sslmode=require`; the runner has no IPv6, which the direct host needs).
2. A **manifest** beside it: the instant, the server version, the applied migrations and the row count of
   every table in `public` and `auth`. A restore is verified against it, so the source is never needed
   again.
3. `tar` → `age -r <recipient>`: encrypted to the Owner's age public key. The private key is offline with
   the Owner; CI holds only the public one.
4. Upload to `maxoff-backups-production` as `postgres/<ref>/<UTC stamp>.tar.age` with curl's SigV4, then
   a listing proves the object is there. Objects older than 30 days are pruned by the script; the bucket's
   lifecycle rule (31 days) is the primary retention.

A red run is a missing night: Actions → Backup shows it, and the monthly usage-check issue asks whether
every night was green.

## Restore

Only ever into a **fresh** database: a new Supabase project (a real recovery) or a throwaway container
(a drill). Never into the live production database.

Needs on the machine: `age` (with the private key file), Docker (for a Postgres 17 client: the host's
`pg_restore` must not be older than the server), `curl`, `python3`, and the R2 token of the backup bucket.

```bash
# 1. Download and decrypt the latest backup (or pass a key as the second argument).
export BACKUP_S3_ENDPOINT=https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com
export BACKUP_S3_BUCKET=maxoff-backups-production
export BACKUP_S3_ACCESS_KEY_ID=…  BACKUP_S3_SECRET_ACCESS_KEY=…     # the backup bucket's token
export BACKUP_PREFIX=postgres/peshoflxypujbzecgwqq
export BACKUP_AGE_IDENTITY=/path/to/maxoff-backup.key             # the Owner's private key
bash scripts/backup/fetch.sh ./restore-$(date +%F)

# 2. Restore into the fresh target and verify it.
export PG_RESTORE="docker run --rm --network host -v $PWD/restore-$(date +%F):/drill postgres:17 pg_restore"
export PSQL="docker run --rm -i --network host postgres:17 psql"
export RESTORE_DUMP_PATH=/drill/db.dump
AUTH_MODE=data bash scripts/backup/restore.sh ./restore-$(date +%F) "postgresql://postgres:<password>@<host>:5432/postgres?sslmode=require"
```

`restore.sh` loads in three sections so no trigger fires during the load (and no superuser
`--disable-triggers` is needed, which a hosted project's `postgres` role cannot do): the schema
(pre-data), every row (data), then indexes, constraints, triggers and RLS policies (post-data). Then it
**verifies**: every row count in `public` and `auth` equals the manifest's, the migration list equals
the manifest's, and RLS still refuses (`anon` cannot read `members`; the `authenticated` role with no JWT
reads no expense claim). It stops at the first difference.

- **A new Supabase project (a real recovery):** `AUTH_MODE=data`. GoTrue has already created the `auth`
  tables in the new project, so only their rows are loaded; `public`, `app` and `supabase_migrations`
  come whole from the dump (the migration table too, so the next `db push` sees the same history). Use the
  project's **session pooler** connection string (IPv4) as the target. Then point `production`'s
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`,
  `SUPABASE_PROJECT_REF` and `SUPABASE_DB_PASSWORD` at it, apply README → "Hosted auth settings" (Site URL,
  SMTP, the recovery template), tag a deploy, and re-point the `backups` environment.
- **A throwaway container (a drill):** `AUTH_MODE=schema` (the default) and the target
  `supabase/postgres` image's superuser `supabase_admin`; the dump's `auth` objects replace the image's
  initial ones. `scripts/backup/drill.sh` does all of this on the local stack.

Rows written since the backup are lost (up to a day); people re-enter the day's attendance and claims
with the Owner. Files in R2 are untouched by a database restore (`files` rows point at objects that
still exist).

## The drill

**Local, any time** (the proof that the scripts work end to end, on a developer machine with the local
stack and MinIO up):

```bash
bash scripts/backup/drill.sh
```

It generates a throwaway age key pair, dumps the local database, encrypts and uploads to MinIO, downloads
and decrypts, starts a fresh container of the stack's own image (`supabase/postgres:17.x`), restores, runs
the verification, and removes the container, the temp files and the object. About ten seconds.

**Production, once after the first production deploy (3c.3) and then every quarter:** the "Restore"
steps above against the latest production backup into a **throwaway** target (a fresh local container
of the `supabase/postgres` image, `AUTH_MODE=schema`, or a scratch Supabase project, `AUTH_MODE=data`),
read the three "verified" lines, then delete the target. Write the date and the numbers into the table
below.

## Drills done

| Date | Where | Backup | Result |
|---|---|---|---|
| 2026-09-28 | Local stack → MinIO → fresh `supabase/postgres:17.6.1.167` container (`scripts/backup/drill.sh`, unit 3cA) | `drill/…/20260928T133637Z.tar.age` (727 KB) | Verified: 46 tables' row counts equal, 34 migrations equal (last `20260928131234`), RLS refuses (anon on members; authenticated without a JWT: 0 claims) |
| _pending_ | Production bucket → throwaway target, after the first production deploy (3c.3) | | |

## Monthly usage check

On the 1st the Backup workflow opens a "Monthly Supabase usage check" issue. Open the production project's
**Usage** page and tick: transfer this month below **~4 GB** (free plan: 5 GB); database size below
**~400 MB** (free plan: 500 MB); every nightly backup green and about 30 objects in the bucket; UptimeRobot
up on `https://app.maxoff.in/api/health`; point-in-time recovery still not worth it. Above a threshold:
upgrade to Pro before the cap (ADR-0003).
