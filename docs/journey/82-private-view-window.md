# 82 · The private view on the reception device, and the «own» permissions — العرض الخاص على جهاز الريسبشن وصلاحيات «بتاعتي»

**Status / الحالة:** shipped in #845 (57-1a: the four «own» read permissions with their defaults), #775 (57-1b: the
private-view window store in `packages/auth`) and #784 (57-1c: the PIN step-up and the open, touch and close routes),
all merged (spec 060 §A.5 row 57-1, ADR-0019 and ADR-0027 addenda). **API only, no screen:** the staff-app screens
that will use the window («شغلي» and «حضوري» on the reception device, rows 57-4 and later) are not built. What you can
see today is the four permissions on the permissions screen; the routes are on staging. The reads that require the
window are [83](83-own-attendance.md) and [85](85-own-monthly-tips.md).

Why it exists: the reception device is shared and its staff session lasts 8 hours, so an employee's private numbers
get a short window of their own. She types her PIN again, and the window lives at most 5 minutes and closes after 60
seconds without activity.

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md) with the API and the POS; a paired device ([03](03-pos-device-pairing.md)).
- هبة (Heba), an employee linked to a user, signed in on the device with her PIN ([08](08-staff-login-pos.md)).
- The permissions screen ([12](12-permissions-screen.md)) as the Owner.

## العربي

1. **الصلاحيات الأربعة:** افتح شاشة الصلاحيات على عضوية هبة ← فيه **قراءة جلسات خدماتي**، **قراءة عمولاتي**،
   **قراءة حضوري**، **قراءة متوسط تقييمي**، وكلهم عندها افتراضيًا (كل الأدوار البشرية بتاخدهم).
2. **منع بالاسم:** اعمل **منع** لـ **قراءة حضوري** على هبة ← هبة ما تقدرش تقرا حضورها ([83](83-own-attendance.md))،
   وباقي الموظفين زي ما هم.
3. **افتح العرض الخاص (API):** هبة، وهي داخلة على الجهاز، تبعت الـ PIN بتاعها تاني ← بترجع نافذة عرض خاص ومعاها
   الوقت الباقي: 60 ثانية خمول و5 دقايق كحد أقصى.
4. **PIN غلط:** ← `PIN_INVALID` (401). هبة لسه داخلة على الجهاز؛ ده مش خروج. المحاولات الغلط بتتعد على نفس عدّاد
   دخول الـ PIN.
5. **PIN موظفة تانية:** PIN صح بس بتاع موظفة غير اللي داخلة ← مفيش نافذة بتتفتح.
6. **خليها شغالة:** طلب «touch» كل شوية ← الخمول بيتجدد، والحد الأقصى (5 دقايق) ما بيتمدش.
7. **خلصت:** بعد 60 ثانية من غير نشاط، أو بعد 5 دقايق ← **وقت العرض خلص. دخّلي الـ PIN تاني.**
   (`PRIVATE_VIEW_EXPIRED`، 403).
8. **اقفلها:** طلب الإغلاق ← 204، ونفس الرد لو النافذة مش موجودة أصلًا.
9. **خروج أو موظفة تانية:** هبة خرجت أو موظفة تانية دخلت على الجهاز ← النافذة بتتلغي.
10. **من موقع تاني:** طلب بـ `Origin` غلط ← `FORBIDDEN`، وما بيجددش الخمول.

**ممنوع يحصل:**
- الـ PIN يتخزّن أو يظهر في رد أو في اللوج، ورقم النافذة يظهر في اللوج.
- نافذة تعيش أكتر من 5 دقايق، أو تتجدد بعد 60 ثانية خمول.
- نافذة موظفة تشتغل لموظفة تانية أو على جهاز تاني.
- الرد على الإغلاق يقول إذا كانت النافذة موجودة ولا لأ.
- جهاز مربوط ياخد صلاحيات «بتاعتي».

## English

1. **The four permissions:** open the permissions screen on Heba's membership → **Read my service sessions**, **Read
   my commissions**, **Read my attendance** and **Read my rating average**, all held by default (every human role
   gets them).
2. **A personal deny:** set a **Deny** for **Read my attendance** on Heba → Heba cannot read her own attendance
   ([83](83-own-attendance.md)); other employees are unchanged.
3. **Open the private view (API):** Heba, signed in on the device, sends her PIN again → a private-view window comes
   back with the remaining times: 60 seconds idle and a 5-minute cap.
4. **A wrong PIN:** → `PIN_INVALID` (401). Heba is still signed in on the device; this is not a sign-out. Wrong
   attempts count on the same counter as the PIN sign-in.
5. **Another employee's PIN:** a correct PIN that belongs to someone other than the signed-in operator → no window
   opens.
6. **Keep it alive:** a "touch" request now and then → the idle time is renewed; the 5-minute cap is never extended.
7. **Expired:** after 60 seconds without activity, or after 5 minutes → **The private view has expired. Enter your
   PIN again.** (`PRIVATE_VIEW_EXPIRED`, 403).
8. **Close it:** the close request → 204, and the same answer when there was no window at all.
9. **Sign-out or another operator:** Heba signs out, or another employee signs in on the device → the window is gone.
10. **From another site:** a request with a wrong `Origin` → `FORBIDDEN`, and it does not renew the idle time.

**Must NOT happen:**
- The PIN stored, or shown in an answer or a log; the window id in a log.
- A window living longer than 5 minutes, or renewed after 60 idle seconds.
- One employee's window working for another employee or on another device.
- The close answer telling whether a window existed.
- A paired device holding the «own» permissions.

## For an agent

- **Screens:** none for the window. Permission labels on `/permissions`: **قراءة جلسات خدماتي** / **Read my service
  sessions**, **قراءة عمولاتي** / **Read my commissions**, **قراءة حضوري** / **Read my attendance**, **قراءة متوسط
  تقييمي** / **Read my rating average** (`packages/i18n/src/permission-codes-catalog.ts`).
- **API** (`apps/api/src/modules/identity/http/private-view.controller.ts`, `@Authenticated()`, the staff session on
  a paired device): `POST /v1/staff/me/private-view` (body: the PIN) · `POST /v1/staff/me/private-view/touch` ·
  `POST /v1/staff/me/private-view/close`. The window id travels in the `x-private-view-window-id` request header;
  the remaining times come back in `x-private-view-idle-remaining-ms` and `x-private-view-cap-remaining-ms`.
- **Limits** (`packages/auth/src/private-view/options.ts`): `PRIVATE_VIEW_IDLE_MS = 60_000`,
  `PRIVATE_VIEW_CAP_MS = 300_000`, `PRIVATE_VIEW_PROOF_MAX_AGE_MS = 60_000`.
- **Permissions:** `read:service-sessions:own`, `read:commissions:own`, `read:attendance:own`, `read:ratings:own`;
  default for every human role (`packages/db/src/role-defaults.ts`).
- **Errors:** `PIN_INVALID` 401 · `PRIVATE_VIEW_EXPIRED` 403 · `UNAUTHENTICATED` 401 · `FORBIDDEN` 403.
- **Sources:** `docs/specs/060-ratings-and-staff-app/spec.md` (D-A4, D-A5, D-A13, FR-A06b, rows 57-0, 57-1),
  `docs/specs/060-ratings-and-staff-app/plan-57-1.md`, `docs/adr/0019-staff-otp-login.md`,
  `docs/adr/0027-personal-staff-session.md`.
