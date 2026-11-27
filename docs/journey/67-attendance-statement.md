# 67 · Official attendance statement (PDF) — كشف الحضور الرسمي (PDF)

**Status / الحالة:** shipped in #589 (27g-1: the shared statement reads and the logo reader), #608 (27g-2: the
request table, contracts and domain), #684 (27g-3: the statement built in the worker with its PDF template), #697
(27g-4: the API) and #705 (27g-5: the admin screen on `/staff/attendance-statement`), all merged (row 27g, spec 061,
ADR-0056). It is the first document kind on the PDF renderer of [56](56-pdf-renderer.md). **On staging:** the screen
and the routes are there; the PDF itself is produced by the worker's renderer, and when the renderer is not available
the request answers **تجهيز المستندات مش متاح دلوقتي، جرّبي بعد شوية.** / **Document rendering is temporarily
unavailable. Try again later.** The business logo in the header needs object storage; with no logo the statement is
still issued (spec 061 BR-01).

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md) with API, worker, Redis and admin, then `pnpm db:migrate` and `pnpm db:seed`; or
  the staging admin with the demo company «صالون الأميرة (تجريبي)».
- The `staff` feature on, and a user with **عرض الحضور** / **View attendance** on the branch (`read:attendance:branch`), the same
  permission as the monthly report.
- At least one employee with attendance sessions in the chosen month (card clock, [30](30-employee-cards-and-clock-by-card.md)).

## العربي

1. **افتح الشاشة:** من قائمة الموظفين دوس **بيان الحضور** ← شاشة **بيان الحضور**.
2. **الاختيارات:** **الفرع**، و**نوع الكشف** (**كشف الفرع** أو **كشف موظفة**)، و**الفترة** (**شهر كامل** أو **فترة
   مخصصة** بـ **من** و**إلى**)، و**لغة الكشف** (**عربي** أو **إنجليزي**).
3. **كشف الفرع:** اختار **كشف الفرع** وشهر كامل ← خانة **موظفة (اختياري)** وخانة **الشيفت** (الافتراضي **كل
   الشيفتات**).
4. **كشف موظفة:** اختار **كشف موظفة** ← خانة **الموظفة** إجبارية (**اختر موظفة**)، ومفيش فلتر شيفت.
5. **اطلب:** دوس **اطلبي الكشف** ← **جاري طلب الكشف…** وبعدها **جاري تجهيز الكشف…** وبعدها **الكشف جاهز.** وزرار
   **تنزيل الكشف**.
6. **نزّل:** دوس **تنزيل الكشف** ← **جاري تنزيل الكشف…** وبعدها **تم تنزيل الكشف.** وملف PDF فيه لوجو واسم النشاط
   فوق، وأماكن التوقيع، وتحت «صادر من نظام PosPay للحضور والانصراف».
7. **مرة واحدة:** نفس الكشف يتنزّل تاني ← **الكشف اتحمّل خلاص. اطلبي واحد جديد.** وزرار **طلب كشف جديد**.
8. **اتأخر:** لو التجهيز طوّل ← **الكشف لسه بيتجهز** وزرار **تحقق تاني**.
9. **انتهى:** كشف جاهز واتساب لحد ما انتهى ← **الكشف انتهى، اطلبي واحد جديد.**
10. **فترة غلط:** فترة أطول من 366 يوم، أو بتخلص بعد الشهر الحالي ← **اختاري فترة صحيحة لحد 366 يوم وتنتهي جوّه
    الشهر الحالي.**
11. **مفيش بيانات:** فترة مفيهاش حضور ← **مفيش موظفات ليها بيانات حضور في الفترة دي.** في قائمة الموظفات.
12. **من غير صلاحية:** فرع ملكش عليه قراءة الحضور ← **مالكش صلاحية تشوف حضور الفرع ده.**
13. **طلبات كتير:** ← **طلبات كشوف كتير، جرّبي بعد شوية.**

**ممنوع يحصل:**
- كشف فرع يتنزّل لمستخدم ملوش قراءة حضور الفرع ده.
- نفس الكشف يتنزّل مرتين.
- يوم فيه بصمة انصراف ناقصة يتحسبله ساعات شغل (spec 061 BR-05).
- تنزيل من غير سطر في سجل التدقيق (مين، إمتى، أنهي نوع، الفرع، الموظفة).
- فلتر شيفت يتقبل مع كشف موظفة.

## English

1. **Open the screen:** in the staff menu click **Attendance statement** → the **Attendance statement** screen.
2. **Choices:** **Branch**, **Statement type** (**Branch statement** or **Employee statement**), **Period** (**Whole
   month**, or **Custom period** with **From** and **To**) and **Statement language** (**Arabic** or **English**).
3. **Branch statement:** choose **Branch statement** and a whole month → an **Employee (optional)** field and a
   **Shift** field (default **All shifts**).
4. **Employee statement:** choose **Employee statement** → the **Employee** field is required (**Choose an
   employee**), and there is no shift filter.
5. **Request:** click **Request statement** → **Requesting the statement…**, then **Preparing the statement…**, then
   **The statement is ready.** with a **Download statement** button.
6. **Download:** click **Download statement** → **Downloading the statement…** then **The statement was downloaded.**
   The PDF has the business logo and name at the top, signature places, and the footer "Issued by the PosPay
   attendance system".
7. **Once only:** downloading the same statement again → **This statement was already downloaded. Request a new
   one.** with a **Request a new statement** button.
8. **Slow:** if preparing takes long → **The statement is still being prepared.** with **Check again**.
9. **Expired:** a ready statement left until it expired → **The statement expired. Request a new one.**
10. **A bad period:** longer than 366 days, or ending after the current month → **Choose a valid period of up to 366
    days, ending within the current month.**
11. **No data:** a period with no attendance → **No employees have attendance data in this period.** in the employee
    list.
12. **No permission:** a branch you cannot read attendance for → **You can't view attendance for this branch.**
13. **Too many requests:** → **Too many statement requests. Try again later.**

**Must NOT happen:**
- A branch statement downloaded by a user without read-attendance on that branch.
- The same statement downloaded twice.
- A day with a missing clock-out counted as worked hours (spec 061 BR-05).
- A download with no audit row (who, when, which form, the branch, the employee).
- A shift filter accepted with an employee statement.

## For an agent

- **Screen:** `/staff/attendance-statement` (local `http://localhost:3001`, staging
  `https://app.staging.pospay.systems`); page `apps/admin/src/staff/pages/attendance-statement-page.tsx`; sidebar link
  **بيان الحضور** / **Attendance statement**. Text in `packages/i18n/src/attendance-statement-screen-catalog.ts`.
- **API** (`apps/api/src/modules/staff/http/`, prefix `/v1/businesses/<BUSINESS_ID>/branches/<BRANCH_ID>`, all
  `read:attendance:branch` + the `staff` feature):
  `POST /attendance-statements` · `GET /attendance-statements/<RENDER_ID>` ·
  `POST /attendance-statements/<RENDER_ID>/download` · `GET /attendance-statement-shifts` · `GET /attendance-statement-employees?from&to`.
- **Errors** (`packages/i18n/src/attendance-statement-errors.ts`): `ATTENDANCE_STATEMENT_PERIOD_INVALID` ·
  `ATTENDANCE_STATEMENT_EMPLOYEE_NOT_FOUND` · `ATTENDANCE_STATEMENT_BRANCH_NOT_FOUND` ·
  `ATTENDANCE_STATEMENT_RATE_LIMITED` · `ATTENDANCE_STATEMENT_SHIFT_FILTER_INVALID` · `RENDERER_UNAVAILABLE` ·
  `DOCUMENT_NOT_READY` · `DOCUMENT_EXPIRED`; render failures `DOCUMENT_TOO_LARGE`, `DOCUMENT_RENDER_TIMEOUT`,
  `DOCUMENT_RENDER_FAILED`, `STATEMENT_EMPTY` («مفيش بيانات حضور في الفترة دي.» / "There is no attendance data in
  this period.").
- **Assertions:** the header name follows the chosen language (spec 061 BR-07); every download writes an audit row
  (BR-09); the second download of one render is refused.
- **Sources:** `docs/specs/061-staff-attendance-statement-pdf/spec.md` (BR-01 … BR-09),
  `docs/adr/0056-attendance-statement-reads-and-logo-reader.md`, journey [56](56-pdf-renderer.md).
