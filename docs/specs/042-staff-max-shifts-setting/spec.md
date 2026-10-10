# Feature Specification: Max shifts per day becomes an owner setting

**Feature Branch**: `feat/p1-16c-max-shifts-setting`

**Created**: 2026-10-10

**Status**: Ready — owner answered MS-Q1 … MS-Q5 on 2026-10-10 (`owner-questions.ar.md`). The partner has not answered yet; the owner said to proceed on his answers.

**Input**: User description: "staff-max-shifts-setting — The maximum number of shifts starting on one day becomes an
owner setting, default 3 (was fixed 2). One shift stays at most 16 hours. Long holiday stretches (72 h at Eid) are
entered as consecutive shifts with breaks between them."

**Phase 1 row**: 16c (`docs/specs/phase-1/IMPLEMENTATION-PLAN.md:60`), depends on row 16 (spec
`docs/specs/020-staff-schedules/spec.md`, PR 89). Research: [research.md](research.md).

## Owner decision already taken (2026-10-09, S020-SHIFTS)

Source: `docs/specs/phase-1/owner-review-2026-10-09.ar.md` §S020-SHIFTS. Binding:

1. The maximum number of shifts in a day is a **setting the owner changes**. The **default is 3**.
2. One shift stays **at most 16 hours**.
3. A long holiday stretch (for example 72 hours at Eid) is entered as **several shifts back to back, with breaks
   between them**, so hours and commission calculations stay correct.

## Owner answers (Waleed, final, 2026-10-10 — `owner-questions.ar.md`)

| ID | Question | Decision |
|---|---|---|
| MS-Q1 | Scope of the setting | **per business** (the business with all its branches); each other business has its own number |
| MS-Q2 | Who may change it | **owner only by default; the owner can grant it to any person** (same pattern as the documents permission, row 13b / spec 039) |
| MS-Q3 | Allowed values | **1 … 4** (the owner chose this over the recommended 1 … 6) |
| MS-Q4 | Lowering the number | **stored rows stay as they are**; the new limit applies only to the days a save changes; a template with an excess day cannot be applied until it is fixed |
| MS-Q5 | Minimum gap between back-to-back shifts | **none** — touching shifts allowed as today; the break is the free time between shifts |

Partner (أبو سالم / محمد العنزي): not answered yet — to be added later. The owner's answers are binding.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — A third shift in one day (Priority: P1)

A salon in Salmiya runs a morning, an afternoon and an evening shift on busy days. With the new default the manager
gives Sara three shifts on Thursday (09:00–13:00, 14:00–18:00, 19:00–23:00) and saves.

**Why this priority**: it is the default every business gets on day one; today the third shift is refused.

**Independent Test**: save a week with three shifts on one day for a business that never touched the setting.

**Acceptance Scenarios**:

1. **Given** a business with no saved setting, **When** a manager saves 3 shifts starting on Thursday for Sara,
   **Then** the week is saved and audited as today.
2. **Given** the same business, **When** the manager saves a 4th shift starting Thursday, **Then** the save is refused
   with `SCHEDULE_DAY_LIMIT_EXCEEDED`, naming the limit (3) and the day, and nothing is written.
3. **Given** Sara already has 2 shifts on Thursday in Salmiya, **When** a Hawalli manager adds 2 Thursday shifts for
   her in Hawalli, **Then** the save is refused: the count is per employee per start day across branches (spec 020,
   unchanged).
4. **Given** the edit dialog, **When** a day already holds as many shifts as the limit, **Then** "Add shift" is
   disabled; it follows the effective limit, not a fixed 2.

---

### User Story 2 — The owner changes the limit (Priority: P1)

The owner of the salon sets the maximum to 4 before Eid and back to 3 afterwards.

**Why this priority**: it is the owner's decision; without it the setting is a constant.

**Independent Test**: the owner reads and changes the value; a schedule save right after uses the new value; the
change is in the audit log.

**Acceptance Scenarios**:

1. **Given** the owner, **When** they open the schedule settings, **Then** they see the effective value (3) and that
   it is the default.
2. **Given** the owner, **When** they set 4, **Then** the value is saved, one audit row records before (3, default)
   and after (4) with the actor, and the next schedule save allows 4 shifts on a day.
3. **Given** a business manager without the permission, **When** they try to change the value, **Then** the request
   is refused with the same `NOT_FOUND` the other schedule routes give a refused actor (no disclosure that the
   business or setting exists) and nothing is written. Owner by default; the owner can grant it to any person (MS-Q2).
4. **Given** a value outside the allowed range, **When** it is submitted, **Then** it is refused with
   `VALIDATION_FAILED`. Allowed range 1 … 4 (MS-Q3); 0, 5 and non-integers are refused.
5. **Given** the same value as today, **When** it is submitted, **Then** the response is the current value and no
   audit row is written (no actual change).

---

### User Story 3 — Eid: 72 hours as consecutive shifts (Priority: P2)

Before Eid, Heba works from Thursday 08:00 to Sunday 08:00 with a few hours' break each night. The manager enters it
as shifts of at most 16 hours with gaps: Thu 08:00–24:00, Fri 03:00–19:00, Fri 21:00–Sat 13:00, Sat 16:00–Sun 08:00.

**Why this priority**: it is how the owner wants long stretches entered; it needs no new rule, only the higher limit
and the existing 16 h cap.

**Independent Test**: save those four shifts across two weeks (Thursday/Friday in one Saturday-week, Saturday in the
next) and confirm each is stored as its own interval of ≤ 16 h.

**Acceptance Scenarios**:

1. **Given** the shifts above, **When** saved, **Then** every shift is ≤ 16 h, the Friday shift that ends Saturday
   keeps Friday as its start day (spec 020), and no day holds more than the limit.
2. **Given** a single shift Thu 08:00 → Fri 08:00, **When** saved, **Then** it is refused with
   `SCHEDULE_SHIFT_INVALID` (over 16 h), exactly as today.
3. **Given** two shifts that touch (Fri 03:00–19:00 then 19:00–Sat 11:00), **When** saved, **Then** they are
   accepted as today. No minimum gap (MS-Q5).

---

### User Story 4 — Lowering the limit later (Priority: P2)

After Eid the owner lowers the limit from 4 to 3 while some weeks still hold 4 shifts on a day.

**Acceptance Scenarios** (MS-Q4):

1. **Given** a stored week with 4 shifts on Thursday, **When** the owner lowers the limit to 3, **Then** the change is
   accepted and the stored week is not touched.
2. **Given** that week, **When** a manager edits only Saturday, **Then** the save succeeds — Thursday did not change.
3. **Given** that week, **When** a manager changes any Thursday shift and Thursday still holds 4, **Then** the save is
   refused with `SCHEDULE_DAY_LIMIT_EXCEEDED`.
4. **Given** a template saved with 4 shifts on a day, **When** it is applied after lowering, **Then** the apply is
   refused before any write; **when** its name only is edited, **Then** the edit succeeds; **when** that day is
   edited, **Then** it must respect the new limit.

### Edge Cases

- A business with no settings row reads the default 3; the first change inserts the row.
- An overnight shift (22:00–06:00) counts on its **start** day only, as today.
- A shift starting on Friday and ending on next Saturday counts on Friday of the current week.
- Two concurrent requests — the owner lowering the limit and a manager saving a 4th shift — are serialized by the
  company lock both take; the later one sees the earlier's result (no 4th shift saved under a limit of 3).
- Apply-template with 20 employee-week copies at the maximum setting: the synchronous cap (SC-Q3, spec 020) was
  measured for 14 shifts per copy; it is re-measured at 4 × 7 = 28 shifts per copy (FR-013).
- A template whose days exceed the limit can still be read and archived.
- The 16 h cap, the overlap exclusion and the past-day reason rule behave exactly as in spec 020.
- An inaccessible or unknown business returns the same not-found response as other schedule endpoints.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The maximum number of shifts that may **start on one day for one employee** MUST be a stored setting,
  with an effective default of **3** where nothing is stored. Scope: per business (MS-Q1).
- **FR-002**: The count MUST stay as in spec 020: by start day (`working_date`), per employee, across all branches.
- **FR-003**: Saving a schedule week MUST refuse a day over the limit with `SCHEDULE_DAY_LIMIT_EXCEEDED`, listing the
  limit and the offending dates, and write nothing.
- **FR-004**: Applying a template MUST check every new copy, and copies of the same employee against each other and
  against stored shifts, against the current limit, and refuse before any write.
- **FR-005**: Creating or editing a template MUST check its weekly pattern against the current limit
  (on edit, only the days the edit changes — MS-Q4).
- **FR-006**: When the limit is lowered, stored schedules and templates MUST NOT be rewritten. A later save is checked
  only on the start days it changes (MS-Q4).
- **FR-007**: One shift MUST stay at most 16 hours (domain check and existing DB CHECK, unchanged).
- **FR-008**: Back-to-back shifts MUST be accepted when they touch or are separated by a gap; no minimum gap is
  enforced (MS-Q5).
- **FR-009**: Only holders of the new permission MUST be able to read the settings screen and change the value;
  default holder the owner, grantable **only by the company owner** to any human person (MS-Q2, same rule as
  `OWNER_GRANTED_PERMISSIONS`, spec 039). Device roles never get it.
- **FR-010**: The value MUST be an integer in **1 … 4** (MS-Q3), enforced by the contract, the domain and a DB CHECK.
- **FR-011**: Every actual change MUST write one audit row in the same transaction (before/after, actor), per
  `CLAUDE.md` §8. A no-op change writes nothing.
- **FR-012**: The schedule grid and template list responses MUST carry the effective limit so the admin "Add shift"
  control follows it; the hard-coded 2 in the admin is removed.
- **FR-013** (`TODO(spec) → MS-Q6`, measured 2026-10-10: 20 × 1 week ≈ 180–200 ms, 2 × 10 weeks ≈ 270–345 ms at
  28 shifts per copy, against ≈ 136 / 169–193 ms at 14): The apply-template synchronous path MUST stay under the 200 ms boundary at the maximum allowed value
  (20 copies × 4 × 7 = 28 shifts per copy). The 20-copy cap is **not** changed by this slice: if the measurement
  exceeds 200 ms, the result is reported to the owner as a question (cap change is owner-visible).
- **FR-014**: The POS and offline flows MUST NOT change; the POS only reads its own week online.

### Key Entities

- **Schedule settings**: one record per business (MS-Q1) holding the max shifts per start day, who changed it last and
  when. Absence means the default 3.
- **Schedule shift** (existing, spec 020): unchanged.

## Slice design *(mandatory — `CLAUDE.md` §1)*

### Chosen design (technical decisions, no owner question)

- **TD-1 Storage in staff.** New staff-owned table, read inside the schedule transaction through the existing
  `ScheduleScope` port. No new import arrow (staff may not import settings — `docs/module-map.md:40`), no ADR.
  See research R3 for the rejected `business_settings` alternative.
- **TD-2 Serialization.** The settings write locks `companies` `FOR NO KEY UPDATE` first, the same lock every schedule
  write takes (`identity/persistence/schedule-access.ts:27-33`), then locks/creates the settings row. Schedule writes
  read the limit **after** their locks.
- **TD-3 Error code.** New `SCHEDULE_DAY_LIMIT_EXCEEDED` (422) with
  `details: { max_shifts_per_day: number, working_dates: string[] }` for schedule saves and template apply, and
  `details: { max_shifts_per_day: number, days: number[] }` (weekday index, 0 = Saturday) for template create/update. `SCHEDULE_SHIFT_INVALID` (400) keeps invalid
  time and > 16 h only; its ar/en text drops "two per day".
- **TD-4 Contract bound.** `schedulePattern` and `staffSchedule.shifts` `.max(14)` become `.max(28)` (7 × 4, the top
  of the MS-Q3 range). The domain enforces the per-day rule.
- **TD-5 Changed days.** A start day is "changed" when its canonical shift set (the six values spec 020 compares) for
  this schedule differs before/after — the same comparison as `requirePastScheduleReason`, extracted to one domain
  helper used by both rules.

### Business rules

- **BR-001**: effective limit = stored value, else 3. Example: a new salon saves 3 Thursday shifts → accepted; a 4th →
  refused.
- **BR-002**: count = shifts of the employee whose `working_date` is that day, in every branch and week, after the
  save. Overnight and Friday→Saturday shifts count on their start day.
- **BR-003** (MS-Q4): only changed start days are checked on schedule saves and template
  edits; template apply checks every day of every new copy.
- **BR-004**: one shift ≤ 16 h (unchanged). An Eid stretch is several shifts, each ≤ 16 h; breaks are the gaps
  between them.
- **BR-005** (MS-Q5): no minimum gap between shifts; touching shifts remain allowed
  (half-open intervals, spec 020).
- **BR-006** (MS-Q3): value integer in 1 … 4.

### Schema changes (expand only)

| Table | Columns | RLS | Indexes | Tenant-qualified FKs |
|---|---|---|---|---|
| `staff_schedule_settings` (new) | `company_id uuid NOT NULL`, `business_id uuid NOT NULL` (MS-Q1), `max_shifts_per_day smallint NOT NULL CHECK (BETWEEN 1 AND 4)` (MS-Q3), `updated_by uuid NOT NULL`, `updated_at timestamptz NOT NULL`. PK `(company_id, business_id)` — one row per business, like `business_settings` | `ENABLE` + `FORCE`; `SELECT`, `INSERT`, `UPDATE` policies for `pospay_app` on `company_id = app_company_id()`; no DELETE | PK covers the lookup; `(updated_by)` for the FK | `(company_id, business_id) → businesses(company_id, id)`; `updated_by → user(id)` |

Grants: `SELECT, INSERT` and `UPDATE (max_shifts_per_day, updated_by, updated_at)` to `pospay_app`; the allowlist in
`packages/db/src/__tests__/privileges.spec.ts` is updated. No change to `staff_schedule_shifts` or its CHECK. No data
backfill: absence = 3.

### API contract

- `GET /v1/businesses/{businessId}/schedule-settings` · `@Require('manage:schedule-settings:business')` · feature
  `staff` → `ScheduleSettings { business_id, max_shifts_per_day, is_default, updated_at | null }`.
- `PUT /v1/businesses/{businessId}/schedule-settings` · same guard · body
  `SetScheduleSettingsInput { max_shifts_per_day: int 1 … 4 }` → `ScheduleSettings`.
- `ScheduleGrid` and `TemplatePage` gain `max_shifts_per_day: int` (read with the existing schedule permissions).
- Zod: `packages/contracts/src/staff/schedule-settings.ts` (+ OpenAPI registration).
- `Idempotency-Key`: not required (no money or stock effect; repeating the same value is a no-op).
- Errors: `SCHEDULE_DAY_LIMIT_EXCEEDED` (422, new), `SCHEDULE_SHIFT_INVALID` (400, text updated),
  `VALIDATION_FAILED` (400), `FORBIDDEN`, `NOT_FOUND`, `FEATURE_DISABLED` as for other schedule routes.

### Permissions

- `manage:schedule-settings:business` — new. Default: owner only (`ROLE_DEFAULTS` = `['owner']`); added to
  `OWNER_GRANTED_PERMISSIONS` (db and identity domain lists), so a personal ALLOW is granted only by the company owner
  (`PERMISSION_OWNER_ONLY` otherwise), to any human role, never a device role (MS-Q2, spec 039 pattern).
- Existing `read/manage:schedules:*` unchanged; they see the effective value in grid/template responses.

### Events

- None published (no consumer; the audit row is the record). None consumed.

### Admin UI

- Schedules page: a small "Schedule settings" panel, shown only with the permission, with a number field and Save.
- Edit dialog: "Add shift" disabled at the effective limit; ar/en labels from `packages/i18n`.

### Test plan

- **Domain unit**: limit 1/3/4; third and fourth shift on a day; employee-wide count with other-branch shifts;
  overnight and Friday→Saturday counted on the start day; changed-days helper (unchanged excess day passes, changed
  excess day fails, removed shift counts as change); template apply checks all days; range validation; 16 h unchanged;
  touching shifts allowed.
- **Integration** (T2 Postgres, cloned DB per spec file): `MS-01` default 3 accepted / 4th refused · `MS-02` owner sets
  4, next save allows 4, audit row before/after · `MS-03` no-op change writes no audit · `MS-04` non-holder refused,
  owner-granted person allowed, device role refused · `MS-05` lowering keeps stored rows, unchanged-day edit passes,
  changed-day edit refused · `MS-06` template apply over the limit refused before any write · `MS-07` concurrent lower
  vs save serialized (no excess row) · `MS-08` Eid stretch across two weeks saved · `MS-09` out-of-range value (0, 5) refused.
- **RLS negative**: `staff_schedule_settings` cross-tenant read = 0 rows, insert/update with another `company_id`
  rejected, FK to another tenant's business rejected.
- **Queries**: grid and template page result-shape tests include `max_shifts_per_day`; `EXPLAIN ANALYZE` asserts the
  settings lookup uses the primary key.
- **Performance**: apply-template 20 copies × 28 shifts measured against 200 ms (FR-013); result recorded in the PR.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A manager can enter three shifts on one day for an employee on the first try, with no setting changed.
- **SC-002**: The owner changes the limit in under one minute, and the next save follows the new value immediately.
- **SC-003**: A 72-hour holiday stretch can be entered as consecutive shifts in one sitting, with every shift ≤ 16 h.
- **SC-004**: No stored schedule is changed or lost when the owner changes the limit.
- **SC-005**: 100 % of limit changes appear in the audit log with who and when.

## Assumptions

- Default 3 applies to every existing and new business without a migration backfill (owner decision).
- The 16 h cap stays fixed and is not a setting (owner decision).
- Settings changes are always audited (`CLAUDE.md` §8) — not asked.
- The POS needs nothing offline; personal staff access is online-only (ADR-0019/0027).
- Attendance, hours and commission logic are unchanged: attendance already matches any number of shifts per day, and
  attendance never changes commission (`docs/module-map.md:159`).
- Row 16b (break window) changes the same schedule files; the two slices are landed one after the other (research R6).
