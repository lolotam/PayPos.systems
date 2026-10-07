# Staff clock by card — Phase 1 PR 23

Created: 2026-10-05. Status: owner questions decided 2026-10-07. Shipped in two PRs (CB-Q4): **PR 23a** —
employee cards (issue / revoke, the admin section, the `employee_cards` table); **PR 23b** — clock-by-card on the
paired device, on top of 23a.

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
architecture decision. ADR-0036 records the branch-scoped spelling and explicit Device/operator checks, following PR 19 and ADR-0019; no permission CHECK change (CB-Q5 resolved).

`packages/contracts` gains `clockByCardInput`, `issueEmployeeCardInput`,
`employeeCard`, `employeeCardsView` and the OpenAPI paths for
the device clock and for issue/revoke/list under
`/v1/businesses/{businessId}/employees/{employeeId}/cards`.
Revocation has no request body; its card ID is a validated path parameter.

List, issue, and revoke authorize `manage:employees:business` at the employee's persisted primary branch and every open branch attachment. A business-scope ALLOW does not override a branch-scope DENY on any of those branches. Issue and revoke hold the existing company and caller-membership locks, lock the employee row, read those branches, and only then decide, so a concurrent branch move or permission change cannot pass the check. A denied caller receives the same NOT_FOUND as a missing employee. The staff feature is reported as disabled only after that branch check allows management.

### Business rules, schema and events

`employee_cards` is a tenant table: `(company_id, id)` primary key, `business_id`,
`employee_id`, `card_code_hash`, `card_code_suffix`, `issued_at`, `issued_by`, `revoked_at`, `revoked_by`. Two
partial unique indexes hold one active card per employee and one active company-scoped HMAC per company. The composition root calls `packages/auth`'s `deriveEmployeeCardKey` (HKDF-SHA256 with salt `pospay:employee-card:hkdf-salt:v1` and info `pospay:employee-card:key:v1`). Staff receives only the derived 32-byte Buffer, never BETTER_AUTH_SECRET; rotating that root requires reissuing cards (ADR-0036). Daily QR secrets are unsuitable because they expire. `issued_by`/`revoked_by` reference the operator user and the revocation pair is
CHECKed together. RLS is FORCE + command-specific tenant policies for `pospay_app` with
SELECT/INSERT and column-limited UPDATE. The card code is card-like secret material:
never logged, never in audit/events, and never returned in full. Only normalized codes of length >= 8 expose their last four characters; shorter codes store/return an empty suffix. The allowed 4–64 range remains unchanged. Lookup, issue, revoke and clock fingerprints each use a distinct HMAC payload label (ADR-0036).

A nonlocking hash lookup identifies the employee; AttendanceState is the first lock, followed by company, ordered memberships, device, employee/attachments, branch, and finally a locked card recheck. Unknown/revoked/foreign cards use an empty candidate through the same eligibility query sequence as unattached cards, with no explicit timing delay or case-specific response. Permission and device eligibility are checked independently of card existence.

The card is a second entry point into the spec-027 domain. `attendanceTransition`,
`attendanceDuplicate`, `attendanceWorkingDate`, `attendanceSchedule`,
`attendanceGeofence`, `attendanceLateMinutes` and `attendanceMissedDeadline` are imported
unchanged; the shared attendance writer is parameterised with the movement source, the
optional passkey binding and the device/operator instead of being duplicated. Issuing and
revoking a card are audited; no business event is emitted (attendance never changes
commission).

The POS card screen is available only with an operator session. A 401 has its own bilingual signed-out outcome and refetches staff-session/device status. Scanner and issue fields are text inputs masked with `-webkit-text-security: disc`, with autocomplete, spellchecking and capitalization disabled.

### Test plan

Pure tests cover card-code normalisation/validation and suffix masking; adapter tests cover keyed, tenant-separated digests and the
reused transition/dedupe boundaries through the card entry point. Real migrated PostgreSQL
tests cover card clock-in and clock-out, the 5-minute dedupe shared with the passkey path,
the 16 h rule through the card, revoked and unknown cards answering identically, another
company's card, a branch the employee is not attached to, issue/revoke idempotency and
audit, the Device-without-permission and non-Device refusals, RLS reads/writes plus the two
partial-uniqueness rules. Card list, issue, and revoke with business ALLOW plus a branch DENY
on the employee's branch match a missing employee; ALLOW on that branch still permits all three. POS tests cover the scanner input (type then Enter), the ignored
second scan while pending, the offline notice, and ar/en results.

Gates: pnpm check without FORCE_COLOR; API/POS/admin builds; production startup smoke with
all optional settings empty if startup wiring changes.

## Owner questions

- CB-Q1 — card location: a fixed reception device samples no phone location, so the scan
  records the `NONE` exception exactly as spec 027 does for a missing location. Alternative:
  treat the fixed device as `OK` because it is physically installed at the branch. **Decided
  (Waleed, 2026-10-07): keep `NONE`**, so the report stays truthful.
- CB-Q2 — resolved by the review request: store only a company-scoped HMAC and a suffix that never contains the whole code; hash lookups and keyed idempotency fingerprints, no plaintext column. Regenerated this slice's 0085/0086 (ADR-0036).
- CB-Q3 — who may clock by card: `clock:attendance:branch` is granted by default to the
  reception-capable human roles (owner, general manager, business manager, branch manager,
  shift supervisor, cashier). The review request makes Cashier staff login a default (previously optional in PR 7a), so a normal reception Cashier can use both capabilities. Owner/admin status still never enables staff login. Other manager/supervisor operators require a separate Cashier membership or an explicitly configured custom reception role. **Decided (Waleed, 2026-10-07): accepted as proposed.**
- CB-Q4 — card management as its own PR: issuing/revoking cards is small but security-shaped;
  **decided (Waleed, 2026-10-07): split** — PR 23a ships card management first, PR 23b ships
  clock-by-card on top of it.
- D5 — deferred to the orchestrator issue: expose Cashier staff-login DENY through the permissions screen.
- D6 — deferred to the orchestrator issue: define and implement rate limits for card clocking and issuance.
- CB-Q5 — resolved: keep `clock:attendance:branch` at the verified device branch; explicit Device plus operator session, no CHECK change. PR 19 uses explicit Device checks, not a stored `:device` scope (ADR-0036).

## Success criteria

CB-01–CB-08 pass, the shared state machine is the only implementation (no second transition,
dedupe, 16 h or lateness code), cross-company reads return no rows and writes cannot cross
tenant-qualified FKs, and no card code appears in logs, audit, outbox or events.
