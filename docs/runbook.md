# Worker operations

## Staging worker readiness in every deploy receipt (PP-133)

Decision PP-133 (2026-11-06, issue #868) keeps the worker container healthcheck on
`/health` for process liveness. A healthy container alone does not prove database
and Redis readiness. Every staging deploy receipt must also record a read-only
`/ready` probe for each current worker replica, alongside the release SHA, replica
identifier and probe time. Do not change compose, container environment or healthcheck,
publish a port, or restart a container to obtain this evidence.

Use the existing authorized staging operator context. Select the current worker
container from the release inventory into the operator's `WORKER_CONTAINER` variable;
it is a placeholder, not a container name to copy. DEP-1's method passes Node code
through stdin with `docker exec -i`, so it needs neither an installed curl binary nor
a host-published worker port. The port comes from the running container's existing
`WORKER_PORT` (the worker's default is 3001 when unset or empty); no environment value
is changed or dumped. Run this POSIX-shell command once for each worker replica:

```sh
: "${WORKER_CONTAINER:?Select the current staging worker container from the release inventory}"
docker exec -i "$WORKER_CONTAINER" node --input-type=module <<'JS'
const port = process.env.WORKER_PORT || '3001';
let httpStatus = null;
try {
  const response = await fetch(`http://127.0.0.1:${port}/ready`, {
    signal: AbortSignal.timeout(5_000),
  });
  httpStatus = response.status;
  const body = await response.json();
  const checks = body.checks ?? body.details?.checks ?? null;
  console.log(JSON.stringify({ http_status: httpStatus, checks }));
  const required = ['database', 'dispatcher', 'redis'];
  if (httpStatus !== 200 || !checks ||
      !required.every((name) => checks[name] === 'up') ||
      !Object.values(checks).every((state) => state === 'up')) {
    process.exitCode = 1;
  }
} catch {
  console.log(JSON.stringify({
    http_status: httpStatus,
    checks: null,
    probe_error: 'TIMEOUT_TRANSPORT_OR_INVALID_RESPONSE',
  }));
  process.exitCode = 1;
}
JS
```

Preserve the JSON output and command exit code in the receipt. `/ready` returns
HTTP 200 with `checks` when ready, or HTTP 503 with `details.checks` when a dependency
is down; the command records either shape without printing credentials or connection
strings. Current dependencies are `database`, `dispatcher` and `redis`, each `up` or
`down` (`apps/worker/src/shared/health.controller.ts`, wired in `apps/worker/src/main.ts`).
The five-second fetch timeout also bounds response-body reading. An absent HTTP
status, malformed response, nonzero command exit, HTTP other than 200, or a dependency
not `up` means readiness is **not verified**: retain the evidence and report the blocker
through DEP-1's existing release procedure; never replace it with the `/health` result.
This command performs no deployment or configuration change and grants no new server access.

## Restoring a logical dump

Restore a logical dump only into a **freshly `initdb`'d cluster**, with triggers disabled:
`pg_restore --disable-triggers` as superuser, or `SET session_replication_role = replica` for the
restoring session. The write seal (`write_system_id`, `write_xid` — ADR-0050) is stamped by the
triggers: restoring with them on re-stamps the rows with the new cluster's identifier and the
deferred performer-change check plus the uniques refuse them. Never restore into a cluster that
kept the writer's `system_identifier` (a PITR target or a physical fork), or a restored row can
pass as a header of the current transaction.

## PR 28: register existing companies for not-clocked-in alerts

Run this procedure **only after the new worker release is fully rolled out on every replica**, before relying
on the alert. During a rollback, wait until the fixed release is fully restored. `CompanyCreated` supplies
day-one discovery; subsequent `AttendanceClockedIn` deliveries repair registration but cannot cover a company
where nobody has clocked in. Repeat this procedure after Redis scheduler loss if immediate coverage is needed.

1. From the onboarding/release inventory, prepare the explicit UUIDs of companies created before this release.
   Do not discover tenants with an application-role cross-tenant query. Set `COMPANY_IDS` to that comma-separated
   list in the operator process. Record the release SHA, company IDs and replay outcome in the operations record.
2. Use the built **new release**, with its ordinary worker environment (`DATABASE_URL` as `pospay_app` and
   `REDIS_URL`). Run the following one-shot command from `apps/worker`. It briefly joins the staff queues,
   reads each original `CompanyCreated` inside `withTenant`, then replays it through `staff.deliver` **after
   the read transaction ends**. Database consumer dedupe is retained; scheduler upsert happens before it.
   No outbox payload, event ID, publication metadata or consumed-event row is changed or deleted.

```sh
node --input-type=module <<'JS'
import { createDatabase } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import { sql } from 'drizzle-orm';
import { Queue } from 'bullmq';
import { createStaffDocumentDefaults, startStaffWorker } from './dist/modules/staff/index.js';
import { createDeliverer } from './dist/outbox/deliver.js';

const logger = createLogger('info');
const ids = systemUuidV7();
const companies = [...new Set((process.env.COMPANY_IDS ?? '').split(',').map(id => id.trim()).filter(Boolean))];
if (!companies.length || companies.some(id => !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)))
  throw new Error('COMPANY_IDS_REQUIRED');
const database = createDatabase({ url: process.env.DATABASE_URL, ids });
const staff = startStaffWorker(database, ids, process.env.REDIS_URL, { now: () => new Date() });
const queue = new Queue('attendance-not-clocked-in', { connection: { url: process.env.REDIS_URL } });
const next = createDeliverer(database, [createStaffDocumentDefaults(ids)], logger, {
  knownEventTypes: ['CompanyCreated'],
});
try {
  await staff.ready();
  for (const companyId of companies) {
    const rows = await database.withTenant(companyId, tx => tx.execute(sql`
      SELECT id, aggregate_id, aggregate_type, payload FROM outbox
      WHERE company_id = ${companyId} AND event_type = 'CompanyCreated'
      ORDER BY seq LIMIT 2`));
    if (rows.length !== 1) throw new Error('COMPANY_CREATED_EVENT_REQUIRES_INVESTIGATION');
    const row = rows[0];
    const result = await staff.deliver({
      companyId, id: row.id, aggregateId: row.aggregate_id, aggregateType: row.aggregate_type,
      eventType: 'CompanyCreated', payload: row.payload, attempt: 1,
    }, next);
    if (!result.delivered) throw new Error('COMPANY_CREATED_REPLAY_RETRY');
    const schedule = await queue.getJobScheduler(`attendance-not-clocked-in-${companyId}`);
    if (Number(schedule?.every) !== 300000 || schedule?.template?.data?.companyId !== companyId)
      throw new Error('SCHEDULER_VERIFICATION_FAILED');
    logger.info({ company_id: companyId, outcome: 'SCHEDULER_VERIFIED' }, 'log');
  }
} catch (error) {
  logger.error({ err: error }, 'error');
  process.exitCode = 1;
} finally {
  await staff.close();
  await queue.close();
  await database.close();
}
JS
```

3. Confirm one `attendance-not-clocked-in-<companyId>` scheduler per listed company, with `every = 300000`
   and only `{ companyId }` as data. Observe a completed scheduled run and inspect failed jobs/worker logs.
   Existing running shifts may alert immediately; ended shifts are skipped. Never create fake absences in live data.
4. A failed replay is safe to repeat with the same company/event identities after fixing the cause. If the original
   event is missing or ambiguous, stop that company's replay and investigate the onboarding record; do not invent
   an event, clear dedupe or broaden database privileges. Retain the failed IDs in the operations record.

Closed companies keep their schedulers. A company with `deleted_at` set records nothing; inactive employees
(deleted or contract-ended before the working date) also record nothing. A nonzero failed-job count or an
`ATTENDANCE_NOT_CLOCKED_IN_RETRY` log requires investigation even if other shifts succeeded. Logs contain safe
error types/codes and cause types/codes, never employee names, error messages or query parameters.

## 35b-2: recover retained late service-session bells

After every replica runs the 35b-2 consumer/template, use the new release from apps/worker with ordinary
DATABASE_URL (pospay_app) and DISPATCHER_DATABASE_URL (pospay_dispatcher). Obtain explicit company IDs and
expected pre-rollout recording/append event counts from the release inventory. Never reset published_at,
consumed_events or the permanent late_service_session_notices ledger. A published input is still eligible.

For each company run this operator script, preserving its UUID upper bound/checkpoint and counts in the
operations record alongside release SHA. On retry, set AFTER_ID and THROUGH_ID from the last successful page.
If a page fails, retain its starting checkpoint; already committed consumers are safe to repeat. New live writes
are handled by the normal consumer, including appends racing the replay. The dispatcher page is read-only,
tenant-qualified, accepts only recording/append event types, and uses the existing outbox PK; no grant changes.

```sh
node --input-type=module <<'JS'
import { createDatabase, createOutboxDispatcherDatabase } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import { createLateServiceSessionNoticeConsumer } from './dist/modules/orders/index.js';
import { createDeliverer } from './dist/outbox/deliver.js';
const ids = systemUuidV7();
const app = createDatabase({ url: process.env.DATABASE_URL, ids });
const dispatcher = createOutboxDispatcherDatabase({ url: process.env.DISPATCHER_DATABASE_URL });
const logger = createLogger('info');
const consumer = createLateServiceSessionNoticeConsumer(ids, { now: () => new Date() });
const deliver = createDeliverer(app, [consumer], logger, { knownEventTypes: consumer.eventTypes });
const company = process.env.COMPANY_ID ?? '';
let after = process.env.AFTER_ID || null;
let through = process.env.THROUGH_ID || null;
let recorded = 0, appended = 0;
try {
  for (;;) {
    const page = await dispatcher.serviceSessionReplayPage(company, after, through, 100);
    through = page.throughId;
    for (const event of page.events) {
      if (!(await deliver(event)).delivered) throw new Error('LATE_NOTICE_REPLAY_RETRY');
      if (event.eventType === 'ServiceSessionRecorded') recorded++; else appended++;
    }
    after = page.events.at(-1)?.id ?? after;
    logger.info({ company_id: company, after_id: after, through_id: through, recorded, appended }, 'log');
    if (page.events.length < 100) break;
  }
} finally { await dispatcher.close(); await app.close(); }
JS
```

Checkpoint counts are per invocation; total them with previous successful pages and compare both event types
against the release inventory. Inspect per-company ledger totals, recipient_count=0 decisions, grouped request
counts, inbox/results and failed outbox events. Through application-role withTenant, compare orders' saved
header-late OR any line-late sessions against the ledger; every eligible retained visit must be covered. Closed
companies are intentionally skipped. Notification delivery runs through normal outbox dispatch after requests
commit; await it before checking inbox coverage. Rerun recovery and verify ledger/request/inbox counts stay fixed.

If an expected retained input is absent, or saved late visits have no recoverable event, stop and record missing
coverage and IDs. Do not claim recovery complete, fabricate events, query outbox through orders, broaden grants,
reset dedupe or regenerate requests. This procedure does not replay commissions/ratings or grant day-list access.

## 50-3a: replay retained commission inputs (spec 059, D-15)

Replays the retained `ServiceSessionRecorded`, `ServiceSessionLinesAdded`, `ServiceLineChanged` and `SalaryChanged` events of one
company to the `commissions.project-inputs` consumer alone. Tips are bootstrapped by 50-3b, and coverage is checked by 50-3c; until those
land, approval stays closed. Never reset `published_at`, `attempts`, `parked_at` or `consumed_events`; the replay does not write them.

1. **Every worker replica first.** Roll the release that registers the consumer to every worker replica, or drain the old dispatchers,
   before choosing the upper bound. An old replica could otherwise mark a new event published without applying it.
2. **Run once per company**, from `apps/worker` with the ordinary `DATABASE_URL` (`pospay_app`) and `DISPATCHER_DATABASE_URL`
   (`pospay_dispatcher`):

   ```sh
   node apps/worker/dist/replay-commission-inputs.js --company <uuid> [--after <uuid>] [--through <uuid>]
   ```

   The entry prints one JSON line: `status`, `afterId`, `throughId`, per-type `counts`, and `undelivered` (event id, type and error code only,
   never a payload; at most 200, `truncated` tells when more exist). Keep the line, the release SHA and the counts in the operations record.
   The exit code is 0 only for `COMPLETE`.
3. **Statuses.**
   - `COMPLETE`: the range up to `throughId` is applied; compare the counts with the release inventory.
   - `PAGE_LIMIT` or `ABORTED`: resume with `--after <afterId> --through <throughId>` from the printed line. `ABORTED` means a failure that is
     not a known business outcome (a database or timeout failure); fix the cause first.
   - `UNDELIVERED`: the range finished but some events were not applied for a known business reason. Fix the cause, then re-run **from the
     beginning** with the same `--through`; `--after` would skip the failed events. Marks make the re-run idempotent.
4. **Legacy `SalaryChanged` without `business_id`** (CS-Q44) is routed through the staff reader on the same transaction. If the employee is not
   found the event stays unmarked and appears as `COMMISSION_EMPLOYEE_BUSINESS_MISSING`: approval stays closed and the manager investigates.
   Do not invent an event, a mark or a grant.
5. **The upper bound is an id bound, not a commit-order proof.** An event whose row commits after the cursor passed it, with a lower id, is
   not replayed; the live consumer delivers it. Do not record "everything up to the bound was replayed" as coverage: coverage is checked by 50-3c.
6. **After any worker rollback then upgrade**, re-run the replay with a new upper bound (CS-Q43). The ADR-0012 pending count, shipped in
   row 53-1, keeps approval closed for any counted event without the consumer's mark. This run replays the four types above; 50-3b adds the
   six-type retained-event replay (`SessionTipsChanged` and `PackageSaleChanged` as well), which is the run to use after a rollback, because
   the current-state readers of the first bootstrap discharge only the current revision's event id. Every re-run states its upper bound:
   captured after every replica runs the consumer, passed as `--through`, reused on a resume, new after any rollback. An unmarked event aimed at
   an already APPROVED month stays undelivered (`COMMISSION_PERIOD_CLOSED`) by design; the manager owns that case.
7. **Logs.** A failed replay of a row that already has ten or more attempts logs «outbox event parked» at error level although nothing is
   written; read the printed result, not that line.

## Admin service-session browser tests

The Playwright config has no `webServer`. Postgres, Redis, the API and the admin must already be running.
`apps/admin/playwright.config.ts` throws `e2e needs ADMIN_E2E_URL` when that variable is unset or empty,
including the RFC 6238 vector test, because the config loads before any test. `ADMIN_E2E_URL` and the API
base must share a host, and that admin origin must be in `AUTH_TRUSTED_ORIGINS`, because the session cookie
is host-only. The local pair is `http://localhost:3001` and `http://localhost:3010` (both `localhost`,
different ports). Do not mix `localhost` with `127.0.0.1`.

The seed refuses to run unless `NODE_ENV=development`. It also requires `BETTER_AUTH_URL` (the API base;
the hostname must be `localhost`, `127.0.0.1`, `::1`, or `[::1]`), `DATABASE_URL`, `AUTH_DATABASE_URL`, and
`MIGRATION_DATABASE_URL` (one database on this machine), `BETTER_AUTH_SECRET`, and `AUTH_TRUSTED_ORIGINS`
including the admin origin. The seed sends `Origin` from the trusted entry that contains
`://localhost:3001`, or from the first trusted origin when that entry is absent. A non-local API hostname
is refused before any user is created and before any request is sent.

Build the admin against the local API and serve it on port 3001 (the `@pospay/i18n` build comes first, because
the admin reads the built catalog). Stop any earlier admin on that port before rebuilding: a server left
running over a rebuilt `.next` serves mismatched chunks and the suite fails.

```sh
pnpm --filter @pospay/i18n build
NEXT_PUBLIC_API_URL=http://localhost:3010 pnpm --filter @pospay/admin build
cd apps/admin && NEXT_PUBLIC_API_URL=http://localhost:3010 pnpm exec next start --port 3001
```

`next start` prints a warning about `output: standalone`; it still serves the build and the suite passes
against it.

From the worktree root, against that stack:

```sh
pnpm --filter @pospay/api e2e:seed
```

```powershell
$env:ADMIN_E2E_URL = 'http://localhost:3001'
pnpm --filter @pospay/admin e2e
```

`e2e:seed` (`apps/api/package.json`: `node --env-file-if-exists=../../.env scripts/seed-e2e-session.ts`)
talks to the running API and writes `apps/admin/e2e/.state/session.env`, already ignored by `*.env`. It
prints only that path. Passwords and the TOTP secret stay in the state file. Companies, users, the catalog,
and the approved leave are created through the API. Through `grantPlatformPermission` (the migration owner,
as `demo:seed` does) the seed writes two platform grants (`create:companies:platform`, operator `e2e-seed`).
No API creates a non-owner membership, so it writes three membership rows as the application role inside
`withTenant`, one transaction per tenant, as onboarding does: cashier on the home branch at 1000 bps, cashier
on the home branch at 500 bps, and viewer on the foreign branch.
A failed seed can leave partial tenants, because each tenant is its own transaction. Rerun the seed: every
run creates fresh tenants, so the partial rows are not reused.
Each run leaves two tenants, three users, two grants, three memberships, and one approved leave, with no
cleanup. The leave covers the seed's business date from the day before through the day after. Reseed
before every suite run, and again when that business date has changed, because a suite started on a later
day no longer matches the performer who was on leave. Also reseed when the state file is missing.

## Per-lane test Postgres (parallel DB integration tests)

Postgres roles are cluster-wide. On the shared dev cluster (`pospay-dev-postgres-1`, `127.0.0.1:5432`) every
test run takes the advisory lock `pospay:test-cluster-roles` (`packages/db/test/role-lock.ts`) for the
migration bootstrap and the role/privilege suites, so runs from several worktrees wait on each other and can
fail with `55P03` when a wait outlives `lock_timeout`. A separate database on the same cluster does not help;
a separate cluster does. `scripts/test-db/lane.mjs` starts one per lane.

From the lane's worktree root, prepare a local `.env` using this worktree's tracked
`.env.example` as the template. Never copy `.env`, environment values or secrets from
another checkout or task. Generate the required `POSTGRES_*` passwords locally with
`crypto.randomBytes`, without printing or committing them; keep the generated values
only in this worktree's ignored `.env`. Use the same local values for the test roles.
`docker compose config` also requires `REDIS_PASSWORD`: generate a local random value
for config resolution only. This does not authorize starting Redis or trying that value
against shared Redis. See [the manager's execution provenance](specs/0892-runbook-env-provenance.md).
Before preparation, stop if `.env` or `.env.test.local` already exists; retain and
verify that its values were generated in this worktree before using it. Copied or
unknown provenance blocks testing: retain the file without using it, report it to the
manager, and arrange safe replacement with freshly generated local secrets and matching
local URLs; never overwrite or delete existing values blindly. Create `.env` only when
absent, using an exclusive-create write (`flag: 'wx'`). Generate
`POSTGRES_OWNER_PASSWORD`, `POSTGRES_APP_PASSWORD`, `POSTGRES_AUTH_PASSWORD` and
`POSTGRES_DISPATCHER_PASSWORD` locally; never paste values into chat or logs.
Leave `.env.test.local` generation to the lane helper after confirming it is absent.
The helper still reads this worktree's root `.env`; `.env.test.local` is only its generated
host/port override, not a replacement credentials file.

After this preparation, the normal lane lifecycle is:

```sh
node scripts/test-db/lane.mjs up <lane>            # e.g. lane-7 → 127.0.0.1:55407; prints port=<n>
pnpm --filter @pospay/db exec vitest run src/__tests__/privileges.spec.ts   # or any DB suite
node scripts/test-db/lane.mjs down <lane>          # container, data volume and override are gone
node scripts/test-db/lane.mjs status               # lane containers, and which lane this worktree uses
```

- `up` runs a container `pospay-test-<lane>` (label `pospay.test-lane=<lane>`) with the image, `command`
  flags, environment and memory limit read from the `postgres` service of `deploy/docker-compose.dev.yml`
  through `docker compose config` (read-only), so it cannot drift from dev or CI. There are no init scripts:
  the roles are created by the migration bootstrap when the tests start, as on a fresh CI cluster. The
  container is `--rm` with an anonymous data volume, published on `127.0.0.1` only. The port is
  `55400 + <trailing digits of the lane>` when free, otherwise the first free port from 55401; `--port N`
  picks one. Choosing the port and `docker run` happen under a lock directory `pospay-test-lane.lock.d` (atomic
  `mkdir`, with an `owner.json` naming host, pid, process start time and token) in the repository's shared git
  directory, so concurrent `up` calls from different worktrees get different ports; if a publish still
  collides, `up` retries on the next free port (up to five times), removing only the container its own failed
  attempt created. A lock whose owner is on this host is taken over only when that pid is gone, or is alive but
  started more than 5 seconds away from the recorded start time (the pid was reused, for example after a
  reboot); when the start time cannot be read, a live pid keeps the lock. The 15-minute age limit applies only
  when liveness cannot be checked (another host, or no readable owner). Takeovers run one at a time under a
  second directory `pospay-test-lane.lock.d.takeover` (cleared after a minute if its holder died), and the
  takeover re-checks the lock inside it. It renames the lock to a unique name and deletes it only if it is
  exactly the generation inspected; anything else is put back with `mkdir` (never over a lock created in the
  meantime), or left as a `pospay-test-lane.lock.d.stale-*` orphan that is safe to delete when no start is
  running. When the owner file cannot be moved back (a persistent Windows `EPERM`/`EBUSY`), it is copied
  into the new lock directory instead, so a live owner keeps its lock; only if the copy fails too is the empty
  lock directory it just made removed (only if it is still the same directory: inode and creation time), and
  the parked folder left as such an orphan, so an ownerless lock never blocks later starts. Only the owner's token releases the lock. The code is `scripts/test-db/lane-lock.mjs` and
  `lane-process.mjs`, tested by `lane-lock.test.mjs`.
- `up` on a running lane waits for readiness, rewrites the override and reprints the port. A lane container
  that exists but is not plainly running (created, exited, paused, restarting) is removed and started fresh.
- `up` writes `.env.test.local` at the worktree root (git-ignored by `.env.*`) with only
  `POSPAY_TEST_PG_HOST` and `POSPAY_TEST_PG_PORT`; passwords stay in `.env`. `down` deletes the file only
  when its marker names that lane.
- `readPgTestEnv` (`packages/db/test/pg-env.ts`) takes `POSPAY_TEST_PG_HOST` / `POSPAY_TEST_PG_PORT` from the
  process environment first, then `.env.test.local`, and falls back to `POSTGRES_HOST` / `POSTGRES_PORT`, then
  `127.0.0.1:5432`. This is the existing loader behavior, not permission for a task worktree
  to use shared Postgres. Before a task suite, verify its process overrides or generated lane
  file point to its own running lane; if absent or unavailable, stop and report the blocker.
  CI retains its existing compose setup. The loader is unchanged.
  The vitest global setup of `packages/db`, `packages/auth`, `apps/api` and `apps/worker` all read it.
- The lane name must match `^[a-z0-9-]{1,32}$`. The script only ever removes the container that has both
  the exact name `pospay-test-<lane>` and the lane label; it never touches `pospay-dev-*` or any other
  container, and it refuses ports 5432 and 6379.
- A lane container belongs to the worktree that started it (label `pospay.test-worktree`). `up` or `down` of
  the same lane name from another worktree is refused, so two worktrees never share or remove each other's
  cluster; pick a different lane name per worktree. `status` shows each container's worktree.
- ADR-0006, addendum 2026-10-21, records that a lane cluster is the T2 compose service run a second time.
- Not redirected: Redis, `pnpm db:migrate`, and the apps' `DATABASE_URL`-style variables.
  Only the Postgres test harness moves. Do not borrow shared Redis: a Redis-dependent suite
  needs its own explicitly authorized isolated setup; otherwise report it blocked.
  That authorization must include the reviewed Redis topology/ADR and its lifecycle;
  this paragraph is a checklist for that separate setup, not a new topology decision.
  Only after that authorization, the setup must use a worktree-private Redis container
  labelled with its lane and worktree, bound to `127.0.0.1` on a verified free port
  (for example `56380`, only if free; record the actual port in the task receipt).
  Its independently generated password and actual port belong in that worktree's ignored
  `.env` as `REDIS_PASSWORD` and `REDIS_PORT`; set `REDIS_URL` to the same private instance.
  Ensure the test process receives `REDIS_URL` through its authorized local environment
  setup; merely writing `.env` does not prove a suite loads it. If the URL is missing,
  stop: some suites otherwise default to shared `127.0.0.1:6379`.
  The config-only random password above is not a credential for shared Redis.
  The separate setup must also supply ownership-checked teardown for its exact Redis
  container and private data: verify its lane/worktree labels and task receipt before
  removal, stop its clients, and remove only its owned container and disposable data.
  Never remove shared or unknown resources. `lane.mjs down` removes Postgres only;
  it does not perform Redis cleanup. Without that reviewed teardown, the suite stays blocked.
  These are setup requirements, not authorization to start a Redis instance in #892.
- Run one lane per worktree: the override file is per worktree. Bring the lane down when the slice is done;
  `docker ps` should show only `pospay-dev-*` again.
- The container does not survive a Docker Desktop restart. If the tests then report that Postgres is not
  reachable on a 554xx port (the hint to run `pnpm infra:up` is for the shared cluster), rerun
  `node scripts/test-db/lane.mjs up <lane>`, or stop the suite and report the unavailable lane; do not use the shared cluster as a fallback.

## Staff web push (VAPID keys, row 28b)

Spec 063 and ADR-0052. One ES256 (P-256) key pair for the whole platform signs every push. The **worker** is the only
process that holds the private key; the API holds the public key and the subject only.

**Generate (once, on the operator's machine).** Run `pnpm push:generate-vapid`. It prints two lines to the terminal,
`VAPID_PUBLIC_KEY=…` (87 characters) and `VAPID_PRIVATE_KEY=…` (43 characters), and writes nothing to disk. Do not paste
them into a chat, a ticket or a commit. Choose `VAPID_SUBJECT`, a `mailto:` or `https:` contact the push services may use
to reach the operator (for example `mailto:ops@pospay.systems`).

**Install.** Put all three in the Dokploy environment of the compose service, as secrets. The compose files pass
`VAPID_PUBLIC_KEY` and `VAPID_SUBJECT` to `api`, and all three to `worker` only; the private key must never reach the `api`
container. Do not set `NOTIFICATIONS_MODE=fake` on a deployed environment: a production worker refuses fake mode for push (`reason: FAKE_IN_PRODUCTION`, push stays off); leave it empty or `live`. Outside production, `NOTIFICATIONS_MODE=fake` runs push with a fake channel and needs no key. Redeploy. The worker logs one line at start, `staff push capability`, with `state: READY` or `state: DISABLED`
and a `reason` (`NOT_CONFIGURED`, `PUBLIC_KEY_OR_SUBJECT_INVALID`, `PRIVATE_KEY_INVALID`, `KEY_MISMATCH`, `FAKE_IN_PRODUCTION`); a key is never
in that line. The API answers `GET /v1/staff/push/config` with `NOT_READY` until the public key and the subject are valid.
If the API is ready and the worker is not, employees can still subscribe, but no notice is created for push and nothing
is sent until the worker is fixed; only notices created after that are pushed. Neither case changes `/ready`. If the log says `state: UNAVAILABLE` with `reason: SETUP_FAILED` (Redis was not reachable when the worker started), push stays off for that process and no push attempts are written until the worker is restarted: restart it once Redis is up.

**Rotate.** Generate a new pair and replace all three variables together, then redeploy. A push service binds each
subscription to the key it was created with, so **every existing subscription stops working**: the sender revokes a row
whose key id is not the current one (`KEY_ROTATED`) without calling the push service. Each employee repairs it by opening
the staff app once (it unsubscribes and subscribes again with the new key). Do the rotation in this order, because an old worker that is still running would treat a subscription created under the new key as stale and revoke it: stop the worker first, set the three variables, then start the new worker and the API together. Plan the rotation for a quiet hour and tell the
managers there is a gap in delivery until the staff open the app.

**Reading a failure.** `push_attempts.failure_code` says what happened: `SUBSCRIPTION_GONE` (the phone uninstalled or the
user disabled notifications; the subscription is revoked), `SUBSCRIPTION_CHANGED` and `SUBSCRIPTION_REVOKED` (the phone
re-subscribed or signed out before the send; no call was made), `KEY_ROTATED`, `DEADLINE_EXPIRED`, `ADMISSION_REFUSED`
(more than 10 pushes a minute to one subscription), `PROVIDER_4XX` (a 401 or 403 also logs `VAPID_REJECTED`: check the
key pair), `PROVIDER_429`, `PROVIDER_5XX` and `NETWORK_UNKNOWN` (the outcome is unknown and the notice is never repeated).
A `PushSendAuthorized` event that kept coming back undelivered while push was disabled is parked after the outbox's last attempt (log `outbox event parked`); its attempt stays `PENDING` and the notice is not sent unless an operator replays the event after push is enabled. A row stuck in `SENDING` means the worker stopped between taking the send and recording the result; it is never retried.
Logs carry the attempt id, the subscription id, the status code and the failure code only.

## 59-1: bootstrap of rating requests (spec 060 FR-B02b)

The bootstrap schedules the rating requests of the sessions that were recorded before the rating track went live.
It is an operator run, once per company — not a BullMQ job — and it never sends anything by itself.

1. **Order first.** Deploy the worker that carries the 59-1 consumers on **every** replica and wait until all of them
   are running. Every `ServiceSessionRecorded`, `ServiceSessionLinesAdded` and `ServiceLineChanged` published after
   that is consumed live; only the older sessions are left to the bootstrap.
2. **Command.** From the repository root, after the build, with `DATABASE_URL` pointing at `pospay_app`:

   ```sh
   node --env-file-if-exists=.env apps/worker/dist/bootstrap-rating-requests.js --company <uuid> --cutoff <ISO>
   ```

   The cutoff is the job's start minus 48 hours, so every deadline that is still ahead lies inside the range. A
   deadline-free session (a branch with no opening hours) older than the cutoff is deliberately not rated and is not
   counted. The same cutoff reaches the authoritative scheduling decision: an in-range cancelled visit cannot
   create or reopen a request using only an older deadline-free visit. Existing live requests are preserved while
   that older visit remains active; a day with no active visits still cancels its prior request.
   The optional flags are `--checkpoint <uuid>` (resume), `--max-session-id <uuid>` and
   `--recorded-before <ISO>` (reuse the frozen range of an earlier run), and `--page-size <1..200>`.

3. **What it prints.** One line with the frozen range (`range cutoff=… maxSessionId=… recordedAtOrBefore=…`), one
   `frozen expected=<n> alreadyDone=<n>` line with the counts taken when the range froze, one
   `checkpoint=<sessionId> processed=<n>` line after every page, and a final
   `processed=<n> alreadyDone=<n> expected=<n> verifiedExpected=<n> complete=<true|false>` line. The exit code is **1**
   when `complete=false`.
4. **Restart.** Re-run with the last printed `--checkpoint` together with the printed `--max-session-id` and
   `--recorded-before`, so the range stays frozen and the counts stay comparable. A page that fails is read again
   from its checkpoint; the scheduling use case is idempotent.
5. **Stop rule.** A mismatch between `processed + alreadyDone` and `expected` stops the rollout — investigate
   before running the next company. Both counts are frozen before processing. Pages and counts include all
   sessions in the frozen range, including cancelled sessions; the scheduling use case applies the current line
   eligibility. Cancellation therefore cannot change the population being checked. The final count
   `verifiedExpected` must also equal the frozen `expected`: a transaction with an old recording time may commit
   after the initial count and behind the page cursor. On this mismatch, rerun the frozen range without a checkpoint
   so the newly visible sessions are processed; do not continue from the last cursor.
6. **Until 59-2 ships**, the rating-request switch is off for every business, so the bootstrap schedules nothing
   yet; it only proves the frozen range and the coverage.

## 59b-2c: dormant rating discovery and Redis-loss recovery

This procedure is preparation for a separately authorized activation. Production
still installs `closedRatingClaimsLifecycle()`. Do not enable its factory, template
or sender as part of discovery. The seven activation blockers listed in the
[refresh](specs/060-ratings-and-staff-app/59b-2-refresh.md) remain separate work.

1. **Inventory during migrate.** The ADR-0038 step `rating-claims-discovery` uses
   the migration owner's company-ID list, then `withTenant` for inventory and
   appending an empty `RatingClaimsDiscoveryRequested`. The existing dispatcher
   role only checks whether that company's discovery already exists. A previously
   committed, published or parked discovery is not appended again. No new secret
   is required: migrate already receives `POSTGRES_DISPATCHER_PASSWORD`.
2. **Read the counters.** The log prefix `rating_claims_discovery` has `companies`,
   `scheduled`, `sending`, `sent`, `historicalAttempts` and `discoveryEvents`.
   Historical attempts are `rating_request` in `SENDING`, `SENT`, `FAILED`,
   `EXPIRED` or `SUPPRESSED`. If `sending`, `sent` or `historicalAttempts` is
   nonzero during DEP-1, stop any dependent activation and send the counts to the
   manager for the PENDING owner question. Do not reset, replay or resend these
   historical requests or attempts. No staging inventory SQL is authorized by
   this development PR.
3. **Recover registration or a late visit.** After an authorized deploy, wait for
   every replica to carry the current scheduling consumer; stop any older worker
   before freezing a replay range. Build the worker and run from the repository
   root with existing secret delivery for
   `DATABASE_URL` (`pospay_app`), `DISPATCHER_DATABASE_URL` (`pospay_dispatcher`)
   and `REDIS_URL`:

   ```sh
   node apps/worker/dist/recover-rating-claims.js --company <uuid>
   ```

   Run explicitly for each company from the authorized inventory, including a
   company with no new visit since Redis loss. The command builds only the Queue
   registration client, no claim Worker or token capability. It reads retained
   discovery and original visit events, including parked discovery and visits an
   older worker already acknowledged. Visits reach the scheduling consumer with
   their original ID, so a lost commit reply is deduplicated. Discovery only
   repairs registration. Source outbox metadata and existing receipts are never
   reset. A future activation must still supply the real Worker before queued
   claims can execute.
4. **Bound and resume.** A run reads at most 100 pages of 100 events. Its JSON
   result contains `complete`, `afterId`, `throughId`, `replayed`; exit code 1
   means incomplete or failed. Resume a printed incomplete result using
   `--after <afterId> --through <throughId>`, omitting a null flag. An event's ID
   advances the cursor only after registration and scheduling succeed. A thrown
   failure prints `RATING_CLAIMS_RECOVERY_FAILED` with no raw cause; if no cursor
   was returned, restart the prior range from its last reported cursor, or from
   the beginning. Repeating succeeded pages is safe. Once complete, start a fresh
   range to include events committed beyond its captured upper bound.
5. **Stop conditions.** A malformed scope, foreign event, invalid discovery
   envelope, unavailable Redis or database must fail; do not mark source events
   published or unpark them manually. Repair the dependency, rerun the same range
   and verify one scheduler per company. Repeated registration leaves an existing
   valid scheduler and claim continuation state unchanged.

   Explicit checkpoint IDs must exist in this company's retained replay event
   set; a foreign, purged or unrelated cursor and inverted bounds fail with typed
   `REPLAY_SCOPE_INVALID`. Equal bounds are a valid completed range. The CLI checks
   bounds before creating clients; the dispatcher checks scope on its existing
   read transaction without another connection. Company UUID casing is normalized.
   Initial Redis readiness has a 5-second deadline; timeout disconnects the
   reconnecting client, closes the queue and prints `RATING_CLAIMS_REDIS_READY_TIMEOUT`.
