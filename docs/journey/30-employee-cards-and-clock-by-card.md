# 30 · Employee cards and clock-by-card — كروت الموظفين والحضور بالكارت

**Status / الحالة:** shipped in two PRs (CB-Q4): #120 (PR 23a — issue / revoke an employee card in the admin, squash
`d275973`) and #121 (PR 23b — clock-by-card on the paired reception device, squash `b01e879`). The API is on staging at
`b01e879` (2026-10-07), but the admin (issue #54) and the POS are not deployed, so the screens run **locally only**. The
card is the fallback for an employee without a usable phone: the reception operator scans it and the same attendance
rules as [26](26-clock-attendance.md) apply. Your decisions of 2026-10-07 apply (CB-Q1 location stays `NONE`, CB-Q3
default roles, D6 limits). **Not shipped yet:** attendance exception handling, correction and the board (PRs 25–27),
and showing a Cashier staff-login DENY on the permissions screen (D5).

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md) **with Redis running** (both limits fail closed without it), then `pnpm db:migrate`
  (`0085` the `employee_cards` table, `0086` its RLS, `0087` the permission defaults) and `pnpm db:seed`. API, admin and
  POS running; the company's `staff` feature enabled.
- **Admin side:** a manager with effective `manage:employees:business` over the employee's primary branch **and** every
  open branch attachment ([16](16-update-employee.md)). A synthetic employee ([13](13-create-employee.md)) attached to the
  device's branch today.
- **POS side:** a paired device ([03](03-pos-device-pairing.md)) and an operator signed in on it with their own PIN
  ([08](08-staff-login-pos.md), `STAFF_OTP_POS_ORIGIN` set). `clock:attendance:branch` is held by default by **Owner**,
  **General Manager**, **Business Manager**, **Branch Manager**, **Shift Supervisor** and **Cashier**; signing in on the
  device also needs `login:staff:branch`, a default of **Staff** and, since `0087`, **Cashier**. Other roles need an
  additional branch-scoped Staff or Cashier membership (grants add up across memberships) or an explicit custom role. A keyboard-wedge scanner is optional: typing the code and
  pressing Enter is the same thing.
- Synthetic codes only: `CARD-TEST-0001`, `CARD-TEST-0002`, and `CARD-TEST-9999` (never issued).

## العربي

1. **قسم الكارت:** من القائمة الجانبية **الموظفون** ← **تعديل** على الموظف ← تحت الراتب هتلاقي **كارت الحضور** و**كارت
   نشط واحد لكل موظف؛ الكارت الجديد يستبدل النشط ويُدقَّق التغييران معًا.** لو مفيش: **لا يوجد كارت نشط.** لو
   صلاحيتك مش مغطية كل فروع الموظف، القسم **مش بيظهر خالص** (نفس رد الموظف اللي مش موجود).
2. **الإصدار:** في **كود الكارت** امسح الكارت أو اكتب `CARD-TEST-0001` (الحقل بيظهر نقط، من غير اقتراحات تلقائية) ←
   **إصدار كارت** ← **تم إصدار الكارت.** والحقل يتمسح، ويظهر **الكارت النشط: ••••0001**. الكود الكامل ما بيظهرش تاني
   أبدًا، ولا في الرد. كود أقصر من 8 حروف ← **الكارت النشط** من غير أي جزء من الكود.
3. **قواعد الكود:** من 4 لـ 64 حرف/رقم/رمز إنجليزي ظاهر، من غير مسافات في النص. المسافات في الأول والآخر بتتشال.
   الحروف الكبيرة والصغيرة فارقة (`card-test-0001` غير `CARD-TEST-0001`). برّه القواعد ← **البيانات المرسلة غير صحيحة**
   (`VALIDATION_FAILED`) ومش بيتحسب من حد المحاولات.
4. **إعادة الإصدار:** اصدر `CARD-TEST-0002` لنفس الموظف ← الكارت القديم بيتلغي لوحده والجديد يبقى **••••0002**، ويتكتب
   في التدقيق صف إلغاء وصف إصدار في نفس المعاملة. الكارت القديم ما بقاش يسجل حضور.
5. **كود مع موظف تاني:** كود نشط مع موظف تاني في نفس الشركة (حتى في نشاط تاني) ← **كود الكارت مستخدم بالفعل لموظف
   نشط آخر في الشركة.** (409) ومفيش أي تغيير.
6. **الإلغاء:** **إلغاء الكارت** (من غير رسالة تأكيد) ← **لا يوجد كارت نشط.** وصف تدقيق. إلغاء كارت ملغي قبل كده، أو
   كارت موظف تاني ← **المسار غير موجود** (404). الإلغاء مالوش حد، وشغال حتى لو Redis واقف.
7. **حد الإصدار:** 30 محاولة في الساعة لكل شركة ومستخدم. الإصدار الناجح والـ 409 بيتحسبوا؛ نفس الطلب بنفس المفتاح بعد ما
   خلص مش بيتحسب. المحاولة رقم 31 ← **طلبات كثيرة، حاول بعد قليل** (429) ومفيش كارت ولا تدقيق؛ عدد الثواني الباقية في
   هيدر `Retry-After` بس، الشاشة بتعرض الرسالة العامة. مستخدم تاني ليه عدّاده. Redis واقف ← **الخدمة غير جاهزة حالياً**.
8. **شاشة الاستقبال:** افتح الكاشير على الجهاز المربوط. قبل ما المشغّل يدخل، مكان الكارت فيه **تم تسجيل خروج المشغّل.
   سجّل الدخول مجددًا قبل مسح الكارت.** بعد الدخول ([08](08-staff-login-pos.md)) ← **تسجيل الحضور بالكارت** و**مرّر كارت
   الحضور على ماسح الاستقبال، أو اكتب الكود واضغط Enter.** وحقل **كود كارت الحضور** وزرار **تسجيل**.
9. **المسح:** امسح `CARD-TEST-0002` ← الحقل يتمسح فورًا ويتقفل لحد الرد، ومسح تاني وهو مستني بيتجاهل. أثناء الانتظار
   بيظهر نفس سطر المسار الشخصي **افتح مفتاح المرور لتسجيل الحركة…** (مفيش مفتاح مرور فعلًا في الكارت). القبول ←
   **تم تسجيل الحضور** وتحتها (في أي حركة جديدة بالكارت) **تم التسجيل مع استثناء للموقع: موقع الهاتف أو إحداثيات الفرع غير متاحة.** لأن جهاز
   الاستقبال ما بيبعتش موقع (CB-Q1). لو الكارت اتمسح خلال 5 دقايق من حركة بالموبايل، بترجع نتيجة الموبايل زي ما هي (الخطوة 10). مسح بعدها ← **تم تسجيل الانصراف**. الحركة بتتسجل بالجهاز والمشغّل.
10. **نفس قواعد [26](26-clock-attendance.md):** مسح تاني خلال أقل من 5 دقايق ← نفس النتيجة الأولى من غير حركة جديدة،
    والقاعدة دي **مشتركة** مع مسح QR من الموبايل (كارت ثم QR أو العكس). قاعدة الـ 16 ساعة ← **أُغلقت الجلسة السابقة
    باعتبار الانصراف مفقودًا.** والتأخير ← **دقائق التأخير للتقرير فقط، دون خصم عمولة:** والرقم. التفاصيل في 26 خطوات 5–8.
11. **كارت مش مقبول:** `CARD-TEST-9999`، أو كارت ملغي أو اتستبدل، أو كارت شركة تانية، أو موظف مش مربوط بفرع الجهاز في
    تاريخ النهارده ← **لم يُقبل الكارت. تحقق من الكارت أو اطلب من المدير.** نفس الرد بالظبط (404) في كل الحالات، ومفيش
    حاجة بتتكتب.
12. **حد المسح الغلط:** 10 مسحات مرفوضة في 10 دقايق لكل جهاز. المسح الناجح مش بيتحسب، ولا الكود اللي شكله غلط من الأساس (أقل من 4 أو أكتر من 64 حرف، أو حروف مش ظاهرة): ده بيترفض 400 قبل العدّ. المسحات بالترتيب (واحد ورا التاني): بعد العاشرة ← **مسحات خاطئة كثيرة.
    انتظر {seconds} ثانية ثم أعد المحاولة.** بالثواني الباقية (مثلاً **انتظر 420 ثانية**)، وحتى الكارت الصح في مسح جديد بيترفض لحد ما
    الفترة تخلص (إعادة نفس الطلب اللي نجح قبل كده بنفس المفتاح بترجّع نتيجته المحفوظة 200). لو كذا مسح اتبعتوا في نفس اللحظة، ممكن يعدّوا الحد بواحد أو اتنين (مقصود ومكتوب في المواصفات). جهاز تاني ومسح QR مش بيتأثروا. Redis واقف ← **تعذّر الوصول إلى الخادم. حاول مرة أخرى.**
13. **أوفلاين:** اقفل الإنترنت ← القسم كله بيتبدل بـ **تسجيل الحضور بالكارت يحتاج اتصالاً بالإنترنت. اتصل وأعد المسح.**
    وأي مسح مستني بيتلغي والحقل يتمسح. مفيش طابور ولا حفظ على الجهاز. رجّع الإنترنت ← الحقل يرجع.
14. **خروج المشغّل:** المشغّل يخرج أو جلسته تتبدل أو تنتهي ← الحقل والنتيجة يتمسحوا ويظهر سطر الخروج. لو خرج والمسح لسه
    بيتنفذ، الأسبق على القفل هو اللي بيكسب: لو الخروج سبق ← السيرفر بيرفض المسح (401) ومفيش حضور ولا تدقيق، والشاشة
    **تم تسجيل خروج المشغّل…** وتعيد فحص الجلسة. لو المسح سبق ← الخروج بيستنى لحد ما الحضور يتحفظ، والمسح ينجح عادي.
15. **الصلاحية:** مشغّل مالوش `clock:attendance:branch` على فرع الجهاز ← **لا تملك صلاحية تسجيل حضور الموظفين بالكارت
    على هذا الجهاز.** (403). متصفح عادي من غير جهاز مربوط، أو جهاز من غير مشغّل ← 401.

**ممنوع يحصل:**
- الكود الكامل يظهر بعد الإصدار في الشاشة أو الرد أو التدقيق أو الأحداث أو الـ logs (آخر 4 حروف بس، ولكود 8 حروف فأكتر).
- كارتين نشطين لموظف واحد، أو نفس الكود نشط مع موظفين في نفس الشركة.
- كارت يسجل حضور موظف غير صاحبه، أو كارت ملغي/مستبدل يسجل.
- رد يختلف بين كارت مش موجود وملغي وبتاع شركة تانية وموظف مش مربوط بالفرع (يكشف إن الكارت موجود).
- تسجيل بالكارت من غير جهاز مربوط ومشغّل داخل، أو بعد ما المشغّل خرج، أو من مشغّل من غير الصلاحية.
- تخمين من غير حد: المحاولة 31 في الساعة أو المسح الغلط رقم 11 في 10 دقايق يعدّي لما المسحات تيجي واحد ورا التاني، أو المسح الناجح يتحسب.
- مسح أوفلاين يتحفظ أو يدخل طابور.
- إصدار أو إلغاء من غير تدقيق، أو الحضور بالكارت يأثر على عمولة، أو حركة جديدة بالكارت تتسجل بموقع سليم بدل `NONE`.

## English

1. **The card section:** sidebar **Employees** → **Edit** on the employee → below the salary section, **Attendance card**
   and "One active card per employee; a new card replaces the active one and both changes are audited." With none: "No
   active card." If your access does not cover all of the employee's branches, the section **does not appear at all**
   (the same answer as a missing employee).
2. **Issue:** in **Card code** scan the card or type `CARD-TEST-0001` (the field shows dots, no autocomplete) → **Issue
   card** → "Card issued." The field clears and **Active card: ••••0001** appears. The full code is never shown again, not
   even in the response. A code shorter than 8 characters → **Active card** with no part of the code.
3. **Code rules:** 4 to 64 visible ASCII letters, digits or symbols, no spaces inside. Leading and trailing spaces are
   removed. Case matters (`card-test-0001` is not `CARD-TEST-0001`). Outside the rules → "The request is not valid"
   (`VALIDATION_FAILED`), not counted against the attempt limit.
4. **Re-issue:** issue `CARD-TEST-0002` to the same employee → the old card is revoked automatically and the new one is
   **••••0002**; the audit log gets one revoked row and one issued row in the same transaction. The old card no longer clocks.
5. **A code held by another employee:** a code active for another employee in the same company (even in another business)
   → "This card code is already active for another employee in the company." (409); nothing changes.
6. **Revoke:** **Revoke card** (no confirmation) → "No active card." and an audit row. Revoking an already-revoked card, or
   another employee's card → "Not found" (404). Revoke has no limit and works even when Redis is down.
7. **Issue limit:** 30 attempts per hour per company and user. A success and a 409 both count; replaying a completed
   request with the same key does not. The 31st → "Too many requests — try again shortly" (429), no card and no audit; the
   seconds left are only in the `Retry-After` header, the screen shows the generic message. Another user has their own
   counter. Redis down → "The service is not ready".
8. **Reception screen:** open the POS on the paired device. Before an operator signs in, the card area shows "The operator
   is signed out. Sign in again before scanning a card." After sign-in ([08](08-staff-login-pos.md)) → **Clock by card**,
   "Scan the attendance card with the reception scanner, or type its code and press Enter.", the **Attendance card code**
   field and the **Clock** button.
9. **Scan:** scan `CARD-TEST-0002` → the field clears at once and stays disabled until the answer; a second scan while
   waiting is ignored. While waiting the personal-path line "Unlock your passkey to record attendance…" shows (no passkey is
   actually asked for a card). Accepted → "Clocked in" and, on every fresh card movement, "Recorded with a location exception: no usable location or
   branch coordinates." because the reception device sends no location (CB-Q1). A card scan within 5 minutes of a phone
   movement returns that phone result unchanged (step 10). A later scan → "Clocked out". The movement
   records the device and the operator.
10. **Same rules as [26](26-clock-attendance.md):** a second scan under 5 minutes → the first result again, no new movement,
    and this window is **shared** with the phone QR path (card then QR or the reverse). The 16-hour rule → "The previous
    session was closed as a missed clock-out." Lateness → "Reported late minutes (no commission deduction):" with the number.
    Details in 26 steps 5–8.
11. **A card that is not accepted:** `CARD-TEST-9999`, a revoked or replaced card, another company's card, or an employee not
    attached to the device's branch on today's date → "The card was not accepted. Check the card or ask a manager." The same
    answer (404) in every case, and nothing is written.
12. **Wrong-scan limit:** 10 refused scans per 10 minutes per device, counting only well-formed codes that are not accepted (unknown, revoked, other branch or company, ineligible employee). Accepted scans do not count, and a malformed code (under 4 or over 64 visible characters) is refused 400 by the contract before the count. Scanned one after another: after the 10th → "Too many
    wrong scans. Wait {seconds} seconds and try again." with the seconds left (for example "Wait 420 seconds"), and even a
    valid card in a new scan is refused until the window ends (a replay of an earlier successful request with the same
    `Idempotency-Key` and body still returns its stored 200). Scans sent at the same moment can slightly exceed 10 (allowed by the spec:
    the check does not reserve a slot). Another device and QR clocking are unaffected. Redis down → "The server
    could not be reached. Try again."
13. **Offline:** disconnect → the whole section is replaced by "Card clocking needs an internet connection. Connect and scan
    again."; a pending scan is cancelled and the field cleared. Nothing is queued or stored on the device. Back online → the
    field returns.
14. **Operator sign-out:** the operator signs out, is replaced or expires → the field and result clear and the signed-out line
    shows. Signing out while a scan is still running: whichever takes the shared session lock first wins. Sign-out
    first → the scan is refused (401), no attendance and no audit, and the screen shows "The operator is signed out…" and
    rechecks the session. Scan first → the sign-out waits for the attendance to commit, and the scan succeeds (200).
15. **Permission:** an operator without `clock:attendance:branch` at the device's branch → "You do not have permission to clock
    staff by card on this device." (403). An ordinary browser without a paired device, or a device with no operator → 401.

**Must NOT happen:**
- The full code shown after issue on screen, in a response, the audit log, events or logs (only the last 4, and only for
  codes of 8 or more).
- Two active cards for one employee, or one code active for two employees in the same company.
- A card clocking anyone but its owner, or a revoked or replaced card clocking.
- Different answers for an unknown card, a revoked one, another company's, and an employee not attached to the branch
  (revealing that a card exists).
- Clocking by card without a paired device and a signed-in operator, after the operator signed out, or by an operator
  without the permission.
- Unlimited guessing: a 31st issue attempt in the hour or an 11th sequential wrong scan in 10 minutes accepted, or accepted scans counted.
- An offline scan stored or queued.
- Issue or revoke without audit, card clocking affecting commission, or a fresh card movement recorded with a usable location instead of `NONE`.

## For an agent

- Admin: `http://localhost:3001/staff` → **Edit** → the **Attendance card** section; code input `#employee-card-code`
  (class `card-code-mask`); buttons and status by exact text; errors are `role=alert`, "Card issued." is `role=status`.
- POS: `http://localhost:5173` on a paired device with an operator signed in. Input `#card-code`, labelled **Attendance card
  code**; results are `role=status` (accepted) or `role=alert` (refused). Emulate offline in the browser and assert the
  offline notice replaces the form and no request is sent.
- API, admin (session cookie + `x-company-id`; feature `staff`):
  - `GET /v1/businesses/<BUSINESS_ID>/employees/<EMPLOYEE_ID>/cards` → `{ active: { id, employee_id, card_code_suffix, issued_at, revoked_at } | null, can_manage: true }`, or 404 `NOT_FOUND` for a missing employee or a caller without management on every employee branch.
  - `POST .../cards` with `Idempotency-Key` and `{ "card_code": "CARD-TEST-0001" }` → 200 card; 409 `EMPLOYEE_CARD_CODE_IN_USE`; 429 `TOO_MANY_REQUESTS` + `Retry-After`; 503 `NOT_READY` without Redis; same key with another code → 422 `IDEMPOTENCY_KEY_REUSED`.
  - `POST .../cards/<CARD_ID>/revoke` with `Idempotency-Key`, no body → 200 with `revoked_at`; already revoked → 404.
- API, device: `POST /v1/devices/me/clock-by-card` with `Authorization: Device <DEVICE_TOKEN>`, the operator cookie
  `pospay-staff.session_token`, `Origin` equal to the configured POS origin, `Idempotency-Key` and `{ "card_code": "..." }` →
  200 `{ session_id, operation, working_date, accepted_at, exceptions, late_minutes, missed_session_id }` (a fresh card movement has `exceptions: ["NONE"]`; a dedupe within 5 minutes of a phone movement returns that movement's result unchanged) with
  `Cache-Control: no-store`. No operator or no Device → 401; missing permission or wrong `Origin` → 403 `FORBIDDEN`; a
  malformed code → 400 `VALIDATION_FAILED` (not counted); a well-formed card not accepted → 404 `NOT_FOUND`; the 11th sequential failure in 600 s → 429 + `Retry-After` (concurrent failures may slightly exceed 10, spec 032); Redis down → 503 `NOT_READY`.
- Assertions: the stored row has `card_code_hash` and `card_code_suffix` only; audit rows `employee_card` `issued` /
  `revoked` carry `employee_id`, never the code; the movement has `source='BARCODE'`, `device_id`, `operator_id`, one audit
  row and one `AttendanceClocked*` event in the same transaction; unknown, revoked, other-branch and other-company cards give
  identical status and body; a completed-key replay returns the stored body and is not counted; RLS hides another tenant's
  cards. Sources: `docs/specs/032-staff-clock-by-card/spec.md`, `docs/adr/0036-card-clock-credentials-and-access.md`,
  `apps/api/src/modules/staff/http/{employee-cards,clock-by-card}.controller.ts`, `apps/admin/src/staff/ui/employee-card-*.tsx`,
  `apps/pos/src/attendance/{api,ui}/*card*`, `packages/contracts/src/staff/{employee-cards,clock-by-card}.ts`,
  `packages/i18n/src/clock-card-catalog.ts`, migrations `0085`–`0087`.
