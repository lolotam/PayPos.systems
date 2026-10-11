# 34 · Resolve an attendance exception — إغلاق تنبيه الحضور وإعادة فتحه

**Status / الحالة:** shipped in #126 (PR 25, merge commit `38e20cb9`). **API only**: there is no list or screen for
exceptions until the attendance board (PR 27, RE-Q11). Staging runs `api` and `worker` at commit `6c220e4`
(2026-10-11), so both routes are **live on staging**; the admin and POS apps are **not deployed** (issue #54), so you
exercise them with an HTTP client. Resolving or reopening never changes the session, its times, hours, lateness or
commission. No message goes to the employee (RE-Q12). Your decisions of 2026-10-08 (RE-Q1 to RE-Q12) apply:
[owner-questions.ar.md](../specs/034-staff-resolve-attendance-exception/owner-questions.ar.md).

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md), then `pnpm db:migrate` (the `revision` column on `attendance_exceptions`, its
  CHECKs, the card cleanup and the permission `resolve:attendance:branch`) and `pnpm db:seed`. API running; the
  company's `staff` feature enabled.
- One business with two branches, Salmiya (فرع السالمية) and Hawalli (فرع حولي). Synthetic employee Sara (سارة)
  attached to Salmiya, with an **open exception** you can resolve. Raise one with the QR clock of
  [26](26-clock-attendance.md): a clock-in with the phone location denied raises `NONE`; a clock-in from outside the
  branch radius raises `OUT_OF_RANGE`. You need the exception `id` and its current `revision` (0 when new). There is
  no list yet, so read the id from the database in a test.
- Synthetic users, each with their own session cookie:
  - **Branch Manager** of Salmiya (not linked to Sara).
  - **Branch Manager** of Hawalli.
  - **Owner**, and a manager who is also Sara's own user (for the self check).
- Who may resolve or reopen (`resolve:attendance:branch`, "إغلاق استثناءات حضور الفرع وإعادة فتحها" / "Resolve branch
  attendance exceptions"): by default Owner, General Manager, Business Manager and Branch Manager, on the exception's
  own branch. No other role holds it. A paired Device never holds it.
- Synthetic reasons only. Every write needs `Idempotency-Key` and `x-company-id`.

## العربي

1. **المديرة تقفل تنبيه "برّه النطاق":** سارة سجّلت حضور من موبايلها بعيد عن الفرع، فاتولّد تنبيه `OUT_OF_RANGE`.
   مديرة السالمية تقفله بـ `revision` الحالي وسبب (مثلاً "مشوار للمحل") ← **200** والتنبيه `RESOLVED`،
   و`resolution` = `ACKNOWLEDGED`، و`resolved_by` = المديرة، و`resolved_at` = دلوقتي، و`reason` = السبب، و`revision`
   زاد واحد. بيتكتب سطر تدقيق واحد فيه قبل وبعد.
2. **تنبيه "من غير موقع":** على تنبيه `NONE` (الموبايل ما بعتش موقع)، مدير النشاط يقفله بسبب ← نفس النتيجة.
3. **الجلسة ما اتغيرتش:** بعد القفل، حضور سارة نفسه (الأوقات، الساعات، دقايق التأخير) زي ما كان بالظبط، وما فيش أي أثر
   على العمولة. وسارة ما بيوصلها أي إشعار.
4. **السبب إجباري:** قفل بسبب فاضي أو مسافات بس، أو أطول من 500 حرف ← **البيانات المرسلة غير صحيحة**
   (`VALIDATION_FAILED`، 400) والتنبيه زي ما هو.
5. **إعادة الفتح:** نفس المديرة تعيد فتح التنبيه المقفول بسبب (مثلاً "اتقفل بالغلط، كانت غايبة") ← **200** والتنبيه
   `OPEN`، و`resolution` و`resolved_by` و`resolved_at` و`reason` بقوا فاضيين، و`revision` زاد. القفل الأول وسببه
   **ما اتمسحوش**: هم موجودين في سطر التدقيق (`before`)، وسبب إعادة الفتح في `after.decision_reason`. تقدر تقفله تاني
   (تلات أسطر تدقيق بالترتيب).
6. **تنبيه بيقفله النظام:** محاولة قفل أو إعادة فتح تنبيه `SUSPECTED_MISSED_OUT` ← **هذا الاستثناء يغلقه النظام، وليس
   المدير.** (`ATTENDANCE_EXCEPTION_NOT_MANUAL`، 409) والتنبيه زي ما هو.
7. **حضورك أنت:** المدير اللي هو نفسه سارة (أو صاحب الشركة) يحاول يقفل أو يعيد فتح تنبيه على حضوره ← **لا يمكنك إغلاق
   أو إعادة فتح استثناء على حضورك أنت.** (`ATTENDANCE_EXCEPTION_SELF_FORBIDDEN`، 403). لو أكتر من قاعدة اتكسرت مع بعض،
   الترتيب: حضورك أنت الأول، بعدين النوع، بعدين الحالة.
8. **النسخة قديمة أو الحالة غلط:** قفل تنبيه مقفول أصلاً، أو إعادة فتح تنبيه مفتوح، أو `revision` قديم ←
   **تغير استثناء الحضور. أعد التحميل وحاول مرة أخرى.** (`ATTENDANCE_EXCEPTION_REVISION_CONFLICT`، 409). مديرين اتنين
   في نفس اللحظة: واحد بس ينجح والتاني ياخد الخطأ ده.
9. **فرع تاني:** مديرة حولي تحاول تقفل تنبيه من السالمية ← **المسار غير موجود** (`NOT_FOUND`، 404). نفس الرد لو الـ
   `id` من نشاط أو شركة تانية: الرد ما بيأكدش إن التنبيه موجود. الفرع المقصود هو فرع **التنبيه** (فرع الحركة اللي
   ولّدته)، مش فرع الجلسة.
10. **جهاز الكاشير:** الجهاز المربوط على الاستقبال ← **غير مسموح بهذا الإجراء** (`FORBIDDEN`، 403).
11. **الكارت ما بيولّدش تنبيه (RE-Q4):** سارة تسجّل حضور وانصراف بكارتها على تابلت الاستقبال
    ([30](30-employee-cards-and-clock-by-card.md)) ← ما فيش ولا تنبيه، و`exceptions` في رد المسح `[]`، وموقع الجلسة
    يفضل `NONE`. أما الحضور بالـ QR من غير موقع فلسه بيولّد `NONE` زي الأول. وتنبيهات الكارت القديمة على staging
    اتقفلت لوحدها بالـ migration (`resolution` = `CARD_SCAN`، من غير `resolved_by` ولا سبب).
12. **إعادة الإرسال:** نفس الطلب بنفس `Idempotency-Key` ← نفس الرد من غير أي كتابة جديدة. نفس المفتاح بجسم تاني ←
    **تم استخدام مفتاح Idempotency-Key مع طلب مختلف** (`IDEMPOTENCY_KEY_REUSED`).

**ممنوع يحصل:**
- قفل أو إعادة فتح من غير سبب، أو بسبب أطول من 500 حرف.
- مدير يقفل أو يعيد فتح تنبيه على حضوره هو (حتى صاحب الشركة).
- قفل تنبيه `SUSPECTED_MISSED_OUT` باليد.
- مدير فرع تاني، أو جهاز الكاشير، يقفل تنبيه، أو رد يفرّق بين تنبيه برّه نطاقك وتنبيه مش موجود.
- مديرين يقفلوا نفس التنبيه مع بعض وكله ينجح.
- أي تغيير في أوقات الجلسة أو ساعاتها أو التأخير أو العمولة.
- قفل أو إعادة فتح من غير سطر تدقيق (قبل وبعد) في نفس المعاملة، أو مسح للقفل القديم وسببه.
- تنبيه جديد من حركة بالكارت.

## English

1. **The manager closes an "out of range" warning:** Sara clocked in from her phone far from the branch, so an
   `OUT_OF_RANGE` exception exists. The Salmiya Branch Manager resolves it with the current `revision` and a reason
   (for example "errand for the shop") → **200**, status `RESOLVED`, `resolution` `ACKNOWLEDGED`, `resolved_by` her,
   `resolved_at` now, `reason` set, `revision` up by one. One audit entry holds before and after.
2. **A "no location" warning:** on a `NONE` exception (the phone sent no location), a Business Manager resolves it
   with a reason → the same result.
3. **The session is untouched:** after the closure Sara's attendance (times, hours, late minutes) is exactly as it was,
   with no effect on commission, and Sara receives no message.
4. **The reason is mandatory:** a reason that is empty, only spaces, or over 500 characters → "The request is not
   valid" (`VALIDATION_FAILED`, 400) and the exception is unchanged.
5. **Reopen:** the same manager reopens the resolved exception with a reason (for example "closed by mistake, she was
   absent") → **200**, status `OPEN`, `resolution`, `resolved_by`, `resolved_at` and `reason` are empty again, and
   `revision` goes up. The first closure and its reason are **not erased**: they live in the audit entry's `before`,
   and the reopen reason in `after.decision_reason`. Resolving again works (three audit entries, in order).
6. **A system-closed kind:** resolving or reopening a `SUSPECTED_MISSED_OUT` exception → "This attendance exception is
   resolved by the system, not by a manager." (`ATTENDANCE_EXCEPTION_NOT_MANUAL`, 409), nothing changes.
7. **Your own attendance:** the manager who is Sara herself (or the Owner) resolves or reopens an exception on their own
   attendance → "You cannot resolve or reopen an exception on your own attendance."
   (`ATTENDANCE_EXCEPTION_SELF_FORBIDDEN`, 403). When several rules fail at once the order is: own attendance, then
   kind, then state.
8. **Stale revision or wrong state:** resolving an already resolved exception, reopening an open one, or a stale
   `revision` → "The attendance exception changed. Reload and try again."
   (`ATTENDANCE_EXCEPTION_REVISION_CONFLICT`, 409). Two managers at the same moment: exactly one succeeds, the other
   gets this error.
9. **Another branch:** the Hawalli manager tries to resolve a Salmiya exception → "Not found" (`NOT_FOUND`, 404). The
   same answer for an id of another business or company: it never confirms the exception exists. The branch that counts
   is the **exception's** branch (where the raising movement happened), not the session's.
10. **The paired POS device:** → "This action is not allowed" (`FORBIDDEN`, 403).
11. **A card scan raises nothing (RE-Q4):** Sara clocks in and out with her card on the reception tablet
    ([30](30-employee-cards-and-clock-by-card.md)) → no exception at all, the scan result's `exceptions` is `[]`, and
    the session's location stays `NONE`. QR clocking without a location still raises `NONE` as before. Card-raised
    exceptions that were already on staging were closed by the migration (`resolution` `CARD_SCAN`, no `resolved_by`,
    no reason).
12. **Replays:** the same request with the same `Idempotency-Key` → the same answer, nothing written again. The same
    key with another body → "This Idempotency-Key was already used with a different request"
    (`IDEMPOTENCY_KEY_REUSED`).

**Must NOT happen:**
- Resolving or reopening without a reason, or with one over 500 characters.
- A manager (the Owner included) acting on an exception about their own attendance.
- A manual resolution of `SUSPECTED_MISSED_OUT`.
- Another branch's manager or the paired device resolving an exception, or an answer that tells an out-of-scope
  exception from an unknown one.
- Two managers both succeeding on the same exception.
- Any change to the session's times, hours, lateness or commission.
- A resolve or reopen without an audit entry (before and after) in the same transaction, or an earlier closure and its
  reason being erased.
- A new exception from a card movement.

## For an agent

- Every call: session cookie of the acting manager + `x-company-id: <COMPANY_ID>` + `Idempotency-Key: <UNIQUE_KEY>`.
  Both routes are `@Authenticated()` + `SelectedCompanyGuard`; the permission check is in the use case, on the
  exception's own branch.
- Resolve (200 → `AttendanceExceptionRecord`):

  ```http
  POST /v1/businesses/<BUSINESS_ID>/attendance-exceptions/<EXCEPTION_ID>/resolve
  x-company-id: <COMPANY_ID>
  Idempotency-Key: <UNIQUE_KEY>
  Content-Type: application/json

  { "revision": <REVISION>, "reason": "<SYNTHETIC_REASON>" }
  ```

- Reopen: `POST /v1/businesses/<BUSINESS_ID>/attendance-exceptions/<EXCEPTION_ID>/reopen`, same body.
- The body is strict: `revision` integer >= 0 and `reason` 1 to 500 characters after trimming; any other key is a
  `VALIDATION_FAILED` 400. The response: `id, session_id, employee_id, branch_id, kind (NONE | OUT_OF_RANGE |
  SUSPECTED_MISSED_OUT), status (OPEN | RESOLVED), resolution (CLOSED_LATE | MISSED_OUT | ACKNOWLEDGED | CARD_SCAN |
  null), resolved_by, resolved_at, reason, raised_at, revision`.
- Errors: `NOT_FOUND` 404 (also for a caller without the permission on that branch) · `FORBIDDEN` 403 (paired device) ·
  `ATTENDANCE_EXCEPTION_SELF_FORBIDDEN` 403 · `ATTENDANCE_EXCEPTION_NOT_MANUAL` 409 ·
  `ATTENDANCE_EXCEPTION_REVISION_CONFLICT` 409 · `VALIDATION_FAILED` 400 · `IDEMPOTENCY_KEY_REUSED` ·
  `TRANSACTION_RETRY_REQUIRED` · `NOT_READY` 503, each with `message_ar` and `message_en`.
- Assertions: after resolve the row is `RESOLVED` / `ACKNOWLEDGED` with `revision` + 1 and one audit row with before and
  after (`decision_reason` in `after`); after reopen the row is `OPEN` with the four fields NULL, and the audit `before`
  holds the old resolution and reason; the attendance session row is identical before and after; a stale revision
  and a double resolve commit nothing; two concurrent resolves commit one; unknown, other-branch, other-business and
  other-company ids give identical `NOT_FOUND` envelopes; a card clock-in and clock-out leave zero exception rows
  and `exceptions: []`; RLS hides another tenant's exceptions. Sources:
  `docs/specs/034-staff-resolve-attendance-exception/spec.md`,
  `apps/api/src/modules/staff/http/attendance-exceptions.controller.ts`,
  `packages/contracts/src/staff/attendance-exception.ts`, `packages/i18n/src/attendance-exception-catalog.ts`,
  `packages/i18n/src/permission-codes-catalog.ts`, `apps/api/src/shared/errors.ts`.
