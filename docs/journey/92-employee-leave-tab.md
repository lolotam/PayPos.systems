# 92 · The «الإجازات» tab in an employee's file — تبويب «الإجازات» في ملف الموظفة

> **Since 074-10b / منذ 074-10b:** **Edit** opens the employee's own page `/staff/<id>`; the leave section is on its **Leave** tab. / **تعديل** بيفتح صفحة الموظف `/staff/<id>`؛ قسم الإجازات في تبويب **الإجازات**.

**Status / الحالة:** shipped in #893 (68-1a: the employee's upcoming and pending leave list), #897 (68-1b: the
employee's leave history read, with unexcused absence), #898 (the reader of an employee's business over time) and
#958 (68-3: the tab in the employee file on `/staff/<employee id>/leave`), all merged (spec 068). **Runs on
staging**; needs the `staff` feature. It is a read: requesting, cancelling, deciding and revoking leave work as in
[23](23-request-leave.md) and [24](24-decide-leave.md). The same history for every employee is
[93](93-leave-history-report.md).

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md) with the API and the admin; or the staging admin with the demo company
  «صالون الأميرة (تجريبي)».
- هدى (Huda), a manager who can read leave on every branch; منى (Mona), Branch Manager of Salmiya only; a cashier
  without the leave read.
- ريم (Reem), an employee with: an approved annual leave last month, a rejected request, a pending request for next
  month, and one scheduled day in the past with no attendance and no leave ([19](19-schedules.md)).

## العربي

1. **افتح التبويب:** هدى تفتح ملف ريم من **الموظفين** ← فوق أقسام الملف: **البيانات** و**الإجازات**. تدوس
   **الإجازات**.
2. **طلبات جاية ومستنية:** فوق، قسم **طلبات جاية ومستنية** فيه طلبات ريم اللي بتخلص النهارده أو بعده أو لسه معلقة
   (طلب الشهر الجاي)، ومعاها نفس أزرار الإلغاء والقرار وسحب الموافقة اللي في [24](24-decide-leave.md). لو مفيش ←
   **مفيش طلبات جاية أو مستنية**.
3. **سطر «آخر»:** سطر واحد: **آخر سنوية**، **آخر مرضية**، **آخر من غير مرتب**، **آخر غياب من غير عذر**، كل واحدة
   بتاريخها أو **مفيش**. السطر ده محسوب على كل تاريخ ريم، مش على الفترة المختارة.
4. **سجل الإجازات:** تحت، **سجل الإجازات** من 1 يناير السنة دي لحد النهارده، الأحدث الأول: كل طلب بنوعه وتواريخه
   وحالته، وسطر **غياب من غير عذر** (حالته **غياب**) لكل يوم كان عليها شيفت وخلص، ومفيش حضور ولا إجازة.
5. **من غير تكرار:** الطلب اللي ظاهر في **طلبات جاية ومستنية** ما بيظهرش تاني في السجل.
6. **فلتر الفترة:** غيّر **من تاريخ** و**حتى تاريخ** ودوس **تطبيق التصفية** ← السجل بيتغيّر، وسطر «آخر» زي ما هو. فترة
   أطول من 366 يوم، أو البداية بعد النهاية ← **اختار فترة مش أطول من ٣٦٦ يوم، وتاريخ البداية يكون قبل النهاية أو
   يساويها.**
7. **فلتر النوع والحالة:** نوع **سنوية** بس ← الإجازات السنوية بس. نوع **غياب من غير عذر** بس ← سطور الغياب بس. حالة
   **مرفوضة** ← الطلبات المرفوضة بس. لو مفيش نتيجة ← **مفيش إجازات أو غياب في الفترة دي**.
8. **طلب مرفوض + غياب:** يوم عليه طلب اترفض ومفيش حضور ← سطر الطلب المرفوض **وسطر** غياب. طلب لسه معلق ← الطلب بس،
   من غير غياب.
9. **شيفت لسه ما خلصش:** شيفت النهارده اللي لسه شغال ما بيتحسبش غياب.
10. **مديرة فرع:** منى بتشوف سطور السالمية بس. يوم ريم كانت متغطية فيه بحضور أو إجازة في فرع تاني بيظهر **متغطي خارج
    الفرع** من غير تفاصيل.
11. **من غير صلاحية:** الكاشير يفتح العنوان مباشرة ← مش موجود (404)، ومفيش بيانات.

**ممنوع يحصل:**
- طلب يظهر مرتين (فوق وفي السجل).
- غياب يتحسب ليوم فيه حضور في أي فرع، أو إجازة معتمدة أو معلقة، أو قبل تاريخ التعيين، أو بعد نهاية العقد.
- مديرة فرع تشوف تفاصيل طلب أو حضور في فرع مش بتاعها.
- الغياب يتخزّن (بيتحسب في كل قراءة، فلو إجازة اتعمدت بعدين الغياب يختفي).
- التبويب يكتب أي حاجة غير الأفعال الموجودة من قبل.

## English

1. **Open the tab:** Huda opens Reem's file from **Employees** → above the file's sections: **Details** and
   **Leave**. She clicks **Leave**.
2. **Upcoming and pending:** at the top, **Upcoming and pending requests** lists Reem's requests that end today or
   later or are still pending (next month's request), with the same cancel, decide and revoke buttons as in
   [24](24-decide-leave.md). With none → **No upcoming or pending requests**.
3. **The "last" line:** one line: **Last annual**, **Last sick**, **Last unpaid**, **Last unexcused absence**, each
   with its date or **None**. It is computed over all of Reem's history, not over the chosen period.
4. **Leave history:** below, **Leave history** from 1 January of this year to today, newest first: every request
   with its type, dates and status, plus an **Unexcused absence** row (status **Absent**) for each day she had a
   shift that ended with no attendance and no leave.
5. **No duplicates:** a request shown under **Upcoming and pending requests** is not repeated in the history.
6. **Period filter:** change **From date** and **Through date** and click **Apply filters** → the history changes;
   the "last" line does not. A period over 366 days, or a start after the end → **Pick a period of at most 366 days,
   with the start date on or before the end date.**
7. **Type and status filters:** type **Annual** only → annual leave only. Type **Unexcused absence** only → absence
   rows only. Status **Rejected** → rejected requests only. With no result → **No leave or absence in this period**.
8. **A rejected request plus absence:** a day with a rejected request and no attendance → the rejected request row
   **and** an absence row. A request still pending → the request only, no absence.
9. **A shift not over yet:** today's shift that is still running is not counted as absence.
10. **A branch manager:** Mona sees Salmiya's rows only. A day on which Reem was covered by attendance or leave at
    another branch shows **Covered outside this branch**, with no details.
11. **No permission:** the cashier opens the address directly → not found (404), and no data.

**Must NOT happen:**
- A request shown twice (at the top and in the history).
- Absence counted for a day with attendance at any branch, with an approved or pending leave, before the hire date,
  or after the contract ended.
- A branch manager seeing the details of a request or attendance at a branch that is not hers.
- Absence stored (it is computed on every read, so a leave approved later removes it).
- The tab writing anything beyond the actions that already existed.

## For an agent

- **Screen:** `/staff/<EMPLOYEE_ID>/leave` (local `http://localhost:3001`, staging
  `https://app.staging.pospay.systems`); route file `apps/admin/app/(dashboard)/staff/[employeeId]/leave/page.tsx`.
  Tabs **البيانات** / **Details** and **الإجازات** / **Leave**. Text in `packages/i18n/src/leave-history-catalog.ts`
  and `leave-catalog.ts`.
- **API** (`apps/api/src/modules/staff/http/`, `@Authenticated()`; access is the existing leave read scope,
  `read:leave:branch`, checked inside the read): `GET /v1/businesses/<BUSINESS_ID>/employees/<EMPLOYEE_ID>/leave-history`
  (`employee-leave-history.controller.ts`) · `GET …/employees/<EMPLOYEE_ID>/leave-requests`
  (`employee-leave.controller.ts`). Filters: `from`, `to`, `types[]`, `statuses[]`, a keyset `cursor`.
- **Row types:** a leave row, an absence row, and `COVERED_ELSEWHERE`.
- **Errors:** 404 for a caller without the leave read · `FEATURE_DISABLED` with the feature off.
- **Sources:** `docs/specs/068-staff-leave-history/spec.md` (User Stories 1, 2 and 4, FR-001 … FR-011, BR-001 …
  BR-008), `docs/specs/068-staff-leave-history/plan-68-3.md`.
