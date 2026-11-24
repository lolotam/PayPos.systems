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

## Production deploy

Production runs as the Dokploy compose service `pospay-prod` from `deploy/docker-compose.prod.yml`, with its own
Postgres 18 and Redis 8 containers on the private `pospay-prod-internal` network (ADR-0062 §1). The procedure is the
pinned-compose upload of the pipeline skill §6, applied to the production file: every `${IMAGE_TAG:?}` line is
replaced by one staging-proven SHA, and every production deploy needs Waleed's yes. `postgres` is not pinned by
`IMAGE_TAG` — its `pospay-postgres` image tag is a literal SHA written in the file, changed only in a deliberate
Postgres release with a PP-129 snapshot right before it. Pin that literal on the first published `pospay-postgres`
image after this file merges (and prefer `tag@sha256:<digest>` once pushed, so the bytes are pinned, not the tag).
Before choosing an older SHA for rollback, confirm that SHA still has its images in GHCR — including the
`-prod` front ends (`pospay-admin-prod`, `pospay-pos-prod`), which exist only for SHAs released after PR-A. An
application rollback keeps the `postgres` pin exactly as it is: the database never rolls back with the app, and a
Postgres image change is its own release with its own snapshot. The environment is entered in the Dokploy UI from
`deploy/prod.env.example` (every secret freshly generated, none copied from staging; passwords from a URL-safe
alphabet — compose cannot percent-encode them); compose refuses to run without `TRUSTED_PROXY_CIDRS`. Resolving the
Postgres container, the pgBackRest schedule, the WAL-drop alert and the timed restore drill (the launch gate before
any real data): `deploy/backup/README.md`, Production section, and ADR-0062 §5.

**Production session cookie and staging hosts.** `COOKIE_DOMAIN` defaults to `.pospay.systems`, so the browser
sends the production session cookie to every `*.pospay.systems` host — including the staging hosts under
`*.staging.pospay.systems`. PR-B makes staging refuse it *as a session*, but the browser still sends it, and the
cookie's reach is why a host-only API-host cookie is not a drop-in: the admin's server-side session gate reads the
cookie jar on the admin host (`apps/admin/src/session/api/server-session.ts`, used by `SessionGate`/
`apps/admin/app/(dashboard)/_frame/two-factor-gate.tsx`) and would classify every signed-in user as anonymous, redirecting them to `/login`. Until that is
redesigned, the value stays, and the operator rule holds: **never open staging in a browser profile that holds a
production session** (plan §1, risk row "Production cookie sent to staging hosts").

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
company to the `commissions.project-inputs` consumer alone. Tips are bootstrapped by 50-3b, coverage is checked by 50-3c and the six-type post-rollback replay is 50-3d; until those
land, approval stays closed. Never reset or delete `published_at`, `attempts`, `parked_at` or `consumed_events`; the commissions consumer adds missing consumed marks with the projection.

1. **Every worker replica first.** Roll the release that registers the consumer to every worker replica, or drain the old dispatchers,
   before choosing the upper bound. An old replica could otherwise mark a new event published without applying it.
2. **Run once per company**, from `apps/worker` with the ordinary `DATABASE_URL` (`pospay_app`) and `DISPATCHER_DATABASE_URL`
   (`pospay_dispatcher`):

   ```sh
   node dist/replay-commission-inputs.js --company <uuid> [--after <uuid>] [--through <uuid>]
   ```

   `--after` is only valid together with `--through`; `--after` without `--through` is refused with `COMMISSION_REPLAY_THROUGH_REQUIRED` and nothing is read. A first run has no `--after`; every resume passes `--through`, and passes `--after` only when the printed `afterId` is not null; when `afterId` is null leave `--after` out and resume with `--through <throughId>` alone.

   The entry prints one JSON line: `status`, `afterId`, `throughId`, `handledThroughId` (the last event whose handling finished, informational), per-type `counts`, and `undelivered` (event id, type and error code only,
   never a payload; at most 200, `truncated` tells when more exist; `counts` are per invocation, not cumulative: a resume does not count the events before its `--after` cursor, and an event after a safe cursor that stopped early can be counted again by the next run). Keep the line, the release SHA and the counts in the operations record.
   The exit code is 0 only for `COMPLETE`.
3. **Statuses.**
   - `COMPLETE`: the range up to `throughId` is applied; do not check the inventory from a single printed line, because the printed
     `counts` are per invocation. Use the 50-3c coverage report, or a direct inventory of the consumer's marks for the range up to
     `throughId`; if the printed counts are used instead, add up the counts of every line of the whole run.
   - `PAGE_LIMIT` or `ABORTED`: resume with `--through <throughId>` from the printed line, adding `--after <afterId>` only when the printed
     `afterId` is not null; when `afterId` is null leave `--after` out and resume with `--through <throughId>` alone. `afterId` is the safe resume
     cursor and never moves past the first undelivered event. `ABORTED` means a failure that is not a known business outcome (a database or
     timeout failure), including a failed page read, which still prints the cursors; fix the cause first. If `undelivered` in the line is not
     empty, fix its cause before resuming, otherwise the resume reads the same pages again.
   - `ABORTED` with both `afterId` and `throughId` null: no page succeeded (for example the first page read failed). Fix the cause and re-run as
     a first run, with no `--after` and no `--through`, or with an explicit `--through` if the operator chose one.
   - `UNDELIVERED`: the range finished but some events were not applied for a known business reason. Fix the cause, then resume with
     `--through <throughId>` from the printed line, adding `--after <afterId>` only when the printed `afterId` is not null; when `afterId` is null
     leave `--after` out and resume with `--through <throughId>` alone. `afterId` never skips a failed event. A full re-run **from the beginning**
     with the same `--through` is also valid. Marks make the re-run idempotent.
4. **Legacy `SalaryChanged` without `business_id`** (CS-Q44) is routed through the staff reader on the same transaction. If the employee is not
   found the event stays unmarked and appears as `COMMISSION_EMPLOYEE_BUSINESS_MISSING`: approval stays closed and the manager investigates.
   Do not invent an event, a mark or a grant.
5. **The upper bound is an id bound, not a commit-order proof.** An event whose row commits after the cursor passed it, with a lower id, is
   not replayed; the live consumer delivers it. Do not record "everything up to the bound was replayed" as coverage: coverage is checked by 50-3c.
6. **After any worker rollback then upgrade**, re-run the replay with a new upper bound (CS-Q43). The ADR-0012 pending count, shipped in
   row 53-1, keeps approval closed for any counted event without the consumer's mark. The run to use after a rollback is the six-type run of
   50-3d (`--types six`), because the current-state readers of the first bootstrap cover only the business and date range the operator
   supplied, so tip and package-sale events published during the rollback would stay unmarked. Every re-run states its upper bound:
   captured after every replica runs the consumer, passed as `--through`, reused on a resume, new after any rollback. Since 55-1c a replayed
   `SessionTipsChanged` or `SalaryChanged` aimed at an already APPROVED or PAID month posts `TIP_CARD`/`TIP_CASH`/`COMMISSION` correction
   rows into the earliest DRAFT month, and the manager owns that case. Since 55-2c a replayed event whose closed month cannot be
   priced (`NO_PLAN`/`NO_SALARY`) is consumed and recorded as one open blocked correction for that employee and month (FR-046); it is
   resolved later by a dated salary or by a period repair, which posts the correction normally.
   An open `NO_SALARY` block resolves itself when a later dated salary makes the month price. An open `NO_PLAN` block is cleared
   by the period repair of 55-2f (`POST /v1/businesses/:businessId/employees/:employeeId/commission-period-repairs`, permission
   `manage:commission-plans:business`): one repair plan version that applies only inside that month, a recompute, the posted
   corrections and the resolved block, all in one transaction. If the recompute then needs a missing salary, the same row becomes
   `NO_SALARY` and nothing is posted (the repair version and its audit entry stay). Each saved repair also appends one
   `CommissionPeriodRepairSaved` outbox event (ids and the block outcome only). **Required step of the deploy that ships
   55-2f** (read the next paragraph before deploying). The bell of 55-2d and the list of 55-2e
   (`GET …/commission-blocked-corrections`) expose these rows. To see the open blocks directly, run this read-only query as `pospay_owner`:

    ```sql
    SELECT id, employee_id, source_period, code, first_event_id, target_period, target_statement_id, created_at
    FROM commission_blocked_corrections
    WHERE resolved_at IS NULL
    ORDER BY created_at, id;
    ```

   **Deploy condition for a release that adds an event type or a query parameter (55-2f).** What the staging template does today:
   `deploy/docker-compose.staging-shared.yml` pins every service to one `${IMAGE_TAG}` per release (header, lines 9-11; image lines
   55, 68, 107, 149, 158), and `api` and `worker` each wait only for `migrate` (`depends_on`, lines 100-102 and 139-141), so one compose
   upload starts the new `api` and the new `worker` together and nothing orders the worker before the API. `admin` waits only for
   `api` to be started (lines 151-153). The condition this release needs: every new worker replica is running and knows
   `CommissionPeriodRepairSaved` **before the API that emits it is made available**, then the new API, then the admin (an old API
   answers 400 to the `kind=ordinary` read the new admin sends): after every worker is updated and confirmed, keep the OLD admin
   image pinned until the new API's SHA and readiness are confirmed (`admin` only waits for `service_started`, line 153), then
   update the admin. Confirm it with the image tag of every worker container and the
   PP-133 worker readiness receipt (top of this file). If the template cannot order them, prepare the order first (for example an
   operator-side variant of the uploaded file that pins only `worker` to the new SHA, confirmed, then the whole file); no deploy file
   changes in the PR that ships the event.
   If the condition is not met: an old worker does not know the type, so `apps/worker/src/outbox/deliver.ts` fails the delivery,
   retries with backoff and parks the row after the last attempt (it logs «outbox event parked»). The row has no consumer and no
   business effect, and the type is not one of the six counted by ADR-0012, so approval is not affected. This runbook documents
   **no** operator path to re-queue a parked outbox event (the rule near the top of the replay section forbids resetting
   `published_at`, `attempts`, `parked_at` or `consumed_events` for the counted events, and the dispatcher only parks and retries
   by itself, `packages/db/src/dispatcher.ts`); a parked `CommissionPeriodRepairSaved` can stay parked without losing anything
   today, and re-queuing one later is a reviewed one-off, not a documented step.

   One refusal remains (FR-015):
   `COMMISSION_PERIOD_CLOSED` when no DRAFT target month exists after the source, or when the tips bootstrap touches a closed month
   (CS-Q45); live dispatch retries it and then parks it. Keep the two paths apart: **the replay never mutates the dispatcher lifecycle** —
   it does not set `parked_at`, `attempts` or `next_attempt_at`; it only reports the failure in its `undelivered` list — so a replay mark is
   not evidence that a live park was cleared. A sale or
   refund whose month is `APPROVED` or `PAID` is refused the same way by the 50-4 sale handler and stays unmarked (no `consumed_events` row,
   live or replayed); the `SALE` correction that would release it is 55-1d, and until then a live parked sale event holds its sale's later
   events because the dispatcher delivers one aggregate in order.
7. **Logs.** A failed replay of a row that already has ten or more attempts logs «outbox event parked» at error level although nothing is
   written; read the printed result, not that line.

## 50-3b: bootstrap the current session-tip state (spec 059, FR-020)

Applies the latest saved tip revision of each visit to the commissions projection and records every listed tip event as consumed by
`commissions.project-inputs`. It reads the current state through `listCurrentSessionTips` (`packages/db`), not the outbox, so it never
touches `published_at`, `attempts`, `parked_at` or `consumed_events` rows of other consumers. No migration, role or grant is involved.

1. **Every worker replica first**, exactly as in 50-3a item 1: the release that registers the consumer must run on every replica before
   the bootstrap starts, so a revision written meanwhile reaches the live consumer.
2. **The operator supplies the scope** (CS-Q41..CS-Q44, Q3): no enumerator exists, so take the business ids and the business-day range
   from the release inventory. The range must cover every business day that has tips; a visit outside it is not covered and approval stays
   closed until the 50-3c coverage report shows no gap. Run once per company, from `apps/worker`, with the ordinary `DATABASE_URL`
   (`pospay_app`) only:

   ```sh
   node dist/bootstrap-session-tips.js --company <uuid> --businesses <uuid>[,<uuid>...] --from YYYY-MM-DD --to YYYY-MM-DD
   ```

   At most 200 business ids. A missing or malformed argument (including a malformed company id, business id or date) prints
   `SESSION_TIPS_BOOTSTRAP_CONFIGURATION` and reads nothing; a date range with `--from` after `--to`, or a date that does not exist
   on the calendar, prints `SESSION_TIPS_BOOTSTRAP_RANGE_INVALID`; a failure while reading a page or applying a visit prints the
   JSON result with `status: "ABORTED"` and exits 1 without an error code, and `SESSION_TIPS_BOOTSTRAP_FAILED` is printed only for
   a failure outside a page or visit (the database connection or ping failing, or the connection closing badly).
3. **What one run does.** Per business, pages of 100 visits; each page is READ in its own tenant transaction, and each visit is
   applied in its OWN tenant transaction: every event id the reader lists for that visit, including older revisions, is marked
   consumed first, in the same order as live delivery, then the latest revision is applied through the same use case the live
   consumer uses (a revision lower than or equal to the saved one is ignored); the mark and the projection commit together or not
   at all. A visit's locks are released when its transaction commits, before the next visit starts. A visit that fails keeps its
   event ids unmarked. A revision written after the page was read is delivered by the live consumer, which applies it because its
   revision is higher. The business ids are lower-cased and de-duplicated in the order they were supplied. `counts.sessions` is the
   number of visits whose transaction committed and `counts.events` is the number of event ids this run claimed anew.
4. **Output.** One JSON line: `status`, `counts` (`sessions` and `events`, per invocation), `undelivered` (visit id, business id and error
   code only, never an amount or an employee; at most 200, `truncated` tells when more exist) and `abortedAt`. The exit code is 0 only for
   `COMPLETE`. Keep the line, the release SHA and the scope in the operations record.
5. **Statuses.**
   - `COMPLETE`: every visit in the scope was applied and marked. This is not a coverage proof; coverage is checked by 50-3c.
   - `UNDELIVERED`: the scope finished but some visits were refused for a known business reason: `COMMISSION_PERIOD_CLOSED` (the month is
     APPROVED; the tips **bootstrap** visit stays refused even after 55-1c — a correction needs a real `event_id`, and whether a
     bootstrap visit may ever post one is CS-Q45, still PENDING — and the manager owns it), `COMMISSION_PERIOD_ROLLED_OVER` (the month
     changed between the delivery's two current-month reads; nothing was written, and re-running applies the visit as-is),
     `COMMISSION_BUSINESS_MISSING` or `COMMISSION_TIP_SALARY_INPUT_INVALID`. Fix the cause and re-run the same command; applied visits are
     not applied twice.
   - `ABORTED`: a failure that is not a known business outcome (a database or timeout failure). The visits that committed stay
     committed; `abortedAt` names the business and the cursor of the page that was being processed and is informational only. Fix
     the cause and re-run the same command from the start: the revision guard and the consumed marks make it idempotent.
6. **First run only.** After any worker rollback then upgrade, do not use this reader: it covers only the businesses and days supplied and
   the revisions that exist when it runs, so tip and package-sale events published during the rollback would stay unmarked and keep
   approval closed. Use the six-type retained-event replay of 50-3d with a new upper bound (CS-Q43, PP-185 item d).
7. **Do not** insert a mark or an event by hand and do not reset any outbox column; the remedy for a missing visit is to re-run with a
   scope that covers it.

## 50-3c: check that the projection covers every retained input (spec 059, CS-Q41, CS-Q42)

A read-only report of one company: the retained service lines and the retained salaries (the projection revision against the
source revision) and the retained events that still lack the `commissions.project-inputs` mark. It writes nothing and locks nothing:
no `published_at`, no `attempts`, no mark and no projection change.

1. **What it does.** It compares the projection's revision with the source's revision for every retained line and salary of the
   company, and it lists the retained events that carry no consumer mark. A retained event whose type the consumer does not handle is
   listed apart, under `notHandled`, because it is waiting for a handler rather than missing a mark. Nothing else is read and nothing is
   written.
2. **Command.** From `apps/worker`, with the ordinary `DATABASE_URL` (`pospay_app`) and `DISPATCHER_DATABASE_URL`
   (`pospay_dispatcher`):

   ```sh
   node dist/report-commission-coverage.js --company <uuid> [--through <uuid>] --businesses <uuid>[,<uuid>...] --from YYYY-MM-DD --to YYYY-MM-DD
   ```

   Run it after the 50-3a replay and the 50-3b bootstrap finished.
   **The replay's cutoff and the coverage proof's cutoff are two different things.** The 50-3a replay bound (its `--through`) is chosen
   over four event types; this report chooses its bound over six, so the two `throughId` values can legitimately differ (a retained tip or
   package-sale event with a higher id that existed before the replay and is already marked). Do not require them to match, and a
   difference is not a reason to replay again.
   `--through` here makes a **bounded** check, useful to verify a given replay up to that id. **The evidence used to open approval is ONE
   run with no `--through`, taken in the quiet window (below), naming every business;** the printed `throughId` is the bound it proved up
   to, and it is what is recorded with the proof. The two findings have **different remedies**. An `unmarked` retained event is replayed (the
   six-type retained replay of 50-3d, not the four-type one) and the report is run again. A `notHandled` event
   (`COMMISSION_EVENT_TYPE_NOT_HANDLED`) keeps approval closed and is **not** fixed by a replay, because the replay delivers only the event
   types the consumer registers: first correct the worker release or the handler registration so that the type is handled, then replay,
   then run the report again. After 50-4 a `notHandled` event is a configuration gap, never an expected wait. If a run cannot prove the
   whole scope, approval stays closed.
   Without `--through` the bound is **not** taken when the command starts: lines, salaries and sales are scanned first, then the bound is
   the highest id among **all** of the company's retained events of the six counted types, read once before the first retained-event page is
   fetched (not the maximum of the first page). Do not treat `throughId` as a start-up cutoff; that is one more
   reason to take the run in the quiet window. Compare `throughId` values as UUIDs, ignoring letter case: a supplied `--through` is
   printed as typed, while an automatic one comes from PostgreSQL in lower case.
   **The retained-event mark check ends at the printed `throughId` and nothing after it is looked at.** A counted event created after that
   bound can lack its consumer mark while the tip, line, salary and sale revisions already match the source, and the report still prints
   `COVERED`; the quiet window is what guarantees that nothing counted is created after the bound.
   The tip flags are all three or none, and **only a run that carries them can print `COVERED`**: they add the tip coverage by revision
   over the business ids and the business-day range the operator supplies (at most 200 business ids, `from` not after `to`). A run
   without them still checks lines, salaries, sales and the retained events, but it prints `NOT_COVERED` with `tips: null` and the
   `tipsNote`, and exits 1: tips that were not checked are never counted as covered. There is no default to all businesses: the operator
   names the scope.
   **`COVERED` proves the printed scope only** (`tipScope`: the business ids and the business-day range that were checked). A run over
   some of the company's businesses, or over part of the business days that have inputs, is not a proof for the company. The
   report cannot infer completeness, so the operator step that opens approval requires a run whose `--businesses` lists **every business of
   the company** and whose range covers **every business day that has inputs**; the enablement decision checks `tipScope` against that.
   One run must name every business: nothing composes several runs into a company-wide `COVERED`. `--businesses` takes at most 200 ids and
   the code has no limit on how many businesses a company can have (`create-business` counts nothing and `plans` carries feature flags
   only), so a company with more than 200 businesses cannot be proved by this tool: approval stays closed for it and the case is escalated;
   do not raise the limit and do not split the run.
   **Take the run that opens approval while the company's inputs are quiet:** the consumer has caught up and no session, tip, salary or
   package-sale write is in flight. The sections are read in separate transactions (see item 5), so a run taken during writes proves nothing.
3. **Output.** One JSON line: `status` (`COVERED` only when lines, salaries, sales and tips were all checked and no check found a gap,
   an unmarked retained event or an unhandled type; otherwise `NOT_COVERED`), `throughId`, `lines`, `salaries` and `sales` (each with `checked`,
   `missing` and `stale`, each list carrying its `total` and at most 200 ids; a salary id is `employeeId|YYYY-MM-DD`, a sale id is the entitlement id), `unmarked`
   (`checked`, `total` and `events` with `eventId` and `type`, at most 200), `notHandled` (`total` and `events` with `eventId`, `type`
   and the fixed `reason` `COMMISSION_EVENT_TYPE_NOT_HANDLED`, at most 200), `tips` (`checked`, `missing` and `stale` with the same
   shape as the lines, or `null` when no tip scope was supplied), `tipsNote` (one line saying the tip coverage was NOT checked and how to
   check it, or `null` when it was), `tipScope` (`businessIds`, `from` and `to` that the tip check covered, or `null` when it did not run)
   and `truncated`. Ids and counts only,
   never an amount and never a name. The exit code is 0 only for `COVERED`.
4. **Remedy.** A `missing` or a `stale` line or salary, or an unmarked event whose retained event exists: re-run the 50-3d six-type
   replay (`--types six`) for the company with a bound captured as that section describes, then re-run this report with no `--through`. Do not use the 50-3a four-type run for this: it
   is filtered to the four origin types and cannot replay a retained `SessionTipsChanged` (or `PackageSaleChanged`) event. If a line or a salary stays missing and no retained event exists
   for it, the replay cannot recover it: approval stays closed and the manager investigates (re-emitting an event is not designed).
   Do not insert a mark or an event by hand.
5. **Limits.** The retained-event check covers the six counted types (`ServiceSessionRecorded`, `ServiceSessionLinesAdded`,
   `ServiceLineChanged`, `SalaryChanged`, `SessionTipsChanged` and `PackageSaleChanged`), and every retained `SessionTipsChanged` event id
   must carry the consumer's mark: that is the tip event-id check. The tip coverage by revision is bounded by the operator's scope, so the
   company-wide guarantee stays with the retained-event check, up to the printed `throughId`. The report is **not a point-in-time snapshot**: lines,
   salaries, sales, the retained events and the tips are read in separate transactions, and each page in its own. With a fixed `--through`
   a concurrent write can make it print `COVERED` although no single moment had every section covered; a row written while it runs is
   delivered by the live consumer. **Accepted design, implemented in 53-2 B1/B2 (ADR-0054 addendum 2026-11-22, accepted by CS-Q55 and CS-Q55-ب on 2026-11-23):** the 53-2 approval gate will not rely on this report at approval time but will read a stored bootstrap coverage proof, issued only from a full `COVERED` run in the quiet window and invalidated when the coverage conditions change **through the paths the database or the runner enforces (a release migration, a writer that goes through the runner or the invalidator, a refused outbox delete)**. It is **not** invalidated by a physical fork, a partial restore, a selective purge, a projection rollback or a writer that bypasses the runner; each of those is an operator procedure listed in ADR-0054 addendum 2026-11-22, section 12, items 3 and 4 (CS-Q54, CS-Q55). **Issuance is live since 53-2 B1 and B2:** the commands in the sections «53-2 B1: enable approval for a company» and «53-2 B2a: coverage and approval operator procedures» below issue, invalidate and switch; a bare `COVERED` print without `--issue-proof` is still not a proof.
   **A tenant with any retained `PackageSaleChanged` event is now checked like the other counted types (50-4 registered the handler)**:
   since 50-4 the sale type is registered by the consumer, so a retained sale event without its mark is listed under `unmarked` like any other
   counted type, and the report's `sales` section compares every sold package's revision with the projection (`missing`/`stale`). `notHandled` is
   reserved for a type the consumer does not register at all — after 50-4 that is a real configuration gap, not an expected wait. While any sale
   stays missing or stale, the 55-1b R5 prerequisite ("coverage shows no gap before the first correction posts") is blocked for the tenant.
6. **Refusal.** Two layers, with two codes.
   - **The command line** prints `COMMISSION_COVERAGE_CONFIGURATION` and reads nothing for a malformed or partial tip scope while parsing its
     arguments, before the report runs: a business id that is not a UUID, an empty `--businesses`, a date that is not `YYYY-MM-DD`, `from`
     after `to`, more than 200 business ids, or only some of the three flags.
   - **The report itself** refuses with the fixed code `COMMISSION_COVERAGE_SCOPE_INVALID`, prints no report and exits 1. It does so
     **before any scan** for the company and business validation: the company does not exist, or a business in `--businesses` is not a
     business of that company (another company's or an unknown id). A direct caller of the use case also gets `COMMISSION_COVERAGE_SCOPE_INVALID`,
     before any scan, for an empty list, a business id that is not a UUID and `from` after `to`, which the command line has already refused
     with the other code.
   - **A replay bound that is no retained event is refused later, after the scan.** An otherwise valid `--through` that is not the last
     retained event of that company at or below the bound among `ServiceSessionRecorded`, `ServiceSessionLinesAdded`, `ServiceLineChanged`,
     `SalaryChanged`, `SessionTipsChanged` and `PackageSaleChanged` is refused with `COMMISSION_COVERAGE_SCOPE_INVALID` only after the report
     has scanned the lines, the salaries, the sales and the retained-event range, because the check compares the last event it read with the
     bound. It prints no report and exits 1; it is not a cheap pre-check.

## 53-2 B1: enable approval for a company

Only the authorized operator runs these commands, for one company in the verified environment and a quiet window
covering the whole report and any repair/data-step run. `platform:commission-approval` uses `MIGRATION_DATABASE_URL`
as `pospay_owner`, like `platform:grant`. Issuance uses `DATABASE_URL` as `pospay_app` for source reads under
`withTenant` and `DISPATCHER_DATABASE_URL` as `pospay_dispatcher` for the limited 0250 functions; no Redis is needed.
Supply every company business and a tip range covering all historical input days through PostgreSQL's UTC day plus one.
The output contains only status, ids, counts, bounds, generation and rules version; never paste credentials.
Build the current release first (`pnpm exec turbo run build --filter=@pospay/worker...`); issuance runs its compiled CLI.

**Pre-checks before any command (ADR-0054, bootstrap addendum §12):**

1. **Fork / repair condition:** confirm this database is not a fork of another environment or an unrestored copy. If it
   was forked or restored, the fork procedure ran first (approval switch off, generations bumped), and the routing
   check below is confirmed again for this run.
2. **Same primary, not a replica:** the report and the issuance must run against the SAME primary database. The CLI
   verifies that both connections report the same database name and cluster system identifier and refuses a standby
   (`pg_is_in_recovery()`), but the operator confirms the URLs themselves point to the intended primary before the run.
3. **Quiet window:** no data step, repair, replay or release migration is running or planned for the whole operation,
   pauses and failed runs included. Issuing during any data step is forbidden; after the run finishes, the affected
   projections are **verified by the release-specific check first** — a projection can carry a current revision with
   an old-rule effect, so "the operation is no longer running" is not evidence — and only then does the single
   resume order (enable → new report → new proof) apply (see «53-2 B2a: coverage and approval operator procedures»).

**Order: enable → dry-run report → issue → approve; enable bumps the generation and invalidates any earlier proof
(ADR-0054, bootstrap addendum §9), so switch-on without a current proof still refuses approval.**

```sh
pnpm platform:commission-approval --company <uuid> --show
pnpm platform:commission-approval --company <uuid> --enable --reason <reason> --operator-email <operator-email> [--expires <ISO-instant>]
pnpm platform:commission-coverage --company <uuid> --businesses <uuid>[,<uuid>...] --from YYYY-MM-DD --to YYYY-MM-DD --run-id <run-label> --release <release-label> --dry-run
pnpm platform:commission-coverage --company <uuid> --businesses <uuid>[,<uuid>...] --from YYYY-MM-DD --to YYYY-MM-DD --run-id <run-label> --release <release-label>
pnpm platform:commission-approval --company <uuid> --show
```

Dry-run writes nothing. A refusal exits non-zero without issuing; fix the cause and repeat the full report.
`COVERAGE_TIP_BOUND_MOVED` means repeat with the new PostgreSQL bound. A successful re-run issues a new proof on the
next generation after verifying again. `SWITCH_ON_NO_CURRENT_PROOF` means the switch alone has not opened approval.
The operator email must resolve to an existing user holding an **active platform grant** (`platform_grants`, the same
condition the platform sessions use); a company approver without one is refused (`COVERAGE_OPERATOR_NOT_PLATFORM`).
The lookup is the same one `platform:grant` uses (`userIdOf`: `email = lower(input)`), so the two tools resolve the
same user or both refuse; an email differing from another user's only by letter case never matches both. Refusals write
nothing: no state, no switch, no audit row. Audit stores `user:<id>` and that UUID, never the email.
`--expires` takes a full ISO-8601 instant with an explicit `Z` or numeric offset only (a date-only value, a timestamp
without an offset or a rolled date such as 31 February is usage-refused), and an expiry already past PostgreSQL's clock
is refused after the state-row lock and before the generation bump, so a refused enable writes nothing.

**Mandatory activation gate:** the staging measurement is a **TRIAL run done BEFORE enabling the target company**, never
on the target company itself. Measure one real approval on staging against a large, fully consumed history and record
the elapsed time. A company is enabled only if this measured approval is **under 200 ms**; otherwise that company's
switch stays off and the owner decides. The staging measurement is a separate operator receipt, not proved
by shipping this CLI or its integration tests.

To close approval (also invalidates the current proof), use:

```sh
pnpm platform:commission-approval --company <uuid> --disable --reason <reason> --operator-email <operator-email>
```

## 53-2 B2a: coverage and approval operator procedures

Everything in this section is an **operator obligation, not database enforcement**, exactly as ADR-0054 addendum §12
accepts it (CS-Q55, «اقبل الإجراءات الموثقة للحالات دي» and «اقبل الإجراءات في الحالات الثلاث»). The database
enforces only two things automatically: a release migration's version bump, and a write path or declared data step
that calls `invalidate_commission_coverage`. The refusing triggers **refuse** a delete or truncate — they never
invalidate a proof — so every other case below leaves a stale proof current unless the written procedure is followed.

**Reading `--show` (one read-only snapshot, writes nothing):**

- `switch_enabled` — the explicit override `commission_statement_approval` is open (an override row exists,
  `enabled`, `expires_at` null or in the future). This is the switch, nothing else.
- `generation` — the company's coverage generation; every bump (enable, disable, invalidation, issuance) raises it.
- `proof_current` — a stored proof exists whose `generation` equals the state generation and whose version, counted
  types, consumer id, database name and system identifier all match the current release. Only this proof opens
  approval, together with the switch and a zero pending count.
- `status`:
  - `SWITCH_OFF` — approval refuses `403 FEATURE_DISABLED`; enable it before issuing anything.
  - `SWITCH_ON_NO_CURRENT_PROOF` — the switch alone opens nothing; approval refuses `422
    COMMISSION_COVERAGE_NOT_PROVEN`. Run the coverage report and issue a proof (B1 order: enable → dry-run → issue).
  - `SWITCH_ON_CURRENT_PROOF` — the gate will check the pending count and the fingerprints at approval; if a source
    write happened outside its event, invalidate and re-issue (procedures below).
- **A current proof and an open switch still do not mean a given business or month can be approved.** Approval is
  decided per statement at the endpoint: the statement's business must be in the proof's `business_ids`, and the
  month must be admitted by the proof's tip bounds (ADR-0054 addendum «Month, in days»: a month with first day `F`,
  last day `L` and the proof's bound `U` is admitted only if `F > U`, or `tip_from <= F` and
  `tip_to >= min(L, U)`); the pending count and the fingerprints are checked last. `--show` never evaluates those —
  it reports the switch, the generation and the current proof only.

**Refusal codes and their remedies:**

| Code | Where | Meaning | Remedy |
| --- | --- | --- | --- |
| `403 FEATURE_DISABLED` | approval endpoint | The explicit switch is off, expired, or absent (a plan flag never opens it) | Enable with the audited command, then follow the single resume order |
| `422 COMMISSION_COVERAGE_NOT_PROVEN` | approval endpoint | No current proof (never issued, invalidated, or behind the generation) | Issue a new proof from a full `COVERED` run |
| `409 COMMISSION_UPDATES_PENDING` | approval endpoint | A counted event has no consumer mark (ADR-0012 count) | Replay the six-type events (50-3d), then re-issue |
| `COMMISSION_COVERAGE_CONFIGURATION` | coverage CLI | Malformed or partial command line (a bad business id, a bad date, `from` after `to`, more than 200 business ids, or only some of the three tip flags) — refused while parsing, before anything is read | Fix the arguments; nothing was read |
| `COMMISSION_COVERAGE_SCOPE_INVALID` | coverage report | **Early (before any scan):** the company does not exist or a business in `--businesses` is not the company's. **Late (after the scan):** a `--through` bound that is not the last retained counted event at or below it — the check compares the last event read with the bound, so it cannot be a cheap pre-check | Correct the scope; an early refusal scanned nothing, a late one leaves nothing written |
| `COVERAGE_OPERATOR_INPUT_INVALID` | issue CLI / switch command | Malformed operator input (labels over 100 characters, a bad `--expires` instant, a missing company id, more than one action) | Fix the usage line printed with the refusal; nothing was read or written |
| `COVERAGE_CONFIGURATION_INVALID` | issue CLI | `DATABASE_URL` or `DISPATCHER_DATABASE_URL` is missing in the environment | Run from the worker's built artifact with both variables set |
| `COVERAGE_DISPATCHER_REQUIRED` | issuance | The issuing connection is not the `pospay_dispatcher` role | Point `DISPATCHER_DATABASE_URL` at the dispatcher credential; never substitute the owner or app role |
| `COVERAGE_REPLICA_REFUSED` | issuance | The issuing connection reports `pg_is_in_recovery()` (a standby) | Run issuance against the primary only |
| `COVERAGE_COMPANY_NOT_FOUND` | switch command / 0250 functions | The company id is unknown or deleted | Check the id; the switch command leaves no state row behind |
| `COVERAGE_REPORT_NOT_COVERED` | issuance | A report that is not `COVERED`, or one with truncation, an unchecked tip scope, unmarked or unhandled events, was fed to the verifier | Fix the report's cause first; a partial report never issues |
| `COVERAGE_TIPS_AFTER_BOUND` | issuance | The tip existence check found a tip record beyond the verified bound | Stop issuing; investigate the source row, then a fresh full report and issuance |
| `COMMISSION_COVERAGE_EVENT_INVALID` | coverage report | A retained event outside the reported company's scope was seen | Investigate the event's `company_id`; the report refuses rather than attribute it |
| `COVERAGE_PAGE_LIMIT_INVALID` | coverage readers | A coverage reader was called with a page limit outside its 1…500 contract | An internal contract error; report it, do not retry the same command |
| `COVERAGE_TENANT_MISMATCH` | tips existence reader | The reader ran without the company's `withTenant` context | An internal contract error; report it — never work around it outside `withTenant` |
| `COVERAGE_ROWS_ARE_APPEND_ONLY` | coverage tables | An `UPDATE`/`DELETE`/`TRUNCATE` of a proof row, or a `DELETE`/`TRUNCATE` of a state row, is refused — it does not invalidate anything, even for the owner session | Use `invalidate_commission_coverage` to raise the generation; fixtures clean under `session_replication_role = replica` |
| `COUNTED_OUTBOX_DELETE_REFUSED` | `outbox` | A `DELETE` of a counted outbox row or any `TRUNCATE` of `outbox` is refused — it does not invalidate a proof | Follow the selective-purge owner procedure (bump first, drop and recreate the guards in one transaction) |
| `COVERAGE_TIP_BOUND_MOVED` | issuance | The PostgreSQL UTC day bound moved (a run crossed midnight) | Repeat the full report and issuance with the new bound |
| `COVERAGE_UNMARKED_EVENTS` | issuance | A counted event at or below the verified bound has no mark | Replay (50-3d), then re-run and re-issue |
| `COVERAGE_REPORT_BOUND_AHEAD` | issuance | The report's bound is ahead of the database's own maximum | The report ran against a different or lagging copy; check routing, then repeat |
| `COVERAGE_DATABASE_MISMATCH` | issuance | The report and issuance connections reach different databases or clusters | Stop; confirm the two URLs hit the same primary, then repeat |
| `COVERAGE_GENERATION_MOVED` | issuance | The generation moved between sampling and issuance (another bump won the lock) | Repeat the full report and issuance on the new generation |
| `COVERAGE_VERSION_REFUSED` | issuance | The proof version does not equal `commission_coverage_required_version()` | A release migration is missing or unapplied; run `migrate` before issuing |
| `COVERAGE_SCOPE_INCOMPLETE` | issuance | The business list is not exactly the company's, or `tip_to` is before the day bound | Name every business and a tip range through the bound, then repeat |
| `COVERAGE_REASON_INVALID` | invalidation | The reason must match `^[A-Z][A-Z_]{1,49}$` | Use an uppercase reason code such as `SOURCE_WRITE` |
| `COVERAGE_OPERATOR_NOT_FOUND` / `COVERAGE_OPERATOR_NOT_PLATFORM` | switch command | The operator email resolves to no user (the shared `userIdOf` lookup of `platform:grant`), or to a user without an active platform grant | Use the operator's exact platform email; grant the platform permission first |
| `COVERAGE_EXPIRY_IN_PAST` | switch command | `--expires` is already past PostgreSQL's clock | Supply a future instant; nothing was written |
| `COMMISSION_EVENT_TYPE_NOT_HANDLED` | coverage report | A retained event type has no registered consumer | Fix the worker release/handler registration first; a replay does not fix this |

**What invalidates a proof automatically (enforced), and what does not (procedures below):** enforced — a release
migration that replaces the version function and bumps the generations; any covered write path or data step declared
`INVALIDATES` that calls `invalidate_commission_coverage` through its runner. The refusing triggers are **guards,
not invalidators**: they refuse a `DELETE`/`TRUNCATE` on the counted `outbox` rows or the coverage tables, and a
refused statement changes no generation — the proof stays as it was. **Not enforced** — a physical fork or a
same-identity restore, a partial restore, a selective purge run by an owner session that skips the bump, a
projection removal or rewind, a worker rollback across a projection-semantics change, and a writer that bypasses
the runner and its declaration. Each has the procedure below.

**Repair and data-step windows (ADR-0054 §12 item 3(d)):** before any repair, import or multi-batch data step that
can write covered source rows: switch approval **off** with the audited command and stop issuance for the whole
operation — pauses, retries and failed runs included; the switch stays off until the operation has finished
successfully. **Before activation resumes, verify the affected projections** — for a coverage-changing release or a
repair that touches how a counted event is projected, run the release-specific projection check (a projection can
carry a current revision with an old-rule effect; stopping the operation alone is not evidence). Then the **single
resume order**, everywhere: the audited enable (it bumps the generation first) → approval answers `422
COMMISSION_COVERAGE_NOT_PROVEN` until it is done → a full new report → a new proof issued on that post-enable
generation → approval passes. The older wording «new report, new proof, then enable» was self-contradictory: the
enable itself invalidates every proof, so the proof must be issued **after** it.

**Worker rollback across a projection-semantics change (ADR-0054 §12 item 3(c), #1223 item 14).** The rollback is
itself a coverage-changing operation — an old processor that returns after a new proof can mark events under the old
rules. The one order:

1. **Before** the older worker starts: switch approval **off** with the audited command (it bumps the generation),
   so approval refuses `403 FEATURE_DISABLED` and the previously issued proof is no longer current (ADR-0054 §10
   test 13 asserts both before the rollback).
2. Roll the worker back.
3. The switch **stays off** until the matching processor is restored and the affected projections are rebuilt or
   verified by the release-specific check (a mark plus a matching revision alone is not evidence of the new
   semantics; an ordinary replay is not assumed to re-create marks that already exist).
4. Then the single resume order: audited enable → `422` → full new report → new proof on that generation → approval
   succeeds.

Limit the owner accepted: an old processor can commit an old-rule projection and its mark **before** it stops; only
the release-specific check catches that, and an older worker still running can mark an event after a new proof —
stop every replica before the proof.

**Fork or restore that keeps the database identity (§12 item 4(a)).** Before any API starts on the copy: switch every
override of the new environment **off** through the audited command (it bumps the generations) and verify
operationally that the report connection and the issuing connection are routed to the same actual database. **That
routing check is required before the first issuance and again before every issuance or re-issuance in the forked
environment; if the routing cannot be confirmed for the run, there is no issuance.** The CLI's same-database check
is best effort against a wrong URL and cannot detect the copy. A fork stays closed until this procedure runs: a
proof copied with the data is current, and approval is open wherever the override was copied on.

**Partial restore of outbox rows, marks, source rows or a covered projection table (§12 items 4(b)/4(c)) and
selective purge of counted outbox rows (§12 item 3(a)).** One owner transaction: **bump the affected generations
first** (`UPDATE commission_coverage_state SET generation = generation + 1`, taking the state-row locks, so it
queues behind any in-flight approval), then make the change, and — for a purge — drop the refusing guards and
recreate them **before `COMMIT`**, so an approval never sees a window without guards. Test fixtures that clean
`outbox` or `companies` as the owner session run under `session_replication_role = replica` through the shared
helper, never by dropping the guards casually. Limit the owner accepted: a restore or purge that skips the bump
leaves the old proof current over data it no longer matches.

**Coverage-changing release migration (§12 item 3(c)).** `migrate` runs **before** new containers, and there is **no
issuance and no first-time state row for any company** while the migration runs. The migration replaces, together,
the proof version, the issuer's constants, the outbox guards' type list and the ADR-0012 pending-count function, and
bumps the generations. When a release changes how an existing counted event is projected, stop the older-release
processors **and** rebuild or verify the affected projections with the release-specific check before any
re-issuance; then the single resume order above.

**Runbook obligation recap (ADR-0054 §12):** (a) selective purge — bump-first owner transaction with guards
recreated before commit; (b) new source-row writers — runner declaration `coverage: 'INVALIDATES'`, runner bumps in
every transaction, the source-scan test refuses a period lock or an undeclared covered write; (c) coverage-changing
release and worker rollback — migrate before containers, no issuance during the migration, projections verified
before re-issuance, switch off and bump before the rollback; (d) repairs and data steps — switch off, no issuance,
then the single resume order; 4(a) fork routing check before the API starts and before every issuance; 4(b)/4(c)
partial restore and projection rewind — bump-first owner transaction.

## 50-3d: replay all six counted types after a rollback (spec 059, CS-Q43)

Replays the retained events of all six counted types of one company to the `commissions.project-inputs` consumer alone, through the
six-type facade `commissionRetainedEventPage` and its own partial index. It never resets or deletes `published_at`, `attempts`,
`parked_at` or `consumed_events`; the consumer adds the missing consumed marks with the projection.

1. **Command.** From `apps/worker`, with the ordinary `DATABASE_URL` (`pospay_app`) and `DISPATCHER_DATABASE_URL` (`pospay_dispatcher`):

   ```sh
   node dist/replay-commission-inputs.js --company <uuid> --types six [--after <uuid>] --through <uuid>
   ```

   `--types` is `four` (the default, the 50-3a run) or `six`; any other value is refused with `COMMISSION_REPLAY_CONFIGURATION` before
   anything is read. `--after` is only valid together with `--through`, exactly as in 50-3a, and the result line, the statuses and the
   resume contract are the ones of 50-3a.
2. **The upper bound is fixed for the whole run.** Capture it after every worker replica runs the consumer, pass it as `--through`, and
   reuse the same bound on every resume of that run. After any rollback, take a NEW bound: a bound taken before the rollback does not cover
   the events the rollback left behind. The bound is an id bound, not a commit-order proof: an event whose row commits after the cursor
   passed it, with a lower id, is not replayed by this run and the live consumer delivers it.
3. **`PackageSaleChanged` is delivered since 50-4.** The consumer registers the sale type, so the runner passes retained sale events to it
   and each successfully applied one is marked like the other counted types; a sale whose month is `APPROVED` or `PAID` is refused with
   `COMMISSION_PERIOD_CLOSED` and lands in `undelivered` with that code, unmarked (the `SALE` correction that releases it is 55-1d). This is
   the replay path: the runner mutates no dispatcher lifecycle column, so an event that live dispatch has parked stays parked — a replay mark
   here is not evidence that a live park was cleared (section 50-3a item 6). A type the consumer does not register at all is
   still listed with `COMMISSION_EVENT_TYPE_NOT_HANDLED` — after 50-4 that means a configuration gap, never an expected wait.
4. **Coverage.** Run the 50-3c coverage report after the replay, with the tip scope flags (every business of the company, every business
   day with inputs; without them it cannot print `COVERED`). The report now checks the sales section too: every sold package of the company
   must have a `commission_sales` row at the revision orders holds (CS-Q51 answer, 2026-11-21: the replay projects and marks, the reader proves
   coverage). While a sale is `missing` or `stale`, the report is `NOT_COVERED` and the 55-1b R5 prerequisite stays blocked for that tenant.
5. **Do not** insert a mark or an event by hand, do not reset any outbox column, and do not widen the range beyond the fixed bound.

## 50-4: bring package sales into the commission inputs (spec 059, CS-Q51)

The consumer now registers `PackageSaleChanged`, so sales recorded before this release reach the projection through the ordinary
six-type replay (owner answer CS-Q51, 2026-11-21: the replay projects and marks, the reader proves coverage). The order for one company:

1. Every worker replica must run the new release first (the every-replica rule of 50-3a).
2. Capture the replay upper bound `--through` after the last replica is on the release.
3. Run the six-type replay with that bound and resume with the same bound until it ends `COMPLETE`
   (section 50-3d). A sale whose month is closed is refused with `COMMISSION_PERIOD_CLOSED` and stays unmarked
   until 55-1d. The replay lists it under `undelivered` and leaves the dispatcher state intact. A live park
   requires a separate dispatcher recovery decision.
4. Run the 50-3c coverage report with the tip scope flags (every business of the company, every business day with inputs). Require `COVERED`, `sales.missing.total = 0`, `sales.stale.total = 0`, and no
   `PackageSaleChanged` under `unmarked` or `notHandled`. Migration 0234 creates an empty `commission_sales` table,
   and 0235 adds its indexes and access controls. The replay fills the table.
5. If the replay returns `COMPLETE` but a sale is missing or stale, keep approval closed for that company.
   Check the reported sale ID and source revision against the retained `PackageSaleChanged` events in the fixed
   range. If no usable event covers the revision, stop repeating the same replay and escalate for source-history
   investigation. Keep dispatcher state and consumption marks unchanged.

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
