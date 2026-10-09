# Feature Specification: Duplicate-name warning on create / update employee

**Feature Branch**: `feat/p1-08b-duplicate-name-warning`

**Created**: 2026-10-09

**Status**: Owner questions DN-Q1 … DN-Q8 **answered 2026-10-09** (Waleed, binding; partner Abu Salem chose the same).
Ready for `/speckit-plan`.

**Input**: Phase 1 plan row **8b** (`docs/specs/phase-1/IMPLEMENTATION-PLAN.md`): "duplicate-name warning on create /
update employee: a soft 'same name exists, add the full four-part name?' prompt, never a block". Depends on rows 8
(spec 013, create-employee) and 9 (spec 017, update-employee). Source decision: owner review 2026-10-09,
`docs/specs/phase-1/owner-review-2026-10-09.ar.md` item **CE-Q-NAMES**.

## Owner decision already taken (2026-10-09)

- **CE-Q-NAMES (final):** "تنبيه مش منع" — when a manager adds **or edits** an employee whose name already exists,
  the screen shows "an employee with the same name exists — add the full four-part name?" and the manager can
  continue normally.
- The original rule of spec 013 / 017 stays: **duplicate names are allowed, including within the same business.**
  The server never refuses a create or an update because of a name. This slice adds no refusal and no error code.

## Owner questions (answered 2026-10-09 — see `owner-questions.ar.md`)

Waleed chose the recommended option (A) for every question; this is binding. The partner Abu Salem (محمد العنزي)
chose the same. His note on DN-Q1, «المفترض العميل يكون موجود في جميع الافراع تلقائي», is about **customers**, not
employees; it is recorded in `owner-questions.ar.md` and does not change this slice.

- **DN-Q1 — Where to look for a same-name employee.** Decided (A): every branch of the **same business**.
  Alternatives: whole company (all businesses); same branch only.
- **DN-Q2 — Which name is compared.** Decided (A): warn when the Arabic name matches an existing Arabic name **or**
  the English name matches an existing English name. Alternatives: English only; both must match.
- **DN-Q3 — How "the same" is decided.** Decided (A): identical after tidying — extra spaces, letter case, Arabic
  diacritics and tatweel removed, and the letter variants أ/إ/آ/ٱ→ا, ة→ه, ى→ي treated as one. Alternatives: spaces and
  case only (سارة ≠ ساره); also warn when one full name begins with the other (سارة vs سارة أحمد).
- **DN-Q4 — Whose names count.** Decided (A): every employee record still on file, including those whose contract
  has ended; records removed (soft-deleted) never count. Alternative: only employees whose contract has not ended.
- **DN-Q5 — What the warning shows.** Decided (A): for each matching employee the manager may see — the name in
  both languages, primary branch and role; for a match in a branch the manager may not see, only "another employee
  with this name exists in a branch you cannot see", without details. Alternatives: a plain message with no list;
  full details even outside the manager's branches (not recommended — leaks staff data across branches).
- **DN-Q6 — Warning on edit.** Decided (A): only when a name field was changed, and never against the employee's
  own record. Alternative: on every save of the edit form.
- **DN-Q7 — Recording "continue anyway".** Decided (A): not recorded; the normal create/update audit already keeps
  the saved names. Alternative: add a "saved despite duplicate-name warning" flag to the audit entry.
- **DN-Q8 — Employee import (row 11, spec 030).** Decided (A): not in this PR; a later plan row if wanted.
  Alternative: the import preview also lists rows whose name already exists.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Warned before creating a same-name employee (Priority: P1)

A manager registers "سارة" while another "سارة" already works in the salon. Before the record is saved the screen
says an employee with the same name exists, lists her (per DN-Q5), and suggests writing the full four-part name.
The manager either goes back and edits the name, or chooses "save anyway" and the employee is created exactly as
today.

**Why this priority**: it is the owner's whole request — fewer look-alike records in commissions, attendance and
salary screens, without ever stopping the salon from registering a real second Sara.

**Independent Test**: with one employee "سارة" in the business, submit a new "سارة"; the warning appears; "save
anyway" creates the second record; "edit name" keeps the form open with the typed values.

**Acceptance Scenarios**:

1. **DN-01** — **Given** "Sara Ahmed / سارة أحمد" exists in the business, **When** the manager submits a new employee
   with the same name, **Then** the warning appears before saving and nothing is saved yet.
2. **DN-02** — **Given** the warning is shown, **When** the manager chooses "save anyway", **Then** the employee is
   created with the typed names, exactly as create-employee does today (one employee, one attachment, one audit).
3. **DN-03** — **Given** the warning is shown, **When** the manager chooses "edit name", **Then** nothing is saved,
   the form keeps every typed value and the Arabic name field is focused.
4. **DN-04** — **Given** no employee matches, **When** the manager submits, **Then** the employee is saved with no
   extra step.
5. **DN-05** — **Given** "Heba / هبة" exists, **When** the manager types "  heba " or "هبه" (per DN-Q3), **Then** the
   warning appears.

### User Story 2 — Warned when renaming to an existing name (Priority: P2)

A manager edits "سارة محمد" and shortens it to "سارة" while another "سارة" exists. The same warning appears before
the save (per DN-Q6). Re-saving an employee whose name did not change never warns about herself.

**Independent Test**: edit an employee's name to match another employee → warning; edit only her hire date → no
warning; save her unchanged name → no warning about her own record.

**Acceptance Scenarios**:

1. **DN-06** — **Given** two employees "سارة" and "سارة محمد", **When** the second is renamed "سارة", **Then** the
   warning lists the first, never the employee being edited.
2. **DN-07** — **Given** the warning is shown on edit, **When** the manager chooses "save anyway", **Then** the update
   is saved exactly as update-employee does today, including revision and branch history rules.
3. **DN-08** — **Given** only non-name fields changed, **When** the manager saves, **Then** no name check runs (DN-Q6 A).

### User Story 3 — The warning never leaks or blocks (Priority: P1)

The check is advisory. It cannot reveal employees of another company or business, cannot reveal details of branches
the manager is not allowed to see, and if it cannot run (network, server busy) the save still proceeds as today.

**Acceptance Scenarios**:

1. **DN-09** — a same-name employee in another company, or in another business of the same company (DN-Q1 A), never
   triggers the warning.
2. **DN-10** — a same-name employee only in a branch the manager cannot see shows the detail-free line (DN-Q5 A).
3. **DN-11** — without `manage:employees:business` the check is refused like create; with the staff feature disabled it
   returns FEATURE_DISABLED.
4. **DN-12** — if the check fails, the form saves anyway and shows no warning (the warning is never a gate).
5. **DN-13** — a direct API create or update with a duplicate name still succeeds (spec 013 CE-08, spec 017 UE-03).

### Edge Cases

- Only the English name typed (Arabic empty): only English is compared (DN-Q2 A); an empty Arabic name never matches
  another empty Arabic name.
- Arabic text typed into the English field (or the reverse): compared only against the same field (DN-Q2 A).
- Many matches (e.g. ten "Fatima"): the list shows at most 10 and a count of the rest.
- Two managers create the same name at the same moment: neither may see a warning. Accepted — the rule is a warning,
  not a uniqueness constraint.
- A soft-deleted employee never matches (DN-Q4). An employee whose contract ended matches (DN-Q4 A).
- An employee being edited never matches herself, even if her name is unchanged.
- Name with diacritics "سَارَة" or tatweel "ســارة" matches "سارة" (DN-Q3 A).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Before a create or a name-changing update is sent, the admin form MUST ask the server for same-name
  employees in the scope set by DN-Q1, comparing the fields set by DN-Q2 under the matching rule of DN-Q3, over the
  records set by DN-Q4 (all decided A: same business; Arabic↔Arabic or English↔English; normalised exact match;
  every record with `deleted_at IS NULL`).
- **FR-002**: When there is at least one match, the form MUST show a warning in the user's language suggesting the full
  four-part name, with "edit name" and "save anyway"; content per DN-Q5 A (details for visible employees, one
  detail-free line for the rest).
- **FR-003**: "Save anyway" MUST send exactly the terms the manager typed, through the existing create / update
  endpoints, unchanged.
- **FR-004**: The server MUST NOT refuse, delay or alter any create or update because of a duplicate name.
- **FR-005**: On edit, the check MUST exclude the employee being edited and run only when a name field changed
  (DN-Q6 A).
- **FR-006**: The check MUST be read-only, tenant- and business-scoped, guarded by the same permission and staff
  feature as create, and MUST NOT reveal any field of an employee outside the manager's visible branches.
- **FR-007**: A failed check MUST NOT stop the save.
- **FR-008**: "Save anyway" is not recorded beyond the normal create/update audit (DN-Q7 A); no write-path change.
- **FR-009**: Employee import is unchanged (DN-Q8 A).

### Key Entities

- **Employee** (existing, spec 013/017): `name_en` (required), `name_ar` (optional), primary branch, active branch
  attachments, `contract_end`, `deleted_at`. No new entity and no new column.
- **Name match** (read projection only): an employee whose name equals the typed name under the DN-Q3 rule.

## Slice design *(mandatory — `CLAUDE.md` §1)*

### Chosen design — a read-only `queries/` check called by the form before submit

The write path does not change. Create (`POST .../employees`) and update (`PATCH .../employees/{id}`) keep their
contracts, use cases, audits and errors. A new read endpoint in `queries/` returns the matches; the admin form calls it
on submit and shows the warning; "save anyway" calls the unchanged write. Reasons:

- `CLAUDE.md` §6: reads go through `queries/`, never through a use case; a warning is a read.
- Returning a warning from the write would turn a 201/200 into a two-step protocol (or a "force" flag) on two existing
  use cases, i.e. touch two use cases in one PR (`CLAUDE.md` §1) and change their audited contracts — for no rule
  the server must enforce, since the owner decided "never a block".
- The check is advisory, so a race between check and save is acceptable (Edge Cases).

Rejected alternative: a `warnings[]` field in the create/update response — the record is already saved when the
warning arrives, so "edit name" would need a second update and a second audit row.

### Business rules

- **BR-001**: duplicate names are allowed (spec 013 CE-08, spec 017 UE-03); this slice never refuses on a name.
- **BR-002**: scope of the search (DN-Q1 A): `company_id` + `business_id` of the request — every branch of the business.
- **BR-003**: compared fields (DN-Q2 A): `name_ar` vs `name_ar` (only when both are non-null) OR `name_en` vs `name_en`.
- **BR-004**: matching key (DN-Q3 A), applied identically to the stored and the typed name:
  Unicode NFKC → remove Arabic diacritics (U+064B–U+0652, U+0670) and tatweel (U+0640) → fold أ إ آ ٱ → ا, ة → ه,
  ى → ي → lower-case → collapse every run of whitespace to one space → trim. Exact equality of keys; no partial match.
  Example: "  سَـارة " and "ساره" both give the key "ساره"; "Sara  AHMED" and "sara ahmed" give "sara ahmed".
- **BR-005**: records searched (DN-Q4 A): `deleted_at IS NULL`, regardless of `contract_end`.
- **BR-006**: details returned (DN-Q5 A): details only for employees whose primary branch and
  every open attachment are inside the caller's allowed branches (the exact visibility filter of
  `list-employees.query.ts`); others are only counted in `hidden_count`.
- **BR-007**: on edit, `exclude_employee_id` removes the edited employee; the form calls the check only when
  `name_ar` or `name_en` differs from the loaded record after trimming (DN-Q6 A).
- **BR-008**: at most 10 visible matches are returned, ordered by English name then id; `visible_total` gives the
  full visible count.

### Schema changes

None. No table, column, RLS policy, grant or migration. The query filters `employees` on
`(company_id, business_id)` and is served by the existing index `employees_company_business_id_idx`; the name key is
computed per row of one business (a salon business holds tens to a few hundred employees).
A later expression index on the name key is only needed if the EXPLAIN check shows a business above ~5,000 employees;
not in this slice.

### API contract

- **Endpoint**: `POST /v1/businesses/{businessId}/employees/name-matches` → **200** `EmployeeNameMatches`.
  A read with a body, not a write: the names stay out of the URL, so they never reach the shared reverse-proxy access
  logs or any URL-based logging (TD-1 below). Declared in the existing `EmployeesController` before the
  `:employeeId` routes (static segment; the router prefers it over the parametric one — covered by a test).
- **Guards**: `@Authenticated()` + `SelectedCompanyGuard`; inside `withTenant`, `EmployeeDetailAccess.listScope`
  (existing port next to the queries) decides: no allowed branch → `FORBIDDEN` (same refusal as create without
  `manage:employees:business`); feature off → `FEATURE_DISABLED`. No new permission.
- **Request** (Zod, `packages/contracts/src/staff/employee-name-matches.ts`, strict):
  `{ name_en: nameEn, name_ar: nameAr.nullable().optional(), exclude_employee_id: employeeInputId.optional() }`.
- **Response**: `{ matches: Array<{ id, name_en, name_ar|null, primary_branch_id, role_code }> (max 10),
  visible_total: int ≥ 0, hidden_count: int ≥ 0 }` — `meta({ id: 'EmployeeNameMatches' })`.
- **Idempotency-Key**: not required — no write, no money or stock effect.
- **Errors**: standard `VALIDATION_FAILED` (400), `FORBIDDEN` (403), `FEATURE_DISABLED`, `NOT_READY`. No new code.
- **OpenAPI**: path added in `packages/contracts/src/staff/staff-openapi.ts`; `pnpm contracts:openapi`; both generated
  clients (`apps/admin/src/shared/api/schema.d.ts`, `apps/pos/src/shared/api/schema.d.ts`) regenerated.
- **Unchanged**: `POST /v1/businesses/{businessId}/employees`, `PATCH /v1/businesses/{businessId}/employees/{id}`.

### Admin UI

- New `apps/admin/src/staff/api/use-employee-name-matches.ts` (TanStack `useMutation` over the generated client).
- New `apps/admin/src/staff/ui/duplicate-name-warning.tsx`: `role="alert"`, the i18n message, the match list with
  branch names resolved from the workspace branches, "edit name" and "save anyway" buttons; logical properties only.
- New `apps/admin/src/staff/model/use-name-checked-submit.ts`: wraps a form's `onSave` — runs the check, holds the
  pending terms while the warning is open, saves directly when there is no match or the check fails.
- `create-employee-form.tsx`, `edit-employee-form.tsx`: render the warning and route submit through the wrapper.
  `create-employee-page.tsx`, `employee-edit-panel.tsx`: pass `companyId` / `businessId` to the wrapper.
- i18n keys in `packages/i18n/src/en.ts` and `ar.ts` under `staff`: `duplicateNameTitle`, `duplicateNameLead`
  ("An employee with the same name exists. Add the full four-part name?" / «فيه موظفة بنفس الاسم، ضيف الاسم
  الرباعي؟»), `duplicateNameHidden`, `duplicateNameMore`, `duplicateNameEdit`, `duplicateNameSaveAnyway`.

### Permissions

- `manage:employees:business` (existing) — the same check as create/update; branch ALLOW works, DENY wins (through
  `listScope`). Staff feature required. No new permission code, no default-grant change.

### Events

- **Published**: none. **Consumed**: none.

### Test plan

- **Domain unit**: none — no `domain/` function (the name key is SQL inside the query; `queries/` may not import
  `domain/`). The key's cases are covered by the query integration test below.
- **Contracts**: strict input (unknown keys refused, trimmed names, 255 limit, lower-cased exclude id), response shape.
- **Query integration** (`apps/api/src/modules/staff/__tests__/employee-name-matches.spec.ts`, T2 Postgres, cloned DB):
  DN-01, DN-05 (spaces, case, ة/ه, أ/إ/آ/ٱ, ى/ي, diacritics, tatweel), DN-06 (exclude self), DN-09 (other company,
  other business → 0), DN-10 (hidden branch → `hidden_count` only, no id/name), DN-04 (no match), soft-deleted excluded,
  ended contract included (DN-Q4 A), Arabic null never matches null, limit 10 + `visible_total`.
- **Result shape + EXPLAIN ANALYZE**: exact projection; plan uses `employees_company_business_id_idx`.
- **HTTP**: DN-11 (no grant → 403, branch-only ALLOW works, branch DENY hides, feature off), validation, static route
  does not collide with `GET /employees/{employeeId}`, DN-13 (duplicate create/update via API still 201/200).
- **RLS negative**: no new table; the existing `rls-employees.spec.ts` covers `employees`. The integration test
  asserts another tenant's same-name employee is never returned under `withTenant`.
- **Admin UI** (Vitest + Testing Library): DN-02, DN-03 (values kept, Arabic field focused), DN-04, DN-07, DN-08,
  DN-12 (check error → saved), bilingual text, RTL rendering, workspace switch clears a pending warning.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 100 % of saves where a same-name employee exists in scope, the manager sees the warning before the
  record is saved.
- **SC-002**: 0 creates or updates are refused because of a name; "save anyway" saves on the first click.
- **SC-003**: The warning appears within one second of pressing save on a normal connection.
- **SC-004**: 0 details of employees outside the manager's company, business or visible branches are shown.

## Technical decision taken without an owner question

- **TD-1 — POST for a read.** Employee names are personal data. Sending them as a GET query string would place them in
  URLs, which the shared Traefik access log and browser/proxy tooling may record. The check is therefore a `POST`
  with a JSON body that writes nothing, lives in `queries/`, and returns 200. Reviewers may prefer `GET` with query
  parameters; that changes only the transport, not the rules.

## Assumptions

- The warning is shown when the manager presses save, not while typing (fewer calls; no flicker in RTL inputs).
- The admin is online (spec 013/017); the POS has no employee form, so only `apps/admin` changes.
- A check that fails or times out lets the save continue (FR-007); the owner rule is "never a block".
- The match list resolves branch names from the workspace already loaded on the page; no extra branch read.
- No new dependency, no ADR (no new library, no new module arrow, no schema change).
