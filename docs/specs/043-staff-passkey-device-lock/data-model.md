# Data model — 043 passkey phone lock

## `employee_passkeys` (existing, expanded)

| Column | Type | Rule |
|---|---|---|
| `installation_hash` | `text NULL` | CHECK `installation_hash ~ '^[a-f0-9]{64}$'`. ADR-0029 hash `sha256(JSON(['pospay.attendance.installation.v1', company, installation]))`. Written at enrollment, or attached at the first accepted clock of a binding that has none. Set once: a trigger refuses any UPDATE that changes or clears a non-NULL value. Kept after unbind (history); the lock reads active rows only. |

- Index `employee_passkeys_active_installation_idx` on `(company_id, installation_hash)` `WHERE unbound_at IS NULL AND
  installation_hash IS NOT NULL` — non-unique (one person may hold two active bindings, one per business, both on the
  same phone). Created `CONCURRENTLY` (ADR-0033).
- Grants: `pospay_app` gains `UPDATE (installation_hash)`; the existing SELECT / INSERT / UPDATE
  `(unbound_at, unbound_by, revision)` stay.
- Invariant (enforced in the transaction under the installation advisory lock, not by a constraint): within a company,
  the active bindings holding one hash all belong to one person (`employees.user_id`), and one person's active
  bindings carry at most one distinct non-NULL hash.

## `attendance_device_refusals` (new, tenant table)

| Column | Type | Rule |
|---|---|---|
| `company_id` | `uuid NOT NULL` | FK `companies(id)`; RLS key |
| `id` | `uuid NOT NULL` | UUID v7 from the injected `IdGenerator`; PK `(company_id, id)` |
| `business_id` | `uuid NOT NULL` | business of the employee who tried |
| `branch_id` | `uuid NOT NULL` | QR branch (challenge / clock) or the employee's primary branch (enrol) |
| `employee_id` | `uuid NOT NULL` | the employee who tried |
| `holder_employee_id` | `uuid NULL` | the employee whose active binding holds the phone; only for `DEVICE_LOCKED` / `DEVICE_TAKEN` |
| `step` | `text NOT NULL` | CHECK in (`CHALLENGE`, `CLOCK`, `ENROL`) |
| `reason` | `text NOT NULL` | CHECK in (`DEVICE_LOCKED`, `NOT_ENROLLED`, `DEVICE_TAKEN`, `OTHER_DEVICE`) |
| `installation_hash` | `text NOT NULL` | CHECK hex 64; never returned by any query |
| `attempted_at` | `timestamptz NOT NULL` | the request's injected clock instant |

- CHECK: `holder_employee_id IS NOT NULL` exactly when `reason IN ('DEVICE_LOCKED','DEVICE_TAKEN')`.
- FKs (tenant-qualified): `(company_id, business_id, employee_id)` → `employees(company_id, business_id, id)`;
  `(company_id, business_id, branch_id)` → `branches(company_id, business_id, id)`;
  `(company_id, holder_employee_id)` → `employees(company_id, id)`.
- Indexes: `attendance_device_refusals_branch_time_idx (company_id, business_id, branch_id, attempted_at, id)` (board
  list); `attendance_device_refusals_employee_idx (company_id, business_id, employee_id)` (FK);
  `attendance_device_refusals_holder_idx (company_id, holder_employee_id) WHERE holder_employee_id IS NOT NULL` (FK).
- RLS: ENABLE + FORCE; policy `company_id = current_setting('app.company_id')::uuid` (same helper as the other staff
  tables). Grants: `pospay_app` `SELECT, INSERT` only — rows are immutable; no UPDATE / DELETE.
- Retention: kept with attendance history, no cleanup job (UNB-Q4 analogue).
- Never written inside the refused transaction; one row per refusal, in its own `withTenant` transaction.

## Domain facts → decision (no storage)

See plan D1. Facts: `step`, `heldByOther`, `own` (`NONE` / `THIS` / `OTHER`), `bindingUnlocked`. Decision: ACCEPT
(`attach`) or REFUSE (`reason`, `holderEmployeeId`).

## Retired

- `domain/shared-installation.ts` (ten-minute pair rule), `queries/shared-installations.query.ts`,
  contracts `sharedInstallationFlag`, `sharedInstallationFlagPage`. `attendance_device_signals` is unchanged and still
  written once per accepted clock.
