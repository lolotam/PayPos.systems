# Feature Specification: Default working hours and break on the employee profile

**Feature Branch**: `feat/p1-16d-employee-default-hours`

**Created**: 2026-10-10

**Status**: Draft — owner questions DH-Q1 … DH-Q7 `PENDING` (`owner-questions.ar.md`). Not ready for `/speckit-plan`.

**Input**: User description: "staff-employee-default-hours — the partner asked that the owner sets each employee's
working hours (a day can be 12 hours, not 8) and her break on the employee profile; Waleed approved on 2026-10-10
«نضيف الدوام الافتراضي في ملف الموظفة». The default pre-fills the schedule."

**Phase 1 row**: 16d, builds on row 16 (spec `docs/specs/020-staff-schedules/spec.md`), row 16b-1 (spec
`docs/specs/041-staff-schedule-break-window/spec.md`) and the employee profile (specs 013, 017, 021, 040).
Research: [research.md](research.md).

## Owner decisions already taken (binding — not asked again)

| Source | Decision |
|---|---|
| Waleed, 2026-10-10 (partner's BW-Q4 comment) | Each employee gets a **default working day and break on her profile**, and it **pre-fills** the schedule |
| BW-Q4 (spec 041) | The break **counts** as working hours: 09:00–17:00 with a 13:00–14:00 break = 8 hours |
| BW-Q2 / BW-Q3 / BW-Q6 (spec 041) | A break is optional, at most one per shift, strictly inside the shift |
| S020-SHIFTS (2026-10-09) | One shift is at most 16 hours |

## Open owner questions

| ID | Topic | Status |
|---|---|---|
| DH-Q1 | What is stored: start/end times + break window, or hours + break minutes | PENDING |
| DH-Q2 | Same every day (with off days), or different per weekday | PENDING |
| DH-Q3 | Pre-fill only, or also a warning when a shift differs | PENDING |
| DH-Q4 | Does the monthly report (row 27) show it as "contracted hours" | PENDING |
| DH-Q5 | Who can set it | PENDING |
| DH-Q6 | Optional or required; existing employees | PENDING |
| DH-Q7 | One default per employee, or one per branch | PENDING |

## User Scenarios & Testing *(mandatory)*

Example: salon with branches **Salmiya** and **Hawalli**. Sara works 09:00–17:00 with a break 13:00–14:00, off on
Friday. Heba works 10:00–22:00 (12 hours) with a break 15:00–16:00.

### User Story 1 — The owner sets Sara's default day (Priority: P1)

**Why this priority**: it is the partner's request and Waleed's decision; everything else reads it.

**Independent Test**: open Sara's profile, set the default, reload — it is shown; the change is in the audit log.

**Acceptance Scenarios**:

1. **Given** Sara's profile, **When** the owner sets the default (shape per `TODO(spec) → DH-Q1`, days per
   `TODO(spec) → DH-Q2`), **Then** it is saved and one audit row records before/after with the actor.
2. **Given** a default of 22:00–06:00, **When** saved, **Then** it is accepted (overnight, 8 h) like a shift.
3. **Given** a default longer than 16 h, or a break touching or outside the day, **When** saved, **Then** it is refused
   with the same rule as a shift (`SCHEDULE_SHIFT_INVALID` / `SCHEDULE_BREAK_INVALID`) and nothing is written.
4. **Given** a default without a break, **When** saved, **Then** it is accepted (BW-Q2).
5. **Given** a person who may not set it (`TODO(spec) → DH-Q5`), **When** they try, **Then** the request is refused
   and nothing is written; they may still see it if they can see the profile.
6. **Given** the same value as stored, **When** saved, **Then** no audit row is written.

---

### User Story 2 — The schedule pre-fills from the default (Priority: P1)

The Salmiya manager opens next week for Heba and adds a Thursday shift.

**Why this priority**: the reason the default exists — less typing and fewer wrong hours.

**Independent Test**: with a default set, "Add shift" on an empty day shows her times and break; without a default it
shows today's suggestions.

**Acceptance Scenarios**:

1. **Given** Heba's default 10:00–22:00, break 15:00–16:00, **When** the manager adds the first shift on Thursday,
   **Then** the new shift shows 10:00–22:00 with the break 15:00–16:00, editable before saving.
2. **Given** a second shift on the same day, **When** added, **Then** it uses today's suggestion (her default is one
   shift per day).
3. **Given** `TODO(spec) → DH-Q3` = "fill the week", **When** the manager presses "Fill the week from her default",
   **Then** every empty working day gets her default shift; days that already hold shifts and off days are left alone.
4. **Given** pre-filled shifts, **When** the manager saves, **Then** the save goes through the normal week save with
   all its checks (branch limit, overlap, eligibility, past-day reason); pre-fill itself writes nothing.
5. **Given** an employee with no default, **When** a shift is added, **Then** the editor behaves exactly as today.

---

### User Story 3 — Changing the default later (Priority: P2)

**Acceptance Scenarios**:

1. **Given** saved weeks for Sara, **When** the owner changes her default to 10:00–18:00, **Then** no saved week or
   template changes; only shifts added afterwards are pre-filled with the new hours.
2. **Given** `TODO(spec) → DH-Q3` = "warn", **When** a saved shift differs from her default, **Then** the editor shows
   a warning and the save still succeeds.

### Edge Cases

- A default whose day is an off day (DH-Q2) is not pre-filled on that day.
- The employee left (contract ended) or was deleted: the default stays stored with the record; the editor does not
  show her (unchanged eligibility rules).
- An employee attached to two branches with different time zones: the local times apply in the branch being edited
  (`TODO(spec) → DH-Q7` for a separate default per branch).
- A pre-filled day already at the branch's limit (16c / 16c-2): "Add shift" stays disabled; the default never
  bypasses the limit.
- Two people saving Sara's default at the same time: serialized on the employee row; the later write wins and both
  are audited.
- The employee import (spec 030) does not carry defaults; out of scope.
- Templates (business-wide, API only) are not pre-filled from any profile.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: An employee MUST be able to have a default working day and an optional break stored on her profile.
  What is stored → `TODO(spec) → DH-Q1`; per weekday or not → `TODO(spec) → DH-Q2`; per branch or not →
  `TODO(spec) → DH-Q7`.
- **FR-002**: The default MUST obey the shift rules: at most 16 h, overnight allowed, at most one break strictly inside
  (S020-SHIFTS, BW-Q3, BW-Q6). The break counts as working hours (BW-Q4) — it is never subtracted.
- **FR-003**: Setting the default MUST be limited to `TODO(spec) → DH-Q5`. Anyone who can see the employee profile
  can see it; schedule editors (`read:schedules:*`) receive it with the grid for pre-fill.
- **FR-004**: Every actual change MUST write one audit row in the same transaction (before/after, actor). A no-op
  writes nothing.
- **FR-005**: The schedule editor MUST pre-fill the first new shift of a day from the employee's default (times and
  break). The behaviour beyond that → `TODO(spec) → DH-Q3`.
- **FR-006**: Pre-fill MUST NOT write anything; saving stays the existing week save with all its checks.
- **FR-007**: Changing a default MUST NOT change any saved schedule or template.
- **FR-008**: Employees with no default MUST keep today's editor behaviour. Required or optional →
  `TODO(spec) → DH-Q6`.
- **FR-009**: Reports: `TODO(spec) → DH-Q4` (none in this row; row 27 consumes it only if the owner says so).
- **FR-010**: The POS, attendance, lateness (16b-2) and commission MUST NOT change.

### Key Entities

- **Employee default shift** (new): for one employee and (per DH-Q2) one weekday: start, end, optional break window,
  who changed it last and when. Absence = no default.

## Slice design *(mandatory — `CLAUDE.md` §1)*

Written for the recommended answers (⭐ in `owner-questions.ar.md`); the parts that move with an answer are marked.

### Chosen design (technical, no owner question)

- **TD-1 Separate section, separate use case.** One use case `set-employee-default-shifts` and one read query, like
  salary (021) and IBAN (040). `update-employee`, its revision, column grant and name-match flow are untouched.
- **TD-2 Storage by weekday rows.** Table `employee_default_shifts`, one row per working weekday; it covers "same hours
  every day + off days" (same times on each row) and "different per weekday" without a schema change. The API takes
  and returns the full set; the write replaces the set (delete + insert) under the employee row lock.
- **TD-3 One validator.** The set is validated with the existing pure `validateSchedulePattern(shifts, 1)` — one shift
  per day, ≤ 16 h, overnight, break inside. No new time rule is written.
- **TD-4 Pre-fill via the grid.** `ScheduleGridRow` gains `default_shifts`; the admin `newScheduleShift` takes the
  employee's default for the first shift of a day. No arithmetic in the UI under DH-Q1 ⭐ (times are copied). If
  DH-Q1 picks hours + minutes, the end/break placement lives in `packages/domain` and is shared.
- **TD-5 Errors.** Reuse `SCHEDULE_SHIFT_INVALID` and `SCHEDULE_BREAK_INVALID` (same rule, same message); no new code.

### Business rules

- **BR-001**: a default is a pre-fill, never a constraint on saved shifts (Waleed 2026-10-10). Warning or not → DH-Q3.
- **BR-002**: the default obeys the shift rules (≤ 16 h, one break inside, break counts as hours — BW-Q4). Example:
  Heba 10:00–22:00 with 15:00–16:00 = 12 h.
- **BR-003**: off days / per-weekday → DH-Q2. **BR-004**: who sets it → DH-Q5. **BR-005**: required → DH-Q6.
  **BR-006**: per branch → DH-Q7. **BR-007**: reports → DH-Q4.

### Schema changes (expand only)

| Table | Columns | RLS | Indexes | Tenant-qualified FKs |
|---|---|---|---|---|
| `employee_default_shifts` (new) | `company_id uuid NOT NULL`, `business_id uuid NOT NULL`, `employee_id uuid NOT NULL`, `day smallint NOT NULL CHECK (day BETWEEN 0 AND 6)`, `start time NOT NULL`, `end time NOT NULL`, `break_start time NULL`, `break_end time NULL` (CHECK both NULL or both NOT NULL), `updated_by uuid NOT NULL`, `updated_at timestamptz NOT NULL`; PK `(company_id, employee_id, day)` | ENABLE + FORCE; `SELECT`, `INSERT`, `DELETE` for `pospay_app` on `company_id = app_company_id()`; no UPDATE | PK; `(company_id, business_id)`; `(updated_by)` | `(company_id, business_id, employee_id) → employees(company_id, business_id, id)`; `updated_by → user(id)` |

Grants `SELECT, INSERT, DELETE` to `pospay_app`; allowlist in `packages/db/src/__tests__/privileges.spec.ts`. No
backfill: existing employees have no rows. If DH-Q1 picks hours + minutes, `start`/`end` become
`minutes smallint CHECK (1 … 960)` and `break_minutes smallint NULL` (+ optional `start`). If DH-Q7 picks per branch,
`branch_id` joins the PK and FK `(company_id, business_id, branch_id) → branches`. Migration numbers: next free after
26a–26c and 16c-2, renumbered at merge.

### API contract

- `GET /v1/businesses/{businessId}/employees/{employeeId}/default-shifts` · same access as the employee detail
  (`EmployeeDetailGuard`) · feature `staff` →
  `EmployeeDefaultShifts { employee_id, shifts: [{ day, start, end, break_start, break_end }], updated_at | null }`.
- `PUT` same path · guard per DH-Q5 (⭐ `manage:employee-hours:business`) · body
  `SetEmployeeDefaultShiftsInput { shifts: ScheduleShift[] (max 7, one per day) }` (empty = clear) →
  `EmployeeDefaultShifts`.
- `ScheduleGridRow` gains `default_shifts: ScheduleShift[]` (read with `read:schedules:*`).
- Zod: `packages/contracts/src/staff/employee-default-shifts.ts` reusing `scheduleShift` + OpenAPI registration.
- `Idempotency-Key`: not required (no money/stock effect; the same PUT twice is a no-op).
- Errors: `VALIDATION_FAILED`, `SCHEDULE_SHIFT_INVALID`, `SCHEDULE_BREAK_INVALID`, `NOT_FOUND`, `FORBIDDEN`,
  `FEATURE_DISABLED`.

### Permissions

- DH-Q5 ⭐: new `manage:employee-hours:business` — owner by default (`ROLE_DEFAULTS = ['owner']`), in
  `OWNER_GRANTED_PERMISSIONS` (granted only by the company owner, to any human role, never a device), same pattern
  as `manage:schedule-settings:business` (MS-Q2). DH-Q5 alternative: reuse `manage:employees:business` (no new code).
- Read: whoever reads the employee detail; schedule editors through the grid.

### Events

- None published or consumed; the audit row (entity `employee_default_shifts`, entity id = employee id) is the record.

### Admin UI

- Employee profile: a "Default working hours" section (beside salary and IBAN) with start, end, optional break and,
  per DH-Q2, off days or per-day rows; shows the day length including the break ("8 hours").
- Schedule editor: first "Add shift" of a day uses the default; per DH-Q3 a "Fill the week" button and/or a
  difference warning. All strings from `packages/i18n`; logical CSS only.

### Test plan

- **Domain unit**: default validation (≤ 16 h, overnight, break inside / touching / outside, one per day, empty set);
  no-op detection; (DH-Q1 alt) end/break placement function.
- **Integration** (T2 Postgres, cloned DB per spec file): `DH-01` set, read, audit · `DH-02` no-op not audited ·
  `DH-03` invalid default refused, nothing written · `DH-04` permission per DH-Q5 (owner, owner-granted person,
  non-holder, device) · `DH-05` clear · `DH-06` grid row carries `default_shifts`; employee without default → `[]` ·
  `DH-07` changing the default leaves saved weeks untouched · `DH-08` concurrent saves serialized, both audited.
- **RLS negative**: `employee_default_shifts` cross-tenant read = 0 rows; insert/delete with another `company_id`
  rejected; FK to another tenant's employee rejected.
- **Queries**: detail and grid result-shape tests; `EXPLAIN ANALYZE` asserts the PK lookup.
- **Admin**: section form validation and save; pre-fill of the first shift; no default → today's suggestion;
  fill-week skips filled and off days (DH-Q3).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The owner sets an employee's default day in under one minute.
- **SC-002**: For an employee with a default, a manager builds her standard week with no time typed (one click per day,
  or one click per week under DH-Q3).
- **SC-003**: No saved schedule changes when a default changes (0 rows rewritten).
- **SC-004**: 100 % of default changes appear in the audit log with who and when.

## Assumptions

- The default is a planning aid only; it does not set salary, overtime or attendance rules in phase 1.
- Defaults use branch-local `HH:mm`, like templates.
- Employees with no default keep today's editor suggestions (09:00–13:00 …, break 13:00–14:00).
- The POS (`read-my-schedule`) and offline flows are unchanged.
- Row 16c-2 (spec 047) changes the same grid query and editor; the two land one after the other (research R6).
