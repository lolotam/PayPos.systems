# 22 · Personal phone passkey — مفتاح المرور على الموبايل الشخصي

**Status / الحالة:** shipped in #94 (PR 20, merged). POS not deployed; OTP sending is OFF until the Meta templates
and secrets are approved. Today the complete flow is test/local-only with the existing test seams; a normal local
browser cannot complete OTP sign-in while sending is disabled. Manager unbind comes in PR 21 and passkey clock-in
in PR 22; neither is shipped here. The employee uses their own phone, with a separate eight-hour absolute personal session.

**Before you start / قبل ما تبدأ:**
- Prepare a synthetic existing employee linked to a global user with an approved phone and a covering active membership
  in the chosen company/business. Enrollment creates no employee, user, membership or business permission.
- The manager supplies the POS link `/personal?company=<COMPANY_ID>&business=<BUSINESS_ID>`; replace IDs with synthetic
  workspace UUIDs. The employee opens it on their own phone, not the shared paired branch device.
  URL hints select the workspace; the server independently verifies eligibility.
- Ordinary local testing can inspect the link-required/phone/offline states and disabled-OTP refusal. Positive OTP/session/
  enrollment checks below require the existing isolated test fixtures or a local harness using those test seams.
  They capture a synthetic send job and provide a controlled OTP/WebAuthn response; they do not send WhatsApp messages or enable production delivery.
- WebAuthn requires a supported browser/authenticator, a secure context and the configured exact POS origin/RP ID.
  Local fixtures use `localhost`; a developer computer's localhost URL is not a usable phone LAN address.
  Do not substitute an unapproved LAN IP/origin. A real own-phone end-to-end run awaits an appropriately configured secure POS environment and approved OTP delivery.
- Use placeholder phone/code/cookie values and synthetic fixture data only. Prepare separate unbound and already-bound employees,
  a controlled clock for expiry checks and a second tab for logout/replacement checks. Never fetch OTPs or credentials from technical logs.

## العربي

1. الموظف يفتح رابط المدير على موبايله الشخصي ← **دخول الموظف من هاتفه الشخصي** ومعاه
   **استخدم هاتفك الشخصي لتسجيل البصمة أو الوجه أو رمز قفل الشاشة.** من غير شركة/نشاط صالحين في الرابط، وفي غياب جلسة شخصية، يظهر
   **اطلب من المدير رابط الدخول الشخصي الخاص بنشاطك.** بدل نموذج الدخول؛ الموظف مش بيكتب معرّفات الشركة والنشاط بإيده.
2. في التشغيل المحلي العادي، اكتب رقم fixture تجريبي في **رقم الهاتف الدولي** ← **طلب الرمز**.
   إرسال OTP مقفول لحد اعتماد قوالب Meta والأسرار؛ الطلب الصحيح من الـ API يرجع `OTP_UNAVAILABLE`، 503، والشاشة تعرض
   **الدخول بواتساب غير متاح. اطلب مساعدة المدير للدخول بالرقم السري الخاص بك.** ده نص الكتالوج المشترك؛ الرقم السري يخص
   دخول جهاز الفرع في [08](08-staff-login-pos.md)، ومش بديل لإصدار الجلسة الشخصية. النهارده مفيش رمز حقيقي ولا تسجيل مفتاح مرور من المسار ده.
3. كمل الفحص الإيجابي بالـ test seams بس: **طلب الرمز** ← طلب مقبول 202، من غير رمز في الرد.
   الـ tester يستخدم الرمز الصناعي من fixture، في **رمز من ستة أرقام** ← **دخول**؛ نجاح التحقق يصدر الجلسة الشخصية المحدودة.
   رمز غلط/منتهي/مستهلك يتمنع بـ **رمز الدخول غير صحيح.** (`OTP_INVALID`، 401). **البدء من جديد** يرجّع نموذج الرقم؛
   ده بدء طلب OTP جديد، مش زر إعادة تسجيل مفتاح المرور. قبل اعتماد الإرسال، ماتجربش وصول واتساب حقيقي أو إنشاء جلسة من رقم حقيقي.
4. الجلسة مدتها 8 ساعات من لحظة إصدارها؛ استخدام الشاشة أو إعادة فتحها ما يجددهاش. الـ agent يقدّم الساعة التجريبية:
   قبل النهاية الجلسة بنفس `expires_at`؛ عند تمام 8 ساعات الطلب محجوب ويحتاج OTP جديد. مفيش إعداد لمد المدة ولا تجديد تلقائي.
   كل طلب يعيد فحص الموظف وربطه بالمستخدم ورقمه المعتمد والعضوية السارية؛ صلاحية الجلسة الزمنية لوحدها مش كفاية.
5. لموظف لسه مش مربوط، تظهر **سجل مفتاح المرور من هذا الهاتف.** ← **تسجيل مفتاح مرور**.
   اتبع طلب نظام الموبايل باستخدام البصمة أو الوجه أو رمز قفل الشاشة؛ نص وأزرار النظام بيختلفوا ومش نصوص PosPay.
   أول تسجيل صالح يتربط تلقائيًا بالموظف، من غير موافقة مدير. البيانات البيومترية والمفتاح الخاص يفضلوا في الموبايل/المصادِق؛
   السيرفر يستقبل دليل WebAuthn والمفتاح العام، مش صورة البصمة أو الوجه أو رمز القفل.
6. بعد النجاح يظهر **تم تسجيل مفتاح المرور. لتغييره اطلب من المدير فك الربط أولاً.** وزر **تسجيل مفتاح مرور** يختفي.
   فحص API من نفس الجلسة يحاول تسجيل تاني ← **تم ربط مفتاح مرور بالفعل. اطلب من المدير فك الربط أولاً.**
   (`PASSKEY_ALREADY_BOUND`، 409)، والربط الأول ما يتغيرش. فك الربط للمدير في PR 21 ولسه مش متاح؛ مفيش زر استبدال أو حذف هنا.
7. في fixture تانية لسه مش مربوطة، الغِ طلب الموبايل أو خلّي التحقق يفشل ← **تعذر التحقق من مفتاح المرور.**
   زر **تسجيل مفتاح مرور** يفضل متاح بعد انتهاء المحاولة؛ دوسه تاني على نفس الموبايل، بمراسم وتحدٍّ جديدين، وكمل ← ربط واحد صالح.
   لو الإنترنت فصل تظهر **اتصل بالإنترنت للدخول أو تسجيل مفتاح المرور.**؛ ارجع متصل وابدأ محاولة جديدة بعد التحقق من الجلسة.
   المحاولة الفاشلة ما تتسجلش في طابور offline، وما تفعّلش credential يتيمة أو تستبدل ربط موجود.
8. الجلسة دي للموظف نفسه بس: تسجيل مفتاح المرور، قراءة حالته وجدوله الشخصي من الـ API، والخروج.
   الجلسة دي ما تفتحش بيع POS أو لوحة الإدارة أو صلاحيات نشاط. الـ agent يجرب بيها APIs جلسة الكاشير ولوحة الإدارة والعضويات ومساحات العمل والمصادقة العامة ← مرفوضة؛
   تغيير الشركة في header أو استخدام cookie الشخصية كجلسة عادية ما يفتحش صلاحيات نشاط، حتى لو الشخص معاه صلاحيات في جلسة منفصلة.
   التسجيل ما يعملش حضور أو وردية كاشير أو عملية بيع. تسجيل الحضور بمفتاح المرور ييجي في PR 22؛ مفيش زر حضور في الرحلة دي.
9. دوس **تسجيل الخروج** ← الجلسة الشخصية تنتهي، ونماذجها وبياناتها الخاصة تتمسح من التبويبات؛ الربط نفسه يفضل محفوظ.
   دخول OTP شخصي جديد ناجح لنفس المستخدم يلغي جلساته الشخصية الأقدم؛ التبويب القديم ما يحتفظش ببيانات الموظف.
   ده ما يفكش ربط جهاز الفرع وما يلغيّش جلسة الإدارة. الـ agent يراجع إلغاء أهلية الموظف أثناء الجلسة:
   الطلب الشخصي التالي يتمنع والبيانات الخاصة تختفي، من غير عرض نسخة قديمة بعد فشل فحص الجلسة.

**ممنوع يحصل:**
- اعتبار إرسال OTP متاح دلوقتي، أو تحويل الـ test seams لباب دخول إنتاجي، أو استخراج رمز/مفتاح من الردود أو اللوجات.
- فتح المسار الشخصي على جهاز الفرع باعتباره تسجيل الموظف من موبايله، أو اعتبار معرّفات الرابط تفويضًا، أو إنشاء هوية/عضوية جديدة بالتسجيل.
- جلسة شخصية تتجدد بعد 8 ساعات أو تفضل مصرح بها بعد زوال أهلية الموظف، أو تفتح بيع/إدارة/صلاحيات نشاط أو مصادقة عامة.
- بصمة/وجه/رمز قفل أو مفتاح خاص يخرج للسيرفر، أو اعتبار نجاح fixture إثبات تجربة بيومترية على موبايل حقيقي.
- مفتاح تاني يستبدل الأول من غير فك ربط المدير، أو إعادة المحاولة تفعّل credential يتيمة أو تعمل أكتر من ربط نشط.
- تخزين رمز/تحدٍّ/بيانات credential في الـ PWA أو طابور offline؛ خروج/تبديل جلسة يسيب بيانات شخصية قديمة أو يلغي ربط الجهاز/جلسة الإدارة.
- وصف فك الربط PR 21 أو تسجيل الحضور PR 22 كميزة موجودة، أو التسجيل يفتح حضور/وردية/بيع.

## English

1. The employee opens the manager's link on their own phone → **Personal staff sign-in** and
   "Use your own phone to register your fingerprint, face or screen lock." With missing/invalid company/business hints
   and no personal session, "Ask your manager for your personal sign-in link." replaces the form.
   Employees do not manually enter workspace IDs.
2. In an ordinary local run, enter a synthetic fixture phone in **International phone number** → **Request code**.
   OTP sending remains OFF until Meta templates/secrets are approved; a valid API request returns `OTP_UNAVAILABLE`, 503.
   The screen shows "WhatsApp sign-in is unavailable. Ask your manager for help using your own cashier PIN."
   This is the shared catalog text: PIN recovery belongs to the branch-device flow in [08](08-staff-login-pos.md),
   and cannot issue a personal session. No real code or passkey enrollment is available through this path today.
3. Continue positive checks only with the test seams: **Request code** → accepted 202, with no OTP in the response.
   Use the fixture's synthetic code in **Six-digit code** → **Sign in**; successful verification issues the limited personal session.
   Wrong/expired/consumed code → "The sign-in code is not valid." (`OTP_INVALID`, 401).
   **Start again** returns to the phone form for a new OTP request; it is not the passkey retry control.
   Before sending approval, do not try real WhatsApp delivery or personal-session issuance with a real phone.
4. The session lasts eight hours from issuance; use/reopening never renews it. The agent advances a controlled clock:
   before expiry, `expires_at` stays fixed; at exactly eight hours, requests fail and a new OTP sign-in is needed.
   No lifetime setting or automatic renewal exists. Every request rechecks employee/user linkage, approved phone and active membership;
   an unexpired deadline alone cannot authorize the session.
5. For an unbound employee, "Register your passkey on this phone." → **Register a passkey**.
   Follow the phone's fingerprint, face or screen-lock prompt; its wording/buttons are platform-specific, outside PosPay's catalog.
   The first valid enrollment binds automatically without manager approval. Biometric data/private keys remain on the phone/authenticator;
   the server receives WebAuthn proof/public key, never fingerprint/face images or the screen-lock code.
6. Success shows "Your passkey is registered. Replacement requires your manager to unbind it first."
   The **Register a passkey** button disappears. An API attempt to enroll again in that session
   → "A passkey is already bound. Ask your manager to unbind it first." (`PASSKEY_ALREADY_BOUND`, 409), leaving the first binding unchanged.
   Manager unbind comes in PR 21 and is not available yet; this screen has no replace/delete control.
7. On a separate unbound fixture, cancel the phone ceremony or fail verification → "The passkey could not be verified."
   **Register a passkey** remains available after the attempt finishes. Retry on the same phone with a fresh ceremony/challenge
   → one valid binding. Offline shows "Reconnect to sign in or register a passkey."; reconnect, revalidate the session and start afresh.
   Failed enrollment is never queued offline and cannot activate an orphan credential or replace an existing binding.
8. This session is limited to the employee's own enrollment, binding status, personal schedule API and sign-out.
   It cannot authorize POS selling, admin or business permissions. The agent uses it against kiosk-session, admin, membership,
   workspace and generic-auth APIs → refused.
   Changing company headers or substituting its cookie for ordinary authentication grants no business permissions,
   even if the person has them in a separate session. Enrollment creates no attendance, cash shift or sale.
   Passkey clock-in comes in PR 22; this journey has no clock-in button.
9. **Sign out** ends the personal session and clears personal forms/data across tabs; the passkey binding remains.
   A successful new personal OTP sign-in invalidates older personal sessions of the same user; old tabs must lose employee data.
   Pairing/admin sessions remain intact. The agent removes live employee eligibility during a session:
   the next personal request is refused and private data clears, without cached display after a failed session probe.

**Must NOT happen:**
- Claiming OTP sending works today, exposing test seams as production sign-in, or retrieving codes/keys from responses/logs.
- Treating the paired branch device as the employee's personal phone, URL hints as authority, or enrollment as identity/membership creation.
- Renewal beyond eight hours, access after employee eligibility ends, or personal-session selling/admin/business/generic-auth authority.
- Biometric/screen-lock/private-key data reaching the server, or treating fixtures as proof of real-phone biometric testing.
- A second passkey replacing the first without manager unbind; retry activating orphans or creating multiple active bindings.
- PWA/offline storage of OTP/challenge/credential material; stale private data after logout/replacement, or those actions clearing pairing/admin sessions.
- Presenting PR 21 unbind or PR 22 clock-in as shipped, or enrollment creating attendance/cash shifts/sales.

## For an agent

- POS entry: `/personal?company=<COMPANY_ID>&business=<BUSINESS_ID>`, supplied by the manager. For ordinary local browser checks,
  use the configured local POS origin; find `#personal-phone`, `#personal-code`, exact translated buttons/messages above,
  `role=status` for loading/offline and `role=alert` for failure. Code/enrollment controls require a successful previous stage.
  Without valid hints and without a session, assert link-required text. Offline must remove the active form; no queued ceremony.
- Disabled delivery: valid workspace/phone input from the configured origin → `POST /v1/staff/personal-otp/request`
  → 503 `OTP_UNAVAILABLE`. The phone UI maps request failure to that catalog message. No OTP response/log lookup,
  no personal PIN fallback and no ordinary runtime environment switch bypassing delivery approval.
  Do not claim a standalone local browser/dev server automatically includes the positive fixture wiring.
- Positive fixture path: `apps/api/test/personal-staff.fixture.ts` injects a READY synthetic OTP configuration, controlled sender/crypto,
  eligible synthetic employee and exact `http://localhost:5173` origin into an isolated app/test database.
  Captured jobs never call Meta; fixture `f.code(challengeId)` supplies the synthetic OTP only inside the test harness.
  `packages/auth/src/__tests__/webauthn.fixture.ts` supplies a cryptographically valid synthetic authenticator response;
  this checks ceremony/binding logic, not real-phone biometrics. POS component tests use mocked personal calls for UI states.
- API sequence with placeholders, exact configured `Origin`, JSON content type and no Device credential or authorization header:

  ```http
  POST /v1/staff/personal-otp/request
  Origin: <CONFIGURED_POS_ORIGIN>
  Content-Type: application/json

  { "company_id": "<COMPANY_ID>", "business_id": "<BUSINESS_ID>", "phone": "<SYNTHETIC_APPROVED_E164_PHONE>", "locale": "en" }
  ```

  READY test capability → 202 `{ status: "ACCEPTED", challenge_id, expires_in: 300, retry_after: 60, recovery: "ASK_MANAGER" }`.
  This uniform acceptance does not prove employee existence. Verify via `POST /v1/staff/personal-otp/verify` with
  `{ "company_id": "<COMPANY_ID>", "business_id": "<BUSINESS_ID>", "challenge_id": "<CHALLENGE_ID>", "code": "<SYNTHETIC_SIX_DIGIT_CODE>" }`
  → 200 `{ company_id, business_id, user_id, employee_id, expires_at }` plus the personal cookie.
  Wrong workspace, replay or ineligible employee cannot issue a session. Respect production cooldown/rate/STOP policy;
  a request response contains no code or credential.
- With the fixture's personal cookie and exact origin: `GET /v1/staff/personal-session` → context;
  `GET /v1/staff/passkey` → `{ bound, binding_id, revision, bound_at }`;
  `POST /v1/staff/passkey/options` → 200 `{ challenge_id, options }` for an unbound employee.
  Use the browser registration adapter or synthetic authenticator, then `POST /v1/staff/passkey/verify` with
  `{ "challenge_id": "<REGISTRATION_CHALLENGE_ID>", "response": <WEBAUTHN_REGISTRATION_RESPONSE> }` → 201 binding status.
  WebAuthn response is structured browser/fixture output, not a string or handwritten fake proof; curl alone cannot perform phone verification.
  No `Idempotency-Key`. First success has `bound: true`, revision 1, one active binding, audit and `EmployeePasskeyBound` outbox event.
- A bound employee's options/verify request → 409 `PASSKEY_ALREADY_BOUND`; UI instead shows the bound instruction and hides enrollment.
  The enrollment UI maps failed/cancelled attempts to `PASSKEY_INVALID` text; do not claim it displays the API's named bound refusal.
  Inject failure after global credential creation/before tenant binding, then retry fresh registration on the same authenticator:
  orphan stays inert and is excluded from active-binding exclusion lists; never reuse its old proof or add best-effort deletion.
- Cookie is `pospay-personal.session_token`, host-only, Secure, HttpOnly, SameSite=Lax, Path=/v1, with immutable
  `STAFF_PERSONAL` workspace/deadline. Use the controlled clock in `packages/auth/src/__tests__/personal-session.spec.ts`:
  deadline is issuance + 28,800,000 ms and never slides; expiry, approved-phone change, lost eligibility and purpose substitution fail.
  `auth.personal.issue` is an internal test seam, not a public bypass endpoint. Generic auth/plugin/passkey-login routes stay inaccessible.
- Personal cookie alone must fail admin/business/kiosk routes and cannot be combined with a Device header to acquire authority.
  `GET /v1/staff/my-schedule?branch_id=<OWN_BRANCH_ID>&week_start=<SATURDAY_DATE>` is own-employee-only;
  extra employee selectors are refused and inaccessible/unknown branches match. No schedule grid is promised on this entry screen.
  `POST /v1/staff/personal-session/sign-out` → 200 `{ status: "SIGNED_OUT" }` and cleared cookie.
  Assert cross-tab cache/form clearing on logout, session replacement, failed probes and offline transitions; pairing/admin state survives.
- Agent-only privacy checks: audit/outbox use safe binding metadata; technical logs contain no phone, OTP, private keys,
  credential IDs/public keys, WebAuthn challenges or responses. No owner log-access step. Enrollment records no attendance/cash shift.
  Sources: `docs/specs/024-staff-enrol-passkey/spec.md`, `docs/adr/0027-personal-staff-session.md`,
  `docs/adr/0013-passkey-and-platform-suppression.md` §§7–8, `apps/pos/src/personal-staff`, identity personal-session/OTP guards/controllers,
  staff passkey controller/eligibility/binding use cases, `packages/auth/src/personal-sessions.ts`,
  `apps/api/src/modules/staff/__tests__/personal-passkey.spec.ts`, `packages/contracts/src/staff/passkeys.ts`,
  `packages/i18n/src/{ar,en}.ts` and `apps/api/src/shared/errors.ts`.
