# 63 · «PosPay Business» app shell — غلاف تطبيق «PosPay Business»

**Status / الحالة:** shipped in #563 (M-1a: native build mode, start screen, Capacitor shell), #575 (manager link,
remembered business, phone language, rotation), #602 (B1: switching business), #627 (M-1e: icons, splash and the
staging strip) and #667 (PP-62: the staging API accepts the iOS app origin through `STAFF_NATIVE_ORIGINS`), all merged.
The app is the same `apps/pos` screens inside a Capacitor shell (`apps/business`, ADR-0055, spec 065). **Not on
staging as a web page:** the start screen exists only in the native build (`pnpm --filter @pospay/pos build:native`),
so you test it from a build installed on a simulator or a phone. Not built yet: opening the app from a tapped link by
the operating system and the in-app QR scan (spec 065 FR-012 and FR-014, M-2). The employee side still needs the
personal session, and that needs the WhatsApp OTP, which is **OFF** ([22](22-personal-phone-passkey.md)). #637 (the
iOS simulator UI test) and #648 (a staging-only test-user CLI) are test tooling with no user step.

**Before you start / قبل ما تبدأ:**
- A **staging** build of the app on an iOS simulator or an Android device, built as `apps/business/README.md`
  describes (`build:native` with `FLAVOUR=staging`, then `pnpm --filter @pospay/business sync:staging`).
- A fresh install (no remembered choice); keep the network on for normal setup (or disconnect / simulate a captive portal for step 11).
- A manager's employee link for the demo business, from [68](68-employee-app-link-qr.md).

## العربي

1. **أول فتح:** افتح التطبيق ← شاشة **إنت بتستخدم الجهاز ده إزاي؟** وتحتها اختيارين: **جهاز الكاونتر** («تابلت أو
   تليفون الصالون: الكاشير وحضور الموظفين») و**حسابي كموظفة** («تليفونك إنت: دخولك وحضورك»).
2. **نسخة التجربة:** في نسخة الستاجنج فيه شريط مكتوب عليه **نسخة تجربة**. نسخة الـ production ملهاش الشريط ده.
3. **الكاونتر:** دوس **جهاز الكاونتر** ← شاشة ربط الجهاز العادية ([03](03-pos-device-pairing.md)). اقفل التطبيق
   وافتحه ← بيفتح على نفس المسار من غير شاشة البداية.
4. **رجوع للاختيار:** طول ما الجهاز لسه من غير ربط ومن غير جلسة، فيه زرار **رجوع لاختيار نوع الجهاز** ← بيرجعك
   لشاشة البداية. بعد الربط أو الدخول الزرار ده مش بيظهر.
5. **الموظفة:** دوس **حسابي كموظفة** ← خانة **الصقي اللينك اللي بعتهولك المدير** وزرار **وصّلي**. الصقي لينك المدير
   ← التطبيق بيفتكر النشاط وبيفتح دخول الموظفة الشخصي ([22](22-personal-phone-passkey.md)).
6. **لينك غلط:** لينك من موقع تاني أو ناقص ← مفيش حاجة بتتغير، ورسالة **اطلب من المدير رابط الدخول الشخصي الخاص
   بنشاطك.**
7. **لينك موظفة على جهاز كاونتر:** على جهاز اختار **جهاز الكاونتر**، افتح لينك موظفة ← **الجهاز ده جهاز كاونتر،
   واللينك ده لحساب موظفة**، والجهاز بيفضل كاونتر.
8. **تبديل الصالون:** موظفة فاكر لها التطبيق نشاط، وفتحت لينك نشاط تاني ← **تبدّلي لصالون تاني؟** ومعاها **تأكيد**
   و**إلغاء**. **إلغاء** ما بيغيّرش حاجة. **تأكيد** بيخرّجها من الجلسة الشخصية الأول وبعدين يفتكر النشاط الجديد.
9. **من غير نت:** التبديل من غير نت ← **ده محتاج نت. ماتغيّرش حاجة.** ولو الخروج فشل ← **مقدرناش نخرّجك. ماتغيّرش
   حاجة، حاولي تاني.** وزرار **حاولي تاني**.
10. **اللغة والدوران:** أول فتح بياخد لغة الموبايل (عربي لو الموبايل عربي، وإنجليزي لأي لغة تانية)، والشاشات بتتبع
    دوران الجهاز.
11. **أول حفظ من غير نت أو خلف بوابة واي فاي:** لو لسه مفيش اختيار محفوظ والجهاز أوفلاين أو فشل فحص السيرفر (`GET /health`
    خلال 5 ثواني)، اختيار **جهاز الكاونتر** أو **حسابي كموظفة** بيفضل على شاشة البداية ويظهر **أول مرة محتاجة نت** ومفيش دور بيتحفظ.

**ممنوع يحصل:**
- شاشات النشاط القديم تظهر بعد تبديل الصالون.
- أول حفظ للدور أو تبديل الصالون أو تغيير الدور يتم من غير نت أو خلف captive portal.
- جهاز كاونتر يتحوّل لحساب موظفة لمجرد فتح لينك.
- رقم موبايل أو كود أو توكن جلسة يتخزّن في التطبيق.
- شريط **نسخة تجربة** يظهر في نسخة الـ production.

## English

1. **First launch:** open the app → **How do you use this device?** with two choices: **Counter device** ("A tablet
   or the salon phone: the cashier and staff attendance.") and **My employee account** ("Your own phone: your sign-in
   and your attendance.").
2. **Test version:** the staging build shows a strip reading **Test version**. The production build has no strip.
3. **Counter:** tap **Counter device** → the usual device pairing screen ([03](03-pos-device-pairing.md)). Close and
   reopen the app → it opens the same flow, with no start screen.
4. **Back to the choice:** while the device has no pairing and no session there is a **Back to choosing the device
   type** button → the start screen again. After pairing or signing in the button is not shown.
5. **Employee:** tap **My employee account** → the field **Paste the link your manager sent you** and the button
   **Connect**. Paste the manager's link → the app remembers the business and opens the employee's personal
   sign-in ([22](22-personal-phone-passkey.md)).
6. **A wrong link:** a link from another site, or an incomplete one → nothing changes, and the message **Ask your
   manager for your personal sign-in link.**
7. **An employee link on a counter device:** on a device that chose **Counter device**, open an employee link →
   **This device is a counter device, and the link is for an employee**; the device stays a counter.
8. **Switching salon:** an employee with a remembered business opens another business's link → **Switch to another
   salon?** with **Confirm** and **Cancel**. **Cancel** changes nothing. **Confirm** first signs her out of the
   personal session, then remembers the new business.
9. **Offline:** switching with no network → **This needs the internet. Nothing was changed.** If the sign-out fails →
   **We could not sign you out. Nothing was changed; try again.** with a **Try again** button.
10. **Language and rotation:** the first launch takes the phone's language (Arabic on an Arabic phone, English for
    any other), and the screens follow the device's rotation.
11. **First choice offline or behind a captive portal:** when no choice is stored yet and the device is offline or the
    bounded `GET /health` reachability check fails/times out within 5 seconds, tapping **Counter device** or **My employee account** keeps the start screen, shows **The first time needs the internet.**, and saves nothing.

**Must NOT happen:**
- The old business's screens shown after a switch.
- A first device-role save, business switch, or role change completing offline or behind a captive portal.
- A counter device turning into an employee account just because a link was opened.
- A phone number, a code or a session token stored by the app.
- The **Test version** strip in the production build.

## For an agent

- **Where it runs:** only the native build (`vite build --mode native`, output `apps/pos/dist-native`); no web URL.
  App ids: `systems.pospay.business.staging` and `systems.pospay.business` (`apps/business/README.md`). The iOS
  simulator test `testStartScreenAndEmployeeChoiceSurviveRestart` covers steps 1 and 3 for the employee choice.
- **Text:** `packages/i18n/src/native-shell-catalog.ts` (`nativeShell.title`, `counter`, `employee`, `needsInternet`,
  `pasteLabel`, `pasteSubmit`, `counterDevice`, `switchBusinessConfirm`, `roleChangeOffline`, `roleChangeFailed`,
  `stagingStrip`, `startOver`).
- **Code:** `apps/pos/src/app/start-screen.tsx`, `native-entry.tsx`, `server-reachability.ts`, `paste-link-form.tsx`,
  `switch-business-panel.tsx`, `foreign-session-notice.tsx`, `staging-strip.tsx`, `start-over-button.tsx`,
  `link-rules.ts`, `apps/pos/src/shared/platform/native-shell.ts`.
- **The link:** `https://<pos host>/personal?company=<COMPANY_ID>&business=<BUSINESS_ID>`; only that host and path are
  accepted, parsed with the `personalWorkspace` schema of `packages/contracts`; every other parameter is ignored.
- **Assertions:** the native build registers no service worker (spec 065 FR-005); before saving a first device role,
  `checkServerReachable()` calls `GET ${apiOrigin()}/health` (browser `fetch` with `cache: 'no-store'`, `credentials: 'omit'`, `redirect: 'error'`; on native iOS, direct `CapacitorHttp.request` with `Cache-Control: no-cache, no-store, max-age=0`, `Pragma: no-cache`, and `disableRedirects: true`, bypassing `nativeStaffFetch`'s session abort fence) bounded to
  `FIRST_SAVE_REACHABILITY_WAIT_MS = 5000` ms and requiring HTTP `200` with
  `{ status: 'ok' }`, otherwise keeping `StartScreen` with `nativeShell.needsInternet` without persisting a role; a
  sign-out attempt waits at most 10 seconds; the sign-out routes answer 200 `SIGNED_OUT` or 200 `NO_SESSION` ([66](66-staff-sign-out.md)).
- **Sources:** `docs/specs/065-mob-app-shell/spec.md` (FR-001, FR-008, FR-012, FR-015, FR-016, FR-018),
  `docs/adr/0055-store-apps-capacitor-shell.md`, `apps/business/README.md`.
