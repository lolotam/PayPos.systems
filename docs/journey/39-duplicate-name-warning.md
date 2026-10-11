# 39 · Duplicate-name warning — تنبيه الاسم المتكرر عند إضافة أو تعديل موظف

**Status / الحالة:** shipped in #136 (PR 8b, merged), with the follow-up fix #142 (closes issue #139). **Warning, never a block**
(CE-Q-NAMES, DN-Q1 to DN-Q8, all answered by you on 2026-10-09; Abu Salem chose the same). The check is a new read-only
API call, `POST /v1/businesses/{businessId}/employees/name-matches`, which is **live on staging** (api + worker at commit
`6c220e4`, 2026-10-11). The screen that shows the warning is in the **admin**, which is **not deployed yet** (issue #54), so
the screen runs locally only. No OTP is involved. #142 changed nothing on screen: it re-keyed the stored match keys of
employees that existed before #136 with the same TypeScript function the new employees use (so old and new rows match the same
way, including names with accents like `JOSÉ`), and made the two keys required. Decisions:
[owner-questions.ar.md](../specs/038-staff-duplicate-name-warning/owner-questions.ar.md).

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md), then `pnpm db:migrate` (the two name-key columns, the re-key step, the key
  constraint) and `pnpm db:seed`. API and admin running; the company's `staff` feature enabled.
- Signed in as a user who can create and edit employees (`manage:employees:business`, [13](13-create-employee.md)) with a
  company and business selected ([02](02-admin-workspace-selector.md)). One business, two branches: Salmiya and Hawalli.
- Synthetic employees ([13](13-create-employee.md)): **Sara Ahmed / سارة أحمد** in Salmiya, **Heba / هبة** in Salmiya
  (give her a past contract end for the "ended contract still counts" check), **Sara Mohamed / سارة محمد** in Hawalli.
  A second business in the same company with an employee named **Sara Ahmed** (must never trigger a warning).
- A second user who manages **Hawalli only** (for the hidden-branch check). Placeholders only, no real names or phones.

## العربي

1. **الإضافة بدون تكرار:** من القائمة الجانبية **إضافة موظف** ← `/staff/create`. اكتب **الاسم بالإنجليزية** = `Mona Ali`،
   سيب **الاسم بالعربية (اختياري)** فاضي، واملأ باقي الحقول ← **إضافة موظف** ← **تمت إضافة الموظف:** على طول، من غير أي
   تنبيه (DN-04). الفحص بيتعمل قبل الحفظ، فالضغطة الواحدة بتفحص وتحفظ لو مفيش تكرار.
2. **التنبيه:** اكتب **الاسم بالإنجليزية** = `Sara Ahmed` و**الاسم بالعربية (اختياري)** = `سارة أحمد` ← **إضافة موظف** ← قبل
   أي حفظ بيظهر مربع تنبيه (`role="alert"`) عنوانه **موظفة بنفس الاسم** وتحته **فيه موظفة بنفس الاسم، ضيف الاسم الرباعي؟**
   وقائمة فيها سارة أحمد: الاسم بالإنجليزي · الاسم بالعربي · الفرع الأساسي · الدور (مثلاً **موظف**). وزرارين:
   **تعديل الاسم** و**حفظ على أي حال**. لسه ما اتحفظش أي موظف (DN-01).
3. **تعديل الاسم:** دوس **تعديل الاسم** ← المربع يقفل، والنموذج يفضل مفتوح بكل القيم اللي كتبتها، ومفيش حفظ (DN-03).
   غيّر الاسم لـ `Sara Ahmed Hassan` ← **إضافة موظف** ← تتحفظ من غير تنبيه (الاسم الكامل مختلف، والمطابقة كاملة مش
   «بيبدأ بـ»).
4. **حفظ على أي حال:** ارجع للاسم المتكرر ← **إضافة موظف** ← **حفظ على أي حال** ← **تمت إضافة الموظف:**. اتسجل موظف تاني
   بنفس الاسم بالظبط، بنفس بيانات الإضافة العادية (موظف واحد، ارتباط فرع واحد، سطر تدقيق واحد) (DN-02). مفيش علامة
   «اتحفظ رغم التنبيه» في التدقيق (DN-Q7).
5. **إيه اللي بيعتبر «نفس الاسم» (DN-Q2 وDN-Q3):** جرّب `  heba ` (مسافات وحروف صغيرة) أو `هبه` بدل `هبة` ← بيظهر
   التنبيه. كمان `سَارَة` بالتشكيل، و`ســارة` بالتطويل، و`إيمان` مقابل `ايمان`. العربي بيتقارن بالعربي، والإنجليزي
   بالإنجليزي بس؛ لو كتبت الاسم العربي فاضي ما بيتقارنش بأي اسم عربي فاضي. `سارة` لوحدها **مش** نفس `سارة أحمد`.
6. **مين بيتحسب (DN-Q1 وDN-Q4):** كل موظفة في **كل فروع نفس النشاط**؛ هبة اللي عقدها خلص لسه بتظهر في التنبيه. موظفة
   اتمسحت (soft delete) ما بتظهرش. موظفة بنفس الاسم في **نشاط تاني** أو **شركة تانية** ما بتعملش تنبيه (DN-09).
7. **التعديل (DN-Q6):** افتح **تعديل** على «سارة محمد» (حولي) وغيّر **الاسم بالإنجليزية** إلى `Sara Ahmed` ←
   **حفظ التعديلات** ← نفس مربع التنبيه، والقائمة فيها سارة أحمد **ومفيهاش الموظفة اللي بتتعدل** (DN-06). **حفظ على أي
   حال** ← **تم تعديل الموظف.** بنفس قواعد التعديل العادية (النسخة وتاريخ الفروع) (DN-07). غيّر **تاريخ التعيين** بس من
   غير ما تلمس الاسم ← بيتحفظ من غير أي فحص (DN-08). الاسم زي ما هو من غير تغيير ← برضه من غير فحص.
8. **الفرع اللي مش مسموح لك تشوفه (DN-Q5):** ادخل كمدير حولي بس وأضف `Sara Ahmed` (الموجودة في سالمية) ← التنبيه فيه
   السطر **فيه موظفة تانية بنفس الاسم في فرع مش مسموح لك تشوفه.** من غير اسمها ولا فرعها ولا عددهم. لو فيه مطابقات
   تانية مسموح لك تشوفها بتظهر بالتفصيل فوقه. لو المطابقات المسموحة أكتر من 10، القائمة بتعرض 10 بس وتحتها
   **تطابقات إضافية مسموح لك تشوفها:** والعدد الباقي.
9. **التنبيه استشاري (DN-12):** اقفل الـ API أو خلّي طلب الفحص يفشل (مثلاً من أدوات المتصفح) ← **إضافة موظف** ← الموظف
   بيتحفظ عادي من غير تنبيه. الفحص ما بيمنعش الحفظ أبدًا.
10. **الاستيراد:** استيراد الموظفين من ملف ([27](27-employee-import.md)) **مفيهوش تنبيه** (DN-Q8)، بس بيخزّن مفاتيح
    المطابقة للأسماء الجديدة عشان تظهر في تنبيهات الإضافة اللي بعده.

**ممنوع يحصل:**
- السيرفر يرفض أو يأخّر أو يغيّر إضافة أو تعديل بسبب اسم متكرر (DN-13: الـ API المباشر بنفس الاسم يرجع 201 و200 زي
  الأول).
- التنبيه يكشف موظفة من نشاط/شركة تانية، أو اسم/فرع/عدد موظفة في فرع مش مسموح لك تشوفه.
- «حفظ على أي حال» يبعت قيم مختلفة عن اللي كتبتها، أو يتسجل في التدقيق كحدث لوحده.
- التنبيه يقارن الموظفة بنفسها عند التعديل، أو يظهر وانت ما غيّرتش الاسم.
- موظفة اتمسحت تعمل تنبيه، أو موظفة عقدها خلص ما تعملش.

## English

1. **Create with no duplicate:** sidebar **Create employee** → `/staff/create`. Type **English name** = `Mona Ali`,
   leave **Arabic name (optional)** empty, fill the rest → **Create employee** → "Employee created:" at once, with no
   warning (DN-04). The check runs before the save, so one press checks and saves when there is no duplicate.
2. **The warning:** type **English name** = `Sara Ahmed` and **Arabic name (optional)** = `سارة أحمد` → **Create employee**
   → before anything is saved a box appears (`role="alert"`), titled "Same-name employee", with "An employee with the
   same name exists. Add the full four-part name?" and a list holding Sara Ahmed: English name · Arabic name · primary
   branch · role (for example "Staff"). Two buttons: **Edit name** and **Save anyway**. Nothing is saved yet (DN-01).
3. **Edit name:** press **Edit name** → the box closes, the form stays open with every typed value, nothing is saved
   (DN-03). Change the name to `Sara Ahmed Hassan` → **Create employee** → saved with no warning (the full name differs;
   matching is whole-name, not "starts with").
4. **Save anyway:** go back to the duplicate name → **Create employee** → **Save anyway** → "Employee created:". A second
   employee with exactly the same name exists, created like any normal create (one employee, one branch attachment, one
   audit entry) (DN-02). The audit has no "saved despite warning" flag (DN-Q7).
5. **What counts as "the same name" (DN-Q2, DN-Q3):** try `  heba ` (spaces, lower case) or `هبه` for `هبة` → the warning
   appears. Also `سَارَة` with diacritics, `ســارة` with tatweel, and `إيمان` against `ايمان`. Arabic is compared with
   Arabic and English with English only; an empty Arabic name never matches another empty one. `سارة` alone is **not**
   the same as `سارة أحمد`.
6. **Whose names count (DN-Q1, DN-Q4):** every employee in **every branch of the same business**; Heba, whose contract
   ended, still shows. A removed (soft-deleted) employee does not. A same-name employee in **another business** or
   **another company** raises no warning (DN-09).
7. **Edit (DN-Q6):** open **Edit** on "Sara Mohamed" (Hawalli) and change **English name** to `Sara Ahmed` →
   **Save changes** → the same box, and the list holds Sara Ahmed **but not the employee being edited** (DN-06).
   **Save anyway** → "Employee updated." under the normal update rules (revision, branch history) (DN-07). Change only
   **Hire date** and leave the names alone → saved with no check (DN-08). Names unchanged → no check either.
8. **A branch you may not see (DN-Q5):** sign in as the Hawalli-only manager and add `Sara Ahmed` (who exists in Salmiya)
   → the box carries the line "Another employee with this name exists in a branch you cannot see." with no name, branch
   or count. Matches you may see are listed in full above it. With more than 10 visible matches the list shows 10 and
   "Further visible matches:" with the remaining number.
9. **The check is advisory (DN-12):** make the check request fail (for example block it in the browser tools) →
   **Create employee** → the employee saves normally with no warning. The check never blocks a save.
10. **Import:** the employee import from a file ([27](27-employee-import.md)) has **no warning** (DN-Q8), but it stores the
    match keys of new names so they appear in later create warnings.

**Must NOT happen:**
- The server refusing, delaying or altering a create or update because of a duplicate name (DN-13: a direct API call with a
  duplicate name still returns 201 and 200 as before).
- The warning revealing an employee of another business or company, or the name, branch or count of an employee in a
  branch you may not see.
- "Save anyway" sending different values from those typed, or being recorded as its own audit event.
- The edit check comparing an employee with herself, or running when no name changed.
- A removed employee raising a warning, or an employee whose contract ended not raising one.

## For an agent

- Admin at `http://localhost:3001/staff/create` and `http://localhost:3001/staff` (**Edit**). Find the warning by
  `role="alert"` containing "Same-name employee" / «موظفة بنفس الاسم»; buttons by text **Edit name** / **تعديل الاسم** and
  **Save anyway** / **حفظ على أي حال**. The form's submit button is **Create employee** / **Save changes**; on a clean
  name it saves directly, so the assertion for "no warning" is the success message, not an absent box.
- API (session cookie + `x-company-id`, no `Idempotency-Key`, no write):
  `POST /v1/businesses/{businessId}/employees/name-matches` with body `{ "name_en": "Sara Ahmed", "name_ar": "سارة أحمد",
  "exclude_employee_id": "<employee uuid>" }` (`name_ar` and `exclude_employee_id` optional; strict, unknown keys refused)
  → **200** `{ "matches": [ { "id", "name_en", "name_ar", "primary_branch_id", "role_code" } ], "visible_total": 1,
  "hidden_exists": false }`. At most 10 `matches`, ordered by English name then id; `visible_total` is the full visible
  count; `hidden_exists` is true when a match sits in a branch the caller cannot see (never a count, never details).
  Errors: 400 `VALIDATION_FAILED`, 403 `FORBIDDEN` (no branch where you hold `manage:employees:business`), the staff
  feature off → `FEATURE_DISABLED`, `NOT_READY`. No new permission and no new error code.
- Assertions: a body-only name (never in the URL); the same body from another company or business returns empty;
  `POST …/employees` and `PATCH …/employees/{id}` with a duplicate name still return 201 and 200. The match keys
  (`name_en_key`, `name_ar_key`) are internal and never in any response.
- Sources: `docs/specs/038-staff-duplicate-name-warning/spec.md`, `apps/admin/src/staff/ui/duplicate-name-warning.tsx`,
  `apps/admin/src/staff/model/use-name-checked-submit.ts`, `apps/api/src/modules/staff/http/employees.controller.ts`,
  `packages/domain` (`employeeNameMatchKey`), `packages/i18n/src/{ar,en}.ts` (`staff.duplicateName*`).
