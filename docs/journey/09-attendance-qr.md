# 09 · The branch attendance QR — باركود الحضور على جهاز الفرع

**Status / الحالة:** shipped in #72 (PR 19, ADR-0020). Local only (the POS is not deployed). The paired device
shows the branch's attendance QR. **Scanning it to clock in comes later** (staff app + clock-in, PR 20–22); today
the code is shown and can be verified only through the API tests.

**Before you start / قبل ما تبدأ:** [00 Local setup](00-local-setup.md) with Redis running, and a paired POS device
([03](03-pos-device-pairing.md)). The branch timezone is the branch's own setting, else the business's, else
`Asia/Kuwait`.

## العربي

1. افتح تطبيق الكاشير على الجهاز المربوط ← تحت دخول الموظف هتلاقي قسم **الحضور** فيه **الفرع** واسمه، و**توقيت الفرع**
   (الساعة بتوقيت الفرع)، و**رمز الحضور** (QR).
2. **لازم تشوف:** تحت الرمز **يتجدد الرمز كل 60 ثانية. امسحه من تطبيق الموظفين.** — استنى دقيقة ← الرمز يتغيّر لوحده.
3. وأنت بيتحمّل: **جارٍ تحميل رمز حضور جديد…**
4. اقفل الإنترنت ← الرمز **يختفي** وتظهر **رمز الحضور يحتاج اتصالاً بالإنترنت. يتم إخفاء الرمز أثناء عدم الاتصال.**
   رجّع الإنترنت ← يظهر رمز جديد.
5. لو السيرفر مش قادر يجدد الرمز (مثلاً Redis واقف) ← **تعذر تحديث رمز الحضور. أعد الاتصال وحاول مرة أخرى.** — الرمز ما
   بيتطلعش من غير سرّ اليوم (الوضع الآمن).
6. **قاعدة الصلاحية:** الرمز صالح في دقيقته والدقيقة اللي بعدها بس؛ رمز اتصوّر من 3 دقايق مرفوض.
7. **نص الليل (قرارك 2026-10-03):** سرّ اليوم بيتغيّر نص الليل **بتوقيت الفرع**؛ رمز آخر دقيقة قبل نص الليل بيفضل صالح
   خلال أول دقيقة بعده بس.

**ممنوع يحصل:** الرمز يفضل ظاهر أوفلاين؛ رمز قديم (أكتر من دقيقتين) يتقبل؛ رمز فرع يتقبل لفرع أو شركة تانية؛ سرّ اليوم
يظهر في الشاشة أو الـ logs (الرمز فيه رقم الفرع والدقيقة والتوقيع بس).

## English

1. Open the POS on the paired device → below staff sign-in, an **Attendance** (الحضور) section with **Branch** and its
   name, **Branch time** (the clock in the branch timezone) and the **Attendance QR code**.
2. **You must see:** "This code refreshes every 60 seconds. Scan it from your staff app." — wait a minute and the code
   changes by itself.
3. While loading: "Loading a fresh attendance code…"
4. Go offline → the code is **hidden** and "Attendance QR needs an internet connection. The code is hidden while
   offline." appears; back online → a fresh code.
5. If the server cannot refresh it (for example Redis is down) → "The attendance code could not be refreshed.
   Reconnect and try again." — no code is issued without the day's secret (fails closed).
6. **Validity:** a code is accepted in its own minute and the next one only; a code photographed three minutes ago
   is refused.
7. **Midnight (your decision, 2026-10-03):** the daily secret rotates at midnight **branch time**; a code from the last
   minute before midnight stays valid only during the first minute after it.

**Must NOT happen:** a code still shown while offline; an old code (more than two minutes) accepted; one branch's code
accepted for another branch or company; the daily secret on screen or in logs (the code carries only the branch id,
the minute window and the signature).

## For an agent

- POS at `http://localhost:5173`; find the section by its heading text (Arabic or English above).
- The device calls `POST /v1/devices/me/attendance-qr` (device token) about once a minute.
- Offline: emulate offline in the browser and assert the QR image is removed and the offline message shown.
- Verification rules are covered by `apps/api/src/modules/staff/__tests__/attendance-qr.spec.ts` and the staff domain
  tests (DST days, branch overrides, the exact midnight boundary, the 60-second window).
