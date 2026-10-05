# 19 · Schedules — جداول العمل

**Status / الحالة:** shipped in #89 (PR 16, merged). Local only (admin not deployed, issue #54).
Your decisions apply: Saturday weeks in branch time, up to two non-overlapping shifts per day, overnight start-day ownership,
16-hour maximum, reason for past changes, dated branch/contract eligibility and revision protection.
Template create/apply is API-only; its admin dialogs come in a later PR. Attendance effects are deferred to attendance slices.

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md), apply the schedules migration and run `pnpm db:seed` for schedule permissions.
  PostgreSQL needs `btree_gist`. Sign in and select a company, business and branch ([01](01-admin-sign-in-and-totp.md),
  [02](02-admin-workspace-selector.md)); `staff` is enabled.
- Grid access needs `read:schedules:branch`; editing needs `manage:schedules:branch` in the selected branch scope.
  Default scoped bundles cover owner, general manager, business manager and branch manager. DENY wins.
- Prepare synthetic employees attached on the test days ([13](13-create-employee.md), [16](16-update-employee.md)),
  including one attached to two branches, one attached for only part of a week and one with a contract end within it.
  Prepare a future Saturday week, an eligible past day and two browser tabs. Never use real staff data.
- For an agent's template checks, prepare business-level template read/manage authority and branch schedule read/manage authority.
  Branch-only permission does not authorize template administration. Use placeholders for session cookies, IDs and dates below.

## العربي

1. اختار الفرع وافتح `/schedules` ← **جداول العمل الأسبوعية**، والوصف
   **من السبت إلى الجمعة حسب المنطقة الزمنية للفرع المختار.** من غير فرع يظهر **اختار فرع لعرض الجداول.**
   راجع المنطقة الزمنية المعروضة؛ الأسبوع بيبدأ السبت بتوقيت الفرع، مش توقيت جهازك.
2. في **بداية الأسبوع (السبت)** اختار سبت مستقبلي مناسب. الأعمدة **الموظف**، **السبت**، **الأحد**، **الاثنين**،
   **الثلاثاء**، **الأربعاء**، **الخميس** و**الجمعة** ومعاهم التواريخ. خلية فاضية تعرض **بدون ورديات**؛
   لو مفيش موظفين مؤهلين يظهر **لا يوجد موظفون مرتبطون بالفرع خلال هذا الأسبوع.**
   استخدم **الصفحة التالية** و**الصفحة الأولى** للصفوف؛ تاريخ مش سبت يترفض بـ **أسبوع الجدول لازم يبدأ السبت.** (`SCHEDULE_WEEK_INVALID`، 400).
3. دوس خلية السبت للموظف، والزر اسمه المتاح بيبدأ بـ **تعديل اليوم** ومعاه اسم الموظف وتاريخ اليوم ←
   **تعديل جدول الموظف**. دوس **إضافة وردية**، واضبط **البداية** = `09:00` و**النهاية** = `13:00` ←
   **حفظ الجدول**. الحوار يقفل والخلية تعرض الوقتين؛ رسالة النجاح المترجمة هي **تم حفظ الجدول.** لكنها مش معروضة حاليًا في الشبكة.
   افتح الخلية تاني وتأكد إن القيم محفوظة.
4. أضف وردية تانية `14:00`–`18:00` واحفظ؛ الاتنين يظهروا في نفس اليوم. **إضافة وردية** يتقفل بعد الاتنين.
   جرّب تعديل التانية لـ `12:00`–`15:00` ← **ورديات الموظف متداخلة.** (`SCHEDULE_SHIFT_OVERLAP`، 409)، والحفظ القديم يفضل.
   بداية التانية عند نهاية الأولى بالظبط مسموحة؛ الفترات مش شاملة نهايتها. حد الوردتين بيتفحص كمان عبر الفروع.
5. على يوم مستقبلي فاضي جرّب `22:00`–`06:00` ← الحفظ مسموح، والوردية تتبع يوم البداية.
   التلميح **النهاية عند البداية أو قبلها تعني اليوم التالي. الحد الأقصى ١٦ ساعة.**
   وردية الجمعة اللي بتنتهي السبت تفضل محسوبة الجمعة. جرّب `09:00`–`02:00` (17 ساعة)، أو وقت بداية ونهاية متساويين
   (24 ساعة) ← **الحد ورديتان في اليوم ومدة كل وردية لا تزيد عن ١٦ ساعة.** (`SCHEDULE_SHIFT_INVALID`، 400).
6. افتح يوم سابق مؤهل وغيّر وقت وردية، وسيب **السبب** فاضي ← **حفظ الجدول** ما يحفظش؛ يظهر
   **السبب مطلوب لتعديل يوم سابق.** وحقل السبب مطلوب. اكتب سبب تجربة ← الحفظ مسموح.
   حذف وردية قديمة بـ **حذف الوردية** يحتاج سبب كمان. من الـ API، التغيير السابق من غير سبب يرجع
   **سبب التعديل مطلوب لتغيير يوم سابق.** (`SCHEDULE_PAST_REASON_REQUIRED`، 400). اليوم بيتحسب بتوقيت الفرع؛ اليوم الحالي والمستقبل بيتدققوا كمان.
7. للموظف المرتبط بجزء من الأسبوع، جرّب يوم قبل بداية ارتباطه أو في تاريخ نهايته ←
   **الموظف غير مؤهل للعمل في الفرع في أحد أيام الجدول.** (`SCHEDULE_EMPLOYEE_INELIGIBLE`، 400).
   البداية شاملة والنهاية غير شاملة. نفس الرفض ليوم قبل التعيين أو بعد نهاية العقد؛ يوم نهاية العقد نفسه مسموح لو الارتباط صالح.
   موظف غير مؤهل طول الأسبوع، حتى لجدول فاضي، يترد بنفس 404 **المسار غير موجود** (`NOT_FOUND`).
8. للموظف المرتبط بفرعين في نفس اليوم، احفظ `09:00`–`13:00` في الأول. اختار التاني وجرّب `12:00`–`15:00` ←
   **ورديات الموظف متداخلة.** (`SCHEDULE_SHIFT_OVERLAP`، 409). المقارنة بالوقت الفعلي حتى لو مناطق الفروع مختلفة،
   وبتشمل حدود الأسابيع: الجمعة بالليل ما تتداخلش مع السبت التالي. الرفض ما يكشفش تفاصيل ورديات الفرع التاني.
9. افتح محرر نفس الموظف ونفس الأسبوع في تابين قبل أي حفظ، وسيب الحوارين مفتوحين. احفظ تغييرًا في الأول،
   وبعدين تغييرًا مختلفًا في التاني من غير إعادة فتح ← **الجدول أو القالب اتغير؛ حمّل النسخة الجديدة قبل الحفظ.**
   (`SCHEDULE_REVISION_CONFLICT`، 409). حتى تغيير يوم مختلف في نفس الأسبوع يتعارض. دوس **إغلاق** ثم زر
   **إعادة تحميل الموظف** فوق الشبكة، وافتح اليوم وراجع القيم قبل المحاولة من جديد؛ التعديل الأول يفضل محفوظ.
10. اقفل الحوار بـ **إغلاق** من غير حفظ ← مفيش تغيير. كل حفظ مقبول بيتدقق بالفاعل وقبل/بعد والسبب لو موجود؛
    فشل التدقيق يرجّع المعاملة كلها. تغيير ارتباط الموظف ما يعيدش كتابة الجداول القديمة؛ أي كتابة جديدة تتحقق من التواريخ.
    الجداول هنا إعدادات، مش تسجيل حضور أو تغيير شيفت حضور مفتوح.
11. خطوة للـ agent من الـ API بس: ابعت `POST /v1/businesses/{businessId}/shift-templates` بالجسم في القسم الأخير،
    واسم تجربة ونمط يوم `0` (السبت) `09:00`–`13:00` ← 201؛ احتفظ بـ `id` كـ `<TEMPLATE_ID>`.
    الاسم الإنجليزي مطلوب والعربي اختياري. مفيش زر إنشاء/تطبيق قالب في الشاشة الحالية.
12. ابعت `POST /v1/businesses/{businessId}/shift-templates/{templateId}/apply` بفرع وموظف مؤهل وأسبوع سبت فاضي،
    و`replace: false` ← 200 وفيه `schedules`. افتح الأسبوع في الشبكة وتأكد إن النسخة محفوظة.
    التطبيق بيعمل نسخ مستقلة؛ تعديل القالب بعد كده ما يغيّرش النسخ القديمة.
13. كرر التطبيق على نفس الأهداف بـ `replace: false` ← **توجد جداول لبعض الموظفين والأسابيع المختارة.**
    (`SCHEDULE_APPLY_CONFLICT`، 409)، حتى لو الجدول الموجود فاضي. جرّب `replace: true` من غير سبب ←
    **سبب الاستبدال مطلوب لاستبدال الجداول الحالية.** (`SCHEDULE_REPLACE_REASON_REQUIRED`، 400).
    اعمل استبدال صريح بسبب تجربة ← النسخ تتحدث ويتدقق كل استبدال. الحد 12 أسبوع سبت مختلف و20 نسخة موظف × أسبوع في الطلب؛
    `2 × 10` مسموح، `2 × 11` مرفوض بـ **اختر بحد أقصى 20 نسخة موظف وأسبوع في كل تطبيق.**
    (`SCHEDULE_APPLY_BATCH_TOO_LARGE`، 422). أكتر من 12 أسبوع يترفض في التحقق من الجسم (400). أي تعارض أو عدم أهلية يرفض التطبيق كله.

**ممنوع يحصل:**
- أسبوع يبدأ غير السبت أو يعتمد على توقيت المتصفح؛ وردية ليلية تتنسب ليوم النهاية أو تعدّي 16 ساعة.
- أكتر من ورديتين في اليوم أو تداخل، بما فيه فرع تاني أو أسبوع مجاور؛ تغيير ماضي من غير سبب.
- وردية خارج ارتباط الفرع أو قبل التعيين أو بعد نهاية العقد؛ تاب قديم يمسح أحدث تعديل.
- تطبيق قالب جزئي، أو استبدال ضمني من غير سبب، أو تخطي 12 أسبوع/20 نسخة؛ تغيير قالب يعدّل النسخ القديمة.
- وصف حوارات القوالب أو آثار الحضور كأنها موجودة هنا؛ رفض يغيّر الجدول أو التدقيق أو يكشف بيانات خارج النطاق.

## English

1. Select the branch and open `/schedules` → **Weekly schedules**, with
   "Saturday to Friday in the selected branch timezone." Without a branch: "Choose a branch to view schedules."
   Check the displayed timezone; weeks start Saturday in branch time, independent of the browser's timezone.
2. Choose a suitable future Saturday in **Week starts (Saturday)**. Columns are **Employee**, **Saturday**, **Sunday**,
   **Monday**, **Tuesday**, **Wednesday**, **Thursday** and **Friday**, with their dates. Empty cells show **No shifts**;
   an empty grid shows "No employees attached during this week." Use **Next page** and **First page** for rows.
   A non-Saturday date is refused with "The schedule week must start on Saturday." (`SCHEDULE_WEEK_INVALID`, 400).
3. Click the employee's Saturday cell; its accessible button name begins **Edit day**, followed by employee name and date →
   **Edit employee schedule**. **Add shift**, set **Start** = `09:00` and **End** = `13:00` → **Save schedule**.
   The dialog closes and the cell shows both times. The catalog's success text is "Schedule saved."; the current grid does not render it.
   Reopen the cell to verify saved values.
4. Add a second shift `14:00`–`18:00` and save; both appear on the day. **Add shift** is disabled after two.
   Change the second to `12:00`–`15:00` → "The employee has overlapping shifts." (`SCHEDULE_SHIFT_OVERLAP`, 409);
   saved data remains. A second shift starting exactly when the first ends is allowed; intervals exclude their end.
   The two-shift limit is also checked across branches.
5. On an empty future day, save `22:00`–`06:00`; the overnight shift belongs to its start day. The hint reads
   "End at or before start means the next day. Maximum 16 hours." Friday overnight ending Saturday remains Friday's shift.
   Try `09:00`–`02:00` (17 hours), or equal start/end (24 hours) →
   "Use up to two shifts per day, each at most 16 hours." (`SCHEDULE_SHIFT_INVALID`, 400).
6. Open an eligible past day, change a shift and leave **Reason** blank → **Save schedule** cannot save;
   "A reason is required for a past day." is shown and the reason field is required. Enter a synthetic reason to save.
   **Remove shift** on a past day also needs a reason. API past changes without a reason return
   "A reason is required to edit a past day." (`SCHEDULE_PAST_REASON_REQUIRED`, 400).
   Past is determined in branch time; today/future saves are audited too.
7. For the part-week attachment, try a day before its start or on its end date →
   "The employee is not eligible at this branch on a scheduled day." (`SCHEDULE_EMPLOYEE_INELIGIBLE`, 400).
   Attachment start is inclusive and end exclusive. The same refusal covers before hire or after contract end;
   the contract end day itself is allowed with a valid attachment. An entirely ineligible employee-week, even empty,
   gets the identical 404 "Not found" (`NOT_FOUND`).
8. For an employee attached to two branches that day, save `09:00`–`13:00` in the first, then try `12:00`–`15:00`
   in the second → "The employee has overlapping shifts." (`SCHEDULE_SHIFT_OVERLAP`, 409).
   Comparison uses actual instants even across different branch timezones and adjacent weeks: Friday overnight cannot overlap
   the next Saturday. The refusal reveals no details of the other branch's shifts.
9. Open the same employee/week editor in two tabs before saving either, keeping both dialogs open. Save a change in the first,
   then a different change in the second without reopening → "The schedule or template changed. Reload before saving."
   (`SCHEDULE_REVISION_CONFLICT`, 409). Even different days in that week conflict. **Close**, then use **Reload employee**
   above the grid, reopen the day and review fresh values before retrying; the first change remains saved.
10. **Close** without saving leaves data unchanged. Each accepted save audits actor, before/after and reason when supplied;
    audit failure rolls back the whole transaction. Changing employee attachments preserves old schedules; new writes check dated eligibility.
    These schedules are configuration, not clock-in records or changes to an open attendance shift.
11. Agent API-only step: `POST /v1/businesses/{businessId}/shift-templates` with the body below, a synthetic name and
    day `0` (Saturday) pattern `09:00`–`13:00` → 201; retain `id` as `<TEMPLATE_ID>`.
    English name is required, Arabic optional. The current screen has no template create/apply controls.
12. `POST /v1/businesses/{businessId}/shift-templates/{templateId}/apply` with a branch, eligible employee and empty
    Saturday week, using `replace: false` → 200 with `schedules`. Open the grid week to verify the saved copy.
    Copies are independent; later template edits do not update existing schedules.
13. Repeat on the same targets with `replace: false` → "Schedules already exist for some selected employees and weeks."
    (`SCHEDULE_APPLY_CONFLICT`, 409), including existing empty weeks. Try `replace: true` without a reason →
    "A reason is required to replace existing schedules." (`SCHEDULE_REPLACE_REASON_REQUIRED`, 400).
    Explicit replace with a synthetic reason updates copies and audits each replacement. Maximum: 12 distinct Saturday weeks and
    20 employee-week copies per request; `2 × 10` is allowed, `2 × 11` returns
    "Select at most 20 employee-week copies per application." (`SCHEDULE_APPLY_BATCH_TOO_LARGE`, 422).
    More than 12 weeks fails body validation (400). Any conflict or ineligible target refuses the entire application.

**Must NOT happen:**
- Non-Saturday/browser-time weeks, overnight shifts assigned to their end day, or shifts longer than 16 hours.
- More than two shifts per day, overlaps across branches/weeks, or past changes without a reason.
- Shifts outside branch attachment/employment dates, or stale edits overwriting newer data.
- Partial template application, implicit replacement without reason, exceeding 12 weeks/20 copies, or template edits changing old copies.
- Claiming template dialogs or attendance effects shipped here; refusals changing schedules/audit or revealing out-of-scope data.

## For an agent

- Admin: `http://localhost:3001/schedules`. `#schedule-week`, dialog accessible name **Edit employee schedule** /
  **تعديل جدول الموظف**, time fields `start-{index}` / `end-{index}`, `#schedule-reason`.
  Use the cell button's accessible name prefix plus synthetic employee name and date. The reload control currently reuses
  **Reload employee** / **إعادة تحميل الموظف**; do not invent a schedule-specific label.
- The grid polls every 30 seconds. For the stale-edit test open both dialogs before saving; their form revisions remain the
  originals even if the grid refetches. No automatic write retry. Assert times/revision after save; the translated success
  message exists in the catalog but is not rendered by this page.
- API: session cookie + `x-company-id`. `GET /v1/businesses/{businessId}/branches/{branchId}/schedules?week_start={saturday}&limit=20`
  returns `{ week_start, days, timezone, items, next_cursor }`; optional cursor is an employee UUID.
  `GET` the same schedules path plus `/{employeeId}?week_start={saturday}` returns `{ schedule }`, possibly `null`.
  `PUT` that employee path with `{ week_start, expected_revision, shifts, reason? }` returns the saved week.
  Send the complete weekly pattern, preserving other days; it replaces the week, not just the edited day. Revision `0` creates;
  otherwise use the read revision. Pattern entries are `{ day: 0..6, start: "HH:mm", end: "HH:mm" }`.
- API-only template create/apply replay (curl-like; replace all placeholders). Examples use shell-style line continuations;
  in PowerShell, run each request on one line using `curl.exe`:

  ```sh
  curl -X POST '<API_ORIGIN>/v1/businesses/<BUSINESS_ID>/shift-templates' \
    -b '<SESSION_COOKIE>' -H 'x-company-id: <COMPANY_ID>' -H 'Content-Type: application/json' \
    --data '{"name_en":"SYNTHETIC TEMPLATE","name_ar":null,"shifts":[{"day":0,"start":"09:00","end":"13:00"}]}'

  curl -X POST '<API_ORIGIN>/v1/businesses/<BUSINESS_ID>/shift-templates/<TEMPLATE_ID>/apply' \
    -b '<SESSION_COOKIE>' -H 'x-company-id: <COMPANY_ID>' -H 'Content-Type: application/json' \
    --data '{"branch_id":"<BRANCH_ID>","employee_ids":["<EMPLOYEE_ID>"],"weeks":["<FUTURE_SATURDAY_YYYY-MM-DD>"],"replace":false}'
  ```

  Create returns 201 template; apply returns 200 `{ schedules }`. For the explicit replacement test change `replace` to `true`
  and add `"reason":"<SYNTHETIC_REASON>"`; omit reason to assert the named 400 refusal. No `Idempotency-Key` on schedule/template commands.
- For limits, use distinct eligible employee IDs and Saturday dates: 2 employees × 10 weeks = 20; × 11 = 22, refused before writes.
  Also test 21 employees × 1 week → the same named 422, and 13 weeks → validation 400. Inspect each accepted copy and audit;
  a failing target leaves all selected schedules/revisions/audits unchanged. No automatic batch splitting.
- Templates: `GET /v1/businesses/{businessId}/shift-templates?limit=20`; `PATCH /.../shift-templates/{templateId}`
  with names, pattern and `expected_revision` edits; `POST /.../{templateId}/archive` with `{ expected_revision }` archives.
  Edits/archives are revision-protected; archive prevents further edit/apply but keeps existing copies. Compare copies before/after an edit.
- API checks: three shifts starting the same day → `SCHEDULE_SHIFT_INVALID` (400); past changes/removals without reason →
  `SCHEDULE_PAST_REASON_REQUIRED` (400). Use fresh revisions so stale-copy refusal does not mask these checks.
  Unknown/other-company/inaccessible branch or employee-week returns identical `NOT_FOUND` 404 envelopes; no foreign names/shifts.
  An employee eligible on another day in the week but ineligible on the requested shift day gets `SCHEDULE_EMPLOYEE_INELIGIBLE` (400).
  A branch-local time without a unique timezone occurrence is refused with `SCHEDULE_LOCAL_TIME_INVALID` (400), never silently moved.
- Sources: `docs/specs/020-staff-schedules/spec.md`, `apps/admin/src/staff/pages/schedules-page.tsx`,
  its grid/day dialog/forms/API hook, `apps/api/src/modules/staff/http/{schedules,shift-templates}.controller.ts`,
  schedule/template domain and use cases, `packages/contracts/src/staff/schedules.ts`,
  `packages/i18n/src/{ar,en}.ts` and `apps/api/src/shared/errors.ts`.
