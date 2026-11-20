# 64 · Mobile notifications in the staff app — إشعارات الموبايل في تطبيق الموظفة

**Status / الحالة:** shipped in #557 (28b-3: the Web Push sender in the worker), #599 (28b-5: the employee's own
«no clock-in yet» push) and #612 (28b-4: the on/off control, the service worker and the sign-in check in
`apps/pos`), all merged. Together with [60](60-staff-push-subscriptions.md) (the subscription routes) the chain is
complete: an employee turns notifications on from her personal screen, and the worker sends to her phone.
**Not testable on staging yet:** the control lives on the personal screen, which needs the personal session, and
that needs the WhatsApp OTP, which is **OFF** ([22](22-personal-phone-passkey.md)). The staging compose now passes
`VAPID_PUBLIC_KEY` and `VAPID_SUBJECT` to the API (`deploy/docker-compose.staging-shared.yml`), so the 503 of journey
60 goes away once those values are set in Dokploy. The native app ([63](63-native-app-shell.md)) has no Web Push.
Spec 063 and ADR-0052 govern this.

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md) with API, worker, Redis and the POS; `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` and
  the worker's push keys set locally (synthetic test values only, never real keys in a shared file).
- A synthetic employee منى (Mona) with a personal session through the test seams of
  [22](22-personal-phone-passkey.md), a schedule with a shift today, and no clock-in.
- A browser that supports notifications. On an iPhone the PWA must be added to the Home Screen first.

## العربي

1. **الدعوة:** منى تفتح شاشتها الشخصية أول مرة ← **يوصلك إشعار على الموبايل ده لو الشيفت بدأ ومفيش بصمة حضور.**
   ومعاها **تشغيل** و**مش دلوقتي**. **مش دلوقتي** بتخفي الدعوة ومش بترجع تاني.
2. **مقفولة:** في نفس الشاشة مكتوب **إشعارات الموبايل مقفولة.** وزرار **تشغيل إشعارات الموبايل**.
3. **التشغيل:** تدوس **تشغيل إشعارات الموبايل** وتوافق على إذن المتصفح ← **الإشعارات شغّالة.** وزرار **إيقاف
   الإشعارات**. بيتسجّل اشتراك واحد ([60](60-staff-push-subscriptions.md)).
4. **رفضت الإذن:** لو رفضت إذن المتصفح ← **الإشعارات متقفلة من إعدادات المتصفح. لازم تتفتح من هناك الأول.** ومفيش
   زرار.
5. **آيفون من غير تثبيت:** على آيفون في المتصفح العادي ← **علشان توصلك الإشعارات، ضيفي التطبيق للشاشة الرئيسية.**
   وتحتها التلات خطوات، ومفيش زرار تشغيل.
6. **موبايل مش بيدعم:** ← **الموبايل ده مش هيوصله إشعارات.** ومفيش زرار.
7. **من غير نت:** ← الزرار مقفول ومكتوب **مفيش إنترنت، فتشغيل الإشعارات مش متاح دلوقتي.**
8. **الإشعار نفسه:** الشيفت بدأ ومنى ما بصمتش، والـ worker اشتغل ← إشعار على الموبايل بعنوان **بصمة الحضور** ونصه
   «لسه مفيش بصمة حضور ليك لشيفت الساعة {shift_start} في {branch_name}.»
9. **الإيقاف:** تدوس **إيقاف الإشعارات** ← **إشعارات الموبايل مقفولة.** والاشتراك بيتلغي على السيرفر.
10. **الخروج:** لما منى تدوس **تسجيل الخروج**، اشتراك الموبايل ده بيتشال (حتى لو الإلغاء على السيرفر فشل)، ولازم
    تشغّل الإشعارات تاني بعد ما تدخل. لو الجلسة انتهت لوحدها أو النت قطع، الاشتراك بيفضل زي ما هو.
11. **السيرفر مش متظبط:** لو السيرفر من غير مفاتيح الإشعارات ← القسم كله مش ظاهر.

**ممنوع يحصل:**
- زرار تشغيل شكله شغال على موبايل مش بيدعم أو والإذن مرفوض.
- إشعار يوصل لموبايل بعد ما صاحبته سجّلت خروج، أو لموظفة تانية دخلت على نفس الموبايل.
- اسم عميلة أو رقم أو أي نص حر في الإشعار (وقت الشيفت واسم الفرع بس).
- اشتراك شركة يتسجّل أو يتلغي وهي داخلة على شركة تانية.

## English

1. **The invitation:** Mona opens her personal screen for the first time → **Get a notice on this phone if your shift
   starts and there is no clock-in yet.** with **Turn on** and **Not now**. **Not now** hides it for good.
2. **Off:** the same screen reads **Mobile notifications are off.** with the button **Turn on mobile notifications**.
3. **Turning on:** she taps **Turn on mobile notifications** and accepts the browser prompt → **Notifications are
   on.** with the button **Turn off**. One subscription is registered ([60](60-staff-push-subscriptions.md)).
4. **Permission refused:** if she refuses the browser prompt → **Notifications are blocked in the browser settings.
   Turn them on there, then come back.** and no button.
5. **iPhone, not installed:** on an iPhone in the plain browser → **To get the notifications, add the app to the Home
   Screen.** with the three steps, and no toggle.
6. **Unsupported phone:** → **This phone cannot receive notifications.** and no button.
7. **Offline:** → the button is disabled with **There is no internet connection, so notifications cannot be turned on
   now.**
8. **The notification itself:** the shift started, Mona has not clocked in, and the worker ran → a notification
   titled **Clock-in** reading "No clock-in yet for your {shift_start} shift at {branch_name}."
9. **Turning off:** she taps **Turn off** → **Mobile notifications are off.** and the subscription is revoked on the
   server.
10. **Sign-out:** when Mona taps **Sign out**, this phone's subscription is removed (even if the server revoke
    fails), and she must turn notifications on again after signing in. A session that merely expired, or a phone that
    went offline, leaves the subscription as it is.
11. **Server not configured:** if the server has no push keys → the whole section is hidden.

**Must NOT happen:**
- A working-looking turn-on button on an unsupported phone or with the permission refused.
- A notification reaching a phone after its owner signed out, or reaching another employee who signed in there.
- A customer name, a number or any free text in a notification (only the shift time and the branch name).
- One company's subscription registered or revoked while she is signed in to another company.

## For an agent

- **Screen:** the personal screen of the POS PWA (`/personal?company=<COMPANY_ID>&business=<BUSINESS_ID>`, local
  `http://localhost:5173`); the control is `PushControl` inside
  `apps/pos/src/personal-staff/ui/enrol-passkey-screen.tsx`, code in `apps/pos/src/personal-staff/push/`, service
  worker `apps/pos/src/sw.ts`.
- **Text:** `packages/i18n/src/staff-push-catalog.ts` (`staffPush.off`, `on`, `enable`, `disable`, `blocked`,
  `unsupported`, `storageBlocked`, `installLead`, `offline`, `invitationLead`, `invitationEnable`,
  `invitationDismiss`, `error`).
- **API:** the three routes of [60](60-staff-push-subscriptions.md) (`GET /v1/staff/push/config`,
  `PUT /v1/staff/push/subscription`, `POST /v1/staff/push/subscription/revoke`). A stale key (`PUSH_KEY_STALE` 409)
  makes the control read the config again and retry once.
- **Push templates** (`packages/notifications/src/push/templates.ts`): `shift_not_clocked_in_self` (this journey) and
  `shift_ends_soon` ([65](65-shift-ending-reminder.md)). Parameters: `shift_start` / `shift_end` as `HH:MM`, and the
  branch name (Arabic falls back to English, then to «الفرع» / "the branch").
- **Rule:** the not-clocked-in push follows the `SHIFT_NOT_CLOCKED_IN` rule and the master switch
  ([62](62-alert-rules-screen.md)); the fixed recipient shows there as **إشعار على الموبايل للموظفة** / **Mobile
  notification to the employee**.
- **Sources:** `docs/specs/063-staff-web-push/spec.md`, `docs/adr/0052-staff-web-push.md`,
  `apps/pos/src/personal-staff/push/push-control.spec.tsx`.
