# Feature Specification: Max shifts per day becomes a per-branch setting

**Feature Branch**: `feat/p1-16c2-branch-max-shifts`

**Created**: 2026-10-10

**Status**: Ready — owner answered MB-Q1 … MB-Q3 on 2026-10-10 (batch 8, `owner-questions.ar.md`), all the
recommended option. The partner has not answered yet; Waleed ruled that **if the partner's pick differs, the
partner's pick wins**, and work proceeds on Waleed's picks until then.

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

## Owner answers (Waleed, 2026-10-10 — provisional until the partner answers; his pick wins on a difference)

| ID | Question | Decision |
|---|---|---|
| MB-Q1 | One employee in two branches on one day | **Each branch counts only its own shifts** against its own number |
| MB-Q2 | Business number vs branch only | **The business number stays; any branch may have its own number**; a branch without one uses the business number (else 3); clearing a branch's number returns it to the business number |
| MB-Q3 | Template check on save | **Saved if it fits at least one branch** (the largest effective number in the business); apply checks the target branch and refuses before any write |

## User Scenarios & Testing *(mandatory)*

Example business: one salon with two branches, **Salmiya** and **Hawalli**, plus a new branch **Fahaheel**. The
business number is 3. Sara is attached to Salmiya and Hawalli.

### User Story 1 — Each branch has its own number (Priority: P1)

The owner sets Hawalli to 4 and Salmiya to 2; Fahaheel has no number of its own.

**Why this priority**: it is the owner's changed decision.

**Independent Test**: set two different numbers and save a week in each branch at its own limit.

**Acceptance Scenarios**:

1. **Given** Hawalli = 4, **When** a manager saves 4 Thursday shifts for Heba in Hawalli, **Then** the week is saved.
2. **Given** Salmiya = 2, **When** a manager saves 3 Thursday shifts for Heba in Salmiya, **Then** the save is refused
   with `SCHEDULE_DAY_LIMIT_EXCEEDED` naming the limit (2) and the day, and nothing is written.
3. **Given** Fahaheel without its own number and the business number 3, **When** a week is saved there, **Then** the
   limit is 3; with no business row either, the limit is 3 (MB-Q2).
4. **Given** the branch schedules page, **When** a day holds as many shifts as that branch's effective number, **Then**
   "Add shift" is disabled.

---

### User Story 2 — One employee, two branches, one day (Priority: P1)

Sara has two Thursday shifts in Hawalli (4). The Salmiya manager (2) adds an evening shift for her in Salmiya.

**Acceptance Scenarios** (MB-Q1):

1. **Given** the situation above, **When** Salmiya saves the evening shift, **Then** it is accepted — Salmiya counts only
   its own Thursday shifts for Sara (1 ≤ 2). Her total that day is 3.
2. **Given** Sara already has 2 Thursday shifts in Salmiya, **When** a 3rd Salmiya shift is saved, **Then** it is
   refused, whatever she has in Hawalli.
3. **Given** any case, **When** the new shift overlaps a Hawalli shift, **Then** `SCHEDULE_SHIFT_OVERLAP`, exactly as
   today (overlap is always checked across all branches).
4. **Given** two managers saving concurrently, **Then** the company lock serializes them.

---

### User Story 3 — The owner sets and clears a branch number (Priority: P1)

**Acceptance Scenarios**:

1. **Given** the owner, **When** they open the schedule settings on the Hawalli page, **Then** they see the business
   number, Hawalli's effective number and its source (own / business / default), and every active branch's effective
   number.
2. **Given** the owner, **When** they set Hawalli to 4, **Then** one audit row records before/after with the branch and
   actor, and the next Hawalli save allows 4.
3. **Given** the owner, **When** they clear Hawalli's own number, **Then** Hawalli follows the business number again
   and the clear is audited (MB-Q2).
4. **Given** a person without `manage:schedule-settings:business`, **When** they try, **Then** `NOT_FOUND` as for the
   other schedule routes, and nothing is written (MS-Q2).
5. **Given** 0, 5 or 2.5, **When** submitted, **Then** `VALIDATION_FAILED` (MS-Q3).
6. **Given** the same value as the branch's own stored number, or a clear on a branch with no own number, **When**
   submitted, **Then** no audit row is written.
7. **Given** the business number changes, **Then** branches without their own number follow it; branches with their
   own number do not change.

---

### User Story 4 — Templates and branch numbers (Priority: P2)

A business-wide template "Eid" has 4 shifts on Thursday; Salmiya = 2, Hawalli = 4.

**Acceptance Scenarios** (MB-Q3):

1. **Given** that pattern, **When** the template is saved, **Then** it is accepted (the largest effective number in the
   business is 4).
2. **Given** every active branch's effective number is 2, **When** a pattern with 3 on a day is saved, **Then**
   `SCHEDULE_DAY_LIMIT_EXCEEDED` with `{ max_shifts_per_day: 2, days }`.
3. **Given** the template saved, **When** applied to Salmiya, **Then** refused with `SCHEDULE_DAY_LIMIT_EXCEEDED`
   before any write; **when** applied to Hawalli, **Then** it succeeds.
4. **Given** a template edit, **Then** only changed days are checked (MS-Q4).

---

### User Story 5 — Lowering a branch number (Priority: P2)

MS-Q4 applies per branch: after the owner lowers Hawalli from 4 to 3, stored Hawalli weeks with 4 shifts on a day are
untouched; editing another day succeeds; changing the excess day is refused while it still holds 4.

### Edge Cases

- Overnight and Friday→Saturday shifts count on their **start** day in the branch they belong to (spec 020).
- A deactivated branch keeps its stored number; it is not listed, not used for the template maximum, and no schedule can
  be saved there.
- A business with no active branch: the template check uses business number ?? 3.
- Concurrent "owner lowers Salmiya" and "manager saves a 3rd Salmiya shift" are serialized by the company lock.
- Apply-template at the maximum (20 copies × 28 shifts) stays within spec 042 FR-013; one extra indexed lookup.
- An unknown or inaccessible branch returns the same `NOT_FOUND` as other schedule routes.
- The 16 h cap, overlap exclusion, past-day reason and break rules (spec 041) are unchanged.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every active branch MUST have an effective number in 1 … 4: its own number, else the business number,
  else 3 (MB-Q2).
- **FR-002**: On a schedule save, the per-day count for an employee MUST include only her shifts **in the saving
  branch** (stored, outside the replaced week, plus the new ones), compared with that branch's effective number
  (MB-Q1). Overlap stays checked against all branches.
- **FR-003**: A refused save MUST return `SCHEDULE_DAY_LIMIT_EXCEEDED` with `details: { max_shifts_per_day,
  working_dates }` and write nothing.
- **FR-004**: Template apply MUST check each new copy against the **target branch's** effective number, counting only
  that branch's shifts, before any write.
- **FR-005**: Template create/update MUST check its pattern against the **largest effective number among the business's
  active branches** (business number ?? 3 when there is none); on update only changed days (MB-Q3, MS-Q4).
- **FR-006**: Setting, changing or clearing a branch number, or changing the business number, MUST NOT rewrite any
  stored schedule or template (MS-Q4).
- **FR-007**: Only holders of `manage:schedule-settings:business` MUST be able to read the settings and change the
  business or any branch number; owner by default; personal grants only by the company owner; never a device (MS-Q2).
- **FR-008**: Every actual change (set, change, clear) MUST write one audit row in the same transaction (before, after,
  branch, actor). A no-op writes nothing.
- **FR-009**: The branch grid MUST carry the branch's effective number; the template page carries the FR-005 number.
- **FR-010**: The 16 h cap, no minimum gap (MS-Q5) and the 20-copy cap (MS-Q6) MUST stay unchanged.
- **FR-011**: The POS and offline flows MUST NOT change.

### Key Entities

- **Branch schedule settings** (new): one record per branch that has its own number: the number, who changed it, when.
- **Business schedule settings** (16c, unchanged): the business number every branch without its own follows.

## Slice design *(mandatory — `CLAUDE.md` §1)*

### Chosen design (technical, no owner question)

- **TD-1 Storage.** New staff-owned table `staff_branch_schedule_settings`, read inside the schedule transaction
  through `ScheduleScope`. No new import arrow, no ADR (spec 042 TD-1). Pure expand: the 16c table and routes stay.
- **TD-2 Effective value.** Domain `effectiveMaxShiftsPerDay(branchValue, businessValue)` → branch ?? business ?? 3.
  The SQL reads use the same `COALESCE` order; a query test pins the three cases.
- **TD-3 Serialization.** Unchanged (spec 042 TD-2): `companies FOR NO KEY UPDATE` first, then the settings row; schedule
  writes read the limit after their locks.
- **TD-4 Counting.** `validateScheduleOverlap(shifts, others, limit, checkedDates?, branchId?)` counts only `others`
  whose `branch_id` equals the saving branch when `branchId` is given; overlap uses all `others`.
- **TD-5 Errors.** No new error code.
- **TD-6 Active branches.** The settings list and the template maximum use the active branches from tenancy
  `describeWorkspaces` (declared arrow, ADR-0024), not a direct `branches` table read.

### Business rules

- **BR-001** (MS-Q1 changed): the number belongs to the branch. Example: Hawalli 4, Salmiya 2.
- **BR-002** (MB-Q2): effective = branch ?? business ?? 3. Example: Fahaheel follows the business 3; clearing Hawalli
  returns it to 3.
- **BR-003** (MB-Q1): each branch counts only its own shifts. Example: Sara 2 in Hawalli + 1 in Salmiya → accepted.
- **BR-004** (MB-Q3): template saved against the largest effective number; apply uses the target branch.
- **BR-005** (MS-Q3/Q4/Q5/Q6, S020-SHIFTS): range 1 … 4, changed days only, no gap, 20-copy cap, 16 h, default 3.

### Schema changes (expand only)

| Table | Columns | RLS | Indexes | Tenant-qualified FKs |
|---|---|---|---|---|
| `staff_branch_schedule_settings` (new) | `company_id uuid NOT NULL`, `business_id uuid NOT NULL`, `branch_id uuid NOT NULL`, `max_shifts_per_day smallint NOT NULL CHECK (BETWEEN 1 AND 4)`, `updated_by uuid NOT NULL`, `updated_at timestamptz NOT NULL`; PK `(company_id, branch_id)` | ENABLE + FORCE; `SELECT`, `INSERT`, `UPDATE`, `DELETE` for `pospay_app` on `company_id = app_company_id()` | PK; `(company_id, business_id)` for the per-business list; `(updated_by)` | `(company_id, business_id, branch_id) → branches(company_id, business_id, id)`; `updated_by → user(id)` |
| `staff_schedule_settings` (16c) | unchanged | unchanged | — | — |

Grants: `SELECT, INSERT, DELETE` and `UPDATE (max_shifts_per_day, updated_by, updated_at)` to `pospay_app`;
`packages/db/src/__tests__/privileges.spec.ts` allowlist updated. Migration numbers: next after the highest on
`origin/main` at implementation; renumbered at merge (open PRs #147, #148 claim 0111+).

### API contract

- `GET /v1/businesses/{businessId}/schedule-settings` (existing, same guard) keeps its fields and gains
  `branches: [{ branch_id, max_shifts_per_day, source: 'branch'|'business'|'default', updated_at | null }]` — every
  active branch of the business (additive).
- `PUT /v1/businesses/{businessId}/branches/{branchId}/schedule-settings` · `manage:schedule-settings:business` ·
  feature `staff` · body `SetScheduleSettingsInput { max_shifts_per_day: int 1 … 4 }` →
  `BranchScheduleSettings { branch_id, max_shifts_per_day, source, updated_at | null }`.
- `DELETE` on the same path (clear) → `BranchScheduleSettings` with `source` `business` or `default`.
- `PUT /v1/businesses/{businessId}/schedule-settings` (existing) unchanged: sets the business number.
- `ScheduleGrid.max_shifts_per_day`: the branch's effective number. `TemplatePage.max_shifts_per_day`: the FR-005 number.
- Zod in `packages/contracts/src/staff/schedule-settings.ts` + OpenAPI registration.
- `Idempotency-Key`: not required (no money/stock effect; repeating is a no-op).
- Errors: `VALIDATION_FAILED`, `NOT_FOUND`, `FORBIDDEN`, `FEATURE_DISABLED`; schedule routes keep
  `SCHEDULE_DAY_LIMIT_EXCEEDED`.

### Permissions

- Unchanged `manage:schedule-settings:business` (MS-Q2): owner by default, owner-granted, never a device; one grant
  covers the business number and every branch. No permission migration.

### Events

- None published or consumed; the audit row (entity `staff_branch_schedule_settings`, entity id = branch id) is the
  record.

### Admin UI

- Branch schedules page: the settings panel shows the business number (editable, as today), this branch's effective
  number and its source, an input to set this branch's own number, "use the business number" (clear), and a read-only
  list of all active branches' effective numbers with branch names from the workspace. ar/en strings in
  `packages/i18n`; logical CSS.

### Test plan

- **Domain unit**: `effectiveMaxShiftsPerDay` (branch / business / default); `validateScheduleOverlap` with `branchId`
  (Sara 2 Hawalli + 1 Salmiya accepted; 3 Salmiya refused; overlap with Hawalli still refused); overnight and
  Friday→Saturday on start day; changed-days only; `templateMaxShiftsPerDay` (largest of active branches; none →
  business ?? 3).
- **Integration** (T2 Postgres, one cloned DB per spec file): `MB-01` two branches with 2 and 4 · `MB-02` branch without
  own number follows the business number, then 3 · `MB-03` Sara two-branch day accepted, same-branch excess refused ·
  `MB-04` set/change/clear audited, no-op not audited · `MB-05` non-holder `NOT_FOUND`, owner-granted person allowed,
  device refused · `MB-06` lowering a branch keeps stored rows, changed day refused · `MB-07` template saved at the
  largest number, apply refused in the lower branch before any write, accepted in the higher · `MB-08` concurrent
  lower vs save serialized · `MB-09` out-of-range refused · `MB-10` business number change moves branches without own
  number only.
- **RLS negative**: `staff_branch_schedule_settings` cross-tenant read = 0 rows; insert/update/delete with another
  `company_id` rejected or 0 rows; FK to another tenant's branch rejected; FK to a branch of another business rejected.
- **Queries**: settings list and grid result-shape tests include the branch value and source; `EXPLAIN ANALYZE`
  asserts the PK lookup for the grid.
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
- Overlap is always checked across all branches — a physical rule, not a count.
- Attendance, hours, commission and the POS are unchanged (spec 042 Assumptions).
- A later partner answer that differs replaces the affected rule in a follow-up slice (Waleed's ruling).
- Row 16d (spec 048) changes the same grid query and admin editor and lands after this row (research R8).
