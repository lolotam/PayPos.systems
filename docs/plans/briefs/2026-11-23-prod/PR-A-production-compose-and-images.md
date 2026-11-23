# Brief PR-A — production compose, images and WAL archiving

Tier: **Heavy** (deploy change; needs Waleed's direct yes before merge). Read first: `docs/adr/0062-production-topology-and-point-in-time-recovery.md`,
`docs/plans/2026-11-23-production-on-staging-server.md`, `deploy/docker-compose.staging-shared.yml`,
`.github/workflows/ci.yml:452-535`, pipeline skill §6.

## Goal

Everything needed to deploy production on the shared server from files in the repo: production front-end images, a
Postgres image with pgBackRest, the production compose file and its env key list. No application code changes.

## Files — create

- `deploy/docker-compose.prod.yml` — `name: pospay-prod`. Services: `postgres`, `redis`, `migrate`, `seed`, `api`,
  `worker`, `admin`, `pos`. Copy the application services from the staging file, then:
  - images `pospay-admin-prod` and `pospay-pos-prod`; every application image keeps `${IMAGE_TAG:?}`;
  - `postgres` uses `pospay-postgres` pinned by a **literal SHA written in the file**, never `${IMAGE_TAG}`;
  - networks: `pospay-prod-internal` (all services) and external `dokploy-network` (only `api`, `admin`, `pos`);
  - bind mounts under `/opt/pospay-prod/` for Postgres data, the pgBackRest spool and Redis data;
  - `mem_limit` and `cpus` exactly as the table in ADR-0062 §1; `restart: unless-stopped`; a `healthcheck` on
    `postgres` (`pg_isready`) and `redis` (`redis-cli ping`); `migrate` waits for `postgres` healthy;
  - `seed`: one-shot, the `pospay-migrate` image, `command: ["node", "scripts/seed.ts"]`, after `migrate`
    succeeded; `api` and `worker` wait for it. It inserts the plan row and the access catalog
    (`packages/db/src/seed.ts:43-56`); confirm from that file that it is idempotent before relying on it;
  - host variables renamed: `API_HOST`, `ADMIN_HOST`, `POS_HOST`; `DB_HOST` and `REDIS_HOST` become the service
    names `postgres` and `redis`, not variables;
  - `TRUSTED_PROXY_CIDRS: ${TRUSTED_PROXY_CIDRS:?}` (required);
  - `STAFF_OTP_POS_ORIGIN` keeps its derivation from `POS_HOST`; `COOKIE_DOMAIN` default `.pospay.systems`;
  - **not copied:** `DEPLOY_ENV: staging`, `STAFF_NATIVE_ORIGINS`, any Traefik label;
  - Postgres settings from ADR-0062 §3 passed as `command:` flags; pgBackRest options as `PGBACKREST_*` variables.
- `deploy/Dockerfile.postgres` — `FROM postgres:18` (Debian), install `pgbackrest` from the PGDG repository already
  configured in that image, nothing else. Check the image's documented data path for version 18 before writing the
  mount. Fail the build if `pgbackrest version` does not list support for Postgres 18.
- `deploy/prod.env.example` — key names only, grouped as required / optional / by capability, no values. Include
  `POSTGRES_OWNER_PASSWORD`, `REDIS_PASSWORD`, the `PGBACKREST_REPO1_*` keys (endpoint, bucket, region, key, secret,
  cipher pass) and a header that says it is edited only in the Dokploy UI.
- `deploy/backup/README.md` — add a "Production" section: the pgBackRest cron lines (full weekly, differential daily,
  each with a Healthchecks ping), the production `backup.env` for the logical dump, and the drill of ADR-0062 §5 as
  copy-paste commands. Remove the sentence that the physical path waits for the server decision.

## Files — edit

- `.github/workflows/ci.yml` — in the image job: build `pospay-admin-prod` (`NEXT_PUBLIC_API_URL=https://api.pospay.systems`,
  `NEXT_PUBLIC_POS_URL=https://pos.pospay.systems`) and `pospay-pos-prod` (`VITE_API_URL=https://api.pospay.systems`)
  on `main` only, next to the staging variants; build `pospay-postgres`; add the three images to the inspect and
  push lists. Keep the two-process cap. Add `deploy/backup/` decoy coverage only if the new image copies from there.
- `deploy/docker-compose.staging-shared.yml` — add `cpus` to every service (api 1.0, worker 1.0, admin 0.5,
  pos 0.25, migrate 0.5) and nothing else.
- `CLAUDE.md` §10 — one sentence naming the production compose service and its own Postgres and Redis; add a
  changelog line. `docs/runbook.md` — a short "Production deploy" section pointing at pipeline §6 with the
  production file name.

## Do not touch

Application source under `apps/` and `packages/`; migrations; `deploy/docker-compose.staging.yml`; the staging
environment variable names; any workflow job other than the image job; `ci-gate`'s `needs`. No secret, IP address,
compose id or real host other than the three public names in any file. Do not run anything against the server.

## Tests and proofs

- `docker compose -f deploy/docker-compose.prod.yml config` succeeds with a throw-away env file that sets every
  required key, and fails naming the key when `TRUSTED_PROXY_CIDRS` or a password is missing.
- Local stack from that file on a developer machine (Docker): `migrate` and `seed` exit 0, `api` `/ready` 200,
  worker `/ready` 200 from inside its container.
- Local WAL proof with a local S3 stand-in (the repo already allows a Garage container for offline work): `pgbackrest
  check` passes, one full backup, one `restore --type=time` into a scratch directory, marker row present.
- CI: the image job is green and lists the three new images.
- A grep proves no `staging` literal remains in `docker-compose.prod.yml`.

## Local gates

`pnpm lint:docs`, `pnpm module-map:check` (unchanged, must still pass), the two compose `config` checks above.
The full `pnpm check` and the image job are decided by `ci-gate` on the exact head.

## Size estimate

About 420 lines: compose 190, Dockerfile 20, env example 70, CI 30, README 80, docs 30. Cap 840 (2× the estimate).

## Report

Branch, head SHA, the output of the two compose checks, the local restore proof (times), image names, and anything
in ADR-0062 that turned out not to hold (pgBackRest version for 18, R2 behaviour) — stop and report rather than
switch tools.
