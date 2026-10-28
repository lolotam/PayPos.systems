# Plan 061 — 27g-5, the admin download screen for the official attendance statement

Date: 2026-10-28. DESIGN only: no code in this PR. Branch `docs/p1-027g-5-plan`, baseline main `46a0e462`
(27g-1…27g-4 merged: #589, #608, #684, #697). Sources: [spec](spec.md) §2, §4 Story 1–4, §6.8, §7 "Admin", §9 row 5,
§10; [owner-questions](owner-questions.ar.md) (ST-Q6…ST-Q8, PP-61, all answered); [ADR-0049](../../adr/0049-pdf-renderer-in-phase-1.md)
§1.4–§1.6; [ADR-0056](../../adr/0056-attendance-statement-reads-and-logo-reader.md); `CLAUDE.md` §3, §3.1, §7, §9.

## 1. Scope

One admin screen at `/staff/attendance-statement` (the spec calls it a screen throughout, §2 and §9): pick the form,
period, employee, shift and language, request the PDF, wait, download it once. **Admin files, i18n and tests only. No
change in `apps/api`, `apps/worker`, `packages/db` or `packages/contracts`.** The four 27g-4 operations are already in
the generated `apps/admin/src/shared/api/schema.d.ts` (`requestAttendanceStatement`, `attendanceStatementStatus`,
`downloadAttendanceStatement`, `attendanceStatementShifts`). The admin has no generated hooks: every feature writes its
own `use-*.ts` over the typed `apiClient()`, so no hook is missing and the scope does not change. §8 Q1 (decided, PP-74.2: the
monthly report rows) keeps this scope.

## 2. Screen states

| Part | Behaviour |
|---|---|
| Branch | The workspace branch, a `NativeSelect` of `workspace.business.branches` (as 27b). No «all branches»: the API is per branch. |
| Form | Two radios, `BRANCH` (default) and `EMPLOYEE`. |
| Period | Mode «month» (default, `type="month"`, current month in the branch time zone via `localDate`) or «custom» (`from`/`to` dates). Client pre-check: `attendanceStatementShiftPeriodIsValid` from contracts, plus `to` not after the last day of the current branch-local month (Story 3.4). The server stays authoritative. |
| Employee | Optional one-employee filter on `BRANCH`; required on `EMPLOYEE` (submit disabled until chosen). Source: §8 Q1. Shows `employee_number` and the name in the UI language. |
| Shift | `BRANCH` only, hidden on `EMPLOYEE` (the API refuses it, FR-001). Options from FR-001a for the selected period, «all shifts» first; hidden when the list is empty. **Reset when the period changes**: a stale pair is accepted and ends `STATEMENT_EMPTY`. |
| Language | Two radios `ar` / `en`, default the current UI locale (BR-07 only requires the choice). |
| Waiting | After `202 { render_id }`: form locked, `role="status"` «جاري تجهيز الكشف…». Poll every 2 s (spec §10), stop on any terminal state (`READY`, `FAILED`, `EXPIRED`, `CONSUMED`) or at 60 s. |
| Ready | `READY` enables «تنزيل الكشف». The click POSTs collect (`parseAs: 'blob'`) and saves it with an object URL, as `download-attendance-csv.ts` does. |
| After download | The button is disabled; a «طلب كشف جديد» action resets the form state. Collect is once (Story 4.1). |
| 60 s cap | «الكشف لسه بيتجهز» with a manual «تحقق تاني» button that polls once more. Never auto-requests (each request costs one of the 20 per hour). |

**File name.** The browser cannot read `Content-Disposition`: the API is another host and `apps/api/src/app.ts` exposes
only `x-request-id`. FR-007 makes the name deterministic, so the client builds
`attendance-statement-{branch|employee}-{from}_{to}.pdf`. Do not widen CORS (an API change).

**Refusal messages** (`role="alert"`, text from i18n, never the envelope's own message):

| Source | Code | Message |
|---|---|---|
| request 422 | `ATTENDANCE_STATEMENT_PERIOD_INVALID`, `…_SHIFT_FILTER_INVALID` | `attendanceStatementErrorsAr/En` (already in `packages/i18n`) |
| request 404 | `ATTENDANCE_STATEMENT_EMPLOYEE_NOT_FOUND`, `…_BRANCH_NOT_FOUND` | same catalog |
| request 429 / 503 | `ATTENDANCE_STATEMENT_RATE_LIMITED`, `RENDERER_UNAVAILABLE` | same catalog |
| collect 409 / 410 | `DOCUMENT_NOT_READY`, `DOCUMENT_EXPIRED` | same catalog; 410 also shows «طلب كشف جديد» |
| status `FAILED` | `STATEMENT_EMPTY` | `attendanceStatementRenderErrors` |
| status `FAILED` | `DOCUMENT_TOO_LARGE`, `DOCUMENT_RENDER_TIMEOUT`, `DOCUMENT_RENDER_FAILED`, `DOCUMENT_KIND_UNKNOWN` | **new** screen keys (one per code) |
| status `EXPIRED`; status 404 (hash TTL gone) | — | «الكشف انتهى، اطلبي واحد جديد» |
| request, shifts probe | 401, 403, `FEATURE_DISABLED`, `NOT_FOUND` | the `attendanceReportError` shape (session expired, no access, feature off) |
| other | — | `admin.unexpected` |

**404 depends on the route.** On request and the shifts probe, 401/403/404/`FEATURE_DISABLED` mean lost access
(`boardAccessLost`). On status and collect, a 404 means an unknown or expired render (ADR-0049 §1.5): show «الكشف انتهى»
and keep the form; never pass these errors to `boardAccessLost`, which treats 404 as lost access.

## 3. Permission and visibility

BR-08: `read:attendance:branch` on the branch. The nav item is always shown, like `AttendanceReportNavItem`. The access
probe is the FR-001a shifts read for the default period (same guard): `boardAccessLost(error)` hides the form and shows
the no-access message, as the 27b route probes with its own read. The server checks every call again.

## 4. Reuse

`attendance-report-route.tsx` (workspace, session user, branch, time zone; drop the all-branches probe);
`use-employee-import-status.ts` (polling with `refetchInterval` and a deadline); `use-attendance-report-csv.ts` and
`download-attendance-csv.ts` (blob mutation, abort, object-URL release on unmount, `gcTime: 0`); `boardAccessLost`;
`PageHeader`, `Button`, `Input`, `Label`, `NativeSelect` from `@pospay/ui`; contracts `attendanceStatementRequest`
(parse before POST), `attendanceStatementAccepted`, `attendanceStatementStatus`, `attendanceStatementShiftOptions`,
`attendanceStatementShiftsQuery`, `attendanceMonthlyReport*` (picker, §8 Q1). Every query key carries company,
business, branch and user, as 27b does.

## 5. Exact write scope (MiniMax)

```
apps/admin/app/(dashboard)/staff/attendance-statement/page.tsx            new, thin re-export
apps/admin/app/(dashboard)/_frame/attendance-statement-route.tsx          new
apps/admin/app/(dashboard)/_frame/attendance-statement-nav-item.tsx       new
apps/admin/app/(dashboard)/_frame/staff-navigation.tsx                    edit: one item after the report item
apps/admin/src/staff/pages/attendance-statement-page.tsx                  new
apps/admin/src/staff/pages/attendance-statement-page.spec.tsx             new (UI tests, §6)
apps/admin/src/staff/ui/attendance-statement-form.tsx                     new (form + language radios, submit)
apps/admin/src/staff/ui/attendance-statement-period-fields.tsx            new
apps/admin/src/staff/ui/attendance-statement-employee-field.tsx           new
apps/admin/src/staff/ui/attendance-statement-shift-field.tsx              new
apps/admin/src/staff/ui/attendance-statement-progress.tsx                 new (waiting, download, refusal)
apps/admin/src/staff/api/use-attendance-statement-request.ts              new (POST 202 mutation)
apps/admin/src/staff/api/use-attendance-statement-status.ts               new (poll)
apps/admin/src/staff/api/use-attendance-statement-download.ts             new (collect blob)
apps/admin/src/staff/api/use-attendance-statement-shifts.ts               new
apps/admin/src/staff/api/use-attendance-statement-employees.ts            new (picker, §8 Q1)
apps/admin/src/staff/api/download-attendance-statement.ts                 new (object URL + anchor)
apps/admin/src/staff/api/attendance-statement.fixture.ts                  new (test data)
apps/admin/src/staff/model/attendance-statement-display.ts                new (code → key, file name, default period)
apps/admin/src/staff/model/attendance-statement-display.spec.ts           new
packages/i18n/src/attendance-statement-screen-catalog.ts                  new, en + ar (Record<keyof en>)
packages/i18n/src/en.ts, packages/i18n/src/ar.ts                          edit: one import + one section entry each
```

**i18n trap.** Do not add screen keys to `attendanceStatementEn/Ar`: that is the PDF label catalog, and
`__tests__/attendance-statement-catalog.spec.ts` asserts it equals `attendanceStatementLabelKeys` exactly. The screen
uses its own `attendanceStatementScreen` section. Logical CSS only (`ps-`, `me-`, `text-start`); no hardcoded strings;
one component per file, 60 lines per function, 300 per file (§3). Comments only where a choice is not obvious, one
Arabic line each (the stale-shift reset, the client-built file name), §3.1.

## 6. UI tests (`attendance-statement-page.spec.tsx`, visible outcomes, `CLAUDE.md` §9)

On the `attendance-report-page.spec.tsx` harness (mocked `apiClient` GET/POST, fake timers, blob and anchor stubs):
the fields and their labels render in ar and en; on `EMPLOYEE` the shift field is absent and «طلب الكشف» is disabled
until an employee is chosen; the shift options from FR-001a appear and reset after a period change; after `202` the
waiting text shows and the form is locked; the download button is enabled only on `READY`; after one collect it is
disabled and «طلب كشف جديد» shows; each refusal code of §2 shows its message text (one parametrised case per code,
request and collect); `FAILED / STATEMENT_EMPTY` shows its message; the poll stops at 60 s with its message and the
manual check polls once; a 403 on the probe shows the no-access message and no form; a 404 on the status poll shows
the expired message and keeps the form. A mock-call assertion may sit
beside a visible one (the POST body has `shift` only on `BRANCH`, the file name of FR-007), never alone.

## 7. Gates, out of scope, risks

Local gates: `pnpm --filter @pospay/admin typecheck`, `lint`, `test`; `pnpm --filter @pospay/i18n test`;
`pnpm --filter @pospay/admin api:check` (proves the generated schema is in sync); `pnpm lint:docs`.

Out of scope: any API, worker, DB or contract change; CORS; storing the PDF; a PDF preview; a list of past statements;
the employee's own statement (row 57b); Excel; the POS app.

Risks: (1) the 120 s bytes TTL: a user away from the tab misses it and gets 410 → «طلب كشف جديد», tested; (2) a
programmatic download after an async collect, as the CSV already does, so it follows the click gesture; (3) the
20-per-hour limit if the screen retried by itself, so it never does; (4) the picker gap of §8 Q1.

## 8. Decided question (TECHNICAL, Waleed only)

**Decided 2026-10-28 (PP-74.2): option (أ)**, the monthly report rows; the scheduled-only gap becomes a follow-up issue.

**Q1 — where the employee list comes from.** The only employee lists are `/attendance-employees`
(`request:attendance-change:branch`, `attendance-employees.controller.ts:28`) and `/employees`
(`manage:employees:business`, `employee-scope-access.ts:49`). A manager with only `read:attendance:branch` gets 403 from
both. Options: (أ) **recommended:** the 27b report rows (`/attendance-report?month=`, `read:attendance:branch`, rows carry
`employee_id`, names, `employee_number`) for each month the period touches (one call for a month, up to 13 for a long
range), merged by `employee_id`; no API change; gap: an employee whose only coverage is a scheduled shift is not listed;
(ب) reuse `/attendance-employees`: a pure reader cannot pick anyone, rejected; (ج) a new read
`attendance-statement-employees?from&to` with the statement guard and the FR-003 candidate set, as a new API sub-PR
before 27g-5 (scope change).
