# 42 · Passkey phone lock — قفل الهاتف على موظف واحد

**Status / الحالة:** shipped in #144 (PR 21b, merged). A phone bound by passkey to one employee now **refuses another
employee's clock-in and enrolment**, and the employee clocks only from her own phone or with the reception card (two-way).
It **replaces the warn-only two-employees flag** of [25](25-unbind-passkey.md). The API is **live on staging** (api + worker
at commit `6c220e4`, 2026-10-11). The **admin and the POS are not deployed** (issue #54), so the screens run locally only.
**OTP sending is OFF** until the Meta templates and secrets are approved ([22](22-personal-phone-passkey.md)): the personal
session this journey needs exists **only in tests and local seams today**, and no real-phone run is possible yet; the
checks are made with a synthetic authenticator and two fixed installation ids. Your decisions of 2026-10-09 (UNB-Q2, block)
and 2026-10-10 (PL-Q1 to PL-Q4, all on the recommended option) apply; the design is ADR-0039:
[owner-questions.ar.md](../specs/043-staff-passkey-device-lock/owner-questions.ar.md). A browser cannot prove a physical device
without fingerprinting, so "phone" means the personal app's **installation id** kept in browser storage: two browsers on one
phone, or the home-screen app next to Safari, look like two phones (a stated residual risk).

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md) with Redis running, then `pnpm db:migrate` (the `installation_hash` column on
  `employee_passkeys` and the `attendance_device_refusals` table) and `pnpm db:seed`. API, admin and POS running; the
  company's `staff` feature enabled.
- Branch Salmiya with its rotating attendance QR ([09](09-attendance-qr.md)). Two synthetic employees, **Sara** and **Heba**,
  each linked to a **different** synthetic user, both attached to Salmiya. The personal session only through the test
  seams of [22](22-personal-phone-passkey.md) (fixture OTP, synthetic WebAuthn authenticator, exact configured POS origin).
- Two synthetic installations: **Phone X** (Sara's) and **Phone Y** (a second one). In the app each is a different browser
  profile; through the API each is a different `installation_id` UUID v4.
- A **Branch Manager** of Salmiya (to unbind, [25](25-unbind-passkey.md)) and the reception card device
  ([30](30-employee-cards-and-clock-by-card.md)). Never use real people or phones.

## العربي

1. **التسجيل بيقفل الهاتف:** على Phone X دخّل سارة (الجلسة الشخصية) ← **سجل مفتاح المرور من هذا الهاتف.** ← **تسجيل مفتاح
   مرور** ← **تم تسجيل مفتاح المرور. لتغييره اطلب من المدير فك الربط أولاً.** دلوقتي Phone X اتربط بسارة. في الأدمن، افتح
   **الموظفون** ← **عرض مفتاح المرور** لسارة ← بيظهر **مربوط منذ** وتحته **التليفون مربوط · منذ** وتاريخ القفل (بتوقيت
   الفرع) (`phone_locked`). التاريخ ما فيهوش أي بصمة للهاتف.
2. **هبة على هاتف سارة (DL-01):** على Phone X اخرج من سارة وادخل بهبة (جلستها هي). مسح QR الفرع ← **مسح رمز QR للفرع**
   ← الرفض **هذا الهاتف مسجّل لموظف آخر. سجّل الحضور من هاتفك أو بالبطاقة عند الاستقبال.**
   (`ATTENDANCE_DEVICE_LOCKED`، 403)، **قبل** طلب مفتاح المرور. محسبش حضور، ومفيش جلسة ولا تدقيق ولا حدث. سارة بتسجّل
   من Phone X عادي من غير أي خطوة زيادة (DL-02).
3. **ما تقدرش تسجّل مفتاحها على هاتف سارة (DL-05):** وهبة لسه على Phone X، حاول تسجّل مفتاح مرور ←
   **هذا الهاتف مسجّل لموظف آخر، فلا يمكن تسجيل مفتاح مرورك عليه. سجّل من هاتفك، واستخدم البطاقة عند الاستقبال حتى ذلك
   الحين.** (`PASSKEY_DEVICE_TAKEN`، 409). مفيش ربط ولا تدقيق ولا حدث. بدون القفل ده كان ممكن هبة تسجّل على هاتف سارة
   ويبقى القفل فاضي.
4. **القفل من الاتجاهين (PL-Q1، DL-04):** سارة نفسها على Phone Y (هاتف مش بتاعها): مسح QR ← **مفتاح المرور الخاص بك
   مسجّل على هاتف آخر. سجّل الحضور من ذلك الهاتف أو بالبطاقة عند الاستقبال، وإذا غيّرت هاتفك فاطلب من المدير فك
   الربط.** (`ATTENDANCE_DEVICE_NOT_ENROLLED`، 403)، ومن غير أي أثر على الحضور. نفس الرفض لو طلبت الـ challenge بس.
5. **هاتف واحد للشخص (PL-Q4، DL-07b):** سارة ليها سجل موظفة تاني في نشاط تاني من نفس الشركة، وبتسجّله من Phone Y ←
   **لديك مفتاح مرور مسجّل على هاتف آخر. سجّل من ذلك الهاتف، أو اطلب من المدير فك الربط إذا غيّرت هاتفك.**
   (`PASSKEY_OTHER_DEVICE`، 409). من Phone X بتتسجل عادي (DL-07): القفل على الشخص، مش على صف الموظف.
6. **التصريف لما الهاتف يضيع (PL-Q2، DL-08/09):** سارة غيّرت هاتفها. تسجيلها من Phone Y مرفوض (الخطوة 4)، وبتسجّل
   بالبطاقة عند الاستقبال ([30](30-employee-cards-and-clock-by-card.md)). مدير سالمية يفتح **عرض مفتاح المرور** لسارة ←
   تحت التحذير سطر **فك ربط البصمة بيحرر التليفون كمان.** ← سبب `new phone` ← **فك ربط مفتاح المرور** ← **تم فك الربط.
   يمكن للموظف التسجيل من جديد.** الخطوة 5 ربطت سجلها التاني بـ Phone X كمان، فمدير النشاط التاني لازم يفك ربطه بنفس الطريقة. بعد فك الربطين الهاتف X اتحرر: هبة تقدر تسجّل عليه، وسارة تسجّل من Phone Y وهو بقى قفلها. مفيش نقل
   بنفسها.
7. **ربط قديم من قبل القفل (DL-10):** ربط اتعمل قبل #144 (من غير هاتف مسجّل) بيتربط بالهاتف اللي يتقبل منه **أول تسجيل
   حضور ناجح**، إلا لو الهاتف ده تبع شخص تاني (يترفض زي الخطوة 2).
8. **الكارت مش متأثر (DL-11):** على جهاز الاستقبال، هبة أو سارة أو أي موظفة بتسجّل بالكارت ([30](30-employee-cards-and-clock-by-card.md))
   زي ما هو بالظبط، من غير أي هاتف.
9. **التخزين المحظور:** متصفح مانع تخزين الموقع (نافذة خاصة مثلاً) ← **التخزين محظور في هذا المتصفح، فلا يمكن التعرّف على
   هذا الهاتف. اسمح بحفظ بيانات الموقع أو افتح التطبيق من الشاشة الرئيسية، أو استخدم البطاقة عند الاستقبال.** وما
   بيتبعتش أي طلب (من غير معرّف جلسة صفحة). التسجيل برضه بيترفض بنفس الرسالة.
10. **المحاولات المرفوضة بتتسجل للمدير (PL-Q3، DL-12):** كل رفض في الخطوات 2 و3 و4 و5 بيكتب صف في
    `attendance_device_refusals` **بعد** ما المعاملة المرفوضة تخلص: مين حاول، صاحب الهاتف (لو شخص تاني)، الفرع، الخطوة
    (`CHALLENGE` أو `CLOCK` أو `ENROL`)، السبب، بصمة الهاتف المفصولة بالشركة، والوقت. صف واحد على الأكتر لكل موظفة وخطوة
    وهاتف كل 60 ثانية. مفيش إشعار فوري لحد. **مفيش شاشة تعرضهم لسه**: القراءة جاهزة وبتتعرض على لوحة الحضور في PR 27. لو
    كتابة الصف فشلت، الموظفة برضه تاخد نفس رسالة الرفض.

**ممنوع يحصل:**
- هاتف مربوط بسارة يسجّل حضور أو انصراف أو مفتاح مرور لموظف تاني، أو سارة تسجّل من هاتف تاني غير هاتفها (غير البطاقة).
- هاتف واحد يبقى فيه ربطين نشطين لشخصين مختلفين في الشركة.
- رفض بيسيب جلسة حضور أو سطر تدقيق أو حدث أو مفتاح idempotency أو مفتاح مرور جديد.
- معرّف الهاتف الخام يوصل قاعدة البيانات أو اللوجات أو التدقيق أو الأحداث (البصمة المفصولة بالشركة بس).
- إشعار فوري للمدير عن محاولة مرفوضة، أو الكارت عند الاستقبال يتأثر بالقفل.
- فك ربط بدون سبب أو من غير صلاحية، أو هاتف يفضل مقفول بعد الفك.

## English

1. **Enrolment locks the phone:** on Phone X sign Sara in (personal session) → "Register your passkey on this phone." →
   **Register a passkey** → "Your passkey is registered. Replacement requires your manager to unbind it first." Phone X now
   belongs to Sara. In the admin open **Employees** → **View passkey** for Sara → "Bound since" and below it "Phone locked
   · Since" with the lock date (branch time) (`phone_locked`). The date carries no phone fingerprint.
2. **Heba on Sara's phone (DL-01):** on Phone X sign Sara out and sign Heba in (her own session). **Scan the branch QR** → the refusal "This phone is registered to another employee. Clock in from your own phone or with the card at
   reception." (`ATTENDANCE_DEVICE_LOCKED`, 403), **before** the passkey prompt. No attendance, no session, no audit, no
   event. Sara still clocks from Phone X with no extra step (DL-02).
3. **She cannot enrol hers on Sara's phone (DL-05):** with Heba still on Phone X try to register a passkey → "This phone is
   registered to another employee, so your passkey cannot be enrolled on it. Enrol from your own phone; until then, use
   the card at reception." (`PASSKEY_DEVICE_TAKEN`, 409). No binding, no audit, no event. Without this, Heba could enrol on
   Sara's phone and the lock would be empty.
4. **The lock works both ways (PL-Q1, DL-04):** Sara herself on Phone Y (not her phone): scan the QR → "Your passkey is
   registered on another phone. Clock in from that phone or with the card at reception. If you changed phones, ask your
   manager to unbind it." (`ATTENDANCE_DEVICE_NOT_ENROLLED`, 403), with no effect on attendance. Requesting only the
   challenge is refused the same way.
5. **One phone per person (PL-Q4, DL-07b):** Sara has a second employee record in another business of the company and
   enrols it from Phone Y → "You already have a passkey on another phone. Enrol from that phone, or ask your manager to
   unbind it if you changed phones." (`PASSKEY_OTHER_DEVICE`, 409). From Phone X it enrols normally (DL-07): the lock
   belongs to the person, not to the employee row.
6. **When a phone is lost (PL-Q2, DL-08/09):** Sara changed phones. Clocking from Phone Y is refused (step 4); she clocks
   with the reception card meanwhile ([30](30-employee-cards-and-clock-by-card.md)). The Salmiya manager opens **View
   passkey** for Sara → under the warning the line "Unbinding the passkey also frees the phone." → reason `new phone` →
   **Unbind passkey** → "Passkey unbound. The employee can enroll again." Step 5 also bound her second record to Phone X, so the other business's manager unbinds that one the same way. Only after both unbinds is Phone X free: Heba may enrol on it, and Sara
   enrols from Phone Y, which becomes her lock. There is no self-service move.
7. **A binding from before the lock (DL-10):** a binding made before #144 (no phone recorded) attaches to the phone from
   which its next **accepted clock** comes, unless that phone already belongs to another person (then refused as in
   step 2).
8. **The card is unaffected (DL-11):** on the reception device, Heba, Sara or anyone clocks by card
   ([30](30-employee-cards-and-clock-by-card.md)) exactly as before, with no phone involved.
9. **Blocked storage:** a browser that blocks site storage (a private window, for example) → "Storage is blocked in this
   browser, so this phone cannot be recognised. Allow site data or open the app from the home screen, or use the card at
   reception." No request is sent (no page-lifetime installation id). Enrolment is refused with the same message.
10. **Refused attempts are kept for the manager (PL-Q3, DL-12):** every refusal in steps 2, 3, 4 and 5 writes a row in
    `attendance_device_refusals` **after** the refused transaction ends: who tried, the owner of the phone (when another
    person), the branch, the step (`CHALLENGE`, `CLOCK` or `ENROL`), the reason, the company-separated phone hash and the
    time. At most one row per employee, step and phone per 60 seconds. No instant notification to anyone. **No screen shows
    them yet**: the read query is ready and the attendance board (PR 27) will list them. If the row write fails the
    employee still gets the same refusal message.

**Must NOT happen:**
- A phone bound to Sara recording attendance or a passkey for another employee, or Sara clocking from any phone but hers
  (the card aside).
- One phone holding active bindings of two different people in a company.
- A refusal leaving an attendance session, audit row, event, idempotency key or new passkey behind.
- The raw installation id reaching the database, logs, audit or events (only the company-separated hash).
- An instant notification to a manager about a refused attempt, or the reception card being affected by the lock.
- An unbind without a reason or permission, or a phone staying locked after the unbind.

## For an agent

- This journey needs a personal session, which exists only through the test seams of [22](22-personal-phone-passkey.md)
  while OTP sending is OFF. Use the synthetic authenticator and two fixed `installation_id` UUID v4 values for Phone X and
  Phone Y; do not send real WhatsApp messages.
- POS screens (personal staff route): the enrol button **Register a passkey** / **تسجيل مفتاح مرور** (disabled after a
  `PASSKEY_DEVICE_TAKEN` or `PASSKEY_OTHER_DEVICE` refusal); the clock section **Clock attendance** with **Scan the branch QR**; refusals appear as `role="alert"` with the exact texts above. Admin: **Employees** → **View passkey**; the lock
  line is a `<p>` "Phone locked · Since …" shown only when the employee is bound and locked; the unbind form shows
  "Unbinding the passkey also frees the phone."
- API (personal staff session, selected company; installation ids as UUID v4):
  - `POST /v1/staff/attendance/challenge` body gains optional `installation_id`; `POST /v1/staff/attendance/clock`
    (still requires `Idempotency-Key`; `installation_id` stays out of the request fingerprint). Refusals **403**
    `ATTENDANCE_DEVICE_LOCKED` (another person's phone) and **403** `ATTENDANCE_DEVICE_NOT_ENROLLED` (her own lock is a
    different phone). The decision at the clock is authoritative; the challenge decision is advisory.
  - `POST /v1/staff/passkey/options` (optional body `{ "installation_id": "<uuid>" }`) and `POST /v1/staff/passkey/verify`
    (gains optional `installation_id`). Refusals **409** `PASSKEY_DEVICE_TAKEN` and **409** `PASSKEY_OTHER_DEVICE`.
  - Decision order: another person's phone first (`DEVICE_LOCKED` or `DEVICE_TAKEN`), then her own lock elsewhere
    (`NOT_ENROLLED` or `OTHER_DEVICE`), then accept and attach the phone if the binding has none.
  - Manager read: `GET /v1/businesses/{businessId}/employees/{employeeId}/passkeys` → status now has `phone_locked:
    boolean` and `phone_locked_since` (no hash). Unbind is the existing [25](25-unbind-passkey.md) route and releases the
    phone in the same transaction.
- Assertions after a refusal: no attendance session, no `audit_log` row, no outbox event, no idempotency row, no
  `attendance_device_signals` row in the refused transaction; exactly one `attendance_device_refusals` row (and only one per
  60 s for repeats) holding the hash, never the raw id. No new permission; releasing needs the existing
  `unbind:passkeys:branch`.
- Sources: `docs/specs/043-staff-passkey-device-lock/spec.md`, `docs/adr/0039-passkey-installation-lock.md`,
  `apps/api/src/modules/staff/persistence/attendance-device-refusals.ts`,
  `apps/api/src/modules/staff/queries/attendance-device-refusals.query.ts`, `apps/admin/src/staff/ui/employee-passkey-section.tsx`,
  `apps/pos/src/personal-staff/ui/{enrol-passkey-screen,clock-attendance-screen}.tsx`, `packages/i18n/src/{ar,en}.ts`
  (`phoneLock`, `errors.ATTENDANCE_DEVICE_*`, `errors.PASSKEY_*`).
