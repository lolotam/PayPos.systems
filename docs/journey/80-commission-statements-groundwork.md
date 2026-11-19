# 80 · Monthly commission statements: the groundwork — كشوف العمولة الشهرية: الأساس

**Status / الحالة:** nothing to click. These merged PRs build what a monthly commission statement will stand on;
**no statement can be generated, reviewed, approved or exported yet** (spec 059 rows 51, 52, 53, 54 and the export
request route 56-1c are not built):

- **Inputs kept as they happen** (row 50): #611 (50-a: the engine's input assembly), #613 (21-a: `SalaryChanged`
  names its business), #645 (36-5: the paged reader of current tips), #659 (50-0: the bounded outbox replay), #790
  (50-1: service lines projected into commission lines), #813 and #844 (50-2a, 50-2b: tips and salary reducers and
  tables), #928 (50-2b: tips and salary changes projected).
- **Catching up old data** (row 50-3): #983 (the replay runner), #998 (the tips bootstrap), #1010 (the coverage
  report), #1023 (the six-type replay after a rollback).
- **Statement storage and corrections** (rows 48a, 52, 55): #650 (statement tables and the period lock), #816, #821,
  #1014, #1020, #1024 (correction targets, the reviewed-statement return, correction storage and arithmetic, the
  month reader and recompute).
- **The Excel export** (row 56): #651 (binary documents in the worker), #707 (the export request table), #717 (the
  workbook and its worker source), #727 (the branch name frozen on approved lines).

On staging the worker consumer `commissions.project-inputs` runs: every recorded visit, price edit, cancellation,
performer change, tip and salary change is projected. Nothing of it shows on a screen.

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md) with API, worker and Redis, then `pnpm db:migrate` and `pnpm db:seed`.
- The `orders` and `commissions` features on; an employee with a plan version ([78](78-commission-plan-versions.md)).
- Database access for the assertions (local only; never on production).

## العربي

مفيش حاجة تدوس عليها. اللي اتبنى هو تجميع مدخلات العمولة في الخلفية، وتخزين الكشوف والتصحيحات، وملف الـ Excel.

1. **زيارة اتسجّلت:** سجّل زيارة لمنى ([47](47-record-visit-reception.md)) ← الـ worker بيكتب سطر عمولة لكل (سطر خدمة
   × منفّذة) في `commission_lines`، بتاريخ يوم الشغل وشهره.
2. **تعديل أو إلغاء:** عدّل السعر ([49](49-price-discount-edit.md)) أو الغي السطر
   ([51](51-cancel-service-line.md)) أو غيّر المنفّذين ([52](52-change-line-performers.md)) ← نفس سطور العمولة بتتحدّث.
3. **بقشيش وراتب:** سجّل بقشيش ([50](50-visit-tips.md)) أو غيّر الراتب ([18](18-set-salary.md)) ← بيتسجّلوا كمدخلات
   لنفس الشهر.
4. **مرة واحدة:** نفس الحدث لو اتبعت تاني ← ما بيتحسبش مرتين.
5. **بيانات قديمة:** الزيارات اللي اتسجّلت قبل ما الـ consumer يشتغل بتتجاب بأوامر تشغيل يدوية موثّقة في
   `docs/runbook.md` (إعادة تشغيل الأحداث، تحميل البقشيش، وتقرير التغطية). دي للمشغّل، مش لمستخدم.
6. **الكشف:** لسه مفيش طلب «اعمل كشف الشهر»، ولا مراجعة ولا اعتماد ولا دفع، ولا تنزيل Excel. الجداول والقفل
   (`commission_statements`) والملف جاهزين، ومفيش route يشغّلهم.

**ممنوع يحصل:**
- حدث واحد يتحسب مرتين في مدخلات العمولة.
- مبلغ بايظ في حدث يتحوّل لصفر أو يتقرّب (الحدث بيتركن، مش بيتخمّن).
- مدخلات شركة تظهر لشركة تانية.
- كتابة على شهر معتمد من غير ما تتسجّل تصحيح.
- أمر إعادة التشغيل يمسح أو يصفّر `published_at` أو `consumed_events`.

## English

Nothing to click. What was built is the background collection of commission inputs, the storage of statements and
corrections, and the Excel file.

1. **A visit is recorded:** record a visit for Mona ([47](47-record-visit-reception.md)) → the worker writes one
   commission line per (service line × performer) in `commission_lines`, with its business date and month.
2. **An edit or a cancellation:** edit the price ([49](49-price-discount-edit.md)), cancel the line
   ([51](51-cancel-service-line.md)) or change the performers ([52](52-change-line-performers.md)) → the same
   commission lines are updated.
3. **Tips and salary:** record a tip ([50](50-visit-tips.md)) or change the salary ([18](18-set-salary.md)) → both
   are stored as inputs of the same month.
4. **Exactly once:** the same event delivered again → it is not counted twice.
5. **Old data:** visits recorded before the consumer ran are brought in by operator commands documented in
   `docs/runbook.md` (the event replay, the tips bootstrap and the coverage report). These are for the operator, not
   for a user.
6. **The statement:** there is still no "generate this month's statement" request, no review, approval or payment,
   and no Excel download. The tables, the period lock (`commission_statements`) and the workbook exist; no route
   starts them.

**Must NOT happen:**
- One event counted twice in the commission inputs.
- A malformed amount in an event turned into zero or rounded (the event is parked, never guessed).
- One company's inputs visible to another.
- A write to an approved month that is not recorded as a correction.
- A replay command resetting or deleting `published_at` or `consumed_events`.

## For an agent

- **Screens and routes:** none. `apps/api/src/modules/commissions/use-cases/` holds only the plan-version and
  override writers; no statement route is mounted.
- **Worker:** `apps/worker/src/modules/commissions/use-cases/` (`project-service-lines`, `project-session-tips`,
  `project-salary`, `bootstrap-session-tips`, `report-commission-coverage`, `read-commission-statement-export`,
  `commission-month-recompute.ts`); consumer name `commissions.project-inputs`.
- **Engine:** `packages/commissions-engine` (ADR-0054); journey [06](06-commission-engine-i.md) for its rules.
- **Export:** workbook builder `packages/documents/src/excel/commission-statement.ts`, worker source
  `apps/worker/src/documents/sources/commission-statement.source.ts`, labels
  `packages/i18n/src/commission-statement-catalog.ts`.
- **Operator commands:** `docs/runbook.md`, section «50-3a: replay retained commission inputs» and the ones after it
  (`node dist/replay-commission-inputs.js --company <uuid>`).
- **Assertions (DB):** every commission table has `ENABLE` + `FORCE` RLS (cross-tenant read = 0 rows, write =
  error); a consumed event id is recorded once; a statement's status starts at `DRAFT`.
- **Sources:** `docs/specs/059-commissions-statements/spec.md` (FR-001 … FR-004, FR-014 … FR-024, delivery rows
  48a-2, 50-0 … 50-3d, 55-1, 56-1), `docs/specs/059-commissions-statements/plan-50-3.md`, `plan-55-1b.md`,
  `plan-56-1b.md`.
