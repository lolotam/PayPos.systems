# Worker operations

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

From the lane's worktree root, after copying `.env` from the main checkout:

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
  `127.0.0.1:5432`. Unset, nothing changes: the shared cluster stays the default, and CI is unaffected.
  The vitest global setup of `packages/db`, `packages/auth`, `apps/api` and `apps/worker` all read it.
- The lane name must match `^[a-z0-9-]{1,32}$`. The script only ever removes the container that has both
  the exact name `pospay-test-<lane>` and the lane label; it never touches `pospay-dev-*` or any other
  container, and it refuses ports 5432 and 6379.
- A lane container belongs to the worktree that started it (label `pospay.test-worktree`). `up` or `down` of
  the same lane name from another worktree is refused, so two worktrees never share or remove each other's
  cluster; pick a different lane name per worktree. `status` shows each container's worktree.
- ADR-0006, addendum 2026-10-21, records that a lane cluster is the T2 compose service run a second time.
- Not redirected: Redis (tests still use the shared `127.0.0.1:6379`), `pnpm db:migrate`, and the apps'
  `DATABASE_URL`-style variables. Only the test harness moves.
- Run one lane per worktree: the override file is per worktree. Bring the lane down when the slice is done;
  `docker ps` should show only `pospay-dev-*` again.
- The container does not survive a Docker Desktop restart. If the tests then report that Postgres is not
  reachable on a 554xx port (the hint to run `pnpm infra:up` is for the shared cluster), rerun
  `node scripts/test-db/lane.mjs up <lane>`, or `down <lane>` to fall back to the shared cluster.

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
