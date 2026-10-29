# Deploy runbook (staging)

Staging: https://staging.altrixs.com, one EC2 instance (Ubuntu 24.04, Node 22, pm2) in front
of RDS Postgres `altrixs-staging-postgres`. There is no SSH; all server access is through
SSM Session Manager / `aws ssm send-command`. Production is a separate codebase and is not
deployed from this runbook.

| What | Where |
|---|---|
| App folder | `/opt/altrixs/app` (owner `altrixs`, a git clone) |
| Settings | `/opt/altrixs/app/.env` (mode 600; `DATABASE_URL` uses DB user `altrixs_app`) |
| Process | pm2 process `altrixs-staging` (user `altrixs`, systemd `pm2-altrixs`) on `127.0.0.1:3000`, nginx in front |
| Uploads | `/var/lib/altrixs/uploads` (outside the web root) |
| Artifacts | `s3://altrixs-staging-artifacts-792233689095/source/` (objects expire after 30 days) |
| Cron jobs | `deploy/crontab.staging` (installed as `/etc/cron.d/` files) |

## 1. Before you deploy

On your machine, on the commit you mean to ship:

```bash
npx tsc --noEmit -p .
npm test
bash scripts/migrate.sh --status        # optional, against a local copy of the schema
```

CI (`.github/workflows/ci.yml`) runs the same checks plus `next build`.

Every new migration must be a new file `prisma/migrations/YYYYMMDD_<what>.sql` and must be
idempotent (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, guarded `DO $$` blocks). Never edit
a file that has already been applied: `migrate.sh` refuses to run when a recorded checksum
changes.

**Never run `prisma db push` against staging or production.** The schema has SQL-only
columns and tables that Prisma does not model; `db push` would drop them. (The `db:push` and
`db:setup` npm scripts were removed for this reason.)

## 2. Package the code

```bash
SHA=$(git rev-parse --short=7 HEAD)
git bundle create altrixs-$SHA.bundle HEAD --tags     # or <previous-deployed-sha>..HEAD
aws s3 cp altrixs-$SHA.bundle s3://altrixs-staging-artifacts-792233689095/source/ --profile altrixs
```

## 3. Deploy on the server (SSM)

Run as `altrixs` in `/opt/altrixs/app` (via `aws ssm send-command` with
`AWS-RunShellScript`, or an interactive Session Manager shell):

```bash
set -euo pipefail
cd /opt/altrixs/app
SHA=<sha>
PREV=$(git rev-parse --short=7 HEAD)                  # note it for rollback
aws s3 cp s3://altrixs-staging-artifacts-792233689095/source/altrixs-$SHA.bundle /tmp/
git fetch /tmp/altrixs-$SHA.bundle 'refs/heads/*:refs/remotes/bundle/*' --tags
git checkout --detach $SHA

npm ci
npx prisma generate

# Database: apply pending SQL migrations (reads DATABASE_URL from .env).
bash scripts/migrate.sh --status
bash scripts/migrate.sh

ALTRIXS_ENV=staging npx next build                    # about 15-18 minutes on t3.large
pm2 restart altrixs-staging --update-env
```

`migrate.sh` runs before the build so a failed migration stops the deploy while the old
build is still serving. Because migrations are additive, the old build keeps working against
the new schema during the build.

### First time only: baseline the ledger

Staging already has the files that were hand-applied before the ledger existed. Record those
without running them, once, then apply the rest normally:

```bash
# <last-file-on-staging> = the newest file already applied by hand (check the deploy notes).
bash scripts/migrate.sh --baseline --through <last-file-on-staging>.sql
bash scripts/migrate.sh --status     # files after it show PENDING
bash scripts/migrate.sh              # applies them (all are idempotent)
```

`--baseline` without `--through` records every file in the tree, so use it only when the
database really has all of them. A file recorded by mistake can be applied by hand
(`psql -1 -v ON_ERROR_STOP=1 -f <file>`); they are idempotent.

## 4. Verify

```bash
curl -fsS https://staging.altrixs.com/api/version   # commit must equal $SHA, env "staging"
curl -fsS https://staging.altrixs.com/api/health    # liveness: {"ok":true,...}
curl -fsS https://staging.altrixs.com/api/ready     # DB check: {"ok":true,"db":"ok",...}; 503 when the DB is unreachable
pm2 status altrixs-staging
pm2 logs altrixs-staging --lines 100 --nostream
```

Then sign in and open the dashboard, a client chart and the schedule.

## 5. Roll back

Code: go back to the previous commit and rebuild.

```bash
cd /opt/altrixs/app
git checkout --detach $PREV
npm ci && npx prisma generate
ALTRIXS_ENV=staging npx next build
pm2 restart altrixs-staging --update-env
curl -fsS https://staging.altrixs.com/api/version   # commit must equal $PREV
```

Database: migrations are forward-only and additive, so the previous build runs against the
newer schema and nothing needs to be undone. Do not delete ledger rows to "re-run" a file. If
a migration damaged data, restore from RDS point-in-time recovery (7-day window) or the AWS
Backup vault `altrixs-backup-vault` into a new instance, compare, and repair forward with a
new migration.

## Migration ledger reference

`scripts/migrate.sh` (also `npm run db:migrate`, `npm run db:migrate:status`):

- Creates `_altrixs_migrations(filename text primary key, checksum text, applied_at
  timestamptz default now(), applied_by text)` if missing.
- Applies every `prisma/migrations/*.sql` (and the legacy `*/migration.sql` folder) that is not
  recorded, in filename order.
- Each file runs in one transaction with its ledger row (`psql -1 -v ON_ERROR_STOP=1`). Files
  using `CREATE/DROP INDEX CONCURRENTLY`, `REINDEX CONCURRENTLY`, `VACUUM`, `ALTER SYSTEM` or
  their own `BEGIN`/`COMMIT` (or the marker comment `-- altrixs:no-transaction`) run outside a
  transaction; their ledger row is written only after the file succeeds, so such files must be
  safe to re-run.
- Records the sha256 (line endings normalized) and exits 1 if a recorded file changed.
- `--baseline` records all files as applied without running them. `--status` lists
  applied and pending files.
- `applied_by` is `user@host (git sha)`, or `MIGRATE_APPLIED_BY` if set.
- Prisma-only URL parameters (`schema`, `connection_limit`, ...) are stripped before the URL
  is handed to psql.
- Run one deploy at a time; the script does not lock against a second concurrent run.
