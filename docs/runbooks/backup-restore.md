# Runbook: backup and restore (3c.2)

On the free plan Supabase keeps no backup of its own (ADR-0003), so the nightly encrypted `pg_dump` in
R2 is the only way back. This page is the whole path: what runs every night, how to restore, the drill
that proves it, and the write-up of the drills done. ARCHITECTURE §17 is the design; README → "Backups" is
the one-time setup.

## What runs every night

`.github/workflows/backup.yml` (02:00 IST; also Actions → Backup → Run workflow), in the GitHub
environment `backup`:

1. `scripts/backup/dump.sh`: `pg_dump --format=custom` of the schemas `public`, `app`, `auth` and
   `supabase_migrations` (schema and data) through the **session pooler** (`postgres.<ref>@<pooler
   host>:5432`, `sslmode=require`; the runner has no IPv6, which the direct host needs).
   **Owner step at the first production backup run:** `sslmode=require` encrypts but does not verify
   the pooler's certificate (its chain is unknown until the first hosted run). If the pooler's
   certificate is publicly signed, switch `backup.yml`'s `BACKUP_DATABASE_URL` to `sslmode=verify-full
   sslrootcert=system` (libpq 16+, the `postgres:17` image); otherwise commit Supabase's CA (Dashboard →
   Database → SSL) as `scripts/backup/supabase-ca.crt`, mount it into the client container and pass
   `sslrootcert=/certs/supabase-ca.crt` with `sslmode=verify-full`.
2. A **manifest** beside it: the instant, the server version, the applied migrations, the row count of
   every table in `public` and `auth`, and the pg_cron jobs (name, schedule, command; the `cron` schema
   itself is the platform's and is never dumped). A restore is verified against it, so the source is
   never needed again.
3. `tar` → `age -r <recipient>`: encrypted to the Owner's age public key. The private key is offline with
   the Owner; CI holds only the public one.
4. Upload to `maxoff-backups-production` as `postgres/<ref>/<UTC stamp>.tar.age` with curl's SigV4, then
   a listing proves the object is there. The nightly run then prunes objects older than 30 days; the
   bucket's lifecycle rule (31 days) is the primary retention. Pruning has a floor: the script refuses a
   retention below 7 days and never deletes the object it has just uploaded, and "Run workflow" passes
   its `retention_days` through unchanged (blank: prune nothing).

A red run is a missing night: Actions → Backup shows it, and the monthly usage-check issue asks whether
every night was green.

## Restore

Only ever into a **fresh** database: a new Supabase project (a real recovery) or a throwaway container
(a drill). Never into the live production database.

Needs on the machine: `age` (with the private key file), Docker (for a Postgres 17 client: the host's
`pg_restore` must not be older than the server), `curl`, `python3`, and the R2 token of the backup bucket.
Run from the repository root, line by line:

```bash
# 0. One absolute directory for the backup. The scripts take it as given (they never change
#    directory) and Docker mounts the same path, so the two always agree.
export RESTORE_DIR="$HOME/maxoff-restore-$(date +%F)"

# 1. Download and decrypt the latest backup (or pass an object key as the second argument).
export BACKUP_S3_ENDPOINT=https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com
export BACKUP_S3_BUCKET=maxoff-backups-production
export BACKUP_S3_ACCESS_KEY_ID=…  BACKUP_S3_SECRET_ACCESS_KEY=…     # the backup bucket's token
export BACKUP_PREFIX=postgres/peshoflxypujbzecgwqq
export BACKUP_AGE_IDENTITY=/path/to/maxoff-backup.key             # the Owner's private key
bash scripts/backup/fetch.sh "$RESTORE_DIR"

# 2. Restore into the fresh target and verify it. The target is the NEW project's session pooler
#    (Supabase → Connect → Session pooler; IPv4): user postgres.<new ref>, port 5432. The password
#    never goes on a command line (a shell history and `ps` would keep it): read it into PGPASSWORD
#    and hand the variable to the client containers, as backup.yml does. restore.sh passes the
#    key=value target string to pg_restore --dbname and psql unchanged.
read -rs -p "Database password: " PGPASSWORD; echo; export PGPASSWORD
export PG_RESTORE="docker run --rm --network host -e PGPASSWORD -v $RESTORE_DIR:/drill postgres:17 pg_restore"
export PSQL="docker run --rm -i --network host -e PGPASSWORD postgres:17 psql"
export RESTORE_DUMP_PATH=/drill/db.dump
AUTH_MODE=data bash scripts/backup/restore.sh "$RESTORE_DIR" \
  "host=<pooler host> port=5432 user=postgres.<new ref> dbname=postgres sslmode=require"
unset PGPASSWORD
```

```sql
-- 3. The pg_cron jobs, in the new project's SQL editor. restore.sh's last WARNING names the two
--    cron.schedule calls: the cron schema is never dumped, and the restored migration history
--    means the next `db push` re-runs nothing, so the migrations' calls are re-run here by hand.
--    (The three extension lines are the ones of supabase/migrations/20260921151323_core_base.sql;
--    the schedules are those of 20260925010221_attendance_jobs.sql and 20260927184255_start_end_day.sql;
--    7A's two client-work jobs are those of 20261008143534_client_work_transitions.sql and
--    20261008145504_client_work_close_prompt.sql.)
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
create extension if not exists pg_net with schema extensions;
select cron.schedule('absent_check', '29 18 * * *', $$select app.absent_check()$$);
select cron.schedule('end_not_recorded', '30 18 * * *', $$select app.end_not_recorded()$$);
select cron.schedule('cycle_generate', '30 18 * * *', $$select app.cycle_generate()$$);
select cron.schedule('cycle_close_prompt', '35 18 * * *', $$select app.cycle_close_prompt()$$);
select jobname, schedule, command from cron.job order by jobname;   -- every row, active
```

`restore.sh` loads in three sections so no trigger fires during the load (and no superuser
`--disable-triggers` is needed, which a hosted project's `postgres` role cannot do): the schema
(pre-data), every row (data), then indexes, constraints, triggers and RLS policies (post-data). Then it
**verifies**: every row count in `public` and `auth` equals the manifest's, the migration list equals
the manifest's, and RLS still refuses (`anon` cannot read `members`; the `authenticated` role with no JWT
reads no expense claim). It stops at the first difference. Last, it compares the target's `cron.job` with
the manifest's jobs: a missing job is a **WARNING** naming the exact `cron.schedule` call (not a failure:
the restore of the dump is complete and correct, the jobs are the platform step above, and a drill
container has none at all), and the closing line then reads "restore verified, with 1 warning(s)" instead
of "restore verified". Read it.

- **A new Supabase project (a real recovery):** `AUTH_MODE=data`. GoTrue has already created the `auth`
  tables, their constraints and its own `auth.schema_migrations` in the new project, and `postgres` owns
  none of it, so only the rows of the auth tables are loaded (parents first, since GoTrue's foreign keys
  stand: `users` before `identities` and `sessions`, …; the order is read from the target's own
  constraints), their sequence values are set, and GoTrue's ledger is left alone (and left out of the
  row-count check); `public`, `app` and `supabase_migrations` come whole from the dump (the migration
  table too, so the next `db push` sees the same history). This mode is what `scripts/backup/drill.sh
  data` rehearses locally against a container given GoTrue's own migrations, as the non-superuser
  `postgres`. Then step 3 above, then point `production`'s `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_PROJECT_REF` and
  `SUPABASE_DB_PASSWORD` at it, apply README → "Hosted auth settings" (Site URL, SMTP, the recovery
  template), tag a deploy, and re-point the `backup` environment.
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
bash scripts/backup/drill.sh          # both modes; or `schema` / `data` for one
```

It generates a throwaway age key pair, dumps the local database, encrypts and uploads to MinIO, downloads
and decrypts, then restores twice, each time into a fresh container of the stack's own image
(`supabase/postgres:17.x`): **schema** mode into the bare container as `supabase_admin`, and **data**
mode (a real recovery's) into a container first given GoTrue's own migrations by the stack's `gotrue`
image and pg_cron, as the non-superuser `postgres`. Each run verifies, and the cron-jobs WARNING names the
two `cron.schedule` calls (the container has no jobs, as a new project has none). It removes the
containers, the temp files and the object. About a minute.

**Production, once after the first production deploy (3c.3) and then every quarter:** the "Restore"
steps above against the latest production backup into a **throwaway** target (a fresh local container
of the `supabase/postgres` image, `AUTH_MODE=schema`, or a scratch Supabase project, `AUTH_MODE=data`),
read the three "verified" lines **and the pg_cron WARNING**: a throwaway target has no `cron.job` rows, so
the run ends with the WARNING naming the two `cron.schedule` calls and the closing line "restore verified,
with 1 warning(s)". That is the expected outcome, not a failure; a run with no warning line at all, or with
any line other than that one, is what to look into. Then delete the target. Write the date and the numbers
into the table below.

## Drills done

| Date | Where | Backup | Result |
|---|---|---|---|
| 2026-09-28 | Local stack → MinIO → fresh `supabase/postgres:17.6.1.167` container (`scripts/backup/drill.sh`, unit 3cA) | `drill/…/20260928T133637Z.tar.age` (727 KB) | Verified: 46 tables' row counts equal, 34 migrations equal (last `20260928131234`), RLS refuses (anon on members; authenticated without a JWT: 0 claims) |
| 2026-09-28 | Local stack → MinIO → two fresh `supabase/postgres:17.6.1.167` containers (`scripts/backup/drill.sh both`, the 3cA review fixes) | `drill/…/20260928T163849Z.tar.age` (840 KB) | **schema** as `supabase_admin`: 46 tables equal, 34 migrations, RLS refuses. **data** (23 auth tables, 77 GoTrue migrations, pg_cron) as `postgres`: 45 tables equal (`auth.schema_migrations` is GoTrue's), 34 migrations, RLS refuses, WARNING naming the two `cron.schedule` calls. The first data-mode run failed on `identities_user_id_fkey` (rows loaded by name, identities before users); fixed by loading auth's rows parents-first. |
| 2026-09-30 | Production bucket → fresh local `supabase/postgres:17.6.1.166` container on the Owner's Windows laptop (Git Bash: `MSYS2_ARG_CONV_EXCL="/drill;--use-list="`, the dump folder mounted as `C:/…`, and `python3` output stripped of `
`) | `postgres/peshoflxypujbzecgwqq/20260929T234838Z.tar.age` (the first scheduled nightly) | **schema** as `supabase_admin`: 50 tables' row counts equal, 35 migrations equal (last `20260929020230`), RLS refuses (anon 0; authenticated without a JWT: 0 claims), the expected pg_cron WARNING naming the two `cron.schedule` calls; "restore verified, with 1 warning(s)". Next drill: by the end of December 2026. |

## Monthly usage check

On the 1st the Backup workflow opens a "Monthly Supabase usage check" issue. Open the production project's
**Usage** page and tick: transfer this month below **~4 GB** (free plan: 5 GB); database size below
**~400 MB** (free plan: 500 MB); every nightly backup green and about 30 objects in the bucket; UptimeRobot
up on `https://app.maxoff.in/api/health`; point-in-time recovery still not worth it. Above a threshold:
upgrade to Pro before the cap (ADR-0003).
