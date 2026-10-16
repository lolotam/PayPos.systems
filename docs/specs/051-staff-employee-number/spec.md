# Feature Specification: Employee number on every employee

**Feature Branch**: `feat/p1-8c-*` (one branch per sub-PR, see §1)

**Created**: 2026-10-17

**Status**: Draft — owner answers EN-Q1 … EN-Q9 are final (batches 14 and 17, Waleed 2026-10-12/13; Abu Salem's pick
on EN-Q1…Q4 is the same as Waleed's). Four points are still open and sit in
[owner-questions.ar.md](owner-questions.ar.md) as `PENDING` (EN-Q10 … EN-Q13). They block only the sub-PRs marked
"blocked" in §1; 8c-1 and 8c-5 can start now.

**Input**: User description: "staff-employee-number — every employee gets a number that appears in the profile, the
staff list, the attendance board, the monthly report, the CSV and the official statement (Abu Salem's AB-Q10 pick,
approved by Waleed 2026-10-12)."

**Phase 1 row**: 8c, builds on row 8 (spec `docs/specs/013-staff-create-employee/spec.md`), row 9 (`update-employee`),
row 27a/27b (spec `docs/specs/049-staff-attendance-board-report/spec.md`, AB-Q9e / AB-Q10) and row 35c (the reception
performer picker, ADR-0041). **Consumed by** row 27g (the official attendance statement, which prints the number) —
27g, 27h and 27i have their own specs; nothing of them is built here.

## Owner decisions already taken (binding — not asked again)

| ID    | Question                                         | Decision                                                                                                                                                                             |
| ----- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| EN-Q1 | How the number is made                           | The system gives it by itself, in order, **per company** (1, 2, 3 …). Existing employees get numbers by **hire date**. The owner can change a number by hand, if it is not repeated. |
| EN-Q2 | Shape                                            | **Digits only.**                                                                                                                                                                     |
| EN-Q3 | Where it shows                                   | Employee profile, staff list, attendance board, monthly report, CSV, official statement.                                                                                             |
| EN-Q4 | A deleted employee's number                      | **Never reused.** It stays hers in old reports; a new employee gets a new number.                                                                                                    |
| EN-Q5 | Where numbering starts                           | The owner picks the starting number **once** (for example 1000); if she does not, it starts from **1**.                                                                              |
| EN-Q6 | After the owner types 1050 for one employee      | The counter **keeps counting from where it is** and is not moved by a hand-typed number; it **skips any number already used** (EN-Q1: never a repeat).                              |
| EN-Q7 | Existing employees: ties, and the deleted        | Same hire date → the one **added to the system first** gets the smaller number. **Deleted employees get numbers too**, so old reports stay consistent.                              |
| EN-Q8 | Format                                           | A whole number from **1 to 999999**, no leading zeros («007» is saved as «7»).                                                                                                       |
| EN-Q9 | Typing it when adding, and searching             | Both: the owner **types it or leaves it blank** (the system gives one); search by number in the **staff list** and in the **reception performer picker**.                            |

## Open owner questions (batch pending — see `owner-questions.ar.md`)

| ID     | Question                                                                          | Recommended (⭐)                                                                                  | Blocks               |
| ------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------- |
| EN-Q10 | What the one-time starting number does to employees that already have numbers    | Existing numbers stay; the start only moves the counter forward for **new** employees (rule BR-6) | 8c-8                 |
| EN-Q11 | Who may type or change a number, and who sets the starting number                | New permission `manage:employee-number:company`, owner by default, grantable by the owner         | 8c-6, 8c-7, 8c-8     |
| EN-Q12 | Does the Excel import template get an optional employee-number column            | No — imported employees get numbers automatically in file order (BR-8)                           | 8c-3                 |
| EN-Q13 | Confirm the derived rules D-1, D-2, D-3, D-5, D-7, D-8 (§ Derived rules)          | Confirmed as written                                                                              | 8c-2, 8c-4 (D-7, D-3), 8c-6, 8c-8 (D-1, D-8), 8c-9 (D-2) |

Until Waleed and Abu Salem answer, the rules below that depend on these four are marked **`TODO(spec)`** and written
at the recommended option only so the design is complete; **no code that depends on a `TODO(spec)` rule starts**. The derived rules D-1, D-2, D-3, D-5, D-7 and D-8 are
also `TODO(spec)` until EN-Q13 is answered (a one-word confirmation).

## User Scenarios & Testing _(mandatory)_

Example: a salon in the company **Glow** with two branches. Sara (hired 2025-01-05), Heba (hired 2025-03-01) and Reem
(hired 2026-10-01) exist when this feature ships. One more employee, Noor, is added afterwards.

### User Story 1 — Existing employees are numbered once, by hire date (Priority: P1)

**Why this priority**: every other surface reads the number; a missing number breaks them.

**Independent Test**: run the migration on a database that holds Sara, Heba, Reem (and one deleted employee) and read
the numbers back.

**Acceptance Scenarios**:

1. **Given** Sara, Heba and Reem, **When** the migration runs, **Then** Sara = 1, Heba = 2, Reem = 3 (EN-Q1) and the
   company counter says the next number is 4.
2. **Given** two employees with the same hire date, **When** the migration runs, **Then** the one created first gets
   the smaller number (EN-Q7).
3. **Given** a soft-deleted employee hired between Sara and Heba, **When** the migration runs, **Then** she is
   numbered too, in her hire-date place (EN-Q7), and her number is never given to anyone else (EN-Q4).
4. **Given** two companies, **When** the migration runs, **Then** each company is numbered from 1 on its own.
5. **Given** the migration already ran, **When** it runs again, **Then** nothing changes (idempotent).

---

### User Story 2 — A new employee gets the next number by itself (Priority: P1)

**Independent Test**: create Noor with no number; create Lana right after; check both and the counter.

**Acceptance Scenarios**:

1. **Given** the counter is at 4, **When** the owner adds Noor without a number, **Then** Noor gets 4 and the counter
   moves to 5 (EN-Q1).
2. **Given** two managers adding employees at the same moment, **When** both finish, **Then** the numbers are
   different and in sequence, never repeated, with no gap.
3. **Given** the creation fails (for example the branch is wrong), **When** the request is refused, **Then** the
   counter has not moved (same transaction).
4. **Given** a back-dated hire date, **When** the employee is added, **Then** her number follows the counter, not her
   hire date (hire date orders only the one-time migration, D-7).
5. **Given** an employee added by the Excel import, **When** the import commits, **Then** each imported employee gets
   the next number in file-row order (BR-8, `TODO(spec)` EN-Q12).

---

### User Story 3 — The owner types or changes a number (Priority: P1)

**Independent Test**: type 1050 for Noor; add Lana; check Lana's number and that 1050 is protected.

**Acceptance Scenarios** (all `TODO(spec)` until EN-Q11 is answered):

1. **Given** the owner, **When** she adds Mona and types 1050, **Then** Mona gets 1050 and the counter does not move
   (EN-Q6, EN-Q9).
2. **Given** the owner, **When** she changes Noor's number to 1050 and 1050 is already used (even by a deleted
   employee), **Then** it is refused with `EMPLOYEE_NUMBER_TAKEN` and nothing changes (EN-Q1, EN-Q4).
3. **Given** the counter is at 1002 and 1050 is used, **When** employees are added until the counter reaches 1050,
   **Then** the one after 1049 gets 1051 (EN-Q6: skips a used number).
4. **Given** Noor's old number 4 was freed by editing her to 1050 and the counter is already at 5, **When** a new
   employee is added, **Then** she does not get 4 — the counter passed it. The owner can still type 4 by hand. A freed
   number at or above the counter (the owner typed 100 while the counter was 4, then changed it to 101) is simply an
   unused number again and the counter reaches it normally; the system keeps no list of retired numbers.
5. **Given** the owner types «007», **When** saved, **Then** the stored number is 7 (EN-Q8).
6. **Given** 0, 1000000, a negative number, a fraction or letters, **When** saved, **Then** `VALIDATION_FAILED` and
   nothing changes.
7. **Given** a person without the permission, **When** she types a number or edits one, **Then** `FORBIDDEN`; adding
   an employee without typing a number still works for her (the number is automatic).
8. **Given** the same number as the one stored, **When** saved, **Then** nothing is written and no audit row.
9. **Given** a deleted employee, **When** anyone tries to change her number, **Then** `NOT_FOUND` (D-5).

---

### User Story 4 — The owner sets the starting number once (Priority: P2)

**Independent Test**: set 1000 on a company with employees 1–3 and add a new employee.

**Acceptance Scenarios** (all `TODO(spec)` until EN-Q10 and EN-Q11 are answered; written at the recommended option):

1. **Given** Sara 1, Heba 2, Reem 3 and the counter at 4, **When** the owner sets the start to 1000, **Then** they keep
   1, 2, 3 and the next new employee gets 1000 (BR-6).
2. **Given** no employees at all, **When** the owner sets 1000, **Then** the first employee gets 1000.
3. **Given** a start was already set, **When** the owner sets it again, **Then** `EMPLOYEE_NUMBER_START_ALREADY_SET`
   (EN-Q5: once).
4. **Given** the counter is at 4, **When** the owner sets the start to 2, **Then** the counter stays at 4 (the start
   can only move the counter forward) and the start is recorded as set.
5. **Given** the owner never sets a start, **When** employees are added, **Then** numbering simply starts from 1.

---

### User Story 5 — The number shows everywhere and can be searched (Priority: P1)

**Independent Test**: after Stories 1–2, open each surface and search.

**Acceptance Scenarios** (EN-Q3, EN-Q9):

1. **Given** Sara = 1, **When** her profile, the staff list, the attendance board (in-now and sessions), the monthly
   report (single branch and all branches) and the CSV are read, **Then** each carries `1` next to her name.
2. **Given** the staff list, **When** it is filtered by number 2, **Then** only Heba is returned; a number nobody has
   returns an empty page, not an error.
3. **Given** the reception performer picker, **When** the receptionist types `2`, **Then** Heba appears (a digit-only
   text also matches the number exactly, besides the name search that exists today); the picker rows show the number.
4. **Given** the CSV, **When** downloaded, **Then** the first column is the employee number and still no phone, salary
   or IBAN (AB-Q9e).
5. **Given** a caller who cannot read a surface today, **When** the number is added, **Then** she still cannot read it —
   no surface becomes more open.

### Edge Cases

- A company with no employees has no counter row; the first insert creates it (counter = 1, or the start if set).
- A rolled-back or older image creates an employee without a number (expand phase): the row keeps `NULL` until the
  contract PR (8c-11) numbers stragglers; every reader shows «—» for `NULL` and never fails (TD-10).
- The number reaches 999999: the next automatic assignment is refused with `EMPLOYEE_NUMBER_EXHAUSTED` (TD-9); a
  hand-typed number is never affected.
- The same number typed in two companies is fine; uniqueness is per company, across all its businesses.
- An employee moved to another business or branch keeps her number (it belongs to the company, not the business).
- A printed statement or an exported CSV keeps the number it had when it was made; changing a number later does not
  rewrite old files.
- Two simultaneous hand edits to the same number: the second gets `EMPLOYEE_NUMBER_TAKEN` (serialized on the counter
  row; the unique index is the backstop).
- Passkey, card and QR clocking do not read or show the number (out of scope).

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Every employee MUST have an employee number, a whole number from 1 to 999999, unique inside the company
  across all its businesses and **including deleted employees** (EN-Q1, EN-Q4, EN-Q8).
- **FR-002**: A new employee created without a number MUST receive the first unused number at or above the company
  counter, and the counter MUST then move to that number plus one, in the same transaction as the insert (EN-Q1,
  EN-Q6).
- **FR-003**: A hand-typed or hand-edited number MUST NOT move the counter; assignment MUST skip every used number
  (EN-Q6).
- **FR-004**: The migration MUST number all existing employees, deleted included, per company, ordered by hire date,
  then creation time, then id (EN-Q1, EN-Q7), and set each company's counter to the highest number plus one. It MUST
  be idempotent.
- **FR-005**: A number MUST NEVER be given to another employee after its employee was **deleted** (EN-Q4). A number
  freed because the owner edited its employee to another number is free again: the system never hands it out by itself
  (BR-3), but the owner may type it by hand for anyone. EN-Q4 only covers deletion; nothing else is decided here.
- **FR-006** (`TODO(spec)` EN-Q11): typing a number when adding an employee, changing a number, and setting the
  starting number MUST require `manage:employee-number:company`; the owner holds it by default and can grant it to any
  human role, never a device (pattern of DH-Q5, spec 048).
- **FR-007** (`TODO(spec)` EN-Q10): the owner MUST be able to set the starting number once; it moves the counter
  forward only and never changes an existing employee's number (BR-6).
- **FR-008**: The number MUST appear in the employee detail, the staff list, the attendance board, the monthly report
  (single branch and all branches), the CSV and the reception performer picker (EN-Q3, AB-Q9e). It MUST NOT widen
  anyone's access to those surfaces.
- **FR-009**: The staff list MUST accept an exact-number filter and the performer picker MUST match a digit-only
  search text against the number exactly, in addition to the name search it has today (EN-Q9, D-3).
- **FR-010**: Every hand change of a number and the one-time start MUST write one audit row in the same transaction;
  an unchanged value writes nothing (D-1, `CLAUDE.md` §8).
- **FR-011**: All reads and writes MUST be tenant-scoped (RLS plus `withTenant`); a number of another company never
  appears and never blocks a number here.
- **FR-012**: The POS, attendance clocking, lateness, leave and commission MUST NOT change.

### Key Entities

- **Employee number** (new column on `employees`): the company-unique whole number, nullable only until the contract
  PR.
- **Employee number sequence** (new, one row per company): the counter (`next_number`) and the one-time start.

## Slice design _(mandatory — `CLAUDE.md` §1)_

### Chosen design (technical, no owner question)

- **TD-1 One new column and one counter table, owned by `staff`.** `employees.employee_number integer` and
  `employee_number_sequences` (one row per company). No new module, no new arrow in `docs/module-map.md`: the
  reception picker already reads staff through `SessionPerformerOptionsReads` (ADR-0041), which only gains a field.
- **TD-2 Separate use cases, like salary (021), IBAN (040) and default hours (048).** `update-employee` and its
  `revision`, column grant and name-match flow are untouched. A hand edit is its own use case with its own permission
  and audit row.
- **TD-3 Pure rules in `packages/domain`** (shared by api and admin, `CLAUDE.md` §7; precedent `iban.ts`,
  `employee-name-key.ts`): `parseEmployeeNumber(text)` (digits only, strips leading zeros, 1…999999 or `null`) and
  `firstFreeEmployeeNumber(counter, usedAtOrAbove)` (first unused at or above the counter; `null` past 999999). The
  admin form and the search box call the first; the assign port calls the second. No arithmetic in a use case.
- **TD-4 Serialization.** Every number write in a company (automatic assign, hand edit, start) takes the counter row
  `FOR UPDATE` first; the unique index `(company_id, employee_number)` is the backstop. Where it sits in the existing
  create-employee lock order is decided with the design advisors at the start of 8c-2 (skill §3 step 2: the slice
  changes RLS and a locking path).
- **TD-5 Backfill is an ADR-0038 data step** (`CLAUDE.md` §5: a migration never touches tenant rows as the bypassing
  owner). A registered, idempotent step `employee-numbers` is announced by a `-- pospay:data-step employee-numbers`
  marker on a **third** migration (see TD-11), after the ones that add the column, the sequence table and the index (the
  0101/0102 pattern). The migration owner reads only `companies.id`; for each company the step runs `withTenant(companyId, …)` on
  `pospay_app`, locks the company's sequence row, numbers the rows that still have `NULL` ordered by
  `hire_date, created_at, id` (UUID v7 ids are time-ordered, the last tie-break for rows created in one
  transaction), deleted included, and sets `next_number` to the highest number plus one. No runtime role gains
  `BYPASSRLS` and no new grant is added. The step is registered in the migration runner per ADR-0038 §1; no new ADR.
- **TD-11 Three migrations, because `CREATE UNIQUE INDEX CONCURRENTLY` cannot follow other DDL** (the runner in
  `packages/db/src/concurrent-migrations.ts` accepts it only as the first statement of its own migration, ADR-0033):
  (A) add `employees.employee_number` with its CHECK, create `employee_number_sequences` with RLS and grants;
  (B) the non-partial unique index `(company_id, employee_number)` alone, `CONCURRENTLY` (the column is still all
  `NULL`, so it builds instantly); (C) the `-- pospay:data-step employee-numbers` marker on a harmless
  `COMMENT ON COLUMN` statement. The backfill therefore runs with the unique index already protecting it.
- **TD-6 The open technical point of the plan row is closed like this.** The backfill always starts from 1, because
  the starting-number screen does not exist yet when it runs and EN-Q5 says "default 1". What the starting number does
  afterwards to employees that already hold numbers is an owner decision, not a technical one — **EN-Q10**.
- **TD-7 Expand/contract (`CLAUDE.md` §10).** The column ships nullable with a non-partial unique index; readers
  tolerate `NULL`. A later PR (8c-11) numbers stragglers written by an older image and adds `NOT NULL` through
  `CHECK … NOT VALID` then `VALIDATE`, in a release after the one that made every writer assign numbers.
- **TD-8 Company-level route.** The starting number is a company setting, so its routes are company-level like
  `document-types`: `GET/PUT /v1/employee-numbering`.
- **TD-9 Exhaustion.** Past 999999 the automatic assignment is refused with `EMPLOYEE_NUMBER_EXHAUSTED` (the range is
  the owner's EN-Q8; there is no other possible behaviour); hand numbers are unaffected.
- **TD-10 `NULL` tolerance.** Until the contract PR a `NULL` number is shown as «—» and never breaks a screen, export or
  report (needed so an older image can still write during a rollback).

### Business rules

- **BR-1** (EN-Q1, EN-Q8): an employee number is a whole number 1…999999, unique per company, deleted employees
  included. Example: Glow has Sara 1, Heba 2, Reem 3.
- **BR-2** (EN-Q1, EN-Q6): automatic assignment = the first unused number at or above the counter; the counter becomes
  that number + 1. Example: start 1000, Dana 1000, Lina 1001; the owner edits Lina to 1050; the next employee gets 1002
  (not 1051); when the counter reaches 1050 it jumps to 1051.
- **BR-3** (EN-Q6): a hand number never moves the counter, and the counter never goes back: a number freed below the
  counter is not revisited. A number freed at or above the counter is just unused and is assigned when the counter
  reaches it; no record of retired numbers is kept.
- **BR-4** (EN-Q4): a number is never reassigned after its employee is deleted; deleted employees keep theirs and
  nobody may edit it (D-5). A number freed by a hand edit is not covered by this rule (FR-005, BR-3).
- **BR-5** (EN-Q1, EN-Q7): the migration orders by hire date, then creation time, then id, deleted included; later
  employees are numbered by creation order, not hire date (D-7, `TODO(spec)` EN-Q13).
- **BR-6** (`TODO(spec)` EN-Q10, recommended A): the starting number is set once; the counter becomes
  `max(counter, start)`; no existing number changes. Example: 1, 2, 3 exist, counter 4, start 1000 → next new = 1000.
- **BR-7** (`TODO(spec)` EN-Q11, recommended A): typing, editing and setting the start need
  `manage:employee-number:company`.
- **BR-8** (`TODO(spec)` EN-Q12, recommended A): imported employees get automatic numbers, in file-row order, one
  after the other.

### Derived rules (no owner question of their own — `TODO(spec)` until confirmed together as EN-Q13)

| ID  | Rule                                                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | Every hand change and the one-time start write an audit row (entity `employees`, action `employee_number.changed` / `employee_number.start_set`, before/after, actor). |
| D-2 | The number is shown as plain digits, no separators, in Arabic and English screens, and printed the same way.                                                            |
| D-3 | The list filter is an **exact** match; the picker matches a digit-only text exactly **or** the name as today.                                                          |
| D-5 | A deleted employee's number cannot be edited (the employee reads as `NOT_FOUND`) and stays reserved.                                                                    |
| D-7 | After the migration, numbers follow creation order; hire date does not order new employees.                                                                             |
| D-8 | A hand number or the start typed by someone without the permission is refused (`FORBIDDEN`), never silently ignored.                                                    |

### Schema changes (expand only)

| Table                              | Columns added / changed                                                                                                                                                                                                                                                                                           | RLS policy                                                                                                               | Indexes                                                                                                    | Tenant-qualified FKs                       |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `employees`                        | `employee_number integer NULL`, `CHECK (employee_number IS NULL OR employee_number BETWEEN 1 AND 999999)`                                                                                                                                                                                                         | unchanged (existing `company_id = app_company_id()` policies)                                                            | **non-partial** `UNIQUE (company_id, employee_number)` (deleted rows count, EN-Q4); built `CONCURRENTLY` in its own migration (TD-11)      | none new                                   |
| `employee_number_sequences` (new)  | `company_id uuid NOT NULL`, `next_number integer NOT NULL DEFAULT 1 CHECK (next_number BETWEEN 1 AND 1000000)`, `start_number integer NULL CHECK (start_number BETWEEN 1 AND 999999)`, `start_set_by uuid NULL`, `start_set_at timestamptz NULL` (start columns all NULL or all NOT NULL), `updated_at timestamptz NOT NULL`; **PK `(company_id)`** | ENABLE + FORCE; `SELECT`, `INSERT`, `UPDATE (next_number, start_number, start_set_by, start_set_at, updated_at)` for `pospay_app` on `company_id = app_company_id()`; no DELETE | PK; `(start_set_by)`                                                                                          | `company_id → companies(id)`; `start_set_by → user(id)` |

- The sequence table is a per-company singleton, so its key is the tenant key itself (like `companies.id`); ADR-0007's
  concern — an `id`-only key that leaks other tenants' rows through uniqueness — does not apply. The database reviewer
  confirms this at 8c-1.
- Grants: `employees.employee_number` gets `INSERT` and `UPDATE (employee_number)` for `pospay_app`; the sequence table
  as above. Both are added to the reviewed allowlist in `packages/db/src/__tests__/privileges.spec.ts`.
- The backfill and the counter seed are the `employee-numbers` data step on migration C (TD-5, TD-11). Migration numbers: next free on `origin/main` at
  implementation, renumbered at merge. No destructive statement.
- Permission migration (8c-6): `INSERT` `manage:employee-number:company` into `permissions` and into the owner role
  default (pattern of migration 0128) — `TODO(spec)` EN-Q11.

### API contract

All routes under `/v1`, feature flag `staff`, standard error envelope.

- `POST /v1/businesses/{businessId}/employees` (existing) — `CreateEmployeeInput` gains optional
  `employee_number` (integer 1…999999, **8c-7**, `TODO(spec)` EN-Q11); response `Employee` gains
  `employee_number: integer | null` (8c-2, automatic number returned).
- `GET /v1/businesses/{businessId}/employees/{employeeId}` and the list items (existing) gain
  `employee_number: integer | null` (8c-4).
- `GET /v1/businesses/{businessId}/employees?employee_number=N` — optional exact filter (8c-4).
- Session performer options (existing query, ADR-0041): items gain `employee_number: integer | null`; `q` made only
  of digits also matches the number exactly (8c-4).
- Attendance board (`in_now[]` and `sessions[]`) and monthly report rows gain `employee_number: integer | null`; the
  CSV gets a first column (8c-5).
- `PUT /v1/businesses/{businessId}/employees/{employeeId}/employee-number` · `@Require('manage:employee-number:company')`
  (8c-6, `TODO(spec)` EN-Q11) · body `{ employee_number: integer 1…999999 }` →
  `{ employee_id, employee_number }`. `Idempotency-Key`: not required (no money or stock effect; the same value twice
  is a no-op).
- `GET /v1/employee-numbering` → `{ next_number, start_number | null, start_set_at | null, can_manage }` and
  `PUT /v1/employee-numbering/start` · `@Require('manage:employee-number:company')` · body
  `{ start_number: integer 1…999999 }` (8c-8, `TODO(spec)` EN-Q10, EN-Q11). The GET needs the same permission.
- Zod: `packages/contracts/src/staff/employee.ts` (+ `update-employee.ts`) and a new
  `packages/contracts/src/staff/employee-number.ts`, registered in OpenAPI; the generated client is regenerated in the
  same PR as each contract change.
- Errors: `VALIDATION_FAILED`, `EMPLOYEE_NUMBER_TAKEN` (409), `EMPLOYEE_NUMBER_EXHAUSTED` (422),
  `EMPLOYEE_NUMBER_START_ALREADY_SET` (409), `NOT_FOUND`, `FORBIDDEN`, `FEATURE_DISABLED`; each with
  `message_ar` / `message_en`.

### Permissions

- Reading the number follows each surface's existing read rule; nothing is widened (FR-008).
- New `manage:employee-number:company` (`TODO(spec)` EN-Q11): `ROLE_DEFAULTS = ['owner']`, added to
  `OWNER_GRANTED_PERMISSIONS` (db and identity lists) and the i18n permission catalogs; grantable by the company owner
  to any human role, never a device.

### Events

- None published or consumed. The audit rows (D-1) are the record. Row 27g reads the number through staff's read path,
  not through an event.

### Admin UI (8c-9, 8c-10)

- Employee profile: the number beside the name. Staff list: a number column and an exact-number search box. All
  numbers are plain digits (D-2); `NULL` shows «—» (TD-10).
- Reception performer picker: the number next to each name; typing digits finds the employee (EN-Q9).
- Attendance board and monthly report screens: a number column; the CSV button is unchanged.
- Owner only (with the permission): an "Employee number" field on the add-employee form (blank = automatic), an edit
  action on the profile, and a one-time "Start numbering from" dialog on the staff list. A typed «007» is turned into
  7 by `parseEmployeeNumber` before it is sent (EN-Q8).
- All strings from `packages/i18n`; logical CSS only; no closing comments in JSX.

### Test plan

- **Domain unit** (`packages/domain`): `parseEmployeeNumber` («007» → 7, «0» / «1000000» / «-1» / «1.5» / «٣» / empty
  → `null`); `firstFreeEmployeeNumber` (empty, gap, skip a hand number, counter on a used number, exactly 999999, past
  999999 → `null`, the 1050 example of BR-2).
- **Integration** (T2 Postgres, cloned DB per spec file): `EN-01` backfill order, ties and deleted (US1) · `EN-02`
  backfill idempotent and per-company · `EN-03` create assigns next, counter moves (US2-1) · `EN-04` two concurrent
  creates, distinct and gap-free · `EN-05` failed create leaves the counter · `EN-06` hand number does not move the
  counter and is skipped later (BR-2/3) · `EN-07` taken number refused, deleted employee's number included · `EN-08`
  validation of 1…999999 and «007» · `EN-09` permission matrix (owner, owner-granted person, non-holder, device) ·
  `EN-10` no-op not audited, change audited · `EN-11` start once, forward only (US4) · `EN-12` exhaustion at 999999 ·
  `EN-13` import commit numbers in file order · `EN-14` list filter and picker digit search · `EN-15` board, report and
  CSV carry the number and still carry no phone, salary or IBAN.
- **RLS negative**: `employee_number_sequences` cross-tenant read = 0 rows, insert/update with another `company_id`
  rejected, no DELETE; a duplicate number across two tenants is allowed, within one tenant rejected by the unique
  index; the privileges allowlist test lists the new grants.
- **Queries**: result-shape test and `EXPLAIN ANALYZE` index assertion for the list filter, the picker digit match and
  the used-numbers lookup of the assign port (`(company_id, employee_number)` index).
- **Existing tests that assert the number is absent** — `attendance-board.query.spec.ts` (`employee_number` in the
  private-field list) and `attendance-monthly-report-csv.spec.ts` (its forbidden-words pattern includes `employee_number` and the Arabic label for it) — both change in 8c-5: the number is now allowed; phone, salary, IBAN and documents stay forbidden.
- **Admin**: profile, list search, picker digit search, create-form field visible only with the permission, «007»
  normalisation, `NULL` shows «—», edit and start dialogs.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100 % of employees, deleted included, have a number after the contract PR; 0 duplicates per company.
- **SC-002**: 1 000 simultaneous employee creations in one company produce 1 000 distinct numbers with no gap.
- **SC-003**: The number appears on all six surfaces of EN-Q3 for every employee.
- **SC-004**: Finding an employee by number takes one search, and every list or picker query stays within its current
  200 ms budget.
- **SC-005**: 100 % of hand changes are in the audit log with who, when, before and after.

## Assumptions

- The partner's later answer may change any EN decision (Waleed's ruling, 2026-10-10); a change becomes a follow-up
  slice.
- The employee card, the QR flow, the POS and the employee's own app view (row 57b) do not show the number in this
  row.
- Rows 27g, 27h and 27i (the official statement, the business identity settings, the PDF renderer) are written in
  their own specs; they only read the number this row stores. The statement questions already answered (ST-Q1 …
  ST-Q5) stay in [owner-questions.ar.md](owner-questions.ar.md) for them.

## 1. Sub-PRs (at most three subtasks each)

| PR    | What                                                                                                       | Subtasks                                                                                                                                | Needs            | State                  |
| ----- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ---------------------- |
| 8c-1  | Database foundation                                                                                        | (1) migrations A and B: column, sequence table with RLS and grants, then the concurrent unique index (2) Drizzle schema, privileges allowlist, and migration C with the `employee-numbers` data step (3) RLS negative and backfill tests (`EN-01`, `EN-02`) | —                | ready                  |
| 8c-2  | `create-employee` gives the next number                                                                    | (1) `firstFreeEmployeeNumber` + unit tests (2) assign port and Drizzle adapter, counter lock (3) use case, `Employee` contract field, `EN-03`…`EN-05`, `EN-12` | 8c-1             | blocked on EN-Q13 (D-7); advisors first (TD-4) |
| 8c-3  | `commit-employee-import` gives numbers in file order                                                       | (1) import commit uses the assign port (2) `EN-13`                                                                                      | 8c-2             | blocked on EN-Q12      |
| 8c-4  | Reads: employee detail, staff list, performer picker                                                       | (1) contracts and queries add the field (2) exact-number filter and digit match (3) result-shape and `EXPLAIN` tests, `EN-14`          | 8c-1             | blocked on EN-Q13 (D-3) |
| 8c-5  | Reads: attendance board, monthly report, CSV                                                               | (1) board contract and query (2) report contract, query and CSV first column (3) update the two "number is absent" tests, `EN-15`      | 8c-1             | ready                  |
| 8c-6  | `set-employee-number` (hand edit)                                                                          | (1) `parseEmployeeNumber` + unit tests (2) permission migration and use case with audit (3) route, contract, `EN-06`…`EN-10`           | 8c-2             | blocked on EN-Q11, EN-Q13 (D-1, D-8) |
| 8c-7  | `create-employee` accepts a typed number                                                                   | (1) input field and permission check (2) `EN-06` for create, `EN-07`, `EN-09`                                                           | 8c-2, 8c-6       | blocked on EN-Q11      |
| 8c-8  | `set-employee-number-start`                                                                                | (1) use case, `GET`/`PUT /v1/employee-numbering` (2) audit and once-only rule (3) `EN-11`                                               | 8c-2, 8c-6       | blocked on EN-Q10, EN-Q11 |
| 8c-9  | Admin: show and search the number                                                                          | (1) profile and staff list with search (2) reception performer picker (3) board and report screens                                     | 8c-4, 8c-5       | blocked on EN-Q13 (D-2) |
| 8c-10 | Admin: type, edit and start                                                                                | (1) add-employee field (2) edit action on the profile (3) "Start numbering from" dialog                                                 | 8c-7, 8c-8, 8c-9 | blocked on EN-Q10, EN-Q11 |
| 8c-11 | Contract: numbers for stragglers, then `NOT NULL`                                                          | (1) straggler backfill migration (2) `CHECK … NOT VALID` then `VALIDATE`; readers drop the `NULL` branch                               | 8c-2, 8c-3 in a released image | later release |

Parallel work follows the pipeline's file-disjoint rule: 8c-4 and 8c-5 touch different queries and can run together;
8c-2, 8c-3, 8c-6, 8c-7 and 8c-8 all touch the assign port or `create-employee` and run one at a time.
