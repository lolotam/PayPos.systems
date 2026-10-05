# Document expiry job — Phase 1 PR 15

Created: 2026-10-05. Status: implemented with provisional owner questions below.

Sources: Phase 1 SPEC §3 (`staff ⇒ notifications` event `DocumentExpiring`), §4 (`EmployeeDocument … expires_on?`,
`DocumentType (editable, alert_days)`); spec 028 (status rule, one current document per type, DOC-Q3 and DOC-Q5);
ADR-0003 §3 (no cross-tenant read by `pospay_app`); ADR-0032 (tenant discovery for jobs without cross-tenant reads);
ADR-0018 (provider work outside transactions); ADR-0022 (per-company schedules registered by outbox delivery);
spec 011 (email disabled; PR 15 must not emit live email requests); plan row 15.

## User scenarios and requirements

P1: a manager keeps employee papers current. When a current document enters the expiry window of its type the
system records one `DocumentExpiring` event for that document and expiry date, so the notification layer can tell
the responsible people. Email and WhatsApp stay off; only the already-shipped in-app channel may react to the
event once recipients are supplied.

- DE-01: per company the job finds **current** (`replaced_at IS NULL`) documents with a non-null `expires_on`
  whose type rule says EXPIRING: `expires_on >= today` and `expires_on - today <= alert_days`, inclusive on both
  ends. `alert_days = 0` means the expiry day itself only; the day after is EXPIRED and is never selected.
  `today` is the injected Clock's date in the **business timezone** of the document.
- DE-02: the job emits `DocumentExpiring` **exactly once per (document, expiry date)**. Re-runs, restarts, two
  workers, a replaced document and an edited `alert_days` never produce a second recipient-free event for the
  same key in PR 15. PR 62's one-time recipient-bearing re-emission is a separate delivery state below.
- DE-03: a document without `expires_on` is ignored. A replaced document is not current and is never scanned; the
  replacement is a different document id and gets its own single event.
- DE-04: the job is bounded: it pages through candidates with a keyset cursor, reads and writes only inside
  `withTenant(companyId)` as `pospay_app`, and makes no cross-tenant query beyond what ADR-0032 allows.
- DE-05: tenant discovery reuses ADR-0032: delivery of `EmployeeDocumentRecorded` registers one idempotent
  per-company BullMQ schedule (id-only data `{ companyId }`); the event then continues to the normal deliverer.
- DE-06: the notifications consumer already knows `DocumentExpiring` (`NOTIFICATION_SOURCE_EVENTS`). With no
  recipients the event is acknowledged without sending; with an IN_APP recipient it stores exactly one in-app
  notification per `(source_event_id, recipient, template_key)` and emits a durable `NotificationDelivered`.

## Slice design

### The window rule (domain)

`apps/worker/src/modules/staff/domain/document-expiry.ts` mirrors spec 028's status rule as pure functions:
`businessToday(now, timeZone)`, `documentExpiryCandidate(expiresOn, alertDays, today)` and
`expiryNoticeWindow(today, alertDays)`. The worker keeps its own copy because a worker job may not import the API
staff module (ADR-0032 shapes the worker staff module the same way); the SQL computes the same rule and the job
re-checks every row with the domain before writing.

### Dedupe ledger

A new tenant table `employee_document_expiry_notices` records that a notice was emitted:

- PK `(company_id, id)`, FK `(company_id, document_id)` → `employee_documents(company_id, id)`,
- **UNIQUE `(company_id, document_id, expires_on)`** — the dedupe key,
- `employee_id`, `business_id`, `type_code`, `notified_at` (from the Clock).
- nullable `recipients_attached_at timestamptz`: NULL means the event was emitted without recipients.
  PR 15 always leaves it NULL; its SELECT/INSERT grants remain unchanged, with no UPDATE grant.

The insert is `INSERT … ON CONFLICT (company_id, document_id, expires_on) DO NOTHING RETURNING id`; only an
inserted row appends the audit row and the outbox event in the same `withTenant` transaction. That is the DB
guarantee behind DE-02 and DE-03:

The candidate page is advisory. Before inserting, the notification transaction re-reads the current document
and its type with `FOR SHARE OF d, t`, rechecks the domain window, and builds the payload from those fresh
values. The locks remain held through ledger/audit/outbox commit, serializing replacement and `alert_days`
edits with emission. A replacement or rule edit that commits first wins. Runtime grants do not permit changing
`expires_on`; recording a replacement creates a new document id.

- re-run / restart / concurrent worker → the unique key wins once;
- replaced document → the old row is not current; the new document id has its own key;
- edited `alert_days` → the key does not contain `alert_days`, so leaving and re-entering the window cannot
  re-emit; the notice stands for that expiry date.

### PR 62 contract: attach recipients once

The ledger records the initial emission separately from recipient attachment, so a recipient-free event does
not permanently consume a future deliverable alert. PR 15 keeps its current anti-join and `ON CONFLICT`
behaviour and emits one recipient-free `DocumentExpiring` with audit and ledger in one transaction.

When alert rules ship in PR 62, a notice with `recipients_attached_at IS NULL` is eligible for one new
`DocumentExpiring` event with `notification_recipients` only while its document remains current and inside the
current type's alert window, using the injected Clock and business timezone. The future path must lock and
recheck the notice, document and type inside `withTenant`, resolve actual recipients, append the
recipient-bearing outbox event and audit, and set `recipients_attached_at` from the Clock in the same transaction. A committed
non-NULL value prevents another recipient-bearing emission under retries or concurrent workers. If recipients
are still absent, or the document was replaced or left its window, leave the marker NULL and do not emit a
recipient-bearing event. The ledger's existing unique key remains unchanged; PR 62 must discover eligible NULL
markers rather than letting PR 15's anti-join or a conflicting INSERT exclude them.

The marker records recipient attachment, not provider delivery or acknowledgement. Notifications keeps its
existing source-event dedupe and delivery handling. PR 62 must add the narrow column UPDATE grant and tenant
UPDATE policy needed for this transition; neither is granted or implemented in PR 15.

### Scan query and its index

Per business (the timezone owner) the scan reads:

```sql
SELECT d.id, d.employee_id, d.business_id, d.type_code, to_char(d.expires_on,'YYYY-MM-DD') AS expires_on,
       t.alert_days
FROM employee_documents d
JOIN document_types t ON t.company_id = d.company_id AND t.code = d.type_code
LEFT JOIN employee_document_expiry_notices n
  ON n.company_id = d.company_id AND n.document_id = d.id AND n.expires_on = d.expires_on
WHERE d.company_id = ? AND d.business_id = ?
  AND d.replaced_at IS NULL AND d.expires_on IS NOT NULL
  AND d.expires_on >= ?::date
  AND d.expires_on <= ?::date + t.alert_days
  AND n.id IS NULL
ORDER BY d.expires_on, d.id LIMIT ?
```

`?::date` is `now() AT TIME ZONE tz` computed from the injected Clock, never the server clock. A dedicated
partial index `employee_document_expiry_scan_idx` on
`(company_id, business_id, expires_on) WHERE replaced_at IS NULL AND expires_on IS NOT NULL` is added in this
PR's migration (concurrently) and asserted with `EXPLAIN (ANALYZE, FORMAT JSON)`. The ledger's unique index
serves the anti-join.

### Worker module `apps/worker/src/modules/staff`

- `domain/document-expiry.ts` — pure window rule.
- `ports/document-expiry.port.ts` — `DocumentExpiryTransactions` (businesses, business timezone, candidate page,
  notify) and `Clock` (reused).
- `persistence/document-expiry.transactions.ts` — Drizzle/SQL inside `withTenant`; the business timezone is read
  through the tenancy export `businessTimeZone` (ADR-0024/0031 pattern).
- `use-cases/detect-document-expiries/` — pages per business, pre-filters with the domain, then notifies one
  document per transaction.
- `jobs/document-expiry.processor.ts` — BullMQ queue, worker (concurrency 1) and the scheduler registrar.
- `events/published.ts` — `DocumentExpiring`.

Business discovery is also keyset-paged (`business_id > after`, `ORDER BY business_id LIMIT 100`) through
the same partial scan index. Each transaction returns at most one page, and the run retains only its current
page and counters. The tenancy read reuses ADR-0031's existing staff-to-tenancy port arrow; its worker adapter
and public export are declared in both module-map sources.

### Events and audit

`DocumentExpiring` payload: `document_id, employee_id, business_id, type_code, expires_on, days_remaining,
alert_days, today, detected_at` — no object key, no employee name, no document content. It carries **no
`notification_recipients`** (see MO-Q1) so the notifications consumer acknowledges it unsent. Audit:
`employee_document` / `document_expiring.notified` with actor NULL (system). The email and WhatsApp channels are
untouched (spec 011: PR 15 must not emit live email requests).

## Test plan

Pure: the window boundaries (alert_days 0, the expiry day, the day before, the day after, a multi-day window),
a timezone edge where the business date differs from UTC, and `NO_EXPIRY` ignored. PostgreSQL (cloned per file,
as `pospay_app`): once-only across two runs and a concurrent second worker, a replaced document, an edited
`alert_days`, a document without expiry ignored, another tenant untouched, RLS negative test and grants for the
new table (including refusal to update `recipients_attached_at`), the NULL marker after emission, and `EXPLAIN`
of the scan (`employee_document_expiry_scan_idx`). Redis: `EmployeeDocumentRecorded`
delivery registers one id-only schedule per company, re-delivery is idempotent, a scheduling failure is a
retryable outcome. Consumer: `DocumentExpiring` with no recipients is accepted unsent; with an IN_APP recipient
it stores one in-app notification.

Gates: `pnpm check` without FORCE_COLOR; api + worker builds; production startup with optional settings empty.

## Provisional owner questions

- MO-Q1 — notification recipients for `DocumentExpiring`: TODO(spec). SPEC §3 says the emitting module reads
  `AlertRulesPort` and puts recipients and channels in the event, but alert rules ship in PR 62, so this slice
  emits the event with no recipients and notifications acknowledges it unsent. `recipients_attached_at` remains
  NULL, preserving PR 62's one-time recipient-bearing re-emission for documents still current and inside their
  window, under the contract above. PR 15 does not implement recipient attachment. Recommend: when alert rules
  ship,
  the document-expiry alert defaults to the users holding `manage:document-types:company` at the company
  (owner/general_manager by default; business_manager with a personal ALLOW), in-app only until email/WhatsApp are
  activated. Implementing it before PR 62 would need a new identity read (outside this slice).
- MO-Q2 — job cadence: TODO(spec), recommended every 6 hours (implemented).
- MO-Q3 — page size: TODO(spec), recommended keyset pages of 100 candidates per query (implemented).
- MO-Q4 — documents recorded before this release: TODO(spec), recommended they register their company only when a
  later `EmployeeDocumentRecorded` is delivered (the ADR-0032 precedent for clock-ins), rather than a backfill.
  Owner decision (2026-10-05, recommended option): before the pilot goes live, replay each existing company's
  prior `EmployeeDocumentRecorded` events once in a controlled way so its schedule is registered.
- MO-Q5 — soft-deleted employees and inactive document types: TODO(spec). The scan does not join `employees`, so
  once recipients exist (PR 62) a deleted employee's current documents could still be announced. No runtime soft-delete
  path exists yet. Recommended: filter `employees.deleted_at IS NULL` and active types when PR 62 adds recipients.
- A replacement document with the same `expires_on` is a new document id and produces its own notice (by design,
  DE-03).

## Success criteria

DE-01–DE-06 pass; never two ledger rows or two PR 15 recipient-free events per (document, expiry date); the job
reads and writes only inside `withTenant` of the scheduled company; no live email or WhatsApp request is emitted.
