# 16 · Update employee — تعديل الموظف

**Status / الحالة:** shipped in #83 (PR 9, merged). Local only (admin not deployed, issue #54). Your decisions of
2026-10-03 apply: manager-entered branch dates, start-inclusive/end-exclusive intervals and future moves; audited changes
preserve history and open shifts; stale revisions are refused; unknown and other-business/company branches share one response.
The next-clock-in behavior belongs to attendance PR 22, not this editing slice.

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md), then `pnpm db:migrate` for the revision/history migrations and `pnpm db:seed`
  for the permission catalog. The PostgreSQL environment needs `btree_gist` as specified in ADR-0021.
- Signed in with a company and business selected ([01](01-admin-sign-in-and-totp.md), [02](02-admin-workspace-selector.md));
  `staff` is enabled. The editor needs effective `manage:employees:business` access over the employee's persisted scope
  and every current/requested branch. Default bundles remain PR 7a's responsibility.
- Prepare a synthetic employee ([13](13-create-employee.md)) attached to one branch, a second branch in the same business,
  and two tabs of the admin for the revision test. Use an attachment start earlier than the test move date.
- Prepare unknown and other-business/company branch UUIDs for API checks. Dates below are examples; choose dates after
  the fixture's existing attachment start and use a future date for the future-move check.

## العربي

1. من القائمة الجانبية دوس **الموظفون** ← `/staff`. الجدول فيه **الاسم** و**الدور** و**الفرع الأساسي** و**تعديل**.
   لو الصفحة فاضية: **لا يوجد موظفون في هذه الصفحة.**؛ لو محتاج موظف للتجربة دوس **إضافة موظف**.
   للقوائم الطويلة استخدم **الصفحة التالية** و**الصفحة الأولى**؛ اللي يظهر لازم يكون داخل صلاحياتك بس.
2. دوس **تعديل** على الموظف ← لوحة **تعديل الموظف**. راجع **الاسم بالإنجليزية**، **الاسم بالعربية (اختياري)**،
   **الدور**، **الفرع الأساسي**، **تاريخ التعيين**، **نهاية العقد (اختياري)** و**معرف مستخدم موجود (اختياري)**.
   تحتهم **فروع العمل** بخانات اختيار الفروع و**تاريخ تغيير الفروع (ميلادي)**.
3. غيّر الاسم، واكتب تاريخ ميلادي صالح في **تاريخ تغيير الفروع (ميلادي)** حتى لو الفروع نفسها مش هتتغير ←
   **حفظ التعديلات** ← **تم تعديل الموظف.** افتح الموظف تاني وتأكد من البيانات؛ النسخة تزيد مع التغيير الفعلي.
   التاريخ ده بيتطبق على الارتباطات اللي اتغيرت بس؛ تغيير الاسم أو تاريخ التعيين ما بيغيّرش بداية ارتباط قديم.
4. لنقل الموظف، اختار الفرع التاني في **فروع العمل**، وشيل الأول، وخلّي **الفرع الأساسي** هو الفرع التاني.
   اكتب تاريخ النقل، مثلًا `2026-10-15` لو مناسب لبيانات التجربة ← **حفظ التعديلات** ← **تم تعديل الموظف.**
   التاريخ المستقبلي مسموح: الارتباط القديم ينتهي يوم 15 والجديد يبدأ يوم 15؛ القديم يغطي لحد يوم 14 والجديد من يوم 15.
   ما تطرحش يوم من تاريخ النهاية. تحت الحقل هتلاقي **يبدأ هذا التاريخ الارتباطات الجديدة وينهي الارتباطات المستبعدة مع الاحتفاظ بالتاريخ السابق.**
5. لو عايز تضيف فرع من غير ما تشيل الحالي، علّم على الاتنين وسيب الفرع الأساسي ضمن **فروع العمل**.
   رجوع الموظف لفرع قديم بيعمل ارتباط جديد، مش بيفتح الصف المقفول. تاريخ الرجوع ما ينفعش يتداخل مع فترة محفوظة لنفس
   الفرع: مثلًا فترة انتهت يوم 15 والرجوع يوم 10 ← **يتداخل ارتباط الفرع مع فترة مسجلة سابقاً.**
   (`EMPLOYEE_BRANCH_HISTORY_OVERLAP`، 409). الرجوع يوم 15 مسموح لو باقي البيانات سليمة.
6. شيل الفرع الأساسي من **فروع العمل** مع إبقاء فرع تاني ← **أدرج الفرع الرئيسي ضمن فروع العمل.**
   (`EMPLOYEE_PRIMARY_BRANCH_REQUIRED`، 400). إنهاء ارتباط في يوم بدايته أو قبله ←
   **يجب أن ينتهي ارتباط الفرع بعد تاريخ بدايته.** (`EMPLOYEE_BRANCH_DATE_BEFORE_START`، 400).
   بيانات ناقصة أو تاريخ غير صالح على النموذج ← **راجع بيانات الموظف والتواريخ ومعرف المستخدم.**؛ مفيش حفظ جزئي.
7. افتح نفس الموظف في لوحة التعديل في تابين قبل أي حفظ. غيّر الاسم واملأ تاريخ تغيير الفروع واحفظ في التاب الأول؛ في التاب التاني غيّر الاسم
   لقيمة مختلفة، واملأ تاريخ تغيير الفروع، واحفظ من غير إعادة تحميل ←
   **عدّل مدير آخر هذا الموظف. أعد تحميل أحدث سجل قبل الحفظ.** (`EMPLOYEE_REVISION_CONFLICT`، 409).
   تعديل التاب الأول يفضل محفوظ. دوس **إعادة تحميل الموظف** في التاب التاني، راجع أحدث بيانات، واكتب التعديل والتاريخ من جديد
   ← **حفظ التعديلات**. **العودة إلى الموظفين** بتقفل لوحة التعديل.
8. **فحوصات من الـ API بس:** ابعت فرع مجهول أو فرع من نشاط تاني أو شركة تانية في الفرع الأساسي أو مجموعة الفروع ←
   نفس 404 **لم يتم العثور على الفرع الرئيسي.** (`EMPLOYEE_BRANCH_NOT_FOUND`)، بنفس الـ envelope ومن غير تفاصيل تكشف الفرع.
   موظف مجهول أو خارج نطاق قراءة المصدر ← **المسار غير موجود** (`NOT_FOUND`، 404).
   فرع صحيح في نفس النشاط لكن ممنوع عليك كهدف يترفض؛ وجوده في النشاط مش إذن للتعديل.
9. كل تغيير فعلي مقبول بيتسجل بمين عدّله وقبل/بعد، ومع النقل تاريخ التغيير والارتباطات المضافة والمقفولة.
   راجع إن التاريخ السابق والحضور وأي شيفت أو جلسة مفتوحة ما اتكتبوش من جديد. قرار المالك: القواعد الجديدة من الدخول
   التالي مع احترام تواريخ الفروع؛ PR 22 هو اللي هيطبق تفاصيل الحضور، مش الشاشة دي. الفروع المعروضة هنا إعدادات
   الارتباطات المفتوحة النهاية، مش إثبات إن النقل المستقبلي بدأ النهارده. حفظ من غير أي تغيير ما بيضيفش تدقيق ولا يزوّد النسخة.
10. قواعد الإنشاء مستمرة: الاسم المكرر والتعيين المستقبلي مسموحين؛ نهاية العقد قبل التعيين مرفوضة.
    ربط أو فك ربط مستخدم، أو تغيير **الدور**، ما بيدّيش وصول ولا يغيّر عضوية أو بيانات دخول. كل رفض يسيب البيانات
    والنسخة وتاريخ الفروع والتدقيق زي ما كانوا.

**ممنوع يحصل:**
- تاب قديم يستبدل تعديل أحدث من غير خطأ تعارض؛ رفض يسيب حفظ جزئي أو يزوّد النسخة.
- تاريخ نهاية الفرع يتحسب شاملًا، أو تاريخ مستقبلي يترفض لمجرد إنه مستقبلي، أو الفرع الأساسي يخرج من فروع العمل.
- فترة قديمة تتمسح أو تتفتح من جديد؛ فترتين لنفس الموظف والفرع يتداخلوا؛ تعديل موظف يعيد كتابة الحضور أو شيفت مفتوح.
- رد فرع من نشاط/شركة تانية يختلف عن المجهول؛ تعديل الموظف يغيّر الشركة/النشاط أو يمنح صلاحيات دخول.

## English

1. Sidebar **Employees** → `/staff`. The table has **Name**, **Role**, **Primary branch** and **Edit**.
   Empty page: "No employees on this page."; use **Create employee** if a fixture is needed.
   For longer lists, use **Next page** and **First page**; only employees within your access may appear.
2. Press **Edit** → the **Edit employee** panel. Review **English name**, **Arabic name (optional)**, **Role**,
   **Primary branch**, **Hire date**, **Contract end (optional)** and **Existing user ID (optional)**.
   Below them are **Working branches** checkboxes and **Branch change date (Gregorian)**.
3. Change the name and enter a valid Gregorian **Branch change date (Gregorian)** even when leaving branches unchanged
   → **Save changes** → "Employee updated." Reopen to verify the data; an actual change increments the revision.
   The date applies only to changed attachments; changing a name or hire date never rewrites an old attachment's start.
4. To move the employee, check the second **Working branches** option, uncheck the first and set **Primary branch** to
   the second. Enter the move date, for example `2026-10-15` if suitable for the fixture → **Save changes** → "Employee updated."
   Future moves are allowed. The old attachment ends on the 15th and the new one starts on the 15th: old through the 14th,
   new from the 15th. Do not subtract a day from the end date. The hint reads
   "This date starts new attachments and ends removed attachments. Existing history is kept."
5. To attach another branch without removing the current one, check both and keep the primary in **Working branches**.
   Reattaching an old branch creates a new row; it does not reopen a closed one. Reattachment must not overlap that
   branch's saved history: an interval ending on the 15th and reattachment on the 10th →
   "This branch attachment overlaps existing history." (`EMPLOYEE_BRANCH_HISTORY_OVERLAP`, 409).
   Reattachment on the 15th is allowed if the remaining input is valid.
6. Exclude the primary from **Working branches** while retaining another branch →
   "Include the primary branch in the working branches." (`EMPLOYEE_PRIMARY_BRANCH_REQUIRED`, 400).
   Ending an attachment on/before its start → "A branch attachment must end after it starts."
   (`EMPLOYEE_BRANCH_DATE_BEFORE_START`, 400). Missing input or an invalid date shows
   "Check the employee details, dates and user ID." on the form; there is no partial save.
7. Open the same employee's edit panel in two tabs before saving either. Change the name, enter the branch change date and save in the first.
   In the second, enter a different name and the branch change date, then save without reloading →
   "Another manager changed this employee. Reload the latest record before saving." (`EMPLOYEE_REVISION_CONFLICT`, 409).
   The first tab's change remains saved. Press **Reload employee** in the second, review the latest record, enter the
   intended edit/date again → **Save changes**. **Back to employees** closes the panel.
8. **API-only checks:** an unknown, other-business or other-company primary/additional branch → exactly the same
   404 "The primary branch was not found." (`EMPLOYEE_BRANCH_NOT_FOUND`), with an identical envelope and no revealing details.
   An unknown employee or one outside readable source scope → "Not found" (`NOT_FOUND`, 404).
   A valid same-business branch denied as a target is refused; belonging to the business does not authorize the change.
9. Every accepted actual change audits actor and before/after, with effective date and added/closed attachments for moves.
   Check that existing history, attendance and any open shift/session remain untouched. Owner decision: new rules apply
   from the next clock-in, respecting branch effective dates; PR 22 implements attendance details, not this screen.
   The displayed branches are the configured open-ended attachments, not evidence that a future move is effective today.
   An unchanged save adds no audit and does not increment revision.
10. Creation rules still apply: duplicate names/future hire dates are allowed; contract end before hire is refused.
    Linking/unlinking a user or changing **Role** grants no access and changes no membership or credentials.
    Every refusal preserves data, revision, branch history and audit.

**Must NOT happen:**
- A stale tab silently overwriting a newer edit; refusals partially saving or incrementing revision.
- Inclusive branch end dates, refusal solely for a future date, or omission of the primary from working branches.
- Deleting/reopening old history, overlapping intervals for the same employee/branch, or rewriting attendance/open shifts.
- Other-business/company branch responses differing from unknown ones; re-homing an employee or granting login access.

## For an agent

- Admin at `http://localhost:3001/staff`; use visible labels above. `#employee-branch-date` is required by the form for
  every save; branch checkbox IDs are `employee-work-{branchId}`. The two-tab test must load both detail revisions before
  either save; detail does not refetch on window focus. Reload deliberately discards the old form in favor of the latest record.
- API (session cookie + `x-company-id`): `GET /v1/businesses/{businessId}/employees?limit=20&cursor={cursor}` →
  `{ items, next_cursor }`; omit cursor for the first page. `GET /v1/businesses/{businessId}/employees/{employeeId}` →
  detail including `revision` and sorted `branch_ids`.
  `PATCH` to the same detail URL requires the full editable body
  `{ primary_branch_id, name_en, name_ar: null|string, role_code, hire_date, contract_end: null|string,
  user_id: null|UUID, expected_revision, branch_ids, branch_effective_date }` → 200 with updated detail.
  Use the read revision, unique nonempty branch IDs and Gregorian `YYYY-MM-DD` dates. No `Idempotency-Key` or automatic retry.
- API-only casing check: uppercase/lowercase UUID letters in `primary_branch_id` and `branch_ids` behave identically;
  response IDs are normalized to lowercase. Compare equivalent fixtures/fresh revisions, not a second stale PATCH.
  This is not a browser input scenario. Branch privacy applies to create as well as update after #83.
- Inspect synthetic attachment/audit fixtures: a move closes only an open interval and appends another;
  closed rows/old starts remain intact. Direct attempts to change closed history map to 409
  `EMPLOYEE_BRANCH_HISTORY_IMMUTABLE`: "Closed branch attachment history cannot be changed." /
  **لا يمكن تعديل تاريخ ارتباط الفرع بعد إغلاقه.** No history/attendance editing UI exists here.
- Compare full privacy envelopes with the same session and selected company. Standard errors include 400 invalid input,
  401 no session, 403 target permission/disabled staff, 404 missing/inaccessible employee or invalid branch,
  and the named revision/history 409s above. Sources: `docs/specs/017-staff-update-employee/spec.md`,
  `apps/admin/src/staff`, `apps/api/src/modules/staff/http/employees.controller.ts`,
  `packages/contracts/src/staff/update-employee.ts`, `packages/i18n/src/{ar,en}.ts` and the API error catalog.
