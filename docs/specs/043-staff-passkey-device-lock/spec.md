# Feature Specification: Passkey phone lock — a phone bound to one employee refuses another employee's clock

**Feature Branch**: `feat/p1-21b-passkey-device-lock`

**Created**: 2026-10-10

**Status**: Ready for plan — owner questions PL-Q1 … PL-Q4 **ANSWERED** by Waleed on 2026-10-10 (all on the
recommended option; the partner has not answered yet, Waleed said to proceed). Design recorded in
[ADR-0039](../../adr/0039-passkey-installation-lock.md) (Proposed), which amends ADR-0029.

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

## Owner answers (ANSWERED 2026-10-10 — `owner-questions.ar.md`, binding)

| ID | Topic | Waleed's final answer |
|---|---|---|
| PL-Q1 | One-way or two-way lock | **two-way**: Sara's phone accepts only Sara, and Sara clocks only from her phone or with the reception card |
| PL-Q2 | Lost / changed phone, or app data wiped | **manager unbinds**, as row 21 (owner, general manager, business manager, branch manager for her branch); she enrols from the new phone; meanwhile she clocks with the card |
| PL-Q3 | What the refused employee sees; recorded / alerted | **clear message** + the attempt is **recorded** and shown to the manager on the attendance board, **no instant notification** |
| PL-Q4 | One phone or more | **one phone**; to change it a manager unbinds |

Partner (أبو سالم / محمد العنزي): not answered yet — to be added later.

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
4. **DL-04** (PL-Q1 two-way) — **Given** A is locked to X, **When** A requests a challenge or clocks from installation
   Y (not held by anyone), **Then** it is refused `ATTENDANCE_DEVICE_NOT_ENROLLED` with the same no-effect guarantees
   as DL-01, and the attempt is recorded (DL-12).

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
4. **DL-07b** (PL-Q4 one phone) — **Given** the same person's first record is locked to X, **When** she enrols her
   second record from installation Y, **Then** it is refused `PASSKEY_OTHER_DEVICE` (409); she enrols it from X, or a
   manager unbinds the first record.

### User Story 3 — Releasing a phone (Priority: P2)

A manager unbinds A's passkey (row 21); the phone is released together with it and B (or A on a new phone) can enrol.

**Acceptance Scenarios**:

1. **DL-08** — **Given** A is locked to X, **When** a permitted manager unbinds A, **Then** X is free: B can enrol on X;
   a stale challenge for A fails as today.
2. **DL-09** (PL-Q2) — **Given** A lost her phone, changed it, or its app data was wiped (it now reports installation
   Y), **When** she clocks from Y, **Then** she is refused `ATTENDANCE_DEVICE_NOT_ENROLLED` (DL-04). A permitted
   manager unbinds her passkey (row 21, unchanged permissions); she enrols from Y and Y becomes her lock. Until then
   she clocks with the reception card (DL-11). There is no self-service move.

### User Story 4 — Existing bindings and the card (Priority: P2)

1. **DL-10** — **Given** a binding made before this change (no phone recorded), **When** its employee's next clock is
   accepted from X, **Then** X is attached to that binding, unless X already belongs to another person (then refused as
   DL-01).
2. **DL-11** — Clock by card on the paired reception device (spec 032) is unaffected: same results, no installation
   involved, any employee.

### User Story 5 — The manager sees refused attempts (Priority: P2, PL-Q3)

Heba is refused on Sara's phone. The refusal tells her what to do. The attempt is kept so the manager can review
repeated attempts on the attendance board (row 27). Nobody is notified at that moment.

1. **DL-12** — **Given** any refusal of DL-01, DL-04, DL-05, DL-07b (challenge, clock or enrollment step), **Then**
   exactly one `attendance_device_refusals` row is written **after** the refused transaction ended, holding: the
   employee who tried, the holder employee of the phone (only when it is another person's phone), branch (QR branch
   for challenge/clock; the employee's primary branch for enrollment), step, reason, the company-separated
   installation hash and the time. No raw installation id, no phone number, no name, no audit/outbox/event row.
2. **DL-13** — **Given** writing the refusal row fails, **Then** the employee still receives the same refusal
   (the failure is logged without the installation id).
3. **DL-14** — **Given** refused attempts in a business, **When** the board query lists them for a branch and time
   window, **Then** it returns rows newest first with a cursor, never the hash, and only that company's rows.
4. **DL-15** — The refusal message is bilingual and tells the employee what to do:
   - `ATTENDANCE_DEVICE_LOCKED` / `PASSKEY_DEVICE_TAKEN`: «التليفون ده متسجل لموظفة تانية. ابصمي من تليفونك أو بالكارت في
     الريسبشن.» / "This phone is registered to another employee. Clock in from your own phone or with the card at
     reception."
   - `ATTENDANCE_DEVICE_NOT_ENROLLED` / `PASSKEY_OTHER_DEVICE`: «بصمتك متسجلة على تليفون تاني. ابصمي من تليفونك أو بالكارت
     في الريسبشن، ولو غيّرتي تليفونك اطلبي من المدير يفك الربط.» / "Your passkey is registered on another phone. Clock in
     from that phone or with the card at reception. If you changed phones, ask your manager to unbind it."

### Edge Cases

- Private window / blocked storage: a new installation per page load. The two-way lock (PL-Q1) refuses it: it is not
  the enrolled phone.
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
- **FR-004** (PL-Q1): Challenge and clock are refused `ATTENDANCE_DEVICE_NOT_ENROLLED` when the person's lock is a
  different installation.
- **FR-005**: Unbinding a passkey releases its installation in the same transaction (no new column write needed: the
  lock follows the active binding).
- **FR-006** (PL-Q2): Recovery after phone loss / change / data wipe is the existing manager unbind (row 21, UNB-Q1
  holders); no new permission and no self-service move. The refusal message points to the card and the manager.
- **FR-007** (PL-Q3): Every refusal returns the bilingual message of DL-15 and writes one refused-attempt row after
  the refused transaction (DL-12, DL-13). No event, no notification. A read query for the board (row 27) lists them.
- **FR-008** (PL-Q4): One phone per person. All active bindings of one person in a company carry the same installation;
  enrolling from a different one is refused `PASSKEY_OTHER_DEVICE`.
- **FR-009**: The ten-minute advisory pair rule and its unused query are retired; per-clock installation observations
  are still written (UNB-Q4).
- **FR-010**: The card path, the kiosk staff session and the per-clock UV requirement are unchanged.
- **FR-011**: No fingerprinting and no new personal data; the raw installation id never reaches the database, logs,
  audit or events (ADR-0029).

### Key Entities

- **Binding phone lock**: the company-separated hash of the installation on an employee's active binding; set at
  enrollment or first accepted clock, immutable while the binding is active, released by unbind.
- **Refused attempt** (`attendance_device_refusals`, PL-Q3): who tried, whose phone (holder employee, when another
  person), branch, step (`CHALLENGE` / `CLOCK` / `ENROL`), reason (`DEVICE_LOCKED` / `NOT_ENROLLED` / `DEVICE_TAKEN` /
  `OTHER_DEVICE`), installation hash, time. Immutable; kept with attendance history (UNB-Q4 analogue, no cleanup job).

## Slice design *(mandatory — `CLAUDE.md` §1)*

### Business rules

- **BR-001** (owner, UNB-Q2): phone locked to Sara refuses Heba's clock, refusal before Face ID where possible.
- **BR-002**: enrollment is locked the same way (follows from BR-001; otherwise the lock is empty).
- **BR-003**: "another employee" means another person (different linked user).
- **BR-004** (PL-Q2): the lock is released only by unbind (row 21 permissions, UNB-Q1). No self-service move.
- **BR-005**: legacy bindings attach on first accepted clock (technical default; no live tenant yet — research R3).
- **BR-006** (PL-Q1): two-way — the phone accepts only its owner, and the owner clocks only from her phone (or card).
- **BR-007** (PL-Q3): refused attempts are recorded for the board, never pushed.
- **BR-008** (PL-Q4): one phone per person across her employee records in the company.
- **BR-009**: lock decision order — another person's phone first (`DEVICE_LOCKED` / `DEVICE_TAKEN`), then the person's
  own lock elsewhere (`NOT_ENROLLED` / `OTHER_DEVICE`), then accept (attach when the binding has no hash yet).

### Schema changes (expand only)

| Table | Columns added / changed | RLS policy | Indexes | Tenant-qualified FKs |
|---|---|---|---|---|
| `employee_passkeys` | `installation_hash text NULL` (CHECK `^[a-f0-9]{64}$`) | existing FORCE RLS unchanged; add column `UPDATE(installation_hash)` grant to `pospay_app`; trigger: may go NULL → value once, never change or clear | `(company_id, installation_hash) WHERE unbound_at IS NULL AND installation_hash IS NOT NULL` (non-unique: same person, two businesses — BR-003; uniqueness per person enforced under an advisory lock in the transaction) | none new |
| `attendance_device_refusals` (new, PL-Q3) | `company_id`, `id` (UUID v7), `business_id`, `branch_id`, `employee_id`, `holder_employee_id NULL`, `step`, `reason`, `installation_hash` (CHECK hex 64), `attempted_at timestamptz`; CHECKs on step/reason enums | ENABLE + FORCE RLS, tenant policy on `app.company_id`; `pospay_app` SELECT + INSERT only (immutable) | `(company_id, business_id, branch_id, attempted_at, id)`; FK indexes on employee and holder | `(company_id, business_id, employee_id)` → employees; `(company_id, business_id, branch_id)` → branches; holder `(company_id, holder_employee_id)` → employees |

`attendance_device_signals` unchanged. Migration numbers assigned at merge (next free 0103).

### API contract

- `POST /v1/staff/attendance/challenge`: `clockChallengeInput` gains optional `installation_id` (UUID v4). Refusals
  `ATTENDANCE_DEVICE_LOCKED` (403) and `ATTENDANCE_DEVICE_NOT_ENROLLED` (403).
- `POST /v1/staff/attendance/clock`: unchanged body (already requires `installation_id`); Idempotency-Key stays required;
  `installation_id` stays out of the fingerprint. Same refusals, authoritative under lock.
- `POST /v1/staff/passkey/options`: optional body `{installation_id}`; `POST /v1/staff/passkey/verify`:
  `passkeyVerifyInput` gains optional `installation_id`. Refusals `PASSKEY_DEVICE_TAKEN` (409) and
  `PASSKEY_OTHER_DEVICE` (409).
- `GET /v1/businesses/{businessId}/employees/{employeeId}/passkeys`: status gains `phone_locked: boolean` and
  `phone_locked_since` (no hash).
- Remove `sharedInstallationFlag` / `sharedInstallationFlagPage` (no route uses them).
- All errors bilingual (`message_ar` / `message_en`). Guards unchanged (`@Authenticated()` + PERSONAL purpose; manager
  read under `read:passkeys:branch`).

### Permissions

No new permission. Release = existing `unbind:passkeys:branch` (UNB-Q1 holders, PL-Q2). The refused-attempt query
has no route in this slice; row 27 adds the board route under the existing attendance read permission.

### Events

- Existing `EmployeePasskeyBound` payload unchanged (no hash in events).
- No new event (PL-Q3: no instant notification). No new module-map arrow.

### Test plan

- **Domain unit**: lock decision table — no lock/attach, own lock, other person's lock, same person other record,
  legacy binding, own lock elsewhere (two-way), enrollment vs clock reasons, decision order (BR-009).
- **Integration**: DL-01 … DL-11 on real Postgres + synthetic authenticator; concurrency (two enrolments on one
  installation; enrol vs unbind; attach vs enrol); refusal leaves no session/audit/outbox/idempotency/signal row;
  replay from another installation; card regression; refusal row written once per refusal and only after rollback
  (DL-12), refusal still returned when the row write fails (DL-13).
- **RLS negative**: new column cannot be read/updated cross-tenant; update grant only `installation_hash`; trigger
  refuses change/clear; `attendance_device_refusals` cross-tenant read 0 rows / write refused / FK refused / UPDATE and
  DELETE refused for `pospay_app`.
- **Queries**: passkey status result shape with `phone_locked`; refused-attempt list result shape + cursor;
  `EXPLAIN` uses the new partial index for the lock lookup and the branch/time index for the refusal list.
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
- ADR-0039 (Proposed) amends ADR-0029 ("do not block on the signal"); the owner accepts it before merge.
- No live salon data yet (trial row 63 not started), so legacy handling targets staging test data only.
- Board (row 27) drops the pair list from its scope and shows the refused attempts (query delivered here).
