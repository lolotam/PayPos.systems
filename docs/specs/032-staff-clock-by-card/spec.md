# Staff clock by card — Phase 1 PR 23

Created: 2026-10-05. Status: implemented with provisional owner questions below.

Sources: Phase 1 SPEC §§4/7/11 (A1/A8, D-52/D-53), plan row 23, ADR-0003 §4 path B
(the paired device principal), ADR-0019 (staff session on a shared device), spec 027
(clock-attendance — the state machine, dedupe, 16 h rule, geofence and lateness are
**reused**, never re-implemented). Scope is the card fallback scanned on the paired
reception device; correction, resolution and the board remain PRs 25–27.

## User scenarios and requirements

P1: an employee without a usable phone walks to reception; the reception operator
(already signed in on the paired device) scans the employee's attendance card with a
keyboard-wedge scanner; the device calls `clock-by-card` once, and the screen shows the
same accepted clock result the personal QR path would show. The device and the operator
are recorded on the session. This journey is independently tested through the HTTP route
with a real paired device, a real staff session and migrated PostgreSQL, plus POS screen
tests.

- CB-01: the route is reachable only from a paired Device session **with a signed-in
  operator**; an ordinary browser/personal session is refused, and a pure device (no
  operator) is refused.
- CB-02: the operator must hold `clock:attendance:branch` at the device's branch; a device
  whose operator lacks it is refused with FORBIDDEN.
- CB-03: a scan with no open session opens one; an open session younger than 16 h closes
  normally; at 16 h or older it closes MISSED_OUT and a new session opens — exactly the
  spec-027 state machine.
- CB-04: a scan within five minutes returns the previous accepted result unchanged, shared
  with the personal passkey path through `attendance_states`; exactly five minutes permits
  the next transition.
- CB-05: a revoked card and an unknown card answer identically (NOT_FOUND); a card of
  another company or a branch the employee is not attached to on that date answers the
  same NOT_FOUND.
- CB-06: idempotency replay is identical; a changed command body is rejected; rollback
  leaves no session/audit/outbox/idempotency effect.
- CB-07: the accepted movement records `source='BARCODE'`, `device_id`, `operator_id`, no
  passkey binding, and writes exactly one audit row and one AttendanceClocked* event in
  the same transaction. The card code never appears in logs, audit, outbox or events.
- CB-08: lateness, schedule selection, working-date/overnight, 16 h deadline and geofence
  are computed by the shared spec-027 domain functions; a fixed device has no phone
  location and therefore records `NONE` (see CB-Q1).

## Slice design

### API contract and permissions

`POST /v1/devices/me/clock-by-card` accepts `{card_code}` and requires an
`Idempotency-Key`. It returns the same `ClockAttendanceResult` as the personal route.
The Device token and the kiosk staff cookie are both required; company/business/branch
and device come from the verified device context, never from the body, and the operator
is the verified staff-session user. Unavailable/ineligible employee, branch or card is
NOT_FOUND. The permission `clock:attendance:branch` is evaluated at the device's branch
through identity's existing access reader. SPEC §7 names it `clock:attendance:device`,
but the `permissions` catalog CHECK (ADR-0003 §2.2) allows only
`platform|company|business|branch|own`, so a `:device` code cannot be stored without an
architecture decision; the branch-scoped code is the faithful, valid spelling (CB-Q5).

`packages/contracts` gains `clockByCardInput`, `issueEmployeeCardInput`,
`revokeEmployeeCardInput`, `employeeCard`, `employeeCardsView` and the OpenAPI paths for
the device clock and for issue/revoke/list under
`/v1/businesses/{businessId}/employees/{employeeId}/cards`.

### Business rules, schema and events

`employee_cards` is a tenant table: `(company_id, id)` primary key, `business_id`,
`employee_id`, `card_code`, `issued_at`, `issued_by`, `revoked_at`, `revoked_by`. Two
partial unique indexes hold one active card per employee and one active card code per
company. `issued_by`/`revoked_by` reference the operator user and the revocation pair is
CHECKed together. RLS is FORCE + a single tenant policy for `pospay_app` with
SELECT/INSERT and column-limited UPDATE. The card code is card-like secret material:
never logged, never in audit/events, and never returned in full (only a suffix).

The card is a second entry point into the spec-027 domain. `attendanceTransition`,
`attendanceDuplicate`, `attendanceWorkingDate`, `attendanceSchedule`,
`attendanceGeofence`, `attendanceLateMinutes` and `attendanceMissedDeadline` are imported
unchanged; the shared attendance writer is parameterised with the movement source, the
optional passkey binding and the device/operator instead of being duplicated. Issuing and
revoking a card are audited; no business event is emitted (attendance never changes
commission).

### Test plan

Pure tests cover card-code normalisation/validation, the constant-time comparison and the
reused transition/dedupe boundaries through the card entry point. Real migrated PostgreSQL
tests cover card clock-in and clock-out, the 5-minute dedupe shared with the passkey path,
the 16 h rule through the card, revoked and unknown cards answering identically, another
company's card, a branch the employee is not attached to, issue/revoke idempotency and
audit, the Device-without-permission and non-Device refusals, RLS reads/writes plus the two
partial-uniqueness rules. POS tests cover the scanner input (type then Enter), the ignored
second scan while pending, the offline notice, and ar/en results.

Gates: pnpm check without FORCE_COLOR; API/POS/admin builds; production startup smoke with
all optional settings empty if startup wiring changes.

## Provisional owner questions

- CB-Q1 — card location: a fixed reception device samples no phone location, so the scan
  records the `NONE` exception exactly as spec 027 does for a missing location. Alternative:
  treat the fixed device as `OK` because it is physically installed at the branch. Recommended
  answer: keep `NONE` until the owner decides, so the report stays truthful; revisit as an
  owner decision before the exception board (PR 27).
- CB-Q2 — card-code storage: the SPEC lists `card_code`, so the raw code is stored for the
  equality lookup used by a keyboard-wedge scan. Recommended answer: add an ADR and store a
  keyed HMAC (plus a display suffix), matching how the QR secret and the passkey material are
  treated; this changes the lookup and needs its own migration.
- CB-Q3 — who may clock by card: `clock:attendance:branch` is granted by default to the
  reception-capable human roles (owner, general manager, business manager, branch manager,
  shift supervisor, cashier). Recommended answer: confirm the exact bundle; the code is
  deliberately not granted to non-reception roles.
- CB-Q4 — card management as its own PR: issuing/revoking cards is small but security-shaped;
  recommended answer: keep it in this PR only if the owner accepts the admin section, else
  split it into its own `--cards-management` PR before PR 23 ships.
- CB-Q5 — permission code: SPEC §7 says `clock:attendance:device`, but the `permissions`
  CHECK allows only `platform|company|business|branch|own`. Recommended answer: keep the
  valid `clock:attendance:branch` and, if the owner truly wants a `:device` scope, record an
  ADR and relax the CHECK (it would also need a new guard target).

## Success criteria

CB-01–CB-08 pass, the shared state machine is the only implementation (no second transition,
dedupe, 16 h or lateness code), cross-company reads return no rows and writes cannot cross
tenant-qualified FKs, and no card code appears in logs, audit, outbox or events.
