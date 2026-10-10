# Research — 041 fixed break window per shift (row 16b)

Base: `main` 043c68da. Line numbers are from that commit.

## R1. What exists today

- **Contracts.** `ScheduleShift` is a strict object `{ day, start, end }`
  (`packages/contracts/src/staff/schedules.ts:7-13`); `ConcreteShift` extends it with `working_date`, `starts_at`,
  `ends_at` (`:24-30`); template terms reuse the same pattern (`:72-74`). Strict objects mean today's clients cannot
  send unknown keys, so new optional keys are safe for old clients.
- **Domain.** All four write paths go through two pure functions in
  `apps/api/src/modules/staff/domain/schedules.ts`: `validateSchedulePattern` (`:21-42`, day range, max 2 per day at
  `:27`, 16 h at `:31`, overlap) and `materializeSchedule` (`:51-66`, local → UTC through `scheduleInstant`,
  `schedule-calendar.ts:55`). Callers: `set-schedule.usecase.ts:40`, `apply-shift-template.usecase.ts:56`,
  `create-shift-template.usecase.ts:17`, `update-shift-template.usecase.ts:16`. One place to add break validation.
- **Past-edit reason.** `requirePastScheduleReason` compares six canonical values per shift
  (`schedules.ts:150-170`, tuple at `:163`). A break must join the tuple, or a past break change would slip through
  without a reason.
- **Types.** `WeeklyShift`, `ConcreteShift`, `TemplateRecord` in `domain/schedule-types.ts:2-33`; error codes at
  `:44-59`; HTTP status table in `apps/api/src/shared/errors.ts:55-60` and `:183-186`.
- **Schema.** `staff_schedule_shifts` (`packages/db/schema/staff-schedules.ts:57-89`; migration
  `0056_2026-10-03_staff-schedules.sql:1-15`) stores local `start`/`end` plus `starts_at`/`ends_at` and a 16 h CHECK.
  Templates keep the pattern as `shifts jsonb` (`staff-schedules.ts:100`, `0056:39`). RLS and grants:
  `0057_2026-10-03_staff-schedules-rls.sql` — table-level `GRANT SELECT, INSERT, DELETE` on shifts (`:37`), column
  grant for template update `(name_en, name_ar, shifts, revision, archived_at)` (`:35`), employee-wide btree_gist
  exclusion (`:40`).
- **Persistence** (explicit column lists, each needs the break columns):
  `persistence/schedule-records.ts:36-38` and `:52-54`, `schedule-writes.ts:30-35`,
  `schedule-batch-records.ts:36-38` and `:54-56`, `schedule-batch-writes.ts:49-51`,
  `queries/schedule-week.query.ts:21-23` (also feeds `my-schedule.query.ts:14`).
- **Attendance.** `attendanceSchedule` picks the containing shift, else the first shift of the clock-in date
  (`domain/clock-attendance.ts:208-220`); `attendanceLateMinutes` measures from that shift's start
  (`:115-120`); `planAttendance` stores it (`:168-200`). Shift candidates are read in
  `persistence/attendance-context.adapter.ts:107-120` and mapped at `:90-94` (QR) and `:217-221` (card). The session
  stores `scheduled_start`/`scheduled_end` (`packages/db/schema/staff-attendance.ts:86`,
  `persistence/attendance-writes.ts:120`); corrections recompute lateness from the stored `scheduled_start`
  (`domain/attendance-correction.ts:217-223`).
- **Worker.** Not-clocked-in reads shift start/end only (`apps/worker/src/modules/staff/persistence/not-clocked-in.transactions.ts:49-54`, `:165`).
  The missed-out job uses shift end + 4 h. Neither needs the break.
- **Admin.** `apps/admin/src/staff/model/schedule-form.ts:27` maps saved shifts to form values with `{day,start,end}`
  only; `ui/schedule-shift-fields.tsx:17-39` renders start/end inputs, `:44` caps 2 shifts per day, `:46-50` default
  split 09–13 / 14–18; `ui/schedule-grid.tsx:51-52` prints `start–end`. ar/en keys in `packages/i18n/src/ar.ts:43`,
  `en.ts:41`. There is **no admin template screen** (spec 020 shipped the template API only).
- **POS.** No own-schedule screen yet; only the generated client types (`apps/pos/src/shared/api/schema.d.ts`).

## R2. Decision: break columns on the shift row, not a child table

- **Decision**: four nullable columns on `staff_schedule_shifts` (`break_start`, `break_end`, `break_starts_at`,
  `break_ends_at`) plus two CHECKs (pair all-or-nothing; strictly inside the shift instants). Template JSONB entries
  gain two optional keys.
- **Rationale**: one break per shift (BW-Q3 recommended); shifts are always deleted and re-inserted as a set
  (`schedule-writes.ts:26-35`), so a child table would add RLS, grants, FKs and negative tests for no benefit.
  Storing instants mirrors ADR-0024: attendance reads instants, never re-interprets local times.
- **Alternatives**: a `staff_shift_breaks` table (only if BW-Q3 = several breaks); an employee-level break column
  (only if BW-Q1 = B — then it lives on `employees` and touches the employee contracts and use cases instead).
- **Migration**: ADD COLUMN nullable is a metadata change; CHECKs `NOT VALID` then `VALIDATE` (every existing row is
  NULL, so validation is a scan with no failures). No index — a break is read only with its shift row. No grant change
  (table-level). The privileges allowlist test stays the same. No data step; old rows mean "no break".

## R3. Decision: new error code `SCHEDULE_BREAK_INVALID` (400)

- **Rationale**: the admin form must point at the break field, not the shift; `SCHEDULE_SHIFT_INVALID` cannot tell
  them apart. Needs `ScheduleErrorCode`, `shared/errors.ts` status + list, and ar/en messages.

## R4. Attendance change (BW-Q5) — what breaks today

- Any employee who clocks out and back in during her shift gets the second session's lateness measured from the
  **shift start**: سارة 09:00–17:00, back at 14:05 → `late_minutes` = 305. This is live behaviour of
  `attendanceSchedule` + `attendanceLateMinutes`, independent of 16b, and row 27's board/report would show it.
- With BW-Q5 = A: when the containing shift has a break and `at >= break_starts_at`, measure from `break_ends_at` and
  store it as the session's `scheduled_start`; corrections then keep recomputing from the stored value
  (`attendance-correction.ts:217-223`), so no correction change is needed.
- **Scope note**: this edits the clock-attendance and clock-by-card paths (shared `planAttendance`). If the reviewers
  want one use case per PR strictly, split it as **16b-2** (attendance) after **16b-1** (schedule + template break).

## R5. What could break

| Area | Risk | Mitigation |
|---|---|---|
| Rows already stored | none read as broken: NULL break = no break | FR-009, BW-05 test |
| Templates already stored | JSONB without the keys must parse | treat missing keys as null in the mapper; BW-05 |
| Admin re-save | `schedule-form.ts:27` drops unknown fields → a re-save would **erase** every break | map break in defaults; admin round-trip test |
| Past-reason rule | six-value tuple misses breaks → past break changes without reason | ten-value tuple (BR-006) |
| Open attendance sessions | a session opened before deploy keeps its stored lateness | nothing recomputed retroactively |
| Offline POS | no POS schedule screen; personal clocking is online-only (ADR-0019) | none |
| Reports (row 27, not built) | hours must **include** the break (BW-Q4 = 2, owner 2026-10-10) | written into FR-011 for row 27 |
| Commissions | attendance never touches commission (SPEC §7) | none |
| Not-clocked-in / missed-out jobs | use shift start/end only | unchanged; regression tests kept |
| Apply benchmark (spec 020, 897 ms for 240 copies; cap 20 copies) | two more text + two timestamp columns per row | re-run the apply timing test |

## R6. Kuwait labour law (to verify, not a rule)

Kuwaiti private-sector law is commonly summarised as "a rest of at least one hour after five consecutive working
hours, not counted as working time". This is **not** verified here and is not enforced; it is the background for the
BW-Q2 alternative "required on shifts longer than 5 hours" and the BW-Q4 recommendation. The owner chose otherwise
(2026-10-10): breaks are optional and count as working hours.

## R7. Files expected to change at implementation, and overlap with 16c

| File | 16b change | 16c overlap |
|---|---|---|
| `packages/contracts/src/staff/schedules.ts` | break fields on `scheduleShift` / `concreteShift` | **likely** (setting-driven max shifts; `schedulePattern.max(14)`) |
| `packages/contracts/src/staff/schedules-openapi.ts`, `src/openapi.ts`, `__tests__/schedules.spec.ts` | schema/examples | likely |
| `apps/api/src/modules/staff/domain/schedule-types.ts` | `WeeklyShift`/`ConcreteShift` break, new error code | possible (error code) |
| `apps/api/src/modules/staff/domain/schedules.ts` | break validation in `validateSchedulePattern`/`materializeSchedule`, tuple in `requirePastScheduleReason` | **certain** — 16c changes the `> 2` checks at `:27` and `:131` |
| `apps/api/src/modules/staff/domain/schedule-calendar.ts` | none expected (reuse `scheduleInstant`) | — |
| `apps/api/src/modules/staff/domain/clock-attendance.ts` (BW-Q5) | return-from-break lateness | none |
| `apps/api/src/modules/staff/persistence/schedule-records.ts`, `schedule-writes.ts`, `schedule-batch-records.ts`, `schedule-batch-writes.ts` | break columns in SQL | none expected (16c may add a settings reader port instead) |
| `apps/api/src/modules/staff/queries/schedule-week.query.ts` | break in projection | none |
| `apps/api/src/modules/staff/persistence/drizzle-schedules.ts`, `queries/shift-templates.query.ts` | JSONB mapping tolerates missing keys | none expected |
| `apps/api/src/modules/staff/persistence/attendance-context.adapter.ts` (BW-Q5) | read break instants | none |
| `apps/api/src/modules/staff/use-cases/*schedule*/*`, `*shift-template*/*` | probably none (domain carries it) | **likely** — 16c passes the owner setting into validation |
| `apps/api/src/shared/errors.ts` | `SCHEDULE_BREAK_INVALID` | possible if 16c adds a code |
| `packages/db/schema/staff-schedules.ts` + new migration | four columns + two CHECKs | possible if 16c stores the setting elsewhere (settings table) — different file most likely |
| `packages/i18n/src/ar.ts`, `en.ts` | break labels + error message | **likely** (both lanes add keys — append-only merge) |
| `apps/admin/src/staff/model/schedule-form.ts`, `ui/schedule-shift-fields.tsx`, `ui/schedule-grid.tsx`, specs | break inputs, round-trip, label | **certain** — 16c changes `fields.length >= 2` at `schedule-shift-fields.tsx:44` |
| `apps/admin/src/shared/api/schema.d.ts`, `apps/pos/src/shared/api/schema.d.ts` | regenerated | **certain** (generated; regenerate after the second merge) |
| tests under `apps/api/src/modules/staff/**/__tests__`, `packages/db/src/__tests__` | new cases | possible in the same spec files |

**Recommendation to the orchestrator**: do not run 16b and 16c implementation in parallel — they share
`domain/schedules.ts`, the contracts file, the admin shift fields and the generated clients. Land the smaller one
first (16c, a setting and two constants) and rebase 16b on it, or the reverse; either way, one after the other.

## R8. Owner answers 2026-10-10 — what they change

- BW-Q1 (on the shift), BW-Q2 (optional), BW-Q3 (one), BW-Q6 (all four), BW-Q7 (no check): as recommended; R2 stands.
- **BW-Q4 = 2 (break counts as working hours)**, not the recommendation. Consequences: nothing in 16b subtracts the
  break; `starts_at`/`ends_at` remain the shift length; FR-011 now tells row 27 to **credit** clocked-out time inside
  the scheduled break as worked. R6's labour-law note is background only and not enforced.
- BW-Q5 = 1: as R4, narrowed to a real return (plan D6): an earlier closed session on the same shift is required, so
  a first clock-in after the break start keeps the spec 027 rule and cannot hide a late arrival.

## R9. Return detection (16b-2)

- **Decision**: "returning" = a session of the same employee with `clock_out > shift.starts_at AND clock_out ≤ at`.
- **Rationale**: the morning clock-in may be before the shift start (08:58), so matching on `clock_in` would miss it;
  the stored `scheduled_start` of the morning session would work only when a schedule existed at that moment.
  `clock_out` inside the shift is the plain fact "she already worked part of this shift". Read in the same
  transaction that already locks the employee row, on `attendance_sessions_employee_date_idx`.
- **Alternatives**: any session on the same `working_date` (wrong for split days with two shifts); matching
  `scheduled_start` (misses sessions opened before the schedule existed).

## R10. PR split and rebase onto 16c

See plan.md "PR split" (recommendation: 16b-1 schedules/templates, then 16b-2 attendance) and "Rebase onto 16c"
(16c spec 042 merges first; break checks in a separate `validateShiftBreak`, break inputs in a separate admin
component, contract bounds untouched, migration generated after the rebase).
