# ADR-0062 — Production on the shared server: topology and point-in-time recovery

- **Status:** Proposed
- **Date:** 2026-11-23
- **Owner record:** Waleed's card answers of 2026-11-23 (~21:00 Kuwait) in the manager thread: production runs on the
  server that hosts staging, and «استرجاع لأي لحظة قبل الإطلاق» — point-in-time recovery exists before real data. The
  manager records them in `docs/owner-decisions.ar.md` (PP number is the manager's).
- **Supersedes in part:** PRD D-11 ("both move to a new server") and the wording of the launch gate in
  `docs/PRD.md:528-531` that ties PITR to a new server; Phase 1 plan row 63. The gate itself stays: no real sales data
  before a timed PITR restore passes.
- **Plan:** `docs/plans/2026-11-23-production-on-staging-server.md`.

## Context

The first customer (a salon) goes live on the existing Dokploy server. Staging uses the server's shared Postgres and
Redis. Production cannot join them: database roles are cluster-wide with fixed names and `migrate` resets their
passwords on every run (`packages/db/src/roles.ts:24-32`), and Redis keys carry no environment prefix. The shared
Postgres also cannot take WAL archiving without changing its `archive_command` for every project on the server
(`deploy/backup/README.md:5`). Measured capacity (manager, 2026-11-23): 4 CPUs, 15 GB RAM with 11 GB available,
159 GB disk free.

## Decision

### 1. Topology

- One Dokploy compose service `pospay-prod` in its own Dokploy project, from `deploy/docker-compose.prod.yml`.
- **Postgres 18 and Redis 8 run as containers inside that compose**, the same major versions as staging.
- Two networks: a private `pospay-prod-internal` for every service, and `dokploy-network` joined only by `api`,
  `admin` and `pos` so Traefik can route to them. Postgres, Redis, `worker` and `migrate` are not reachable from other
  projects.
- Postgres data, the WAL spool and Redis data are **bind-mounted host directories** under `/opt/pospay-prod/`, not
  named volumes, so a Docker volume clean-up cannot remove them.
- Limits. Memory: about 4.4 GB steady, 4.7 GB while `migrate` runs, under the 11 GB available. The `cpus` values
  are ceilings, not reservations; they add up to more than the 4 CPUs on purpose:

  | Service | `mem_limit` | `cpus` |
  |---|---|---|
  | postgres | 2g | 1.5 |
  | redis | 256m | 0.25 |
  | api | 512m | 1.0 |
  | worker | 1g | 1.0 |
  | admin | 512m | 0.5 |
  | pos | 128m | 0.25 |
  | migrate (one-shot) | 256m | 0.5 |

- Hosts stay `api.` / `app.` / `pos.pospay.systems` (ADR-0001 §1), as Dokploy domains.
- Staging keeps its file and its shared Postgres and Redis; nothing in staging changes except CPU limits.

### 2. Recovery tool: pgBackRest

| | pgBackRest | WAL-G |
|---|---|---|
| Install in a `postgres:18` (Debian) image | `apt-get install pgbackrest` from the PGDG repository the image already uses | a binary downloaded from GitHub releases, pinned and checksummed by us |
| S3-compatible store (R2) | built in (`repo1-type=s3`, custom endpoint, path-style URI) | built in |
| Encryption at rest | built in (`repo1-cipher-type=aes-256-cbc`) | built in (libsodium / PGP) |
| Retention | declarative (`repo1-retention-full`), expires WAL with the backups | `delete retain`, run and scripted by us |
| Restore to a time | one command: `restore --type=time --target=…`, writes the recovery settings itself | `backup-fetch`, then `restore_command` and the recovery target written by hand |
| Integrity | page checksums on backup, `verify` and `check` commands | `wal-verify` |
| Already named in our docs | yes — the drill in `docs/PRD.md:529` is written for it | named as the alternative |

**Chosen: pgBackRest.** It is the smaller amount of our own scripting: retention, WAL expiry, the restore command and
the archive check are built in, and it installs from the package repository the Postgres image already trusts. WAL-G
stays the fallback if the drill (section 5) shows pgBackRest cannot work against R2.

Not verified here, and to be proven by the PR-A build and the drill: that the packaged pgBackRest version supports
Postgres 18, and that it works against R2's S3 API.

### 3. Configuration

- A new image `pospay-postgres` (`deploy/Dockerfile.postgres`): `postgres:18` plus `pgbackrest`. The production compose
  pins it to an explicit SHA of its own; it does **not** follow `IMAGE_TAG`, so an application release never restarts
  the database.
- Postgres: `archive_mode=on`, `archive_command='pgbackrest --stanza=pospay-prod archive-push %p'`,
  `archive_timeout=60`, `wal_level=replica`, data checksums on at `initdb`.
- pgBackRest: one stanza `pospay-prod`; repository = an R2 bucket used for nothing else; `compress-type=zst`;
  `archive-async=y` with a local spool; encryption on. Every credential arrives as a `PGBACKREST_*` environment
  variable from Dokploy; nothing is written into the image or the repo.
- Schedule (host cron, `docker exec` into the Postgres container, each run pinging Healthchecks):
  full backup weekly (Friday 02:00 Kuwait), differential backup daily (02:00 Kuwait), WAL continuously, and
  `pgbackrest check` every 15 minutes with its own Healthchecks check, so a stalled or dropped archive alerts
  within the hour.
- Retention: `repo1-retention-full=2` — two full backups with their differentials and WAL, a recovery window of 7 to
  14 days.
- **The nightly logical dump stays** (`deploy/backup/`, restic to R2) as an independent second path with its own
  bucket, password and Healthchecks check. It is the only path that survives a pgBackRest repository fault.

### 4. Recovery targets

- **RPO ≤ 5 minutes** for a loss of the server or the data directory: a WAL segment is closed at least every 60
  seconds while there is activity and pushed asynchronously. The logical dump alone gives 24 hours.
- **RTO ≤ 2 hours**, the existing target (`docs/PRD.md:528`), measured in the drill.
- Any point inside the retention window can be restored, to the second.
- Not covered: a loss of the R2 account, or of the repository encryption key. The key is kept by Waleed off the
  server; without it every backup is unreadable.

### 5. The restore drill — the launch gate

Before any real salon data, on the server, into a **scratch** Postgres container with its own empty data directory
(never over the live one):

1. Take a full backup; write a marker row; note the time `T1`; write a second marker row; force a WAL switch.
2. `pgbackrest --stanza=pospay-prod --type=time --target="T1" restore` into the scratch directory; start it.
3. Prove: the first marker exists, the second does not; `companies` and migration counts match the source at `T1`.
4. Point a throw-away `api` at the scratch database and run the write smoke test (record a service session, change
   its performers). ADR-0050 classes PITR as safe for the write seal: `system_identifier` and the XID history both
   survive (`docs/adr/0050-restore-stable-write-seal.md:55-58`). This step confirms it on the real restore.
   The opposite rule also holds and goes into the runbook: a **logical dump is never restored into a PITR-restored
   or otherwise copied cluster**, only into a freshly initialised one (`docs/runbook.md:61-69`).
5. Record: backup label, `T1`, restore start and end, total time against the 2-hour RTO, and the WAL gap at `T1`
   against the 5-minute RPO. Destroy the scratch container and directory.
6. `pgbackrest check` passes and Healthchecks shows the check-ins (archive check, backup, logical dump).

A failed step blocks go-live. The drill is repeated after every Postgres major upgrade and at least every quarter.

### 6. Cost on this server

- **RAM:** Postgres up to 2 GB, Redis up to 256 MB; a backup or restore adds a short-lived pgBackRest process inside
  the Postgres limit. The whole production stack is capped at about 4.7 GB.
- **Disk:** data directory (small for one salon; under 5 GB expected in the first year — an estimate), the WAL spool
  (capped by `archive-push-queue-max=4GB`; past the cap pgBackRest drops WAL rather than fill the disk, which
  **breaks the WAL chain** - nothing after the gap is recoverable until the next backup completes, so it must alert),
  and a scratch copy of the database during a drill. Well inside 159 GB.
- **R2:** two full backups plus differentials and compressed WAL. Idle minutes produce small compressed segments;
  the real figure is measured in the first week and reported. One bucket and one token for this, one for the dump.

## Consequences

- A new tool (pgBackRest) and a new image (`pospay-postgres`) enter the project; `CLAUDE.md` §10 gains the production
  topology line when PR-A merges.
- Production and staging share only the server, Docker, Traefik and the application images.
- Operator scripts (`create-user`, `platform-grant`, `seed`, `platform-commission-approval`) run from one more application image, `pospay-ops`, built from `deploy/Dockerfile.api` and tagged by SHA like the others; it is run with `docker run --rm` and is never a compose service; `seed` can also be run by hand from it, while the compose `seed` service keeps using `pospay-migrate` (PR-E; `docs/runbook.md`, «First-owner operator scripts»).
- One server remains a single point of failure for availability. Recovery to another machine is possible from R2
  alone (base backup + WAL + the key), which is what the drill proves.
- A Postgres image change is a deliberate, separate release with its own snapshot, never a side effect.
- The server gains a cron file for production; every server change needs Waleed's yes (PP-12.1).

## Alternatives considered

- **A second database in the shared Postgres:** impossible without renaming roles in 97 migrations and `roles.ts`.
- **A second Postgres created from the Dokploy UI:** works, but its configuration and image would live outside the
  repo, and WAL archiving would be configured by hand.
- **Logical dumps only, more often:** no restore to a chosen moment; rejected by the owner's answer.
- **WAL-G:** viable; more of the procedure would be our own scripts. Kept as the fallback.
