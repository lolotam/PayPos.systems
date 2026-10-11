# 33 · Void and restore an attendance day — إلغاء يوم حضور واسترجاعه

**Status / الحالة:** shipped in #152 (PR 26c, squash `1325d486`). API only: no admin screen until PR 27, and the admin is
not deployed (issue #54); you see only the bell when the admin runs locally. The API reaches staging with the next
release. A void is the `VOID_SESSION` kind and an undo is the `RESTORE_SESSION` kind of the change requests in
[31](31-attendance-change-requests.md): a manager asks, an approver (the Owner by default) approves, and only then
does the day stop counting, or count again. **Nothing is deleted**: the day stays, marked voided with who approved,
when and through which request. The board and reports that leave voided days out come with PR 27. Attendance never
touches commission. Your decisions of 2026-10-10 (ACR-Q11, ACR-Q13, ACR-Q19, ACR-Q20, ACR-Q21 changed to Abu Salem's
pick, ACR-Q22) apply: [owner-questions.ar.md](../specs/044-staff-attendance-change-requests/owner-questions.ar.md).

**Before you start / قبل ما تبدأ:**
- Everything in [31](31-attendance-change-requests.md), then `pnpm db:migrate` (`0120`–`0123`: the void columns on
  `attendance_sessions`, the `RESTORE_SESSION` kind and the one-pending-void-or-restore index) and `pnpm db:seed`.
- The example from the owner Q&A: هدى (Huda), a synthetic employee of Salmiya, scanned in **by mistake from home on her
  day off** and then scanned out ([26](26-clock-attendance.md) or [30](30-employee-cards-and-clock-by-card.md)), so the
  day is **closed** and carries an open location exception ("outside the location"). Correct its clock-out once with
  the ordinary correction (PR 26), so it has a correction row and `revision` 1. Note its `session_id` and `revision`
  (from the clock response, the correction response, or `attendance_sessions`).
- A second Huda day that is still **open** (clocked in, not out), for the open-day refusal.
- The Salmiya Branch Manager (requester) and the Owner (approver) sessions. Synthetic reasons only.

## العربي

1. **المديرة تطلب إلغاء اليوم:** مديرة السالمية تبعت طلب `VOID_SESSION` ليوم هدى بالـ `session_id` والـ
   `session_revision` الحالي (1) والسبب "بصمت بالغلط يوم إجازتها" ← **201** والطلب `PENDING`، و`requested` فيه دخول
   وخروج اليوم وتاريخه. **اليوم لسه بيتحسب** لحد الموافقة.
2. **الجرس:** جرس صاحب الشركة: **طلب إلغاء يوم حضور لـ هدى مستني موافقتك**.
3. **الموافقة:** صاحب الشركة يوافق ← **200** والطلب `APPROVED`، والرد فيه `effect.session` باليوم وعليه `voided_at`
   و`voided_by` (صاحب الشركة، اللي موافقته خلّت الإلغاء يمشي) و`void_request_id` (الطلب، وفيه اللي طلب والسبب)،
   و`revision` = 2. الحالة والأوقات وكل بيانات البصمة **زي ما هي**؛ مفيش حاجة اتمسحت. سطر تدقيق
   `attendance_session.voided` قبل وبعد. جرس المديرة: **إلغاء يوم حضور لـ هدى: تمت الموافقة. السبب: -**.
4. **التصحيحات والتحذيرات تفضل (ACR-Q20):** صف التصحيح القديم بتاع اليوم ده زي ما هو في السجل. والتحذير المفتوح (البصمة
   من برّه الموقع) **ما اتقفلش ولا اتغير**؛ بيختفي مع اليوم الملغي من اللوحة (PR 27).
5. **اليوم الملغي ما بيأثرش في حاجة:**
   - **التصحيح:** تصحيح اليوم الملغي ← **جلسة الحضور ملغاة. استرجعها بطلب وموافقة قبل أي تعديل.**
     (`ATTENDANCE_SESSION_VOIDED`، 409).
   - **التداخل:** يوم تاني لهدى بيتصحح لساعات بتدخل في ساعات اليوم الملغي ← مقبول؛ اليوم الملغي مش بيتحسب تداخل (ولا
     هيتحسب ليوم يدوي لما [32](32-add-manual-attendance-day.md) يتعمله merge).
   - **الرجوع من البريك والتأخير:** يوم ملغي اتقفل وقت بريك الشيفت ما بيتحسبش إن الموظفة خرجت بريك، فالبصمة اللي بعده
     في نفس الشيفت ما بتتعاملش كرجوع من بريك، والتأخير بيتحسب عادي من بداية الشيفت.
   - **التنبيهات:** يوم ملغي ما بيتحسبش حضور ولا خروج بريك لتنبيهات الشيفت: ما بيمنعش تنبيه **لم يُسجَّل حضور … لشفت الساعة …**
     ولا تنبيه **لم يُسجَّل رجوع … من البريك المنتهي الساعة …** (`shift_not_clocked_in` و`break_not_returned`).
6. **أيام مايتلغيش (ACR-Q19):** يوم لسه مفتوح ← **الجلسة ما زالت مفتوحة. أغلقها أولاً ثم صحّح الوقت.**
   (`ATTENDANCE_SESSION_OPEN`، 409)؛ يستنى لحد ما يتقفل بالبصمة أو بعد 16 ساعة. يوم ملغي أصلاً ← **جلسة الحضور ملغاة.
   استرجعها بطلب وموافقة قبل أي تعديل.** (`ATTENDANCE_SESSION_VOIDED`، 409). الأيام اللي النظام قفلها بعد 16 ساعة
   (`MISSED_OUT`) والأيام اليدوية بتتلغي عادي.
7. **اليوم اتغير قبل الموافقة (ACR-Q13):** الطلب اتقدم على `revision` 1، وبعدين اليوم اتصحح (بقى 2) ← الموافقة ترجع
   **تغيرت جلسة الحضور. أعد التحميل وحاول مرة أخرى.** (`ATTENDANCE_SESSION_REVISION_CONFLICT`، 409) والطلب **يفضل
   `PENDING`**؛ ارفضه وخلّي المديرة تقدّم طلب جديد.
8. **طلب واحد مستني لكل يوم (ACR-Q11):** فيه طلب إلغاء (أو استرجاع) مستني لنفس اليوم ← **فيه طلب مستني لنفس التغيير
   بالفعل.** (`ATTENDANCE_CHANGE_DUPLICATE_PENDING`، 409).
9. **الاسترجاع (ACR-Q21):** طلع إن الإلغاء غلط. المديرة تبعت طلب `RESTORE_SESSION` لنفس اليوم بالـ `revision` الحالي
   (2) وسبب ← **201** و`PENDING`، واليوم لسه ملغي. الجرس: **طلب استرجاع يوم حضور لـ هدى مستني موافقتك**. صاحب الشركة
   يوافق ← **200**؛ `voided_at` و`voided_by` و`void_request_id` يرجعوا فاضيين، و`revision` = 3، وسطر تدقيق
   `attendance_session.restored`، واليوم بيتحسب تاني. **طلب الإلغاء الأصلي يفضل في السجل زي ما هو** (`APPROVED`).
10. **استرجاع مايمشيش:** استرجاع يوم مش ملغي ← **جلسة الحضور مش ملغاة عشان تسترجعها.**
    (`ATTENDANCE_SESSION_NOT_VOIDED`، 409). اليوم الملغي اتعمل مكانه يوم تاني في نفس الساعات (يوم يدوي أو بصمة)،
    وبعدين الاسترجاع اتوافق عليه ← **ماينفعش تسترجع الجلسة لأن وقتها بيتداخل مع جلسة حضور تانية.**
    (`ATTENDANCE_RESTORE_OVERLAP`، 422) والطلب يفضل `PENDING`.
11. **خطوة صاحب الشركة وباقي القواعد من [31](31-attendance-change-requests.md):** صاحب الشركة يلغي أو يسترجع بنفسه في
    خطوة واحدة (201 و`APPROVED` على طول). المديرة ماتلغيش يومها هي (403). الجهاز ممنوع. أي تاريخ قديم مقبول. هدى
    ما يوصلهاش إشعار.

**ممنوع يحصل:**
- يوم حضور يتمسح من قاعدة البيانات، أو أوقاته أو حالته أو بيانات بصمته تتغير بسبب الإلغاء.
- يوم يتلغي أو يرجع قبل الموافقة.
- إلغاء يوم لسه مفتوح، أو إلغاء يوم ملغي، أو استرجاع يوم مش ملغي.
- صف تصحيح يتمسح أو يتغير، أو تحذير مفتوح يتقفل لوحده بسبب الإلغاء.
- يوم ملغي يتصحح، أو يمنع تصحيح أو يوم يدوي في نفس الساعات، أو يتحسب رجوع من بريك، أو يمنع تنبيه.
- استرجاع يعمل يومين فوق بعض.
- طلب الإلغاء الأصلي يختفي أو يتغير بعد الاسترجاع.
- أي أثر على العمولة.

## English

1. **The manager asks for a void:** the Salmiya manager files `VOID_SESSION` for Huda's day with its `session_id`, the
   current `session_revision` (1) and the reason "scanned by mistake on her day off" → **201**, `PENDING`, `requested`
   holds the day's clock-in, clock-out and date. **The day still counts** until approval.
2. **The bell:** the Owner's bell shows "Void attendance day requested for Huda; awaiting your approval".
3. **Approve:** the Owner approves → **200**, the request `APPROVED`, and `effect.session` shows the day with
   `voided_at`, `voided_by` (the Owner, whose decision made the void effective) and `void_request_id` (the request,
   which holds the requester and the reason), `revision` 2. Status, times and every scan fact are **unchanged**; nothing
   was deleted. One audit entry `attendance_session.voided` with before and after. The manager's bell: "Void attendance
   day for Huda: Approved. Reason: -".
4. **Corrections and exceptions stay (ACR-Q20):** the day's earlier correction row is still in history, unchanged. The
   open exception (the outside-location scan) is **not closed or changed**; it is hidden together with the voided day on
   the board (PR 27).
5. **A voided day is inert:**
   - **Correction:** correcting the voided day → "The attendance session is voided. Restore it through an approved
     request before making changes." (`ATTENDANCE_SESSION_VOIDED`, 409).
   - **Overlap:** another Huda day corrected into hours that overlap the voided day → accepted; the voided day is not
     counted as an overlap (nor for a manual day once [32](32-add-manual-attendance-day.md) merges).
   - **Return from break and lateness:** a voided day that closed at the shift's break does not count as leaving for
     the break, so the next scan in that shift is not treated as a return from break, and lateness is measured from the
     shift start as usual.
   - **Alerts:** a voided day counts neither as a clock-in nor as a break-out for the shift alerts: it never
     suppresses the "… has not clocked in for the … shift at …" or "… has not clocked back in from the break that
     ended at …" alert (`shift_not_clocked_in`, `break_not_returned`).
6. **Days that cannot be voided (ACR-Q19):** a day still open → "This attendance session is still open. Close it before
   correcting the times." (`ATTENDANCE_SESSION_OPEN`, 409); it waits until a scan or the 16-hour job closes it. A day
   already voided → "The attendance session is voided. Restore it through an approved request before making changes."
   (`ATTENDANCE_SESSION_VOIDED`, 409). Days closed by the 16-hour job (`MISSED_OUT`) and manual days can be voided.
7. **The day changed before approval (ACR-Q13):** the request was filed at `revision` 1, then the day was corrected (now
   2) → approval returns "The attendance session changed. Reload and try again."
   (`ATTENDANCE_SESSION_REVISION_CONFLICT`, 409) and the request **stays `PENDING`**; reject it and have the manager file
   a new one.
8. **One pending request per day (ACR-Q11):** a void (or restore) of the same day is already pending → "A pending
   request already exists for this change." (`ATTENDANCE_CHANGE_DUPLICATE_PENDING`, 409).
9. **Restore (ACR-Q21):** the void turns out to be wrong. The manager files `RESTORE_SESSION` for the same day with the
   current `revision` (2) and a reason → **201**, `PENDING`, the day still voided. The bell: "Restore attendance day
   requested for Huda; awaiting your approval". The Owner approves → **200**; `voided_at`, `voided_by` and
   `void_request_id` are cleared, `revision` 3, one audit entry `attendance_session.restored`, and the day counts again.
   **The original void request stays in history unchanged** (`APPROVED`).
10. **A restore that fails:** restoring a day that is not voided → "The attendance session is not voided and cannot be
    restored." (`ATTENDANCE_SESSION_NOT_VOIDED`, 409). Another day was recorded in the same hours after the void (a
    manual day or a scan), then the restore is approved → "The session cannot be restored because its hours overlap
    another attendance session." (`ATTENDANCE_RESTORE_OVERLAP`, 422), and the request stays `PENDING`.
11. **The Owner's one step and the rest of [31](31-attendance-change-requests.md):** the Owner voids or restores herself
    in one step (201, `APPROVED` at once). The manager cannot void her own day (403). The device is refused. Any past
    date is accepted. Huda gets no notice.

**Must NOT happen:**
- An attendance day deleted from the database, or its times, status or scan facts changed by a void.
- A day voided or restored before approval.
- Voiding an open day, voiding a voided day, or restoring a day that is not voided.
- A correction row deleted or changed, or an open exception closed automatically by the void.
- A voided day being corrected, blocking a correction or manual day in the same hours, counting as a return from
  break, or suppressing an alert.
- A restore leaving two days on top of each other.
- The original void request disappearing or changing after a restore.
- Any effect on commission.

## For an agent

- Session cookie + `x-company-id`; writes need `Idempotency-Key`. Routes are 26a's ([31](31-attendance-change-requests.md)).
- File a void (the Salmiya Branch Manager's session):

  ```http
  POST /v1/businesses/<BUSINESS_ID>/attendance-change-requests
  x-company-id: <COMPANY_ID>
  Idempotency-Key: <UNIQUE_KEY>
  Content-Type: application/json

  { "kind": "VOID_SESSION", "employee_id": "<HUDA_EMPLOYEE_ID>", "session_id": "<SESSION_ID>",
    "session_revision": 1, "reason": "<SYNTHETIC_REASON>" }
  ```

  `RESTORE_SESSION` has the same strict shape. `session_id` and `session_revision` are required for both;
  `employee_id` must be the session's employee, else `NOT_FOUND`. → 201 `AttendanceChangeRequest` with
  `requested: { working_date, clock_in, clock_out, timezone }` read from the session.
- Decide: `POST /v1/businesses/<BUSINESS_ID>/attendance-change-requests/<REQUEST_ID>/decide` with
  `{ "decision": "APPROVED", "revision": 0 }` → 200 with
  `effect: { session: { id, working_date, clock_in, clock_out, status, revision, voided_at, voided_by, void_request_id } }`
  (`null` on a rejection).
- Correction of a voided day: `POST /v1/businesses/<BUSINESS_ID>/attendance-sessions/<SESSION_ID>/correct` with
  `{ "revision": 2, "clock_out": "<ISO_INSTANT>", "reason": "<SYNTHETIC_REASON>" }` → 409 `ATTENDANCE_SESSION_VOIDED`.
- Errors: `ATTENDANCE_SESSION_OPEN` 409 · `ATTENDANCE_SESSION_VOIDED` 409 · `ATTENDANCE_SESSION_NOT_VOIDED` 409 ·
  `ATTENDANCE_SESSION_REVISION_CONFLICT` 409 · `ATTENDANCE_RESTORE_OVERLAP` 422 · `ATTENDANCE_CHANGE_DUPLICATE_PENDING`
  409. A refusal at approval rolls back and leaves the request `PENDING`.
- Assertions: after the void the `attendance_sessions` row still exists with the same `status`, `clock_in`,
  `clock_out`, `closed_by` and scan columns, plus `voided_at`/`voided_by`/`void_request_id` all set and `revision` + 1
  (the three are all NULL or all set; a voided row is never `OPEN`); `attendance_corrections` and
  `attendance_exceptions` rows are byte-for-byte unchanged; after the restore the three marks are NULL, `revision` + 1,
  and the VOID request row is unchanged; audit actions `attendance_session.voided` / `attendance_session.restored`;
  no new attendance event is published (26a's `AttendanceChangeDecided` carries the notice). Voided rows are skipped by
  the correction's neighbour read, the clock-in break-return check and the worker's not-clocked-in and
  break-not-returned reads (`voided_at IS NULL`). Restore vs a concurrent void approval, and void vs a concurrent
  correction: exactly one commits. RLS: a `void_request_id` of another company cannot be referenced.
- Sources: `docs/specs/046-staff-void-attendance-session/spec.md` (+ `contracts/void-restore-kinds-api.md`),
  `apps/api/src/modules/staff/domain/attendance-void.ts`,
  `apps/api/src/modules/staff/persistence/{void-session-kind,restore-session-kind,void-session-writes}.ts`,
  `apps/api/src/modules/staff/domain/attendance-correction.ts`,
  `apps/worker/src/modules/staff/persistence/{not-clocked-in,break-not-returned}.transactions.ts`,
  `packages/contracts/src/staff/attendance-change-request.ts`, `packages/i18n/src/attendance-change.ts`,
  `apps/api/src/shared/errors.ts`, migrations `0120`–`0123`.
