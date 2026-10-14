# Worker operations

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
and the approved leave are created through the API. As the migration owner the seed also writes two
platform grants (`create:companies:platform`, operator `e2e-seed`) and three membership rows: cashier on
the home branch at 1000 bps, cashier on the home branch at 500 bps, and viewer on the foreign branch.
Each run leaves two tenants, three users, two grants, three memberships, and one approved leave, with no
cleanup. Rerun the seed before the suite when the state file is missing.
