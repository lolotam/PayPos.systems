# 93 · Leave history report for all employees — تقرير سجل الإجازات لكل الموظفين

**Status / الحالة:** shipped in #942 (68-2a: the business-wide leave-history read with a limit on what one request
may compute), #981 (68-2b-2a: the report tables), #982 (68-2b-2b: the worker that builds and cleans up large
reports), #997 (68-2c: requesting a report and reading its result) and #1001 (68-4: the admin screen on
`/staff/leave-history`), all merged (spec 068). **Runs on staging**; needs the `staff` feature, and the worker for
large reports. It shows the same rows as the tab of [92](92-employee-leave-tab.md), for every employee of the
business.

**Before you start / قبل ما تبدأ:**
- Everything of [92](92-employee-leave-tab.md): هدى (Huda) who reads leave on every branch, منى (Mona) of Salmiya
  only, and employees with leave requests and absence days.
- API, worker and Redis running.

## العربي

1. **افتح التقرير:** من قائمة الموظفين دوس **سجل الإجازات** ← شاشة **سجل الإجازات**، والفترة من 1 يناير السنة دي
   لحد النهارده.
2. **الصفوف:** نفس صفوف [92](92-employee-leave-tab.md) لكل الموظفات: طلبات الإجازة بحالاتها، وسطور **غياب من غير
   عذر**، وكل صف عليه اسم الموظفة ورقمها والفرع، الأحدث الأول.
3. **الفلاتر:** **الفرع** (أو **كل الفروع المسموحة**)، و**الموظفة** (**كل الموظفات** أو واحدة من **دوّر على
   موظفة**)، والنوع والحالة والفترة، وبعدها **تطبيق التصفية**.
4. **موظفة واحدة:** هدى تختار ريم ← الصفوف بتاعة ريم بس، وفوقها سطر «آخر»: **آخر سنوية**، **آخر مرضية**، **آخر من
   غير مرتب**، **آخر غياب من غير عذر**.
5. **تقرير كبير:** فترة طويلة لكل الموظفات ← بدل ما الشاشة تستنى، بيظهر **بنجهّز التقرير…**، والـ worker بيجهّزه،
   والشاشة بتسأل كل 3 ثواني لحد ما يجهز وتعرض الصفوف.
6. **قفلت وفتحت:** لو قفلت الشاشة وفتحتها والتقرير لسه بيتجهّز ← نفس الطلب بيكمل، من غير طلب جديد. لو طبّقت الفلاتر
   تاني ← طلب جديد.
7. **تلاتة بالكتير:** عندك 3 تقارير شغالة وطلبت رابع ← **لديك ثلاثة تقارير سجل إجازات قيد التنفيذ، فانتظر حتى يكتمل
   أحدها.**
8. **كبير أوي:** ← **تقرير سجل الإجازات يحتوي على صفوف كثيرة، فضيّق الفترة أو عوامل التصفية.**
9. **فشل:** ← **تعذّر إكمال تقرير سجل الإجازات، فاطلبه مرة أخرى.**
10. **صلاحياتك اتغيّرت:** لو فروعك اتغيّرت والتقرير بيتجهّز ← **تغيّرت صلاحياتك على الفروع، فاطلب تقرير سجل الإجازات
    مرة أخرى.**
11. **انتهى:** تقرير قديم ← **تقرير سجل الإجازات غير موجود أو انتهت صلاحيته.**
12. **مديرة فرع:** منى بتشوف صفوف السالمية بس، وفلتر الفرع عندها فيه فروعها بس.
13. **قائمة الموظفات مش متاحة:** ← **قائمة الموظفات مش متاحة دلوقتي**، والتقرير لكل الموظفات لسه شغال.
14. **فترة غلط:** ← **اختار فترة مش أطول من ٣٦٦ يوم، وتاريخ البداية يكون قبل النهاية أو يساويها.**

**ممنوع يحصل:**
- مستخدمة تشوف صفوف فرع ملهاش عليه قراءة الإجازات، حتى من تقرير اتجهّز قبل ما صلاحيتها تتغيّر.
- مستخدم يقرا تقرير مستخدم تاني.
- الشاشة تبعت طلب تقرير تاني لنفس الفلاتر وهي بتستنى.
- طلب واحد يحسب تقرير كبير جوّه الـ API ويعطّل باقي الطلبات.
- تقرير قديم يتعرض بدل البيانات الحالية بعد إعادة الفتح.

## English

1. **Open the report:** in the staff menu click **Leave history report** → the **Leave history report** screen, with
   the period from 1 January of this year to today.
2. **Rows:** the same rows as [92](92-employee-leave-tab.md), for every employee: leave requests with their status,
   and **Unexcused absence** rows, each with the employee's name and number and the branch, newest first.
3. **Filters:** **Branch** (or **All authorized branches**), **Employee** (**All employees**, or one from **Search
   employees**), the type, the status and the period, then **Apply filters**.
4. **One employee:** Huda picks Reem → only Reem's rows, with the "last" line above them: **Last annual**, **Last
   sick**, **Last unpaid**, **Last unexcused absence**.
5. **A large report:** a long period for all employees → instead of making the screen wait, it shows **Preparing the
   report…**; the worker builds it, and the screen asks every 3 seconds until it is ready and shows the rows.
6. **Closed and reopened:** if you close the screen and open it again while the report is still being prepared →
   the same request continues, with no new one. Applying the filters again makes a new request.
7. **Three at most:** with 3 reports in progress you ask for a fourth → **You already have three leave history
   reports in progress, so wait for one to finish.**
8. **Too large:** → **This leave history report has too many rows, so narrow the date range or filters.**
9. **Failed:** → **The leave history report could not be completed, so request it again.**
10. **Your access changed:** if your branches changed while the report was being prepared → **Your branch access
    changed, so request this leave history report again.**
11. **Expired:** an old report → **This leave history report was not found or has expired.**
12. **A branch manager:** Mona sees Salmiya's rows only, and her branch filter lists only her branches.
13. **Employee list unavailable:** → **The employee list is not available**, and the all-employees report still
    works.
14. **A bad period:** → **Pick a period of at most 366 days, with the start date on or before the end date.**

**Must NOT happen:**
- A user seeing rows of a branch she cannot read leave for, even from a report built before her access changed.
- A user reading another user's report.
- The screen posting a second report request for the same filters while it waits.
- One request computing a large report inside the API and holding up other requests.
- An old stored report shown instead of the current data after a reopen.

## For an agent

- **Screen:** `/staff/leave-history` (local `http://localhost:3001`, staging `https://app.staging.pospay.systems`);
  page `apps/admin/src/staff/pages/leave-report-page.tsx`; sidebar link **سجل الإجازات** / **Leave history report**.
  Text in `packages/i18n/src/leave-history-catalog.ts` and `leave-catalog.ts`.
- **API** (`apps/api/src/modules/staff/http/`, `@Authenticated()`, the leave read scope `read:leave:branch` checked
  inside): `GET /v1/businesses/<BUSINESS_ID>/leave-history` (`leave-history-report.controller.ts`, the direct read)
  · `POST /v1/businesses/<BUSINESS_ID>/leave-history/reports` and `GET …/reports/<REPORT_ID>`
  (`leave-history-report-jobs.controller.ts`, the background report).
- **Errors** (`packages/i18n/src/leave-catalog.ts`): `LEAVE_HISTORY_REPORT_REQUIRED` (the direct read refuses a
  workload that is too large and asks for a report) · `LEAVE_HISTORY_REPORT_BUSY` ·
  `LEAVE_HISTORY_REPORT_NOT_FOUND` · `LEAVE_HISTORY_REPORT_STALE` · `LEAVE_HISTORY_REPORT_FAILED` ·
  `LEAVE_HISTORY_REPORT_TOO_LARGE`.
- **Tests to mirror:** `apps/admin/src/staff/pages/leave-report-page-heavy.spec.tsx` ("polls the report every three
  seconds only while it is pending", "keeps one report request when the screen is closed and opened again").
- **Sources:** `docs/specs/068-staff-leave-history/spec.md` (User Stories 3 and 4, FR-002 … FR-010),
  `docs/specs/068-staff-leave-history/plan-68-2.md`, `plan-68-2b-2.md`, `plan-68-2c.md`, `plan-68-4.md`.
