# 31 · Attendance change requests — طلبات تعديل الحضور (طلب وموافقة)

**Status / الحالة:** shipped in #148 (PR 26a, merge commit `525e1000`). **API only**: there is no admin screen for
requests or decisions until PR 27 (ACR-Q6), and the admin itself is not deployed (issue #54), so the only thing you
see in the admin is the **bell** ([04](04-admin-notifications-bell.md)) when you run it locally. The API reaches
staging with the next release. This journey is the envelope shared by three kinds: `VOID_SESSION` and
`RESTORE_SESSION` shipped in #152 ([33](33-void-and-restore-attendance-day.md)); `ADD_SESSION` is PR #153, still open
([32](32-add-manual-attendance-day.md)). Until #153 merges, an `ADD_SESSION` request is refused with
`ATTENDANCE_CHANGE_KIND_UNAVAILABLE`. The ordinary time correction (PR 26, #132) is unchanged and still applies at
once. Attendance never touches commission. Your decisions of 2026-10-10 (ACR-Q1 to ACR-Q23, with ACR-Q4 and ACR-Q21
changed to Abu Salem's pick) apply: [owner-questions.ar.md](../specs/044-staff-attendance-change-requests/owner-questions.ar.md).

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md), then `pnpm db:migrate` (the `attendance_change_requests` table, its RLS and
  the two new permissions) and `pnpm db:seed`. API, worker (for the bell) and admin running; the company's `staff`
  feature enabled.
- One business with two branches, Salmiya and Hawalli. Synthetic employees: ريم (Reem) attached to Salmiya, with at
  least one **closed** attendance day ([26](26-clock-attendance.md) or [30](30-employee-cards-and-clock-by-card.md)),
  so you have a `session_id` to void.
- Synthetic users, each with their own session cookie:
  - **Owner** (holds `decide:attendance-change:company` by default).
  - **Branch Manager** of Salmiya, also linked to her own employee record (for the self check).
  - **Branch Manager** of Hawalli (for the scope check).
  - **General Manager**, also linked to his own employee record (for the delegate checks).
- Who may **request** (`request:attendance-change:branch`, "طلب تعديل حضور" / "Request attendance change"): by default
  Owner, General Manager, Business Manager and Branch Manager (on their own branch). Who may **decide**
  (`decide:attendance-change:company`, "الموافقة على طلبات تعديل الحضور ورفضها" / "Approve or reject attendance change
  requests"): the Owner only, unless the Owner grants it. A paired Device never holds either.
- Synthetic reasons only. Every write needs `Idempotency-Key` and `x-company-id`.

## العربي

1. **مديرة الفرع تقدّم الطلب:** مديرة فرع السالمية تبعت طلب إلغاء يوم لريم (`VOID_SESSION`، الشكل في
   [33](33-void-and-restore-attendance-day.md)) ومعاه سبب ← **201** والطلب `PENDING`، و`requested_by` هي، و`revision` = 0.
   **الحضور ما بيتغيرش خالص** لحد الموافقة. بيتكتب سطر تدقيق `attendance_change.requested`.
2. **الجرس عند اللي يوافق:** خلال دقيقة، جرس صاحب الشركة (وأي حد تاني معاه صلاحية الموافقة في النطاق) يظهر عليه
   إشعار: **طلب إلغاء يوم حضور لـ ريم مستني موافقتك**. اللي قدّم الطلب ما بيوصلوش الإشعار ده، وريم نفسها ما بيوصلهاش حاجة.
3. **قائمة الطلبات:** صاحب الشركة يجيب الطلبات المستنية (`status=PENDING`) ← طلبات النشاط كله، الأحدث الأول، وفي كل
   واحد الموظفة والفرع والنوع والسبب واللي طلب وإمتى، و`can_decide` = `true`. مديرة السالمية تشوف طلبات فرعها بس،
   و`can_decide` = `false`، و`can_cancel` = `true` على طلباتها هي المستنية بس.
4. **الموافقة:** صاحب الشركة يوافق بالـ `revision` الحالي (السبب اختياري) ← **200**، والطلب `APPROVED` ومعاه
   `decided_by` و`decided_at`، و`revision` = 1، والتغيير بيتطبق في نفس المعاملة (الرد فيه `effect.session`). سطر تدقيق
   `attendance_change.approved`. جرس مديرة السالمية: **إلغاء يوم حضور لـ ريم: تمت الموافقة. السبب: -** (السبب `-` لو
   مفيش سبب، أو لو السبب أطول من 255 حرف أو فيه لينك أو رقم من 4 لـ 8 أرقام).
5. **الرفض بسبب:** على طلب تاني، صاحب الشركة يرفض من غير سبب ← **البيانات المرسلة غير صحيحة** (`VALIDATION_FAILED`،
   400). يرفض بسبب (من 1 لـ 500 حرف بعد شيل المسافات) ← **200** والطلب `REJECTED` و`decision_reason` = السبب، والحضور
   ما اتغيرش. الجرس عند المديرة: **إلغاء يوم حضور لـ ريم: تم الرفض. السبب:** والسبب.
6. **السحب:** مديرة السالمية تسحب طلبها وهو لسه مستني (`cancel` بالـ `revision`) ← **200** والطلب `CANCELLED` ومعاه
   `cancelled_by` و`cancelled_at`. ما فيش إشعار للسحب. أي حد غير اللي قدّم الطلب (حتى صاحب الشركة أو مدير تاني على
   نفس الفرع) يحاول يسحبه ← **المسار غير موجود** (`NOT_FOUND`، 404). مفيش تعديل للطلب: لو فيه غلط يتسحب ويتقدم جديد.
7. **الطلب مش مستني:** موافقة أو رفض أو سحب على طلب اتقرر أو اتسحب ← **الطلب لازم يكون مستني عشان يتقرر أو يتسحب.**
   (`ATTENDANCE_CHANGE_NOT_PENDING`، 409). `revision` قديم ← **الطلب اتغيّر. حدّث الصفحة وحاول تاني.**
   (`ATTENDANCE_CHANGE_REVISION_CONFLICT`، 409). موافقة وسحب في نفس اللحظة: واحد بس ينجح، والتاني ياخد `NOT_PENDING`.
8. **الدنيا اتغيرت قبل الموافقة (ACR-Q13):** لو قواعد النوع ما بقتش ماشية ساعة الموافقة (مثلاً اليوم اتصحح بعد
   الطلب) ← الموافقة بترجع خطأ النوع نفسه (مثلاً **تغيرت جلسة الحضور. أعد التحميل وحاول مرة أخرى.**،
   `ATTENDANCE_SESSION_REVISION_CONFLICT`، 409) والطلب **يفضل `PENDING`**، عشان ترفضه أو المديرة تسحبه. مفيش انتهاء
   لوحده: الطلب يستنى لحد ما حد يقرر.
9. **طلبين لنفس الحاجة:** طلب إلغاء تاني لنفس اليوم وفيه واحد مستني ← **فيه طلب مستني لنفس التغيير بالفعل.**
   (`ATTENDANCE_CHANGE_DUPLICATE_PENDING`، 409).
10. **محدش يطلب لنفسه:** مديرة السالمية تقدّم طلب على يومها هي ← **ماينفعش تطلب أو تقرر تعديل حضورك، ولا تقرر طلب إنت
    قدمته.** (`ATTENDANCE_CHANGE_SELF_FORBIDDEN`، 403). نفس الكلام للمدير العام ومدير النشاط. صاحب الشركة بس مستثنى.
11. **خطوة صاحب الشركة الواحدة (ACR-Q2):** صاحب الشركة يقدّم الطلب بنفسه ← **201** والطلب `APPROVED` على طول،
    `requested_by` = `decided_by` = صاحب الشركة، والتغيير اتطبق، وسطرين تدقيق (طلب + موافقة). مفيش إشعار لحد.
12. **صلاحية الموافقة لحد تاني (ACR-Q4):** المدير العام من غير الصلاحية يحاول يوافق ← **المسار غير موجود** (404)،
    والرد ما بيأكدش إن الطلب موجود. صاحب الشركة يديله **سماح** شخصي لـ **الموافقة على طلبات تعديل الحضور ورفضها**
    من شاشة الصلاحيات ([12](12-permissions-screen.md)) ← المدير العام بقى يوافق ويرفض على طلبات غيره، ويوصله الجرس
    زي صاحب الشركة.
13. **ضوابط التفويض:** المدير العام المفوَّض يقرر في طلب هو اللي قدّمه، أو طلب عن حضوره هو ← **ماينفعش تطلب أو تقرر
    تعديل حضورك، ولا تقرر طلب إنت قدمته.** (403). أي حد غير صاحب الشركة يدي أو يمنع أو يسحب صلاحية الطلب أو صلاحية
    الموافقة ← **صاحب الشركة فقط يقدر يمنح الصلاحية دي** (`PERMISSION_OWNER_ONLY`، 403). صاحب الشركة يقدر يقرر في طلب عن
    حضوره هو قدّمه مدير (ACR-Q22c).
14. **النطاق:** مديرة حولي تطلب لريم (موظفة السالمية)، أو أي حد يبعت `id` من نشاط أو شركة تانية ← **المسار غير موجود**
    (404)، بنفس الرد بالظبط. جهاز الكاشير المربوط ← **غير مسموح بهذا الإجراء** (`FORBIDDEN`، 403)؛ الجلسة الشخصية
    للموظف ← 401.
15. **اللي ريم ما تشوفهوش:** ريم مالهاش إشعار ولا جرس لأي طلب عن حضورها، لا عند التقديم ولا عند القرار. ولو ريم نفسها
    عندها عضوية إدارية وفتحت القائمة، الطلبات اللي عن حضورها **مش بتظهر لها** (إلا لو كانت صاحبة الشركة).
16. **إعادة الإرسال:** نفس الطلب بنفس `Idempotency-Key` ← نفس الرد من غير أي كتابة جديدة. نفس المفتاح بجسم تاني ←
    **تم استخدام مفتاح Idempotency-Key مع طلب مختلف** (`IDEMPOTENCY_KEY_REUSED`).

**ممنوع يحصل:**
- الحضور يتغير عند تقديم طلب أو رفضه أو سحبه؛ التغيير بيحصل بالموافقة بس، وفي نفس معاملتها.
- مدير يطلب أو يقرر تعديل حضوره هو، أو مفوَّض يقرر طلب هو قدّمه.
- حد غير صاحب الشركة يدي صلاحية الطلب أو الموافقة أو يسحبها.
- حد غير اللي قدّم الطلب يسحبه، أو طلب يتعدل بعد ما اتقدم.
- رفض من غير سبب، أو سبب أطول من 500 حرف.
- طلبين مستنيين لنفس التغيير، أو موافقة وسحب ينجحوا مع بعض.
- رد يفرّق بين طلب برّه نطاقك وطلب مش موجود.
- ريم (الموظفة) يوصلها إشعار، أو تشوف طلب عن حضورها في القائمة.
- طلب أو قرار من غير سطر تدقيق، أو أي أثر على العمولة.

## English

1. **The branch manager files:** the Salmiya Branch Manager files a void request for Reem's day (`VOID_SESSION`, body
   in [33](33-void-and-restore-attendance-day.md)) with a reason → **201**, status `PENDING`, `requested_by` is her,
   `revision` 0. **Attendance does not change at all** until approval. One audit entry `attendance_change.requested`.
2. **The approver's bell:** within a minute the Owner's bell (and that of anyone else holding the decide permission in
   scope) shows "Void attendance day requested for Reem; awaiting your approval". The requester does not get this
   notice, and Reem gets nothing.
3. **The list:** the Owner lists `status=PENDING` → the whole business's requests, newest first, each with the
   employee, branch, kind, reason, requester and time, and `can_decide: true`. The Salmiya manager sees only her
   branch's requests, `can_decide: false`, and `can_cancel: true` only on her own pending ones.
4. **Approve:** the Owner approves with the current `revision` (reason optional) → **200**, status `APPROVED` with
   `decided_by` and `decided_at`, `revision` 1, and the change applied in the same transaction (the response carries
   `effect.session`). Audit entry `attendance_change.approved`. The manager's bell: "Void attendance day for Reem:
   Approved. Reason: -" (the reason shows `-` when there is none, or when it is over 255 characters or holds a link or
   a 4–8 digit number).
5. **Reject with a reason:** on another request, the Owner rejects with no reason → "The request is not valid"
   (`VALIDATION_FAILED`, 400). With a reason of 1–500 characters after trimming → **200**, `REJECTED`,
   `decision_reason` set, attendance unchanged. The manager's bell: "Void attendance day for Reem: Rejected. Reason:"
   and the reason.
6. **Withdraw:** the Salmiya manager withdraws her own pending request (`cancel` with the `revision`) → **200**,
   `CANCELLED` with `cancelled_by` and `cancelled_at`. No notice for a withdrawal. Anyone other than the requester
   (even the Owner, or another manager of the same branch) → "Not found" (`NOT_FOUND`, 404). A request is never
   edited: withdraw it and file a new one.
7. **Not pending:** approving, rejecting or withdrawing a decided or withdrawn request → "Only pending attendance
   change requests can be decided or withdrawn." (`ATTENDANCE_CHANGE_NOT_PENDING`, 409). A stale `revision` → "The
   request changed. Reload and try again." (`ATTENDANCE_CHANGE_REVISION_CONFLICT`, 409). Approve and withdraw at the
   same moment: exactly one succeeds; the other gets `NOT_PENDING`.
8. **The world changed before approval (ACR-Q13):** when the kind's rules no longer hold at approval (for example the
   day was corrected after the request) → the kind's own error (for example "The attendance session changed. Reload
   and try again.", `ATTENDANCE_SESSION_REVISION_CONFLICT`, 409) and the request **stays `PENDING`**, so you reject it
   or the manager withdraws it. There is no expiry: a request waits until someone acts.
9. **Two requests for the same thing:** a second void of the same day while one is pending → "A pending request
   already exists for this change." (`ATTENDANCE_CHANGE_DUPLICATE_PENDING`, 409).
10. **Nobody requests for themselves:** the Salmiya manager files a request about her own day → "You cannot request or
    decide a change to your own attendance, or decide a request you filed." (`ATTENDANCE_CHANGE_SELF_FORBIDDEN`, 403).
    The same for a General Manager or Business Manager. Only the Owner is exempt.
11. **The Owner's one step (ACR-Q2):** the Owner files a request herself → **201**, already `APPROVED`,
    `requested_by` = `decided_by` = the Owner, the change applied, two audit entries (requested + approved). No notice
    to anyone.
12. **Granting the decision (ACR-Q4):** the General Manager without the permission tries to approve → "Not found"
    (404); the answer never confirms the request exists. The Owner gives him a personal **Allow** for "Approve or
    reject attendance change requests" on the permissions screen ([12](12-permissions-screen.md)) → he can now approve
    and reject others' requests, and he gets the bell like the Owner.
13. **Guard rails on the delegate:** the delegated General Manager decides a request he filed, or one about his own
    attendance → "You cannot request or decide a change to your own attendance, or decide a request you filed." (403).
    Anyone but the Owner granting, denying or revoking the request or decide permission → "Only the company owner can
    grant this permission" (`PERMISSION_OWNER_ONLY`, 403). The Owner may decide a request about her own attendance
    filed by a manager (ACR-Q22c).
14. **Scope:** the Hawalli manager files for Reem (a Salmiya employee), or anyone sends an id of another business or
    company → "Not found" (404), the identical envelope. The paired POS device → "This action is not allowed"
    (`FORBIDDEN`, 403); an employee's personal session → 401.
15. **What Reem never sees:** Reem gets no notice and no bell for any request about her attendance, neither when filed
    nor when decided. If Reem also has an admin membership and lists requests, the ones about her own attendance **are
    not returned** to her (unless she is the Owner).
16. **Replays:** the same request with the same `Idempotency-Key` → the same answer, nothing written again. The same key
    with another body → "This Idempotency-Key was already used with a different request" (`IDEMPOTENCY_KEY_REUSED`).

**Must NOT happen:**
- Attendance changing when a request is filed, rejected or withdrawn; only an approval changes it, in its own
  transaction.
- A manager requesting or deciding a change to their own attendance, or a delegate deciding a request they filed.
- Anyone but the Owner granting or revoking the request or decide permission.
- Anyone but the requester withdrawing a request, or a request being edited after filing.
- A rejection without a reason, or a reason over 500 characters.
- Two pending requests for the same change, or an approval and a withdrawal both succeeding.
- A response that tells an out-of-scope request from an unknown one.
- Reem (the employee) being notified, or seeing a request about her attendance in the list.
- A request or decision without an audit entry, or any effect on commission.

## For an agent

- Every call: session cookie of the acting user + `x-company-id: <COMPANY_ID>`; writes also need
  `Idempotency-Key: <UNIQUE_KEY>`. Routes are under `@Authenticated()` + `SelectedCompanyGuard`; the permission check is
  in the use case.
- File (201 → `AttendanceChangeRequest`; `APPROVED` at once when the caller is an Owner):

  ```http
  POST /v1/businesses/<BUSINESS_ID>/attendance-change-requests
  x-company-id: <COMPANY_ID>
  Idempotency-Key: <UNIQUE_KEY>
  Content-Type: application/json

  { "kind": "VOID_SESSION", "employee_id": "<REEM_EMPLOYEE_ID>", "session_id": "<SESSION_ID>",
    "session_revision": 0, "reason": "<SYNTHETIC_REASON>" }
  ```

  The body is a strict discriminated union on `kind`: `VOID_SESSION` and `RESTORE_SESSION` (both require
  `session_id` and `session_revision`) are live; `ADD_SESSION` carries `branch_id`, `clock_in`, `clock_out` from #153
  ([32](32-add-manual-attendance-day.md)) and is refused with `ATTENDANCE_CHANGE_KIND_UNAVAILABLE` (422) until then.
- Withdraw: `POST /v1/businesses/<BUSINESS_ID>/attendance-change-requests/<REQUEST_ID>/cancel` with
  `{ "revision": <REVISION> }` → 200.
- Decide: `POST /v1/businesses/<BUSINESS_ID>/attendance-change-requests/<REQUEST_ID>/decide` with
  `{ "decision": "APPROVED", "revision": <REVISION> }` (optional `reason`) or
  `{ "decision": "REJECTED", "revision": <REVISION>, "reason": "<SYNTHETIC_REASON>" }` → 200
  `AttendanceChangeDecisionResult` (the request + `effect: { session } | null`, `null` on a rejection).
- List: `GET /v1/businesses/<BUSINESS_ID>/attendance-change-requests?status=PENDING&branch_id=&employee_id=&kind=&cursor=&limit=50`
  → `{ items, next_cursor }`, newest first (`requested_at DESC, id DESC`), `limit` 1–100 (default 50). Each item:
  `id, kind, status, business_id, branch_id, employee { id, name_ar, name_en }, session_id, session_revision,
  requested, reason, requested_by, requested_at, decided_by, decided_at, decision_reason, cancelled_by, cancelled_at,
  revision, can_decide, can_cancel`.
- Grant the decide permission (Owner's session only):
  `POST /v1/permissions/memberships/<GM_MEMBERSHIP_ID>/overrides` with
  `{ "permission_code": "decide:attendance-change:company", "effect": "ALLOW", "scope_type": "COMPANY",
  "scope_id": "<COMPANY_ID>", "reason": "<SYNTHETIC_REASON>", "expires_at": null }` → 201; the same from a non-owner →
  403 `PERMISSION_OWNER_ONLY` (also for `request:attendance-change:branch`, for `DENY`, and for revoking either).
- Bell: `GET /v1/me/notifications/unread-count` and the admin bell at `http://localhost:3001`. Template keys
  `attendance_change_requested` (to every approver: holders of the decide permission in scope, owners always, minus the
  requester and minus the employee unless she is an Owner) and `attendance_change_decided` (to the requester only, and
  only while she is still an active member and is not the decider). Rendered texts (`packages/i18n/src/attendance-change.ts`):
  `طلب {{change}} لـ {{employee_name_ar}} مستني موافقتك` / `{{change}} requested for {{employee_name_en}}; awaiting your approval`;
  `{{change}} لـ {{employee_name_ar}}: {{decision}}. السبب: {{reason}}` / `{{change}} for {{employee_name_en}}: {{decision}}. Reason: {{reason}}`,
  with `change` ∈ إضافة يوم حضور / إلغاء يوم حضور / استرجاع يوم حضور (Add / Void / Restore attendance day) and
  `decision` ∈ تمت الموافقة / تم الرفض (Approved / Rejected). The owner one-step path and withdrawals publish no notice.
- Errors: `NOT_FOUND` 404 · `FORBIDDEN` 403 · `ATTENDANCE_CHANGE_SELF_FORBIDDEN` 403 · `ATTENDANCE_CHANGE_NOT_PENDING`
  409 · `ATTENDANCE_CHANGE_REVISION_CONFLICT` 409 · `ATTENDANCE_CHANGE_DUPLICATE_PENDING` 409 ·
  `ATTENDANCE_CHANGE_KIND_UNAVAILABLE` 422 · `VALIDATION_FAILED` 400 · `IDEMPOTENCY_KEY_REUSED` · `NOT_READY` 503, plus
  the kind's own codes (spec 045 / 046), each with `message_ar` and `message_en`.
- Assertions: filing, rejecting and withdrawing leave `attendance_sessions` untouched; each step writes exactly one audit
  row (`attendance_change.requested|approved|rejected|cancelled`; two for the owner one-step); a kind refusal at approval
  rolls back the effect, audit and event together and leaves `PENDING`; approve-vs-withdraw and approve-vs-approve races
  commit one transition; unknown, other-branch, other-business and other-company ids give identical envelopes; the
  event facts never carry reasons (only the requester's IN_APP parameters carry the safe decision reason); RLS hides
  another tenant's requests. Sources: `docs/specs/044-staff-attendance-change-requests/spec.md`,
  `apps/api/src/modules/staff/http/attendance-change-requests.controller.ts`,
  `packages/contracts/src/staff/attendance-change-request.ts`, `packages/i18n/src/attendance-change.ts`,
  `packages/notifications/src/templates/attendance-change-{requested,decided}.ts`,
  `apps/admin/src/notifications/model/render-notification.ts`, `apps/api/src/shared/errors.ts`.
