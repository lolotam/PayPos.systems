# 60 · Staff push subscriptions — اشتراك موبايل الموظفة في الإشعارات

**Status / الحالة:** shipped in #530 (28b-1: the `push_subscriptions` table, RLS and three personal routes, merged).
**API only, no screen yet:** the on/off control in the staff app is row 28b-4. The send queue, the channel and the
worker are rows 28b-2 and 28b-3, and the employee's own not-clocked-in push is row 28b-5 (its producer side is in
place). Until 28b-4 lets a phone subscribe, no phone shows a notification. Two more gates:
- The routes need the **personal staff session**, and that needs the WhatsApp OTP, which is **OFF** until the Meta
  templates and secrets are approved ([22](22-personal-phone-passkey.md)). Today the routes run only in tests and local
  seams, as in [26](26-clock-attendance.md).
- Registering needs the API's VAPID public key and subject (`VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` in `.env.example`).
  Neither staging compose file passes them to the API, so setting them in Dokploy is not enough: until the compose wiring
  is added (issue #534), staging answers the config and register routes with «الخدمة غير جاهزة حالياً» (503). Removing a subscription always works.

Since #533 (2026-10-23) staging runs the admin at `https://app.staging.pospay.systems`, the POS at
`https://pos.staging.pospay.systems` and the API + worker at `https://api.staging.pospay.systems`, demo data only. Spec
063 and ADR-0052 govern this. Waleed answered WP-Q1…WP-Q4 (they apply now; Abu Salem has not picked yet), and none of
them changes these three routes: [owner-questions.ar.md](../specs/063-staff-web-push/owner-questions.ar.md).

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md), then `pnpm db:migrate` (0174) and `pnpm db:seed`; set `VAPID_PUBLIC_KEY` and
  `VAPID_SUBJECT` locally (synthetic test values, never real keys in a file you share).
- Two synthetic employees, منى (Mona) and هبة (Heba), each linked to a user, each with a personal session through the
  test seams of [22](22-personal-phone-passkey.md) (fixture OTP, exact POS origin). No real phone numbers.
- Synthetic subscription values only: an endpoint on an allowed push service, random keys, a random installation id.

## العربي

API بس، لسه مفيش شاشة. الإرسال اتبنى (28b-2 و28b-3 و28b-5)، بس مفيش موبايل يقدر يشترك من التطبيق لحد 28b-4، فالدليل ده بيختبر الاشتراك بس.

1. **الإعداد:** منى بتطلب إعداد الإشعارات ← مفتاح عام، ورقم المفتاح، و`subscriber_ref` بتاعها هي (نفسه في أي شركة).
   لو الـ VAPID مش متظبط ← **الخدمة غير جاهزة حالياً** (503).
2. **التسجيل:** منى تسجّل اشتراك موبايلها ← 204. بيتحفظ صف واحد شغال؛ رقم التثبيت بيتحفظ كهاش بس.
3. **نفس التسجيل تاني:** نفس الاشتراك تاني ← 204 وبرضه صف واحد (مش محتاج `Idempotency-Key`).
4. **مفتاح قديم:** تسجيل برقم مفتاح قديم ← **مفتاح الإشعارات اتغيّر، فعّل الإشعارات من جديد.** (409).
5. **وجهة مش مسموحة:** endpoint مش من خدمات الدفع المسموحة (جوجل، موزيلا، أبل، ويندوز)، أو `http`، أو عنوان IP ←
   **البيانات المرسلة غير صحيحة** (400).
6. **خمس موبايلات بالكتير:** منى تسجّل من موبايل سادس ← أقدم اشتراك ليها بيتلغي، وبيفضل 5.
7. **نفس المتصفح لموظفة تانية:** هبة تسجّل من نفس المتصفح في نفس الشركة (نفس الـ endpoint) ← الاشتراك بينتقل لهبة،
   وصف منى بيتلغي.
8. **الإلغاء:** منى تلغي اشتراك تثبيتها ← 204. نفس الرد بالظبط لو رقم التثبيت مش بتاعها أو مش موجود. الإلغاء شغال حتى
   لو الـ VAPID مش متظبط. بعد الإلغاء الـ endpoint والمفاتيح بيتمسحوا من الصف.
9. **كتير ورا بعض:** أكتر من 20 تسجيل في الساعة لنفس الموظفة ← **محاولات كتير، جرّب بعد شوية.** (429).
10. **تسجيلين في نفس اللحظة:** ← واحد ممكن ياخد **فيه تسجيل تاني شغال على نفس الجهاز، جرّب تاني.** (409)، ومفيش أكتر من
    صف شغال للـ endpoint الواحد جوّه نفس الشركة.
11. **مش الجلسة الشخصية:** جلسة لوحة الإدارة، أو جهاز الكاشير، أو أي `Authorization` header ← **يجب تسجيل الدخول** (401).
    مفيش صلاحية لمدير هنا: الموظفة بس على اشتراكها هي.

**ممنوع يحصل:**
- جوّه نفس الشركة: أكتر من 5 اشتراكات شغالة لموظفة، أو endpoint واحد شغال لموظفتين (كل شركة بتعد لوحدها، فنفس المستخدمة أو نفس الـ endpoint في شركة تانية مش تعارض).
- endpoint برّه خدمات الدفع المسموحة يتقبل.
- رقم التثبيت الخام أو المفاتيح يتحفظوا بعد الإلغاء، أو يظهروا في اللوج.
- الرد يفرّق بين إلغاء اشتراكها واشتراك حد تاني أو اشتراك مش موجود.
- مدير أو جهاز يسجّل أو يلغي اشتراك موظفة.
- أي إشعار يتبعت من خطوات الدليل ده (الدليل بيختبر الاشتراك بس؛ الإرسال بيتختبر في 28b-3 و28b-5).

## English

API only, no screen yet. Sending is built (28b-2, 28b-3, 28b-5), but no phone can subscribe from the app until 28b-4, so this guide tests the subscription only.

1. **Config:** Mona asks for the push config → the public key, its key id, and her own `subscriber_ref` (the same in
   every company). VAPID not configured → **The service is not ready** (503).
2. **Register:** Mona registers her phone's subscription → 204. One live row is stored; the installation id is stored
   only as a hash.
3. **The same again:** the same subscription again → 204, still one row (no `Idempotency-Key` needed).
4. **Stale key:** registering with an old key id → **The notification key changed. Turn notifications on again.** (409).
5. **Endpoint not allowed:** an endpoint outside the allowed push services (Google, Mozilla, Apple, Windows), `http`, or
   an IP address → **The request is not valid** (400).
6. **Five phones at most:** Mona registers a sixth phone → her oldest subscription is revoked; 5 remain.
7. **Same browser, another employee:** Heba registers from the same browser in the same company (same endpoint) → the
   subscription moves to Heba and Mona's row is revoked.
8. **Revoke:** Mona revokes her installation's subscription → 204. Exactly the same answer for an installation id that is
   not hers or does not exist. Revoking works even with VAPID unconfigured. After a revoke the endpoint and keys are
   cleared from the row.
9. **Too many:** more than 20 registrations in an hour by the same employee → **Too many attempts, try again later.**
   (429).
10. **Two at once:** one may get **Another registration for this device is in progress. Try again.** (409), and within one
    company an endpoint never has more than one live row.
11. **Not the personal session:** an admin session, the paired POS device, or any `Authorization` header →
    **Authentication is required** (401). No manager permission exists here: an employee acts only on her own
    subscription.

**Must NOT happen:**
- Within one company: more than 5 live subscriptions for one employee, or one endpoint live for two employees (each
  company counts and owns endpoints on its own, so the same user or endpoint in another company is not a conflict).
- An endpoint outside the allowed push services accepted.
- The raw installation id, or the keys after a revoke, stored; or any of them in the logs.
- A revoke answer that tells her own subscription from someone else's or a missing one.
- A manager or a device registering or revoking an employee's subscription.
- Any notification sent by the steps of this guide (it tests the subscription only; sending is tested in 28b-3 and 28b-5).

## For an agent

- **Screens:** none (row 28b-4). No push control exists in `apps/pos/src` (local POS `http://localhost:5173`, staging
  `https://pos.staging.pospay.systems`).
- **API** (base `http://localhost:3000/v1`, staging `https://api.staging.pospay.systems/v1`): personal cookie
  `pospay-personal.session_token`, exact configured POS `Origin`, no `Authorization` header, no `x-company-id` (the
  company comes from the personal session). Every answer is `Cache-Control: no-store`.
  - `GET /staff/push/config` → `{ vapid_public_key, vapid_key_id (16 hex), subscriber_ref (64 hex) }`.
  - `PUT /staff/push/subscription` → 204:

    The body has `installation_id` (a UUID v4), `vapid_key_id` (16 hex), `delivery_token` (a UUID v4), `locale` (`ar` or
    `en`) and `subscription`, the browser's push subscription object: `endpoint` (a synthetic
    `https://fcm.googleapis.com/fcm/send/…` URL in tests), `expirationTime` (`null`), and `keys` with `p256dh`
    (87 base64url characters) and `auth` (22 base64url characters), as in `packages/contracts/src/push-subscription.ts`. Use synthetic values only.

  - `POST /staff/push/subscription/revoke` with `{ "installation_id": "<UUID_V4>" }` → 204.
  - Allowed hosts (`packages/contracts/src/push-subscription.ts`): `fcm.googleapis.com`,
    `updates.push.services.mozilla.com`, `web.push.apple.com`, and any `*.notify.windows.com`.
- **Permission:** none; `@Authenticated()` + `PERSONAL_ROUTE`; the `PUT` and the revoke are declared `PERSONAL` in
  `AUTHENTICATED_WRITES`.
- **Errors:** `NOT_READY` 503 · `PUSH_KEY_STALE` 409 · `PUSH_REGISTRATION_BUSY` 409 · `RATE_LIMITED` 429 ·
  `VALIDATION_FAILED` 400 · `UNAUTHENTICATED` 401.
- **Assertions:** `push_subscriptions` has `ENABLE` + `FORCE` RLS (cross-tenant read = 0 rows, write = error); a live
  row holds every secret and a revoked row none (`CHECK`); the same installation gives different hashes in two
  companies; `revoked_reason` is `CAP_EXCEEDED` (step 6), `OWNER_CHANGED` (step 7), `UNSUBSCRIBED` (step 8), or
  `REPLACED` (her same endpoint registered again under a new installation id); these steps write no `push_attempts` row.
- **Sources:** `docs/specs/063-staff-web-push/spec.md` (Story 2, API contract, sub-PR split), `docs/adr/0052-staff-web-push.md`,
  `apps/api/src/modules/notifications/http/push-subscription.controller.ts`,
  `apps/api/src/modules/notifications/use-cases/register-push-subscription/register-push-subscription.ts`,
  `packages/contracts/src/push-subscription.ts`, `packages/i18n/src/{ar,en}.ts`.
