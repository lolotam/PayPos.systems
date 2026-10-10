# Research — 042 max shifts per day becomes an owner setting (Phase 1 row 16c)

Stage 1 research, 2026-10-10, on `main` 043c68da. Owner decision: `docs/specs/phase-1/owner-review-2026-10-09.ar.md`
§S020-SHIFTS. Builds on row 16 (spec `docs/specs/020-staff-schedules/spec.md`, PR 89).

## R1. Where the fixed "2" lives today

The limit is enforced **only in TypeScript**. No database constraint counts shifts per day.

| Place | `file:line` | What it does |
|---|---|---|
| Spec 020 | `docs/specs/020-staff-schedules/spec.md:10` | "At most two shifts may start on a day." |
| Domain, weekly pattern | `apps/api/src/modules/staff/domain/schedules.ts:26-27` | `validateSchedulePattern` counts per `day` index and throws `SCHEDULE_SHIFT_INVALID` above 2. Used by set-schedule (via `materializeSchedule`), create/update template and apply template. |
| Domain, JSDoc | `apps/api/src/modules/staff/domain/schedules.ts:15` | Doc comment says "بوردية أو اثنتين" — must move with the code (§3.1). |
| Domain, employee-wide day count | `apps/api/src/modules/staff/domain/schedules.ts:130-133` | `validateScheduleOverlap` counts the new shifts **plus the employee's other saved shifts in every branch and week** per `working_date`, and throws `SCHEDULE_SHIFT_INVALID` above 2. So the limit is per employee per start day, across branches. |
| Contract, request | `packages/contracts/src/staff/schedules.ts:14` | `schedulePattern = z.array(scheduleShift).max(14)` — 14 = 2 × 7. Used by `setScheduleInput`, `templateTerms`, `updateTemplateInput`, `shiftTemplate`. |
| Contract, response | `packages/contracts/src/staff/schedules.ts:40` | `staffSchedule.shifts.max(14)`. Reused by `scheduleGrid`, `scheduleWeekResult`, `applyTemplateResult` and the POS `personalSchedule` (`packages/contracts/src/staff/passkeys.ts:97-99`). |
| Error text | `packages/i18n/src/ar.ts:175`, `packages/i18n/src/en.ts:175` | `SCHEDULE_SHIFT_INVALID` says "الحد ورديتان في اليوم…" / "Use up to two shifts per day…". The one code covers bad time, >16 h **and** >2 per day. |
| Error status | `apps/api/src/shared/errors.ts:56` | `SCHEDULE_SHIFT_INVALID: 400`. |
| Admin UI | `apps/admin/src/staff/ui/schedule-shift-fields.tsx:44` | "Add shift" button disabled at `fields.length >= 2`; second default shift 14:00–18:00 (`:48-49`). |
| Domain tests | `apps/api/src/modules/staff/domain/__tests__/schedules.spec.ts:87,101` | Assert the third shift on a day is refused. |

There is **no admin screen for templates** yet (only API); `apps/admin/src/staff/**` has the branch grid and edit
dialog only.

## R2. Where the 16 h cap lives (unchanged by this row)

- DB: `staff_schedule_shifts_duration` CHECK, `packages/db/migrations/0056_2026-10-03_staff-schedules.sql:13`
  (`ends_at <= starts_at + interval '16 hours'`).
- Domain: `schedules.ts:31` (`duration > 960` local minutes) and `schedules.ts:62` (`> 57_600_000` ms across DST).
- Attendance: `apps/api/src/modules/staff/domain/clock-attendance.ts:46,128` (an open session older than 16 h becomes
  `MISSED_IN` / missed-out deadline), `attendance-correction.ts:80`.
- Worker not-clocked-in scan relies on it: `apps/worker/src/modules/staff/persistence/not-clocked-in.transactions.ts:36,53`.

The owner keeps 16 h. Nothing here changes. This is what makes "72 h at Eid = several shifts" safe: every
consumer above already assumes a shift is ≤ 16 h.

## R3. Where settings live today

- `business_settings` table (`packages/db/schema/settings.ts:21-57`, migration 0022), owned by the `settings` module
  (`apps/api/src/modules/settings/**`). One row per business, `null` = vertical-template default. Guarded by
  `read/manage:settings:business` (default holders owner, general_manager, business_manager — `packages/db/src/role-defaults.ts:4,92-93`).
- **`staff` may not import `settings`.** `docs/module-map.md` §2 lists `staff → tenancy, identity, files` only
  (`docs/module-map.md:40`). ADR-0010 names two future ports from staff to settings (`AlertRulesPort`,
  `StaffColumnsPort`, `docs/module-map.md:110`), neither implemented.
- No company-level or staff-level settings table exists.

**Decision (TD-1, technical, not an owner question):** the setting is stored in a **new staff-owned table**
`staff_schedule_settings`, keyed by the scope the owner picks in MS-Q1 (recommended: business). Reasons:
1. no new import arrow, port or ADR; the schedule use cases read it in the **same tenant transaction** they already
   run, through the existing `ScheduleScope` port;
2. a schedule write already locks the `companies` row `FOR NO KEY UPDATE`
   (`apps/api/src/modules/identity/persistence/schedule-access.ts:27-33`). The settings write takes the same lock first,
   so lowering the limit and saving a schedule can never interleave.

Rejected alternative: a column on `business_settings` + a new `ScheduleLimitsPort` from staff to settings. It needs a
module-map amendment and ADR, a second transaction boundary or a cross-module table read, and the settings module's
"template first, null = default" layer adds nothing here (the default 3 is the owner's, not a vertical's).

## R4. Callers that must pass the limit

| Use case | `file:line` | Change |
|---|---|---|
| set-schedule | `apps/api/src/modules/staff/use-cases/set-schedule/set-schedule.usecase.ts:36-42` | read limit from `scope`, pass to `materializeSchedule` and the day-count check. |
| apply-shift-template | `apps/api/src/modules/staff/use-cases/apply-shift-template/apply-shift-template.usecase.ts:53-69,98` | same, for every copy and for copies of the same employee against each other. |
| create-shift-template | `.../create-shift-template/create-shift-template.usecase.ts:17` | `validateSchedulePattern(shifts, limit)`. |
| update-shift-template | `.../update-shift-template/update-shift-template.usecase.ts:16` | same, changed days only if MS-Q4 = A. |
| port | `apps/api/src/modules/staff/ports/schedules.port.ts:25-32` | `branch()` context (or a new `scheduleLimit(businessId)`) returns `max_shifts_per_day`. |
| persistence | `apps/api/src/modules/staff/persistence/drizzle-schedules.ts:59`, `schedule-context.adapter.ts` | read the row (absent row = 3). |
| queries | `apps/api/src/modules/staff/queries/schedule-week.query.ts`, `shift-templates.query.ts` | add `max_shifts_per_day` to the grid and template page so the admin button follows it. |

## R5. What could break

| Area | Risk | Finding |
|---|---|---|
| Rows already stored | Schedules saved under the old rule have ≤ 2 per day. Raising to 3 breaks nothing. **Lowering** (to 1 or 2 later) leaves weeks that exceed the new limit. | Behaviour on lowering is MS-Q4. The recommendation never rewrites stored rows. |
| Templates stored as jsonb | `staff_shift_templates.shifts` has no CHECK; a template saved with 3/day can exist when the limit is later lowered. | MS-Q4 covers it: applying such a template after lowering is refused with the new error. |
| Open attendance / shifts in progress | None. Attendance matches "the current shift, else the first shift starting that day" (`clock-attendance.ts:207-219`, AT-Q5) and works for any count. Schedules never change attendance (spec 020). | No change. |
| Hours / commission | Attendance never changes commission (`docs/module-map.md:159`); commissions come from orders. Hours come from clock-in/out sessions, each capped at 16 h. A third shift a day adds a third session, nothing else. | No change. This is why the owner wants the Eid 72 h as separate ≤ 16 h shifts. |
| Offline POS | The POS never writes schedules. It only reads its own week online (`apps/pos/src/personal-staff/**`, `personalSchedule`); ADR-0019/0027 keep personal staff access online-only. | No offline need. The POS generated types widen with the response array bound (regenerate `apps/pos/src/shared/api/schema.d.ts`). |
| Reports | No report reads schedules yet (PRs 22/24 recompute attendance later). | Later reports must not assume ≤ 2 per day. |
| Worker not-clocked-in alert | Reads shifts in a 16 h window by `starts_at` (`not-clocked-in.transactions.ts:49-53`); count-agnostic. | No change. |
| Apply-template performance | The 20 employee-week synchronous cap (SC-Q3) was set for ≤ 14 shifts per copy; 20×12×14 measured 897 ms (spec 020). With 3/day a copy holds 21 shifts, with the maximum setting up to 7×max. | **Risk.** The implementation must re-measure 20 copies × 7×max shifts. If it crosses 200 ms the cap must change, which is owner-visible → the orchestrator asks before merging. |
| Error code | `SCHEDULE_SHIFT_INVALID` (400) mixes three rules; its text hardcodes "two". | TD-3: new `SCHEDULE_DAY_LIMIT_EXCEEDED` (422) with the limit and the offending dates; the old code keeps time/duration only, text updated in ar/en. Clients that matched the old code for the count case get the new one; the admin is the only client. |
| Contract bound | `.max(14)` in request and response. | TD-4: bound = 7 × the top of the allowed range (MS-Q3; 42 if 1–6). The real per-day rule stays in the domain. |

## R6. Files expected to change at implementation (for ordering against 16b)

**Shared with 16b (break window, same module) — high overlap risk, serialize or rebase carefully:**
- `apps/api/src/modules/staff/domain/schedules.ts` (16b adds break validation to the same pattern / materialize functions)
- `apps/api/src/modules/staff/domain/schedule-types.ts`
- `apps/api/src/modules/staff/domain/__tests__/schedules.spec.ts`
- `packages/contracts/src/staff/schedules.ts` (16b extends `scheduleShift`; 16c changes `.max(14)` and adds the setting)
- `apps/api/src/modules/staff/use-cases/set-schedule/set-schedule.usecase.ts`
- `apps/api/src/modules/staff/use-cases/apply-shift-template/apply-shift-template.usecase.ts`
- `apps/api/src/modules/staff/use-cases/create-shift-template/create-shift-template.usecase.ts`
- `apps/api/src/modules/staff/use-cases/update-shift-template/update-shift-template.usecase.ts`
- `apps/api/src/modules/staff/ports/schedules.port.ts`
- `apps/api/src/modules/staff/persistence/drizzle-schedules.ts`, `schedule-records.ts`, `schedule-batch-records.ts`
- `apps/api/src/modules/staff/queries/schedule-week.query.ts`, `shift-templates.query.ts`
- `apps/admin/src/staff/ui/schedule-shift-fields.tsx`, `apps/admin/src/staff/model/schedule-form.ts`
- `packages/i18n/src/ar.ts`, `packages/i18n/src/en.ts` (schedule error and label keys)
- `apps/admin/src/shared/api/schema.d.ts`, `apps/pos/src/shared/api/schema.d.ts`, `packages/contracts/src/generated/**` (regenerated)
- `packages/db/src/__tests__/privileges.spec.ts` (both add grants), `packages/db/migrations/meta/_journal.json`

**16c only:**
- `packages/db/schema/staff-schedule-settings.ts` (new) + `packages/db/schema/index.ts`
- `packages/db/migrations/NNNN_…_staff-schedule-settings.sql` + `…-rls.sql` (numbers assigned at merge)
- `packages/db/src/role-defaults.ts` (new permission, owner default, grantable — MS-Q2)
- `packages/contracts/src/staff/schedule-settings.ts` (+ `-openapi.ts`), `packages/contracts/src/staff/staff-openapi.ts`, `packages/contracts/src/index.ts`
- `apps/api/src/modules/staff/domain/schedule-settings.ts` (new: range + changed-days helpers)
- `apps/api/src/modules/staff/use-cases/set-schedule-settings/` (new use case)
- `apps/api/src/modules/staff/http/schedule-settings.controller.ts` (new), `staff.module.ts`
- `apps/api/src/modules/staff/persistence/schedule-settings.adapter.ts` (new)
- `apps/api/src/shared/errors.ts` (new code)
- `apps/admin/src/staff/ui/schedule-settings-panel.tsx` (new), `apps/admin/src/staff/api/use-schedule-settings.ts` (new), `apps/admin/src/staff/pages/schedules-page.tsx`
- tests: `apps/api/src/modules/staff/__tests__/schedule-settings*.spec.ts`, RLS negative, query shape/EXPLAIN

**Recommended order:** land 16b first (it touches the shared pattern shape), then rebase 16c; or land 16c first and let
16b rebase — either way **not in parallel**, because both rewrite `domain/schedules.ts` and `contracts/staff/schedules.ts`.

## R7. Open owner questions

MS-Q1 scope · MS-Q2 who changes it · MS-Q3 allowed range · MS-Q4 lowering with existing schedules/templates ·
MS-Q5 minimum gap between back-to-back shifts. See `owner-questions.ar.md`.

Not asked (already decided or not a business rule): the 16 h cap (owner: stays 16 h); auditing the setting change
(always, `CLAUDE.md` §8); the default 3 for every existing business (owner); POS offline (not needed, R5);
the count stays employee-wide across branches by start day (spec 020, unchanged).

## R8. After the owner's answers (2026-10-10)

- MS-Q1 per business · MS-Q2 owner default, owner-only grant to any human (spec 039 pattern) · MS-Q3 **1 … 4** ·
  MS-Q4 stored rows stay, changed days only, template apply checks all days · MS-Q5 no minimum gap.
- Consequences: DB CHECK `BETWEEN 1 AND 4`; contract bound `.max(28)` (7 × 4) instead of 42 (R5 row "Contract
  bound"); the FR-013 re-measure is 20 copies × 28 shifts (560 shift rows), against 20 × 14 = 280 today.
- No open `NEEDS CLARIFICATION` remains for planning.
