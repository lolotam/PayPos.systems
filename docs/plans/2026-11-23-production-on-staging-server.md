# Production on the staging server — plan (2026-11-23)

Planning only. Read against `origin/main@dc5b78786`. Nothing was run on the server, in Dokploy or against a database.
**Not verified** anywhere below: server RAM/CPU/disk, the live Dokploy environment values, the shared Postgres
`max_connections`, Dokploy's cleanup schedule, and the row status in `roadmap.json` (it lives in `lolotam/plan`).

Owner direction (Waleed, 2026-11-23): reach production fast for the first customer (a salon); no new server; production
runs on the server that hosts staging. This **reverses recorded decisions** (section 5, T1) and must be recorded first.

## 1. Target shape

A second Dokploy compose service, `pospay-prod`, in its own Dokploy project, from a new `deploy/docker-compose.prod.yml`.
Hosts follow ADR-0001 §1: `api.pospay.systems`, `app.pospay.systems`, `pos.pospay.systems`, set as Dokploy domains
(no Traefik labels in the file, as on staging).

**Postgres and Redis are containers inside the production compose, on a private network.** This is forced by the code,
not a preference:

- Database roles are cluster-wide and their names are fixed. `packages/db/src/roles.ts:24-32` creates `pospay_app`,
  `pospay_auth`, `pospay_dispatcher` and resets their passwords on every migrate; 97 migration files grant to those
  names. A second database inside the shared Postgres would share the three roles and passwords with staging, and each
  environment's migrate would overwrite the other's passwords.
- Redis keys have no environment prefix: the queues use BullMQ's default (`apps/worker/src/modules/customers/jobs/
  rating-claims.registration.ts:89`) and `REDIS_URL` carries no database index
  (`deploy/docker-compose.staging-shared.yml:24`). The pipeline skill §6 already warns that two stacks on one Redis share
  the queues.

| Item | Production | Shared with staging? |
|---|---|---|
| Server, Docker, Dokploy, Traefik + Let's Encrypt | same | **shared** |
| GHCR images `api`, `worker`, `migrate`, `backup` (by SHA) | same images | **shared** |
| `admin` and `pos` images | new `-prod` variants (section 2) | never: the API origin is baked in |
| Postgres (data, roles, passwords, owner) | own container + own data directory | **never** |
| Redis | own container + own password | **never** |
| R2 bucket and its API token | own bucket, token scoped to it | **never** |
| `BETTER_AUTH_SECRET`, OTP / rating / notification hash keys, VAPID keys | new values | **never** |
| WhatsApp number, WABA, tokens; email sender | own, or off (section 4) | **never** |
| Backup: restic repository, password, series name, Healthchecks check, cron line | own | **never** |
| `dokploy-network` | only `api`, `admin`, `pos` join it, for Traefik | shared (routing only) |
| Demo data, seed scripts, `staging:staff-user` | not present | **never** |

Never carried into the production file: `DEPLOY_ENV: staging` and `STAFF_NATIVE_ORIGINS`
(`deploy/docker-compose.staging-shared.yml:73,75`). `apps/api/scripts/staging-staff-guard.ts:32` refuses to run without
that marker, so leaving it out keeps the staging-only operator script unusable on production.

**Risks of one server, cheapest mitigation each**

| Risk | Mitigation |
|---|---|
| Staging and other projects eat RAM/CPU; the server dies and the salon stops | Keep `mem_limit` on every production service, add `cpus`; check free RAM and disk before go-live (Waleed or the manager, read-only). Capacity is not verified. |
| Disk fills (images, WAL, logs) | Healthchecks alert on the backup; a weekly disk check in the deploy receipt. |
| A staging migration or seed mistake reaches production data | Impossible by construction once Postgres and Redis are separate containers with different passwords. Rule: a SHA reaches production only after it ran on staging. |
| Other projects on `dokploy-network` reach the API port, DB or Redis | `worker`, `migrate`, Postgres and Redis sit only on the private network; only the three web services join `dokploy-network`. |
| A Dokploy volume clean-up deletes the database while the stack is stopped | Bind-mount the data directory to a host path instead of a named volume. Clean-up behaviour not verified. |
| The production session cookie is sent to staging hosts | `COOKIE_DOMAIN=.pospay.systems` (ADR-0001 §3) also matches `*.staging.pospay.systems`, and the cookie prefix is one fixed value (`packages/auth/src/config.ts:250`). Short term: never open staging in a browser profile that holds a production session. Proper fix: PR-B. |
| One server = one failure for app, database and (local) recovery | Off-server restic backup to R2 is the only recovery path; one restore test before go-live (step 9). RPO is one night until PITR exists (T2). |
| Wrong stack deployed by mistake | Separate Dokploy project and compose id; every production deploy needs Waleed's yes (`CLAUDE.md` owner override). |

## 2. What exists, what is missing

**Exists**

- Images built and pushed by CI on `main`: `.github/workflows/ci.yml:494-502` (`pospay-api`, `-migrate`, `-worker`,
  `-backup`, `-admin`, `-pos`, plus the `-staging` admin and POS variants).
- One-shot migrate step that creates the roles and runs before the apps: `deploy/Dockerfile.api:16-21`,
  `deploy/docker-compose.staging-shared.yml:54-65,100-102`.
- Healthchecks in every image (`deploy/Dockerfile.api:31`, `.worker:29`, `.admin:27`, `.pos:20`); `/health` and
  `/ready` (`apps/api/src/shared/health.controller.ts:23`); `mem_limit` and `restart` on every service.
- Rollback by uploading the previous SHA's pinned compose file (pipeline skill §6, steps 4–6 and "Restore").
- Logical backup and restore check: `deploy/backup/README.md`, `logical-backup.sh`, `restore-check.sh`,
  `deploy/Dockerfile.backup`.
- Operator scripts for the first user and grant: `platform:create-user` (`packages/auth/scripts/create-user.ts`),
  `platform:grant` (`packages/db/scripts/platform-grant.ts`); company creation `POST /v1/companies`
  (`apps/api/src/modules/identity/http/companies.controller.ts:19-20`).
- Env key list for staging: `deploy/staging.env.example`.

**Missing**

- `deploy/docker-compose.prod.yml` — does not exist. `deploy/docker-compose.staging.yml` is a second staging file, not the
  one Dokploy runs (pipeline skill §6 names `docker-compose.staging-shared.yml`).
- Production front-end images. The plain `pospay-admin` and `pospay-pos` images bake **no API origin**
  (`ci.yml:498-499`), and both apps throw without one (`apps/admin/src/shared/api/origin.ts:3`,
  `apps/pos/src/shared/api/origin.ts:3`). They cannot serve production as built.
- A production env example (`deploy/prod.env.example`).
- Production backup: its own `backup.env`, restic repository and cron line. The standing yes for the cron line
  (PP-12.2) covers the staging line only.
- Point-in-time recovery: not built. `deploy/backup/README.md:5` leaves it waiting for the server decision.
- `docs/security.md` and `docs/domain-model.md` are named in `CLAUDE.md` but are not in the repo.
- No runbook section for creating a company on a live environment (`docs/runbook.md` has none; how staging's company
  was made is not written down).
- No screen in `apps/admin` calls `POST /v1/companies`, and no `set-password` route was found there by search, while
  `create-user.ts:35` points the one-time link at `<origin>/set-password`. **To be tested on staging before go-live.**

## 3. Go-live checklist (in order)

Who: **W** = Waleed (Dokploy UI, DNS, secrets, accounts), **M** = the manager, **PR** = a code or docs PR.

1. **W** — answer section 5 (T1 first). **PR-0 (docs):** record the decision in `docs/owner-decisions.ar.md` and
   update the lines it reverses: `docs/PRD.md:528-531,957,1019`, Phase 1 plan row 63,
   `deploy/docker-compose.staging-shared.yml:16`, `deploy/backup/README.md:5`.
2. **PR-A (the smallest code PR; a deploy change, so it needs Waleed's direct yes):** (a) `ci.yml` builds
   `pospay-admin-prod` and `pospay-pos-prod` on `main` with `https://api.pospay.systems` and
   `https://pos.pospay.systems`; (b) `deploy/docker-compose.prod.yml` with Postgres and Redis containers, the private
   network, `cpus` limits, no staging markers; (c) `deploy/prod.env.example`.
3. **PR-B (small, optional before go-live):** cookie prefix from the environment, so staging and production cookies
   differ.
4. **W** — DNS: A records for `api`, `app`, `pos` under `pospay.systems`, DNS-only (ADR-0001 §5).
5. **W** — Cloudflare: R2 bucket for production files, a second bucket (or prefix) for backups, one token per bucket.
6. **W** — create the Dokploy project and compose service `pospay-prod`; add the three domains (api → `api`:3000,
   app → `admin`:3000, pos → `pos`:8080, HTTPS); enter the environment. Key **names** only:
   - required: `API_HOST`, `ADMIN_HOST`, `POS_HOST`, `COOKIE_DOMAIN`, `POSTGRES_OWNER_PASSWORD`,
     `MIGRATION_DATABASE_URL`, `POSTGRES_APP_PASSWORD`, `POSTGRES_AUTH_PASSWORD`, `POSTGRES_DISPATCHER_PASSWORD`,
     `REDIS_PASSWORD`, `BETTER_AUTH_SECRET`, `TRUSTED_PROXY_CIDRS`, `STORAGE_ENDPOINT`, `STORAGE_BUCKET`,
     `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`;
   - optional with defaults: `REGISTRY`, `LOG_LEVEL`, `DATABASE_POOL_MAX`, `STORAGE_REGION`, `AUTH_TRUSTED_ORIGINS`,
     `STAFF_OTP_POS_ORIGIN` (derived from `POS_HOST`);
   - by launch scope (section 4): `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`, `VAPID_PRIVATE_KEY`; the `STAFF_OTP_*`,
     `WHATSAPP_*`, `NOTIFICATION_*`, `POSTGRES_NOTIFICATIONS_PASSWORD`, `PLATFORM_NOTIFICATIONS_DATABASE_URL`,
     `NOTIFICATIONS_MODE` group; `RATING_TOKEN_DERIVATION_*`, `RATING_PAGE_ORIGIN`; `RESEND_API_KEY`, `EMAIL_*`.
   The first three host names are new names for the production file; staging's are `STAGING_HOST`,
   `ADMIN_STAGING_HOST`, `POS_STAGING_HOST`. Every secret is generated fresh; none is copied from staging.
7. **M** — first deploy: take the SHA that is live and healthy on staging, pin it in `docker-compose.prod.yml`
   (pipeline §6 step 4), `compose.update`, `compose.deploy`. `migrate` creates the roles and the schema on the empty
   database and must exit 0. Prove: API `/ready` 200, worker `/ready` 200 from inside its container, both front ends
   200, valid certificates on the three hosts.
8. **M** — one-click rollback proof, before any real data: deploy the previous staging-proven SHA with its pinned file,
   confirm `/ready`, deploy the current SHA again. Record both deployment ids in the receipt.
9. **W + M** — backup and one restore test. W creates `/opt/pospay-prod/backup.env` (mode 600) and approves the new
   cron line; M runs one backup, then `restore-check.sh` on that snapshot, and records the snapshot id and time against
   the 2-hour RTO. Note: `docs/runbook.md:61-69` says a real restore goes only into a freshly initialised cluster.
10. **W + M** — first company and owner. As designed (ADR-0003 §3; `docs/PRD.md:979`, D-34):
    a. `platform:create-user --email … --name … --operator …` as `pospay_auth` prints a one-time set-password link
       (valid 1 hour, printed once — `create-user.ts:66-68`);
    b. `platform:grant --email … --permission create:companies:platform --operator … [--expires …]` as the migration
       owner;
    c. that user signs in and calls `POST /v1/companies` with an `Idempotency-Key`. **The caller becomes the company's
       first owner** (`use-cases/onboard-company/onboard-company.ts:9`), through `withNewTenant`
       (`persistence/onboarding-transactions.ts:43`). There is no other way to create a tenant.
    d. revoke the grant (`--revoke`) unless it expired.
    Whether the scripts run from an existing image or from a checkout on an operator machine is **not verified**; decide
    it on staging first (B2). Who the first owner is: question P3.
11. **M + salon** — businesses, branches, employees, services, package types and customers, by the admin screens and
    the workbook imports (rows 11, 32b, 34b, 47).
12. **W + salon** — device pairing: a manager issues a pairing code for the branch, the reception device registers
    and claims it, the manager approves (`apps/api/src/modules/identity/http/devices.controller.ts:77,90,115,133`).
    Then one staff PIN sign-in on the paired device.
13. **M** — smoke test on production, with a throw-away company that is then left unused (nothing financial is ever
    deleted): owner login + TOTP; create an employee; pair a device; staff PIN sign-in; clock in and out; record a
    service session with a discount and a tip; sell and redeem a package; upload one employee document and download it;
    render one attendance statement PDF; read the commission estimate; confirm a second company sees none of it.
14. **W** — go / no-go. From then on: every production deploy is a pinned compose upload of a SHA already proven on
    staging, with a fresh snapshot right before any migration (PP-129 applied to production) and Waleed's yes.

## 4. Launch scope

What the code is today: backend modules `catalog`, `commissions`, `customers`, `files`, `identity`, `notifications`,
`orders`, `settings`, `staff`, `tenancy` (`apps/api/src/modules/`). There is **no** `payments`, `cash`, `inventory`
or `appointments` module and no `packages/payments`. `orders` records service sessions, tips, discounts and packages;
it takes no payment. So day one is **staff, attendance, visits, packages and commissions — not a cashier with
payments**. No payment gateway account is needed for this launch.

Needed on day one (Phase 1 plan rows; each appears in merged commit subjects, completeness per row not verified):

- Login, TOTP, permissions, device pairing, staff PIN sign-in (rows 2, 3, 7).
- Employees, salaries, schedules, leave, documents (8–18).
- Attendance by QR / passkey / card, board and monthly report, statement PDF (19–27h).
- Services, package types, customers, service sessions, tips, discounts and approvals (32–41).
- Packages: sell, redeem, extend, refund, import open packages (42–47).
- Commission plans and the live estimate (48–50).

Can wait until after launch:

- The rest of the commission statement chain (generate, review, approve, paid, export, reminders: rows 51–56b). The
  first month-end is weeks after go-live. Merged so far by subject: 51-1 parts 1a-i/1a-ii, 53-1, 55-2c–2f, 56-1a/1b.
- Ratings (58–61), already postponed (Phase 1 plan row 63, RT-Q1 / PP-18.9); needs WhatsApp sending.
- Alert rules screen and email / WhatsApp team alerts (62, 62b); the new admin navigation (spec 074).
- Staff OTP by WhatsApp, the store apps (`apps/business`), `apps/menu`, PITR.

Unsure — questions: P1 (the dry-run week and parallel month of row 63, D-45), P2 (which messages must work on day
one), and whether the salon needs "my work" on staff phones (row 57) from the first day.

## 5. Open questions for Waleed

**Technical (Waleed only)**

- **T1. Recorded decisions say the pilot starts only on a new server with PITR** (D-11, `docs/PRD.md:528-531,1019`;
  Phase 1 plan row 63). (1) *Recommended:* supersede them for this first customer; the launch gate becomes a nightly
  off-server backup plus one proven restore, and PITR follows within a set number of weeks. (2) Keep the PITR gate and
  build PITR on the production Postgres container before real data. (3) Keep D-11 and wait for a new server.
- **T2. Acceptable data loss.** With a nightly dump a failure loses up to one day of visits and attendance. (1)
  *Recommended:* accept it for launch and add a second backup at midday; PITR after launch. (2) PITR before launch.
- **T3. Where the production database lives.** (1) *Recommended:* Postgres and Redis containers inside the production
  compose (section 1). (2) A second Postgres instance created in Dokploy. (3) The shared Postgres — not possible
  without a code change to role names.
- **T4. Postgres and Redis versions.** (1) *Recommended:* 18 and 8, the same as staging, so every release is proven on
  the same versions. (2) 16 and 7, as CI tests.
- **T5. Who may deploy production.** (1) *Recommended:* the manager deploys, only after Waleed's yes for each release.
  (2) Waleed deploys from the Dokploy UI himself.
- **T6. PR-B (separate cookie prefix) before go-live or after?** (1) *Recommended:* before. (2) After, with the
  browser-profile rule meanwhile.

**Product / business**

- **P1. Go-live meaning.** (1) *Recommended:* production opens with the salon's real data and runs beside their
  current method for the first month (D-45's parallel month), commissions paid by the old method until one month
  matches. (2) Full switch on day one.
- **P2. Messages on day one.** (1) *Recommended:* in-app notices and staff web push only; WhatsApp and email off.
  (2) Add email. (3) Add WhatsApp (needs the WABA, approved templates and the STOP subscription).
- **P3. The first owner account.** (1) *Recommended:* the salon owner's own account creates the company (a short-lived
  platform grant), so the owner is theirs from the first row. (2) Waleed creates it and is the owner; the salon owner
  is added as a member.
- **P4. Which hosts the salon uses:** `app.` / `pos.pospay.systems` as in ADR-0001 — confirm, since they are printed
  on QR codes and saved on devices.

## 6. Gaps that make production unsafe today

Configuration and delivery gaps only; each has evidence. Code-level review items stay out of this public file.

- **B1. No production front-end images.** `ci.yml:498-499`; `apps/admin/src/shared/api/origin.ts:3`;
  `apps/pos/src/shared/api/origin.ts:3`. Fixed by PR-A.
- **B2. The first-owner path is unproven end to end.** No admin screen calls `POST /v1/companies`, no `set-password`
  route was found in `apps/admin`, and the runbook has no procedure. Rehearse step 10 on staging first.
- **B3. A shared database or Redis would mix the two environments.** `packages/db/src/roles.ts:24-32`;
  `deploy/docker-compose.staging-shared.yml:24`. Fixed by the target shape.
- **B4. `TRUSTED_PROXY_CIDRS` empty in production switches capabilities off and blinds per-IP limits.** WhatsApp
  intake refuses to start (`apps/api/src/main.ts:108-109`), rating links are unavailable (`main.ts:302-303`), and the
  proxy list feeds the server's `trustProxy` (`apps/api/src/app.ts:332`), so without it every visitor shares the
  proxy's address. It is optional in `deploy/staging.env.example:53`; it must be required in the production file.
- **B5. Cookie scope overlap** between production and staging hosts — section 1; `packages/auth/src/config.ts:250,256`.
- **B6. Recovery is one nightly logical dump on the same server's schedule; no PITR, and no restore has been run for
  a production database.** `deploy/backup/README.md:3-5`. Step 9 and T1/T2.
- **B7. Staging compose is documented as reachable from other projects on `dokploy-network`**
  (`deploy/docker-compose.staging-shared.yml:14-16`). Production must not copy that network layout.
- **B8. No CPU limits** in the staging compose (only `mem_limit`, lines 65, 104, 143, 155, 164); add `cpus` to both
  stacks so staging cannot starve production.
- **B9. `STAFF_OTP_POS_ORIGIN` must survive the copy.** Staff PIN sign-in refuses every request without it, even with
  OTP off (pipeline skill §6). Staging derives it from the POS host (`docker-compose.staging-shared.yml:28`); the
  production file must keep that derivation from `POS_HOST`, never a literal staging origin.
- **Not found, not a defect yet:** no master-encryption-key variable in `.env.example` or
  `deploy/staging.env.example`; `CLAUDE.md` §8 requires one once third-party credentials are stored per tenant.
