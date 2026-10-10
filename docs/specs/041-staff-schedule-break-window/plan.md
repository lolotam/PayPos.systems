# Implementation Plan: Fixed break window per shift

**Branch**: `feat/p1-16b-break-window` | **Date**: 2026-10-10 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `docs/specs/041-staff-schedule-break-window/spec.md` (owner answers BW-Q1…Q9, 2026-10-10,
[owner-questions.ar.md](owner-questions.ar.md)).

## Summary

A shift may carry one optional fixed break (`break_start`–`break_end`, local `HH:mm`) in the week schedule and in the
template pattern (BW-Q1, BW-Q2, BW-Q3). Breaks are validated by one new pure function in `staff/domain/schedules.ts`,
resolved to UTC instants in `materializeSchedule`, stored as four nullable columns on `staff_schedule_shifts` guarded by
two CHECKs, and as two optional keys in the template `shifts` JSONB. Every schedule read returns them; the admin week
editor shows and round-trips them. The break **counts as working time** (BW-Q4): no hours figure subtracts it. A return
clock-in on a shift with a break is measured from the break end with the 10-minute grace (BW-Q5).

The work ships as **two PRs** (see "PR split"): **16b-1** the break on schedules and templates; **16b-2** the
return-from-break lateness in attendance. Both are built **after row 16c (spec 042) merges**, on top of it (see
"Rebase onto 16c").

## Technical Context

**Language/Version**: TypeScript 6 on Node 22 (local) / 24 (CI)

**Primary Dependencies**: NestJS (Fastify), Drizzle + drizzle-kit, Zod 4, Next.js admin, react-hook-form, TanStack
Query — all existing; no new library, no ADR.

**Storage**: PostgreSQL — four nullable columns + two CHECKs on `staff_schedule_shifts`; template JSONB keys. No new
table, no grant change, no index.

**Testing**: Vitest — domain unit (no DB), API integration on the T2 compose Postgres (one cloned DB per spec file,
ADR-0006), RLS negative (existing schedule tests extended), query shape + `EXPLAIN ANALYZE` (existing, re-run), admin
component tests.

**Target Platform**: `apps/api` (Linux container), `apps/admin` (browser). POS gets regenerated types only.

**Project Type**: modular-monolith web service + admin web app

**Performance Goals**: unchanged budgets — schedule save/apply under 200 ms per request at the existing cap of 20
copies (spec 020 benchmark re-run); clock-in unchanged apart from one `EXISTS` on an indexed path (16b-2).

**Constraints**: tenant isolation by existing FORCE RLS; expand-only migration (`NOT VALID` → `VALIDATE`); no data
step; stored rows without a break keep working; past-day break edits need the existing reason.

**Scale/Scope**: week pattern up to 28 shifts after 16c; ≤ 20 employee-week copies per apply.

## Constitution Check

| Principle | Check | Result |
|---|---|---|
| I. One vertical slice | 16b-1 = one feature on the existing schedule/template use cases, no new use case; 16b-2 = one rule in the shared clock path. Split into two PRs (below) | PASS |
| II. Domain purity & money | break validation, instant resolution, past comparison and return lateness are pure functions in `staff/domain`; no arithmetic in use cases; no money | PASS |
| III. Tenant isolation by the DB | no new table; existing FORCE RLS and table-level grants cover the new columns; RLS negative test extended to read a break column | PASS |
| IV. Boundaries machine-enforced | all changes inside `staff`; no new import arrow | PASS |
| V. Test-backed delivery | domain unit, integration BW-01…BW-08, RLS, query shape/EXPLAIN, admin round-trip | PASS |
| VI. Arabic-first RTL | labels and error via `packages/i18n` (ar/en); logical CSS; `packages/ui` inputs | PASS |
| VII. Documented why, in Arabic | Arabic JSDoc on every new/changed `domain/**` export; doc comments of `requirePastScheduleReason`, `attendanceSchedule`, `planAttendance` updated in the same commit; one-liners on the new schema columns | PASS |
| Security (CLAUDE.md §8) | no new route or permission; the schedule/template before/after audit already covers shift rows and template JSONB | PASS |

Post-design re-check (after data-model and contracts): unchanged — PASS.

## PR split (recommendation)

House rule: one use case per PR (CLAUDE.md §10). The break touches two different concerns:

| PR | Scope | Spec parts | Depends on |
|---|---|---|---|
| **16b-1** `feat(staff): phase 1 PR 16b — break window on schedules and templates` | contract fields + `SCHEDULE_BREAK_INVALID`; migration (4 columns, 2 CHECKs); `validateShiftBreak` + `materializeShiftBreak` + 10-value past tuple; persistence + `schedule-week.query`; template JSONB mapping; admin break inputs, round-trip, grid label; i18n; OpenAPI + generated clients | US1, US2, FR-001…FR-009, FR-011 (no figure), FR-012; BW-01…BW-06 | 16c merged |
| **16b-2** `fix(staff): phase 1 PR 16b-2 — return-from-break lateness` | return rule in `attendanceSchedule`/`planAttendance`; `attendance-context.adapter` reads break instants and the "returning" fact for QR and card; tests | US3, FR-010; BW-07, BW-08 | 16b-1 merged (needs the columns) |

**Recommendation: split.**
- 16b-2 changes the stored `late_minutes` on the live clock path of two use cases (`clock-attendance`,
  `clock-by-card`). Its review risk (lateness, locks, QR/card parity) has nothing to do with the schedule editor and
  is easier to review alone.
- 16b-1 is useful on its own: managers see and plan breaks. Nothing gets worse without 16b-2; today's wrong
  305-minute figure already exists and is unchanged by 16b-1.
- 16b-2 is small (one domain function, one adapter query, tests) and can follow 16b-1 the same day.
- Cost: one more pipeline cycle (gates + Codex review). Accepted.

If the orchestrator prefers one PR, 16b-2 is the last phase of `tasks.md` and can ship in the same branch with no
reordering.

## Rebase onto 16c (spec 042)

16c merges first. What it changes, and how 16b slots in after it:

| 16c change | Where | 16b design so it slots in cleanly |
|---|---|---|
| Per-day max becomes an owner setting (range 1–4); the pattern check takes the limit from the setting; the fixed `> 2` checks at `schedules.ts:27` and `:131` go | `apps/api/src/modules/staff/domain/schedules.ts` | Break checks live in a **separate exported function `validateShiftBreak(shift)`**, called once per shift from inside `validateSchedulePattern`'s map after the existing day/duration checks — one added line, no signature change. Instants come from a separate helper `materializeShiftBreak(...)` called from `materializeSchedule`. 16b never touches the count logic or its new parameter. |
| New `SCHEDULE_DAY_LIMIT_EXCEEDED` (422) | `schedule-types.ts` `ScheduleErrorCode`, `shared/errors.ts`, i18n | 16b appends `SCHEDULE_BREAK_INVALID` (400) next to it — append-only. |
| Pattern bound `.max(14)` → `.max(28)` (7 × top of range 4) on `schedulePattern` and `staffSchedule.shifts` | `packages/contracts/src/staff/schedules.ts` | 16b does not touch the bounds. It adds a separate `shiftBreakFields` shape and extends `scheduleShift` with it (still a strict object); `concreteShift` extends with the two instants. The rebase takes 16c's bounds as they are. |
| Per-day add-button cap reads the setting | `apps/admin/src/staff/ui/schedule-shift-fields.tsx` (`fields.length >= 2`) | Break inputs go in a **new component `schedule-shift-break-fields.tsx`**, rendered by one inserted line inside each shift `<fieldset>`. 16b does not touch the add button, its cap or its defaults. |
| Settings table, port, panel | new files in 16c | no overlap |
| Migration numbers | `packages/db/migrations` | 16b's migration is generated **after** the rebase, so it numbers after 16c's and the journal `when` stays increasing. |
| Generated `openapi.json` / `schema.d.ts`, i18n `ar.ts`/`en.ts` | shared registries | regenerate after the rebase; i18n keys append-only. |

Procedure at implementation time: `git merge origin/main` once 16c is on main, resolve the four shared files above
(expected: adjacency conflicts only), regenerate OpenAPI and the clients, then generate the 16b migration.

## Design decisions

- **D1 Storage** (research R2): four nullable columns on the shift row + two CHECKs; template JSONB keys
  `break_start`/`break_end` (absent = no break). Rows stored before 16b read as "no break" (FR-009, no data step).
- **D2 Validation** (BR-002, FR-005): offsets from the shift start in local minutes,
  `off(t) = (t − start + 1440) mod 1440`; valid iff `0 < off(break_start) < off(break_end) < duration`. One rule
  covers day shifts, overnight shifts and breaks after midnight. A one-sided pair is refused by the contract
  (`VALIDATION_FAILED`) and again by the domain (`SCHEDULE_BREAK_INVALID`) for template JSONB. After the instants are
  resolved the domain re-checks `starts_at < break_starts_at < break_ends_at < ends_at`; the DB CHECK is the last line.
- **D3 Instants**: the break's local date is `working_date` while its offset stays inside the start day, else
  `working_date + 1`; resolved through the existing `scheduleInstant` (gap/fold → `SCHEDULE_LOCAL_TIME_INVALID`).
- **D4 Past-day reason** (BR-006, FR-007): the comparison tuple in `requirePastScheduleReason` grows from 6 to 10
  values (`break_start`, `break_end`, `break_starts_at`, `break_ends_at`, `null` when absent).
- **D5 Hours** (BW-Q4, FR-011): no code computes hours in this row. Nothing subtracts the break; `starts_at`/`ends_at`
  stay the shift's full length. FR-011's worked-hours rule (clocked-out time inside the scheduled break counts as
  worked, outside it is not — BW-Q8) is an input to row 27's spec.
- **D6 Return detection** (16b-2, BR-005, FR-010, BW-Q9): a clock-in is a **return from break** iff the chosen shift has a
  break, `at ≥ break_starts_at`, and the employee has a closed session on that shift — one with
  `clock_out > shift.starts_at AND clock_out ≤ at` (a morning clock-in at 08:58, before the shift start, still
  counts). Then `scheduled_start = break_ends_at` and lateness uses the existing `attendanceLateMinutes`. Otherwise
  spec 027 is unchanged. The adapter reads `returning` as a boolean per candidate shift (one `EXISTS` on
  `attendance_sessions_employee_date_idx`); the domain decides. Corrections need no change: they recompute from the
  stored `scheduled_start`.
  **Note for row 27 (FR-011, BW-Q4):** a return session's stored `scheduled_start` is the break end, not the shift
  start. Scheduled hours must therefore never be computed per session as `scheduled_end − scheduled_start`; take them
  from the shift (`ends_at − starts_at`, break included).
- **D7 Error**: `SCHEDULE_BREAK_INVALID` 400 — `message_ar` «وقت البريك لازم يكون جوّه الشيفت», `message_en` "The break
  must be inside the shift"; `details` carries the shift `{ day, start }` so the admin form can point at it.

## Project Structure

### Documentation (this feature)

```text
docs/specs/041-staff-schedule-break-window/
├── spec.md  owner-questions.ar.md  plan.md  research.md  data-model.md  quickstart.md
├── contracts/schedule-break-api.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/contracts/src/staff/
├── schedules.ts                 shiftBreakFields; scheduleShift/concreteShift extended (16b-1)
├── schedules-openapi.ts         examples with a break (16b-1)
└── __tests__/schedules.spec.ts  pair rule, null/absent, strict keys (16b-1)
packages/contracts/openapi.json  regenerated

packages/db/
├── schema/staff-schedules.ts    4 columns + 2 CHECKs (16b-1)
└── migrations/NNNN_<date>_staff-schedule-breaks.sql (+ journal/meta; numbered after 16c)

packages/i18n/src/ar.ts, en.ts   break labels, error message (append-only)

apps/api/src/shared/errors.ts    SCHEDULE_BREAK_INVALID → 400
apps/api/src/modules/staff/
├── domain/schedule-types.ts     WeeklyShift/ConcreteShift break fields; error code
├── domain/schedules.ts          validateShiftBreak, materializeShiftBreak, 10-value tuple
├── domain/clock-attendance.ts   (16b-2) return-from-break in attendanceSchedule/planAttendance
├── persistence/schedule-records.ts, schedule-writes.ts, schedule-batch-records.ts, schedule-batch-writes.ts
├── persistence/drizzle-schedules.ts, queries/shift-templates.query.ts (template JSONB tolerates missing keys)
├── queries/schedule-week.query.ts
├── persistence/attendance-context.adapter.ts (16b-2) break instants + returning
├── domain/__tests__/schedules.spec.ts, clock-attendance.spec.ts
└── __tests__/schedules.spec.ts, schedule-templates.spec.ts, schedule-queries.spec.ts, schedule-rls.spec.ts,
    clock-attendance.spec.ts, clock-by-card.spec.ts, correct-attendance.spec.ts (16b-2)

apps/admin/src/staff/
├── model/schedule-form.ts (+ spec)          break round-trip, '' → null
├── ui/schedule-shift-break-fields.tsx (new) break inputs per shift
├── ui/schedule-shift-fields.tsx             +1 line rendering the break fields
├── ui/schedule-grid.tsx                     break label under the shift
└── ui/schedule-edit-dialog.spec.tsx         round-trip + error tests
apps/admin/src/shared/api/schema.d.ts, apps/pos/src/shared/api/schema.d.ts   regenerated
```

**Structure Decision**: existing modular-monolith layout (`CLAUDE.md` §2, `CLAUDE.architecture.md` §3); every change
stays inside the `staff` module, its contracts, the db schema and the admin `staff` folder.

## Complexity Tracking

| Choice | Why needed | Simpler alternative rejected because |
|---|---|---|
| Store break instants, not only local times | attendance (16b-2) compares instants, like the shift (ADR-0024) | re-deriving instants at clock time re-interprets local times and duplicates timezone logic |
| Two PRs for one row | one concern per PR; 16b-2 changes the live clock path | one PR mixes editor and attendance review risk |
