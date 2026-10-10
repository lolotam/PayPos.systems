# Research — 047 max shifts per day becomes a per-branch setting (row 16c-2)

Baseline: `main` at `720a8397` (16c #143, 21b #144 and 16b-1 #146 merged). Row 16b-2 is open in PR #147.
Rows 26a/26b/26c run in parallel (specs 044–046, migrations from 0111); this slice touches none of their files.

## R0. Owner decision being implemented

On 2026-10-10 Waleed changed MS-Q1 (`docs/specs/042-staff-max-shifts-setting/owner-questions.ar.md`) to the
partner's pick, «كل فرع لوحده»: each branch has its own number. These 16c answers stay binding and are not asked again:
the range 1 … 4 (MS-Q3), owner-only permission grantable by the owner (MS-Q2), stored rows untouched and the limit
checked only on changed days (MS-Q4), no minimum gap (MS-Q5), the 20-copy apply cap (MS-Q6, issue #145), default 3.

## R1. What exists today (16c, spec 042)

| What | Where |
|---|---|
| Table `staff_schedule_settings`, PK `(company_id, business_id)`, CHECK 1 … 4, FK to `businesses` | `packages/db/schema/staff-schedule-settings.ts:15-40`, migration `0103_2026-10-10_staff-schedule-settings.sql` |
| RLS (SELECT/INSERT/UPDATE, no DELETE) and grants `SELECT, INSERT` + `UPDATE (max_shifts_per_day, updated_by, updated_at)` | `0104_2026-10-10_staff-schedule-settings-rls.sql` |
| Permission `manage:schedule-settings:business`, owner role only | `0105_2026-10-10_schedule-settings-permission.sql`; `apps/api/src/modules/identity/domain/permission-edit.ts:5-10` (`OWNER_GRANTED_PERMISSIONS`); `apps/api/src/modules/identity/persistence/schedule-access.ts:40-41` (action `settings`) |
| Default 3 and range | `apps/api/src/modules/staff/domain/schedule-settings.ts:4,13` |
| Limit read inside the schedule transaction, **by business** | `apps/api/src/modules/staff/persistence/drizzle-schedules.ts:61-66` (`maxShiftsPerDay(businessId)`); port `ports/schedules.port.ts:31` |
| Week save: limit, then count across branches on changed days | `use-cases/set-schedule/set-schedule.usecase.ts:41-54`; `domain/schedules.ts:218-248` (`validateScheduleOverlap` counts `shifts` + `others`, `others` = the employee's shifts in **every** branch and week, `persistence/schedule-records.ts:46-60`) |
| Template apply: one limit for all targets of one branch | `use-cases/apply-shift-template/apply-shift-template.usecase.ts:44,57,75-79,108` |
| Template create/update: pattern checked against the business limit | `use-cases/create-shift-template/create-shift-template.usecase.ts:17-18`; `use-cases/update-shift-template/update-shift-template.usecase.ts:17-22` |
| Settings read/write | `queries/schedule-settings.query.ts:15-35`; `persistence/schedule-settings.adapter.ts:44-94` (locks the row `FOR UPDATE`, upsert + audit entity `staff_schedule_settings`); `http/schedule-settings.controller.ts` (`GET`/`PUT /v1/businesses/{businessId}/schedule-settings`) |
| Grid and template page carry the limit | `queries/schedule-week.query.ts:47` (business value); `queries/shift-templates.query.ts:19`; contracts `packages/contracts/src/staff/schedules.ts:87,116` |
| Contract | `packages/contracts/src/staff/schedule-settings.ts` (`ScheduleSettings { business_id, max_shifts_per_day, is_default, updated_at }`) |
| Admin | `apps/admin/src/staff/ui/schedule-settings-panel.tsx` (one number for the business, on the branch schedules page `pages/schedules-page.tsx:31`); "Add shift" follows `ScheduleLimitContext` (`model/schedule-form.ts:66`, `pages/schedules-page.tsx:59`, `ui/schedule-shift-fields.tsx:12`) |
| Templates have **no admin UI** yet; they are API-only and business-wide (`staff_shift_templates` has no `branch_id`, `packages/db/schema/staff-schedules.ts:103-123`) |

Data today: staging only (production and the salon trial have not started — row 63). A business row exists only
where someone changed the value; absence means 3.

## R2. Storage — keep the business row or replace it (MB-Q2)

- **Option A (recommended, pure expand):** keep `staff_schedule_settings` as the business number and add
  `staff_branch_schedule_settings` with one row per branch that has its own number. Effective limit for a branch =
  branch row, else business row, else 3. No data moves, no contract migration, the 16c endpoints keep working,
  a rollback to the 16c image only loses the overrides (it still reads the business row).
- **Option B (replace):** new branch table; a data step copies each business row to every branch of that business
  (ADR-0038 marker step, because it writes tenant rows); a later release drops `staff_schedule_settings` and the old
  routes (contract). Two releases, a data step, and a new branch silently starts at 3.
- Either way the branch table is: `company_id`, `business_id`, `branch_id`, `max_shifts_per_day smallint CHECK 1 … 4`,
  `updated_by`, `updated_at`; PK `(company_id, branch_id)`; FK `(company_id, business_id, branch_id) →
  branches(company_id, business_id, id)` (unique `branches_company_business_id_key`,
  `packages/db/schema/tenancy.ts:119`); FK `updated_by → user(id)` with its index; ENABLE + FORCE RLS; a negative
  isolation test. Option A also needs `DELETE` (policy + grant) so a branch can go back to the business number.

## R3. Counting across branches (MB-Q1 — the key question)

`others` already carries `branch_id` (`schedule-records.ts:51`), so every rule below is a pure domain change in
`validateScheduleOverlap`; overlap checking stays across all branches whatever the answer.

| Rule | سارة: Hawalli (limit 4) has 2 Thursday shifts; Salmiya (limit 2) adds 1 | Order-independent? |
|---|---|---|
| A. Each branch counts only its own shifts against its own limit | accepted (Salmiya holds 1 ≤ 2) | yes |
| B. Count all her shifts of the day against the saving branch's limit | refused (3 > 2); the same day saved from Hawalli last is accepted (3 ≤ 4) | **no** |
| C. Count all against the smallest limit of the branches she works in that day | refused (3 > 2); Hawalli is also capped at 2 once she has a Salmiya shift | yes |

Rule A drops 16c's "across branches" count (spec 042 FR-002, US1-3); B and C keep it. Under A the total in a day is
still bounded by the no-overlap rule and 16 h per shift.

## R4. Templates (MB-Q3)

Templates are business-wide (no branch). Today the pattern is checked on create/update against the business limit.
With branch numbers there is no single limit at save time. Options: the largest effective limit in the business (a
template is saved if it fits at least one branch; apply checks the target branch), the smallest (fits everywhere),
or no count check at save (apply checks). Apply always uses the target branch's number (`input.branch_id`).

## R5. API and admin

- `GET /v1/businesses/{businessId}/schedule-settings` keeps its fields and gains `branches[]` (additive, non-breaking):
  `{ branch_id, name_en, name_ar, max_shifts_per_day, source: 'branch' | 'business' | 'default', updated_at }`.
- New `PUT /v1/businesses/{businessId}/branches/{branchId}/schedule-settings` (`{ max_shifts_per_day }`) and, under
  MB-Q2 A, `DELETE` on the same path (back to the business number). Same guard `manage:schedule-settings:business`
  (MS-Q2 unchanged; a grant still covers all branches of the business).
- `ScheduleGrid.max_shifts_per_day` becomes the branch's effective number (same field, new meaning);
  `TemplatePage.max_shifts_per_day` follows MB-Q3.
- Admin: the panel on the branch schedules page shows the business number and this branch's number ("uses the
  business number" / own number), plus a read-only list of all branches.
- Serialization: the branch write takes the same `companies FOR NO KEY UPDATE` lock as schedule writes
  (`identity/persistence/schedule-access.ts`), then locks the branch row; schedule writes read the limit after their
  locks (unchanged TD-2 of spec 042).

## R6. What could break

- **Stored schedules:** never rewritten (MS-Q4). A branch whose number is lowered below a stored day only blocks
  changes to that day.
- **Rule change under MB-Q1 A:** a save that 16c refused (cross-branch total over the limit) becomes accepted. No
  stored row becomes invalid. Under B/C nothing previously accepted is refused unless a day is changed.
- **Templates:** under MB-Q3 A a template saved today stays valid; under "smallest", a template may become
  un-editable on its excess days until fixed (same MS-Q4 rule).
- **Offline POS:** unaffected — the POS only reads its own week online (`read-my-schedule`).
- **Attendance, hours, commission:** unaffected — the limit is a write-time check only; attendance matches any number
  of shifts (spec 042 Assumptions). 16b-2 (#147) does not read the limit.
- **Performance:** apply-template still at most 20 copies × 28 shifts; one extra indexed lookup per request.
- **Rolling deploy:** the old admin keeps calling the business endpoints, which stay (expand only under MB-Q2 A).
- **Inactive branch:** a row may exist for a deactivated branch; it is ignored by the grid (branch not active).

## R7. Files expected to change at implementation

- `packages/db/schema/staff-schedule-settings.ts` (new `staffBranchScheduleSettings`), `packages/db/schema/index.ts`,
  two migrations (table; RLS + grants) at the next free numbers after 26a–26c, `meta/_journal.json` + snapshot,
  `packages/db/src/__tests__/privileges.spec.ts`, `packages/db/test/schedule-grants.ts`
- `apps/api/src/modules/staff/domain/schedule-settings.ts`, `domain/schedules.ts` (`validateScheduleOverlap` per MB-Q1)
  + their unit tests
- `ports/schedules.port.ts` (`maxShiftsPerDay(businessId, branchId)`, template limit), `ports/schedule-settings.port.ts`
- `persistence/drizzle-schedules.ts`, `persistence/schedule-settings.adapter.ts`
- `use-cases/set-schedule`, `apply-shift-template`, `create-shift-template`, `update-shift-template`,
  new `use-cases/set-branch-schedule-settings/` (+ clear, under MB-Q2 A)
- `queries/schedule-settings.query.ts`, `queries/schedule-week.query.ts:47`, `queries/shift-templates.query.ts:19`
- `http/schedule-settings.controller.ts` (or a new branch controller), `staff.module.ts`
- `packages/contracts/src/staff/schedule-settings.ts`, `schedule-settings-openapi.ts`, `openapi/openapi.json`,
  `apps/admin/src/shared/api/schema.d.ts`, `apps/pos/src/shared/api/schema.d.ts` (generated)
- `packages/i18n/src/schedule-shell-catalog.ts`
- `apps/admin/src/staff/ui/schedule-settings-panel.tsx`, `api/use-schedule-settings.ts` (+ specs)
- tests: `apps/api/src/modules/staff/__tests__/schedule-settings*.spec.ts`, `schedule-batch.spec.ts`,
  `schedule-queries.spec.ts`

## R8. Overlap with other open work

- **16b-2 (PR #147):** touches `domain/clock-attendance.ts`, `persistence/attendance-context.adapter.ts`,
  `ports/clock-attendance.port.ts`, `ports/clock-by-card.port.ts` and spec 041 docs. **No shared file** with this slice.
- **16d (spec 048, same day):** both change `queries/schedule-week.query.ts` (`branchScheduleStatement`: 16c-2 the
  limit sub-select, 16d the row projection), `packages/contracts/src/staff/schedules.ts` (grid), the admin schedule
  editor (`pages/schedules-page.tsx`, `model/schedule-form.ts`, `ui/schedule-shift-fields.tsx`), the generated
  OpenAPI/`schema.d.ts`, `privileges.spec.ts` and migration numbering. Land one after the other; 16c-2 first is the
  smaller rebase (its grid change is one sub-select).
- **26a–26c:** no shared file; only migration numbering (they own 0111+).
