# 66 · Staff sign-out that always finishes — خروج الموظفة اللي دايمًا بيكمل

**Status / الحالة:** shipped in #597 (067-1: explicit, idempotent sign-out for the staff session and the personal
session, spec 067 Part A), merged. **No new screen:** the two existing **خروج** / **Sign out** buttons now get a clear
answer every time, so a device hand-over or a business switch ([63](63-native-app-shell.md)) can finish even when
the session had already ended. The API is on staging; the paired-device sign-out can be tried there with the PIN
sign-in ([08](08-staff-login-pos.md)), the personal one needs the OTP (**OFF**). **Not built:** Part B of spec 067
(the `back_office` hint in the personal session read).

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md) with the API and the POS; or the staging POS with a paired device
  ([03](03-pos-device-pairing.md)).
- A synthetic employee signed in on the paired device ([08](08-staff-login-pos.md)).

## العربي

1. **خروج عادي:** الموظفة داخلة على جهاز الكاشير وتدوس **خروج** ← بترجع لشاشة الدخول. الرد من السيرفر 200
   `SIGNED_OUT`. ربط الجهاز بيفضل زي ما هو.
2. **خروج مرتين:** نفس الطلب تاني (ضغطتين ورا بعض، أو تبويب تاني) ← 200 `NO_SESSION`، ومفيش رسالة خطأ.
3. **الجلسة خلصت قبلها:** الجلسة انتهت أو اتبدلت بدخول من موبايل تاني، وبعدين داست **خروج** ← 200 `NO_SESSION`،
   والشاشة بترجع للدخول عادي.
4. **من غير جلسة أصلًا:** طلب خروج من متصفح ما دخلش ← 200 `NO_SESSION` ومفيش كوكي بتتغير.
5. **موظفة اتشالت صلاحيتها:** موظفة اتوقفت أو اتفك ربط موبايلها ولسه عندها كوكي ← الخروج بينجح (`SIGNED_OUT`):
   إنهاء الجلسة ما بيحتاجش صلاحية.
6. **طلب مرفوض:** طلب من موقع تاني (`Origin` غلط) ← 403 `FORBIDDEN`، والجلسة لسه شغالة. ده عمره ما يتحسب خروج.
7. **السيرفر مش متظبط:** ← 503 `NOT_READY`، وبرضه مش خروج.

**ممنوع يحصل:**
- الخروج يرد 401.
- طلب مرفوض (403 أو 503) يتحسب إن الجلسة خلصت.
- الخروج من جلسة الموظفة يفك ربط الجهاز.
- الرد يكشف أي حاجة عن الجهاز أو الموظفة غير حالة الكوكي اللي اتبعتت.
- الكوكي أو التوكن يظهروا في اللوج.

## English

1. **A normal sign-out:** an employee signed in on the cashier device taps **Sign out** → back to the sign-in screen.
   The server answers 200 `SIGNED_OUT`. The device pairing stays.
2. **Signing out twice:** the same request again (a double tap, or another tab) → 200 `NO_SESSION`, no error message.
3. **The session had already ended:** it expired or was replaced by a sign-in on another phone, then she taps **Sign
   out** → 200 `NO_SESSION`, and the screen returns to sign-in as usual.
4. **No session at all:** a sign-out from a browser that never signed in → 200 `NO_SESSION`, and no cookie changes.
5. **An employee who lost eligibility:** suspended, or her phone unbound, but still holding a cookie → the sign-out
   succeeds (`SIGNED_OUT`): ending a session needs no eligibility.
6. **A refused request:** a request from another site (a wrong `Origin`) → 403 `FORBIDDEN`, and the session is still
   alive. This never counts as signed out.
7. **Server not configured:** → 503 `NOT_READY`, which is not a sign-out either.

**Must NOT happen:**
- A sign-out answering 401.
- A refused request (403 or 503) treated as «the session is gone».
- Signing out of the staff session removing the device pairing.
- The answer revealing anything about the device or the employee beyond the state of the cookie that was sent.
- The cookie or the token in the logs.

## For an agent

- **Screens:** no new one. Buttons: **خروج** / **Sign out** on the paired device (`staffLogin.signOut`) and
  **تسجيل الخروج** / **Sign out** on the personal screen (`personalStaff.signOut`).
- **API:** `POST /v1/devices/me/staff-session/sign-out` (`staff-otp.controller.ts`) and
  `POST /v1/staff/personal-session/sign-out` (`personal-otp.controller.ts`), both in
  `apps/api/src/modules/identity/http/`. Answer: `{ "status": "SIGNED_OUT" }` or `{ "status": "NO_SESSION" }`, always
  200; a sent cookie of the route's name is cleared, and with no such cookie nothing is set.
- **Permission:** none; `@Authenticated()`, declared `PERSONAL` in `AUTHENTICATED_WRITES`
  (`apps/api/src/modules/identity/http/authenticated-writes.ts`), guard policy in
  `apps/api/src/shared/sign-out.guard.ts`.
- **Errors:** `FORBIDDEN` 403 (wrong `Origin`) · `NOT_READY` 503.
- **Assertions:** after `SIGNED_OUT` the session no longer resolves; a repeat is `NO_SESSION`; a sign-out never
  returns 401; one log line per sign-out with the result, and the `user_id` only for `SIGNED_OUT`.
- **Sources:** `docs/specs/067-auth-explicit-signout/spec.md` (FR-001 … FR-007, API contract, test plan SO-01 …
  SO-04).
