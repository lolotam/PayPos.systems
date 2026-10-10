# Tasks: Fixed break window per shift

**Input**: `docs/specs/041-staff-schedule-break-window/` — spec.md, plan.md, research.md, data-model.md,
contracts/schedule-break-api.md, quickstart.md. Owner answers BW-Q1 … BW-Q7 (2026-10-10).

**Tests are mandatory** (`CLAUDE.md` §9): written first, failing before the code exists.

**Delivery**: two PRs (plan.md "PR split"). **16b-1** = Phases 1–6. **16b-2** = Phases 7–8, on a branch cut from
main after 16b-1 merges. Nothing starts before row 16c (spec 042) is on main (plan.md "Rebase onto 16c").

Format: `- [ ] Tnnn [P?] [USn?] description — path`.

## Phase 1: Setup (16b-1)

- [ ] T001 Rebase onto 16c: once spec 042 is merged, `git fetch origin && git merge --no-edit origin/main` in `E:\Dev\Worktrees\PosPay\p1-16b`; confirm `SCHEDULE_DAY_LIMIT_EXCEEDED`, the setting-driven per-day limit in `apps/api/src/modules/staff/domain/schedules.ts`, the `.max(28)` bounds in `packages/contracts/src/staff/schedules.ts` and the setting-driven add cap in `apps/admin/src/staff/ui/schedule-shift-fields.tsx` are present; re-read those three files before any edit below. Do not change 16c's logic.
- [ ] T002 `pnpm install`; build `pnpm --filter "@pospay/contracts..." --filter "@pospay/i18n..." --filter "@pospay/db..." build`; run `pnpm --filter @pospay/api test -- schedules` to record the green baseline.

## Phase 2: Foundational (16b-1, blocks every story)

### Contract

- [x] T003 [P] Write failing contract tests in `packages/contracts/src/__tests__/schedules.spec.ts`: `scheduleShift` accepts no break keys, both `null`, both `"HH:mm"`; refuses only one of the two (absent or null on the other), a bad `HH:mm` (`"24:00"`, `"9:00"`), and unknown keys (strict object kept); `concreteShift` requires `break_start`, `break_end` (`HH:mm | null`) and `break_starts_at`, `break_ends_at` (ISO datetime `| null`); `templateTerms.shifts` and `shiftTemplate.shifts` accept the break; 16c's pattern bound unchanged.
- [x] T004 Implement in `packages/contracts/src/staff/schedules.ts`: a `shiftBreakFields` shape (`break_start`, `break_end`: `z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable().optional()`), `scheduleShift` = existing strict object extended with it plus a refine "both present (non-null) or both absent/null"; `concreteShift` adds required nullable `break_start`, `break_end`, `break_starts_at`, `break_ends_at`. Do not touch `.max(...)` bounds (16c). Add an example with break 13:00–14:00 in `packages/contracts/src/staff/schedules-openapi.ts`.

### Error code and messages

- [x] T005 [P] Add `SCHEDULE_BREAK_INVALID` → 400 to the status table and the code list in `apps/api/src/shared/errors.ts` (append next to 16c's `SCHEDULE_DAY_LIMIT_EXCEEDED`); add messages in `packages/i18n/src/ar.ts` «وقت البريك لازم يكون جوّه الشيفت» and `packages/i18n/src/en.ts` "The break must be inside the shift" (append-only).
- [x] T006 [P] Add `'SCHEDULE_BREAK_INVALID'` to `ScheduleErrorCode` and the break fields to `WeeklyShift` (`break_start: string | null`, `break_end: string | null`) and `ConcreteShift` (`break_starts_at: string | null`, `break_ends_at: string | null`) in `apps/api/src/modules/staff/domain/schedule-types.ts`; update their Arabic doc comments.

### Domain (pure)

- [x] T007 Write failing unit tests in `apps/api/src/modules/staff/domain/__tests__/schedules.spec.ts`: `validateShiftBreak` per the data-model.md placement table — 09:00–17:00 with 13:00–14:00 valid; 16:30–17:30, 08:30–09:30, 13:00–17:00 (touches end), 09:00–10:00 (touches start), 13:00–13:00, 14:00–13:00 → `SCHEDULE_BREAK_INVALID`; one-sided → `SCHEDULE_BREAK_INVALID`; overnight 20:00–04:00 with 00:30–01:00 valid and 03:30–04:30 invalid; no break valid on any length (BW-Q2). `materializeSchedule`: break instants on `working_date`, after-midnight break instants on `working_date + 1`, Friday overnight break on next week's Saturday stays on Friday's shift, DST gap/fold on a break time (use a DST zone such as `Europe/Berlin`) → `SCHEDULE_LOCAL_TIME_INVALID`, no-break shifts get four `null`s, shift `starts_at`/`ends_at` unchanged by a break (BW-Q4: still 8 h). `requirePastScheduleReason`: past day break added / changed / removed without reason → `SCHEDULE_PAST_REASON_REQUIRED`; identical re-save, and key/array order changes → no reason needed; today/future break change → no reason.
- [x] T008 Implement in `apps/api/src/modules/staff/domain/schedules.ts`: exported `validateShiftBreak(shift)` with `off(t) = (t − start + 1440) mod 1440` and valid iff `0 < off(break_start) < off(break_end) < duration`, called once per shift inside `validateSchedulePattern`'s map after the day/duration checks (one line; do not touch 16c's per-day limit logic or signature); exported `materializeShiftBreak(workingDate, shift, timezone)` using `scheduleInstant`, called from `materializeSchedule`, re-checking `starts_at < break_starts_at < break_ends_at < ends_at`; normalise missing break keys to `null`; extend the `requirePastScheduleReason` tuple to the ten values (six existing + `break_start`, `break_end`, `break_starts_at`, `break_ends_at`). Full Arabic JSDoc on the two new exports; update the doc comments of `validateSchedulePattern`, `materializeSchedule` and `requirePastScheduleReason` in the same commit.

### Database

- [x] T009 Add to `staffScheduleShifts` in `packages/db/schema/staff-schedules.ts`: `breakStart: text('break_start')`, `breakEnd: text('break_end')`, `breakStartsAt: timestamp('break_starts_at', { withTimezone: true })`, `breakEndsAt: timestamp('break_ends_at', { withTimezone: true })` (all nullable; one Arabic line comment: the break belongs to the shift's start day and counts as working time); CHECK `staff_schedule_shifts_break_pair` "all four NULL or all four NOT NULL"; CHECK `staff_schedule_shifts_break_inside` "`break_starts_at IS NULL OR (break_starts_at > starts_at AND break_ends_at > break_starts_at AND break_ends_at < ends_at)`".
- [x] T010 Generate the migration with drizzle-kit after T001 so it numbers after 16c: `packages/db/migrations/NNNN_<date>_staff-schedule-breaks.sql` (+ journal/snapshot); hand-edit so both CHECKs are added `NOT VALID`, and `VALIDATE CONSTRAINT` both in a separate following custom migration (DB review round 1: one file is one transaction, so validating in the same file keeps the `ADD COLUMN` lock during the scan); no grant change, no index, no data step. Drift check prints "No schema changes"; `packages/db/src/__tests__/privileges.spec.ts` unchanged and green.

**Checkpoint**: contracts, domain and schema ready — stories can start.

## Phase 3: User Story 1 — the manager fixes سارة's break in her week (P1) 🎯 MVP

**Goal**: save, read and edit a break on a week shift (FR-001, FR-003…FR-008, FR-012). **Independent test**: BW-01,
BW-02, BW-03, BW-06 + admin round-trip.

### Tests (first, failing)

- [x] T011 [P] [US1] Integration tests in `apps/api/src/modules/staff/__tests__/schedules.spec.ts` (fixtures in `schedules.fixture.ts`): BW-01 save سارة Saturday 09:00–17:00 break 13:00–14:00 → 200; `GET …/schedules/{employeeId}`, the grid and `GET /v1/staff/my-schedule` return `break_start "13:00"`, `break_end "14:00"` and the Asia/Kuwait instants; the shift still has `starts_at`/`ends_at` 8 h apart; one audit row whose after-state holds the break. BW-02 break 16:30–17:30 → 400 `SCHEDULE_BREAK_INVALID`, no shift row, no audit; one-sided break → 400 `VALIDATION_FAILED`. BW-03 past day: add / change / remove a break without `reason` → `SCHEDULE_PAST_REASON_REQUIRED`; with reason → 200; identical re-save without reason → 200. Shift 09:00–13:00 with no break → 200 (BW-Q2).
- [x] T012 [P] [US1] BW-06 in `packages/db/src/__tests__/` (the existing staff-schedules constraint spec, or a new `staff-schedule-breaks.spec.ts`): direct insert with only `break_start` set, and with a break outside its shift → CHECK violation.
- [x] T013 [P] [US1] Extend `apps/api/src/modules/staff/__tests__/schedule-rls.spec.ts`: cross-tenant read selecting `break_starts_at` returns 0 rows; cross-tenant insert with a break → error.
- [x] T014 [P] [US1] Extend `apps/api/src/modules/staff/__tests__/schedule-queries.spec.ts`: result shape of `schedule-week.query.ts` and `my-schedule.query.ts` includes the four break keys (`null` when absent); keep the existing `EXPLAIN ANALYZE` assertions green.
- [x] T015 [P] [US1] Admin tests: `apps/admin/src/staff/model/schedule-form.spec.ts` — saved shift with a break maps to form values with it and back; empty inputs map to `null`; a saved shift without a break stays without. `apps/admin/src/staff/ui/schedule-edit-dialog.spec.tsx` — add break 13:00–14:00 and save sends both keys; reopen and save untouched keeps the break (FR-012); remove break sends `null`s; `SCHEDULE_BREAK_INVALID` shows the ar/en message.

### Implementation

- [x] T016 [US1] Persistence: add the four break columns to the explicit column lists and mappers in `apps/api/src/modules/staff/persistence/schedule-records.ts`, `schedule-writes.ts`, `schedule-batch-records.ts`, `schedule-batch-writes.ts` (insert and read; `null` when absent).
- [x] T017 [US1] Query: project the four break columns in `apps/api/src/modules/staff/queries/schedule-week.query.ts` (feeds `my-schedule.query.ts`); keep the one-line screen comment.
- [x] T018 [US1] Check `apps/api/src/modules/staff/use-cases/set-schedule/set-schedule.usecase.ts` needs no change beyond types (domain carries the break); add none of the arithmetic there.
- [x] T019 [P] [US1] Admin model: map `break_start`/`break_end` in defaults and submit in `apps/admin/src/staff/model/schedule-form.ts` ('' → `null`).
- [x] T020 [US1] Admin UI: new `apps/admin/src/staff/ui/schedule-shift-break-fields.tsx` (props `index`, `pending`; "add break" button that sets 13:00/14:00 inside the shift, two `type="time"` inputs, "remove break" that sets both `null`; logical CSS only; strings via `t(...)`); render it with one inserted line inside each shift `<fieldset>` in `apps/admin/src/staff/ui/schedule-shift-fields.tsx` (do not touch 16c's add-button cap or defaults). Show the break as a second line `13:00–14:00` with a break label under the shift in `apps/admin/src/staff/ui/schedule-grid.tsx`.
- [x] T021 [P] [US1] i18n keys (append-only) in `packages/i18n/src/ar.ts` / `en.ts`: `shell.schedule_break` («البريك» / "Break"), `shell.schedule_break_start`, `shell.schedule_break_end`, `shell.schedule_break_add`, `shell.schedule_break_remove`.

**Checkpoint**: US1 independently testable (quickstart §2 BW-01…BW-03, BW-06; §4).

## Phase 4: User Story 2 — the break travels with a template (P2)

**Goal**: templates hold breaks; apply copies them; one copy can change alone (FR-002, FR-009). **Independent test**:
BW-04, BW-05.

### Tests (first, failing)

- [x] T022 [P] [US2] Integration tests in `apps/api/src/modules/staff/__tests__/schedule-templates.spec.ts`: BW-04 create «دوام الصبح» Sat–Thu 09:00–17:00 break 13:00–14:00; apply to سارة and هبة for two weeks → all four copies carry the break on every shift; change سارة's Monday break to 14:00–15:00 via the week save → هبة's Monday and the template stay 13:00–14:00; `PATCH` the template break → existing copies unchanged; template with an invalid break → 400 `SCHEDULE_BREAK_INVALID`. BW-05 a template row and a week inserted with the pre-16b shape (JSONB entries without break keys; shift rows with NULL break columns) read, edit and apply as "no break".
- [x] T023 [P] [US2] Extend the apply timing test (spec 020 benchmark, 20 copies) in `apps/api/src/modules/staff/__tests__/schedule-batch.spec.ts` with breaks on every shift; budget unchanged.

### Implementation

- [x] T024 [US2] Template JSONB mapping tolerates missing keys and writes both keys: `apps/api/src/modules/staff/persistence/drizzle-schedules.ts` and `apps/api/src/modules/staff/queries/shift-templates.query.ts` (missing → `null`).
- [ ] T025 [US2] Confirm `create-shift-template`, `update-shift-template` and `apply-shift-template` use cases pass the break through the domain unchanged (types only); apply's batch writes already covered by T016.

**Checkpoint**: US1 + US2 green.

## Phase 5: Polish (16b-1)

- [x] T026 Regenerate `packages/contracts/openapi.json` (`pnpm contracts:openapi`) and `apps/admin/src/shared/api/schema.d.ts`, `apps/pos/src/shared/api/schema.d.ts`.
- [ ] T027 Gates: `pnpm run typecheck`, `pnpm run lint`, `pnpm run lint:docs`, `pnpm run module-map:check`; `pnpm --filter @pospay/contracts test`, `pnpm --filter @pospay/db test`, `pnpm --filter @pospay/api test`, `pnpm --filter @pospay/admin test`; drift check "No schema changes".
- [ ] T028 Update `docs/specs/041-staff-schedule-break-window/quickstart.md` if any command changed; note in the PR body that 16b-2 follows (attendance) and that FR-011 (break counts as worked hours) is an input for row 27.

## Phase 6: 16b-1 hand-off

- [ ] T029 Commit, review rounds and PR per the pipeline (`feat(staff): phase 1 PR 16b — break window on schedules and templates`).

## Phase 7: User Story 3 — coming back from the break is not "late for the shift" (P3) — PR 16b-2

**Goal**: FR-010 / BR-005 (BW-Q5). Branch from main after 16b-1 merges. **Independent test**: BW-07, BW-08.

### Tests (first, failing)

- [x] T030 [P] [US3] Unit tests in `apps/api/src/modules/staff/domain/__tests__/clock-attendance.spec.ts`: shift 09:00–17:00 break 13:00–14:00, `returning = true`: clock-in 13:45 → 0, 14:00 → 0, 14:10 → 0, 14:11 → 11, 14:12 → 12, and the plan's `schedule.startsAt` = break end; `returning = false` at 13:30 → 270 (spec 027 unchanged); shift without a break, returning at 14:05 → 305 (unchanged); clock-in before the break start while returning (11:20) → measured from 09:00 (unchanged); clock-out transitions keep the open session's lateness; overnight shift with break after midnight.
- [x] T031 [P] [US3] Integration BW-07 in `apps/api/src/modules/staff/__tests__/clock-attendance.spec.ts` (QR) and `clock-by-card.spec.ts` (card): in 08:58, out 13:00, in 14:05 → `late_minutes` 0, stored `scheduled_start` = break end; in 14:12 → 12; never clocking out for the break → no exception, no alert; first clock-in at 13:30 → 270.
- [x] T032 [P] [US3] Integration BW-08 in `apps/api/src/modules/staff/__tests__/correct-attendance.spec.ts`: correcting the return session's clock-in recomputes lateness from the stored break end.

### Implementation

- [x] T033 [US3] Domain: in `apps/api/src/modules/staff/domain/clock-attendance.ts` extend the candidate shift input with `breakStartsAt: Date | null`, `breakEndsAt: Date | null`, `returning: boolean`; when the chosen shift has a break, `returning` is true and `at ≥ breakStartsAt`, the comparison start (and returned `schedule.startsAt`) is `breakEndsAt`; otherwise unchanged. Update the Arabic doc comments of `attendanceSchedule` / `planAttendance` / `AttendancePlanInput` in the same commit (owner decision BW-Q5, 2026-10-10).
- [x] T034 [US3] Adapter: in `apps/api/src/modules/staff/persistence/attendance-context.adapter.ts` `scheduleCandidates` selects `break_starts_at`, `break_ends_at` and `returning` = `EXISTS (SELECT 1 FROM attendance_sessions a WHERE a.company_id = ss.company_id AND a.employee_id = ss.employee_id AND a.clock_out > ss.starts_at AND a.clock_out <= $at)`; map them for both the QR (`:90-94`) and card (`:217-221`) contexts. Check the plan uses `attendance_sessions_employee_date_idx` (add an `EXPLAIN` assertion if the adapter has a query test).
- [x] T035 [US3] Confirm `attendance-writes.ts` stores `plan.schedule.startsAt` as `scheduled_start` (break end for a return); no schema change.

## Phase 8: Polish (16b-2)

- [x] T036 Gates as T027 (no contract or migration change expected; OpenAPI unchanged).
- [x] T037 Commit, review rounds and PR per the pipeline (`fix(staff): phase 1 PR 16b-2 — return-from-break lateness`).

## Phase 9: User Story 4 — not-returned alert (P2) — PR 16b-2, owner BW-Q5 change 2026-10-10

**Goal**: FR-013…FR-015, BR-007, BR-008 (plan D8). **Independent test**: BW-09, BW-10.

### Tests (first, failing)

- [x] T038 [P] [US4] Unit tests in `apps/worker/src/modules/staff/domain/__tests__/break-not-returned.spec.ts`: alert moment break end + 10 min; 14:09:59 WAIT, 14:10 ALERT; no break-out → NO_BREAK_OUT; returned → RETURNED; now ≥ shift end or alert moment ≥ shift end → STALE; deleted / ended contract → INELIGIBLE; leave anchored at the break end; template parameters with `break_end`.
- [x] T039 [P] [US4] Integration BW-09 in `apps/worker/src/modules/staff/__tests__/break-not-returned-job.spec.ts`: one notice, event and in-app message per manager; re-run none; two workers → one; 14:09 nothing; back at 14:30 before a 14:35 run → none; never clocked out → none; out at 11:00 → none; shift over → none; approved leave → none; other-branch break-out → none; break-out session from another shift → none; MISSED_OUT is not a break-out; no email or WhatsApp attempt. Races in `break-not-returned-race.spec.ts`: a return clock-in holding the State lock first wins; one waiting behind the notice does not retract it; a schedule save holding the employee lock first is waited for; a failure after the notice insert rolls back notice, audit and outbox and the retry records exactly one.
- [x] T040 [P] [US4] BW-10 RLS and grants in `apps/worker/src/modules/staff/__tests__/break-not-returned-rls.spec.ts` and `packages/db/src/__tests__/privileges.spec.ts`; EXPLAIN of the due-break page in `break-not-returned-explain.spec.ts`.

### Implementation

- [x] T041 [US4] Migration: `attendance_break_not_returned_notices` + FORCE RLS + `pospay_app` SELECT/INSERT (next free number after 0110; renumbered at merge if lane 2 lands first).
- [x] T042 [US4] Worker domain `break-not-returned.ts`, port, persistence, use case `detect-break-not-returned`; the processor runs both detectors (plan D8).
- [x] T043 [US4] Event `ShiftBreakNotReturned` (`events/published.ts`, `index.ts`, `NOTIFICATION_SOURCE_EVENTS` additive, `docs/module-map.md` + `.yaml`); template `break_not_returned` rev 1 in contracts, `packages/notifications`, i18n ar/en, admin bell; OpenAPI and generated clients.
- [x] T044 [US4] ADR-0037 addendum (the break alert rides the same sweep); `IMPLEMENTATION-PLAN.md` new row for default working hours and break on the employee profile (Abu Salem, BW-Q4 comment).

## Phase 10: Polish (16b-2 rework)

- [x] T045 Gates as T027 plus `pnpm --filter @pospay/worker test`; DB review (touches `packages/db`); review layer 1.
- [x] T047 [US4] BW-Q10/BW-Q11 (Waleed, 2026-10-10): keep the same-branch return; widen the break-out window to `[break start − 10 min, break end)` in the candidate `EXISTS` and the locked probe (`BREAK_OUT_LEAD_MS`, `breakOutWindowStart`). Tests: 12:50 alerts, 12:49 does not; QR out 12:55, back 14:05 → 0 late (`clock-break-return.spec.ts`, no lateness change needed).
- [x] T048 [US4] L2 fixes: remove the stray `persistence/=` file; overnight-break job test (20:00–04:00, break 00:30–01:00, sweep 01:10); two shifts in one day with their own notices and events; journal trailing newline.
- [x] T046 Push without force, PR #147 title "16b-2 — return-from-break lateness + not-returned alert", `@codex review`.

## Dependencies

- T001 (16c on main) → everything.
- Phase 2 → Phases 3 and 4. US1 and US2 share T016 (persistence); do US1 first, then US2.
- Phase 7 depends on 16b-1 merged (columns and instants exist).
- Within each story: tests → implementation → checkpoint.

## Parallel opportunities

- Phase 2: T003, T005, T006 in parallel; T007 after T006; T009 in parallel with T007.
- US1: T011–T015 in parallel (different files); T019 and T021 in parallel with T016/T017.
- US2: T022 and T023 in parallel.
- US3: T030–T032 in parallel.

## Implementation strategy

- MVP = Phases 1–3 (US1): managers set and see breaks in a week.
- Then US2 (templates) in the same PR 16b-1, then PR 16b-2 (US3).
- If the orchestrator chooses one PR, run Phases 7–8 on the same branch before T029 and merge T029/T037 into one PR.
