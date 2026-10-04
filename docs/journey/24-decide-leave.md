# 24 · Decide leave — اعتماد الإجازات

**Status / الحالة:** shipped in #98 (PR 18, merged). Local only (admin not deployed, issue #54). The manager screens
exist: the admin **Leave approvals** inbox and the leave section of the employee page. What the employee sees of the
decision is **API only** today (the staff-app screen comes in PR 57b). **No notification is sent** when a request is
approved, rejected or revoked: WhatsApp and email are off, and the in-app notification inbox does not serve the staff
sessions yet (your decision of 2026-10-04); the employee finds the result by reading their own list. This builds on
[23](23-request-leave.md). There is still no leave balance and no attendance correction after a leave starts.

**Before you start / قبل ما تبدأ:**
- Everything in [23](23-request-leave.md), plus `pnpm db:migrate` and `pnpm db:seed` for the decision columns and the
  new permission defaults.
- Pending requests from [23](23-request-leave.md): at least two for different employees, one in each of two branches
  of the business, and one **Approved** request whose start is in the future (approve one first to create it).
  Prepare an approved request that starts in the past or today for the "already started" check; use a controlled
  clock or a fixture row.
- Approvers by default: **Owner**, **General Manager**, **Business Manager** and **Branch Manager**, each inside their
  own scope. Any other human role needs a personal **Allow** for **Decide branch leave** and
  **Revoke approved branch leave before it starts**, and a separate **Read branch leave** allow to open the inbox
  ([12](12-permissions-screen.md)). A paired Device never holds these codes, even from an old Allow.
- An approver who is also an employee, linked to a synthetic user, for the self-decision check; a second membership for
  the same user in another branch if you want the "another membership" case. Synthetic data only.

## العربي

1. من القائمة الجانبية دوس **اعتماد الإجازات** ← `/leave`، وتظهر شاشة **اعتماد الإجازات** بالطلبات **المعلقة** في
   الفروع اللي صلاحيتك بتغطيها بس. لو ما اخترتش نشاط: **اختر النشاط**. لو مفيش طلبات: **لا توجد طلبات إجازة**.
   الجدول فيه **الموظف** و**التاريخ** و**نوع الإجازة** و**الحالة** و**سبب القرار** و**القرار** (أزرار **موافقة** و**رفض**).
   للقوائم الطويلة استخدم **الصفحة التالية** و**الصفحة السابقة**.
2. **التصفية:** **الفرع** (الافتراضي **كل الفروع المسموحة**)، و**من تاريخ** و**حتى تاريخ** ← **تطبيق التصفية**. الفلتر
   بيعرض أي إجازة فترتها بتتقاطع مع المدى، بالتواريخ المحلية المسجلة في الطلب (من غير ما المتصفح يعيد تفسير التوقيت).
   التصفية بتتطبق قبل الترقيم. مدى معكوس (`من` بعد `حتى`) ← **تواريخ الإجازة أو أوقاتها غير صحيحة.**
3. **الموافقة:** دوس **موافقة** على طلب ← تحت الجدول اسم الموظف · الفترة، ونموذج **موافقة** فيه **سبب الموافقة اختياري.**
   وحقل **السبب** ← دوس **موافقة** ← **تم حفظ قرار الإجازة**. الطلب يختفي من صندوق المعلقة؛ افتح الموظف من
   **الموظفون** ← **تعديل** وهتلاقيه **معتمدة** مع **سبب القرار**. السبب لو كتبته لازم 1–500 حرف بعد القص.
4. **الرفض:** دوس **رفض** ← **السبب مطلوب، من ١ إلى ٥٠٠ حرف.** اتركه فاضي ← **أدخل سبباً من ١ إلى ٥٠٠ حرف؛ الرفض وسحب
   الموافقة يحتاجان سبباً.** اكتب سبب (مثلاً سبب تجريبي) ← **رفض** ← **تم حفظ قرار الإجازة**، والحالة **مرفوضة** والسبب
   ظاهر تحت **سبب القرار**. **إغلاق** يقفل النموذج من غير حفظ.
5. **لا أحد يقرر في إجازته هو:** أي موظف مربوط بمستخدمك ما ظهرش له أزرار **موافقة** و**رفض** في صفه. من الـ API، قرار
   (أو سحب) على إجازتك أنت ← **لا يمكنك البت في إجازتك أو سحب موافقتها، حتى عبر عضوية أخرى.**
   (`LEAVE_SELF_DECISION_FORBIDDEN`، 403). نفس الرفض لو غيرك هو اللي سجّلها نيابة عنك، ولو عندك عضوية تانية أقوى أو
   كنت صاحب الشركة. المقارنة على المستخدم الفعلي مش على العضوية، وبتحصل قبل أي إعادة إرسال محفوظة.
6. **التداخل مع إجازة معتمدة:** ما ينفعش توافق على طلب بيتقاطع مع إجازة **معتمدة** تانية لنفس الموظف، حتى في فرع
   تاني ← **الموافقة تتداخل مع طلب إجازة معتمد آخر.** (`LEAVE_APPROVED_OVERLAP`، 409). فترة تبدأ لما التانية تنتهي ما
   بتتداخلش.
7. **سحب الموافقة:** من **الموظفون** ← **تعديل** على الموظف، في **طلبات الإجازة** صف **معتمدة** لسه ما بدأش بيظهر
   فيه **سحب الموافقة** ← النموذج فيه حقل **سبب سحب الموافقة** (إلزامي) وزرار **سحب الموافقة** و**إغلاق** ← اكتب
   السبب ← **سحب الموافقة** ← **تم سحب موافقة الإجازة**. الحالة تتحول لـ **سُحبت الموافقة** (محفوظة داخليًا كملغاة)،
   وتحت **سبب القرار** يظهر قرار الموافقة الأصلي وبجانبه **سبب سحب الموافقة:** والسبب. بدون سبب ← **أدخل سبباً من ١
   إلى ٥٠٠ حرف؛ الرفض وسحب الموافقة يحتاجان سبباً.**
8. **قبل البداية بس:** السحب مسموح قبل لحظة بداية الإجازة بالضبط. عند بدايتها أو بعدها (الزر ما يظهرش) ومن الـ API ←
   **لا يمكن سحب موافقة الإجازة عند بدايتها أو بعدها.** (`LEAVE_ALREADY_STARTED`، 409). إجازة مش **معتمدة** (معلقة أو
   مرفوضة أو ملغاة) ← **يمكن سحب موافقة الإجازة المعتمدة فقط.** (`LEAVE_NOT_APPROVED`، 409). مفيش تصحيح بعد البداية؛
   ده شغل تصحيح الحضور في مرحلة لاحقة.
9. **الأزرار بحسب الحالة:** الطلب **المعلق** يظهر له **إلغاء الطلب** (من نطاق الإلغاء) و**موافقة**/**رفض** (لمن عنده
   صلاحية البت). طلب اتقرر فيه أو اتلغى ما فيهوش **موافقة** ولا **رفض**. قرار على طلب مش معلق ← **يمكن البت في
   الإجازات المعلقة أو إلغاؤها فقط.** (`LEAVE_NOT_PENDING`، 409). فتحت نفس الطلب في تبويبين وقررت في واحد ← التاني
   يتبلغ بـ **تغير طلب الإجازة. أعد التحميل وحاول مرة أخرى.** (`LEAVE_REVISION_CONFLICT`، 409) أو `LEAVE_NOT_PENDING`؛
   إلغاء وقرار في نفس اللحظة: واحد بس ينجح.
10. **النطاق:** مدير فرع يشوف ويقرر في طلبات فرعه بس؛ مدير نشاط في نشاطه؛ المدير العام وصاحب الشركة في الشركة. طلب
    موظف خارج نطاقك أو مجهول (من الـ API، بجسم صحيح أو غير صحيح) ← نفس **المسار غير موجود** (`NOT_FOUND`، 404). دور
    غير الأربعة (مثل **مشاهد**) من غير **سماح** صريح ما يشوفش أزرار القرار؛ ومعاه **سماح** بالبت لازم كمان **عرض
    إجازات الفرع** عشان الشاشة تفتح. الـ Device، والجلسة الشخصية، وجلسة الكاشير ← كلهم ممنوعين من القرار والسحب.
11. **اللي بيشوفه الموظف (API فقط):** من جلسته (كشك الكاشير أو الشخصية، ومن غير صلاحيات إدارية)
    `GET /v1/staff/me/leave-requests` بيرجّع إجازاته هو بس، فيها `status` و`decision_reason` و`rejection_reason` (للمرفوضة)
    وبيانات السحب (`revoked_by` و`revoked_at` و`revocation_reason`). `can_decide` و`can_revoke` و`can_cancel` للموظف دايمًا
    `false` على قرارات الإدارة، وإلغاء طلبه **المعلق** بنفسه بس. مفيش إشعار: الموظف بيعرف بالقراءة، ومفيش شاشة له لسه.
12. **إعادة الإرسال والتدقيق:** كل قرار أو سحب بيتكتب في سجل التدقيق مع مين قرر وإمتى، وبيطلع حدث `LeaveApproved` أو
    `LeaveRejected` أو `LeaveRevoked` في نفس المعاملة؛ نفس الطلب بنفس `Idempotency-Key` بيرجّع نفس الرد من غير تكرار.
    الأسباب الحرة ما بتتنسخش لسجل التدقيق ولا للحدث، وبتظهر في ردود القراءة بس.

**ممنوع يحصل:**
- شخص يوافق أو يرفض أو يسحب موافقة إجازته هو، حتى بعضوية تانية أو لو غيره سجّلها نيابة عنه، أو صاحب الشركة.
- رفض أو سحب موافقة من غير سبب، أو سبب أطول من 500 حرف.
- موافقة تتقاطع مع إجازة معتمدة تانية لنفس الموظف.
- سحب موافقة إجازة بدأت فعلًا (عند البداية أو بعدها)، أو سحب إجازة مش معتمدة.
- قرار على طلب مش معلق، أو بنسخة قديمة، أو قراران متزامنان ينجحوا مع بعض.
- رد يفرّق بين طلب خارج نطاقك وطلب مجهول، أو دور آخر/Device/جلسة شخصية/كشك يقرر أو يسحب.
- ادعاء إن الموظف بيتبلّغ بالقرار (مفيش إشعار)، أو الموافقة تغيّر رصيد أو أجر.

## English

1. Sidebar **Leave approvals** → `/leave`, showing **Leave approvals** with the **Pending** requests of the branches your
   permissions cover. With no business chosen: "Choose a business". With none: "No leave requests". The table has
   **Employee**, **Date**, **Leave type**, **Status**, **Decision reason** and **Decision** (the **Approve** and
   **Reject** buttons). Page through long lists with **Next page** and **Previous page**.
2. **Filters:** **Branch** (default **All authorized branches**), **From date** and **Through date** →
   **Apply filters**. The filter shows any leave whose period intersects the range, using the local dates stored on the
   request (the browser never reinterprets the timezone). Filters apply before pagination. A reversed range (`From`
   after `Through`) → "Leave dates or times are invalid."
3. **Approve:** press **Approve** on a request → under the table the employee name · period and an **Approve** form
   with "An approval reason is optional." and a **Reason** field → press **Approve** → "Leave decision saved". The
   request leaves the pending inbox; open the employee from **Employees** → **Edit** to see it **Approved** with the
   **Decision reason**. A reason, if given, must be 1–500 characters after trimming.
4. **Reject:** press **Reject** → "A reason of 1–500 characters is required." Leave it empty → "Provide a reason of
   1–500 characters; rejection and revocation require a reason." Type a synthetic reason → **Reject** → "Leave decision
   saved", status **Rejected** and the reason under **Decision reason**. **Close** dismisses the form without saving.
5. **Nobody decides their own leave:** an employee linked to your user has no **Approve** or **Reject** buttons on
   their row. Through the API, a decision (or revocation) on your own leave → "You cannot decide or revoke your own
   leave, including through another membership." (`LEAVE_SELF_DECISION_FORBIDDEN`, 403). The same refusal applies when
   someone else requested it on your behalf, when you hold a stronger second membership, and for an Owner. The
   comparison is on the actual user, not the membership, and happens before any stored replay.
6. **Overlap with approved leave:** you cannot approve a request that intersects another **Approved** leave of the same
   employee, even in another branch → "Approval would overlap another approved leave request."
   (`LEAVE_APPROVED_OVERLAP`, 409). A period starting where the other ends does not overlap.
7. **Revoke an approval:** from **Employees** → **Edit** on the employee, in **Leave requests** an **Approved** row that
   has not started shows **Revoke approval** → the form has a required **Revocation reason**, a **Revoke approval**
   button and **Close** → enter the reason → **Revoke approval** → "Leave approval revoked". The status becomes
   **Approval revoked** (stored internally as cancelled), and under **Decision reason** the original approval shows
   with **Revocation reason:** and the reason beside it. Without a reason → "Provide a reason of 1–500 characters;
   rejection and revocation require a reason."
8. **Before it starts only:** revocation is allowed strictly before the leave's start instant. At or after the start
   (the button is not shown) and through the API → "Leave approval cannot be revoked at or after its start."
   (`LEAVE_ALREADY_STARTED`, 409). Leave that is not **Approved** (pending, rejected or cancelled) → "Only approved leave
   can be revoked." (`LEAVE_NOT_APPROVED`, 409). There is no correction after the start; that belongs to attendance
   correction in a later PR.
9. **Buttons follow the status:** a **Pending** request shows **Cancel request** (within cancel scope) and
   **Approve**/**Reject** (for whoever may decide). A decided or cancelled request has no **Approve** or **Reject**;
   a decision on a non-pending request → "Only pending leave can be decided or cancelled." (`LEAVE_NOT_PENDING`, 409).
   Open the same request in two tabs and decide in one → the other gets "The leave request changed. Reload and try
   again." (`LEAVE_REVISION_CONFLICT`, 409) or `LEAVE_NOT_PENDING`; a cancel and a decision at the same moment: only
   one succeeds.
10. **Scope:** a Branch Manager sees and decides only their branch's requests; a Business Manager their business;
    General Manager and Owner the company. An employee's request outside your scope, or an unknown one (through the
    API, with a valid or invalid body), → the same "Not found" (`NOT_FOUND`, 404). A role other than the four (for example
    **Viewer**) without an explicit **Allow** sees no decision buttons; a user with the decide **Allow** also needs
    **Read branch leave** for the screen to open. A Device, a personal session and a kiosk session are all refused for
    decide and revoke.
11. **What the employee sees (API only):** from their own session (kiosk or personal, no admin permissions)
    `GET /v1/staff/me/leave-requests` returns only their own leave, including `status`, `decision_reason`,
    `rejection_reason` (for rejected leave) and revocation data (`revoked_by`, `revoked_at`, `revocation_reason`).
    `can_decide`, `can_revoke` are always `false` for them, and they can cancel only their own **Pending** request.
    There is no notification: the employee learns the outcome by reading, and there is no screen for them yet.
12. **Retries and audit:** every decision or revocation is audited with who and when and emits `LeaveApproved`,
    `LeaveRejected` or `LeaveRevoked` in the same transaction; the same request with the same `Idempotency-Key` returns the
    same answer without repeating. Free-text reasons are never copied into the audit log or the event; they appear in read
    responses only.

**Must NOT happen:**
- Anyone approving, rejecting or revoking their own leave, through another membership, when someone else requested it on
  their behalf, or as Owner.
- A rejection or revocation with no reason, or a reason over 500 characters.
- An approval that intersects another approved leave of the same employee.
- Revoking leave that has already started (at or after its start), or revoking leave that is not approved.
- A decision on a non-pending request, with a stale version, or two simultaneous decisions both succeeding.
- A response that distinguishes an out-of-scope request from an unknown one, or another role, a Device, a personal
  session or a kiosk session deciding or revoking.
- Claiming the employee is notified (there is no notification), or an approval changing a balance or pay.

## For an agent

- Admin: `http://localhost:3001/leave` (inbox) and `http://localhost:3001/staff` → **Edit** (employee history).
  Filters by id: `#inbox-branch`, `#inbox-from`, `#inbox-to`, **Apply filters**; decision field `#leave-decision-reason`;
  revocation field `#leave-revocation-reason`; buttons by exact text (**Approve**, **Reject**, **Revoke approval**,
  **Close**). Success is `role=status`; failure is `role=alert`. Assert the **Approval revoked** status and the
  **Revocation reason:** line after a revocation.
- Inbox: `GET /v1/businesses/<BUSINESS_ID>/leave-requests?branch_id=<BRANCH_ID>&from=<YYYY-MM-DD>&to=<YYYY-MM-DD>&limit=20&cursor=<CURSOR>`
  with session cookie and `x-company-id`; pending only, `{ items, next_cursor, request_branch_ids }`, each item with
  `can_cancel`, `can_decide`, `can_revoke`. A reversed range is a validation error. The filters apply before the cursor.
- Decide and revoke (selected-company admin authentication, `Idempotency-Key` required, 200 with the full leave record):

  ```http
  POST /v1/businesses/<BUSINESS_ID>/employees/<EMPLOYEE_ID>/leave-requests/<LEAVE_ID>/decide
  x-company-id: <COMPANY_ID>
  Idempotency-Key: <UNIQUE_KEY>
  Content-Type: application/json

  { "decision": "REJECTED", "expected_revision": <REVISION>, "reason": "<SYNTHETIC_REASON>" }
  ```

  `decision` is `APPROVED` (reason optional) or `REJECTED` (reason required); `.../revoke` takes
  `{ "expected_revision": <REVISION>, "reason": "<SYNTHETIC_REASON>" }`. Reasons are trimmed 1–500 characters.
  Scoped authorization and the employee relationship are proven before any other diagnostic; invalid and valid bodies
  for unknown or inaccessible ids return identical envelopes.
- Assertions: a revoked approval has `status: "CANCELLED"`, `revoked_by`/`revoked_at`/`revocation_reason` set,
  the original `decided_by`/`decision_reason` kept, and `cancelled_by`/`cancelled_at` null; a cancelled pending
  request has `cancelled_by`/`cancelled_at` and no decision or revocation. `rejection_reason` equals `decision_reason`
  for rejections. Revocation before `starts_at` succeeds; at or after it → `LEAVE_ALREADY_STARTED`. One injected clock
  instant (sampled after lock waits) drives authority, feature expiry, timestamps and the start comparison. Replay once,
  a changed body/key conflict and rollback leave exactly one or zero audit/event/idempotency effects. Decide-versus-cancel
  and decide-versus-decide races commit one transition. Device ALLOWs for the decide/revoke codes →
  `PERMISSION_ROLE_FORBIDDEN`; historical ones grant nothing. A personal or kiosk credential on a manager route is refused.
  Sources: `docs/specs/025-staff-decide-leave/spec.md`, `docs/adr/0030-leave-decisions-and-revocation.md`,
  `apps/admin/src/staff/{pages/leave-inbox-page,ui/leave-inbox-filters,ui/leave-decision-form,ui/leave-revocation-form,ui/leave-decision-columns}.tsx`,
  `apps/api/src/modules/staff/http/{leave-decisions,leave-inbox}.controller.ts`,
  `packages/contracts/src/staff/leave-decision.ts`, `packages/i18n/src/{leave-catalog,ar,en}.ts` and
  `apps/api/src/shared/errors.ts`.
