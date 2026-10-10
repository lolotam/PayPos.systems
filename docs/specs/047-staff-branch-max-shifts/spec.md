# Feature Specification: Max shifts per day becomes a per-branch setting

**Feature Branch**: `feat/p1-16c2-branch-max-shifts`

**Created**: 2026-10-10

**Status**: Draft — owner questions MB-Q1 … MB-Q3 `PENDING` (`owner-questions.ar.md`). Not ready for `/speckit-plan`.

**Input**: User description: "staff-branch-max-shifts — Waleed changed MS-Q1 to the partner's pick «كل فرع لوحده»:
the maximum number of shifts starting on one day is set per branch, not per business. Range 1–4, default 3,
owner-only permission grantable by the owner, stored rows untouched, no minimum gap and the 20-copy cap stay."

**Phase 1 row**: 16c-2, builds on row 16c (spec `docs/specs/042-staff-max-shifts-setting/spec.md`, PR #143) and row 16
(spec `docs/specs/020-staff-schedules/spec.md`). Research: [research.md](research.md).

## Owner decisions already taken (binding — not asked again)

| Source | Decision |
|---|---|
| MS-Q1, changed by Waleed 2026-10-10 | **Each branch has its own number** («كل فرع لوحده») |
| MS-Q2 (2026-10-10) | Changing it is **owner only by default; the owner can grant it to any person** |
| MS-Q3 (2026-10-10) | Allowed values **1 … 4** |
| MS-Q4 (2026-10-10) | Lowering keeps stored rows; the limit applies only to days a save changes; a template with an excess day cannot be applied until fixed |
| MS-Q5 (2026-10-10) | No minimum gap between shifts |
| MS-Q6 (2026-10-10) | Apply-template cap stays 20 copies (speed-up in issue #145) |
| S020-SHIFTS (2026-10-09) | Default **3**; one shift at most 16 h; Eid stretches are consecutive shifts |

## Open owner questions

| ID | Topic | Status |
|---|---|---|
| MB-Q1 | Which limit applies when one employee works in two branches on the same day | PENDING |
| MB-Q2 | Keep a business-wide number with branch exceptions, or a number per branch only | PENDING |
| MB-Q3 | Which limit a business-wide template is checked against when it is saved | PENDING |

## User Scenarios & Testing *(mandatory)*

Example business: one salon with two branches, **Salmiya** and **Hawalli**. Sara is attached to both.

### User Story 1 — Each branch has its own number (Priority: P1)

Hawalli opens late and runs four short shifts on busy days; Salmiya runs two. The owner sets Hawalli to 4 and
Salmiya to 2.

**Why this priority**: it is the owner's changed decision; without it 16c's single number blocks Hawalli or loosens
Salmiya.

**Independent Test**: set two different numbers and save a week in each branch at its own limit.

**Acceptance Scenarios**:

1. **Given** Hawalli = 4, **When** a manager saves 4 Thursday shifts for Heba in Hawalli, **Then** the week is saved.
2. **Given** Salmiya = 2, **When** a manager saves 3 Thursday shifts for Heba in Salmiya, **Then** the save is refused
   with `SCHEDULE_DAY_LIMIT_EXCEEDED` naming the limit (2) and the day, and nothing is written.
3. **Given** a branch with no number of its own, **When** a week is saved, **Then** the limit used is
   `TODO(spec) → MB-Q2` (the business number, else 3 — or 3 / the copied value if the business number is retired).
4. **Given** the branch schedules page, **When** a day holds as many shifts as that branch's limit, **Then** "Add
   shift" is disabled; it follows the branch's effective number.

---

### User Story 2 — One employee, two branches, one day (Priority: P1)

Sara has two Thursday shifts in Hawalli (limit 4). The Salmiya manager (limit 2) adds an evening shift for her in
Salmiya.

**Why this priority**: 16c counted all her shifts of the day across branches against one number; with two numbers
the rule must be chosen (MB-Q1).

**Acceptance Scenarios**:

1. **Given** the situation above, **When** Salmiya saves the evening shift, **Then** the result is
   `TODO(spec) → MB-Q1`:
   - rule A (each branch counts its own shifts): accepted — Salmiya holds 1 ≤ 2;
   - rule B (all her shifts that day vs the saving branch's number): refused — 3 > 2;
   - rule C (all her shifts vs the smallest number of the branches she works in that day): refused — 3 > 2.
2. **Given** any rule, **When** the new shift overlaps a Hawalli shift, **Then** it is refused with
   `SCHEDULE_SHIFT_OVERLAP`, exactly as today (overlap is always checked across branches).
3. **Given** any rule, **When** two managers save concurrently, **Then** the company lock serializes them and the
   later save sees the earlier one.

---

### User Story 3 — The owner sets and resets a branch number (Priority: P1)

**Acceptance Scenarios**:

1. **Given** the owner, **When** they open the schedule settings of Hawalli, **Then** they see Hawalli's effective
   number and where it comes from (own number / business number / default).
2. **Given** the owner, **When** they set Hawalli to 4, **Then** one audit row records before/after with the branch
   and the actor, and the next Hawalli save allows 4.
3. **Given** a person without `manage:schedule-settings:business`, **When** they try, **Then** `NOT_FOUND` as for the
   other schedule routes, and nothing is written (MS-Q2).
4. **Given** 0, 5 or 2.5, **When** submitted, **Then** `VALIDATION_FAILED` (MS-Q3).
5. **Given** the same value as the current effective value from the same source, **When** submitted, **Then** no
   audit row is written.
6. **Given** MB-Q2 = business number with exceptions, **When** the owner clears Hawalli's own number, **Then**
   Hawalli follows the business number again and the clear is audited.

---

### User Story 4 — Templates and branch numbers (Priority: P2)

A business-wide template "Eid" has 4 shifts on Thursday; Salmiya = 2, Hawalli = 4.

**Acceptance Scenarios**:

1. **Given** that pattern, **When** the template is saved, **Then** the check uses `TODO(spec) → MB-Q3`.
2. **Given** the template saved, **When** it is applied to Salmiya, **Then** the apply is refused with
   `SCHEDULE_DAY_LIMIT_EXCEEDED` before any write; **when** applied to Hawalli, **Then** it succeeds.

---

### User Story 5 — Lowering a branch number (Priority: P2)

MS-Q4 applies per branch: after the owner lowers Hawalli from 4 to 3, stored Hawalli weeks with 4 shifts on a day
are untouched; editing another day succeeds; changing the excess day is refused while it still holds 4.

### Edge Cases

- Overnight and Friday→Saturday shifts count on their **start** day in the branch they belong to (spec 020, unchanged).
- A deactivated branch keeps its stored number; it is not shown and not used (no schedule can be saved there).
- A branch moved between businesses is not possible (branches are fixed to one business).
- Concurrent "owner lowers Salmiya" and "manager saves a 3rd Salmiya shift" are serialized by the company lock.
- Apply-template at the maximum (20 copies × 28 shifts) stays within FR-013 of spec 042; one extra indexed lookup.
- An unknown or inaccessible branch returns the same `NOT_FOUND` as other schedule routes.
- The 16 h cap, overlap exclusion, past-day reason and break rules (spec 041) are unchanged.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every active branch MUST have an effective "max shifts starting on one day" number in 1 … 4.
  Its source when the branch has no own number: `TODO(spec) → MB-Q2`.
- **FR-002**: The count on a schedule save MUST follow `TODO(spec) → MB-Q1` (branch-only count, all-branches count
  vs the saving branch, or all-branches count vs the smallest number).
- **FR-003**: A refused save MUST return `SCHEDULE_DAY_LIMIT_EXCEEDED` with
  `details: { max_shifts_per_day, working_dates }` and write nothing (unchanged code and shape).
- **FR-004**: Template apply MUST check each new copy against the **target branch's** effective number, before any write.
- **FR-005**: Template create/update MUST check its pattern against `TODO(spec) → MB-Q3`; on update only changed days
  are checked (MS-Q4).
- **FR-006**: Changing or clearing a branch number MUST NOT rewrite any stored schedule or template (MS-Q4).
- **FR-007**: Only holders of `manage:schedule-settings:business` MUST be able to read the settings screen and change
  any branch's number; owner by default; personal grants only by the company owner; never a device role (MS-Q2).
- **FR-008**: Every actual change (set, change, clear) MUST write one audit row in the same transaction (before,
  after, branch, actor). A no-op writes nothing.
- **FR-009**: The branch schedule grid MUST carry the branch's effective number; the admin "Add shift" control
  follows it. The template page carries the number used by FR-005.
- **FR-010**: The 16 h cap, no minimum gap (MS-Q5) and the 20-copy cap (MS-Q6) MUST stay unchanged.
- **FR-011**: The POS and offline flows MUST NOT change.

### Key Entities

- **Branch schedule settings** (new): one record per branch that has its own number: the number, who changed it, when.
- **Business schedule settings** (16c): kept as the business number or retired — `TODO(spec) → MB-Q2`.

## Slice design *(mandatory — `CLAUDE.md` §1)*

### Chosen design (technical, no owner question)

- **TD-1 Storage.** New staff-owned table `staff_branch_schedule_settings`, read inside the schedule transaction
  through `ScheduleScope`. No new import arrow, no ADR (same reasoning as spec 042 TD-1).
- **TD-2 Effective value.** One domain function `effectiveMaxShiftsPerDay(branchValue, businessValue)` →
  branch ?? business ?? 3 (MB-Q2 A) or branch ?? 3 (MB-Q2 B). The SQL reads (grid, settings list) use the same
  `COALESCE` order; a query test pins it against the domain function's cases.
- **TD-3 Serialization.** Unchanged from spec 042 TD-2: `companies FOR NO KEY UPDATE` first, then the settings row;
  schedule writes read the limit after their locks.
- **TD-4 Counting.** `validateScheduleOverlap` receives the saving branch and (for rule C) the per-branch numbers;
  under rule A `others` is filtered to the saving branch for the **count only**; overlap uses all `others`.
- **TD-5 Errors.** No new error code. `SCHEDULE_DAY_LIMIT_EXCEEDED` keeps its details.

### Business rules

- **BR-001** (MS-Q1 changed): the number belongs to the branch. Example: Hawalli 4, Salmiya 2.
- **BR-002**: fallback when a branch has no own number → `TODO(spec) → MB-Q2`.
- **BR-003**: cross-branch count → `TODO(spec) → MB-Q1`.
- **BR-004**: template save check → `TODO(spec) → MB-Q3`; apply uses the target branch.
- **BR-005** (MS-Q3/Q4/Q5/Q6, S020-SHIFTS): range 1 … 4, changed days only, no gap, 20-copy cap, 16 h, default 3.

### Schema changes (expand only under MB-Q2 A)

| Table | Columns | RLS | Indexes | Tenant-qualified FKs |
|---|---|---|---|---|
| `staff_branch_schedule_settings` (new) | `company_id uuid NOT NULL`, `business_id uuid NOT NULL`, `branch_id uuid NOT NULL`, `max_shifts_per_day smallint NOT NULL CHECK (BETWEEN 1 AND 4)`, `updated_by uuid NOT NULL`, `updated_at timestamptz NOT NULL`; PK `(company_id, branch_id)` | ENABLE + FORCE; `SELECT`, `INSERT`, `UPDATE`, and `DELETE` (MB-Q2 A only) for `pospay_app` on `company_id = app_company_id()` | PK; `(company_id, business_id)` for the per-business list; `(updated_by)` | `(company_id, business_id, branch_id) → branches(company_id, business_id, id)`; `updated_by → user(id)` |
| `staff_schedule_settings` (16c) | unchanged under MB-Q2 A; under MB-Q2 B: data step copies to every branch (ADR-0038 marker), contract drop in a later release | unchanged | — | — |

Grants: `SELECT, INSERT`, `UPDATE (max_shifts_per_day, updated_by, updated_at)`, and `DELETE` (MB-Q2 A) to
`pospay_app`; `packages/db/src/__tests__/privileges.spec.ts` allowlist updated. Migration numbers: the next free
numbers after 26a–26c (they own 0111+), renumbered at merge.

### API contract

- `GET /v1/businesses/{businessId}/schedule-settings` (existing, same guard) gains
  `branches: [{ branch_id, name_en, name_ar, max_shifts_per_day, source: 'branch'|'business'|'default', updated_at }]`
  (additive). Its business fields stay under MB-Q2 A.
- `PUT /v1/businesses/{businessId}/branches/{branchId}/schedule-settings` · `@Require('manage:schedule-settings:business')`
  · feature `staff` · body `SetScheduleSettingsInput { max_shifts_per_day: int 1 … 4 }` →
  `BranchScheduleSettings { branch_id, max_shifts_per_day, source, updated_at }`.
- `DELETE` on the same path (MB-Q2 A only) → `BranchScheduleSettings` with `source` business/default.
- `ScheduleGrid.max_shifts_per_day`: the branch's effective number. `TemplatePage.max_shifts_per_day`: per MB-Q3.
- Zod in `packages/contracts/src/staff/schedule-settings.ts` + OpenAPI registration.
- `Idempotency-Key`: not required (no money/stock effect; repeating is a no-op).
- Errors: `VALIDATION_FAILED`, `NOT_FOUND`, `FORBIDDEN`, `FEATURE_DISABLED`; schedule routes keep
  `SCHEDULE_DAY_LIMIT_EXCEEDED`.

### Permissions

- Unchanged `manage:schedule-settings:business` (MS-Q2): owner by default, owner-granted, never a device; one grant
  covers every branch of the business. No migration of permissions.

### Events

- None published or consumed; the audit row (entity `staff_branch_schedule_settings`) is the record.

### Admin UI

- Branch schedules page: the settings panel shows this branch's number and its source, an input to set it and
  (MB-Q2 A) "use the business number"; a read-only list of all branches' numbers. ar/en strings in `packages/i18n`.

### Test plan

- **Domain unit**: effective value (branch / business / default); count rule per MB-Q1 with Sara's two-branch case;
  overnight and Friday→Saturday on start day in their branch; changed-days only; template check per MB-Q3; range.
- **Integration** (T2 Postgres, one cloned DB per spec file): `MB-01` two branches with 2 and 4 ·
  `MB-02` branch without own number uses the fallback · `MB-03` Sara two-branch day per MB-Q1 ·
  `MB-04` set/change/clear audited, no-op not audited · `MB-05` non-holder `NOT_FOUND`, owner-granted person allowed,
  device refused · `MB-06` lowering a branch keeps stored rows, changed-day refused · `MB-07` template apply refused
  in the lower branch, accepted in the higher, before any write · `MB-08` concurrent lower vs save serialized ·
  `MB-09` out-of-range refused.
- **RLS negative**: `staff_branch_schedule_settings` cross-tenant read = 0 rows; insert/update/delete with another
  `company_id` rejected; FK to another tenant's branch rejected; FK to a branch of another business rejected.
- **Queries**: settings list and grid result-shape tests include the branch value and source; `EXPLAIN ANALYZE`
  asserts PK lookup for the grid and `(company_id, business_id)` for the list.
- **Performance**: apply-template 20 × 28 re-measured against 200 ms (spec 042 FR-013); result in the PR.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The owner can give two branches different numbers in under one minute each, and the next save in each
  branch follows its own number immediately.
- **SC-002**: No stored schedule or template is changed or lost by any settings change.
- **SC-003**: 100 % of branch-number changes and clears appear in the audit log with who, which branch and when.
- **SC-004**: A manager sees, before saving, how many shifts the branch allows ("Add shift" disabled at the limit).

## Assumptions

- Staging is the only database with data; the salon trial (row 63) has not started.
- The permission stays business-wide (MS-Q2): a holder manages every branch of the business.
- Overlap is always checked across all branches, whatever MB-Q1 decides — it is a physical rule, not a count.
- Attendance, hours, commission and the POS are unchanged (spec 042 Assumptions).
- Row 16d (spec 048) changes the same grid query and admin editor; the two land one after the other (research R8).
