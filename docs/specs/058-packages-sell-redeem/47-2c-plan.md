# 47-2c plan — package import commit transport and recovery sweep

Feature: spec 058 row 47-2 (Story 7, import open packages) — «استيراد الباقات المفتوحة: نقل أمر التثبيت ومسح الاسترداد».
Tier: HEAVY (money: imported session balances). Branch `feat/058-47-2c-import-commit-transport`,
base `origin/main` 61d576d25. Plan author: Claude Fable 5.2 (medium).

## 1. Goal and boundary

47-2b merged the financial use case `CommitPackageImport` with no way to reach it. 47-2c adds the
way in on the worker side only:

1. the `package-import-commit` BullMQ processor and its transport, enqueued by the outbox deliver
   chain after the dispatcher claim has committed (ADR-0018);
2. the per-company `package-import-recovery` sweep that marks a package commit request still
   `commit_requested` ten minutes after `requested_at` as `failed` / `IMPORT_COMMIT_FAILED`,
   with no re-enqueue;
3. worker tests for both.

**Out of scope (47-2d / C2):** the API commit request route, its `Idempotency-Key`, the
`ready → commit_requested` writer, the API `events/published.ts` type, OpenAPI registration, the
status contract's `commit_requested` / `committed` variants, the admin screen. After this PR nothing
in production emits `PackageImportCommitRequested`: the consumer is registered before its producer,
which is the safe order (same as 42-3b1b / #1025 for `PackageSaleRequested`).

**No migration.** Verified on main:

- the 0215 guard already allows `commit_requested → failed` for `entity='packages'` when only
  `status` and `error_code` change (the commit adapter's own `fail` issues that UPDATE today);
- the sweep read uses the existing `import_previews_company_status_requested_idx`
  (company, status, requested_at), the index the staff sweep is already EXPLAIN-tested on;
- `pospay_app` already holds the column UPDATE grants `fail` uses.

If implementation finds any of these false: **stop and report** (task rule 10). Do not write SQL
under `packages/db/migrations`, do not run `pnpm db:generate`.

## 2. Sources read

`spec.md` rows 47-2 / 47-2b and §Events (lines 831–853), `47-2b-implementation.md`,
`47-2b-local-receipt.md` (line 67–70: 47-2c must keep the safe `failureCode` through retry and
finalization), ADR-0034 addenda (47-2b, 42-3b), ADR-0018, `apps/worker` staff wiring
(`employee-import.processor.ts`, `employee-import-recovery.processor.ts`, `RecoverEmployeeImports`),
orders wiring (`startPackageSaleWorker`, `package-preview.processor.ts`), `main.ts`.
`docs/plans/2026-11-19-design-and-backlog-plan.md` is not on main and the branch
`docs/plan-ds3-backlog` no longer exists on the remote, so the task brief is the scope source.

## 3. Design

Model: `startPackageSaleWorker` (register the sweep, then transport; bounded pages; own
transaction budget; composed spec) plus the preview processor's progress-persisted failure
finalization. Staff's processor is too thin for this slice: it calls `fail` with no code and
would drop `PackageCommitRetryError.failureCode`.

### 3.1 Contracts — `packages/contracts/src/orders/package-import-commit.ts` (new)

```ts
export const packageImportCommitRequested = z.strictObject({ preview_id: id });
export const packageImportCommitJob = z.strictObject({ companyId: id, previewId: id });
export type PackageImportCommitRequested = z.infer<typeof packageImportCommitRequested>;
```

Exported from `orders/index.ts` and the root `index.ts` next to the preview pair. **No `.meta({ id })`
and not added to any OpenAPI schema list**: this PR must not change the generated OpenAPI or any
frontend `schema.d.ts`. 47-2d registers the event schema together with the route. A small
`package-import-commit.spec.ts` asserts strictness (extra key such as `phone` refused, non-UUID refused).

### 3.2 Domain — `apps/worker/src/modules/orders/domain/package-import-recovery.ts` (new)

```ts
export const PACKAGE_IMPORT_COMMIT_STALE_MS = 10 * 60 * 1000;
export const PACKAGE_IMPORT_RECOVERY_MAX_PAGES = 20;
export function packageImportCommitStaleBefore(now: Date): Date
```

Arabic JSDoc on every export (§3.1). Unit test in `domain/__tests__/package-import-recovery.spec.ts`:
exactly ten minutes back, boundary is inclusive at the caller (`requested_at <= before`).

### 3.3 Port — `ports/package-import-recovery.port.ts` (new)

```ts
export interface PackageImportRecoveryTransactions {
  /** يفشل صفحة واحدة من الطلبات العالقة غير المقفولة ويعيد عددها؛ صفر يعني لا شيء متاح الآن. */
  failStalePage(companyId: string, before: Date): Promise<number>;
}
```

Arabic one-line doc per method. The clock reuses `PackageCommitClock`. One method, not staff's
candidates-then-fail pair (debate point 11): one transaction per page instead of up to 51.

### 3.4 Persistence — `persistence/package-import-recovery.transactions.ts` (new)

`packageImportRecoveryTransactions(database, { timeoutMs })`, under
`withTenant(companyId, …, { timeoutMs })`.

- `packageImportRecoveryCandidates(companyId, before)` (exported; the EXPLAIN test runs it and the
  page statement embeds it):
  `SELECT id FROM import_previews WHERE company_id=… AND status='commit_requested' AND
  requested_at<=… AND entity='packages' ORDER BY requested_at,id LIMIT 50 FOR UPDATE SKIP LOCKED`.
- `failStalePage`: one statement, conditional and **non-blocking on a row the commit holds**:

```sql
UPDATE import_previews SET status='failed', error_code='IMPORT_COMMIT_FAILED'
WHERE company_id=$c AND entity='packages' AND status='commit_requested' AND requested_at<=$before
  AND id IN (<packageImportRecoveryCandidates>)
RETURNING id
```

  It returns the number of returned rows.

Why `SKIP LOCKED`: the financial transaction holds the preview row `FOR UPDATE` for its whole
length, and a full-bound commit measured 470 s (47-2b full-bound receipt). A plain conditional
UPDATE is correct but would block behind that lock until the sweep's own statement timeout, fail
the sweep job and repeat every minute. Skipping leaves the in-flight commit alone; the next
per-minute run decides again. Either order is atomic: if the commit wins the row is `committed`
and the outer predicate fails on re-check; if the sweep wins, `loadPreview` returns `null` and the
commit writes nothing.

### 3.5 Use cases

- `use-cases/recover-package-imports/recover-package-imports.ts` (new) — class `RecoverPackageImports`
  (one Arabic line above the class). `execute(companyId)`: `before = packageImportCommitStaleBefore(clock.now())`;
  loop at most `PACKAGE_IMPORT_RECOVERY_MAX_PAGES`, calling `failStalePage`; **return when a page
  fails nothing** (empty, or every remaining candidate is locked). No arithmetic, no SQL, no `Date.now()`.
- `use-cases/commit-package-import/commit-package-import.ts` (edit, additive only): add

```ts
/** يثبت فشل الطلب المعلق برمز آمن بعد استنفاد المحاولات أو رفض الحدث. */
fail(companyId: string, previewId: string, code: PackageCommitError['code']): Promise<void> {
  return this.transactions.fail(companyId, previewId, code);
}
```

  `execute` and `PackageCommitRetryError` are not changed.
- `persistence/package-import-commit.transactions.ts` (edit, one line of behaviour): `fail` runs its
  `withTenant` with `{ timeoutMs: PACKAGE_IMPORT_FAIL_TIMEOUT_MS }` (module-local constant `5_000`),
  so finalization can never wait unbounded behind a still-running commit transaction (debate point 4).
  `run`, `loadPreview`, `completePreview`, `mapSqlError` are not changed.

### 3.6 Jobs

`jobs/package-import-commit.processor.ts` (new), queue `PACKAGE_IMPORT_COMMIT_QUEUE = 'package-import-commit'`,
same connection/producer/queue/worker construction as `package-preview.processor.ts`
(`concurrency: 1`, errors swallowed on the handles, `ready`/`close`).

Signature: `startPackageImportCommitProcessor(useCase, redisUrl, options?: { prefix?: string;
retryDelayMs?: (attempt: number) => number | null; lockDurationMs?: number; stalledIntervalMs?: number;
maxStalledCount?: number })`.

**Worker options (debate point 6).** This is the first orders job that can run for minutes. Set
`lockDuration` explicitly (constant `PACKAGE_IMPORT_COMMIT_LOCK_MS = 60_000`, with the reason in an
Arabic comment: the lock is renewed while the handler awaits the database, and a longer lock rides
out a short Redis blip on a connection that has `enableOfflineQueue: false`); `stalledInterval` and
`maxStalledCount` are passed through only when supplied (tests), exactly as
`documents/start-documents.ts` lines 138–142 does. A stalled re-run is money-safe: it blocks on the
preview `FOR UPDATE`, then sees a status other than `commit_requested` and writes nothing.

Handler (mirror of `previewHandler`, the 47-2b receipt's requirement):

1. `packageImportCommitJob.safeParse(job.data)`; invalid → `throw new Error('PACKAGE_IMPORT_COMMIT_JOB_INVALID')`.
2. `expired = Date.now() - job.timestamp >= PACKAGE_IMPORT_COMMIT_STALE_MS` (job age since enqueue;
   `Date.now()` in `jobs/` as `package-preview.processor.ts` line 64 already does).
3. If `job.progress` parses as `{ stage: 'finalizing-commit-failure', code }` (code = one of the four
   `PackageCommitError` codes, Zod enum) → `persistFailure` and return. A restart finishes the failure
   without running the financial transaction again.
4. If `expired` → return without running anything: the sweep owns a request this old (debate points 1, 12).
5. `await useCase.execute(companyId, previewId)`.
6. On error: `code = error instanceof PackageCommitRetryError ? error.failureCode : undefined`.
   - `code === undefined`, attempts remain **and the job is not past the stale window** → rethrow
     (BullMQ retry, exponential backoff).
   - otherwise `failure = { stage, code: code ?? 'IMPORT_COMMIT_FAILED' }`, `job.updateProgress(failure)`,
     `persistFailure`.
7. `persistFailure`: `useCase.fail(companyId, previewId, code)`; if it throws: when the job is past
   the stale window → return (the sweep finalizes with the generic code; no endless re-delay);
   otherwise `job.moveToDelayed(Date.now() + 2000, token)` + `throw new DelayedError()` (does not
   consume an attempt).

Why step 6's age check (debate point 1, P1): `withTenant`'s deadline rejects the caller while the
database transaction may still be running; a retry then waits behind that lock and runs a whole
budget again. Three attempts could hold one request, and the single-concurrency queue of every
tenant, for about three budgets. With the check a job never starts a new financial attempt after
ten minutes from enqueue.

Nothing from the caught error is logged or stored: only the fixed enum code leaves the handler.

`deliver(event)`:

- `data = packageImportCommitJob.safeParse({ companyId: event.companyId, previewId: event.aggregateId })`,
  `payload = packageImportCommitRequested.safeParse(event.payload)`.
- Invalid when `event.aggregateType !== 'import_preview'`, either parse fails, or
  `payload.preview_id` ≠ `previewId` (case-insensitive) → **park only**:
  `{ delivered:false, error:'PACKAGE_IMPORT_COMMIT_EVENT_INVALID', retryInMs:null }`, with **no database
  call** (debate points 4, 5). Unlike the preview transport, a sweep exists here and is registered
  before this code runs (§3.7), so a real request behind a malformed event is failed by the sweep
  within ten minutes; `deliver` never blocks the dispatcher batch behind a commit lock and never
  fails an aggregate it could not identify.
- Valid: `queue.add('commit', data, { jobId: event.id, attempts: 3, backoff: { type:'exponential', delay:2000 }, removeOnComplete: true, removeOnFail: 100 })`
  → `{ delivered: true }`; on throw `{ delivered:false, error:'PACKAGE_IMPORT_COMMIT_QUEUE_RETRY', retryInMs: retryDelay(event.attempt) }`.

**Outbox retry delay (debate point 2, P1).** A fixed 2 000 ms spends the dispatcher's ten claims
in about thirty seconds of Redis outage and parks the event; if the failing step was the first
`recovery.register`, no sweep exists and the request would stay `commit_requested` for ever.
`retryDelay = options.retryDelayMs ?? (() => 2000)`; `main.ts` injects `retryDelayMs` from
`outbox/retry-policy.ts` (5 s, 10 s, 20 s … ≈ 43 minutes over ten claims; `null` on the last, which
the dispatcher parks). Injection keeps the module free of a value import from `outbox/`. The
residual (an outage longer than that parks the event; the owner sees it in «outbox event parked»)
goes in the ADR addendum. The same fixed-delay pattern in the sale, preview and staff transports is
out of this slice: report it to the manager as a follow-up issue.

`jobs/package-import-recovery.processor.ts` (new), queue `'package-import-recovery'`: a copy of
`package-sale-recovery.processor.ts` (`register(companyId)` → `upsertJobScheduler('package-import-recovery-<companyId>', { every: 60_000 }, …)`,
handler `useCase.execute(recoveryJob.parse(job.data).companyId)`).

### 3.7 Module wiring — `orders.module.ts` + `index.ts`

```ts
/** يشغّل نقل تثبيت استيراد الباقات ومسح استرداده؛ الحدث لا يُقرّ إلا بعد تسجيل المسح وقبول Redis للمهمة. */
export function startPackageImportCommitWorker(
  database: Pick<TenantWrappers, 'withTenant'>,
  ids: IdGenerator,
  options: {
    redisUrl: string; clock: PackageCommitClock; transactionTimeoutMs: number;
    retryDelayMs?: (attempt: number) => number | null; prefix?: string;
  },
)
```

Returns `{ eventTypes: ['PackageImportCommitRequested'], deliver(event, next), ready, close }`
as `startPackageSaleWorker`: other types go to `next`; for ours `recovery.register(event.companyId)`
first, on throw `{ delivered:false, error:'PACKAGE_IMPORT_RECOVERY_SCHEDULE_RETRY', retryInMs: retryDelay(event.attempt) }`,
then `processor.deliver(event)`. `close()` closes the recovery processor, then the commit processor
with BullMQ's force flag (`worker.close(true)`): shutdown must not wait minutes for a commit in
flight (debate point 7). The interrupted transaction rolls back when the pool closes; the job is
re-run as stalled or the sweep fails the request — both money-safe. The sweep's transactions use a module constant
`PACKAGE_IMPORT_RECOVERY_TIMEOUT_MS = 5_000` (two short indexed statements; never the financial budget).
`orders.module.ts` is 304 lines today and must stay under 400 (`max-lines` error); the function body
under 60 lines. Export from `index.ts`.

### 3.8 Composition root — `apps/worker/src/main.ts`, `shared/config.ts`, `.env.example`

- `config.ts`: `PACKAGE_IMPORT_COMMIT_TRANSACTION_TIMEOUT_MS`, `z.coerce.number().int().min(1000).max(600_000).default(600_000)`
  behind `optionalValue`, Arabic comment: measured, not inherited from staff or sale; the cap is the
  stale window until a production measurement exists (debate point 8). `.env.example` gets the empty
  key next to the sale one. `config.spec.ts`: default, empty string, explicit value, out-of-range refused.
- `main.ts`: `const imports = startPackageImportCommitWorker(app, systemUuidV7(), { redisUrl, clock, transactionTimeoutMs, retryDelayMs })`;
  add to `knownEventTypes(staff, notifications, inApp, previews, sales, imports, catalog)`; add to the
  `deliver` chain after `sales`; readiness `{ name: 'package-import-commit', check: () => imports.ready() }`
  after `package-sale`; in `release`, `await imports.close()` **after** `catalog.close()` (last of
  the module workers), so a commit in flight cannot delay the others.

**Budget — PENDING technical question (Waleed only, via the manager).** ADR-0034 says deployment
supplies a measured budget and nothing is inherited. The only measurement is 470 313 ms at the full
bound on a private 1 GiB lane, explicitly not a production budget. The default above (600 000 ms =
the stale window, above the one measurement) is **provisional** and has no production effect while
the producer is closed. It is recorded as `PENDING` in `owner-questions.ar.md` with options, and
«budget answered» is written as a **blocking item in the 47-2d spec row**. It blocks nothing in this PR.
The addendum states the real worst-case wait: `statement_timeout` bounds each statement, not the
whole transaction, and the commit-outcome watchdog adds one more budget, so a handler can wait up
to two budgets (20 minutes at the cap) before it sees the outcome.

### 3.9 Docs

- `spec.md`: split row 47-2 into 47-2c (this) and 47-2d (route/producer) the same way 47-2b was
  recorded; §Consumed text gains the `SKIP LOCKED` and bounded-page facts.
- ADR-0034: addendum «package import commit transport and recovery (058 / 47-2c)» — processor,
  durable failure-code finalization, sweep, `SKIP LOCKED` reasoning, provisional budget, producer closed.
- `docs/module-map.md`: §4 row for `PackageImportCommitRequested` (producer: `orders` API commit
  request, **47-2d, not yet emitting**; consumer: worker `orders`), and the 47-1a note at lines 321–327
  updated; run `pnpm module-map:check` and commit the regenerated YAML only if the script changes it.
- `owner-questions.ar.md`: the PENDING budget question (Arabic, options, recommendation).
- `47-2c-local-receipt.md`: real gate output.
- No `docs/journey/` file: no user-facing feature changes while the producer is closed.

## 4. Files

New (worker `apps/worker/src/modules/orders/`): `domain/package-import-recovery.ts`,
`domain/__tests__/package-import-recovery.spec.ts`, `ports/package-import-recovery.port.ts`,
`persistence/package-import-recovery.transactions.ts`,
`use-cases/recover-package-imports/recover-package-imports.ts`,
`jobs/package-import-commit.processor.ts`, `jobs/package-import-commit.processor.spec.ts`,
`jobs/package-import-recovery.processor.ts`, `jobs/package-import-recovery.processor.spec.ts`,
`__tests__/package-import-recovery.spec.ts`, `__tests__/package-import-commit-composed.spec.ts`.
New (contracts): `packages/contracts/src/orders/package-import-commit.ts`, `…/package-import-commit.spec.ts`.

Edited: `use-cases/commit-package-import/commit-package-import.ts` (add `fail`), `orders.module.ts`,
`orders/index.ts`, `apps/worker/src/main.ts`, `shared/config.ts`, `shared/__tests__/config.spec.ts`,
`.env.example`, `packages/contracts/src/orders/index.ts`, `packages/contracts/src/index.ts`,
`outbox/__tests__/known-event-types.spec.ts`, `shared/otp-startup.spec.ts`,
`shared/readiness-checks.spec.ts` (BullMQ mock by queue name `package-import-*` + the exact
readiness list), docs in §3.9.

Also edited: `persistence/package-import-commit.transactions.ts` (only the bounded `fail`, §3.5).

Not touched: `packages/db/**`, `apps/api/**`, any frontend, the rest of
`persistence/package-import-commit.*`, `domain/package-import-commit.ts`, staff module, the sale and
preview transports, existing migrations.

## 5. Tests (each asserts an outcome, not only a mock call)

**Commit processor spec (private Redis, use case doubled):**
1. valid event → `{ delivered:true }` twice, one job with `jobId = event.id` and data
   `{ companyId, previewId }` only (no payload copy).
2. unexpected error three times → `execute` ×3, then `fail(company, preview, 'IMPORT_COMMIT_FAILED')` once.
3. `PackageCommitRetryError('IMPORT_PREVIEW_EXPIRED')` on attempt 1 → no second `execute`;
   `fail` called with `'IMPORT_PREVIEW_EXPIRED'` (the 47-2b safe code survives).
4. `fail` throws once → job goes `delayed`, progress holds the stage+code, the next run calls `fail`
   with the same code and does **not** call `execute` again.
5. invalid events (wrong `aggregateType`, payload id ≠ aggregate id, extra payload key, non-UUID
   aggregate) → `PACKAGE_IMPORT_COMMIT_EVENT_INVALID`, `retryInMs:null`, no job in the queue, and
   neither `execute` nor `fail` was called.
6. `Queue.add` rejects → `PACKAGE_IMPORT_COMMIT_QUEUE_RETRY`; with an injected `retryDelayMs` the
   returned `retryInMs` follows `event.attempt` (attempt 1 and attempt 3 give different delays),
   without one it is 2000.
6a. **stale window:** a job whose `timestamp` is older than ten minutes: an unexpected error on
    attempt 1 → `execute` called once, no retry, `fail(…, 'IMPORT_COMMIT_FAILED')`; and a job already
    past the window before its first run → neither `execute` nor `fail` is called and the job completes.
6b. **stalled job** (modelled on `documents/__tests__/stalled-job.spec.ts`, short `lockDurationMs` /
    `stalledIntervalMs`): a handler that outlives its lock is re-run, and the use case double shows
    the second run reaches `execute` again — the test names the money-safety as the status guard's,
    proven by test 8a, not by this test.

**Recovery processor spec:** two events for one company → exactly one scheduler, `every` 60 000,
data `{ companyId }` only; the handler runs the use case.

**Recovery integration spec (private Postgres, real 47-2b fixtures):**
7. a package request aged exactly ten minutes → `failed` / `IMPORT_COMMIT_FAILED`; one aged
   9 min 59.999 s stays `commit_requested`; another company's sweep changes nothing; an
   `entity='employees'` `commit_requested` row of the same age is untouched (real row, real sweep).
8. **money, sweep wins:** after the sweep, `CommitPackageImport.execute` for that preview creates
   zero `package_entitlements`, components, slots, zero `import.committed` audit rows and zero
   `ImportCommitted` outbox rows, and `error_code` stays `IMPORT_COMMIT_FAILED`.
8a. **money, redelivery:** `execute` twice on a committed preview → entitlement, slot, audit and
    `ImportCommitted` counts are unchanged after the second run.
8b. **final-attempt no-op:** after a successful commit, `fail(…, 'IMPORT_COMMIT_FAILED')` changes
    nothing: status `committed`, `error_code` null.
9. **predicate, commit first (sequential — named so; it proves the conditional predicate, not
   concurrency):** a stale request is committed, then the sweep runs → status `committed`,
   `error_code` null, created count and entitlement rows intact.
10. **lock (the concurrency proof):** a second connection holds the preview row `FOR UPDATE` in an
    open transaction; `failStalePage` returns `0` in under 1 000 ms, the row is still
    `commit_requested`, and `RecoverPackageImports.execute` returns (no spin); after the holder
    rolls back the next sweep fails it.
11. backlog of 60 stale requests drains in one `execute`.
12. `EXPLAIN ANALYZE` of `packageImportRecoveryCandidates` uses
    `import_previews_company_status_requested_idx`; copy the method of
    `staff/__tests__/employee-import-recovery.spec.ts` «uses the tenant/status/request index…»
    exactly (500 cloned rows, `ANALYZE`, run under `withTenant`).
12a. the bounded `fail`: with the row locked by a second connection, the adapter's `fail` rejects
     within its 5 s timeout instead of waiting for the holder.

**Composed spec (private Postgres + Redis):**
13. `eventTypes` is exactly `['PackageImportCommitRequested']`; delivering a real requested preview
    registers scheduler `package-import-recovery-<company>` **before** acknowledging, then the job
    commits it: status `committed`, entitlements/slots present with the fixture's exact KWD sum.
14. another event type goes to `next` untouched.
15. scheduler failure → `PACKAGE_IMPORT_RECOVERY_SCHEDULE_RETRY`, no commit job enqueued.
16. **ordering (real dispatcher, debate point 3):** append a real `PackageImportCommitRequested`
    outbox row for a requested preview, run `dispatcher.dispatchBatch(10, deliver)` with
    `createOutboxDispatcherDatabase({ url: testDb.dispatcherUrl, maxConnections: 1 })` as
    `commissions/__tests__/replay-commission-inputs-db.spec.ts` does, and spy `Queue.prototype.add`:
    inside the spy, a **separate owner connection** reads the outbox row and sees the claim already
    committed (the attempt counter / lease the claim wrote), then the real `add` proceeds; afterwards
    the job exists and the row is published. If the 47-2b fixture cannot supply the dispatcher URL,
    do **not** substitute a `withTenant`-spy test: stop and report, and the receipt cites
    `packages/db/src/__tests__/dispatcher.spec.ts` instead.

**Wiring specs:** `known-event-types.spec.ts` includes the new worker and asserts the type is known;
`otp-startup.spec.ts` / `readiness-checks.spec.ts` updated readiness lists and BullMQ mocks.

## 6. Local gates (PP-113)

`pnpm --filter @pospay/contracts typecheck` + its spec; `pnpm --filter @pospay/worker typecheck`,
`lint`; root `pnpm lint:docs`, `pnpm module-map:check`; the worker specs above plus the existing
47-2b commit specs, preview processor specs and staff import specs as regression, on a private
`lane.mjs up packages-47-2c` Postgres and a private Redis with `REDIS_URL` overridden. Full suite,
API shards and E2E are CI's.

## 7. Acceptance

- A `PackageImportCommitRequested` delivery is acknowledged only after the sweep is scheduled and
  Redis accepted the id-only job; any failure before that returns a retry outcome whose delay grows
  with the outbox attempt.
- A permanent refusal's safe code reaches `import_previews.error_code` across a database outage or
  worker restart **within the ten-minute stale window (best effort)**; after the window, when
  `updateProgress` fails on the last attempt, or when BullMQ's stall limit ends the job without
  calling the handler, the request ends with the generic `IMPORT_COMMIT_FAILED` from the sweep. An
  exhausted unknown failure also ends as `IMPORT_COMMIT_FAILED`.
- A request `commit_requested` for ten minutes and not held by a running commit is `failed` by the
  next sweep, never re-enqueued, never half-written; a commit in flight is never blocked on or
  overwritten, and no new financial attempt starts after ten minutes from enqueue.
- No migration, no API/OpenAPI/frontend diff, staff import behaviour unchanged.
- Local gates pass; `ci-gate` green on the exact head before «done».

## 8. Known limits to report to the manager

- Staleness counts from `requested_at`, and the one queue has `concurrency: 1` for all tenants. A
  healthy request queued behind a long commit for more than ten minutes is failed before it starts.
  This is fail-closed (no partial money effect) and is what the spec mandates; the user re-uploads.
  It is a gate for 47-2d to weigh before the producer opens.
- The transaction budget default is provisional (§3.8); «budget answered» blocks 47-2d.
- `z.strictObject` on the event payload: 47-2d must not add a payload field without deploying the
  worker first (recorded in the 47-2d spec row).
- A Redis outage longer than the outbox retry span (about 43 minutes) parks the event; if it was the
  company's first event no sweep is registered and the request stays `commit_requested` until an
  operator replays the parked event.
- The fixed 2 000 ms retry delay remains in the sale, preview and staff transports (follow-up issue).
- `orders.module.ts` passes the 300-line warning (stays under the 400 error).

## 9. Debate record — interim Fable round while Astra was out of quota

**Reviewer.** The brief names Astra. Both Astra lanes were out of quota on 2026-11-20:
opencode `openai/gpt-6.2-astra` (variant medium) failed twice with «The usage limit has been
reached», then codex `gpt-6.2-astra` (reasoning effort medium) failed with «You've hit your usage
limit … try again at 12:26 AM». None produced any review text. The round was therefore run by an
independent fresh-context Claude Fable 5.2 reviewer (the PP-112 chain Astra → Fable), read-only.
**This is not the Astra review**; the Astra round itself arrived later and is recorded in §10.

**Verdict:** APPROVE WITH CHANGES — no P0, no path to half-written or doubled money; three P1.
It confirmed «no migration» (guard 0215 lines 48–52, `UPDATE(status,error_code)` grant from 0079,
UPDATE policy from 0078, index from 0080, `FOR UPDATE` under RLS already used by `loadPreview`) and
that the `SKIP LOCKED` statement cannot let both sides win.

| # | Sev | Point | Outcome |
|---|---|---|---|
| 1 | P1 | Three attempts × budget hold one request and the whole queue ~3 budgets, because `withTenant`'s deadline rejects the caller while the transaction still runs | **Applied** — §3.6 steps 2, 4, 6: no retry and no new attempt after ten minutes from enqueue; test 6a. Cross-tenant blocking recorded in §8 as a 47-2d gate |
| 2 | P1 | Fixed `retryInMs: 2000` spends the ten outbox claims in ~30 s of Redis outage and parks the event; with no sweep registered the request is stuck | **Applied** — §3.6/§3.7 inject `retryDelayMs` from `outbox/retry-policy.ts`; test 6; residual in §8 and the addendum. The sibling transports are a follow-up, not this slice |
| 3 | P1 | Test 16 (`withTenant` never called) passes trivially and is racy | **Applied** — replaced by a real `dispatchBatch` test observing the committed claim from a second connection; no weaker substitute allowed |
| 4 | P2 | Invalid-event path called an unbounded, blocking `fail` inside the dispatcher batch | **Applied, simpler than proposed** — the invalid path makes no database call at all (the sweep is already registered and fails a real request); the adapter's `fail` gets a 5 s timeout for the handler path; test 12a |
| 5 | P2 | `fail` on an event with a wrong `aggregateType` could fail a legitimate request; strict payload vs additive 47-2d field | **Applied** — park only (same change as 4); deploy-order constraint in §8 and the 47-2d row |
| 6 | P2 | No explicit lock/stall options on the first multi-minute orders job | **Applied** — explicit `lockDuration` with reason, pass-through stall options, stalled-job test 6b. BullMQ 6.2.0 defaults were not verified by the reviewer or by me, so the implementer copies the documents worker's proven shape |
| 7 | P2 | Shutdown waits for a commit in flight and blocks the other closes until SIGKILL | **Applied** — `imports` closes last and with the force flag (§3.7, §3.8) |
| 8 | P2 | A coded default can become production silently; `max` of 30 minutes; real wait is 2× budget | **Applied** — `max` capped at 600 000; «budget answered» blocks 47-2d; the 2× wait is stated. The default itself stays, flagged provisional, because the adapter needs a number and the producer is closed |
| 9 | P2 | §7 over-claimed that the safe code always survives | **Applied** — §7 reworded to best effort within the window |
| 10 | P2 | Test gaps (prompt lock bound, sequential test naming, real employee row, final-attempt no-op, sweep between attempts, redelivery, scheduler idempotence, EXPLAIN method) | **Applied** — tests 7, 8, 8a, 8b, 9, 10, 12 and the recovery processor spec |
| 11 | P3 | Sweep as one statement per page | **Applied** — §3.3–§3.5 |
| 12 | P3 | Delayed finalization had no end | **Applied** — §3.6 step 7 |
| 13 | P3 | `orders.module.ts` over the 300-line warning | **Answered** — stays under the 400 error; noted in §8 and the receipt |
| 14 | P3 | No CLAUDE.md violation or 47-2d creep found | No change |

## 10. Astra round (codex `gpt-6.2-astra`, medium) — amendments that override §3–§7

The codex Astra task that had failed on quota resumed by itself after the reset and delivered the
round the pipeline requires (2026-11-20, about 00:40 Kuwait). A second Astra task started in the
meantime was cancelled, so there is one Astra round. Verdict: **APPROVE WITH CHANGES**. It
independently confirmed that the sweep needs no migration (0078 SELECT and tenant policies, 0079
`UPDATE(status,error_code)`, 0215 lines 48–52, index 0080), that neither side can win twice or
half-write money under READ COMMITTED, and that parking a malformed event without a database call
is right. Where this section differs from §3–§7, **this section wins**.

| # | Sev | Point | Outcome |
|---|---|---|---|
| A1 | P1 | The safe code is kept in `job.progress` only after `updateProgress`; a crash between the refusal and that write re-runs the job as new, and a state-dependent refusal (`IMPORT_SERVICE_NOT_FOUND`) can then end `committed`. The sweep can also overtake `persistFailure` after ten minutes and 0215 forbids correcting the code later | **Decided and recorded (A1 below)** — the weaker guarantee is chosen explicitly, with tests for both cases |
| A2 | P2 | The page limit and the plan of the real UPDATE are unproven: a 60-row drain passes even if one UPDATE takes all 60, and EXPLAIN of the inner SELECT is not the UPDATE's plan | **Applied (A2)** |
| A3 | P2 | Test 6a asked for one `execute` and zero `execute` under the same condition; `expired` computed once at entry is stale by the time the `catch` runs | **Applied (A3)** |
| A4 | P2 | A handler outliving `lockDuration` does not stall while the worker renews the lock; the documents example with `maxStalledCount: 0` tests the final failure, not the re-run | **Applied in part (A4)** |
| A5 | P2 | «The transaction rolls back when the pool closes» is stronger than the code guarantees: a sent `COMMIT` may have succeeded before the reply was lost | **Applied (A5)** |
| A6 | P2 | `removeOnComplete: true` lets the job vanish before `getJob` and lets a second job with the same `event.id` be added after the first completed; test 16 needs an exact observation point | **Applied (A6)** |
| A7 | P2 | An unknown error rethrown raw, or a raw error from `updateProgress` / `moveToDelayed`, is stored by BullMQ in `failedReason` / `stacktrace` | **Applied (A7)** |
| A8 | P3 | The port's exported interface has no Arabic JSDoc | **Applied** — one Arabic line above `export interface PackageImportRecoveryTransactions` |

### A1 — what «permanent refusal» guarantees (decision by the plan author; the manager may reopen it)

A refusal is **final once it is stored in `import_previews`**. Until then the request is still
`commit_requested`, the creator has only ever seen «pending», and a re-run evaluates the same
frozen preview against current data inside one transaction. So:

- a crash after a refusal was computed but before `status='failed'` or the progress write was
  stored may end `committed` if the cause has gone (only `IMPORT_SERVICE_NOT_FOUND` is
  state-dependent; expiry, preview errors and the frozen-allocation checks are deterministic);
- when the sweep reaches the row first, the request ends with the generic `IMPORT_COMMIT_FAILED`
  and the specific code is lost for good.

Both are single, atomic, money-safe outcomes and neither contradicts anything the user was shown.
Making a refusal durable before any re-run would need a second durable store written in the
rolled-back transaction's place (a new column or table → a migration), which this slice must not
add. The 47-2b receipt's requirement («preserve the safe failureCode during retry/finalization»)
is met for the case it describes — the failure write itself failing — and stated honestly as best
effort otherwise. Tests: (i) refusal, `fail` throws, **no** progress written (inject a throwing
`updateProgress`), next run calls `execute` again and its outcome stands; (ii) progress written,
the sweep fails the row first, the later `fail` is a no-op and `error_code` stays `IMPORT_COMMIT_FAILED`.

### A2 — sweep statement and its tests (replaces §3.4's statement and tests 10–12)

```sql
WITH candidates AS MATERIALIZED (
  SELECT id FROM import_previews
  WHERE company_id=$c AND entity='packages' AND status='commit_requested' AND requested_at<=$before
  ORDER BY requested_at,id LIMIT 50 FOR UPDATE SKIP LOCKED)
UPDATE import_previews p SET status='failed', error_code='IMPORT_COMMIT_FAILED'
FROM candidates
WHERE p.company_id=$c AND p.id=candidates.id AND p.entity='packages' AND p.status='commit_requested'
RETURNING p.id
```

Export the whole statement builder (`packageImportRecoveryPage(companyId, before)`), not the inner
SELECT. Tests, all through `failStalePage` as `pospay_app`:
- **10/11 merged:** 60 eligible rows, the **oldest** locked `FOR UPDATE` by a separate connection:
  the first call returns exactly 50 in under 1 000 ms and the locked row is still
  `commit_requested`; the second returns 9; after the holder rolls back a third returns 1.
  `RecoverPackageImports.execute` on the same setup returns without spinning.
- **12:** `EXPLAIN ANALYZE` of the **full statement** inside a transaction that ends in `ROLLBACK`
  uses `import_previews_company_status_requested_idx` (500 cloned rows + `ANALYZE`, as staff's test).

### A3 — the age rule (replaces §3.6 steps 2, 4, 6, 7 wording and test 6a)

`startPackageImportCommitProcessor` takes `now?: () => number` (default `Date.now`) and a helper
`pastWindow(job) = now() - job.timestamp >= PACKAGE_IMPORT_COMMIT_STALE_MS` that is **called at each
decision**, never cached: before starting `execute`, when deciding to retry, and when `fail` throws.
Three tests with the controllable clock:
- **6a-1 old at entry:** `execute` and `fail` are never called; the job completes.
- **6a-2 crosses the window during `execute`:** `execute` once, then no retry and
  `fail(…, 'IMPORT_COMMIT_FAILED')`.
- **6a-3 old `requested_at`, fresh job** (integration, real rows): a request whose `requested_at`
  is older than ten minutes but whose job was just enqueued after an outbox delay: whichever of
  commit and sweep runs first decides, the other is a no-op, and exactly one outcome is stored.
  The test runs both orders. The job's age is a guard against re-attempts, **not** an acceptance
  deadline from request time; the spec defines sweep eligibility from `requested_at` (§8 limit).

### A4 — lock and stall (replaces §3.6 «Worker options» and test 6b)

`lockDuration` 60 000 stays (a renewable lock; money safety does not need an eight-minute lock).
Pin `maxStalledCount: 1` explicitly as part of the operating contract; `stalledInterval` is passed
only when supplied. Tests:
- **6b-1:** with a short `lockDurationMs`, a handler that awaits across more than one renewal
  cycle runs `execute` exactly once (renewal works; no false stall).
- **6b-2 (re-run money safety):** proven at the database by 8a (second `execute` after a commit
  writes nothing) and by a new **8c**: first `execute` rolled back by an injected failure, second
  `execute` commits the full import once. A true two-worker stall test (renewal stopped, second
  worker picks the job) is written only if it can reuse `documents/__tests__/stalled-job.spec.ts`'s
  harness without new infrastructure; otherwise it is reported as not done, not faked.

### A5 — shutdown wording and commit-reply loss (corrects §3.7, the ADR addendum and test 12a)

`worker.close(true)` only stops BullMQ from waiting. The in-flight transaction then **either rolls
back or has already committed** (a `COMMIT` sent before the connection dropped may have succeeded);
the handler's rejected promise proves neither. Recovery never assumes: every re-run and the sweep
read the stored status. 8a is the redelivery-after-lost-commit-reply test and is named so. 12a
asserts the bounded `fail` rejects on the **lock wait** within 5 s plus scheduling tolerance
(under 8 s), and the test comment distinguishes it from the commit-outcome watchdog.

### A6 — job removal and test 16 (replaces tests 1, 13 and 16 details)

- Tests that read the job (`getJob`) use a use-case double whose `execute` waits on a barrier, so
  the job cannot complete and be removed first.
- **16:** start from a fresh outbox row with `attempts=0`. Intercept `Queue.prototype.add` for the
  commit queue and this `event.id`; **before** calling the real `add`, a separate owner connection
  must see the current claim on the row (attempt counted, lease in force) and `published_at IS NULL`.
  After `dispatchBatch` returns, assert the durable financial result (status `committed`, one
  `ImportCommitted`), not the job's presence.
- **16b redelivery after removal:** after the first job completed and was removed, delivering the
  same event again enqueues a new job; the financial effect stays single (entitlement, slot, audit
  and `ImportCommitted` counts unchanged).

### A7 — no raw error text in Redis (adds to §3.6)

At the processor boundary every non-`DelayedError` failure leaves as
`new Error('PACKAGE_IMPORT_COMMIT_RETRY')` with **no `cause`**: an unknown error from `execute`
that will be retried, and any error from `job.updateProgress` or `job.moveToDelayed`. `DelayedError`
is thrown only after `moveToDelayed` succeeded. Test **6c**: `execute` throws an error whose message
is a distinctive marker string on every attempt; after the job fails, its `failedReason` and
`stacktrace` read back from Redis do not contain the marker.

### Report to the manager from this round

A1 is a design decision on a money path taken by the plan author under the «no migration»
constraint; it is safe (one atomic outcome) but it is the manager's and Waleed's to reopen.