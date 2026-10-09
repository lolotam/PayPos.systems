# Feature Specification: Passkey phone lock — a phone bound to one employee refuses another employee's clock

**Feature Branch**: `feat/p1-21b-passkey-device-lock`

**Created**: 2026-10-10

**Status**: Draft — owner questions PL-Q1 … PL-Q4 **PENDING** (`owner-questions.ar.md`). Not ready for `/speckit-plan`
until they are answered.

**Input**: Phase 1 plan row **21b** (`docs/specs/phase-1/IMPLEMENTATION-PLAN.md`): "a phone bound by passkey to one
employee refuses another employee's clock-in (block, replacing the warn-only two-employees flag for passkey devices; the
shared reception card device is unaffected)". Depends on rows 21 (spec 026, ADR-0029) and 22 (spec 027). Also builds on
spec 024 (enrol passkey), spec 032 (clock by card), ADR-0027.

## Owner decision already taken (2026-10-09, UNB-Q2 — binding)

- Original rule (spec 026 UNB-Q2): alert the manager when two employees clock from the same phone within ten minutes,
  never block.
- Partner asked to lock each user to her own phone. **Final: block.** A phone bound to an employee's personal passkey
  does not accept an attendance clock for another employee.
- The card on the reception device is **not** part of this block.

## Owner questions (PENDING — see `owner-questions.ar.md`)

| ID | Topic | Recommended |
|---|---|---|
| PL-Q1 | One-way lock (the phone refuses others) or two-way (also: the employee clocks only from her phone) | two-way |
| PL-Q2 | Lost / changed phone, or app data wiped: who moves the lock | manager unbind, as today (row 21) |
| PL-Q3 | What the refused employee sees; is the attempt recorded / alerted | clear message + recorded for the board, no push |
| PL-Q4 | One phone per employee, or more | exactly one |

## User Scenarios & Testing *(mandatory)*

### User Story 1 — My phone clocks only me (Priority: P1)

Sara enrolled her passkey on her own phone at the Salmiya branch. Heba's phone is at home; she borrows Sara's phone,
signs in with her own WhatsApp code and tries to clock in. The phone refuses and tells her to use her own phone or the
reception card. Sara keeps clocking from her phone as before.

**Why this priority**: it is the owner's decision; buddy-punching affects hours and lateness reports.

**Independent Test**: enrol A on installation X; sign in as B on X; request a clock challenge and a clock → both refused
with `ATTENDANCE_DEVICE_LOCKED`; no session, audit, outbox, idempotency or signal row; A still clocks from X.

**Acceptance Scenarios**:

1. **DL-01** — **Given** A's active binding is locked to installation X, **When** B (another person, same company)
   requests a challenge or clocks from X, **Then** it is refused with `ATTENDANCE_DEVICE_LOCKED`, before any UV
   ceremony is consumed, and nothing is written in the attendance transaction.
2. **DL-02** — **Given** the same, **When** A clocks from X, **Then** the spec 027 state machine runs unchanged.
3. **DL-03** — **Given** the challenge was issued before a lock change (race), **When** the clock arrives, **Then** the
   locked recheck at the clock decides; the challenge decision is advisory.
4. **DL-04** — **Given** A is locked to X, **When** A clocks from installation Y, **Then**
   `TODO(spec) → PL-Q1` (two-way: refused `ATTENDANCE_DEVICE_NOT_ENROLLED`; one-way: accepted).

### User Story 2 — A phone cannot be enrolled for a second person (Priority: P1)

Without this, Heba would simply enrol her passkey on Sara's phone and the lock would be empty.

**Independent Test**: enrol A on X; sign in as B on X; registration options and verify are refused with
`PASSKEY_DEVICE_TAKEN`; no binding, audit or event is written; a global credential created before the refusal stays inert
(spec 024 KEY-05).

**Acceptance Scenarios**:

1. **DL-05** — **Given** X belongs to A's active binding, **When** B asks for registration options from X, **Then**
   refused `PASSKEY_DEVICE_TAKEN` (no ceremony started).
2. **DL-06** — **Given** two people enrol from the same new installation concurrently, **Then** exactly one binding gets
   it; the other is refused.
3. **DL-07** — **Given** the same person has employee records in two businesses of one company, **When** she enrols the
   second record from her phone, **Then** it is accepted (the lock is per person, not per employee row).

### User Story 3 — Releasing a phone (Priority: P2)

A manager unbinds A's passkey (row 21); the phone is released together with it and B (or A on a new phone) can enrol.

**Acceptance Scenarios**:

1. **DL-08** — **Given** A is locked to X, **When** a permitted manager unbinds A, **Then** X is free: B can enrol on X;
   a stale challenge for A fails as today.
2. **DL-09** — Lost phone / wiped app data / new phone: `TODO(spec) → PL-Q2`.

### User Story 4 — Existing bindings and the card (Priority: P2)

1. **DL-10** — **Given** a binding made before this change (no phone recorded), **When** its employee's next clock is
   accepted from X, **Then** X is attached to that binding, unless X already belongs to another person (then refused as
   DL-01).
2. **DL-11** — Clock by card on the paired reception device (spec 032) is unaffected: same results, no installation
   involved, any employee.

### Edge Cases

- Private window / blocked storage: a new installation per page load. Two-way lock refuses it (not the enrolled phone);
  one-way lock would accept it — see PL-Q1.
- Two browsers or the iOS home-screen app vs Safari on one phone look like two phones (research R2). Residual risk,
  stated to the owner.
- Employee mid-shift loses her phone: under two-way lock she cannot clock out from another phone; card at reception or
  the 16 h missed-out job (spec 029) covers it.
- Idempotent replay of an already accepted clock from another installation returns the stored response, no new effect.
- Five-minute dedupe never bypasses the lock: the lock check runs first.
- Personal sign-in, own schedule and own leave on another person's phone stay allowed; only enrollment and clocking
  are locked.
- Cross-company: the lock is company-scoped (company-separated hash). A phone locked in one company says nothing in
  another.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A personal-app installation belongs to at most one person's active binding in a company.
- **FR-002**: Enrollment records the requesting installation on the new binding and is refused when the installation
  belongs to another person's active binding.
- **FR-003**: Clock challenge and clock are refused when the installation belongs to another person's active binding.
- **FR-004**: Clocks from an installation other than the employee's own locked one: `TODO(spec) → PL-Q1`.
- **FR-005**: Unbinding a passkey releases its installation in the same transaction (no new column write needed: the
  lock follows the active binding).
- **FR-006**: Recovery after phone loss / data wipe: `TODO(spec) → PL-Q2`.
- **FR-007**: Refusal message (ar/en) to the employee; recording or alerting of refused attempts: `TODO(spec) → PL-Q3`.
- **FR-008**: Number of phones per employee: `TODO(spec) → PL-Q4` (recommended one; the schema keeps one active binding
  per employee).
- **FR-009**: The ten-minute advisory pair rule and its unused query are retired; per-clock installation observations
  are still written (UNB-Q4).
- **FR-010**: The card path, the kiosk staff session and the per-clock UV requirement are unchanged.
- **FR-011**: No fingerprinting and no new personal data; the raw installation id never reaches the database, logs,
  audit or events (ADR-0029).

### Key Entities

- **Binding phone lock**: the company-separated hash of the installation on an employee's active binding; set at
  enrollment or first accepted clock, immutable while the binding is active, released by unbind.
- **Refused attempt** (only if PL-Q3 keeps it): who tried, on whose phone, branch, time, which step.

## Slice design *(mandatory — `CLAUDE.md` §1)*

### Business rules

- **BR-001** (owner, UNB-Q2): phone locked to Sara refuses Heba's clock, refusal before Face ID where possible.
- **BR-002**: enrollment is locked the same way (follows from BR-001; otherwise the lock is empty).
- **BR-003**: "another employee" means another person (different linked user).
- **BR-004**: the lock is released only by unbind (row 21 permissions, UNB-Q1); recovery `TODO(spec) → PL-Q2`.
- **BR-005**: legacy bindings attach on first accepted clock (technical default; no live tenant yet — research R3).
- **BR-006**: direction of the lock `TODO(spec) → PL-Q1`; refusal visibility `TODO(spec) → PL-Q3`; phone count
  `TODO(spec) → PL-Q4`.

### Schema changes (expand only)

| Table | Columns added / changed | RLS policy | Indexes | Tenant-qualified FKs |
|---|---|---|---|---|
| `employee_passkeys` | `installation_hash text NULL` (CHECK `^[a-f0-9]{64}$`) | existing FORCE RLS unchanged; add column `UPDATE(installation_hash)` grant to `pospay_app`; trigger: may go NULL → value once, never change or clear | `(company_id, installation_hash) WHERE unbound_at IS NULL AND installation_hash IS NOT NULL` (non-unique: same person, two businesses — BR-003; uniqueness per person enforced under an advisory lock in the transaction) | none new |
| refused-attempt table | only if PL-Q3 = record; tenant table, `(company_id,id)` PK, FORCE RLS select/insert, immutable | new policy + negative test | `(company_id, branch_id, attempted_at)` | employee/branch tenant FKs |

`attendance_device_signals` unchanged. Migration numbers assigned at merge (next free 0103).

### API contract

- `POST /v1/staff/attendance/challenge`: `clockChallengeInput` gains optional `installation_id` (UUID v4). Refusal
  `ATTENDANCE_DEVICE_LOCKED` (403); two-way `ATTENDANCE_DEVICE_NOT_ENROLLED` (403) if PL-Q1 = two-way.
- `POST /v1/staff/attendance/clock`: unchanged body (already requires `installation_id`); Idempotency-Key stays required;
  `installation_id` stays out of the fingerprint. Same refusals, authoritative under lock.
- `POST /v1/staff/passkey/options`: optional body `{installation_id}`; `POST /v1/staff/passkey/verify`:
  `passkeyVerifyInput` gains optional `installation_id`. Refusal `PASSKEY_DEVICE_TAKEN` (409).
- `GET /v1/businesses/{businessId}/employees/{employeeId}/passkeys`: status gains `phone_locked: boolean` and
  `phone_locked_since` (no hash).
- Remove `sharedInstallationFlag` / `sharedInstallationFlagPage` (no route uses them).
- All errors bilingual (`message_ar` / `message_en`). Guards unchanged (`@Authenticated()` + PERSONAL purpose; manager
  read under `read:passkeys:branch`).

### Permissions

No new permission. Release = existing `unbind:passkeys:branch` (UNB-Q1 holders) unless PL-Q2 adds self-service.

### Events

- Existing `EmployeePasskeyBound` payload unchanged (no hash in events).
- No new event, unless PL-Q3 picks the in-app alert (then `AttendanceDeviceRefused` through the row-28 notice path,
  with a module-map/ADR-0010 check).

### Test plan

- **Domain unit**: lock decision table — no lock/attach, own lock, other person's lock, same person other record,
  legacy binding, two-way vs one-way branch.
- **Integration**: DL-01 … DL-11 on real Postgres + synthetic authenticator; concurrency (two enrolments on one
  installation; enrol vs unbind; attach vs enrol); refusal leaves no session/audit/outbox/idempotency/signal row;
  replay from another installation; card regression.
- **RLS negative**: new column cannot be read/updated cross-tenant; update grant only `installation_hash`; trigger
  refuses change/clear; refused-attempt table (if any) cross-tenant read 0 rows / write refused / FK refused.
- **Queries**: passkey status result shape with `phone_locked`; `EXPLAIN` uses the new partial index for the lock lookup.
- **POS / admin**: refusal screens in ar/en; installation id sent on challenge/options/verify; admin shows "phone locked".

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of clock attempts by a second person from a locked phone are refused, with zero attendance effect.
- **SC-002**: 0 cases where a phone holds active bindings of two different people in one company.
- **SC-003**: The employee who owns the phone sees no extra step compared with today.
- **SC-004**: Card clocks at reception behave exactly as before (all spec 032 tests pass unchanged).

## Assumptions

- "Phone" = the personal POS app installation (random id in browser storage); a browser cannot prove a physical device
  without fingerprinting (research R2). The owner is told this in the questions file.
- A new ADR amends ADR-0029 ("do not block on the signal").
- No live salon data yet (trial row 63 not started), so legacy handling targets staging test data only.
- Board (row 27) drops the pair list from its scope.
