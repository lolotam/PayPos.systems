# Feature Specification: Employee number on every employee

**Feature Branch**: `feat/p1-8c-*` (one branch per sub-PR, see §1)

**Created**: 2026-10-17

**Status**: Draft — owner answers EN-Q1 … EN-Q14 are final (batches 14 and 17, Waleed 2026-10-12/13; batch 27, Waleed
2026-10-17). Abu Salem's pick on EN-Q1…Q4 is the same as Waleed's; he has not answered EN-Q10 … EN-Q14, and if his pick
differs later it replaces these (Waleed's ruling, 2026-10-10). EN-Q15 and EN-Q16 were answered by Abu Salem (batch 32,
2026-10-17) and are binding without Waleed's pick (2026-10-10 rule); PP-3.1, PP-4.1 and PP-4.2 were answered by Waleed (2026-10-18). No
owner point is pending.

**Input**: User description: "staff-employee-number — every employee gets a number that appears in the profile, the
staff list, the attendance board, the monthly report, the CSV and the official statement (Abu Salem's AB-Q10 pick,
approved by Waleed 2026-10-12)."

**Phase 1 row**: 8c, builds on row 8 (spec `docs/specs/013-staff-create-employee/spec.md`), row 9 (`update-employee`),
row 27a/27b (spec `docs/specs/049-staff-attendance-board-report/spec.md`, AB-Q9e / AB-Q10) and row 35c (the reception
performer picker, ADR-0041). **Consumed by** row 27g (the official attendance statement, which prints the number) —
27g, 27h and 27i have their own specs; nothing of them is built here.

## Owner decisions already taken (binding — not asked again; EN-Q10 … EN-Q14 are Waleed's picks, Abu Salem has not answered them; EN-Q15 and EN-Q16 are Abu Salem's, binding)

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
| EN-Q10 | What the one-time starting number does to employees that already have numbers | Numbers already given stay as they are (1, 2, 3); the starting number affects **new** employees only, so the first new employee gets 1000. The counter never goes back, and the choice is made once (BR-6). Batch 27, Waleed 2026-10-17. |
| EN-Q11 | Who may type or change a number, and who sets the starting number | New permission `manage:employee-number:company`: the owner holds it by default and can grant it to anyone. A person without it still adds employees (the number is automatic), but typing or changing a number is refused clearly (BR-7, D-8). Batch 27, Waleed 2026-10-17. |
| EN-Q12 | Does the Excel import template get an «employee number» column | **No**, not in this batch: imported employees get automatic numbers in file-row order and the owner edits any by hand afterwards. It can be added later without breaking anything (BR-8). Batch 27, Waleed 2026-10-17. |
| EN-Q13 | Confirm the derived rules D-1, D-2, D-3, D-5, D-7, D-8 | Confirmed as written, all of them (§ Derived rules). Batch 27, Waleed 2026-10-17. |
| EN-Q14 | May a number freed by a hand edit (not by deletion) be given again | **Yes**: it is an ordinary unused number again. The owner may type it by hand for any employee and the counter gives it if it is at or above the counter and reaches it. No record of old numbers is kept (FR-005, BR-3). Known downside: a statement printed with Sara's old number could be confused with an employee who later takes the same number. Batch 27, Waleed 2026-10-17. |
| EN-Q15 | May a holder of `manage:employee-number:company` change the number of an employee in a business whose staff screen she cannot open | **Yes**: the permission is company-wide; a holder may change the number of an employee in any business unless a DENY covers that employee's business or branch. The use case rechecks inside the transaction (FR-006). Batch 32, Abu Salem 2026-10-17 (binding). |
| EN-Q16 | Search box on the staff list (partner request AS-24) | **One search box `q`**: digits only match the exact employee number **or** the name; letters search the Arabic and English names, the same way the reception performer picker does. It is added beside the existing exact `employee_number=N` filter, which stays (FR-009, D-3). Batch 32, Abu Salem 2026-10-17 (binding). |
| PP-3.1 | Which branches the DENY recheck on a number change covers when the employee is attached to more than one branch | The employee's business, her primary branch **and every branch she is currently attached to**; a DENY on any of them blocks the change (same rule as the IBAN screen). Permission decision for Waleed only, not on the partner page. Waleed 2026-10-18. |
| PP-4.1 | How a holder of `manage:employee-number:company` reaches an employee in a business whose staff screen she cannot open | **(a)** A small company-wide screen «الأرقام الوظيفية» for holders of the permission: it lists every employee of the company with name, business and number only (no salary, phone, documents or any other field) and lets the holder edit the number there. The PP-3.1 DENY rule still applies: an employee whose business, primary branch or any current attached branch carries a DENY on this permission is neither listed for her nor editable by her. Screen decision for Waleed only, not on the partner page. Waleed 2026-10-18, through the super agent. |

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
   the next number in file-row order (BR-8, EN-Q12).

---

### User Story 3 — The owner types or changes a number (Priority: P1)

**Independent Test**: type 1050 for Noor; add Lana; check Lana's number and that 1050 is protected.

**Acceptance Scenarios** (EN-Q11; scenario 4 is EN-Q14):

1. **Given** the owner, **When** she adds Mona and types 1050, **Then** Mona gets 1050 and the counter does not move
   (EN-Q6, EN-Q9).
2. **Given** the owner, **When** she changes Noor's number to 1050 and 1050 is already used (even by a deleted
   employee), **Then** it is refused with `EMPLOYEE_NUMBER_TAKEN` and nothing changes (EN-Q1, EN-Q4).
3. **Given** the counter is at 1002 and 1050 is used, **When** employees are added until the counter reaches 1050,
   **Then** the one after 1049 gets 1051 (EN-Q6: skips a used number).
4. **Given** (EN-Q14) Noor's old number 4 was freed by editing her to 1050 and the counter is already at 5, **When** a new
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

**Acceptance Scenarios** (EN-Q10, EN-Q11):

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
2. **Given** the staff list search box `q` (EN-Q16), **When** it holds `2`, **Then** Heba (number 2) is returned **and**
   any employee whose name contains «2»; a text nobody matches returns an empty page, not an error.
   - 2a. **Given** `q` is an Arabic name part («هبة»), **When** searched, **Then** Heba appears (Arabic and English
     names are searched, as in the performer picker).
   - 2b. **Given** `q` is an English name part («heb»), **When** searched, **Then** Heba appears.
   - 2c. **Given** one employee numbered 2 and another whose name contains «2», **When** `q` is `2`, **Then** both
     appear.
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
  then creation time, then id (EN-Q1, EN-Q7), and leave each company's counter just after the last number the migration assigned (never lowered, never moved by a hand-typed number). It MUST
  be idempotent.
- **FR-005**: A number MUST NEVER be given to another employee after its employee was **deleted** (EN-Q4).
  EN-Q14: a number freed because the owner edited its employee to another
  number is an ordinary unused number again — the counter assigns it only if it is at or above the counter when it
  gets there, and the owner may type it by hand for anyone (BR-3). EN-Q4 covers deletion only.
- **FR-006** (EN-Q11): typing a number when adding an employee, changing a number, and setting the
  starting number MUST require `manage:employee-number:company`; the owner holds it by default and can grant it to any
  human role, never a device (pattern of DH-Q5, spec 048). EN-Q15 (partner Abu Salem, batch 32, 2026-10-17): the permission is company-wide, so a holder may change the number of an employee in any business of the company, unless a DENY covers that employee's business or branch; the use case rechecks the permission inside the transaction on the employee's business/branch target so a narrower DENY wins. PP-3.1 (Waleed, 2026-10-18): the recheck covers the employee's business, her primary branch and every branch she is currently attached to; a DENY on any of them blocks the change (same rule as the IBAN screen). "Currently attached" means the attachment has `from <= today` and (`to IS NULL` or `to > today`; `to` is exclusive, as in the shared `currentAttachment` predicate), where today is the date in the branch's business day, the same as the IBAN screen: a finite attachment that is still current today counts; one that ended before today or starts after today does not. PP-4.2 (Waleed, 2026-10-18): the same recheck applies to a number typed when adding an employee. When a create request carries `employee_number`, the use case rechecks `manage:employee-number:company` inside the transaction on the NEW employee's business and on the branches she is being created into (her primary branch plus any branches in the request); a DENY on any of them refuses the request with `403 FORBIDDEN` and creates nothing (D-8: never silently ignored). For this creation check the targets are the business and the branches selected in the request regardless of the attachment start date: `create-employee` allows a future `hire_date`, so a new attachment may start later, and it still counts; the "currently attached" date rule above applies only to hand edits of existing employees. The add screen does not offer the number field for that business/branch, so the employee is created without the field and takes the automatic number.
- **FR-007** (EN-Q10): the owner MUST be able to set the starting number once; it moves the counter
  forward only and never changes an existing employee's number (BR-6).
- **FR-008**: The number MUST appear in the employee detail, the staff list, the attendance board, the monthly report
  (single branch and all branches), the CSV and the reception performer picker (EN-Q3, AB-Q9e). It MUST NOT widen
  anyone's access to those surfaces.
- **FR-009** (EN-Q16): The staff list MUST have ONE search box `q`: a text of digits only matches the exact employee
  number **or** the name; any other text searches the Arabic and English names, the same way the reception performer
  picker does. The performer picker MUST match a digit-only search text against the number exactly, in addition to the
  name search it has today (EN-Q9, D-3). The `q` box is added beside the exact `employee_number=N` list filter; that filter stays and nothing is removed.
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
  `firstFreeEmployeeNumber(counter, usedAtOrAbove)` (first unused at or above the counter; `null` past 999999) and
  `nextEmployeeNumberCounter(assigned)` (the counter after an automatic assignment: the number plus one, capped at
  1000000). `parseEmployeeNumber` is used only by number-entry fields (the add form, the edit action, the start dialog) and by the server to read the digit branch of `q`; the admin search box passes the raw text to `?q=` unchanged. The assign port calls the second and third. No arithmetic in a use case.
- **TD-4 Serialization.** Every number write in a company (automatic assign, hand edit, start) takes the counter row
  `FOR UPDATE` first; the unique index `(company_id, employee_number)` is the backstop. Decided with the design advisors at the start of 8c-2 (two independent reviews agree):
  **global lock order = company (`FOR NO KEY UPDATE`) → memberships ordered by id → import preview/idempotency locks
  (import paths only) → the counter row → employee rows → attachments and audit.** A path may skip locks but never reverses
  two of them. In `create-employee` the counter is taken after authorization and validation and before the insert, so a
  caller without access never touches it and a refused request never reserves a number. The allocator seeds the row
  (`INSERT … ON CONFLICT DO NOTHING`), locks it in a separate statement, scans used numbers from the counter in bounded
  pages (256) and moves the counter forward in the same transaction. Every future writer of a number (8c-3 import commit,
  8c-6 hand edit, 8c-8 start, 8c-11 stragglers) MUST take the counter before locking an employee row; a hand edit reads
  the employee without a lock, locks the counter, then locks the employee row. The allocator lives in `packages/db` (`@pospay/db`) so the api and the worker share one implementation; an import that exhausts the range fails as `IMPORT_COMMIT_FAILED`.
- **TD-5 Backfill is an ADR-0038 data step** (`CLAUDE.md` §5: a migration never touches tenant rows as the bypassing
  owner). A registered, idempotent step `employee-numbers` is announced by a `-- pospay:data-step employee-numbers`
  marker on a **third** migration (see TD-11), after the ones that add the column, the sequence table and the index (the
  0101/0102 pattern). The migration owner reads only `companies.id`; for each company the step runs `withTenant(companyId, …)` on
  `pospay_app`, locks the company's sequence row, numbers the rows that still have `NULL` ordered by
  `hire_date, created_at, id` (UUID v7 ids are time-ordered, the last tie-break for rows created in one
  transaction), deleted included, and raises `next_number` to the last number it assigned plus one, never lowering it and never reading a hand-typed number as the counter (so a re-run or the 8c-11 straggler pass cannot move it). No runtime role gains
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
- **BR-3** (EN-Q6; second sentence EN-Q14): a hand number never moves the counter, and the counter never goes back: a number freed below the
  counter is not revisited. A number freed at or above the counter is just unused and is assigned when the counter
  reaches it; no record of retired numbers is kept.
- **BR-4** (EN-Q4): a number is never reassigned after its employee is deleted; deleted employees keep theirs and
  nobody may edit it (D-5). A number freed by a hand edit is not covered by this rule (FR-005, BR-3).
- **BR-5** (EN-Q1, EN-Q7): the migration orders by hire date, then creation time, then id, deleted included; later
  employees are numbered by creation order, not hire date (D-7, EN-Q13).
- **BR-6** (EN-Q10): the starting number is set once; the counter becomes
  `max(counter, start)`; no existing number changes. Example: 1, 2, 3 exist, counter 4, start 1000 → next new = 1000.
- **BR-7** (EN-Q11): typing, editing and setting the start need
  `manage:employee-number:company`.
- **BR-8** (EN-Q12): imported employees get automatic numbers, in file-row order, one
  after the other.

### Derived rules (no owner question of their own — confirmed together as EN-Q13)

| ID  | Rule                                                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | Every hand change and the one-time start write an audit row in the same transaction. A hand change: entity `employees`, entity id = the employee id, action `employee_number.changed`, before/after number, actor. The start: entity `employee_number_sequences`, entity id = the **company id** (the sequence row's key, so it exists even when the company has no employees), action `employee_number.start_set`, before/after `{ start_number, next_number }`, actor. |
| D-2 | The number is shown as plain digits, no separators, in Arabic and English screens, and printed the same way.                                                            |
| D-3 | The staff list has one search box `q`, like the picker: digits only match the exact number **or** the name; letters search the Arabic and English names. EN-Q16 changed the earlier «exact match only» wording confirmed under EN-Q13: `q` is added beside the exact `employee_number=N` filter, which stays. |
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
  default (pattern of migration 0128) — EN-Q11.

### API contract

All routes under `/v1`, feature flag `staff`, standard error envelope.

- `POST /v1/businesses/{businessId}/employees` (existing) — `CreateEmployeeInput` gains optional
  `employee_number` (integer 1…999999, **8c-7**, EN-Q11; when a create request carries it, the use case rechecks
  `manage:employee-number:company` inside the transaction on the NEW employee's business and the branches she is being
  created into (primary branch plus any branches in the request), and a DENY on any of them refuses it with
  `403 FORBIDDEN` and creates nothing, regardless of the attachment start date, FR-006, PP-4.2, D-8);
  the `POST` response is the new
  `CreatedEmployee` (`Employee` plus `employee_number: integer | null`, 8c-2, automatic number returned); `Employee` and
  `EmployeeDetail` stay unchanged until 8c-4 adds the field to the read producers.
- `GET /v1/businesses/{businessId}/employees/{employeeId}` and the list items (existing) gain
  `employee_number: integer | null` (8c-4).
- `GET /v1/businesses/{businessId}/employees?q=…` — optional search box (8c-4b, EN-Q16): digits only match the exact
  `employee_number` **or** the name; any other text searches the Arabic and English names, as the performer picker does.
  It is added beside the exact `employee_number=N` filter that 8c-4 added; that filter stays and nothing is removed.
- Session performer options (existing query, ADR-0041): items gain `employee_number: integer | null`; `q` made only
  of digits also matches the number exactly (8c-4).
- Attendance board (`in_now[]` and `sessions[]`) and monthly report rows gain `employee_number: integer | null`; the
  CSV gets a first column (8c-5).
- `PUT /v1/businesses/{businessId}/employees/{employeeId}/employee-number` · `@Require('manage:employee-number:company')`
  (8c-6, EN-Q11) · body `{ employee_number: integer 1…999999 }` →
  `{ employee_id, employee_number }`. `Idempotency-Key`: not required (no money or stock effect; the same value twice
  is a no-op).
- `GET /v1/employee-numbers` · `@Require('manage:employee-number:company')` (8c-6b, PP-4.1) · company-level read behind
  the «الأرقام الوظيفية» screen · cursor-paginated · each item is `{ employee_id, name_ar, name_en, business_id,
  business_name_ar, business_name_en, employee_number }` and nothing else (no salary, phone, documents or any other
  field). Employees whose business, primary branch or any current attached branch carries a DENY on
  `manage:employee-number:company` for the caller are filtered out (EN-Q15, PP-3.1); soft-deleted employees are
  excluded. Optional `q` with the same search rule as the staff list (EN-Q16): digits only match the exact number or
  the name, other text searches the Arabic and English names. Editing from this screen reuses the 8c-6 `PUT` route
  above. `Idempotency-Key`: not required (read).
- `GET /v1/employee-numbering` → `{ next_number, start_number | null, start_set_at | null, can_manage }` and
  `PUT /v1/employee-numbering/start` · `@Require('manage:employee-number:company')` · body
  `{ start_number: integer 1…999999 }` (8c-8, EN-Q10, EN-Q11). The GET needs the same permission.
- Zod: `packages/contracts/src/staff/employee.ts` (+ `update-employee.ts`) and a new
  `packages/contracts/src/staff/employee-number.ts`, registered in OpenAPI; the generated client is regenerated in the
  same PR as each contract change.
- Errors: `VALIDATION_FAILED`, `EMPLOYEE_NUMBER_TAKEN` (409), `EMPLOYEE_NUMBER_EXHAUSTED` (422),
  `EMPLOYEE_NUMBER_START_ALREADY_SET` (409), `NOT_FOUND`, `FORBIDDEN`, `FEATURE_DISABLED`; each with
  `message_ar` / `message_en`.

### Permissions

- Reading the number follows each surface's existing read rule; nothing is widened (FR-008).
- New `manage:employee-number:company` (EN-Q11): `ROLE_DEFAULTS = ['owner']`, added to
  `OWNER_GRANTED_PERMISSIONS` (db and identity lists), `deviceForbidden` in `packages/db/src/system-role-policy.ts` (a device is otherwise eligible for every catalog permission not listed there) and the i18n permission catalogs; grantable by the company owner
  to any human role, never a device.

### Events

- None published or consumed. The audit rows (D-1) are the record. Row 27g reads the number through staff's read path,
  not through an event.

### Admin UI (8c-9, 8c-10, 8c-10b)

- Employee profile: the number beside the name. Staff list: a number column and one search box (EN-Q16): digits find
  the exact number or the name, letters find the Arabic or English name. All numbers are plain digits (D-2); `NULL`
  shows «—» (TD-10).
- Reception performer picker: the number next to each name; typing digits finds the employee (EN-Q9).
- Attendance board and monthly report screens: a number column; the CSV button is unchanged.
- Only for a holder of `manage:employee-number:company` (the owner by default, or a person the owner granted it to): an "Employee number" field on the add-employee form (blank = automatic; not offered at all when a DENY covers the chosen business/branch — the form asks the server-side capability read `GET /v1/businesses/{businessId}/employee-number-capability?branch_ids=…` (8c-7) for the selected business and branches, PP-4.2), an edit
  action on the profile, and a one-time "Start numbering from" dialog on the staff list. A typed «007» is turned into
  7 by `parseEmployeeNumber` before it is sent (EN-Q8).
- All strings from `packages/i18n`; logical CSS only; no closing comments in JSX.
- Company-wide screen «الأرقام الوظيفية» (8c-10b, PP-4.1), only for a holder of `manage:employee-number:company`, so a
  holder can reach an employee in a business whose staff screen she cannot open. A table of every employee of the
  company with exactly three fields: name, business and number (plain digits, `NULL` shows «—»); no salary, phone,
  documents or any other field. One search box `q` as on the staff list (EN-Q16). Each row has an edit action that
  calls the 8c-6 `PUT` route; «007» is turned into 7 by `parseEmployeeNumber` before it is sent. The list applies the
  same DENY filtering as the edit (PP-3.1): an employee whose business, primary branch or any current attached branch
  carries a DENY on this permission is not listed for her and cannot be edited by her. Data comes from
  `GET /v1/employee-numbers` (8c-6b).
- PP-4.2 (Waleed, 2026-10-18): typing a number when adding an employee (8c-7) applies the same EN-Q15/PP-3.1 DENY recheck as the hand edit. Under such a DENY the API refuses a create request that carries `employee_number` with `403 FORBIDDEN` and creates nothing (D-8); the add screen does not offer the number field for that business/branch, so the employee is created without the field and takes the automatic number.

### Test plan

- **Domain unit** (`packages/domain`): `parseEmployeeNumber` («007» → 7, «0» / «1000000» / «-1» / «1.5» / «٣» / empty
  → `null`); `firstFreeEmployeeNumber` (empty, gap, skip a hand number, counter on a used number, exactly 999999, past
  999999 → `null`, the 1050 example of BR-2).
- **Integration** (T2 Postgres, cloned DB per spec file): `EN-01` backfill order, ties and deleted (US1) · `EN-02`
  backfill idempotent and per-company · `EN-03` create assigns next, counter moves (US2-1) · `EN-04` two concurrent
  creates, distinct and gap-free · `EN-05` failed create leaves the counter · `EN-06` hand number does not move the
  counter and is skipped later (BR-2/3) · `EN-07` taken number refused, deleted employee's number included · `EN-08`
  validation of 1…999999 and «007» · `EN-09` permission matrix (owner, owner-granted person, non-holder, device) ·
  `EN-09b` company-level holder with DENY (EN-Q15, PP-3.1): DENY on the employee's business → refused; DENY on her
  primary branch → refused; DENY on another branch she is currently attached to → refused; the same holder editing an
  employee in another business with no DENY → allowed (the recheck runs inside the transaction) ·
  `EN-09c` typed number at creation under a DENY (PP-4.2, D-8): a create request carrying `employee_number` under a DENY on
  `manage:employee-number:company` for the new employee's business or branch → `403 FORBIDDEN` and nothing created (no
  employee row, counter unmoved); the same request without the field → `201` with the automatic number; a future-dated
  hire (`hire_date` after today) into a branch carrying a DENY with a typed number → `403 FORBIDDEN` and nothing created
  (the creation check ignores the attachment start date) ·
  `EN-09e` capability read `GET /v1/businesses/{businessId}/employee-number-capability?branch_ids=…` for a company-level holder: a DENY on the business → `can_type_number: false`; a DENY on the selected primary branch → false; a DENY on another selected branch → false; no DENY on the business and the selected branches → true; a non-holder → false (8c-7) ·
  `EN-09d` temporal boundary of attachments (FR-006; hand edit of an existing employee only, not creation): a DENY on a branch whose attachment
  is finite but current today (`from <= today < to`; `to` is exclusive) → refused; a DENY on a branch whose attachment ended before today
  (`to < today`) or starts after today (`from > today`) → allowed; `to IS NULL` counts as current; today is the date in the
  branch's business day ·
  `EN-10` no-op not audited, change audited · `EN-11` start once, forward only (US4) · `EN-12` exhaustion at 999999 ·
  `EN-13` import commit numbers in file order · `EN-14` (row 8c-4) exact `employee_number=N` list filter and picker digit search · `EN-14b` (row 8c-4b) list search box `q`: digits match the exact number or the name, an Arabic letter query, an English letter query, a digit string matching both an exact number and names (EN-Q16, US5-2) · `EN-15` board, report and
  CSV carry the number and still carry no phone, salary or IBAN · `EN-16` company list `GET /v1/employee-numbers` (also: a DENY on a branch whose attachment ended before today, or ends today since `to` is exclusive, or starts after today does NOT hide the employee; a DENY on a finite current attachment does)
  (PP-4.1): the holder sees only employee id, names, business and number; a DENY on an employee's business, primary
  branch or another current attached branch hides that employee; a non-holder gets `FORBIDDEN` (403); soft-deleted
  employees never appear; `q` follows the EN-Q16 rule.
- **RLS negative**: `employee_number_sequences` cross-tenant read = 0 rows, insert/update with another `company_id`
  rejected, no DELETE; a duplicate number across two tenants is allowed, within one tenant rejected by the unique
  index; the privileges allowlist test lists the new grants.
- **Queries**: result-shape test and `EXPLAIN ANALYZE` index assertion for the list search box, the picker digit match and
  the used-numbers lookup of the assign port (`(company_id, employee_number)` index).
- **Existing tests that assert the number is absent** — `attendance-board.query.spec.ts` (`employee_number` in the
  private-field list) and `attendance-monthly-report-csv.spec.ts` (its forbidden-words pattern includes `employee_number` and the Arabic label for it) — both change in 8c-5: the number is now allowed; phone, salary, IBAN and documents stay forbidden.
- **Admin**: profile, list search, picker digit search, create-form field visible only with the permission, «007»
  normalisation, `NULL` shows «—», edit and start dialogs.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100 % of employees, deleted included, have a number after the contract PR; 0 duplicates per company.
- **SC-002**: 1 000 simultaneous employee creations in one company produce 1 000 distinct numbers with no gap.
- **SC-003**: The number appears, for every employee, on the five EN-Q3 surfaces that 8c builds (profile, staff list, attendance board, monthly report, CSV) and in the reception performer picker. The sixth surface, the official statement, is built and accepted in row 27g, which reads the number from this row.
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
| 8c-2  | `create-employee` gives the next number                                                                    | (1) `firstFreeEmployeeNumber` + unit tests (2) assign port and Drizzle adapter, counter lock (3) use case, `CreatedEmployee` contract, `EN-03`…`EN-05`, `EN-12` | 8c-1             | ready (advisors done, TD-4) |
| 8c-3  | `commit-employee-import` gives numbers in file order                                                       | (1) import commit uses the assign port (2) `EN-13`                                                                                      | 8c-2             | ready |
| 8c-4  | Reads: employee detail, staff list, performer picker                                                       | (1) contracts and queries add the field (2) exact `employee_number=N` filter (kept; 8c-4b adds `q` beside it, EN-Q16) and picker digit match (3) result-shape and `EXPLAIN` tests, `EN-14`          | 8c-1             | ready |
| 8c-4b | Staff-list search box (EN-Q16, AS-24)                                                                     | (1) list query `q`: digits only match the exact number OR the name, letters search ar/en names, same as the reception picker (2) EXPLAIN and `EN-14b` tests (3) OpenAPI and clients; the exact `employee_number=N` filter stays | 8c-4             | ready |
| 8c-5  | Reads: attendance board, monthly report, CSV                                                               | (1) board contract and query (2) report contract, query and CSV first column (3) update the two "number is absent" tests, `EN-15`      | 8c-1             | ready                  |
| 8c-6  | `set-employee-number` (hand edit)                                                                          | (1) reuse `parseEmployeeNumber` (added in 8c-4 with its unit tests) (2) permission migration and use case with audit (3) route, contract, `EN-06`…`EN-10`, including `EN-09b` (company-level holder with DENY on the business, primary branch or another attached branch, EN-Q15, PP-3.1) and `EN-09d` (attachment dates)           | 8c-2             | ready |
| 8c-6b | Company employee-numbers list (PP-4.1)                                                                     | (1) query + contract + route `GET /v1/employee-numbers` (2) DENY-filter, result-shape and `EXPLAIN` tests, `EN-16` (3) OpenAPI and clients | 8c-6             | ready |
| 8c-7  | `create-employee` accepts a typed number                                                                   | (1) input field, a capability read `GET /v1/businesses/{businessId}/employee-number-capability?branch_ids=…` → `{ can_type_number: boolean }` (same FR-006 recheck, so the add form hides the field under a DENY), permission check and DENY recheck on the new employee's business and selected branches (FR-006, PP-4.2: `403 FORBIDDEN`, nothing created) (2) `EN-06` for create, `EN-07`, `EN-09`, `EN-09c`, `EN-09e`, `EN-09d`                                                           | 8c-2, 8c-6       | ready |
| 8c-8  | `set-employee-number-start`                                                                                | (1) use case, `GET`/`PUT /v1/employee-numbering` (2) audit and once-only rule (3) `EN-11`                                               | 8c-2, 8c-6       | ready |
| 8c-9  | Admin: show and search the number                                                                          | (1) profile and staff list with search (2) reception performer picker (3) board and report screens                                     | 8c-4, 8c-4b, 8c-5 | ready |
| 8c-10 | Admin: type, edit and start                                                                                | (1) add-employee field (hidden when a DENY covers the business/branch, PP-4.2) (2) edit action on the profile (3) "Start numbering from" dialog | 8c-7, 8c-8, 8c-9 | ready |
| 8c-10b | Admin: company employee-numbers screen (PP-4.1)                                                           | (1) screen «الأرقام الوظيفية»: name, business, number, search box `q` (2) edit action calling the 8c-6 `PUT` (3) DENY-filtered list from `GET /v1/employee-numbers` | 8c-6b, 8c-9 | ready |
| 8c-11 | Contract: numbers for stragglers, then `NOT NULL`                                                          | (1) straggler backfill migration (2) `CHECK … NOT VALID` then `VALIDATE`; readers drop the `NULL` branch                               | 8c-2, 8c-3 in a released image | later release |

Parallel work follows the pipeline's file-disjoint rule: 8c-4 and 8c-5 touch different queries and can run together;
8c-2, 8c-3, 8c-6, 8c-7 and 8c-8 all touch the assign port or `create-employee` and run one at a time.
