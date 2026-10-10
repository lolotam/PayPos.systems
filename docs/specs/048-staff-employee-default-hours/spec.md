# Feature Specification: Default working hours and break on the employee profile

**Feature Branch**: `feat/p1-16d-employee-default-hours`

**Created**: 2026-10-10

**Status**: Ready — owner answered DH-Q1 … DH-Q7 on 2026-10-10 (batch 8, `owner-questions.ar.md`). The partner has
not answered yet; Waleed ruled that **if the partner's pick differs, the partner's pick wins**, and work proceeds on
Waleed's picks until then.

**Input**: User description: "staff-employee-default-hours — the partner asked that the owner sets each employee's
working hours (a day can be 12 hours, not 8) and her break on the employee profile; Waleed approved on 2026-10-10
«نضيف الدوام الافتراضي في ملف الموظفة». The default pre-fills the schedule."

**Phase 1 row**: 16d, builds on row 16 (spec `docs/specs/020-staff-schedules/spec.md`), row 16b-1 (spec
`docs/specs/041-staff-schedule-break-window/spec.md`) and the employee profile (specs 013, 017, 021, 040).
**Consumed by row 27** (attendance board + monthly report): DH-Q4. Research: [research.md](research.md).

## Owner decisions already taken (binding — not asked again)

| Source | Decision |
|---|---|
| Waleed, 2026-10-10 (partner's BW-Q4 comment) | Each employee gets a **default working day and break on her profile**, and it **pre-fills** the schedule |
| BW-Q4 (spec 041) | The break **counts** as working hours: 09:00–17:00 with a 13:00–14:00 break = 8 hours |
| BW-Q2 / BW-Q3 / BW-Q6 (spec 041) | A break is optional, at most one per shift, strictly inside the shift |
| S020-SHIFTS (2026-10-09) | One shift is at most 16 hours |

## Owner answers (Waleed, 2026-10-10 — provisional until the partner answers; his pick wins on a difference)

| ID | Question | Decision |
|---|---|---|
| DH-Q1 | What is stored | **Start and end times plus the break from–to**; the shift is pre-filled exactly so (recommended) |
| DH-Q2 | Per weekday | **Different hours for each weekday** (not the recommended "same every day + off days") |
| DH-Q3 | What it does in the schedule | **Pre-fill, and also warn** when a saved shift differs from her default, then continue (not the recommended "pre-fill only") |
| DH-Q4 | Monthly report | **Yes**: a "contracted hours this month" column next to the actual hours (row 27) (not the recommended "not now") |
| DH-Q5 | Who sets it | **Owner only by default; the owner can grant it to anyone** (recommended) |
| DH-Q6 | Required | **Optional, but the profile of an employee without hours shows «دوامها مش مكتوب»** (not the recommended plain optional) |
| DH-Q7 | Per branch | **One default per branch she is linked to** (not the recommended single default) |

## User Scenarios & Testing *(mandatory)*

Example: salon with branches **Salmiya** and **Hawalli**. Sara is linked to both: in Salmiya Saturday–Wednesday
09:00–17:00 with a break 13:00–14:00 and Thursday 09:00–21:00 with a break 14:00–15:00; in Hawalli Friday
14:00–22:00, no break. Heba works only in Salmiya, 10:00–22:00 (12 hours) with a break 15:00–16:00, every day but
Friday.

### User Story 1 — The owner sets Sara's default week per branch (Priority: P1)

**Why this priority**: it is the partner's request and Waleed's decision; everything else reads it.

**Independent Test**: open Sara's profile, set her Salmiya and Hawalli weeks, reload — both are shown; each change is
in the audit log.

**Acceptance Scenarios**:

1. **Given** Sara's profile, **When** the owner sets her Salmiya week (a start, end and optional break for each
   weekday she works there), **Then** it is saved and one audit row records before/after with the branch and actor.
2. **Given** her Hawalli week, **When** saved, **Then** it is stored separately; the Salmiya week is not touched
   (DH-Q7).
3. **Given** a day of 22:00–06:00, **When** saved, **Then** it is accepted (overnight, 8 h), like a shift.
4. **Given** a day longer than 16 h, two entries for one weekday, or a break touching or outside the day, **When**
   saved, **Then** it is refused with `SCHEDULE_SHIFT_INVALID` / `SCHEDULE_DAY_LIMIT_EXCEEDED` /
   `SCHEDULE_BREAK_INVALID` and nothing is written.
5. **Given** a day without a break, **When** saved, **Then** it is accepted (BW-Q2).
6. **Given** a branch Sara is not linked to today, **When** the owner sets a week for it, **Then**
   `EMPLOYEE_BRANCH_NOT_LINKED` (422) and nothing is written.
7. **Given** a person without `manage:employee-hours:business`, **When** they try, **Then** `FORBIDDEN` and nothing is
   written; they still see the hours if they can see the profile (DH-Q5).
8. **Given** the same week as stored, **When** saved, **Then** no audit row is written.
9. **Given** an empty week, **When** saved, **Then** the branch's default is cleared (audited).

---

### User Story 2 — "Hours not set" notice on the profile (Priority: P1)

**Acceptance Scenarios** (DH-Q6):

1. **Given** Heba has no default in Salmiya (her only branch), **When** her profile opens, **Then** it shows
   «دوامها مش مكتوب» for Salmiya; nothing is ever blocked by it.
2. **Given** Sara has a Salmiya week but none for Hawalli, **When** her profile opens, **Then** the notice names
   Hawalli only.
3. **Given** a new employee, **When** she is created without hours, **Then** creation succeeds and her profile shows
   the notice.

---

### User Story 3 — The schedule pre-fills from the branch default (Priority: P1)

**Acceptance Scenarios**:

1. **Given** Sara's Salmiya Thursday default 09:00–21:00 with a break 14:00–15:00, **When** the manager adds the first
   Thursday shift in the Salmiya grid, **Then** the new shift shows 09:00–21:00 with that break, editable before saving.
2. **Given** the Hawalli grid, **When** the Hawalli manager adds Sara's first Friday shift, **Then** it shows her
   Hawalli Friday default (14:00–22:00, no break); Salmiya defaults are never used in Hawalli.
3. **Given** a second shift on the same day, or a weekday with no default in this branch, **When** added, **Then** the
   editor uses today's suggestions.
4. **Given** pre-filled shifts, **When** the manager saves, **Then** the normal week save runs with all its checks
   (branch limit, overlap, eligibility, past-day reason); pre-fill itself writes nothing.
5. **Given** an employee with no default in this branch, **When** a shift is added, **Then** the editor behaves
   exactly as today.

---

### User Story 4 — Warning when a shift differs from her default (Priority: P1)

**Acceptance Scenarios** (DH-Q3):

1. **Given** Sara's Salmiya Saturday default 09:00–17:00 / 13:00–14:00, **When** the manager sets Saturday to
   09:00–21:00, **Then** the editor shows «ده مختلف عن دوام سارة» on that day, and Save still works.
2. **Given** the day matches her default exactly (start, end, break), **Then** no warning.
3. **Given** a day whose weekday has a default and the day holds two shifts, a different break, or no break while the
   default has one, **Then** the warning shows.
4. **Given** a day with no shift, **Then** no warning (an empty day is not a "saved shift").
5. **Given** a shift on a weekday with **no** default in this branch, **Then** no warning (nothing to compare with) —
   derived rule, see Assumptions.

---

### User Story 5 — Contracted hours for the monthly report (Priority: P2)

**Acceptance Scenarios** (DH-Q4; the column itself is built in row 27):

1. **Given** Sara's Salmiya week above and October 2026, **When** her contracted minutes in Salmiya for the month are
   read, **Then** the result is the sum, over every date of October on which she is employed and linked to Salmiya, of
   that weekday's default length **including the break** (BW-Q4). October 2026 has 21 Saturday–Wednesday dates
   (× 8 h = 168 h) and 5 Thursdays (× 12 h = 60 h); Fridays have no Salmiya default → **228 h**.
2. **Given** a date before her hire date, after her contract end, or outside her Salmiya link, **Then** it adds 0.
3. **Given** a default changed on 15 October, **Then** the current default is used for the whole month (no history in
   this row) — see Assumptions.

---

### User Story 6 — Changing a default later (Priority: P2)

1. **Given** saved weeks for Sara, **When** the owner changes her Salmiya default, **Then** no saved week or template
   changes; only shifts added afterwards are pre-filled with the new hours, and the warning compares with the new
   default.

### Edge Cases

- Sara's link to Hawalli ends: her Hawalli default stays stored but is not shown in the grid, adds no contracted hours
  after the link end, and the profile notice ignores branches she is no longer linked to.
- The employee left or was deleted: defaults stay with the record; the editor does not show her (unchanged rules).
- Different time zones between branches: each branch's default is in that branch's local `HH:mm`.
- A pre-filled day already at the branch's limit (16c / 16c-2): "Add shift" stays disabled; the default never
  bypasses the limit.
- Two people saving the same employee's defaults at once: serialized on the employee row lock; both audited.
- The employee import (spec 030) does not carry defaults; out of scope.
- Templates (business-wide, API only) are not pre-filled and never warn.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: An employee MUST be able to have, **for each branch she is linked to** (DH-Q7), a default for each
  weekday (DH-Q2): start time, end time and an optional break from–to (DH-Q1). A weekday without an entry has no
  default in that branch.
- **FR-002**: Each weekday entry MUST obey the shift rules: at most 16 h, overnight allowed, at most one break strictly
  inside (S020-SHIFTS, BW-Q3, BW-Q6); at most one entry per weekday. The break counts as working hours (BW-Q4).
- **FR-003**: Setting a default MUST require `manage:employee-hours:business`: owner by default; grantable only by the
  company owner, to any human role, never a device (DH-Q5). Anyone who can read the employee detail can read the
  defaults; schedule readers (`read:schedules:*`) receive the defaults of the grid's branch.
- **FR-004**: A default MUST only be set for a branch the employee is linked to on the day of the change.
- **FR-005**: Every actual change MUST write one audit row in the same transaction (before/after, branch, actor);
  a no-op writes nothing.
- **FR-006**: The profile MUST show «دوامها مش مكتوب» for each branch she is currently linked to that has no default;
  nothing is ever blocked by it (DH-Q6).
- **FR-007**: The schedule editor MUST pre-fill the first new shift of a day with that weekday's default **for the
  grid's branch** (times and break). Otherwise today's suggestions apply.
- **FR-008**: The schedule editor MUST show a non-blocking warning on each day that holds at least one shift and
  differs from that weekday's default in this branch (different count, start, end or break). Days without a shift and
  weekdays without a default never warn. Saving is never blocked (DH-Q3).
- **FR-009**: Pre-fill and warning MUST NOT write anything; saving stays the existing week save.
- **FR-010**: Changing a default MUST NOT change any saved schedule or template.
- **FR-011**: The system MUST expose the contracted minutes of an employee in a branch over a date range: the sum of
  the weekday default lengths (break included) over the dates on which she is employed and linked to that branch.
  Row 27 shows it as "contracted hours this month" (DH-Q4). This row does not build the report.
- **FR-012**: The POS, attendance, lateness (16b-2) and commission MUST NOT change.

### Key Entities

- **Employee default shift** (new): employee, branch, weekday, start, end, optional break window, who changed it last
  and when. Absence = no default for that weekday in that branch.

## Slice design *(mandatory — `CLAUDE.md` §1)*

### Chosen design (technical, no owner question)

- **TD-1 Separate section, separate use case.** `set-employee-default-shifts` (per branch) and read queries, like
  salary (021) and IBAN (040). `update-employee`, its revision, column grant and name-match flow are untouched.
- **TD-2 Storage.** Table `employee_default_shifts`, one row per (employee, branch, weekday). The write replaces one
  branch's set (delete + insert) under the employee row lock.
- **TD-3 One validator.** A branch's set is validated with the existing pure `validateSchedulePattern(shifts, 1)` —
  one shift per weekday, ≤ 16 h, overnight, break inside. No new time rule.
- **TD-4 Shared pure functions in `packages/domain`** (imported by the API and the admin, `CLAUDE.md` §7; precedent
  `employee-name-key.ts`, `iban.ts`): `defaultShiftMinutes(entry)`, `contractedMinutes(defaults, dates)` and
  `dayDiffersFromDefault(dayShifts, entry)`. The admin warning calls the last one; the contracted-hours read calls the
  second. Nothing is re-implemented in React.
- **TD-5 Pre-fill via the grid.** `ScheduleGridRow` gains `default_shifts` (this branch only); the admin
  `newScheduleShift` takes the weekday's default for the first shift of a day.
- **TD-6 Errors.** Reuse `SCHEDULE_SHIFT_INVALID`, `SCHEDULE_DAY_LIMIT_EXCEEDED` (two entries for one weekday),
  `SCHEDULE_BREAK_INVALID`; new `EMPLOYEE_BRANCH_NOT_LINKED` (422).
- **TD-7 Contracted hours.** `queries/employee-contracted-minutes.query.ts` reads, for one branch and date range, each
  employee's defaults, hire/contract dates and link intervals; the sum is the `packages/domain` function. Row 27 calls
  it; 16d tests it with the October example (US5) and an `EXPLAIN` check. No HTTP endpoint in this row.

### Business rules

- **BR-001** (DH-Q1/Q2/Q7): a default is per employee, per linked branch, per weekday: start, end, optional break.
- **BR-002**: entries obey the shift rules; the break counts as hours (BW-Q4). Example: Heba 10:00–22:00 with
  15:00–16:00 = 12 h.
- **BR-003** (DH-Q3): pre-fill + non-blocking warning; never a constraint on saved shifts.
- **BR-004** (DH-Q4): contracted minutes = Σ weekday default length over employed, linked dates of the range, using
  the current default. Example: Sara, Salmiya, October 2026 = 228 h.
- **BR-005** (DH-Q5): owner by default, owner-granted only.
- **BR-006** (DH-Q6): optional; profile notice per linked branch without a default.

### Schema changes (expand only)

| Table | Columns | RLS | Indexes | Tenant-qualified FKs |
|---|---|---|---|---|
| `employee_default_shifts` (new) | `company_id uuid NOT NULL`, `business_id uuid NOT NULL`, `employee_id uuid NOT NULL`, `branch_id uuid NOT NULL`, `day smallint NOT NULL CHECK (day BETWEEN 0 AND 6)` (0 = Saturday), `start time NOT NULL`, `end time NOT NULL`, `break_start time NULL`, `break_end time NULL` (CHECK both NULL or both NOT NULL), `updated_by uuid NOT NULL`, `updated_at timestamptz NOT NULL`; PK `(company_id, employee_id, branch_id, day)` | ENABLE + FORCE; `SELECT`, `INSERT`, `DELETE` for `pospay_app` on `company_id = app_company_id()`; no UPDATE | PK; `(company_id, business_id, branch_id)` for the grid and the report; `(updated_by)` | `(company_id, business_id, employee_id) → employees(company_id, business_id, id)`; `(company_id, business_id, branch_id) → branches(company_id, business_id, id)`; `updated_by → user(id)` |

Grants `SELECT, INSERT, DELETE` to `pospay_app`; allowlist in `packages/db/src/__tests__/privileges.spec.ts`. No
backfill. Permission migration: `manage:employee-hours:business` into `permissions`, owner-role default. Migration
numbers: next free on `origin/main` at implementation, renumbered at merge.

### API contract

- `GET /v1/businesses/{businessId}/employees/{employeeId}/default-shifts` · same access as the employee detail ·
  feature `staff` → `EmployeeDefaultShifts { employee_id, can_manage: boolean, branches: [{ branch_id, linked:
  boolean, shifts: ScheduleShift[], updated_at | null }] }` — one entry per currently linked branch (empty `shifts` =
  notice), plus any stored branch no longer linked with `linked: false`.
- `PUT /v1/businesses/{businessId}/employees/{employeeId}/branches/{branchId}/default-shifts` ·
  `manage:employee-hours:business` · body `SetEmployeeDefaultShiftsInput { shifts: ScheduleShift[] (max 7) }`
  (empty = clear) → `EmployeeDefaultShifts`.
- `ScheduleGridRow.default_shifts: ScheduleShift[]` — the grid branch's defaults (read with `read:schedules:*`).
- Zod: `packages/contracts/src/staff/employee-default-shifts.ts` reusing `scheduleShift` + OpenAPI registration.
- `Idempotency-Key`: not required (no money/stock effect; the same PUT twice is a no-op).
- Errors: `VALIDATION_FAILED`, `SCHEDULE_SHIFT_INVALID`, `SCHEDULE_DAY_LIMIT_EXCEEDED`, `SCHEDULE_BREAK_INVALID`,
  `EMPLOYEE_BRANCH_NOT_LINKED`, `NOT_FOUND`, `FORBIDDEN`, `FEATURE_DISABLED`.

### Permissions

- New `manage:employee-hours:business`: `ROLE_DEFAULTS = ['owner']`, added to `OWNER_GRANTED_PERMISSIONS` (db and
  identity lists) and the i18n permission catalogs (DH-Q5; spec 039 / 042 pattern).
- Read: whoever reads the employee detail; schedule readers for the grid's branch.

### Events

- None published or consumed; the audit row (entity `employee_default_shifts`, entity id = employee id, branch in the
  snapshot) is the record.

### Admin UI

- Employee profile: a "Default working hours" section (beside salary and IBAN): one card per linked branch, seven
  weekday rows (start, end, optional break; empty = no default), each day's length including the break ("8 hours"),
  and «دوامها مش مكتوب» for a branch with no rows. Edit controls only when `can_manage`.
- Schedule editor: first "Add shift" of a day uses the weekday default of this branch; a non-blocking warning line per
  differing day. All strings from `packages/i18n`; logical CSS only.

### Test plan

- **Domain unit** (`packages/domain`): `defaultShiftMinutes` (day, overnight, break counted); `contractedMinutes`
  (October 2026 = 228 h, hire/contract/link bounds, empty); `dayDiffersFromDefault` (equal, other start/end, other
  break, missing break, two shifts, no default, empty day). Staff domain: set validation, no-op detection.
- **Integration** (T2 Postgres, cloned DB per spec file): `DH-01` set/read/audit per branch · `DH-02` no-op not
  audited · `DH-03` invalid entry refused, nothing written · `DH-04` permission (owner, owner-granted person,
  non-holder, device) · `DH-05` unlinked branch refused · `DH-06` clear · `DH-07` grid row carries this branch's
  defaults only; none → `[]` · `DH-08` changing a default leaves saved weeks untouched · `DH-09` concurrent saves
  serialized, both audited · `DH-10` contracted-minutes read for a month.
- **RLS negative**: `employee_default_shifts` cross-tenant read = 0 rows; insert/delete with another `company_id`
  rejected; FK to another tenant's employee or branch rejected.
- **Queries**: detail, grid and contracted-minutes result-shape tests; `EXPLAIN ANALYZE` index assertions.
- **Admin**: section form and notice; pre-fill of the first shift per branch; warning on/off cases.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The owner sets an employee's week for one branch in under two minutes.
- **SC-002**: For an employee with defaults, a manager builds her standard week with no time typed.
- **SC-003**: Every day that differs from the default is flagged before saving; no save is blocked by it.
- **SC-004**: No saved schedule changes when a default changes (0 rows rewritten).
- **SC-005**: 100 % of default changes appear in the audit log with who, which branch and when.
- **SC-006**: Row 27 can show contracted hours for any employee, branch and month from data this row stores.

## Assumptions

- The partner's later answer may change any DH decision (Waleed's ruling); a change becomes a follow-up slice.
- No history of defaults is kept: contracted hours use the current default for the whole range. Approved leave and
  public holidays are **not** subtracted here; how the report column treats them is decided in row 27's spec.
- A shift on a weekday with no default does not warn (US4-5), derived from "differs from her default". If the owner
  wants off-day shifts flagged, it is a one-line change in `dayDiffersFromDefault`.
- Defaults use branch-local `HH:mm`, like templates.
- The POS (`read-my-schedule`) and offline flows are unchanged.
- Row 16c-2 (spec 047) changes the same grid query and editor; 16c-2 lands first (research R6).
