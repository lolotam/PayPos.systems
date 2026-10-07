# 26 · Clock in and out from the personal phone — تسجيل الحضور والانصراف من الهاتف الشخصي

**Status / الحالة:** shipped in #99 (PR 22, merged). POS not deployed. **OTP sending is OFF** until the Meta templates and
secrets are approved ([22](22-personal-phone-passkey.md)), so the personal session this journey needs exists **only in
tests and local seams today**; an ordinary local browser cannot sign in to reach the screen, and no real-phone biometric
run is possible yet. The screen and both API routes are built and covered by tests with a synthetic authenticator.
**Since shipped:** the card clock at reception (PR 23, #120 and #121 — see [30](30-employee-cards-and-clock-by-card.md)) and the suspected / missed-out job (PR 24, #105). **Not shipped yet:** the attendance board (PR 27)
and attendance correction. The shared-device installation signal is recorded from follow-up PR 22b, not here
([25](25-unbind-passkey.md)). Attendance never changes pay or commission. Your decisions of 2026-10-04 (AT-Q1 to AT-Q7) apply.

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md) with Redis running, then `pnpm db:migrate` and `pnpm db:seed` for the attendance
  tables and defaults. The company's `staff` feature must be enabled.
- The branch's rotating QR on its paired device ([09](09-attendance-qr.md)) and, for the geofence checks, branch
  coordinates saved on the branch. A synthetic employee linked to a synthetic user, attached to that branch on today's
  branch-local date, with an **active passkey binding** ([22](22-personal-phone-passkey.md); re-binding after a manager
  unbind is [25](25-unbind-passkey.md)).
- The personal session: only through the test seams of [22](22-personal-phone-passkey.md) (fixture OTP, synthetic
  WebAuthn authenticator, exact configured POS origin). Do not send real WhatsApp messages. The test harness needs a
  controlled clock for the 5-minute, 10-minute and 16-hour boundaries and a synthetic schedule for the lateness checks.
- Use placeholder phone, code and cookie values and synthetic coordinates only.

## العربي

1. الموظف يفتح رابطه الشخصي على موبايله ويدخل ([22](22-personal-phone-passkey.md))، وعنده ربط مفتاح مرور سارٍ ← يظهر
   **تم تسجيل مفتاح المرور. لتغييره اطلب من المدير فك الربط أولاً.** وتحتها قسم **تسجيل الحضور والانصراف** وفيه زرار
   **مسح رمز QR للفرع**. موظف لسه ما سجّلش مفتاح المرور ما يظهرلوش القسم ده. الحضور **أونلاين بس**: لو الإنترنت
   مفصول المسح ما بيكملش وتظهر **تعذر تسجيل الحركة. تأكد من الاتصال وامسح رمزًا جديدًا وافتح مفتاح المرور، أو استخدم بطاقة
   الحضور عند الاستقبال أو اطلب المساعدة من مديرك.** (بطاقة الحضور عند الاستقبال: [30](30-employee-cards-and-clock-by-card.md)).
2. دوس **مسح رمز QR للفرع** ← تفتح الكاميرا مع **وجّه الكاميرا إلى رمز الحضور المعروض في الفرع.** ووصف الكاميرا
   **كاميرا رمز الحضور**. وجّهها على الباركود المعروض على جهاز الفرع ([09](09-attendance-qr.md)). الصورة بتتفك جوه
   المتصفح ومش بتتبعت لأي مكان، والكاميرا بتقف قبل ما يظهر طلب مفتاح المرور. **إلغاء المسح** يقفلها ويرجّعك للزرار.
3. بعد المسح الموبايل بيطلب موقعك (لو رفضت أو فشل خلال 5 ثواني، المسح يكمل من غير موقع)، وتظهر **افتح مفتاح المرور
   لتسجيل الحركة…** ← افتح بالبصمة أو الوجه أو رمز القفل (نص النظام خاص بالموبايل). لازم تحقق من المستخدم؛ من غير
   تحقق أو بإثبات اتستخدم قبل كده ما يتسجلش حاجة.
4. **أول تسجيل:** من غير جلسة مفتوحة ← **تم تسجيل الحضور**. بعدها بأي وقت أقل من 16 ساعة ← مسح تاني ← **تم تسجيل
   الانصراف**. يوم الحضور هو تاريخ الدخول بتوقيت الفرع حتى لو الانصراف عدّى نص الليل.
5. **قاعدة الـ 5 دقايق:** مسح تاني خلال أقل من 5 دقايق من آخر حركة اتقبلت ← نفس النتيجة بالظبط (نفس الجلسة ونفس
   الوقت)، من غير حضور ولا انصراف جديد، ومن غير ما الفترة تتمدد مع كل محاولة. لسه لازم تفتح مفتاح المرور. عند 5 دقايق
   بالظبط الحركة التالية بتتقبل.
6. **قاعدة الـ 16 ساعة:** مفتوحة جلسة عمرها 16 ساعة بالظبط أو أكتر ← المسح ما يسجلش انصراف عادي: الجلسة القديمة بتتقفل
   كـ **MISSED_OUT** (انصراف مفقود) عند حد الـ 16 ساعة، وتفتح جلسة جديدة ← **تم تسجيل الحضور** و**أُغلقت الجلسة السابقة
   باعتبار الانصراف مفقودًا.** أقل من 16 ساعة بدقيقة ← انصراف عادي. مفيش ساعات ولا خصم بيتألّف من الجلسة المفقودة.
7. **الموقع (150 متر):** الحضور ما بيتمنعش أبدًا بسبب الموقع؛ اللي بيحصل إنه بيتسجل استثناء للمدير:
   - موقع الموبايل مش متاح (رفض الإذن أو انتهت المهلة) أو الفرع من غير إحداثيات ← **تم التسجيل مع استثناء للموقع:
     موقع الهاتف أو إحداثيات الفرع غير متاحة.**
   - المسافة عن الفرع ناقص دقة القراءة أكبر من 150 متر ← **تم التسجيل مع استثناء للموقع: خارج نطاق الفرع.** (150 متر
     بالظبط أو أقل ما فيهوش استثناء). القياس بالمسافة الفعلية على الكرة الأرضية مش بفرق الإحداثيات.
8. **التأخير (للتقرير بس):** مهلة 10 دقايق. الدخول خلال 10 دقايق من بداية الوردية (شاملة) ← صفر. بعدها بتتسجل كل
   الدقايق الكاملة من بداية الوردية من غير طرح المهلة (دخول متأخر 11 دقيقة يظهر 11). لو كان فيه وردية جارية فهي
   المرجع، وإلا أول وردية في يوم الدخول بالفرع؛ مفيش جدول ← صفر. بتظهر **دقائق التأخير للتقرير فقط، دون خصم عمولة:**
   والرقم لما يكون أكبر من صفر. القيمة بتتثبت وقت الدخول ولو الجدول اتعدل بعدها ما تتغيّرش.
9. **لازم تكون مربوط بالفرع بتاريخه:** الباركود بتاع فرع والموظف ما كانش مرتبط بيه في تاريخ اليوم المحلي للفرع (قبل
   ارتباطه، بعد نهايته، أو خارج فترة التعيين/العقد) ← ما يتسجلش حاجة وتظهر **تعذر تسجيل الحركة…**؛ ما فيش رجوع للفرع
   الأساسي لو الارتباط التاريخي مش موجود. الرد من الـ API نفس **المسار غير موجود** (`NOT_FOUND`، 404) لأي موظف أو
   فرع أو ربط غير متاح، مش بيكشف أنهي واحد.
10. **باركود ما ينفعش:** باركود أقدم من دقيقتين، أو لفرع تاني ← **الطلب غير صالح** (`BAD_REQUEST`، 400) وتظهر **تعذر
    تسجيل الحركة…** في الشاشة. تحدي مفتاح المرور صالح 120 ثانية ولعملية واحدة بس؛ إثبات ناقص تحقق المستخدم، أو اتكرر، أو
    لعملية تانية، أو بعد فك الربط أو تغيير نسخته ← **تعذر التحقق من مفتاح المرور.** (`PASSKEY_INVALID`، 400). مفتاح
    المرور وحده بدون QR صالح ما يسجّلش.
11. **الخروج أثناء العملية:** تسجيل الخروج، أو استبدال الجلسة، أو انقطاع الإنترنت وانت في نص المسح أو نص مفتاح المرور ←
    الكاميرا تقف وأي عملية معلقة ما بتتبعتش. تحديث الجلسة الروتيني ما بيقطعش المسح؛ بطلان مؤكد للجلسة بيقطعه ويمسح
    البيانات الخاصة.
12. **إعادة الإرسال والتدقيق:** نفس الطلب بنفس المفتاح بيرجّع نفس الرد (الشاشة بتستخدم رقم التحدي كمفتاح)؛ نفس المفتاح
    بجسم تاني ← **تم استخدام مفتاح Idempotency-Key مع طلب مختلف**. فشل في نص الحفظ بيرجّع كل حاجة (جلسة وتدقيق وحدث)
    ويحتاج إثبات مفتاح مرور جديد. كل حركة ناجحة بتطلّع `AttendanceClockedIn` أو `AttendanceClockedOut` أو
    `AttendanceMissedOut` في نفس المعاملة، ومفيش خصم ولا عمولة.

**ممنوع يحصل:**
- حضور يتسجل من غير جلسة شخصية سارية ومفتاح مرور مربوط بتحقق مستخدم جديد، أو جلسة الكاشير/Device/الإدارة تسجل حضور
  موظف، أو موظف يسجل لموظف تاني.
- أكتر من جلسة مفتوحة للموظف الواحد، حتى لو مسحتين في نفس اللحظة.
- الموقع يمنع الحضور (بدون إذن، أو برا النطاق، أو فرع بلا إحداثيات): بيتسجل استثناء وبس.
- التأخير يخصم عمولة أو أجر، أو الانصراف المفقود يخترع ساعات.
- مسح خلال أقل من 5 دقايق يعمل حركة جديدة أو يغيّر النتيجة الأولى.
- باركود قديم أو لفرع تاني يتقبل، أو موظف يسجل على فرع مش مربوط بيه بتاريخ اليوم.
- الكاميرا تفضل شغالة بعد الإلغاء/الخروج، أو صورة الكاميرا تتبعت للسيرفر، أو تسجيل أوفلاين في طابور.
- الإعلان إن OTP شغال دلوقتي، أو إن لوحة الحضور (PR 27) موجودة.

## English

1. The employee opens their personal link on their own phone and signs in ([22](22-personal-phone-passkey.md)), with a
   live passkey binding → "Your passkey is registered. Replacement requires your manager to unbind it first." and below it
   a **Clock attendance** section with a **Scan the branch QR** button. An employee who has not registered a passkey does
   not see this section. Attendance is **online only**: with no connection the scan does not proceed and "Attendance could
   not be recorded. Check your connection, scan a fresh QR and unlock your passkey, or use your attendance card at reception
   or ask your manager." appears (the attendance card at reception: [30](30-employee-cards-and-clock-by-card.md)).
2. Press **Scan the branch QR** → the camera opens with "Point your camera at the branch attendance QR." and the label
   **Attendance QR camera**. Aim it at the code on the branch device ([09](09-attendance-qr.md)). Frames are decoded in
   the browser and never leave it, and the camera stops before the passkey prompt appears. **Cancel scan** closes it and
   returns to the button.
3. After the scan the phone asks for your location (if refused or it fails within 5 seconds, the scan continues without
   it) and "Unlock your passkey to record attendance…" appears → unlock with fingerprint, face or screen lock (the system
   text belongs to the phone). User verification is required; without it, or with a proof already used, nothing is recorded.
4. **First scan:** with no open session → "Clocked in". Any later scan under 16 hours → "Clocked out". The working date is
   the clock-in date in the branch timezone, even if the clock-out crosses midnight.
5. **The 5-minute rule:** a second scan under 5 minutes after the last accepted one returns exactly the same result (same
   session and time), with no new clock-in or clock-out, and repeated attempts do not extend the window. The passkey is
   still required. At exactly 5 minutes the next transition is accepted.
6. **The 16-hour rule:** with an open session 16 hours old or more, the scan does not record a normal clock-out: the old
   session is closed as **MISSED_OUT** at its 16-hour limit and a new one opens → "Clocked in" and "The previous session was
   closed as a missed clock-out." One minute under 16 hours is an ordinary clock-out. No hours or deduction are invented
   from a missed session.
7. **Location (150 m):** attendance is never blocked by location; an exception is recorded for the manager:
   - phone location unavailable (permission denied or timed out) or the branch has no coordinates → "Recorded with a location
     exception: no usable location or branch coordinates."
   - distance from the branch minus the reading's accuracy greater than 150 m → "Recorded with a location exception: outside
     the branch range." (exactly 150 m or less has no exception). Distance is measured on the sphere, not as a coordinate
     difference.
8. **Lateness (reporting only):** 10-minute grace. Clocking in within 10 minutes of the shift start (inclusive) → zero.
   After that the full elapsed whole minutes from the shift start are recorded with no grace subtracted (11 minutes late shows
   11). A shift in progress is the reference, otherwise the first shift on the clock-in day at that branch; no schedule means
   zero. "Reported late minutes (no commission deduction):" appears with the number when it is above zero. The value is fixed at
   clock-in and does not change if the schedule is edited later.
9. **Attached to that branch on that date:** the QR belongs to a branch and the employee was not attached to it on the branch's
   local date (before the attachment, after its end, or outside the hire/contract period) → nothing is recorded and "Attendance
   could not be recorded…" appears; there is no fallback to the primary branch when the historical attachment is missing. The API
   answers the same "Not found" (`NOT_FOUND`, 404) for any unavailable employee, branch or binding, without saying which.
10. **A QR that does not work:** a code older than two minutes, or another branch's → "The request is malformed"
    (`BAD_REQUEST`, 400), and the screen shows "Attendance could not be recorded…". A passkey challenge lasts 120 seconds and
    covers one operation; a proof missing user verification, replayed, for another operation, or after the binding was
    unbound or its version changed → "The passkey could not be verified." (`PASSKEY_INVALID`, 400). A passkey alone without a
    valid QR records nothing.
11. **Leaving mid-way:** sign-out, session replacement, or going offline during the scan or the passkey step → the camera
    stops and no pending request is submitted. Routine session refresh does not interrupt a scan; a confirmed invalidation
    does, and clears private data.
12. **Retries and audit:** the same request with the same key returns the same answer (the screen uses the challenge id as
    the key); the same key with another body → "This Idempotency-Key was already used with a different request". A failure
    mid-save rolls back everything (session, audit, event) and needs a fresh passkey proof. Each successful clock emits
    `AttendanceClockedIn`, `AttendanceClockedOut` or `AttendanceMissedOut` in the same transaction; there is no deduction and no
    commission.

**Must NOT happen:**
- Attendance recorded without a live personal session and a bound passkey with fresh user verification, a kiosk/Device/admin
  session clocking an employee, or one employee clocking for another.
- More than one open session for one employee, even with two simultaneous scans.
- Location blocking attendance (no permission, out of range, or a branch with no coordinates): it only records an exception.
- Lateness deducting commission or pay, or a missed clock-out inventing hours.
- A scan under 5 minutes creating a new movement or changing the first result.
- An old or other-branch QR accepted, or clocking at a branch the employee is not attached to on that date.
- The camera staying on after cancel or sign-out, camera images reaching the server, or an offline scan queued.
- Claiming OTP sign-in works today, or that the attendance board (PR 27) exists.

## For an agent

- POS: `/personal?company=<COMPANY_ID>&business=<BUSINESS_ID>` at the configured POS origin, reached only through the personal
  session test seams of [22](22-personal-phone-passkey.md). The section is found by its heading **Clock attendance**; buttons
  by exact text (**Scan the branch QR**, **Cancel scan**); the video by label **Attendance QR camera**. Progress is `role=status`
  ("Unlock your passkey to record attendance…", the result lines) and failure `role=alert`. The scanned QR value is the JSON
  token `{ "branch_id", "window", "sig" }` issued for the branch ([09](09-attendance-qr.md)). Camera, geolocation and passkey
  prompts need a controllable fixture; component tests mock the personal calls, and a real phone cannot be used until OTP delivery
  is approved. Assert that going offline hides the flow and queues nothing.
- API (personal cookie `pospay-personal.session_token`, exact configured `Origin`, no Device header; kiosk, device, admin
  credentials and employee selectors are refused; `Cache-Control: no-store`):

  ```http
  POST /v1/staff/attendance/challenge
  Content-Type: application/json

  { "token": { "branch_id": "<BRANCH_ID>", "window": <MINUTE_WINDOW>, "sig": "<64_HEX>" }, "location": { "lat": <LAT>, "lng": <LNG>, "accuracy": <METRES> } }
  ```

  → 200 `{ challenge_id, options }` requiring user verification (`location` optional). Then
  `POST /v1/staff/attendance/clock` with the same `token`/`location`, `challenge_id`, the WebAuthn assertion `response`
  from a real or synthetic authenticator, and `Idempotency-Key: <challenge_id>` → 200
  `{ session_id, operation: "CLOCK_IN" | "CLOCK_OUT", working_date, accepted_at, exceptions: ("NONE" | "OUT_OF_RANGE")[], late_minutes, missed_session_id }`.
  `missed_session_id` is set only when a 16-hour-old session was closed as missed. Use
  `apps/api/src/modules/staff/__tests__` fixtures and `packages/auth/src/__tests__/webauthn.fixture.ts`; curl alone cannot
  produce the assertion. Replay with the same key returns the identical body; a changed body → `IDEMPOTENCY_KEY_REUSED`.
- Assertions with a controlled clock: clock-in/out/missed transitions at 15:59 and exactly 16:00 hours; dedupe at 4:59 and
  exactly 5:00 minutes; lateness 10:00 → 0, 11:00 → 11, no schedule → 0; geofence at 150 m exactly vs 150.001 m with
  accuracy 0, and accuracy subtracted; denied location and branch with no coordinates → `NONE`; Kuwait and daylight-saving
  working dates and overnight closure keeping the original working date; non-primary-branch attachment on both sides of
  local midnight and its exclusive end. One injected clock instant is sampled after the attendance state and all eligibility
  locks (company, ordered memberships, employee, active binding, branch); an expired membership while waiting cannot clock.
  Exactly one OPEN session per employee (partial unique index). Challenge metadata holds scope, operation, binding revision and
  a digest of the QR and location, never the assertion. Unbind or re-enrolment between challenge and clock → refusal.
  A rolled-back clock leaves no session, audit, outbox or key. Unknown, other-tenant and inaccessible resources share
  `NOT_FOUND`. Cross-tenant reads of the four attendance tables return no rows (forced RLS).
  Sources: `docs/specs/027-staff-clock-attendance/spec.md`, `docs/adr/0028-attendance-serialization.md`,
  `docs/specs/phase-1/SPEC.md` §7, `apps/pos/src/personal-staff/{ui/clock-attendance-screen,ui/attendance-camera,api/use-clock-attendance,api/attendance-calls}.ts*`,
  `apps/api/src/modules/staff/http/clock-attendance.controller.ts`, `apps/api/src/modules/staff/domain/clock-attendance.ts`,
  `packages/contracts/src/staff/clock-attendance.ts`, `packages/i18n/src/{attendance-en,attendance-ar,en,ar}.ts` and
  `apps/api/src/shared/errors.ts`.
