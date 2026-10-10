# Research — 048 default working hours and break on the employee profile (row 16d)

Baseline: `main` at `720a8397` (16c #143, 21b #144, 16b-1 #146 merged). Row 16b-2 is open in PR #147; row 16c-2
(spec 047) is specified the same day. Rows 26a–26c run in parallel (specs 044–046, migrations from 0111).

## R0. The request

Partner (أبو سالم), comment on BW-Q4 (spec 041), verbatim:
«شوف البريك يحدده المالك كم مدته وايضا انت ممكن يكون الدوام ١٢ ساعه مو ٨ ساعات هذا ايضا يحدده المالك في قائمة اداخل الموظفين وساعات العمل والبريك».
Waleed approved on 2026-10-10: «نضيف الدوام الافتراضي في ملف الموظفة» — the owner sets each employee's daily
working hours and break on her profile, and they **pre-fill** the schedule.

Already binding and not asked again: the break **counts** as working hours (BW-Q4, spec 041); a break is optional
(BW-Q2), at most one per shift (BW-Q3), strictly inside the shift (BW-Q6); one shift ≤ 16 h (S020-SHIFTS).

## R1. What exists today

| What | Where |
|---|---|
| Employee record: no hours or break field | `packages/db/schema/staff.ts:55-115` (`employees`); contract `packages/contracts/src/staff/employee.ts:28-52`, `update-employee.ts:13-22` |
| Update use case (revision, branch moves, name-match) | `apps/api/src/modules/staff/use-cases/update-employee/update-employee.usecase.ts:16-46`; column grant `0050_2026-10-03_staff-update-employee-rls.sql:4-5` |
| Profile access: `manage:employees:business` (owner, general manager, business manager — `0058_…system-role-default-bundles.sql:111-113`) | `apps/api/src/modules/identity/persistence/employee-scope-access.ts:49,88` |
| Separate profile sections with their own endpoint and permission (salary 021, IBAN 040) | `apps/admin/src/staff/ui/employee-record-sections.tsx:7-24`; `http/employee-iban.controller.ts:36-75`; `use-cases/set-employee-iban/` |
| Owner-only-but-grantable permissions | `apps/api/src/modules/identity/domain/permission-edit.ts:5-10` (`OWNER_GRANTED_PERMISSIONS`), `packages/db/src/role-defaults.ts:39` (spec 039, 042 MS-Q2) |
| Break on a shift (16b-1): `break_start` / `break_end` local `HH:mm`, optional, inside the shift | `packages/contracts/src/staff/schedules.ts:8-29`; `apps/api/src/modules/staff/domain/schedules.ts:30-92` (`validateSchedulePattern`, `validateShiftBreak`); migrations `0109`/`0110` |
| Schedule editor: a new shift is hard-coded 09:00–13:00, 14:00–18:00, 19:00–23:00, 00:00–04:00 by position | `apps/admin/src/staff/model/schedule-form.ts:68-77` (`newScheduleShift`), used by `ui/schedule-shift-fields.tsx:50` |
| New break suggestion: 13:00–14:00, else the middle third | `model/schedule-form.ts:46-63` (`newScheduleBreak`), used by `ui/schedule-shift-break-fields.tsx:13` |
| Editor form starts from the grid row | `model/use-schedule-editor.ts:19` (`scheduleFormDefaults(row, week)`); grid row = `{ employee_id, name_en, name_ar, schedule }` (`packages/contracts/src/staff/schedules.ts:74-81`), built in `queries/schedule-week.query.ts:31-48` |
| Templates: business-wide patterns, **API only**, no admin UI | `staff_shift_templates` (`packages/db/schema/staff-schedules.ts:103-123`); no template screen under `apps/admin/src/staff/` |
| Hours reporting: none yet — row 27 (attendance board + monthly report) is not built | `docs/specs/phase-1/IMPLEMENTATION-PLAN.md:76` |
| Employee import (spec 030) has no hours column | `packages/contracts/src/staff/employee-import.ts` |

## R2. Storage

- **Decision (technical):** a new staff table `employee_default_shifts`, one row per employee per weekday she works:
  `company_id`, `business_id`, `employee_id`, `day smallint 0 … 6` (0 = Saturday, as schedules), `start time`,
  `end time`, `break_start time NULL`, `break_end time NULL`, `updated_by`, `updated_at`; PK
  `(company_id, employee_id, day)`; FK `(company_id, business_id, employee_id) → employees(company_id, business_id, id)`.
  A missing day = no default that day.
- **Why a table and not columns on `employees`:** the same shape covers every DH-Q2 answer (same hours every day,
  off days, or different hours per weekday); the employee update use case, its revision, its column grant and the
  name-match flow (8b) stay untouched; the section saves on its own like salary and IBAN.
- **Validation:** the existing pure `validateSchedulePattern(shifts, 1)` already enforces one shift per day, ≤ 16 h,
  overnight, and the break inside the shift — the default is validated by exactly the schedule rules.
- If DH-Q1 picks "hours + break minutes", the columns become `minutes smallint`, `break_minutes smallint` (and
  maybe `start`); the end and the break position are then computed by one shared function in `packages/domain`
  (used by the API and the admin, `CLAUDE.md` §7).

## R3. How pre-fill can work

- The grid row gains `default_shifts` (read with the existing `read:schedules:*`), so the editor needs no new request.
- "Add shift" on a day with no shift → her default for that day (times and break) instead of 09:00–13:00; a second
  shift keeps today's suggestions. The break of a pre-filled shift is her default break, not 13:00–14:00.
- Optional "Fill the week from her default hours" fills every empty working day (needs off days, DH-Q2).
- Pre-fill writes nothing: the manager still saves the week, through `set-schedule` with all its checks (limit,
  overlap, past-day reason, eligibility). Changing a default never changes a saved schedule.
- Templates are business patterns, not per employee, and have no admin UI: they do not pre-fill from the profile.
- The POS (`read-my-schedule`) is unchanged.

## R4. What could break

- **Existing employees:** have no default; the editor behaves exactly as today (DH-Q6).
- **Stored schedules / templates:** never touched.
- **Hours and commission:** unchanged — attendance and reports read the saved schedule and the clock sessions, not
  the default (unless DH-Q4 adds a "contracted hours" column to row 27). Attendance never changes commission
  (`docs/module-map.md:159`).
- **Offline POS:** unaffected.
- **Branch time zones:** defaults are local `HH:mm`, like templates; they are applied in whichever branch is edited.
- **Size of the grid query:** one extra `jsonb_agg` per employee row over at most 7 rows by PK — negligible; the
  `EXPLAIN` test covers it.

## R5. Files expected to change at implementation

- `packages/db/schema/staff-default-shifts.ts` (new), `schema/index.ts`, two migrations (table; RLS + grants) at the
  next free numbers, `meta/_journal.json` + snapshot, `packages/db/src/__tests__/privileges.spec.ts`
- if DH-Q5 = owner-only: a permission migration, `packages/db/src/role-defaults.ts`,
  `apps/api/src/modules/identity/domain/permission-edit.ts` (`OWNER_GRANTED_PERMISSIONS`), an identity access
  reader, `packages/i18n/src/permission-codes-catalog.ts`, `permission-name.ts`
- API: `domain/employee-default-shifts.ts` (+ unit tests), `ports/employee-default-shifts.port.ts`,
  `persistence/employee-default-shifts.adapter.ts`, `use-cases/set-employee-default-shifts/`,
  `queries/employee-default-shifts.query.ts`, `queries/schedule-week.query.ts` (grid row projection),
  `http/employee-default-shifts.controller.ts`, `staff.module.ts`
- Contracts: `packages/contracts/src/staff/employee-default-shifts.ts` (+ OpenAPI), `staff/schedules.ts`
  (`ScheduleGridRow.default_shifts`), `openapi/openapi.json`, `apps/admin/src/shared/api/schema.d.ts`,
  `apps/pos/src/shared/api/schema.d.ts` (generated)
- Admin: `ui/employee-default-hours-section.tsx` + form (new), `api/use-employee-default-hours.ts` (new),
  `ui/employee-record-sections.tsx`, `model/schedule-form.ts` (`newScheduleShift`, `newScheduleBreak`),
  `ui/schedule-shift-fields.tsx`, `ui/schedule-shift-break-fields.tsx`, `ui/schedule-day-form.tsx` or
  `ui/schedule-edit-dialog.tsx` (fill-week button), `model/use-schedule-editor.ts`; i18n `schedule-shell-catalog.ts`
  and the employee catalog
- Tests: new integration spec + RLS negative spec under `apps/api/src/modules/staff/__tests__/`,
  `schedule-queries.spec.ts` (grid shape), admin specs for the section and the pre-fill

## R6. Overlap with other open work

- **16c-2 (spec 047):** both edit `queries/schedule-week.query.ts` (`branchScheduleStatement`: 16c-2 the limit
  sub-select, 16d the row projection), `packages/contracts/src/staff/schedules.ts`, the admin editor
  (`model/schedule-form.ts`, `ui/schedule-shift-fields.tsx`, `pages/schedules-page.tsx`), generated
  OpenAPI/`schema.d.ts`, `privileges.spec.ts` and migration numbering. Land 16c-2 first (smaller), then rebase 16d.
- **16b-2 (PR #147):** attendance files only (`domain/clock-attendance.ts`, `persistence/attendance-context.adapter.ts`,
  `ports/clock-attendance.port.ts`, `ports/clock-by-card.port.ts`) and spec 041 docs. **No shared file.** Semantic link
  only: a pre-filled break is a normal 16b break, so 16b-2's return-from-break lateness applies to it unchanged.
- **26a–26c:** no shared file; migration numbering only.
- **Row 27 (not started):** consumes this only if DH-Q4 says so.
