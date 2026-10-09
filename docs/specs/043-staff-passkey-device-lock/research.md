# Research — 043 passkey phone lock (plan row 21b)

Owner decision (binding, 2026-10-09, UNB-Q2 in `docs/specs/phase-1/owner-review-2026-10-09.ar.md`): **block**. A phone
bound to an employee's personal passkey does not accept an attendance clock-in for another employee. The card on the
reception device is not part of the block. This replaces the warn-only ten-minute flag (spec 026 UNB-Q2, ADR-0029).

## R1. What exists today

| Piece | Where | What it does |
|---|---|---|
| Installation id (client) | `apps/pos/src/personal-staff/model/installation-id.ts:8-20` | random UUID v4 in `localStorage` key `pospay.attendance.installation`; kept across logout/operator replacement; **blocked storage (private mode) gives a new id per page load** (`:17-19`) |
| Sent on clock only | `apps/pos/src/personal-staff/api/attendance-calls.ts:26` | `installation_id` goes in the clock body, not the challenge body |
| Contracts | `packages/contracts/src/staff/clock-attendance.ts:17-22` (challenge, strict, no installation), `:24-42` (clock, requires `installation_id`); `packages/contracts/src/staff/unbind-passkey.ts:58-61` (`attendanceInstallationSignal`), `:63-87` (`sharedInstallationFlag*`) |
| Enrollment contract | `packages/contracts/src/staff/passkeys.ts:46-51` (`passkeyVerifyInput` = `challenge_id` + `response`, strict); options route has no body (`apps/pos/src/personal-staff/api/personal-calls.ts:31`) |
| Idempotency | `apps/api/src/modules/staff/http/clock-attendance.controller.ts:53` omits `installation_id` from the clock fingerprint (ADR-0029 "Delivered clock wiring") |
| Hash | `apps/api/src/modules/staff/persistence/attendance-device-signal.ts:58-68` SHA-256 of `['pospay.attendance.installation.v1', company, installation]` |
| Per-clock observation | `persistence/attendance-device-signal.ts:38-56`, called from `persistence/attendance-writes.ts:107-116`; table `packages/db/schema/staff-device-signals.ts` (migrations 0065/0066) |
| Ten-minute pair rule | `apps/api/src/modules/staff/domain/shared-installation.ts:1-31` (advisory, "never refuses") |
| Pair query | `apps/api/src/modules/staff/queries/shared-installations.query.ts:17-69` — **no HTTP route or screen consumes it yet** (board is row 27); only tests use it |
| Binding | `packages/db/schema/staff-passkeys.ts:18-61`: one active binding per employee (`employee_passkeys_active_employee_key`), no device column. Grants `migrations/0061…:23-25`: app SELECT/INSERT, UPDATE only `(unbound_at,unbound_by,revision)` |
| Enrollment | `use-cases/enrol-passkey/enrol-passkey.ts:21-31`, `persistence/passkey-transactions.ts:56-99` (employee lock, insert, audit `bound`, `EmployeePasskeyBound`) |
| Clock context lock | `persistence/attendance-context.adapter.ts:55-61` locks the active binding `FOR UPDATE` |
| Challenge | `use-cases/request-clock-challenge/request-clock-challenge.ts:20-50` |
| Clock | `use-cases/clock-attendance/clock-attendance.ts:31-105` (proof → dedupe → transition → persist) |
| Unbind | `persistence/unbind-passkey-transactions.ts:72` (sets `unbound_at`, bumps revision) |
| Card clock | spec 032, `use-cases/clock-by-card/**` — device + operator, no installation id, no passkey |

## R2. How "the phone" can be identified — what a browser can prove

- **Decision**: the phone is the **personal-app installation**: the existing random `installation_id`, hashed per
  company. No new identifier, no fingerprinting.
- **Why not the passkey credential**: synced passkeys are allowed (spec 024 "Synced credentials are permitted");
  a credential follows the employee's iCloud/Google account to all her devices, and the server cannot tell on which
  device an assertion was made. WebAuthn attestation is batch-level by design (AAGUID = model/provider, never a unique
  device); enterprise attestation needs managed devices. `authenticatorAttachment` only says platform vs roaming.
- **Why not fingerprinting**: banned by ADR-0029 and privacy; unstable anyway.
- **Why not a non-extractable WebCrypto key**: it proves "same browser storage" exactly like the UUID does, and is
  wiped by the same actions. It defends against *copying* an id between phones, which is not this attack (the attack
  makes one phone look like two, not two like one). Not worth a new ceremony now; can be revisited.
- **What this cannot prove (must be said to the owner)**: two browsers, two browser profiles, or the iOS home-screen
  app vs Safari on one phone each have their own storage, so they look like **two phones**. Clearing site data or a
  private window gives a new id. The lock therefore raises the bar (OTP of the other employee + enrolling her passkey
  in a second browser on the same phone), it is not a physical guarantee. This is why PL-Q1 recommends the two-way lock:
  with a one-way lock a private window is a 10-second bypass.
- **Storage loss risk**: Safari may delete script-written storage of a site not used for 7 days of browser use
  (ITP); an employee back from leave can find her phone "new". Home-screen web apps are exempt. Mitigation: request
  `navigator.storage.persist()`, and recommend adding the POS to the home screen. Recovery is PL-Q2.

## R3. Rule shape

- Enrollment records the installation hash on the new binding. It is refused when that installation already
  belongs to an active binding of **another person** in the company.
- Challenge and clock: refused when the installation belongs to another person's active binding, and — if PL-Q1 is
  the two-way option — when the employee's own binding is locked to a different installation.
- "Another person" = a different linked user (`employees.user_id`), not a different employee row: one person may be an
  employee in two businesses of the same company (`employees_active_user_business_key`, `packages/db/schema/staff.ts:102`)
  and must not be locked out of her own phone. Owner wording «موظفة تانية» = another person.
- Unbind (row 21) releases the phone together with the passkey. No separate "release phone" action.
- Bindings made before this change have no installation: the first accepted clock after deploy attaches it
  (unless another person holds it). **No owner question**: the salon trial (row 63) has not started, so only staging
  test data exists.
- Scope is per company (the hash is company-separated): a phone may be locked in company 1 and company 2 to different
  people; companies never learn about each other.
- The lock does not stop personal sign-in, own schedule or own leave on another phone; only enrollment and clocking.

## R4. The old ten-minute flag

- **Decision**: retire the pair rule and query (`domain/shared-installation.ts`, `queries/shared-installations.query.ts`,
  `sharedInstallationFlag*` contracts), which have no consumer. Keep writing `attendance_device_signals` per accepted
  clock (UNB-Q4 retention; useful history; no schema change). Card clocks never had a signal, so "keep it for
  non-passkey paths" is impossible — not asked.
- Row 27 (board) loses the pair list from its scope; it gains the refused-attempt list if PL-Q3 keeps it.

## R5. Where the check runs

- Challenge: `installation_id` becomes an **optional** body field (expand: an old cached POS build keeps working and is
  checked at the clock). The POS always sends it, so a refused employee learns before the camera/Face ID step.
- Clock: authoritative check under the existing lock order (state → membership → employee → binding `FOR UPDATE`),
  before the assertion is consumed, before dedupe. A per-installation transaction advisory lock
  `pospay:attendance-installation:v1:{company}:{hash}` serializes two people attaching/enrolling the same installation;
  taken after the binding lock (fixed order, no deadlock with unbind which takes employee → binding).
- Enrollment: options and verify accept optional `installation_id`; the check at options avoids an orphan credential;
  verify re-checks under the employee lock + installation lock and writes the hash.
- Idempotency: the clock fingerprint keeps omitting `installation_id`. A replay of a stored *accepted* response from
  another installation returns that response and creates no effect — acceptable. Refusals roll back the claim, so
  they are never replayed.
- The decision rule is a pure domain function (facts in → ACCEPT / ATTACH / REFUSE reason out); hashing stays in
  persistence, the raw id never leaves memory (ADR-0029).

## R6. What could break

| Area | Effect | Handling |
|---|---|---|
| Stored attendance rows / open shifts | none changed. An employee who loses her phone mid-shift cannot clock out from another phone (two-way) | card at reception (unaffected) or the 16 h missed-out job; manager unbind |
| Legacy bindings | no installation yet | first accepted clock attaches |
| Two employees already sharing one phone | the first to clock after deploy takes it; the other is refused until a manager unbinds | staging only (R3) |
| iOS: enrolled in Safari, later uses home-screen app | different storage → "different phone" → refused (two-way) | onboarding copy: enrol from the app you will use; recovery PL-Q2 |
| Offline POS | attendance is online-only (spec 027 AT-07) | no change |
| Reports, hours, commission | refused clocks write no session | no change |
| ADR-0029 "never block on the signal" | contradicted | **new ADR** amending ADR-0029 (number at merge) |
| Old POS PWA cache | challenge field optional; verify field optional | expand-safe |
| Card path, kiosk staff session | untouched | regression test |

## R7. Files expected to change at implementation

API (`apps/api/src/modules/staff/`): `domain/passkey-device-lock.ts` (new) + test; `domain/shared-installation.ts` and
its test (delete); `queries/shared-installations.query.ts` (delete) and `__tests__/attendance-device-signals.spec.ts`,
`__tests__/shared-installation-flow.spec.ts` (trim); `ports/clock-attendance.port.ts`, `ports/passkeys.port.ts`;
`use-cases/request-clock-challenge/*`, `use-cases/clock-attendance/*`, `use-cases/enrol-passkey/*`;
`persistence/attendance-context.adapter.ts`, `persistence/attendance-device-signal.ts`,
`persistence/passkey-transactions.ts`, `persistence/attendance-writes.ts`; `http/clock-attendance.controller.ts`,
`http/passkeys.controller.ts`; `queries/employee-passkeys.query.ts` (show "phone locked"); `apps/api/src/shared/errors.ts`.
If PL-Q3 keeps a record: a refused-attempt writer outside the rolled-back transaction.
DB: `packages/db/schema/staff-passkeys.ts`, new migration(s) (`installation_hash` column + partial index + grant +
immutability trigger; numbers at merge, next free is 0103). Possibly a refused-attempts table (PL-Q3).
Contracts: `packages/contracts/src/staff/clock-attendance.ts`, `passkeys.ts`, `unbind-passkey.ts`, OpenAPI.
POS: `apps/pos/src/personal-staff/api/personal-calls.ts`, `attendance-calls.ts`, `use-enrol-passkey.ts`,
`model/installation-id.ts` (`storage.persist()`), `ui/clock-attendance-screen.tsx`, `ui/enrol-passkey-screen.tsx`,
generated schema. Admin: `apps/admin/src/staff/ui/employee-passkey-section.tsx`, `unbind-passkey-form.tsx`, generated
schema. i18n: `packages/i18n/src/ar.ts`, `en.ts`. Docs: new ADR, `docs/specs/026…`/`027…` notes, plan row 27 scope.

**Overlap with 16b / 16c (schedules)**: none expected in source files — they touch schedule/shift-template code.
Shared registries only: `packages/i18n/src/{ar,en}.ts`, `apps/api/src/shared/errors.ts`, contracts index/OpenAPI,
generated `schema.d.ts` in admin/pos, migration numbering and `meta/_journal.json`. Reconcile at merge.
