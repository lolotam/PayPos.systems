# 03 · Pairing a POS device — ربط جهاز الكاشير

**Status / الحالة:** shipped in #55 (PR 3). Local only for now. The manager's side (issuing the code, approving
the device) has no admin screen yet, so steps 1 and 4 use the API directly.

**Before you start / قبل ما تبدأ:** [00 Local setup](00-local-setup.md); a manager user with
`manage:devices:branch` on the branch; the branch id. Use a current Chrome, Edge, Safari or Firefox.

## العربي

1. **المدير يطلع كود ربط** (لسه من غير شاشة): Claude يبعت
   `POST /v1/branches/{branchId}/devices/pairing-code` بجلسة المدير ← بيرجع كود من 8 حروف، صالح 10 دقايق.
2. على جهاز الكاشير افتح `http://localhost:5173` ← شاشة **ربط هذا الجهاز** بالعربي.
3. اكتب **كود الربط** و **اسم الجهاز** (مثلاً "كاشير 1") ← **ربط**.
   - كود غلط أو قديم: رسالة إن الكود مش صحيح.
   - كود صح: شاشة **في انتظار الموافقة**.
4. **المدير يوافق** (لسه من غير شاشة): Claude يبعت
   `POST /v1/branches/{branchId}/devices/{deviceId}/approve`.
5. خلال 15 ثانية الجهاز يكمّل لوحده ويفتح شاشة **الحضور** ومكتوب عليها رقم الفرع.
6. اقفل المتصفح وافتحه تاني ← يفتح على **الحضور** على طول (الجهاز فاكر نفسه).
7. افصل النت وافتح الصفحة ← رسالة **غير متصل** مع زرار **إعادة المحاولة**، والجهاز ما يتفكّش ربطه.
8. لو المدير شال الجهاز (`…/revoke`) ← في التشغيل الجاي يرجع لشاشة الربط ومعاها رسالة إن الجهاز اتشال.
9. زرار **البدء من جديد** في شاشة الانتظار ← يرجع لشاشة الربط.

**ممنوع يحصل:** فك ربط الجهاز لما النت يقطع؛ ظهور التوكن في الصفحة أو في الرابط.

## English

1. The manager issues a code (no screen yet): `POST /v1/branches/{branchId}/devices/pairing-code` with the
   manager's session → an 8-character code, valid 10 minutes.
2. Open `http://localhost:5173` → **Pair this device** (ربط هذا الجهاز).
3. Enter **Pairing code** (كود الربط) and **Device name** (اسم الجهاز) → **Pair** (ربط). A wrong or expired code
   shows an error; a valid one shows **Waiting for approval** (في انتظار الموافقة).
4. The manager approves: `POST /v1/branches/{branchId}/devices/{deviceId}/approve`.
5. Within 15 seconds the device continues by itself to **Attendance** (الحضور) showing the branch id.
6. Close and reopen the browser → straight to **Attendance**.
7. Go offline and reload → **Offline** with **Retry**; the device stays paired.
8. After `…/revoke`, the next start returns to pairing with "This device was removed. Pair it again."
9. **Start over** (البدء من جديد) on the waiting screen returns to pairing.

**Must NOT happen:** unpairing on a network error; the device token visible on the page or in a URL.

## For an agent

- Device credentials live in IndexedDB `pospay-pos`; never read or print the token.
- Waiting polls every 15 s (60 s after a 429): allow up to 20 s for step 5.
