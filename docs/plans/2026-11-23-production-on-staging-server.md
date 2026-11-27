# Production on the staging server — plan (2026-11-23, revision 2)

Planning only. Read against `origin/main@dc5b78786`. Nothing was run on the server, in Dokploy or against a database.
**Not verified:** the live Dokploy environment values, Dokploy's clean-up schedule, the row status in `roadmap.json`
(it lives in `lolotam/plan`), and every command marked "(to confirm)" in the companion documents.

Companion documents:

- `docs/adr/0062-production-topology-and-point-in-time-recovery.md` (Proposed) — topology, pgBackRest, the drill.
- `docs/plans/2026-11-23-production-messages.md` — in-app, push, email and WhatsApp: what works on day one.
- `docs/plans/2026-11-23-first-owner-rehearsal.md` — the staging rehearsal of the first company and owner.
- `docs/plans/2026-11-23-staff-sign-in-gap.md` — **go-live blocker:** no product path gives an employee, a manager
  or an accountant a sign-in.
- `docs/plans/briefs/2026-11-23-prod/` — implementer briefs PR-A, PR-B, PR-C, PR-D.

## 0. Decisions taken (2026-11-23, ~21:00 Kuwait, manager thread)

Waleed, verbatim:

- Recovery: «استرجاع لأي لحظة قبل الإطلاق» — point-in-time recovery is built on the production Postgres before real
  data. Production still runs on the staging server.
- How the salon starts: «شهر بالتوازي مع طريقته الحالية (المقترح)».
- Messages on day one: «اشعارات جوة التطبيق ونضيف الايميل resend ونضيف الواتس اب الحساب جاهز ولكن بدون قوالب».
- First owner: «صاحب الصالون نفسه (المقترح)».

Manager (technical): Postgres and Redis containers inside the production compose on a private network; Postgres 18
and Redis 8 as staging; the manager deploys after Waleed's yes for each release; the separate cookie prefix (PR-B)
lands before go-live; hosts stay `app.` / `pos.` / `api.pospay.systems` (ADR-0001). Server capacity measured: 4 CPUs,
15 GB RAM with 11 GB available, 159 GB disk free.

These answers reverse D-11 and the wording of the launch gate (`docs/PRD.md:528-531,957,1019`; Phase 1 plan row 63).
The manager records them in `docs/owner-decisions.ar.md` and updates those lines (PR-0, docs).

## 1. Target shape

A second Dokploy compose service, `pospay-prod`, in its own Dokploy project, from `deploy/docker-compose.prod.yml`,
with **its own Postgres 18 and Redis 8 containers on a private network** and WAL archiving to Cloudflare R2 by
pgBackRest. Details and limits: ADR-0062 §1–§3. Why it cannot share staging's database or Redis:

- Database roles are cluster-wide with fixed names; `migrate` resets their passwords on every run
  (`packages/db/src/roles.ts:24-32`; 97 migration files grant to those names).
- Redis keys have no environment prefix (`apps/worker/src/modules/customers/jobs/rating-claims.registration.ts:89`;
  `deploy/docker-compose.staging-shared.yml:24`).

| Item | Production | Shared with staging? |
|---|---|---|
| Server, Docker, Dokploy, Traefik + Let's Encrypt | same | **shared** |
| GHCR images `api`, `worker`, `migrate`, `backup` (by SHA) | same images | **shared** |
| `admin` and `pos` images | `-prod` variants (PR-A) | never: the API origin is baked in |
| Postgres (data, roles, passwords, WAL archive) | own container, own host directory | **never** |
| Redis | own container, own password | **never** |
| R2: files bucket, WAL bucket, dump bucket, one token each | own | **never** |
| `BETTER_AUTH_SECRET`, hash and derivation keys, VAPID keys | new values | **never** |
| Session cookie name | `pospay.*`; staging moves to `pospay-stg.*` (PR-B) | **never** |
| WhatsApp number and tokens, Resend key and sender | own | **never** |
| `dokploy-network` | only `api`, `admin`, `pos` join it | shared (routing only) |
| Demo data, `staging:staff-user`, `DEPLOY_ENV: staging`, `STAFF_NATIVE_ORIGINS` | absent | **never** |

**Risks of one server, cheapest mitigation each**

| Risk | Mitigation |
|---|---|
| Staging or another project starves production | `mem_limit` and `cpus` on both stacks (ADR-0062 §1; production capped at about 4.7 GB of the 11 GB available). |
| Disk fills | The WAL spool is capped; Healthchecks alerts on every backup; a disk figure in each deploy receipt. |
| A staging migration or seed mistake reaches production | Separate containers and passwords make it impossible. A SHA reaches production only after it ran on staging. |
| Other projects reach the API port, the database or Redis | Only the three web services join `dokploy-network`. |
| A volume clean-up deletes the database | Bind-mounted host directories, not named volumes. |
| Production cookie sent to staging hosts | PR-B before go-live stops staging **reading** it as a session. The browser still sends it, so the rule stays: no staging in a browser profile that holds a production session. |
| The server is lost | Restore elsewhere from R2 alone: base backup + WAL + the key Waleed keeps off the server. Proven by the drill. |
| Wrong stack deployed | Separate Dokploy project; every production deploy needs Waleed's yes. |

## 2. What exists, what is missing

**Exists:** CI images (`.github/workflows/ci.yml:494-502`); the one-shot migrate step (`deploy/Dockerfile.api:16-21`);
healthchecks in every image; `/health` and `/ready`; rollback by a pinned compose upload (pipeline skill §6); the
logical backup and restore check (`deploy/backup/`); the operator scripts `platform:create-user` and
`platform:grant`; `POST /v1/companies`; the staging env key list.

**Missing, and what closes it**

| Missing | Closed by |
|---|---|
| `deploy/docker-compose.prod.yml`, `deploy/prod.env.example` | PR-A |
| Production front-end images — the plain ones bake no API origin (`ci.yml:498-499`; `apps/admin/src/shared/api/origin.ts:3`; `apps/pos/src/shared/api/origin.ts:3`) | PR-A |
| A Postgres image with WAL archiving; PITR | PR-A + ADR-0062 + the drill |
| A plan row on a fresh database — only the seed inserts it (`packages/db/src/seed.ts:33,47-50`) and `migrate` does not run it | the `seed` service in PR-A |
| Separate session cookie names | PR-B |
| A page for the one-time set-password link — `apps/admin/app/` has no `set-password` route, while the link points there (`packages/auth/scripts/create-user.ts:35`) | PR-D |
| An image that can run `platform:create-user` | PR-E: the `ops` image target, `ghcr.io/lolotam/pospay-ops:<sha>` (rehearsal step 1 checks it) |
| A user, membership and PIN for an employee; a second admin user — no use case or route creates either (`apps/api/src/modules/identity/use-cases/`; `persistence/onboarding-transactions.ts:26` is the only product membership insert) | PR-F, PR-G (`2026-11-23-staff-sign-in-gap.md`) |
| A screen that creates the company | PR-H (optional for one salon) |
| Email sending — the adapter exists but the capability is a constant `false` (`packages/notifications/src/email-configuration.ts:10-12`) | PR-C1, PR-C2 |
| WhatsApp to customers or the team — closed in production (`apps/worker/src/main.ts:111`) and no template names can be supplied (`packages/notifications/src/configuration.ts:46-48`) | Meta templates + a later slice |
| Production backup env, cron lines, Healthchecks checks | Waleed + the manager, steps 7 and 9 |
| `docs/security.md`, `docs/domain-model.md` (named in `CLAUDE.md`, absent) | not blocking; noted |

## 3. Go-live checklist (re-cut)

**W** = Waleed, **M** = the manager, **PR** = a code or docs PR. Steps inside one phase run in parallel.

**Phase A — decide and start the long poles (now)**

1. **M / PR-0 (docs):** record the four answers and the manager decisions; update the reversed lines; move ADR-0062
   to Accepted after Waleed reads it.
2. **W:** submit the `staff_otp` template (ar, en) to Meta after approving its copy; create the Resend account and
   verify the sending domain in Cloudflare DNS; answer the email question (section 5, T1).
3. **W:** Cloudflare — three R2 buckets (files, WAL, logical dump) with one token each; Healthchecks — three checks.
4. **W:** DNS A records for `api`, `app`, `pos` under `pospay.systems`, DNS-only (ADR-0001 §5).

**Phase B — build (three PRs in parallel, none touches another's files)**

5. **PR-A** (Heavy, deploy change, Waleed's yes): production compose, `-prod` images, Postgres image with pgBackRest,
   the `seed` service, required `TRUSTED_PROXY_CIDRS`, CPU limits, the env example.
   **PR-B** (Heavy, auth): cookie prefix. **PR-D** (Heavy, auth surface): the set-password page.
   **PR-F** (Heavy, auth): staff access for an employee — without it nobody but the owner can sign in and
   attendance cannot start. **PR-C1 → PR-C2** (email) run beside them and do not block go-live unless Waleed says
   email must work on day one. **PR-G** (second admin) and **PR-H** (create-company screen) follow.
6. **M:** the first-owner rehearsal on staging (`2026-11-23-first-owner-rehearsal.md`) as soon as PR-D is on staging;
   step 1 checks the `pospay-ops` image from PR-E.

**Phase C — stand up production (after PR-A and PR-B merge and run on staging)**

7. **W:** create the Dokploy project and service `pospay-prod`; add the three domains (api → `api`:3000, app →
   `admin`:3000, pos → `pos`:8080, HTTPS); enter the environment from `deploy/prod.env.example` — every secret freshly
   generated, none copied from staging; create `/opt/pospay-prod/` and approve the production cron lines.
8. **M:** first deploy of a staging-proven SHA, pinned (pipeline §6 step 4). `postgres` healthy, `migrate` and `seed`
   exit 0, API `/ready` 200, worker `/ready` 200 from inside its container, both front ends 200, valid certificates.
9. **M + W — the launch gate:** the restore drill of ADR-0062 §5 passes (timed PITR to a chosen moment, write smoke
   on the restored cluster, RPO ≤ 5 min, RTO ≤ 2 h), `pgbackrest check` passes, one logical dump and
   `restore-check.sh` pass, the three Healthchecks checks are green. Receipt with labels and times.
10. **M:** rollback proof before real data: deploy the previous staging-proven SHA with its pinned file, `/ready`,
    then the current SHA again; record both deployment ids.
11. **M:** smoke test with a throw-away company that is then left unused: owner login + TOTP, an employee, device
    pairing, staff PIN sign-in, clock in and out, a service session with a discount and a tip, a package sale and
    redemption, a document upload and download, an attendance statement PDF, the commission estimate, an in-app
    notice and a push, and a second company that sees none of it.

**Phase D — the salon**

12. **W + salon owner + M:** the owner's account, a one-hour grant, the company, the revoke — exactly as rehearsed.
13. **M + salon:** businesses, branches, employees, services, package types, customers and open packages, by the
    admin screens and the workbook imports (rows 11, 32b, 34b, 47).
14. **W + salon:** pair the reception device, give each employee a PIN, one sign-in each.
15. **W:** go. The first month runs **in parallel with the salon's current method** (D-45): commissions are paid the
    old way until one month matches the system line by line.
16. From then on every production release is a pinned compose upload of a staging-proven SHA, with a fresh snapshot
    right before any migration (PP-129 applied to production) and Waleed's yes.

## 4. Launch scope

The backend has `catalog`, `commissions`, `customers`, `files`, `identity`, `notifications`, `orders`, `settings`,
`staff`, `tenancy` (`apps/api/src/modules/`). There is **no** `payments`, `cash`, `inventory` or `appointments` module
and no `packages/payments`: day one is staff, attendance, visits, packages and commissions, not a cashier taking
payments. No payment gateway account is needed.

Day one (Phase 1 rows; each appears in merged commit subjects, completeness per row not verified): login, TOTP,
permissions, pairing, staff PIN (2, 3, 7); employees, salaries, schedules, leave, documents (8–18); attendance and
its reports (19–27h); services, package types, customers, sessions, tips, discounts and approvals (32–41); packages
(42–47); commission plans and the live estimate (48–50); in-app notices and staff web push.

After launch: the statement chain (51–56b) — needed by the first month-end, which the parallel month makes the real
deadline; ratings (58–61); alert rules and team alerts by email or WhatsApp (62, 62b); spec 074 navigation; staff OTP
by WhatsApp; the store apps; `apps/menu`.

Messages, against Waleed's answer (`2026-11-23-production-messages.md`): in-app and push work on day one. **Email does
not** until PR-C1 and PR-C2 merge. **No WhatsApp message can be sent** until Meta approves a template; with an
approved `staff_otp` the sign-in code can go live, and messages to customers or the team need a further code slice.

## 5. Open questions for Waleed

Technical:

- **T1. Email on day one.** His 2026-10-03 decision requires bounce and complaint handling before any live send
  (ADR-0014 §3); that code is not built. (1) *Recommended:* keep it — email goes live when PR-C1 and PR-C2 merge,
  possibly after go-live. (2) Waive it for the pilot and ship PR-C2 alone; bounces are then seen only in Resend.
- **T2. Recovery window.** (1) *Recommended:* two weekly full backups, a 7–14 day window (ADR-0062 §3). (2) Four
  weeks, about twice the R2 storage.

Product:

- **P1. Staff sign-in by WhatsApp code.** (1) *Recommended:* PIN on the paired reception device for launch; the code
  after Meta approves the template. (2) Wait for the template before go-live.
- **P0. Staff sign-ins for the first salon** (`2026-11-23-staff-sign-in-gap.md`). (1) *Recommended:* build PR-F
  before go-live, PR-G right after. (2) Approve an audited operator script on production for the first salon's
  staff (lifts PP-58.3's staging-only limit; Waleed's decision). (3) Go live with the owner account only and no
  attendance until PR-F merges.
- **P2. "My work" on staff phones (row 57) on day one?** (1) *Recommended:* yes if the rehearsal shows it works with
  PIN sign-in on a personal phone; otherwise after launch. (2) After launch.

## 6. Gaps that make production unsafe today

Configuration and delivery gaps only; code-level review items stay out of this public file.

- **B1. No production front-end images** — PR-A.
- **B2. The first-owner path is unproven and has two holes:** no set-password page (PR-D) and no plan row on a fresh
  database (the `seed` service). Rehearsal before go-live.
- **B3. A shared database or Redis would mix the environments** — closed by the target shape.
- **B4. `TRUSTED_PROXY_CIDRS` empty in production** disables WhatsApp intake (`apps/api/src/main.ts:108-109`) and
  rating links (`main.ts:302-303`), and leaves every visitor on the proxy's address (`apps/api/src/app.ts:332`) —
  required in the production file.
- **B5. Cookie scope overlap** (`packages/auth/src/config.ts:250,301`) — PR-B.
- **B6. No point-in-time recovery yet** — ADR-0062; the drill is the launch gate.
- **B7. Staging is reachable from other projects on `dokploy-network`**
  (`deploy/docker-compose.staging-shared.yml:14-16`); production must not copy that layout.
- **B8. No CPU limits** in the staging compose — added by PR-A.
- **B9. `STAFF_OTP_POS_ORIGIN`** must keep its derivation from the POS host in the production file; staff PIN
  sign-in refuses every request without it (pipeline skill §6).
- **B10. Email and customer WhatsApp are off by code,** so the owner's day-one expectation for them cannot be met by
  configuration alone (`2026-11-23-production-messages.md`).
- **B11. Nobody but the owner can sign in.** No use case creates a user or a membership for an employee, a manager
  or an accountant, and card clock-in needs a staff session
  (`apps/api/src/modules/staff/http/clock-by-card.controller.ts:38-40`) — `2026-11-23-staff-sign-in-gap.md`; PR-F.
- **Not found, not a defect yet:** no master-encryption-key variable in `.env.example` or
  `deploy/staging.env.example`; `CLAUDE.md` §8 requires one once per-tenant third-party credentials are stored.
