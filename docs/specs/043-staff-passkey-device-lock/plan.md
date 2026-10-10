# Implementation Plan: Passkey phone lock — a phone bound to one person refuses another person's clock

**Branch**: `feat/p1-21b-passkey-device-lock` | **Date**: 2026-10-10 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `docs/specs/043-staff-passkey-device-lock/spec.md` (owner answers PL-Q1 … PL-Q4,
2026-10-10). Design decision: [ADR-0039](../../adr/0039-passkey-installation-lock.md) (Accepted — owner, 2026-10-10; amends ADR-0029).

## Summary

The personal-app installation (the random `installation_id` the POS already sends on every clock, hashed per company
by ADR-0029) becomes a **lock** on the person's active passkey binding. A new nullable, set-once column
`employee_passkeys.installation_hash` holds it, paired with the set-once `installation_locked_at` timestamp. One pure domain function decides every case (accept / attach /
refuse with a reason) from facts the persistence layer reads under lock; the raw id never leaves memory. The lock is
enforced at enrollment (options pre-check + verify), at the clock challenge (advisory, before Face ID) and at the clock
(authoritative, inside the idempotent effect, before the assertion is consumed). Every refusal writes one row to a new
immutable tenant table `attendance_device_refusals` in a **separate** `withTenant` transaction after the refused one
has rolled back; a read query (no route yet) serves the attendance board of row 27. The retired ten-minute pair rule,
its query and contracts are deleted. The POS sends the installation id on challenge / options / verify, asks for
persistent storage, and shows the four bilingual refusal messages; the admin passkey section shows "phone locked".

## Technical Context

**Language/Version**: TypeScript 6 on Node 22 (local) / 24 (CI)

**Primary Dependencies**: NestJS (Fastify), Drizzle + drizzle-kit, Zod 4, Vite React PWA (POS), Next.js (admin),
TanStack Query, Better Auth passkey plugin through `packages/auth` / identity — all existing; **no new library**.

**Storage**: PostgreSQL — `employee_passkeys` gains `installation_hash` and `installation_locked_at` (+ checks, partial index, set-once trigger,
column UPDATE grant); new table `attendance_device_refusals` (FORCE RLS, `SELECT`/`INSERT` only).

**Testing**: Vitest — domain unit (no DB); API integration on the T2 compose Postgres (one cloned DB per spec file,
ADR-0006) with the synthetic authenticator used by specs 024/027; RLS negative + privileges allowlist; query result
shape + `EXPLAIN`; POS and admin component/hook tests.

**Target Platform**: `apps/api` (Linux container), `apps/pos` (browser PWA), `apps/admin` (browser)

**Project Type**: modular-monolith web service + two web apps

**Performance Goals**: challenge / clock / enrollment stay one tenant transaction plus at most one extra short insert
on refusal; lock lookups use the new partial index; well under 200 ms excluding the WebAuthn ceremony.

**Constraints**: raw installation id never in DB / logs / audit / events (ADR-0029); clock idempotency fingerprint
unchanged (no `installation_id`); fixed lock order state → membership → employee → binding `FOR UPDATE` → person → installation
advisory lock; expand-only migrations; old cached POS builds keep working (new request fields optional except on the
clock, where it is already required).

**Scale/Scope**: tens to hundreds of employees per company; one active binding per employee; refusals are rare.

## Constitution Check

| Principle | Check | Result |
|---|---|---|
| I. One vertical slice | one rule (the installation lock) applied to the three existing write paths it guards (enrol, challenge, clock) + its refusal record (a port called from those use cases); board route deferred to row 27 | PASS |
| II. Domain purity & money | the lock decision is a pure function in `staff/domain/passkey-device-lock.ts`; no arithmetic in use cases; no money | PASS |
| III. Tenant isolation by the DB | new table: `company_id`, PK `(company_id, id)`, ENABLE + FORCE RLS, tenant-qualified FKs, negative test; all access through `withTenant()`; hash is company-separated | PASS |
| IV. Boundaries machine-enforced | staff-internal only; no new module arrow; identity access unchanged | PASS |
| V. Test-backed delivery | domain decision table, integration DL-01 … DL-15, concurrency, RLS negative, EXPLAIN, POS/admin tests | PASS |
| VI. Arabic-first RTL | four new error messages ar/en through `errors.ts` + i18n keys; logical CSS; `packages/ui` | PASS |
| VII. Documented why, in Arabic | Arabic JSDoc on the domain function, every new/changed port method; one-liners on use cases, query, schema columns | PASS |
| Security (CLAUDE.md §8) | no new PII; hash only; refusal rows carry ids, not names/phones; log redaction already drops `installation_id`; refusals are rejected attempts kept in their own table, not audited changes | PASS |
| ADR | ADR-0039 Accepted by the owner 2026-10-10 (amends ADR-0029 "do not block on the signal") | PASS |

Post-design re-check: unchanged — PASS.

## Design

### D1. Domain — `apps/api/src/modules/staff/domain/passkey-device-lock.ts` (new)

```ts
type DeviceLockStep = 'CHALLENGE' | 'CLOCK' | 'ENROL';
type DeviceLockFacts = {
  step: DeviceLockStep;
  // another person's active binding (any business of the company) holds this installation
  heldByOther: { holderEmployeeId: string } | null;
  // the person's own lock across her active bindings: none yet, this installation, or a different one
  own: 'NONE' | 'THIS' | 'OTHER';
  // the binding being used (clock/challenge) has no hash yet; always true on ENROL (new binding)
  bindingUnlocked: boolean;
};
type DeviceLockDecision =
  | { kind: 'ACCEPT'; attach: boolean }                       // attach = write the hash on this binding
  | { kind: 'REFUSE'; reason: 'DEVICE_LOCKED' | 'NOT_ENROLLED' | 'DEVICE_TAKEN' | 'OTHER_DEVICE';
      holderEmployeeId: string | null };
```

Order (BR-009): `heldByOther` → REFUSE (`DEVICE_TAKEN` on ENROL, else `DEVICE_LOCKED`, with holder);
`own === 'OTHER'` → REFUSE (`OTHER_DEVICE` on ENROL, else `NOT_ENROLLED`, holder null); otherwise ACCEPT with
`attach = step !== 'CHALLENGE' && bindingUnlocked`. Reasons map to error codes in the use cases:
`DEVICE_LOCKED → ATTENDANCE_DEVICE_LOCKED`, `NOT_ENROLLED → ATTENDANCE_DEVICE_NOT_ENROLLED`,
`DEVICE_TAKEN → PASSKEY_DEVICE_TAKEN`, `OTHER_DEVICE → PASSKEY_OTHER_DEVICE`.

"Person" = the binding's `bound_by` (the user who enrolled it herself through her personal session; immutable),
not `employees.user_id`, which an employee edit can relink (database review round 1). Facts are computed only from
**active** bindings (`unbound_at IS NULL`) in the company: `heldByOther` = an active binding with this hash whose
`bound_by` differs from the caller's user; `own` = the set of non-NULL hashes on the caller's active bindings (same
`bound_by`): empty → NONE, only this hash →
THIS, any other → OTHER.

### D2. Persistence

- **Hash**: reuse `installationHash()` from `persistence/attendance-device-signal.ts` (import it; no copy).
- **Person then installation locks**: the shared `attendanceDeviceLock` takes `pg_advisory_xact_lock` on
  `hashtextextended('pospay:passkey-person:v1:' || company || ':' || user, 0)` before the installation key
  `hashtextextended('pospay:attendance-installation:v1:' || company || ':' || hash, 0)`. Both follow the binding
  `FOR UPDATE` (clock/challenge) or employee lock (enrol). The person lock serializes different installations
  across the same person's business records (PL-Q4). Unbind takes employee → binding only.
- **Facts reader**: one SQL with two `UNION ALL` branches over active `employee_passkeys p` (no join), selecting
  the requested hash and the caller's `bound_by`, ordered by binding id. The hash branch uses the partial index.
- **Attach**: one conditional UPDATE sets `installation_hash=$hash, installation_locked_at=$at` where the active
  binding's hash is NULL. It runs inside the accepted clock's `persist`; `$at` is the injected clock instant.
  Only `UPDATE ... RETURNING id` changing a row appends an `employee_passkey` audit with action `phone_locked`,
  entity id = binding id, after = `{ employee_id, binding_id, phone_locked: true }`, in that same transaction.
  Dedupe / replay / refusal never reach `persist`; rollback removes both the attachment and its audit.
- **Enrol**: the binding insert sets both hash and timestamp (`installation_locked_at = bound_at`), or both NULL
  when the old POS sent no installation id. No hash or raw installation id appears in audit or events.
- **Refusal writer** `persistence/attendance-device-refusals.ts` (new): `record(input)` opens its own
  `withTenant(companyId, …)` and inserts one row, hashing the raw id itself. For ENROL the branch is the employee's
  `primary_branch_id` (`INSERT … SELECT … FROM employees`). The use case calls it after the refused transaction
  rejected; a writer failure is reported through an injected reporter (log without installation id) and swallowed;
  the original refusal is rethrown.

### D3. Use cases (no SQL, no arithmetic)

- `request-clock-challenge`: input gains optional `installation_id`. When present, inside `transactions.run`, after
  the QR verify and before `attendanceOptions` (no ceremony issued): `tx.deviceLock(installationId)` → decision →
  REFUSE throws a refusal carrying `{reason, holderEmployeeId}`. Outside `run`: catch it, `refusals.record(…)`,
  rethrow as the mapped `AttendanceError`.
- `clock-attendance`: inside the `tx.idempotent(…)` effect, after the challenge row resolves and the QR verifies,
  **before** `verifyAttendance` consumes the assertion and **before** `attendanceDuplicate`: facts → decision.
  REFUSE → throw (rolls back the whole transaction, including the idempotency claim); then record outside, as above.
  ACCEPT → `apply` passes `attachInstallation: attach` to `tx.persist`.
- `enrol-passkey`: `execute(scope, challengeId, response, installationId?)`. Inside `transactions.run` after the
  employee lock: with an id → facts (step ENROL) → decision; REFUSE → throw, record outside; ACCEPT → insert with the
  hash. Without it (old POS) → insert with NULL (legacy; attached on first clock). The global credential created
  before a refusal stays inert (spec 024 KEY-05).
- **Enrollment options pre-check**: new method `EnrolPasskey.checkInstallation(scope, installationId)` (read-only
  tenant transaction: facts → decision; REFUSE → record + throw). `passkeys.controller.ts` `options` calls it when the
  optional body carries `installation_id`, before `enrollmentOptions` — so a refused employee never starts a ceremony
  and never creates an orphan credential.
- Errors: `AttendanceError` gains the two attendance codes; `PasskeyBindingError` gains the two enrollment codes;
  follow the existing mapping in `http/clock-attendance.controller.ts` / `http/passkeys.controller.ts`.

### D4. Ports (Arabic JSDoc on every new method)

- `ports/clock-attendance.port.ts`: `AttendanceTransaction.deviceLock(installationId)` returning the facts (without
  `step`); `AttendanceWrite.attachInstallation: boolean`.
- `ports/passkeys.port.ts`: binding tx gains `deviceLock(installationId)`; insert record gains
  `installationId: string | null`; a read-only device-lock reader for the options pre-check.
- New `ports/attendance-device-refusals.port.ts`: `AttendanceDeviceRefusals.record({ companyId, businessId,
  employeeId, holderEmployeeId, branchId (null → primary branch), step, reason, installationId, at })`.

### D5. HTTP / contracts

- `packages/contracts/src/staff/clock-attendance.ts`: `clockChallengeInput` gains optional `installation_id`;
  `clockAttendanceInput` keeps it **required** (override in `extend`). The challenge `scan_digest` and the clock
  idempotency fingerprint stay without it.
- `packages/contracts/src/staff/passkeys.ts`: `passkeyVerifyInput` gains optional `installation_id`; new
  `passkeyOptionsInput = z.strictObject({ installation_id: … .optional() })` (missing / empty body = `{}`).
  Manager passkey status gains `phone_locked: boolean` and `phone_locked_since: timestamp | null` (`bound_at` when the
  hash was written at enrollment; the accepted clock instant for a legacy attachment; NULL while unlocked).
  The timestamp comes from `installation_locked_at`, in the existing UTC ISO format. Never the hash.
- `packages/contracts/src/staff/unbind-passkey.ts`: delete `sharedInstallationFlag`, `sharedInstallationFlagPage`
  (and their index exports). Keep `attendanceInstallationSignal`.
- New contract file for the refusal row + page (`id`, `employee_id`, `holder_employee_id`, `branch_id`, `step`,
  `reason`, `attempted_at`), no hash.
- `apps/api/src/shared/errors.ts`: `ATTENDANCE_DEVICE_LOCKED: 403`, `ATTENDANCE_DEVICE_NOT_ENROLLED: 403`,
  `PASSKEY_DEVICE_TAKEN: 409`, `PASSKEY_OTHER_DEVICE: 409`, with the DL-15 messages. Regenerate OpenAPI and the
  admin/pos `schema.d.ts`.

### D6. Queries

- `queries/employee-passkeys.query.ts`: project `phone_locked` from `installation_hash IS NOT NULL` and
  `phone_locked_since` from `installation_locked_at`; no audit JSON lookup. Result-shape coverage includes legacy
  attachment time, and `EXPLAIN ANALYZE` asserts the active-employee index without an audit scan.
- `queries/attendance-device-refusals.query.ts` (new, no route; row 27 consumes it): list by business, branch and
  window, newest first, keyset cursor `(attempted_at, id)`, limit ≤ 100, projects straight to the contract shape.
  Result-shape test + `EXPLAIN` on the branch/time index.
- Delete `queries/shared-installations.query.ts`, `domain/shared-installation.ts` and their tests; trim
  `__tests__/attendance-device-signals.spec.ts` / `__tests__/shared-installation-flow.spec.ts` to keep the observation
  assertions only.

### D7. Database (`packages/db`)

- `schema/staff-passkeys.ts`: `installationHash`, nullable `installationLockedAt` (`timestamptz`), hash check
  `~ '^[a-f0-9]{64}$'`, pair check `(installation_hash IS NULL) = (installation_locked_at IS NULL)`, and partial index
  `employee_passkeys_active_installation_idx (company_id, installation_hash) WHERE unbound_at IS NULL AND
  installation_hash IS NOT NULL` (non-unique: one person, two businesses).
- New `schema/staff-device-refusals.ts` (see [data-model.md](data-model.md)); export from `schema/index.ts`.
- Migrations dated 2026-10-10: **0103** creates the refusal table and adds the binding columns; both new CHECKs on
  existing `employee_passkeys` are `NOT VALID`. **0104** validates those CHECKs, mirroring 0101/0102. **0105** starts
  with the recoverable `CREATE INDEX CONCURRENTLY` prefix (ADR-0033), followed by ENABLE + FORCE RLS, tenant policies,
  `GRANT SELECT, INSERT` on the new table, and `GRANT UPDATE (installation_hash, installation_locked_at)` on bindings
  for `pospay_app`. Its set-once trigger refuses changing or clearing either non-NULL lock column. Snapshots follow
  these stages and journal timestamps strictly increase. No destructive schema change.
- `src/__tests__/privileges.spec.ts`: add the new grants (minimal, additive). Drift check prints "No schema changes".

### D8. POS (`apps/pos/src/personal-staff/`)

- `model/installation-id.ts`: call `navigator.storage?.persist?.()` once (ignore failures).
- `api/attendance-calls.ts`: send `installation_id` on the challenge too. `api/personal-calls.ts` /
  `use-enrol-passkey.ts`: send it on options and verify.
- `ui/clock-attendance-screen.tsx`, `ui/enrol-passkey-screen.tsx`: map the four codes to their respective i18n messages; no
  retry for these codes. i18n keys additive in `packages/i18n/src/{ar,en}.ts`.

### D9. Admin (`apps/admin/src/staff/ui/employee-passkey-section.tsx`, `unbind-passkey-form.tsx`)

Show "phone locked" (+ since date when known) on the active binding; the unbind form says unbinding also frees the
phone. i18n additive.

### D10. Docs

ADR-0039 (Accepted 2026-10-10) + "Amended by" line in ADR-0029 (spec commit). Short notes in specs 026/027 pointing to 043.
Phase-1 plan row 27: the pair list is replaced by the refused-attempt list.

## Project Structure

### Documentation (this feature)

```text
docs/specs/043-staff-passkey-device-lock/
├── spec.md  owner-questions.ar.md  research.md  plan.md  data-model.md  quickstart.md
├── contracts/passkey-device-lock-api.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
apps/api/src/modules/staff/
├── domain/passkey-device-lock.ts (+ domain/__tests__/passkey-device-lock.spec.ts)  new
├── domain/shared-installation.ts (+ test)                                          deleted
├── ports/attendance-device-refusals.port.ts                                        new
├── ports/clock-attendance.port.ts, ports/passkeys.port.ts                          changed
├── use-cases/request-clock-challenge/, clock-attendance/, enrol-passkey/           changed
├── persistence/attendance-device-refusals.ts                                       new
├── persistence/attendance-context.adapter.ts, attendance-transactions.ts,
│   attendance-writes.ts, passkey-transactions.ts                                   changed
├── queries/attendance-device-refusals.query.ts                                     new
├── queries/employee-passkeys.query.ts                                              changed
├── queries/shared-installations.query.ts                                           deleted
├── http/clock-attendance.controller.ts, http/passkeys.controller.ts                changed
├── staff.module.ts                                                                 wiring
└── __tests__/ integration + RLS specs                                              new / trimmed
apps/api/src/shared/errors.ts                                                       4 codes
packages/contracts/src/staff/{clock-attendance,passkeys,unbind-passkey}.ts + new refusal contract, index.ts
packages/db/schema/{staff-passkeys,staff-device-refusals,index}.ts, migrations + journal/meta, privileges.spec.ts
packages/i18n/src/{ar,en}.ts
apps/pos/src/personal-staff/{model,api,ui}/…, generated schema.d.ts
apps/admin/src/staff/ui/…, generated schema.d.ts
```

**Structure Decision**: everything lives in the existing `staff` module shape (CLAUDE.md §2.2); no new top-level
folder, no new module, no new arrow.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Refusal row written in a second transaction | PL-Q3 requires a record; the refused transaction must roll back fully (no session / audit / outbox / idempotency row) | Writing inside the refused transaction is rolled back; committing it would keep the idempotency claim and partial state |
| Three write paths touched in one PR | the lock is meaningless unless enrollment, challenge and clock all enforce it (spec US2) | splitting would ship a lock that is bypassed by enrolling on someone else's phone |
