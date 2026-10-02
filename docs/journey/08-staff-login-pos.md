# 08 · Staff sign-in on the POS — دخول الموظف على جهاز الكاشير

**Status / الحالة:** shipped in #61 (PR 6). Local only (the POS is not deployed). **WhatsApp codes are off by
default**: live codes need Meta-approved templates and the WhatsApp secrets, which are not set yet. The **own-PIN**
path works today.

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md) and a paired POS device ([03](03-pos-device-pairing.md)).
- An employee user with an active membership on that branch that includes `login:staff:branch` (owner/admin
  authority alone is not enough). Ask Claude to prepare one.
- The employee's phone must be an **approved phone binding** on their user: an operator runs
  `pnpm --filter @pospay/api platform:bind-phone` for it (the PIN reset does not create it). Ask Claude to do it.
- The employee's own four-digit PIN. There is no screen for it yet: a manager with `manage:memberships:company`
  sets it through `POST /v1/staff-pins/reset` — ask Claude to set a test PIN.
- Keep WhatsApp codes off (`STAFF_OTP_ENABLED` empty) but set `STAFF_OTP_POS_ORIGIN=http://localhost:5173` (and keep
  it in `AUTH_TRUSTED_ORIGINS`): without the POS origin every PIN sign-in is refused.

## العربي

1. افتح تطبيق الكاشير على الجهاز المربوط ← شاشة **دخول الموظف** فيها خانة **رقم الهاتف الدولي** و**لغة الرمز** وزرار
   **طلب الرمز**.
2. **واتساب مقفول (الوضع الافتراضي):** اكتب رقم بصيغة دولية واختار اللغة ودوس **طلب الرمز** ← تظهر **الدخول بواتساب غير متاح. اطلب
   مساعدة المدير للدخول بالرقم السري الخاص بك.** مفيش رسالة بتتبعت، ومفيش أي حاجة بتقول الرقم ده موجود ولا لأ.
3. دوس **استخدام الرقم السري الخاص بي** ← نموذج جديد فاضي فيه **رقم الهاتف الدولي** و**الرقم السري الخاص بك للكاشير
   (٤ أرقام)**. اكتب رقم الموظف تاني (ما بيتنقلش من الخطوة 2).
4. اكتب رقم سري غلط ودوس **الدخول بالرقم السري الخاص بي** ← **تعذر الدخول. تحقق من الرقم السري الخاص بك أو اطلب مساعدة المدير.** (نفس الرسالة لأي سبب
   رفض، عشان محدش يعرف إذا كان الموظف موجود).
5. اكتب الرقم السري الصح ودوس **الدخول بالرقم السري الخاص بي** ← تظهر **الموظف مسجل الدخول** و**تنتهي الجلسة خلال …
   دقيقة**.
6. **تغيير المشغّل:** دوس **تغيير مشغل الجهاز** ← نموذج الدخول يظهر تاني؛ دخول موظف تاني بيقفل جلسة الأول (موظف
   واحد على الجهاز في أي وقت). **الرجوع للمشغل الحالي** بيلغي التغيير.
7. **خروج** ← يرجع لشاشة **دخول الموظف**. ربط الجهاز نفسه بيفضل زي ما هو.
8. اقفل الإنترنت ← **اتصل بالإنترنت للدخول أو التحقق من جلسة الموظف.** الدخول ما بيشتغلش أوفلاين أبدًا.
9. **الجلسة:** بتنتهي بعد 8 ساعات بالظبط من الدخول، حتى لو الموظف شغال (مفيش تجديد تلقائي).
10. **بعد تفعيل واتساب (لاحقًا):** الرمز 6 أرقام صالح 5 دقايق، وطلب رمز جديد بعد 60 ثانية (**ثوانٍ حتى طلب رمز
    جديد**)، وبحد أقصى 5 طلبات للرقم و20 لكل IP في الساعة. الرقم اللي رد "إيقاف" على واتساب ما يوصلوش رمز.

**ممنوع يحصل:** الدخول أوفلاين؛ رسالة تكشف إن رقم أو موظف موجود؛ اتنين موظفين داخلين على نفس الجهاز في نفس الوقت؛
الرقم أو الرمز أو الرقم السري يظهر في الـ logs أو يتخزن على الجهاز؛ جلسة تعدّي 8 ساعات.

## English

1. Open the POS on the paired device → **Staff sign-in** (دخول الموظف) with **International phone number**,
   **Code language** and **Request code** (طلب الرمز).
2. **WhatsApp off (default):** enter an international number, choose a language, press **Request code** → "WhatsApp
   sign-in is unavailable. Ask your manager for help using your own cashier PIN." Nothing is sent and nothing reveals whether the number exists.
3. Press **Use my cashier PIN** (استخدام الرقم السري الخاص بي) → a new, empty form with **International phone
   number** and **Your own four-digit cashier PIN**. Enter the employee's phone again (it is not carried over from step 2).
4. A wrong PIN + **Sign in with my PIN** → "Sign-in was refused. Check your own PIN or ask your manager for help." — the same message for every
   refusal reason.
5. The right PIN + **Sign in with my PIN** → **Staff signed in** and "Session ends in … minutes".
6. **Change operator** (تغيير مشغل الجهاز) shows the form again; a second employee signing in ends the first session
   (one operator per device). **Return to current operator** cancels.
7. **Sign out** (خروج) → back to **Staff sign-in**; the device stays paired.
8. Go offline → "Reconnect to sign in or validate your staff session." Sign-in never works offline.
9. **Session:** ends exactly 8 hours after sign-in, even while in use (no renewal, no idle timeout).
10. **Once WhatsApp is enabled (later):** a 6-digit code valid for 5 minutes, a new code after 60 seconds
    ("New code in seconds:"), at most 5 requests per phone and 20 per IP per hour; a phone that replied STOP gets no
    code.

**Must NOT happen:** offline sign-in; any message revealing that a phone or employee exists; two employees signed in
on one device at once; the phone, code or PIN in logs or stored on the device; a session longer than 8 hours.

## For an agent

- POS at `http://localhost:5173`; find controls by visible text (Arabic or English above).
- API checks (device routes): `POST /v1/devices/me/staff-otp/request` → `503 OTP_UNAVAILABLE` while disabled;
  `GET /v1/devices/me/staff-session` after step 5 returns the session with its deadline;
  `POST /v1/devices/me/staff-session/sign-out` ends it. PIN sign-in is `POST /v1/devices/me/staff-pin/sign-in`.
- Offline: emulate offline in the browser; the reconnect message must appear and no request is queued.
