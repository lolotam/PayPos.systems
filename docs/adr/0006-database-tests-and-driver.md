# ADR-0006 — Database tests, driver and migration naming

- **Status:** Accepted
- **Date:** 2026-09-23
- **Slice:** Phase 0 · T4 — `packages/db`
- **Decided by:** Waleed (2026-09-23), on an independent advisor review

## Context

T4 is the first package whose tests need a real PostgreSQL. `CLAUDE.md` §9, the constitution, the PRD and
the Phase 0 plan all said "testcontainers". T4 also has to choose a Postgres driver under Drizzle (`06` §1
fixes Drizzle, not the driver) and a naming scheme for migration files.

## Decision

### 1. One Postgres, isolation per database — no testcontainers

The only Postgres is the T2 compose stack (`deploy/docker-compose.dev.yml`), locally **and in CI**.

- Vitest `globalSetup` connects as `pospay_owner` to the maintenance database `postgres`, bootstraps the
  roles, creates a template `pospay_tpl_<runId>` and runs every migration on it once per run.
- Each spec file clones its own `pospay_test_<runId>_<hex>` from the template (`CREATE DATABASE … TEMPLATE`)
  and drops it afterwards. Tests run as `pospay_app`; the owner connection is for setup only.
- Leftover `pospay_test_*` / `pospay_tpl_*` databases with no open connection are swept at the start of a run.
  The helpers never create or drop a name without those prefixes.
- A test never starts Docker. If Postgres is unreachable it fails with "run `pnpm infra:up`".
- CI writes a throwaway `.env` with random passwords and runs `pnpm infra:up` before `pnpm check`. It does not
  use `services: postgres`, because that cannot pass the `statement_timeout` / `lock_timeout` flags the compose
  file sets — CI would run a differently configured Postgres than dev and staging.

**Why not testcontainers.** Fresh schemas, parallel workers and running as `pospay_app` are database-level
work needed under either option. testcontainers would only replace `pnpm infra:up`, at the cost of a new
library, Ryuk / named-pipe friction on Docker Desktop for Windows, and a cold container for every package's
`vitest run` inside one `pnpm check`.

**Trade-off accepted.** The cluster is shared and stateful: roles are cluster-global and a crashed run can
leave databases behind. `bootstrapRoles` is idempotent and re-applies every role attribute on each run, and
the sweep removes leftovers.

### 2. Driver: postgres.js

`postgres` 3.4.9 through `drizzle-orm/postgres-js`. `06` makes performance the first priority; postgres.js is
the faster of the two drivers Drizzle supports, is ESM-native, and needs no native build. `drizzle-orm` 0.45.2 and
`drizzle-kit` 0.31.10 are pinned one release back: 0.45.3 / 0.31.11 were two days old and inside pnpm's
minimum release age.

### 3. Migration files: `<NNNN>_<YYYY-MM-DD>_<name>.sql`

`pnpm db:generate <kebab-name> [--custom]` wraps `drizzle-kit generate` and adds today's **UTC** date, for
example `0000_2026-09-22_context-helpers.sql`. drizzle-kit owns the sequence number (it starts at `0000`);
renaming its files by hand would desynchronise `meta/_journal.json`. Migration files are committed and never
edited after they are merged (expand/contract, `CLAUDE.md` §10).

### 4. Roles bootstrap before migrations

`pnpm db:migrate` runs `bootstrapRoles` as `pospay_owner` first — it creates `pospay_app` and `pospay_auth` if
missing and always re-applies `LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION`
and the password from env — then the Drizzle migrations. Roles are cluster-global, so they cannot live in a
per-database migration; grants can, and do.

## Consequences

- `pnpm check` needs Docker running and `pnpm infra:up` done. `.env` needs `POSTGRES_APP_PASSWORD` and
  `POSTGRES_AUTH_PASSWORD` (at least 16 characters).
- "testcontainers" is replaced in `CLAUDE.md` §9, the constitution (2.0.1), the PRD, `SPEC.md`, the Phase 0
  plan and ADR-0004.
- `IdGenerator` is an interface injected into `createDatabase`; its UUID v7 implementation lands with the
  other ports in T7 (PRD P0-T4.5).
- `scripts/seed.ts` from the plan is not created: nothing needs seeding before T5 (`plans`). It arrives with
  its first data rather than as an empty file.
- The container's `pospay_owner` is the image's bootstrap superuser and therefore has `BYPASSRLS`. It never
  runs application code (ADR-0003 §3). T5's "no role has BYPASSRLS" assertion must scope itself to the
  application roles, or T5 must replace the bootstrap owner with a non-superuser — decided in T5.
