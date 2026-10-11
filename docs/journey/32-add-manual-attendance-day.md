# 32 · Add a manual attendance day — إضافة يوم حضور يدوي

**Status / الحالة:** PR #153 (open), branch `feat/p1-26b-add-manual-session`, spec
[045](../specs/045-staff-add-manual-session/spec.md) on that branch. **Not on main yet**: until #153 merges, an
`ADD_SESSION` request is refused with `ATTENDANCE_CHANGE_KIND_UNAVAILABLE` ([31](31-attendance-change-requests.md)).
API only: no admin screen until PR 27, and the admin is not deployed (issue #54); you see only the bell when the admin
runs locally. A manual day is the `ADD_SESSION` kind of the change requests in [31](31-attendance-change-requests.md):
a manager asks, an approver (the Owner by default) approves, and only then does the day exist. Attendance never touches
commission. Your decisions of 2026-10-10 (ACR-Q10, ACR-Q11, ACR-Q13 to ACR-Q18, ACR-Q22) apply:
[owner-questions.ar.md](../specs/044-staff-attendance-change-requests/owner-questions.ar.md).

**Before you start / قبل ما تبدأ:**
- Everything in [31](31-attendance-change-requests.md), on a checkout of #153 (or main after it merges), then
  `pnpm db:migrate` (the `MANUAL` source, `change_request_id`, and the `ADD_SESSION` columns on the requests table) and
  `pnpm db:seed`.
- The example from the owner Q&A: ريم (Reem), a synthetic stylist attached to **Salmiya** only, inside her contract,
  forgot to clock all of **Thursday 2026-10-08**. She worked **10:00–19:00** Kuwait time (`Asia/Kuwait`, UTC+3), so
  `clock_in` = `2026-10-08T07:00:00.000Z` and `clock_out` = `2026-10-08T16:00:00.000Z`.
- A synthetic schedule ([19](19-schedules.md)) giving Reem a Salmiya shift that Thursday starting **09:30**, for the
  lateness check. A second Salmiya employee with **no** shift that day, for the zero-lateness check.
- For the overlap check: one real scanned day of Reem ([26](26-clock-attendance.md) or
  [30](30-employee-cards-and-clock-by-card.md)) on another date, so you know its hours.
- The Salmiya Branch Manager (requester) and the Owner (approver) sessions. Synthetic reasons only.

## العربي

1. **مديرة السالمية تطلب يوم ريم:** تبعت طلب `ADD_SESSION` فيه ريم وفرع السالمية والدخول 10:00 والخروج 19:00 يوم
   الخميس والسبب ← **201** والطلب `PENDING`، وفيه `requested` = `{ clock_in, clock_out, working_date: "2026-10-08",
   timezone: "Asia/Kuwait" }`. **مفيش يوم حضور اتعمل لسه.**
2. **الجرس:** جرس صاحب الشركة: **طلب إضافة يوم حضور لـ ريم مستني موافقتك**.
3. **الموافقة:** صاحب الشركة يوافق ← **200** والطلب `APPROVED` و`session_id` بيشاور على اليوم الجديد. اليوم الجديد
   مقفول (`CLOSED`)، مصدره **يدوي** (`source: "MANUAL"`، `closed_by: "MANUAL"`)، مربوط بالطلب (`change_request_id`)،
   ومن غير جهاز ولا مشغّل ولا مفتاح مرور ولا موقع (`geo: "NONE"`)، و`revision` = 0، و`working_date` = 2026-10-08 (تاريخ
   الدخول بتوقيت الفرع). سطر تدقيق `attendance_session.added_manual` غير سطر `attendance_change.approved`. جرس المديرة:
   **إضافة يوم حضور لـ ريم: تمت الموافقة. السبب: -**.
4. **التأخير بقاعدة الـ 10 دقايق (ACR-Q17):** شيفت ريم الخميس من 9:30 والدخول 10:00 ← `late_minutes` = **30**. القاعدة
   زي البصمة بالظبط: لحد 10 دقايق التأخير صفر، وبعدها كل الدقايق تتحسب (دخول 9:40 ← 0، دخول 9:41 ← 11). موظفة مالهاش
   شيفت اليوم ده ← التأخير 0 والشيفت فاضي. اليوم ده بيتحسب زي أي يوم في اللوحة والتقرير (PR 27) ومكتوب جنبه "يدوي"
   واسم اللي طلب واللي وافق، ومالوش أي أثر على العمولة.
5. **أوقات مش مقبولة (ACR-Q15):** الخروج قبل الدخول أو مساوي ليه (19:00 ← 10:00)، أو وقت في المستقبل، أو يوم أطول من
   16 ساعة (06:00 ← 23:00)، أو ساعات بتتداخل مع بصمة حقيقية لريم (حتى لو يومها لسه مفتوح) ← **أوقات اليوم اليدوي مش
   صحيحة: الخروج لازم بعد الدخول، مش في المستقبل، ١٦ ساعة بالكتير، ومن غير تداخل مع حضور تاني**
   (`ATTENDANCE_MANUAL_INVALID_TIMES`، 422). 16 ساعة بالظبط مقبولة، ويوم بيبدأ بالظبط لما التاني بيخلص مش تداخل.
6. **الفرع والعقد (ACR-Q16):** المديرة كتبت فرع حولي غلط (ريم مش مربوطة بيه يوم الخميس)، أو اليوم قبل التعيين أو بعد
   نهاية العقد ← **الموظفة مش مرتبطة بالفرع ده في اليوم ده أو اليوم برّه عقدها** (`ATTENDANCE_MANUAL_NOT_ELIGIBLE`، 422).
7. **طلبين بيتداخلوا (ACR-Q11):** فيه طلب إضافة مستني لريم 10:00–19:00 والمديرة تقدّم تاني 18:00–20:00 ← **فيه طلب
   مستني لنفس التغيير بالفعل.** (`ATTENDANCE_CHANGE_DUPLICATE_PENDING`، 409).
8. **الدنيا اتغيرت قبل الموافقة (ACR-Q13):** الطلب مستني، وريم بصمت فعلاً في نفس الساعات (أو اتوافق على يوم يدوي تاني
   بيتداخل) ← الموافقة ترجع `ATTENDANCE_MANUAL_INVALID_TIMES` (422) والطلب **يفضل `PENDING`**. المنطقة الزمنية للفرع
   اتغيرت بعد التقديم ← **المنطقة الزمنية للفرع اتغيرت بعد تقديم الطلب. ارفض الطلب وقدّم اليوم من جديد**
   (`ATTENDANCE_MANUAL_TIMEZONE_CHANGED`، 409)، والطلب يفضل مستني لحد ما ترفضه.
9. **اليوم اليدوي مايتصححش (ACR-Q10):** المديرة تحاول تمد خروج يوم ريم اليدوي من 19:00 لـ 23:00 بالتصحيح العادي
   (PR 26) ← **اليوم اليدوي مايتصححش؛ اطلب إلغاءه وإضافة يوم جديد** (`ATTENDANCE_CORRECTION_MANUAL_SESSION`، 409) ومفيش
   تغيير. الطريق الصح: طلب إلغاء اليوم ([33](33-void-and-restore-attendance-day.md)) وطلب إضافة جديد، والاتنين
   بموافقة.
10. **خطوة صاحب الشركة:** صاحب الشركة يقدّم نفس الطلب بنفسه ← **201** و`APPROVED` على طول، واليوم اليدوي موجود فوراً،
    ومفيش إشعار.
11. **باقي القواعد من [31](31-attendance-change-requests.md):** المديرة ماتطلبش يوم لنفسها (403)، الرفض لازم سبب،
    السحب لصاحبة الطلب بس، الجهاز ممنوع، ومفيش أي حد للتاريخ القديم. الطلب على يوم إجازة معتمدة مقبول (الإجازة مش
    بتتقري). ريم ما يوصلهاش أي إشعار.

**ممنوع يحصل:**
- يوم يدوي يظهر قبل الموافقة، أو طلب واحد يعمل أكتر من يوم.
- يوم يدوي بخروج قبل الدخول، أو في المستقبل، أو أطول من 16 ساعة، أو بيتداخل مع يوم تاني لنفس الموظفة.
- يوم يدوي في فرع مش بتاعها في اليوم ده، أو برّه عقدها.
- يوم يدوي بجهاز أو مشغّل أو موقع أو مفتاح مرور، يعني بصمة مزيفة.
- تأخير محسوب بقاعدة غير قاعدة الـ 10 دقايق، أو تأخير على يوم مالوش شيفت.
- يوم يدوي يتمد أو يتغير بالتصحيح العادي من غير موافقة.
- أي أثر على العمولة.

## English

1. **The Salmiya manager asks for Reem's day:** she files `ADD_SESSION` with Reem, the Salmiya branch, clock-in 10:00 and
   clock-out 19:00 that Thursday and a reason → **201**, status `PENDING`, with `requested` = `{ clock_in, clock_out,
   working_date: "2026-10-08", timezone: "Asia/Kuwait" }`. **No attendance day exists yet.**
2. **The bell:** the Owner's bell shows "Add attendance day requested for Reem; awaiting your approval".
3. **Approve:** the Owner approves → **200**, the request `APPROVED` with `session_id` pointing at the new day. The new
   day is `CLOSED`, **manual** (`source: "MANUAL"`, `closed_by: "MANUAL"`), linked to the request
   (`change_request_id`), with no device, operator, passkey or location (`geo: "NONE"`), `revision` 0, and
   `working_date` 2026-10-08 (the clock-in date in the branch timezone). One audit entry
   `attendance_session.added_manual` besides `attendance_change.approved`. The manager's bell: "Add attendance day for
   Reem: Approved. Reason: -".
4. **Lateness with the 10-minute rule (ACR-Q17):** Reem's Thursday shift starts 09:30 and the clock-in is 10:00 →
   `late_minutes` **30**. The rule is the scan rule exactly: up to 10 minutes counts as 0, beyond that every whole
   minute counts (09:40 → 0, 09:41 → 11). An employee with no shift that day → lateness 0 and no shift snapshot. The day
   counts like any other on the board and in the report (PR 27), labelled "manual" with the requester and approver, and
   never affects commission.
5. **Times that are refused (ACR-Q15):** clock-out at or before clock-in (19:00 → 10:00), a time in the future, a day
   over 16 hours (06:00 → 23:00), or hours overlapping a real scan of Reem (even a day still open) → "Manual attendance
   times must end after they start, not be in the future, last at most 16 hours, and not overlap another session."
   (`ATTENDANCE_MANUAL_INVALID_TIMES`, 422). Exactly 16 hours is accepted, and a day starting exactly where another ends
   does not overlap.
6. **Branch and contract (ACR-Q16):** the manager picks Hawalli by mistake (Reem is not attached to it that Thursday),
   or the date is before hiring or after the contract ends → "The employee is not attached to this branch on that date
   or the date is outside their contract." (`ATTENDANCE_MANUAL_NOT_ELIGIBLE`, 422).
7. **Overlapping requests (ACR-Q11):** an ADD request for Reem 10:00–19:00 is pending and the manager files another for
   18:00–20:00 → "A pending request already exists for this change." (`ATTENDANCE_CHANGE_DUPLICATE_PENDING`, 409).
8. **The world changed before approval (ACR-Q13):** the request is pending and Reem really scanned in those hours (or
   another overlapping manual day was approved) → approval returns `ATTENDANCE_MANUAL_INVALID_TIMES` (422) and the
   request **stays `PENDING`**. The branch timezone changed after filing → "The branch time zone changed after this
   request was filed. Reject it and file the day again." (`ATTENDANCE_MANUAL_TIMEZONE_CHANGED`, 409); the request waits
   until you reject it.
9. **A manual day cannot be corrected (ACR-Q10):** the manager tries to stretch the manual day's clock-out from 19:00 to
   23:00 with the ordinary correction (PR 26) → "A manual session cannot be corrected; request a void and a new
   session." (`ATTENDANCE_CORRECTION_MANUAL_SESSION`, 409), nothing changes. The right path: a void request
   ([33](33-void-and-restore-attendance-day.md)) plus a new add request, both approved.
10. **The Owner's one step:** the Owner files the same request herself → **201**, `APPROVED` at once, the manual day
    exists immediately, no notice.
11. **The rest of [31](31-attendance-change-requests.md) applies:** the manager cannot request a day for herself (403),
    a rejection needs a reason, only the requester withdraws, the device is refused, and there is no limit on how far
    back. A request on an approved-leave day is accepted (leave is not read). Reem gets no notice.

**Must NOT happen:**
- A manual day appearing before approval, or one request creating more than one day.
- A manual day ending before it starts, in the future, over 16 hours, or overlapping another day of the same employee.
- A manual day at a branch she is not attached to that day, or outside her contract.
- A manual day carrying a device, operator, location or passkey, i.e. a fake scan.
- Lateness computed by anything but the 10-minute rule, or lateness on a day with no shift.
- A manual day stretched or changed through the ordinary correction without approval.
- Any effect on commission.

## For an agent

- Run on #153's branch until it merges. Session cookie + `x-company-id`; writes need `Idempotency-Key`.
- File (the Salmiya Branch Manager's session):

  ```http
  POST /v1/businesses/<BUSINESS_ID>/attendance-change-requests
  x-company-id: <COMPANY_ID>
  Idempotency-Key: <UNIQUE_KEY>
  Content-Type: application/json

  { "kind": "ADD_SESSION", "employee_id": "<REEM_EMPLOYEE_ID>", "branch_id": "<SALMIYA_BRANCH_ID>",
    "clock_in": "2026-10-08T07:00:00.000Z", "clock_out": "2026-10-08T16:00:00.000Z",
    "reason": "<SYNTHETIC_REASON>" }
  ```

  Strict object: `session_id` and `session_revision` are not accepted on `ADD_SESSION`. → 201, `PENDING`,
  `session_id: null`, `requested.working_date: "2026-10-08"`, `requested.timezone: "Asia/Kuwait"`.
- Decide (the Owner's session): `POST /v1/businesses/<BUSINESS_ID>/attendance-change-requests/<REQUEST_ID>/decide` with
  `{ "decision": "APPROVED", "revision": 0 }` → 200, `APPROVED`, `session_id` set (the decision `effect` shape is
  aligned with #152's when #153 merges).
- Read the new row in `attendance_sessions`: `source='MANUAL'`, `status='CLOSED'`, `closed_by='MANUAL'`,
  `change_request_id=<REQUEST_ID>`, `geo='NONE'`, no `device_id`, `operator_id`, binding or location, `revision=0`,
  `late_minutes=30`, `scheduled_start` = the 09:30 shift instant. No `AttendanceClocked*` event is published and no
  missed-out job is scheduled.
- Correction refusal: `POST /v1/businesses/<BUSINESS_ID>/attendance-sessions/<MANUAL_SESSION_ID>/correct` with
  `{ "revision": 0, "clock_out": "2026-10-08T20:00:00.000Z", "reason": "<SYNTHETIC_REASON>" }` → 409
  `ATTENDANCE_CORRECTION_MANUAL_SESSION`.
- Errors (new in #153): `ATTENDANCE_MANUAL_INVALID_TIMES` 422 · `ATTENDANCE_MANUAL_NOT_ELIGIBLE` 422 ·
  `ATTENDANCE_MANUAL_TIMEZONE_CHANGED` 409 · `ATTENDANCE_CORRECTION_MANUAL_SESSION` 409; overlapping pending ADDs →
  `ATTENDANCE_CHANGE_DUPLICATE_PENDING` 409. At approval every refusal rolls back and leaves the request `PENDING`.
- Boundaries to assert: future by 1 ms refused; exactly 16 h accepted, 16 h + 1 ms refused; touching ends accepted;
  overlap with an OPEN session refused; overnight 22:00 Thursday → 02:00 Friday gets `working_date` Thursday; lateness at
  10 minutes → 0 and at 11 → 11; no shift → 0. The voided-day filter in this overlap check (a voided day does not
  block a manual day, [33](33-void-and-restore-attendance-day.md)) lands when #153 is merged with #152 (spec 046 BR-003).
- Sources (branch `feat/p1-26b-add-manual-session`): `docs/specs/045-staff-add-manual-session/spec.md`,
  `apps/api/src/modules/staff/domain/manual-attendance-session.ts`,
  `apps/api/src/modules/staff/persistence/{add-session-kind,manual-session-writes,manual-session-context.adapter}.ts`,
  `packages/contracts/src/staff/attendance-change-request.ts`, `packages/i18n/src/{ar,en}.ts`,
  `apps/api/src/shared/errors.ts`.
