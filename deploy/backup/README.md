# Backups

Two recovery paths (plan T13): **logical** — a nightly `pg_dump` in restic, whole-database restore to last night —
and **physical / PITR** — a base backup plus continuous WAL, any point since. This folder holds the logical path.
The physical path changes the shared Postgres's `archive_command`, so it waits for Waleed's go-ahead on the server.

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
| `KEEP_DAILY`, `KEEP_WEEKLY`, `KEEP_MONTHLY` | retention, default 14 / 8 / 6 |

## Restore check

```sh
docker run --rm --network dokploy-network --env-file /opt/pospay-staging/backup.env pospay-backup:<sha> \
  restore-check.sh [snapshot-id]
```

Restores into a scratch database it names itself (`restore_check_<time>_<pid>`, refused if it exists), counts rows,
prints the time against the 2-hour RTO, and drops only that database. It never restores over the live one.
