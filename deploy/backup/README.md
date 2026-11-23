# Backups

Two recovery paths (plan T13): **logical** — a nightly `pg_dump` in restic, whole-database restore to last night —
and **physical / PITR** — a base backup plus continuous WAL, any point since. This folder holds the logical path
files; the physical path runs inside the production Postgres image with pgBackRest (see Production below).

## Logical backup

Image: `deploy/Dockerfile.backup` (`pg_dump` of the server's major version + `restic`). Run once a night from the
host's cron, on the network that reaches Postgres:

```sh
docker run --rm --network dokploy-network --env-file /opt/pospay-staging/backup.env pospay-backup:<sha>
```

On staging this is `/etc/cron.d/pospay-backup`, 23:00 UTC (02:00 Kuwait), appending to a mode-600 log:

```cron
0 23 * * * root docker run --rm --network dokploy-network --env-file /opt/pospay-staging/backup.env pospay-backup:<sha> >> /var/log/pospay-backup.log 2>&1
```

`/etc/logrotate.d/pospay-backup` rotates that log monthly, keeps 6, and recreates it `0600 root root` (`su root syslog`,
because Ubuntu's `/var/log` is group-writable). The tested run's log contained none of the password or key values
checked from `backup.env`; the redirect captures every line the container and Docker print, so keep it `0600`.

`backup.env` lives on the server only (mode 600, never in Git) and sets:

| Variable | Meaning |
|---|---|
| `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` | the database and the migration owner (FORCE RLS hides rows from anyone else) |
| `RESTIC_REPOSITORY` | `s3:https://<account-id>.r2.cloudflarestorage.com/<bucket>` |
| `RESTIC_PASSWORD` | encrypts every snapshot; lose it and every backup is lost with it — keep a copy off the server |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | an R2 API token scoped to that one bucket |
| `HEALTHCHECK_URL` | the Healthchecks.io ping URL; a missed or failed check-in alerts |
| `BACKUP_HOST` | the snapshot series name, default `pospay-<PGDATABASE>`; retention only prunes within one series |
| `KEEP_LAST`, `KEEP_DAILY`, `KEEP_WEEKLY`, `KEEP_MONTHLY` | retention, default 7 / 14 / 8 / 6: the 7 most recent snapshots in total, whatever their day (so the pre-merge backups of a busy day are not pruned down to one, PP-110.2 and PP-110.3), plus one per day, week and month; restic keeps the union |

## Restore check

```sh
docker run --rm --network dokploy-network --env-file /opt/pospay-staging/backup.env pospay-backup:<sha> \
  restore-check.sh [snapshot-id]
```

Restores into a scratch database it names itself (`restore_check_<time>_<pid>`, refused if it exists), counts rows,
prints the time against the 2-hour RTO, and drops only that database. It never restores over the live one.

## Production — PITR with pgBackRest (ADR-0062)

The production Postgres runs in the `pospay-prod` compose (`deploy/docker-compose.prod.yml`) from the
`pospay-postgres` image: `postgres:18` plus pgBackRest, stanza `pospay-prod`, repository in its own R2 bucket,
`archive-async` with a spool under `/opt/pospay-prod/spool/`, encrypted with the cipher pass Waleed keeps off the
server (ADR-0062 §2-3). The container name is `pospay-prod-postgres-1`; pgBackRest refuses root, so every command
below runs `-u postgres`. Schedule (host cron, ADR-0062 §3): full backup weekly Friday 02:00 Kuwait = Thursday
23:00 UTC, differential daily at 02:00 Kuwait = 23:00 UTC except the full day, `pgbackrest check` every 15 minutes —
each pinging its own Healthchecks check, so a stalled archive alerts within the hour. `/etc/cron.d/pospay-backup-prod`:

```cron
0 23 * * 4   root  docker exec -u postgres pospay-prod-postgres-1 pgbackrest --stanza=pospay-prod backup --type=full      && curl -fsS -m 10 <full-hc-url> || curl -fsS -m 10 <full-hc-url>/fail
0 23 * * 0-3,5-6 root docker exec -u postgres pospay-prod-postgres-1 pgbackrest --stanza=pospay-prod backup --type=diff && curl -fsS -m 10 <diff-hc-url> || curl -fsS -m 10 <diff-hc-url>/fail
*/15 * * * * root  docker exec -u postgres pospay-prod-postgres-1 pgbackrest --stanza=pospay-prod check                 && curl -fsS -m 10 <check-hc-url> || curl -fsS -m 10 <check-hc-url>/fail
```

### First-deploy setup

```sh
install -d -o 999 -g 999 /opt/pospay-prod/postgres /opt/pospay-prod/spool /opt/pospay-prod/redis
# once, after the first `pospay-prod` deploy (the stanza must exist before the first backup):
docker exec -u postgres pospay-prod-postgres-1 pgbackrest --stanza=pospay-prod stanza-create
```

### The nightly logical dump stays as the second path

Same image and script as staging, on the production network, with its own bucket, password and Healthchecks check
(ADR-0062 §3). `/opt/pospay-prod/backup.env` (mode 600, server only) has the same keys as the staging one with
`PGHOST=postgres` — the compose service name on `pospay-prod-internal`. 22:00 UTC (01:00 Kuwait), one hour ahead of
the pgBackRest window:

```cron
0 22 * * * root docker run --rm --network pospay-prod-internal --env-file /opt/pospay-prod/backup.env pospay-backup:<sha> >> /var/log/pospay-backup-prod.log 2>&1 && curl -fsS -m 10 <dump-hc-url> || curl -fsS -m 10 <dump-hc-url>/fail
```

### The restore drill — the launch gate (ADR-0062 §5)

Before any real data, on the server, into a scratch directory — never over the live one. One-time: write the
`PGBACKREST_REPO1_*` values into `/opt/pospay-prod/pgbackrest-drill.env` (mode 600). `T1` is the chosen recovery
target; `<sha>` is the pinned `pospay-postgres` SHA:

```sh
install -d -o 999 -g 999 /opt/pospay-drill
docker run --rm -d --name pospay-pitr-drill --env-file /opt/pospay-prod/pgbackrest-drill.env \
  -v /opt/pospay-drill:/var/lib/postgresql "ghcr.io/lolotam/pospay-postgres:<sha>" sleep infinity
# 1. full backup; a marker row; note the time T1; a second marker row; force a WAL switch:
docker exec -u postgres pospay-prod-postgres-1 pgbackrest --stanza=pospay-prod backup --type=full
docker exec pospay-prod-postgres-1 psql -U pospay_owner -d pospay \
  -c "CREATE TABLE pitr_drill_marker (at timestamptz PRIMARY KEY, label text)" \
  -c "INSERT INTO pitr_drill_marker VALUES (now(), 'kept')"
T1="$(date -u -d '+1 second' '+%Y-%m-%d %H:%M:%S')"; sleep 2   # T1 lands between the two markers
docker exec pospay-prod-postgres-1 psql -U pospay_owner -d pospay \
  -c "INSERT INTO pitr_drill_marker VALUES (now(), 'refused')"
docker exec pospay-prod-postgres-1 psql -U pospay_owner -c 'select pg_switch_wal()'
# 2. restore to T1 into the scratch directory and start a scratch Postgres on it:
docker exec -u postgres pospay-pitr-drill \
  pgbackrest --stanza=pospay-prod --pg1-path=/var/lib/postgresql/18/docker \
  --type=time --target="$T1" --target-action=promote restore
docker stop pospay-pitr-drill
docker run --rm -d --name pospay-pitr-drill -v /opt/pospay-drill:/var/lib/postgresql "ghcr.io/lolotam/pospay-postgres:<sha>"
# 3. prove: 'kept' present, 'refused' absent; companies and migration counts match the source at T1.
docker exec pospay-pitr-drill psql -U pospay_owner -d pospay -c 'select * from pitr_drill_marker'
# 4. write smoke: point a throw-away api at the scratch database and run the write smoke test of ADR-0062 §5 step 4.
# 5. record backup label, T1, restore start/end, total time against the 2-hour RTO and the WAL gap at T1, then:
docker rm -f pospay-pitr-drill && rm -rf /opt/pospay-drill
# 6. pgbackrest check passes and Healthchecks shows the archive-check, backup and logical-dump check-ins.
```

A failed step blocks go-live; repeat after every Postgres major upgrade and at least every quarter. A logical dump
is **never** restored into a PITR-restored or otherwise copied cluster — only into a freshly initialised one
(`docs/runbook.md`, Restoring a logical dump).
