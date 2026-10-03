# 18 · Set salary — تعيين الراتب

**Status / الحالة:** shipped in #88 (PR 10, merged). Local only (admin not deployed, issue #54).
Your decisions of 2026-10-03/04 apply: monthly BASIC salary, any effective date, same-date replacement,
zero allowed, mandatory reason, owner access by default and explicit personal read + manage for other editors.
SS-Q2's separate entry point for salary-only delegates is deferred; the current employee panel also needs employee-management access.

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md), apply the salary migration and run `pnpm db:seed` for the permission catalog.
  Sign in and select a company and business ([01](01-admin-sign-in-and-totp.md), [02](02-admin-workspace-selector.md)); `staff` is enabled.
- Prepare a synthetic employee ([13](13-create-employee.md), [16](16-update-employee.md)) and an active owner.
  Prepare three non-owner testers with employee-management access: personal salary read + manage, read only, and neither.
  Salary permissions must cover the persisted primary branch and every open-ended working-branch attachment.
- Use only synthetic amounts: `0.007`, `0.008` and `0.000` KWD below are test fixtures, never real employee salaries.
  Use a past and a future Gregorian date relative to the test day, and a synthetic reason.
- The owner changing permissions needs the authority described in [12](12-permissions-screen.md).
  Use separate signed-in sessions for the owner and the delegated testers; no real credentials in notes or examples.

## العربي

1. من القائمة الجانبية افتح **الموظفون** ← `/staff`، ودوس **تعديل** على موظف التجربة ← **تعديل الموظف**.
   تحت بيانات الموظف يظهر **الراتب الأساسي الشهري** بعد قراءة جديدة ناجحة، والوصف
   **الراتب الأساسي فقط، بدون بدلات أو عمل إضافي. تعيين نفس التاريخ يستبدل سجله.**
2. في **يسري من** اكتب تاريخ سابق صالح، وفي **الراتب الأساسي الشهري (د.ك، ٣ خانات)** اكتب `0.007`،
   وفي **السبب** اكتب سبب تجربة ← **تعيين الراتب** ← **تم حفظ الراتب.**
   السجل يعرض التاريخ والمبلغ بثلاث خانات و**النسخة** و**السبب**؛ أول سجل للتاريخ ده نسخته `1`.
3. اكتب نفس التاريخ ومبلغ التجربة `0.008` وسبب جديد ← **تعيين الراتب** ← **تم حفظ الراتب.**
   نفس سطر التاريخ يتحدث، و**النسخة** تزيد `1`؛ مفيش سطر تاني لنفس التاريخ ولا حذف للراتب.
   حتى إعادة نفس المبلغ بسبب جديد تعتبر قرار تعيين جديد وتزيد النسخة؛ التدقيق يحتفظ بالقبل والبعد.
4. اكتب تاريخ مستقبلي مع `0.007` وسبب ← **تعيين الراتب** ← **تم حفظ الراتب.**؛ التاريخ السابق يفضل موجود والمستقبلي يبقى سطر مستقل.
   أي تاريخ ميلادي صالح مسموح، سابق أو مستقبل. السجل مرتب من أحدث تاريخ سريان للأقدم؛ استخدم
   **الصفحة التالية** و**الصفحة الأولى** لو البيانات أكتر من صفحة. ده راتب أساسي شهري، مش بدلات أو إضافي.
5. اكتب `0.000` مع تاريخ وسبب ← **تعيين الراتب** ← **تم حفظ الراتب.**؛ الصفر مسموح لمتدرب أو موظف عمولته بس.
   جرّب مبلغ سالب، أو `0.0071`، أو `0.01`، أو تاريخ غير صالح، أو سبب فاضي ←
   **أدخل تاريخًا صحيحًا ومبلغًا غير سالب بثلاث خانات عشرية وسببًا من ١ إلى ٥٠٠ حرف.**
   لازم المبلغ يبقى بثلاث خانات بالظبط والسبب من 1 إلى 500 حرف بعد شيل المسافات؛ الرفض ما يغيّرش السجل.
6. من حساب المالك افتح **الصلاحيات** ← **عرض** على عضوية المفوّض. في **الصلاحية** اختار **قراءة سجل الرواتب**،
   ثم **القرار** = **سماح**، و**النطاق** = **النشاط** ومعرّفه، و**السبب** ← **حفظ الاستثناء** ← **حُفظ الاستثناء.**
   كررها لـ **تعيين الراتب**. مع اختيار أي صلاحية رواتب يظهر التلميح
   **تُدار الرواتب من شاشة الموظفين، وتحتاج أيضًا إلى صلاحية إدارة الموظفين.**
   لازم الإذنين يتمنحوا للشخص صراحة؛ دور مدير وحده ما بيدّيش صلاحيات رواتب. **منع** الساري بيغلب السماح.
7. افتح نفس الموظف بحساب كل حالة من الجدول. الجدول بيفترض وصول إدارة الموظفين ونطاق صحيح، والميزة مفعلة:

   | الحالة | صلاحيات الرواتب | اللي لازم يظهر |
   |---|---|---|
   | مالك نشط | قراءة وإدارة افتراضيًا | السجل ونموذج تعيين الراتب |
   | شخص معاه قراءة + إدارة صريحة | الاتنين ساريين | السجل والنموذج؛ الحفظ مسموح |
   | شخص معاه قراءة بس | قراءة صريحة فقط | السجل بس؛ نموذج التعيين مش ظاهر والحفظ من الـ API مرفوض |
   | شخص من غير صلاحيات رواتب | ولا إذن | قسم الرواتب والمبالغ مش ظاهرين؛ قراءة/كتابة الـ API مرفوضة |

   إذن إدارة الرواتب من غير القراءة كمان ما يسمحش بالكتابة. مفوّض الرواتب اللي مش معاه إدارة الموظفين
   ما يقدرش يوصل للوحة الحالية؛ مدخل مستقل ليه مؤجل ضمن SS-Q2، والصلاحيات ما تتوسعش تلقائيًا.
8. بعد ما المفوّض يشوف السجل، اقفل اللوحة بـ **العودة إلى الموظفين**. من حساب المالك استخدم **سحب الاستثناء**
   على إذن القراءة واكتب سبب ← **تم سحب الاستثناء.** افتح الموظف تاني من حساب المفوّض:
   قسم الرواتب يختفي من أول الفتح، من غير عرض مبلغ قديم أثناء الطلب. لو اتسحب إذن الإدارة بس والقراءة لسه سارية،
   السجل يظهر بعد القراءة الجديدة لكن نموذج التعيين يختفي. الإغلاق أو رفض 403/404 يمسح بيانات الرواتب المخزنة في المتصفح.
9. من الـ API، موظف مجهول أو محذوف أو من شركة/نشاط تاني أو رواتبه خارج صلاحيات القارئ ←
   نفس 404 **المسار غير موجود** (`NOT_FOUND`) من غير كشف مبلغ أو وجود سجل. كتابة بإذن قراءة بس مرفوضة بنفس الخطأ.
   كل تعيين مقبول يحفظ الراتب والتدقيق بالفاعل والسبب وقبل/بعد وحدث `SalaryChanged` في معاملة واحدة؛ فشلها ما يسيبش حفظ جزئي.

**ممنوع يحصل:**
- راتب حقيقي في أمثلة التجربة، أو راتب بمبلغ سالب أو خانات ناقصة/زيادة، أو حفظ من غير سبب.
- دور غير المالك يقرأ أو يعيّن راتب تلقائيًا؛ إذن إدارة وحده يسمح بالكتابة؛ توسيع وصول الموظفين لمفوّض الرواتب تلقائيًا.
- مبلغ قديم يظهر عند إعادة فتح اللوحة بعد سحب القراءة، أو قسم الرواتب يظهر قبل تفويض جديد ناجح.
- حذف سجل راتب، أو سطرين لنفس التاريخ، أو استبدال من غير زيادة نسخة وتدقيق؛ رفض يكشف راتبًا أو يحفظ جزءًا من القرار.

## English

1. Sidebar **Employees** → `/staff`, then **Edit** on the synthetic employee → **Edit employee**.
   Below employee details, **Monthly basic salary** appears after a successful fresh read, with
   "Basic salary only, without allowances or overtime. Setting the same date replaces its entry."
2. Enter a valid past **Effective from**, synthetic `0.007` in **Monthly basic salary (KWD, 3 decimals)**,
   and a test **Reason** → **Set salary** → "Salary saved."
   History shows the date, three-decimal amount, **Revision** and **Reason**; the first entry for that date has revision `1`.
3. Set the same date to synthetic `0.008` with a new reason → **Set salary** → "Salary saved."
   That date's row is replaced and **Revision** increases by `1`; there is no second row for the date or salary deletion.
   Even setting the same amount again with a new reason is another decision and increments revision; audit retains before/after.
4. Set a future date to `0.007` with a reason → **Set salary** → "Salary saved." The past date remains and the future date gets its own entry.
   Any valid Gregorian date is allowed, past or future. History orders effective dates newest first; use **Next page** and
   **First page** for longer histories. These are monthly basic salaries, without allowances or overtime.
5. Enter `0.000` with a date and reason → **Set salary** → "Salary saved." Zero is valid for a trainee or commission-only employee.
   Try a negative amount, `0.0071`, `0.01`, an invalid date or a blank reason →
   "Enter a valid date, a nonnegative KWD amount with 3 decimals and a reason (1–500 characters)."
   Exactly three decimals and a trimmed reason of 1–500 characters are required; refusal preserves history.
6. As the owner, open **Permissions** → **View** on the delegate's membership. Select **Read salary history** under
   **Permission**, **Allow** under **Decision**, **Business** under **Scope**, its identifier and **Reason** →
   **Save override** → "Override saved." Repeat for **Set salary**. Selecting either salary permission shows
   "Salaries are managed from the employee screen and also require employee-management access."
   Both permissions must be granted explicitly to the person; a manager role alone grants neither. An effective **Deny** wins.
7. Open the same employee as each tester. This table assumes employee-management access, valid scope and the enabled feature:

   | Scenario | Salary permissions | Expected result |
   |---|---|---|
   | Active owner | Read and manage by default | History and salary form |
   | Person with explicit read + manage | Both effective | History and form; saving allowed |
   | Person with read only | Explicit read only | History only; no form; API writes refused |
   | Person with no salary permission | Neither | No salary section or amounts; API reads/writes refused |

   Manage without read also cannot write. A salary delegate without employee-management access cannot reach the current panel;
   a separate entry point is deferred under SS-Q2, and employee visibility is never widened automatically.
8. After the delegate has seen history, close the panel with **Back to employees**. As owner, **Revoke override** on the
   read permission with a reason → "Override revoked." Reopen as the delegate: the salary section is hidden from the start,
   without displaying a cached amount while the request runs. If only manage was revoked and read remains, fresh history appears
   but the form does not. Closing or a 403/404 refusal removes the browser's salary cache.
9. API checks: an unknown, deleted, other-company/business employee or unreadable salary history → the identical
   404 "Not found" (`NOT_FOUND`), without revealing an amount or history existence. Read-only writes get that same refusal.
   Each accepted set saves salary, actor/reason/before/after audit and `SalaryChanged` in one transaction; failure leaves no partial decision.

**Must NOT happen:**
- Real salaries in fixtures, negative/wrong-precision amounts, or saving without a reason.
- Automatic non-owner salary access, manage-only writes, or automatically widening a salary delegate's employee access.
- Cached amounts on reopen after read revocation, or salary content before fresh authorization succeeds.
- Deletion, duplicate dates, replacement without revision/audit, privacy leaks or partial writes on refusal.

## For an agent

- Admin: `http://localhost:3001/staff`; open the employee panel and locate **Monthly basic salary** / **الراتب الأساسي الشهري**.
  Controls: `#salary-date`, `#salary-amount`, `#salary-reason`. Permissions: `http://localhost:3001/permissions`,
  `#override-permission`; select each salary permission to assert the exact access hint above.
- API uses a session cookie and `x-company-id`. `GET /v1/businesses/{businessId}/employees/{employeeId}/salaries?limit=20`
  returns `{ items, next_cursor, can_manage }`; an optional `cursor` is an effective date, descending and exclusive.
  `POST` to the salaries URL with `Idempotency-Key: <UNIQUE_TEST_KEY>` and
  `{ "effective_from": "<GREGORIAN_DATE>", "amount": "0.007", "reason": "<SYNTHETIC_REASON>" }` → 200 salary entry.
  Replace placeholders before running; amounts are decimal strings, never JSON numbers. There is no delete operation.
- A new set uses a new key. Same key + identical body replays without incrementing revision or adding audit/event;
  same key + different body is `IDEMPOTENCY_KEY_REUSED` (422). Reauthorization occurs even on replay after revocation.
- Inspect only synthetic DB fixtures: `employee_salary` / `salary.set` audit with actor, reason and before/after;
  matching `SalaryChanged` outbox payload with effective date, decimal amount and revision. Audit/event failure rolls back the row.
- Agent-only privacy check: review `packages/observability/src/redaction.ts` and its salary privacy tests, or capture logger output
  using synthetic fixtures. Salary containers, standalone/nested amounts and salary-shaped reasons must be redacted in technical logs,
  including nested audit/event objects and failure paths. Stored business audit retains the decision. No owner log-access steps are needed.
- Reopen assertion: hold the fresh history response pending; no cached amount or form may render. After revoked read returns 404,
  the section remains absent and its cache is removed. Scope checks include persisted primary and all open-ended attachments;
  unknown/inaccessible employee GET/POST envelopes match. Disabled staff is refused after access checks.
- Sources: `docs/specs/021-staff-set-salary/spec.md`, `apps/admin/src/staff/ui/employee-salary-section.tsx`,
  `salary-form.tsx`, `salary-history-table.tsx`, `apps/admin/src/staff/api/use-salaries.ts`,
  `apps/admin/src/permissions/ui/permission-decision-fields.tsx`, `apps/api/src/modules/staff/http/employee-salaries.controller.ts`,
  salary queries/persistence, `apps/api/src/modules/identity/persistence/employee-salary-access.ts`,
  `packages/contracts/src/staff/salary.ts`, `packages/i18n/src/{ar,en}.ts` and `apps/api/src/shared/errors.ts`.
