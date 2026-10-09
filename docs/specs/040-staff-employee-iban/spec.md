# Feature Specification: Employee IBAN — set and read (masked by default)

**Feature Branch**: `feat/p1-09b-employee-iban`

**Created**: 2026-10-09

**Status**: Owner questions answered 2026-10-09 (Waleed, binding; partner notes recorded). Ready for `/speckit-plan`.

**Input**: User description: "staff-employee-iban — Phase 1 row 9b: employee IBAN on the employee record, masked to
last 4 except salary-style restricted read, audited on change."

**Phase 1 row**: 9b (`docs/specs/phase-1/IMPLEMENTATION-PLAN.md`), depends on rows 9 (`update-employee`, spec 017) and
10 (`set-salary`, spec 021). Source: owner review 2026-10-09, item **DOC-Q1**
([owner-review-2026-10-09.ar.md](../phase-1/owner-review-2026-10-09.ar.md)). Later consumer: the payroll / allowances
bank file (a future row; PRD P5-T9.1), which will carry the IBAN and the English holder name only. The Arabic
questions and answers are in [`owner-questions.ar.md`](owner-questions.ar.md).

## Already decided (owner, 2026-10-09 — DOC-Q1)

- The IBAN belongs to the employee record, **not** to employee documents (spec 028) and not a document type.
- Readers without the restricted permission see only the **last 4 characters**.
- Holders of the restricted permission "like the salary" see the full IBAN.
- **Every change is audited.**
- Partner (Abu Salem) on why: "الايبان مطلوب عشان راح يسعدنا بتصدير اكس ال شيت الرواتب او البدلات دايركت يرفع هذا
  الملف الى البنك" — the IBAN exists to feed a salary / allowances sheet uploaded straight to the bank.

## Owner questions — answered 2026-10-09

Waleed's answer is binding. Partner Abu Salem chose the same on every question except IB-Q2 (he chose B).

- **IB-Q1 — Countries.** Decided (C): **Kuwait and the GCC only** — KW (30), SA (24), AE (23), BH (22), QA (29),
  OM (23), each with its ISO 13616 registry length and BBAN shape. Any other country is refused with a clear message.
- **IB-Q2 — Extra fields.** Decided (C): **IBAN + account-holder name + bank chosen from a list.** The holder name is
  stored in English and is required (bank files need it). The bank is chosen from a per-country reference list; the
  form pre-selects it from the IBAN's bank code when the code is known, and the user confirms. Partner (B) note: "في
  كشف الرواتب النهائي يخرج بس الايبان والاسم بالانجليزي فقط عشان هذا فورمة البنك. ولكن داخل النظام الاسم والايبان
  واسم البنك". The future bank file carries IBAN + English name only (not this PR).
- **IB-Q3 — History.** Decided (A): keep every past IBAN with date, actor and reason; full old values visible only to
  the full-read holder.
- **IB-Q4 — Who sees / who changes.** Decided (A): reuse `read:salaries:business` (full read) and
  `manage:salaries:business` (change, which also needs the read, spec 021 SS-Q1). Employee managers
  (`manage:employees:business`) see the last 4 only. Partner note: the owner, and the person in charge (financial
  manager or accountant) should see it to check the entry — satisfied by granting them the salary permission.
- **IB-Q5 — Clearing.** Decided (A): allowed with a reason, recorded in the history and the audit.
- **IB-Q6 — Employee sees her own IBAN in the staff app.** Decided (A): later, in its own row.
- **IB-Q7 — IBAN in employee import.** Decided (A): later, in its own small row.
- **IB-Q8 — Encryption at rest.** Decided (A): not now; revisit with the Phase 2 envelope-encryption primitive.
- **IB-Q9 — Reason.** Decided (A): mandatory on every change, 1–500 characters after trim.
- **IB-Q10 — Owner alert on change.** Decided (A): later, in its own small row.
- **IB-Q11 — Same IBAN on two employees.** Decided (B): **refused.** One IBAN may be the current IBAN of at most one
  (non-deleted) employee in the whole company. The refusal never names the other employee.

### Follow-up rows to add to the plan (outside this PR's code)

- staff-app "my IBAN" (last 4 only) — IB-Q6.
- IBAN, holder name and bank columns in the employee import — IB-Q7.
- owner in-app alert when someone else changes an IBAN — IB-Q10.
- payroll / allowances bank file (IBAN + English holder name) — IB-Q2 partner note, PRD P5-T9.1.

## Scope and file isolation

One use case, **`set-employee-iban`**, plus its read queries, modelled on `set-salary` (spec 021). It has its own
routes, its own admin section mounted in `employee-record-sections.tsx`, and its own table. It does **not** change
`create-employee`, `update-employee`, their contracts, their forms or the `employees` table (row 8b edits those in
parallel). The manager creates the employee first, then sets the IBAN in the employee's record.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The owner records an employee's bank details (Priority: P1)

Sara starts at the salon. The owner opens Sara's record, goes to "Bank account (IBAN)", types Sara's Kuwaiti IBAN
(with or without spaces). The form pre-selects "National Bank of Kuwait" because the IBAN carries `NBOK`; the owner
confirms it, types the holder name "SARA AHMED ALI" and the reason "new employee", and saves. The section now shows
the full IBAN (grouped in fours), the bank and the holder name to the owner. Who set it and when is recorded.

**Why this priority**: the salary / allowances bank sheet needs a correct IBAN and English name per employee.

**Independent Test**: set valid bank details, read them back as the owner (full) and as an employee manager without
the salary read (last 4 only), and read the audit entry.

**Acceptance Scenarios**:

1. **Given** an employee with no IBAN, **When** the owner saves a valid IBAN, bank, holder name and reason, **Then**
   they are stored (IBAN normalised: no spaces, upper case) at revision 1 and one audit entry is written.
2. **Given** the IBAN in lower case with spaces, or with Arabic-Indic digits, **When** saving, **Then** it is accepted
   and stored normalised.
3. **Given** an IBAN with a mistyped digit, **When** saving, **Then** it is refused as "the IBAN check digits do not
   match" and nothing is saved.
4. **Given** an IBAN of the wrong length for its country, or with invalid characters, **When** saving, **Then** it is
   refused as an invalid IBAN format.
5. **Given** an IBAN from outside KW, SA, AE, BH, QA, OM (e.g. `GB…`, `EG…`), **When** saving, **Then** it is refused
   as "only Kuwait and GCC bank accounts are accepted".
6. **Given** a bank from another country than the IBAN's, or a bank whose known code differs from the IBAN's bank
   code, or an unknown bank id, **When** saving, **Then** it is refused as "the bank does not match the IBAN".
7. **Given** a holder name that is empty, longer than 100 characters, or not in Latin letters, **When** saving,
   **Then** it is refused as "enter the account holder's name in English".
8. **Given** exactly the current IBAN, bank and holder name, **When** saving, **Then** nothing changes and no audit
   entry is written.

---

### User Story 2 - Employee managers see only the last 4 (Priority: P1)

The branch manager can edit Sara's record but must not see her bank details. She sees "IBAN on file: •••• 0101" and
cannot change it; the bank and holder name are not shown to her.

**Why this priority**: the owner's privacy rule (DOC-Q1).

**Independent Test**: as a holder of `manage:employees:business` without `read:salaries:business`, read the section;
the response contains the last 4 only — no full IBAN, bank or holder name.

**Acceptance Scenarios**:

1. **Given** a manager with employee access but not the salary read, **When** she opens the record, **Then** the server
   sends only the status and the last 4 characters.
2. **Given** the same manager, **When** she tries to save or to read the history through the API, **Then** she gets
   the uniform "not found" and nothing is saved.
3. **Given** a caller with neither employee access nor the salary read, **When** the section is requested, **Then**
   the answer is the uniform "not found".
4. **Given** an employee of another business or company, or a soft-deleted employee, **When** any caller requests
   it, **Then** the answer is the uniform "not found".

---

### User Story 3 - The owner changes, clears or traces bank details (Priority: P2)

Sara moves to another bank: the owner replaces the IBAN with the reason "changed bank". Later Sara closes her account
with no new one yet: the owner clears it with the reason "account closed". The owner can open the history and see
every earlier IBAN with date, actor, reason, bank and holder name — the salary-diversion check.

**Independent Test**: change, then clear; read the history (full) and the audit entries.

**Acceptance Scenarios**:

1. **Given** revision 1, **When** the owner saves new details with `expected_revision` 1 and a reason, **Then** the
   current entry is revision 2 and one audit entry holds before and after (last 4, bank, revision).
2. **Given** two people editing at once, **When** the second saves with a stale revision, **Then** it is refused as a
   conflict and nothing changes.
3. **Given** a current IBAN, **When** the owner clears it with a reason, **Then** a new revision with no IBAN is
   recorded, the section shows "no IBAN", and the audit records the clearing. Clearing when there is no IBAN is a
   no-op.
4. **Given** the history, **When** the full-read holder opens it, **Then** every revision is listed newest first with
   full IBAN, bank, holder name, date, actor and reason; masked readers cannot open it.

---

### User Story 4 - One IBAN, one employee (Priority: P2)

The receptionist (who was granted the salary permissions) types her own IBAN into Sara's record. The save is refused:
"this IBAN is already registered to another employee in the company" — without saying which one.

**Acceptance Scenarios**:

1. **Given** IBAN X is the current IBAN of employee A (any business of the company), **When** someone saves X for
   employee B, **Then** it is refused with `EMPLOYEE_IBAN_ALREADY_USED` (409) and nothing is saved.
2. **Given** A later changes or clears her IBAN, or A is soft-deleted, **When** X is saved for B, **Then** it is
   accepted (only *current* IBANs of non-deleted employees count; history does not).
3. **Given** X in another company, **When** X is saved here, **Then** it is accepted (tenants never see each other).
4. **Given** two concurrent saves of X for A and B, **Then** exactly one succeeds.

### Edge Cases

- Spaces, lower case, Arabic-Indic (٠–٩) and Persian (۰–۹) digits are normalised before validation; any other
  character is refused.
- The mod-97 check catches every single mistyped digit and every swap of two adjacent different digits (ISO 7064
  guarantee). A letter typed in place of a digit can keep the checksum; it is caught by the country's BBAN shape where
  that position must be a digit.
- The 409 for a duplicate IBAN says only that it is in use; it never returns the other employee's name, id, business
  or branch, and it is only reachable by a caller who already holds the full read and manage for this employee.
- A holder of the salary read without `manage:employees:business` cannot reach the employee editor (spec 021 SS-Q2
  limitation, inherited; employee visibility is not widened).
- The `staff` feature switched off: the routes answer like a disabled feature after the access check (spec 021).
- The full IBAN and holder name never appear in technical logs, error details, idempotency storage or the audit log.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Holders of `read:salaries:business` + `manage:salaries:business` for the employee's business and every
  branch she is attached to MUST be able to set, replace or clear her IBAN with a mandatory reason (1–500 characters).
- **FR-002**: The system MUST normalise the IBAN and accept it only if its country is KW, SA, AE, BH, QA or OM, its
  length and BBAN shape match that country, and its ISO 13616 mod-97 check digits are valid.
- **FR-003**: Each IBAN MUST carry a bank chosen from the reference list of its country and an English holder name
  (1–100 characters after trim; Latin letters, spaces, `.`, `'`, `-`). A bank whose known code differs from the
  IBAN's bank code is refused.
- **FR-004**: Holders of `read:salaries:business` MUST see the full IBAN, bank and holder name; holders of
  `manage:employees:business` without it MUST receive only the status and the last 4 characters. Masking happens on
  the server.
- **FR-005**: Every effective change (set, replace, clear) MUST write one history entry and one audit entry in the same
  transaction; a no-change save writes neither.
- **FR-006**: Concurrent edits MUST be detected by revision; a stale revision is a conflict.
- **FR-007**: Every past entry MUST be kept, never updated or deleted, and listed newest first to full-read holders.
- **FR-008**: An IBAN MUST NOT be the current IBAN of two non-deleted employees of the same company.
- **FR-009**: The full IBAN and holder name MUST NOT be written to technical logs or error details, at any depth.
- **FR-010**: Nothing of another business or company is ever visible or writable.
- **FR-011**: The admin employee record MUST show the IBAN section (masked or full), the history for full readers, and
  the edit form (with bank pre-selection) only for managers of the salary.

### Key Entities

- **Employee IBAN entry**: one revision of an employee's bank details — IBAN, bank, English holder name (all three
  absent when the entry clears the IBAN), who set it, when, the reason and the revision number. Immutable.
- **GCC bank (reference data)**: country, a stable id, the bank code as it appears inside the IBAN (when known), and
  the bank's English and Arabic names. Maintained in code; no admin screen.
- **Employee** (existing, spec 013/017): referenced; not changed.

## Slice design *(mandatory — `CLAUDE.md` §1)*

### Business rules

- **BR-001 (format)**: after normalisation an IBAN is the country code + 2 check digits + a BBAN of the registry
  shape: KW 30 = `4!a22!c`; SA 24 = `2!n18!c`; AE 23 = `3!n16!n`; BH 22 = `4!a14!c`; QA 29 = `4!a21!c`;
  OM 23 = `3!n16!c`. Example: the registry's Kuwait example `KW81 CBKU 0000 0000 0000 1234 5601 01` normalises to
  `KW81CBKU0000000000001234560101` and is valid.
- **BR-002 (checksum)**: move the first 4 characters to the end, map A–Z to 10–35, and the number mod 97 MUST equal 1
  (ISO 7064 MOD 97-10), computed digit by digit on the string. Changing the last character of the example to `2`
  gives 28 → `IBAN_CHECKSUM_INVALID`.
- **BR-003 (bank code)**: the bank code is the first 4 letters of the BBAN for KW/BH/QA, the first 2 digits for SA,
  the first 3 digits for AE/OM. If the reference list knows the code, the form pre-selects that bank and the server
  refuses any other bank; if it does not, any bank of the same country (or "Other bank") is accepted.
- **BR-004 (mask)**: masked form = last 4 characters of the normalised IBAN, shown as `•••• 0101`.
- **BR-005 (revision)**: first entry is revision 1; every effective change adds 1; saving the current values (same
  IBAN, bank and holder name; or clearing when already clear) is a no-op.
- **BR-006 (uniqueness)**: at commit, no other non-deleted employee of the company has the same IBAN as her latest
  entry.
- **BR-007 (holder name)**: trimmed, inner whitespace collapsed to one space, 1–100 characters,
  `^[A-Za-z][A-Za-z .'-]*$`. English only (decision IB-Q2: the bank format carries the English name; no Arabic holder
  name is stored — the employee's Arabic name already lives on her record).

### Technical decisions (orchestrator)

- **TD-1 — Own table, not a column on `employees`** (keeps the IBAN out of every existing employee read, the
  `update-employee` audit snapshot and import; no collision with row 8b).
- **TD-2 — IBAN validation and the GCC bank list in `packages/domain`** (`iban.ts`, `gcc-banks.ts`): an IBAN is a
  value type like `Money`, pure and dependency-free, used by `staff/domain` (entry rules), by the API, and by the admin
  form for bank pre-selection and an instant format hint — the same function on both sides, as pricing is. The admin
  app gains the workspace dependency `@pospay/domain` (internal package, not a new library).
- **TD-3 — No `Idempotency-Key`, optimistic `expected_revision` instead** (no money/stock effect; same values are a
  no-op; nothing about the IBAN is stored in `idempotency_keys`). Locks follow `set-salary`: company → ordered
  memberships (`lockEmployeeSalaryAccess`) → employee `FOR UPDATE`. The company-row lock serialises every IBAN write
  in a company, which makes the BR-006 check-then-insert race-free; IB-12 proves it with two concurrent writers.
- **TD-4 — Audit holds no full IBAN and no holder name**: `entity 'employee_iban'`, entity id = the new entry id,
  before/after `{ entry_id, revision, iban_last4, bank_id, cleared }`, with no reason; the reason and full values
  stay only in the protected history row.
- **TD-5 — Log redaction** in `packages/observability/src/redaction.ts`: add `iban` and `holdername` to
  `SECRET_SUFFIXES` (covers `iban`, `employee_iban`, `holder_name_en`… in logs and audit snapshots; `iban_last4`
  survives). `sanitize` also replaces IBAN-shaped tokens of the six countries in free text. The Zod validation pipe's
  error `details` for these routes must not echo the received value. Tests in `leak-paths.spec.ts`.
- **TD-6 — Masking on the server**: the read query selects the full columns only when the in-transaction access check
  returned full read; otherwise only `right(iban, 4)`.
- **TD-7 — No encryption (IB-Q8), no event (nothing consumes it in Phase 1).**
- **TD-8 — Migration numbers** assigned at merge; main is at `0095`.

### Schema changes

| Table | Columns | RLS / grants | Indexes | Tenant-qualified FKs |
|---|---|---|---|---|
| `employee_ibans` (append-only history) | company_id uuid, id uuid, business_id uuid, employee_id uuid, revision integer, iban text NULL, bank_id text NULL, holder_name_en text NULL, set_by uuid, reason text, created_at timestamptz default now() | ENABLE + FORCE RLS; policies `FOR SELECT TO pospay_app USING (company_id = app_company_id())` and `FOR INSERT TO pospay_app WITH CHECK (company_id = app_company_id())`; `GRANT SELECT, INSERT` only — no UPDATE, no DELETE | PK (company_id, id); UNIQUE (company_id, employee_id, revision); (company_id, business_id); (set_by); (company_id, iban) WHERE iban IS NOT NULL | (company_id, business_id, employee_id) → employees (company_id, business_id, id); company_id → companies; set_by → user(id) |

CHECKs: `revision > 0`; all three of iban / bank_id / holder_name_en NULL together or NOT NULL together;
`iban ~ '^(KW[0-9]{2}[A-Z]{4}[A-Z0-9]{22}|SA[0-9]{4}[A-Z0-9]{18}|AE[0-9]{21}|BH[0-9]{2}[A-Z]{4}[A-Z0-9]{14}|QA[0-9]{2}[A-Z]{4}[A-Z0-9]{21}|OM[0-9]{5}[A-Z0-9]{16})$'`;
`bank_id ~ '^[a-z]{2}-[a-z0-9-]{1,40}$'`; `left(bank_id, 2) = lower(left(iban, 2))`; holder name 1–100 after trim;
reason 1–500 after trim. The mod-97 check and the bank list live in `packages/domain` (database backstop = shape).
Schema in a new `packages/db/schema/staff-ibans.ts`, exported from `schema/index.ts`; two migrations (table, RLS).

### API contract

- `GET /v1/businesses/{businessId}/employees/{employeeId}/iban` → 200 `EmployeeIbanView`
  `{ status: 'SET' | 'NOT_SET', iban_last4: string | null, iban: string | null, bank_id: string | null,
  holder_name_en: string | null, revision: int ≥ 0, set_at: instant | null, set_by: uuid | null,
  can_read_full: boolean, can_manage: boolean }` — `iban`, `bank_id`, `holder_name_en`, `set_by` are non-null only
  when `can_read_full`; `revision` and `set_at` are always given (needed for `expected_revision`).
- `GET …/iban/history?cursor&limit` → 200 `EmployeeIbanHistoryPage` `{ items: [{ revision, iban, bank_id,
  holder_name_en, cleared, set_at, set_by, reason }], next_cursor: int | null }`, cursor = revision descending,
  limit 1–100 default 20. Full-read holders only; others get the uniform 404.
- `PUT …/iban` → 200 `EmployeeIbanView`; body `SetEmployeeIbanInput` (strict) `{ iban: string (max 64) | null,
  bank_id: string (max 48) | null, holder_name_en: string (max 200) | null, reason: string trim 1–500,
  expected_revision: int ≥ 0 }`; the three nullable fields are all null (clear) or all strings. No
  `Idempotency-Key` (TD-3).
- Access, inside the transaction (spec 021 pattern): full read = `read:salaries:business` at the employee's primary
  and open branches (`readEmployeeSalaryAccess`); manage = full read + `manage:salaries:business`; masked read =
  `manage:employees:business` (`readEmployeeManagementAccess`). Each method: `@Authenticated()` +
  `SelectedCompanyGuard`; Device never; `staff` feature checked after access.
- Zod in `packages/contracts/src/staff/employee-iban.ts` + `employee-iban-openapi.ts`.
- Errors (ar/en in `packages/i18n`): `IBAN_FORMAT_INVALID` (400), `IBAN_COUNTRY_NOT_ALLOWED` (400),
  `IBAN_CHECKSUM_INVALID` (400), `IBAN_BANK_INVALID` (400), `IBAN_HOLDER_NAME_INVALID` (400),
  `EMPLOYEE_IBAN_ALREADY_USED` (409), `EMPLOYEE_IBAN_REVISION_CONFLICT` (409), `VALIDATION_FAILED` (400 — reason or
  shape), `NOT_FOUND` (404), `FEATURE_DISABLED`, `TRANSACTION_RETRY_REQUIRED`.

### Permissions

No new codes (IB-Q4 = A). Full read / manage reuse `read:salaries:business` / `manage:salaries:business` (owner by
default; grantable by personal ALLOW; no role bundle; Device never). Masked read = `manage:employees:business`.

### Events

- **Published**: none (TD-7). **Consumed**: none.

### The 200 ms rule

Locks, one employee read, one duplicate lookup on an index, one insert and one audit row in one tenant transaction;
reads are single-row or indexed cursor pages. Synchronous in `api`.

### Test plan

- **Domain unit**: `packages/domain/src/__tests__/iban.spec.ts` — normalisation, each country's length and BBAN shape
  (valid / ±1 length / wrong shape), non-GCC refused, registry examples valid, every single-digit change and
  adjacent digit swap refused, bank-code extraction, mask; `gcc-banks.spec.ts` — ids unique, country prefix, codes match
  the country's code shape. `apps/api/src/modules/staff/domain/__tests__/employee-iban.spec.ts` — holder-name rules,
  bank/country/code match, clear vs set shape, revision and no-op detection, reason bounds.
- **Integration** (`apps/api/src/modules/staff/__tests__/set-employee-iban.spec.ts`): `IB-01` first set + audit (no
  full IBAN or holder name anywhere in `audit_log`) · `IB-02` normalised storage · `IB-03` each invalid input → its
  named error, nothing saved · `IB-04` replace bumps revision · `IB-05` stale revision → 409 · `IB-06` no-op → no
  entry, no audit · `IB-07` masked reader gets last 4 only and the body holds no full IBAN, bank or holder name ·
  `IB-08` masked reader / no access / foreign tenant / foreign business / deleted employee → uniform 404 on read,
  history and write · `IB-09` feature off · `IB-10` clear, then clear again (no-op) · `IB-11` history page, cursor
  and limits · `IB-12` duplicate IBAN in another business of the company → 409 with no identity; after the other
  employee changes or is deleted → accepted; other company → accepted; two concurrent saves of one IBAN for two
  employees → exactly one succeeds · `IB-13` bank mismatch / unknown / other country.
- **RLS negative** (`apps/api/src/modules/staff/__tests__/employee-iban-rls.spec.ts`): cross-tenant read = 0 rows;
  cross-tenant insert rejected; FK to another tenant's / business's employee rejected; UPDATE and DELETE not granted;
  grant allowlist in `packages/db/src/__tests__/privileges.spec.ts`.
- **Queries**: result-shape test + `EXPLAIN ANALYZE` index assertion for the current-entry read, the history page and
  the duplicate lookup.
- **Logs**: leak-path tests — `iban` / `holder_name_en` keys at any depth, IBAN-shaped free text, validation details.
- **Admin UI**: section (masked vs full), form (bank pre-selection from the IBAN, clear action, reason), history table,
  hook — cache rules copied from salary (staleTime 0, refetch on open, removed on close and on 403/404), ar/en, RTL.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The owner records or changes an employee's bank details in under one minute from the employee's record.
- **SC-002**: 100% of IBANs with one mistyped digit or two swapped adjacent digits are refused before saving.
- **SC-003**: A person without the salary read never receives more than the last 4 characters of any IBAN — in any
  screen, response, log line or audit entry.
- **SC-004**: For every change the owner can tell who made it, when, why, and from what to what.
- **SC-005**: No IBAN is the current IBAN of two employees of one company, and no IBAN is visible across companies.

## Assumptions

- Admin is online (as the salary section). POS and staff apps do not show the IBAN in this PR.
- The GCC bank list is reference data in code; its names and the IBAN bank codes it knows are to be confirmed by the
  owner/partner. Codes are filled only where they equal the bank's SWIFT BIC prefix (KW, BH, QA) and are left empty
  (no pre-selection, no mismatch check) where not verified. Each country has an "Other bank" entry so an unlisted bank
  never blocks entry.
- Masked readers see neither the bank nor the holder name (both are bank details under the same restriction).
- `docs/security.md` named in the brief does not exist; security rules come from CLAUDE.md §8 and the constitution.
