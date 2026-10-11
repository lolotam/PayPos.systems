# 35 · Correct an attendance session — تصحيح وقت الحضور أو الانصراف

**Status / الحالة:** shipped in #132 (PR 26, merge commit `5b524dc6`). **API only**: the correction form ships with
the attendance board (PR 27, CA-Q15). Staging runs `api` and `worker` at commit `6c220e4` (2026-10-11), so the route
is **live on staging**; the admin and POS apps are **not deployed** (issue #54), so you use an HTTP client. A
correction takes effect **at once** (no approval, CA-Q3) and never touches pay, hours-as-pay, exceptions or
commission. For the request-and-approve flow (add a day, void or restore a day) see
[31](31-attendance-change-requests.md); that flow does not replace this one. Your decisions of 2026-10-08 (CA-Q1 to
CA-Q16) apply: [owner-questions.ar.md](../specs/035-staff-correct-attendance/owner-questions.ar.md).

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md), then `pnpm db:migrate` (the `revision` column on `attendance_sessions`, the
  `attendance_corrections` table and the permission `correct:attendance:branch`) and `pnpm db:seed`. API running; the
  company's `staff` feature enabled.
- One business with two branches, Salmiya (فرع السالمية) and Hawalli (فرع حولي). Synthetic employees attached to
  Salmiya, each with a branch schedule so lateness exists ([19](19-schedules.md)):
  - هبة (Heba): a **CLOSED** session where she scanned at 10:40 but her shift started at 10:00 (`late_minutes` 40).
  - سارة (Sara): a **MISSED_OUT** session, closed by the system at clock-in + 16 hours
    ([26](26-clock-attendance.md)).
  - A third employee with a session that is still **OPEN**.
  You need each session `id` and its current `revision` (0 for an untouched session).
- Synthetic users, each with their own session cookie:
  - **Branch Manager** of Salmiya (not linked to any of the employees above).
  - **Branch Manager** of Hawalli.
  - **Owner**, who also has her own employee record and a closed session.
  - **General Manager**, who also has his own employee record and a closed session.
- Who may correct (`correct:attendance:branch`, "تصحيح أوقات حضور الفرع" / "Correct branch attendance times"): by default
  Owner, General Manager, Business Manager and Branch Manager, on the session's branch. A paired Device never holds it.
  It is separate from closing exceptions ([34](34-resolve-attendance-exception.md)).
- Synthetic reasons only. Every write needs `Idempotency-Key` and `x-company-id`. Times are UTC instants.

## العربي

1. **نسيت تسجّل انصراف:** جلسة سارة اتقفلت `MISSED_OUT` الساعة 02:00 الصبح. مديرة السالمية تعرف إنها مشيت 18:00،
   فتبعت التصحيح بـ `clock_out` = 18:00 وسبب ("مشيت 18:00، الاستقبال أكد") ← **200**. الجلسة بقى فيها الانصراف 18:00
   و**لسه `MISSED_OUT`** و`closed_by` لسه `MISSED_OUT`، و`revision` زاد واحد. الرد فيه `corrections` بصف واحد
   (`field` = `CLOCK_OUT`، و`before` = 02:00 اليوم التاني، و`after` = 18:00، والسبب، ومين، وإمتى). وسطر تدقيق واحد فيه قبل
   وبعد.
2. **الحضور غلط:** هبة مسحت 10:40 بس وصلت 10:05 والشيفت 10:00. المديرة تصحّح `clock_in` = 10:05 وسبب ← **200**،
   و`late_minutes` نزل من 40 لـ 0 (قاعدة العشر دقايق: لحد 10 دقايق بعد البداية = 0، وبعدها كل الدقايق الكاملة).
   صف تاريخ بـ `field` = `CLOCK_IN`، وسطر التدقيق فيه `late_minutes` 40 ← 0. جلسة من غير شيفت مسجّل: التأخير يفضل 0.
   تصحيح الانصراف بس **ما بيغيّرش** التأخير.
3. **الاتنين مع بعض:** `clock_in` و`clock_out` في طلب واحد ← صفين تاريخ (واحد لكل حقل) بنفس السبب والمنفّذ والوقت،
   وسطر تدقيق واحد.
4. **التاريخ ما بيتمسحش:** تصحيح نفس الجلسة تاني ← صفوف جديدة، والصفوف القديمة زي ما هي (مفيش حد أقصى للتصحيحات).
   أي تاريخ قديم مقبول، وتصحيح يوم إجازة معتمدة مقبول (النظام ما بيقراش الإجازات).
5. **السبب إجباري:** سبب فاضي أو مسافات بس أو أطول من 500 حرف، أو من غير أي وقت في الطلب، أو وقت زي الحالي بالظبط ←
   **البيانات المرسلة غير صحيحة** (`VALIDATION_FAILED`، 400) ومفيش تغيير.
6. **جلسة لسه مفتوحة:** تصحيح جلسة `OPEN` ← **الجلسة ما زالت مفتوحة. أغلقها أولاً ثم صحّح الوقت.**
   (`ATTENDANCE_SESSION_OPEN`، 409). مسح الموظف الجاي أو مهمة الـ 16 ساعة بتقفلها، وبعدين تتصحّح.
7. **أوقات مرفوضة:** أي من دول ← **أوقات الحضور غير مقبولة. يجب أن يكون الخروج بعد الدخول، وألا يتجاوز ١٦ ساعة، وألا
   يكون في المستقبل، وألا يتداخل مع جلسة أخرى.** (`ATTENDANCE_CORRECTION_INVALID_TIMES`، 422): انصراف قبل أو يساوي
   الحضور، وقت في المستقبل، جلسة أطول من 16 ساعة (16 بالظبط مقبولة)، أو تداخل مع جلسة تانية لنفس الموظف (بما فيها
   جلستها المفتوحة). جلسة تبدأ لما التانية تنتهي بالظبط مش تداخل.
8. **تغيير يوم العمل:** تصحيح الحضور يخلي الجلسة تروح يوم عمل تاني (بتوقيت الفرع) ← **لا يمكن نقل بداية الحضور إلى
   يوم عمل آخر.** (`ATTENDANCE_CORRECTION_WORKING_DATE`، 422). تأخير الانصراف لبعد نص الليل مقبول.
9. **النسخة قديمة:** `revision` قديم (حد صحّح أو مسح أو المهمة قفلت الجلسة في النص) ← **تغيرت جلسة الحضور. أعد التحميل
   وحاول مرة أخرى.** (`ATTENDANCE_SESSION_REVISION_CONFLICT`، 409) ومفيش تغيير. مديرين اتنين في نفس اللحظة: واحد بس
   ينجح.
10. **حضورك أنت:** صاحبة الشركة تصحّح جلستها هي ← **200** ومتسجّلة باسمها. المدير العام (أو مدير النشاط أو مدير الفرع)
    يصحّح جلسته هو ← **لا يمكنك تصحيح حضورك أنت إلا إذا كنت المالك.**
    (`ATTENDANCE_CORRECTION_SELF_FORBIDDEN`، 403) ومفيش تغيير. ده **مقصود** وبيختلف عن إغلاق التنبيهات
    ([34](34-resolve-attendance-exception.md)) اللي بيمنع صاحبة الشركة كمان. الترتيب لو أكتر من قاعدة اتكسرت: حضورك أنت،
    بعدين الجلسة مفتوحة، بعدين النسخة، بعدين الأوقات.
11. **الفرع والنطاق:** مديرة حولي تصحّح جلسة من السالمية، أو `id` من نشاط أو شركة تانية ← **المسار غير موجود**
    (`NOT_FOUND`، 404) بنفس الرد بالظبط. جهاز الكاشير المربوط ← **غير مسموح بهذا الإجراء** (`FORBIDDEN`، 403).
12. **اللي ما بيتغيرش:** مكان المسح والجهاز والمشغّل ومصدر الجلسة والتنبيهات (استثناءات الحضور) زي ما هي، وسارة
    وهبة ما بيوصلهم أي إشعار، وما فيش أي أثر على العمولة.
13. **إعادة الإرسال:** نفس الطلب بنفس `Idempotency-Key` ← نفس الرد من غير كتابة جديدة. نفس المفتاح بجسم تاني ←
    **تم استخدام مفتاح Idempotency-Key مع طلب مختلف** (`IDEMPOTENCY_KEY_REUSED`).

**ممنوع يحصل:**
- تصحيح من غير سبب، أو القيمة القديمة تضيع (لازم صف تاريخ وسطر تدقيق قبل وبعد في نفس المعاملة).
- مدير غير صاحبة الشركة يصحّح حضوره هو.
- تصحيح جلسة مفتوحة، أو أوقات تتداخل مع جلسة تانية أو في المستقبل أو أطول من 16 ساعة.
- تصحيح يغيّر يوم العمل.
- جلسة `MISSED_OUT` تتحول لـ `CLOSED` أو يتغير `closed_by` بتاعها.
- مدير فرع تاني أو جهاز الكاشير يصحّح، أو رد يفرّق بين جلسة برّه نطاقك وجلسة مش موجودة.
- مديرين يصحّحوا نفس الجلسة مع بعض وكله ينجح.
- أي تغيير في العمولة أو التنبيهات أو بيانات المسح، أو إشعار للموظف.

## English

1. **A forgotten clock-out:** Sara's session was closed `MISSED_OUT` at 02:00 the next morning. The Salmiya Branch
   Manager knows she left at 18:00 and sends the correction with `clock_out` 18:00 and a reason ("left at 18:00,
   confirmed by reception") → **200**. The session now shows 18:00, is **still `MISSED_OUT`** with `closed_by`
   `MISSED_OUT`, and `revision` is up by one. The response `corrections` holds one row (`field` `CLOCK_OUT`, `before`
   02:00 next day, `after` 18:00, the reason, who, when). One audit entry holds before and after.
2. **A wrong clock-in:** Heba scanned at 10:40 but arrived at 10:05; her shift is 10:00. The manager corrects `clock_in`
   to 10:05 with a reason → **200**, `late_minutes` drops from 40 to 0 (the ten-minute rule: up to 10 minutes after the
   start is 0, otherwise all elapsed whole minutes). A `CLOCK_IN` history row exists and the audit entry shows
   `late_minutes` 40 → 0. A session with no recorded shift keeps lateness 0. Correcting only the clock-out leaves
   lateness **unchanged**.
3. **Both at once:** `clock_in` and `clock_out` in one request → two history rows (one per field) sharing the reason,
   actor and time, and one audit entry.
4. **History is never erased:** correcting the same session again adds rows; the old ones stay (no limit on the number
   of corrections). Any past date is accepted, and so is a day of approved leave (leave is not read).
5. **The reason is mandatory:** an empty, spaces-only or over-500-character reason, a body with no time at all, or a
   time equal to the current one → "The request is not valid" (`VALIDATION_FAILED`, 400), nothing changes.
6. **A session still open:** correcting an `OPEN` session → "This attendance session is still open. Close it before
   correcting the times." (`ATTENDANCE_SESSION_OPEN`, 409). The employee's next scan or the 16-hour job closes it, then
   you correct it.
7. **Refused times:** any of these → "Those attendance times are not allowed. Clock-out must be after clock-in, within
   16 hours, not in the future, and must not overlap another session." (`ATTENDANCE_CORRECTION_INVALID_TIMES`, 422):
   clock-out at or before clock-in, a time in the future, a session over 16 hours (exactly 16 is allowed), or an overlap
   with another session of the same employee (including her open one). Touching ends are not an overlap.
8. **Changing the working date:** a clock-in correction that moves the session to another working date (branch
   timezone) → "A clock-in correction cannot move the session to another working date."
   (`ATTENDANCE_CORRECTION_WORKING_DATE`, 422). Moving the clock-out past midnight is allowed.
9. **A stale revision:** a stale `revision` (someone corrected it, or a scan or the job closed it, in between) → "The
   attendance session changed. Reload and try again." (`ATTENDANCE_SESSION_REVISION_CONFLICT`, 409), nothing changes.
   Two managers at the same moment: exactly one succeeds.
10. **Your own attendance:** the Owner corrects her own session → **200**, recorded under her name. The General Manager
    (or a Business or Branch Manager) corrects his own session → "Only the owner may correct their own attendance."
    (`ATTENDANCE_CORRECTION_SELF_FORBIDDEN`, 403), nothing changes. This is **deliberate** and differs from closing
    exceptions ([34](34-resolve-attendance-exception.md)), which refuses the Owner too. When several rules fail at once
    the order is: own attendance, session open, revision, then times.
11. **Branch and scope:** the Hawalli manager corrects a Salmiya session, or anyone sends an id of another business or
    company → "Not found" (`NOT_FOUND`, 404), the identical envelope. The paired POS device → "This action is not
    allowed" (`FORBIDDEN`, 403).
12. **What never changes:** the scan location, device, operator, session source and the exceptions stay as they are;
    Sara and Heba get no message; commission is untouched.
13. **Replays:** the same request with the same `Idempotency-Key` → the same answer, nothing written again. The same
    key with another body → "This Idempotency-Key was already used with a different request"
    (`IDEMPOTENCY_KEY_REUSED`).

**Must NOT happen:**
- A correction without a reason, or the old value being lost (a history row and an audit entry with before and after,
  in the same transaction, are required).
- Anyone but the Owner correcting their own attendance.
- Correcting an open session, or times that overlap another session, lie in the future or exceed 16 hours.
- A correction that changes the working date.
- A `MISSED_OUT` session becoming `CLOSED`, or its `closed_by` changing.
- Another branch's manager or the paired device correcting, or an answer that tells an out-of-scope session from an
  unknown one.
- Two managers both succeeding on the same session.
- Any change to commission, exceptions or scan facts, or a message to the employee.

## For an agent

- Every call: session cookie of the acting manager + `x-company-id: <COMPANY_ID>` + `Idempotency-Key: <UNIQUE_KEY>`.
  The route is `@Authenticated()` + `SelectedCompanyGuard`; the permission and owner checks are in the use case, on the
  session's clock-in branch.
- Correct (200 → `{ session, corrections }`):

  ```http
  POST /v1/businesses/<BUSINESS_ID>/attendance-sessions/<SESSION_ID>/correct
  x-company-id: <COMPANY_ID>
  Idempotency-Key: <UNIQUE_KEY>
  Content-Type: application/json

  { "revision": <REVISION>, "clock_out": "<UTC_ISO_INSTANT>", "reason": "<SYNTHETIC_REASON>" }
  ```

- The body is strict: `revision` integer >= 0, optional `clock_in` and `clock_out` (at least one is required), and
  `reason` 1 to 500 characters after trimming. A request in which no field differs from the current value is a
  `VALIDATION_FAILED` 400. Response `session`: `id, employee_id, branch_id, working_date, clock_in, clock_out, status
  (CLOSED | MISSED_OUT), closed_by (EMPLOYEE | MISSED_OUT), late_minutes, revision`; `corrections` (the rows this
  request wrote): `id, field (CLOCK_IN | CLOCK_OUT), before, after, reason, corrected_by, corrected_at`.
- Errors: `NOT_FOUND` 404 · `FORBIDDEN` 403 · `ATTENDANCE_CORRECTION_SELF_FORBIDDEN` 403 · `ATTENDANCE_SESSION_OPEN` 409 ·
  `ATTENDANCE_SESSION_REVISION_CONFLICT` 409 · `ATTENDANCE_CORRECTION_INVALID_TIMES` 422 ·
  `ATTENDANCE_CORRECTION_WORKING_DATE` 422 · `VALIDATION_FAILED` 400 · `IDEMPOTENCY_KEY_REUSED` ·
  `TRANSACTION_RETRY_REQUIRED` · `NOT_READY` 503, each with `message_ar` and `message_en`.
- Assertions: one `attendance_corrections` row per changed field plus exactly one audit row; `revision` + 1 on the
  session, and also on every scan, card and job close; `MISSED_OUT` stays `MISSED_OUT`; `late_minutes` recomputed only
  when `clock_in` changes; `geo`, coordinates, device, operator, `source` and exception rows byte-identical; the
  attendance_corrections table is append-only (no UPDATE or DELETE privilege); stale revision and refused times commit
  nothing; two concurrent corrections commit one; a correction racing a scan on the same employee is serialised; unknown,
  other-branch, other-business and other-company ids give identical `NOT_FOUND` envelopes; RLS hides another tenant's
  corrections. Sources: `docs/specs/035-staff-correct-attendance/spec.md`,
  `apps/api/src/modules/staff/http/attendance-corrections.controller.ts`,
  `packages/contracts/src/staff/attendance-correction.ts`, `packages/i18n/src/attendance-correction-catalog.ts`,
  `packages/i18n/src/permission-codes-catalog.ts`, `apps/api/src/shared/errors.ts`.
