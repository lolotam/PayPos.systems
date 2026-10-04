# Staff clock attendance — Phase 1 PR 22

Created: 2026-10-04. Status: implemented with provisional owner questions below.

Sources: Phase 1 SPEC §§4/7/11, plan rows 22–28 and D-53 verdict, ADR-0013 §8,
ADR-0020, ADR-0024, ADR-0027, specs 008/024. Scope is personal QR attendance only.

## User scenarios and requirements

P1: an eligible employee signs in on their own phone, scans the reception QR,
unlocks their registered passkey, and sees the accepted clock result and exceptions.
This journey is independently tested through both personal HTTP routes with a real
synthetic authenticator and migrated PostgreSQL, plus camera/client/result UI tests.

- AT-01: no open session becomes one OPEN session, including simultaneous first scans.
- AT-02: an open session younger than 16h closes; exactly 16h becomes MISSED_OUT plus a new OPEN.
- AT-03: a fresh signed scan within 5m returns the previous accepted result unchanged;
  missing UV/replayed assertions never authorize a scan. At exactly 5m a transition is allowed.
- AT-04: challenge scope, 120s expiry, QR windows/branch, live binding revision, membership,
  employee link and dated attachment are enforced; inaccessible resources stay unknown.
- AT-05: missing/out-of-range location records an exception and still clocks; late minutes
  are report facts, and overnight closure retains the original working date.
- AT-06: idempotency replay is identical; changed bodies are rejected; rollback leaves no
  attendance/audit/event/idempotency effect and requires a fresh assertion.
- AT-07: online-only ar/en camera → passkey → result works; cancellation/unmount stops
  capture and prevents a pending assertion from submitting after logout/offline.
- AT-08: routine personal-session validation keeps the last confirmed session and
  mounted camera/passkey ceremony. Confirmed invalidation, logout, operator replacement
  or going offline tears it down and clears private caches; transient validation failure
  does not count as confirmed invalidation.
- AT-09: shared personal eligibility checks dated attachments against each branch's
  local date from the injected Clock (`from <= today`, exclusive `to > today`). Unknown
  branch dates fail closed. This also applies to OTP/session validation, enrolment
  (including its locked recheck), own schedule and own leave.

## Slice design

### API contract and permissions

`POST /v1/staff/attendance/challenge` accepts a scanned `token` and optional
`location {lat,lng,accuracy}`. It returns `challenge_id` and authentication options
requiring UV. `POST /v1/staff/attendance/clock` accepts the same scan/location,
challenge id and WebAuthn assertion; Idempotency-Key is required. Both return 200,
declare Authenticated plus PERSONAL_ROUTE and derive employee/user/company/business
from the restricted personal session. Kiosk, device, admin and employee selectors
are refused. Unavailable/inaccessible employee, branch or binding is NOT_FOUND.

Every request samples the injected Clock once after all eligibility-context locks.
State is locked first; then live
company/membership, employee, binding and branch are locked/rechecked. A server-only
challenge record freezes scope, operation, binding revision and a digest of QR/location;
the auth facade consumes the assertion atomically with required UV. Session proof
alone cannot clock. Recheck current/previous QR window and same active attached branch.
QR signature verification uses this locked branch timezone without a nested tenant transaction.

### Business rules, schema and events

No open session opens one. An open session younger than 16 hours closes normally;
at exactly 16 hours or older it closes MISSED_OUT and a new session opens. A scan
strictly within five minutes returns the previous accepted response unchanged;
exactly five minutes permits the next transition. Working date is the clock-in
calendar date in the QR branch timezone, retained when closed overnight.

AttendanceState exists for every employee via backfill and an invoker insertion
trigger; no first-scan missing-row race. The backfill and trigger installation
hold an employee-table write lock together. AttendanceSession has one partial-unique
OPEN row per company/employee, branch/business/date board indexes, UTC instants,
binding/revision and QR/location snapshots for each endpoint, source/device/operator
fields reserved for PR 23. Lateness is a stored report fact (minutes since scheduled
start; at most ten minutes means zero), never a commission effect. Exception records
hold OUT_OF_RANGE/NONE/SUSPECTED_MISSED_OUT, status/resolution/actors/reason for PRs
24–26. Normal close resolves an existing suspected exception as CLOSED_LATE.
Clock challenge metadata is tenant-protected; assertions/credential material are
never persisted in tenant storage, logs, audit or events. All four tables FORCE RLS.
State/session/audit/outbox/idempotency commit atomically. Events are
AttendanceClockedIn, AttendanceClockedOut and AttendanceMissedOut; no commission consumer.

### Test plan

Pure tests cover every transition, exact 16h/5m/10m/150m boundaries, unchanged dedupe,
Kuwait and DST calendar/overnight dates, haversine/accuracy, scheduled/no-schedule lateness.
Real migrated PostgreSQL tests cover RLS reads/writes/FKs, simultaneous first scans,
assertion UV/replay/context failures, unbind revision/membership/attachment fencing,
idempotency replay/body mismatch, rollback of session/audit/outbox, suspected close,
and board/report index EXPLAIN. POS tests cover camera scan, passkey cancellation,
offline/cache clearing, results/exceptions in ar/en. Online-only personal scan UI
uses the generated client; no cards, missed-out job, correction, board or alerts ship.
Parent-screen tests keep a pending attendance request alive across polling and abort
it on confirmed invalidation. HTTP tests cover a non-primary Kuwait attachment on
both sides of local midnight, including the exclusive attachment end.

Gates: pnpm check without FORCE_COLOR; API/POS builds, auth build for browser helper;
production startup smoke with all optional settings empty if startup wiring changes.

## Provisional owner questions

- AT-Q1 — owner decision 2026-10-04 (recommended option): missing branch coordinates: NONE exception, permit clock.
- AT-Q2 — owner decision 2026-10-04 (recommended option): accuracy: OUT_OF_RANGE only when distance minus accuracy >150m.
- AT-Q3 — owner decision 2026-10-04 (recommended option): denied/unavailable location: NONE exception, permit clock.
- AT-Q4 — owner decision 2026-10-04 (recommended option): QR branch/date: require a recorded employee attachment on
  that branch's local date; no primary-branch fallback over historic attachments.
- AT-Q5 — owner decision 2026-10-04 (recommended option): schedule selection: containing shift, otherwise earliest
  shift starting on clock-in local date; no schedule means zero lateness. An early scan
  before an overnight shift starts belongs to the scan date, as SPEC explicitly says.
- AT-Q6 — owner decision 2026-10-04 (recommended option): missed-out closure instant: the 16-hour deadline, with
  detection/recording time separately represented by event recorded_at; never invent hours/pay.
- AT-Q7 — owner decision 2026-10-04 (recommended option): grace reports: zero through exactly ten minutes; after that
  report full elapsed whole minutes, without subtracting grace.

## Success criteria

All AT-01–AT-09 checks pass, there is never more than one OPEN session per employee,
cross-company reads return no rows and writes cannot cross tenant-qualified FKs.
Attendance creates no salary/commission deduction. PRs 23–28 remain separate slices.

### Shared-installation signal (PR 22b)

The clock body also requires `installation_id` (ADR-0029 `attendanceInstallationSignal`);
the challenge does not take it and its scan digest ignores it. The POS personal app
generates it once in `localStorage`, keeps it across logout/operator replacement and
never syncs it. Each accepted scan — CLOCK_IN, CLOCK_OUT, or MISSED_OUT plus CLOCK_IN —
writes exactly one `attendance_device_signals` row in the same transaction: QR branch,
the sampled instant, the company-scoped hash and `clock_event_id` = the scan movement's
audit row id. Dedupe, idempotent replay, refusal and rollback leave no row. Tests cover
these cases, the raw id absent from every attendance/audit/outbox/idempotency row,
tenant separation, and two employees on one installation flagged by the PR 21 query.
