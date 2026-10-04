# 23 · Request leave — طلب إجازة

**Status / الحالة:** shipped in #95 (PR 17, merged). Local only (admin not deployed, issue #54). The manager screen is
in the admin employee page. The employee's own request is **API only** today: it works from the paired POS kiosk
staff session ([08](08-staff-login-pos.md)) or from the personal phone session ([22](22-personal-phone-passkey.md)),
but the staff-app screen for it comes in PR 57b. OTP sending is OFF, so the personal session exists only in
tests/local seams. Approving or rejecting the request is [24](24-decide-leave.md); there is no leave balance and no
deduction in Phase 1. Your decisions of 2026-10-04 apply (15-minute steps, 90-day limit, overlap refusal,
manager backdating, own requests never in the past).

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md), then `pnpm db:migrate` and `pnpm db:seed` for the leave tables and permission
  catalog. The company's `staff` feature must be enabled.
- Signed in to the admin with a company and business selected ([01](01-admin-sign-in-and-totp.md),
  [02](02-admin-workspace-selector.md)). The manager is an **Owner**, **General Manager**, **Business Manager** or
  **Branch Manager** whose scope covers the employee's branch: they get `create:leave:branch`, `read:leave:branch` and
  `cancel:leave:branch` by default ([20](20-role-default-permissions.md)). Every human role also has the own-leave
  codes, but they only work for a user who is linked to an eligible employee.
- A synthetic employee ([13](13-create-employee.md)) attached to a branch, with a hire date in the past and no contract
  end. Prepare a second branch in the same business, a second employee, and an employee with no relation to the
  manager's branch for the hidden-employee check. For the own-request checks, link one employee to a synthetic user
  and prepare either a paired kiosk session or the personal-session test seam from [22](22-personal-phone-passkey.md).
- Use placeholder IDs and synthetic dates only. Dates below are examples; pick a future week for new requests and a
  past date for the backdating check.

## العربي

1. من القائمة الجانبية دوس **الموظفون** ← `/staff` ← **تعديل** على الموظف. في آخر لوحة **تعديل الموظف** هتلاقي قسم
   **طلبات الإجازة**. لو مفيش طلبات: **لا توجد طلبات إجازة**. الفورم **طلب إجازة نيابة عن الموظف** بيظهر بس لو
   عندك صلاحية الطلب على فرع واحد على الأقل من فروع الموظف؛ لو الموظف مش مرتبط بفرع في نطاقك مكان القسم
   بتظهر **المسار غير موجود** (نفس رد الموظف المجهول). نفس القسم متاح على `/staff/<employeeId>/leave`.
2. **أيام كاملة:** اختار **الفرع** (بيظهر جنبه المنطقة الزمنية، وتحته **الأوقات حسب المنطقة الزمنية للفرع المختار**)،
   و**الوحدة** = **أيام كاملة**، اكتب **من تاريخ** و**حتى تاريخ** (اليومين محسوبين)، و**نوع الإجازة** = **سنوية**
   ← **إرسال الطلب** ← **تم حفظ طلب الإجازة**. الطلب يظهر في الجدول بحالة **معلقة**، وتحته الفترة والمنطقة الزمنية.
3. **جزء من يوم:** غيّر **الوحدة** إلى **جزء من يوم** ← حقول **التاريخ** و**وقت البداية** و**وقت النهاية**. الأوقات على
   خطوات 15 دقيقة (:00 و:15 و:30 و:45) بتوقيت الفرع. جرّب `09:10` ← **يجب أن تكون بداية الإجازة ونهايتها على خطوات ١٥
   دقيقة بتوقيت الفرع المحلي.** جرّب نهاية قبل البداية ← **تواريخ الإجازة أو أوقاتها غير صحيحة.** وقت صحيح مثل
   `09:00` إلى `13:15` ← ينجح.
4. **الحد الأقصى 90 يوم:** من تاريخ ومعاه حتى تاريخ بعد 89 يوم (الإجمالي 90 يوم بالطرفين) ← ينجح. حتى تاريخ بعده بيوم
   (91 يوم) ← **لا يمكن أن تتجاوز الإجازة الكاملة ٩٠ يوماً شاملة يومي البداية والنهاية.** الحد على الأيام التقويمية
   وليس على الساعات.
5. **الملاحظة:** نوع **أخرى** من غير **ملاحظة** ← **أدخل ملاحظة من ١ إلى ٥٠٠ حرف؛ نوع أخرى يحتاج ملاحظة.** الأنواع
   التانية (**سنوية** و**مرضية** و**بدون أجر**) الملاحظة اختيارية. الملاحظة بتتقص من الفراغات وحدها الأقصى 500 حرف،
   وما بتتسجلش في سجل التدقيق.
6. **التداخل:** اطلب إجازة تانية تتقاطع مع طلب **معلق** أو **معتمدة** للموظف نفسه، حتى لو في فرع تاني ←
   **يتداخل الطلب مع إجازة معلقة أو معتمدة.** (`LEAVE_OVERLAP`، 409). فترة تبدأ بالظبط لما التانية تنتهي ما بتتداخلش
   وتنجح. طلب ملغي أو مرفوض ما بيحجزش الفترة.
7. **الماضي للمدير:** المدير يقدر يسجل إجازة بتاريخ فات (تسجيل بأثر رجعي) ← ينجح. الموظف نفسه لأ: طلبه لازم يبدأ
   النهارده أو بعده بتوقيت الفرع (الخطوة 10).
8. **الإلغاء:** في صف الطلب **المعلق** دوس **إلغاء الطلب** ← **إلغاء طلب الإجازة المعلق؟** ← أكّد ← **تم إلغاء طلب
   الإجازة** والحالة **ملغاة**. الفترة بتتحرر فتقدر تطلبها تاني. الطلب **المعتمد** أو **المرفوض** أو
   **الملغي** ما فيهوش زر إلغاء؛ لو اتحاول من الـ API ← **يمكن البت في الإجازات المعلقة أو إلغاؤها فقط.**
   (`LEAVE_NOT_PENDING`، 409). تبويب قديم بنسخة طلب اتغيّرت ← **تغير طلب الإجازة. أعد التحميل وحاول مرة أخرى.**
   (`LEAVE_REVISION_CONFLICT`، 409). الإلغاء مرة واحدة بس.
9. **مدير في نطاقه فقط:** مدير فرع يطلب لموظف مربوط بفرعه ← ينجح؛ لموظف مربوط بفرع تاني بس، أو مجهول، أو من شركة تانية
   ← نفس الرد **المسار غير موجود** (`NOT_FOUND`، 404) بنفس الجسم تمامًا. موظف خارج فترة عقده أو فترة ارتباطه بالفرع
   (ولو يوم واحد من الفترة المطلوبة) ← **الموظف غير مؤهل في هذا الفرع خلال الفترة كاملة.** (`LEAVE_EMPLOYEE_INELIGIBLE`،
   400). فرع اتعطل: ما ينفعش طلب جديد عليه، لكن طلباته المعلقة تفضل ظاهرة وتتلغى من مدير نطاقه لسه بيغطيه.
10. **الموظف بنفسه (API فقط):** من جلسة كشك الكاشير المربوط، أو الجلسة الشخصية، الـ agent يبعت الطلب لنفسه؛ السيرفر
    يحدد الموظف من الجلسة، وأي `employee_id` يتبعت ← مرفوض. الجلسة الشخصية لازم تبعت `branch_id` في الاستعلام؛
    الكشك بيستخدم فرع الجهاز المربوط. إجازة بتبدأ قبل النهارده بتوقيت الفرع ← **طلب الإجازة الذاتي لا يبدأ قبل اليوم
    بتوقيت الفرع.** (`LEAVE_PAST_OWN_FORBIDDEN`، 400). كل الأدوار البشرية الـ 13 عندها صلاحيات الإجازة الذاتية، بشرط
    إن المستخدم مربوط بموظف مؤهل. موظف يلغي طلبه **المعلق** بنفسه فقط، والمدير في نطاقه يلغي أي طلب معلق.
    قائمة الموظف (`GET`) بتعرض إجازاته هو بس، في كل فروع النشاط، ما بتعرضش موظف تاني.
11. **التوقيت المحلي الملتبس:** وقت محلي في فجوة التوقيت الصيفي أو مكرر فيه ← **الوقت المحلي لا يحدد لحظة واحدة في
    المنطقة الزمنية للفرع.** (`LEAVE_LOCAL_TIME_INVALID`، 400). مفيش بيانات رصيد إجازات ولا خصم في المرحلة دي.
12. **إعادة الإرسال:** نفس الطلب بنفس `Idempotency-Key` بيرجّع نفس الرد من غير طلب مكرر؛ نفس المفتاح بجسم تاني ←
    **تم استخدام مفتاح Idempotency-Key مع طلب مختلف**. من غير المفتاح ← **رأس Idempotency-Key مطلوب ويجب أن يكون من 1
    إلى 255 حرفاً مرئياً**. الشاشة تولّد المفتاح بنفسها؛ ما تعيدش الإرسال تلقائيًا لو النتيجة مش واضحة.

**ممنوع يحصل:**
- موظف يطلب أو يلغي إجازة لموظف تاني، أو يبعت `employee_id` من عنده، أو جلسة شخصية تستخدم صلاحيات إدارية يملكها نفس
  الشخص في جلسة تانية.
- طلب إجازة بدون ملاحظة لنوع **أخرى**، أو فترة كاملة أكتر من 90 يوم، أو وقت جزئي مش على خطوات 15 دقيقة.
- طلبين متداخلين (معلق/معتمد) لنفس الموظف يتحفظوا، ولا حتى بطلبين متزامنين؛ واحد بس ينجح.
- موظف يسجل إجازة تبدأ في الماضي؛ مدير يتمنع من التسجيل بأثر رجعي.
- رد يميّز موظف غير متاح عن موظف مجهول، أو يكشف أي حاجة عنه قبل ما تتفحص الأهلية والفترة.
- إلغاء طلب غير معلق، أو إلغاء بنسخة قديمة، أو إلغاء مكرر يكرر التدقيق.
- الإعلان عن شاشة الموظف لطلب الإجازة كأنها شغالة (PR 57b)، أو تخصم الإجازة من رصيد.

## English

1. Sidebar **Employees** → `/staff` → **Edit** on the employee. At the end of the **Edit employee** panel is a
   **Leave requests** section. With nothing yet: "No leave requests". The **Request leave on behalf** form only
   appears when you may request in at least one of the employee's branches; if the employee has no branch in your
   scope the section shows "Not found" instead (the same answer as for an unknown employee). The same section is at
   `/staff/<employeeId>/leave`.
2. **Full days:** choose **Branch** (its timezone is shown beside it, and "Times use the selected branch timezone"
   below), **Unit** = **Full days**, enter **From date** and **Through date** (both days count) and **Leave type** =
   **Annual** → **Submit request** → "Leave request saved". The request shows in the table as **Pending**, with its
   period and timezone.
3. **Part of a day:** set **Unit** to **Part of a day** → **Date**, **Start time** and **End time**. Times are on
   15-minute steps (:00, :15, :30, :45) in the branch timezone. Try `09:10` → "Leave start and end times must use
   15-minute steps in branch local time." Try an end before the start → "Leave dates or times are invalid."
   A valid `09:00` to `13:15` succeeds.
4. **90-day limit:** a **From date** with a **Through date** 89 days later (90 days counting both ends) succeeds.
   One day more (91 days) → "Full-day leave cannot exceed 90 days, including the start and end dates." The limit is
   on civil days, not elapsed hours.
5. **Note:** type **Other** with no **Note** → "Provide a note of 1–500 characters; Other requires a note." The other
   types (**Annual**, **Sick**, **Unpaid**) have an optional note. The note is trimmed, at most 500 characters,
   and never copied into the audit log.
6. **Overlap:** request leave that intersects **Pending** or **Approved** leave of the same employee, even in another
   branch → "This request overlaps pending or approved leave." (`LEAVE_OVERLAP`, 409). A period that starts exactly where
   another ends does not overlap and succeeds. A cancelled or rejected request does not hold the period.
7. **Past dates for the manager:** a manager may record leave dated in the past (backdating) → succeeds. The
   employee may not (step 10).
8. **Cancel:** on a **Pending** row press **Cancel request** → "Cancel this pending request?" → confirm → "Leave request
   cancelled" and status **Cancelled**. The period is freed and can be requested again. An **Approved**, **Rejected**
   or **Cancelled** row has no cancel button; through the API → "Only pending leave can be decided or cancelled."
   (`LEAVE_NOT_PENDING`, 409). A stale tab with an older request version → "The leave request changed. Reload and try
   again." (`LEAVE_REVISION_CONFLICT`, 409). Cancellation happens once.
9. **A manager inside their scope only:** a Branch Manager requests for an employee attached to their branch →
   succeeds; for an employee attached only to another branch, an unknown one, or one from another company → the same
   "Not found" (`NOT_FOUND`, 404) with an identical body. An employee outside the contract or branch-attachment
   period (even for one day of the requested period) → "The employee is not eligible in this branch for the whole
   period." (`LEAVE_EMPLOYEE_INELIGIBLE`, 400). A deactivated branch takes no new requests, but its pending requests stay
   visible and a manager whose scope still covers that branch can cancel them.
10. **The employee, API only:** from the paired kiosk session or the personal session the agent submits the request for
    themselves; the server finds the employee from the session, and any supplied `employee_id` is refused.
    The personal session must send `branch_id` in the query; the kiosk uses the paired device's branch. Leave that starts
    before today in the branch timezone → "Own leave requests cannot start before today in the branch timezone."
    (`LEAVE_PAST_OWN_FORBIDDEN`, 400). All 13 human roles hold the own-leave codes, provided the user is linked to
    an eligible employee. An employee cancels only their own **Pending** request; a manager within scope cancels any
    pending one. The employee's list (`GET`) shows their own leave across all branches of the business and never
    another employee.
11. **Ambiguous local time:** a local time that falls in a daylight-saving gap or repeats → "The local time does not
    identify a unique instant in this branch timezone." (`LEAVE_LOCAL_TIME_INVALID`, 400). There is no leave balance
    and no deduction in this phase.
12. **Retries:** the same request with the same `Idempotency-Key` returns the same answer with no duplicate; the same
    key with another body → "This Idempotency-Key was already used with a different request". Without the key →
    "An Idempotency-Key header of 1–255 visible ASCII characters is required". The screen generates its own key; do not retry automatically when the outcome is unclear.

**Must NOT happen:**
- An employee requesting or cancelling another employee's leave, sending their own `employee_id`, or a personal session
  borrowing admin permissions the same person holds in another session.
- **Other** without a note, a full-day period over 90 days, or a partial time off the 15-minute steps being saved.
- Two overlapping pending/approved requests for one employee, even with simultaneous requests; exactly one wins.
- An employee recording leave that starts in the past; a manager being blocked from backdating.
- A response that tells an inaccessible employee from an unknown one, or reveals anything about them before the
  eligibility and period checks.
- Cancelling a non-pending request, cancelling with a stale version, or a repeated cancel writing a second audit entry.
- Presenting the employee's own leave screen as shipped (PR 57b), or deducting from a balance.

## For an agent

- Admin: `http://localhost:3001/staff`; press **Edit**, then use the section **Leave requests**. Fields by id:
  `#leave-branch`, `#leave-kind`, `#leave-from`, `#leave-to`, `#leave-date`, `#leave-start`, `#leave-end`,
  `#leave-type`, `#leave-note`; buttons by exact text (**Submit request**, **Cancel request**) and the native
  confirmation dialog. Success is `role=status`; failure is `role=alert`. History is paginated 20 per page with **Next
  page** / **Previous page**.
- Manager API with session cookie and `x-company-id`; writes need `Idempotency-Key`:

  ```http
  POST /v1/businesses/<BUSINESS_ID>/employees/<EMPLOYEE_ID>/leave-requests
  Content-Type: application/json
  x-company-id: <COMPANY_ID>
  Idempotency-Key: <UNIQUE_KEY>

  { "branch_id": "<BRANCH_ID>", "kind": "FULL_DAY", "from": "<YYYY-MM-DD>", "to": "<YYYY-MM-DD>", "type": "ANNUAL" }
  ```

  Partial: `{ "branch_id": "...", "kind": "PARTIAL", "date": "...", "start": "09:00", "end": "13:15", "type": "SICK" }`;
  `note` optional (required for `OTHER`, trimmed 1–500). Success is 201 with the leave record (`status: "PENDING"`,
  `from`, `to`, `start`, `end`, `timezone`, `starts_at`, `ends_at` as half-open UTC, `revision`). History:
  `GET .../leave-requests?limit=20&cursor=<CURSOR>` → `{ items, next_cursor, request_branch_ids }`.
  Cancel: `POST .../leave-requests/<LEAVE_ID>/cancel` with `{ "expected_revision": <REVISION> }` → 200.
  Pending inbox: `GET /v1/businesses/<BUSINESS_ID>/leave-requests` ([24](24-decide-leave.md)).
- Own API (never with a manager session): `POST /v1/staff/me/leave-requests` (body has no employee id),
  `GET /v1/staff/me/leave-requests`, `POST /v1/staff/me/leave-requests/<LEAVE_ID>/cancel`. Kiosk: the paired device
  credential plus kiosk staff session with the exact configured POS `Origin`. Personal: the personal cookie and exact
  origin, plus `?branch_id=<OWN_BRANCH_ID>` on every call. Schema validation precedes lookup, so identical invalid
  bodies give identical 400 envelopes for unknown and inaccessible identities.
- Assertions: the stored interval is half-open in UTC with the branch timezone captured on the request; each request
  samples the clock once; an idempotent replay creates one audit entry and one `LeaveRequested` event; a rolled-back
  request leaves no audit, event or key. Concurrent overlapping writes commit at most one. An owner's historical own-leave
  DENY has no effect, while the same DENY refuses a non-owner. Audit/event snapshots exclude the note.
  Sources: `docs/specs/023-staff-request-leave/spec.md`, `docs/adr/0026-employee-own-leave-access.md`,
  `apps/admin/src/staff/ui/{employee-leave-section,leave-request-form,leave-period-fields}.tsx`,
  `apps/api/src/modules/staff/http/{employee-leave,own-leave}.controller.ts`, `packages/contracts/src/staff/leave.ts`,
  `packages/i18n/src/{leave-catalog,ar,en}.ts` and `apps/api/src/shared/errors.ts`.
