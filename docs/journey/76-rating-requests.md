# 76 · Rating requests: scheduling and the on/off switch — طلبات التقييم: الجدولة ومفتاح التشغيل

**Status / الحالة:** shipped in #670 (58-1: the rating tables), #692 (59-1: scheduling a request after a visit), #734
(59b-1: the token codec, keys wired in the worker only), #741 (59-2: the per-business switch and its permission),
#751 (59b-2a: the claim core), #785 (59b-2b: the per-minute claim scheduler) and #883 (59b-2c: discovery and
recovery), all merged (spec 060, part B). **The customer still receives nothing:** the send step (row 59b-3: the
`rating_request` WhatsApp template and the link in it) is **not built**, so no rating link leaves the system. What a
person can see today is only the **switch** on the alerts screen. The low-rating alert and the averages (rows 61-1,
61-2, 61-3) are not built either. The page the link will open is [77](77-public-rating-page.md).

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md) with API, worker, Redis and admin; or the staging admin with the demo company
  «صالون الأميرة (تجريبي)».
- The **Owner** (holds **إدارة رسايل التقييم** / **Manage rating messages** by default; it is owner-only until he
  gives it to someone on the permissions screen, [12](12-permissions-screen.md)); سارة (Sara), a Branch Manager
  without it.
- A customer with a phone number, and a recorded visit for her today ([47](47-record-visit-reception.md)).

## العربي

1. **المفتاح:** صاحب الشركة يفتح **التنبيهات** ([62](62-alert-rules-screen.md)) ← مفتاح **إرسال طلبات التقييم
   للعملاء**.
2. **اقفله:** يقفل المفتاح ← **طلبات التقييم مقفولة. محدش من العملاء هيوصله لينك تقييم.** والتغيير بيتسجّل في سجل
   التدقيق.
3. **منفصل عن تنبيهات الفريق:** قفل **كل التنبيهات شغالة** ما بيقفلش طلبات التقييم، والعكس.
4. **صلاحية منفصلة:** سارة معاها **إدارة التنبيهات** بس ← بتشوف قواعد التنبيهات، ومفتاح التقييم مش بتاعها. مستخدم
   معاه **إدارة رسايل التقييم** بس ← بيشوف المفتاح ده بس.
5. **الجدولة (في الخلفية):** لما زيارة عميلة تتسجّل، الـ worker بيجهّز طلب تقييم واحد للعميلة في اليوم ده للنشاط:
   ميعاده بعد الزيارة بساعة، وما يعدّيش ميعاد قفل الفرع. مفيش حاجة تتشاف على أي شاشة.
6. **طلب واحد في اليوم:** زيارتين لنفس العميلة في نفس اليوم في نفس النشاط ← طلب واحد برضه.
7. **المفتاح مقفول وقت الميعاد (مبني ومش شغال):** خطوة «تجهيز الطلب للإرسال» اتبنت، وفيها إن الطلب بيتلغى بسبب
   `REQUESTS_OFF` لو المفتاح مقفول. بس مجدولها مش بيشتغل من إقلاع الـ worker لسه (`closedRatingClaimsLifecycle`)،
   فالطلبات المجدولة بتفضل زي ما هي.
8. **الإرسال:** لسه مش مبني (59b-3). الطلبات الجاهزة ما بتطلعش رسالة واتساب.

**ممنوع يحصل:**
- رسالة تقييم تتبعت والمفتاح مقفول، أو لعميلة ردّت «إيقاف» ([05](05-whatsapp-stop.md)) أو لغت رسايل التقييم
  ([77](77-public-rating-page.md)).
- طلبين لنفس العميلة في نفس اليوم ونفس النشاط.
- مستخدم من غير **إدارة رسايل التقييم** يغيّر المفتاح.
- مفتاح توليد اللينكات يتحط في الـ API (في الـ worker بس).
- رقم العميلة يظهر في اللوج كامل.

## English

1. **The switch:** the Owner opens **Alerts** ([62](62-alert-rules-screen.md)) → the switch **Send rating requests
   to customers**.
2. **Turn it off:** → **Rating requests are off. No customer will receive a rating link.**, and the change is
   written to the audit log.
3. **Separate from team alerts:** turning off **All team alerts on** does not turn off rating requests, and the
   other way round.
4. **Its own permission:** Sara, with only **Manage alerts**, sees the alert rules but not this switch. A user with
   only **Manage rating messages** sees only this switch.
5. **Scheduling (in the background):** when a customer's visit is recorded, the worker prepares one rating request
   for that customer, that day, for the business: due one hour after the visit, and never after the branch closes.
   Nothing shows on any screen.
6. **One request per day:** two visits by the same customer on one day in one business → still one request.
7. **Switch off at the due time (built, not running):** the step that claims a due request is built, and it cancels
   the request with the reason `REQUESTS_OFF` when the switch is off. Its scheduler is not started when the worker
   boots yet (`closedRatingClaimsLifecycle`), so scheduled requests stay as they are.
8. **Sending:** not built yet (59b-3). Ready requests produce no WhatsApp message.

**Must NOT happen:**
- A rating message sent while the switch is off, or to a customer who replied STOP ([05](05-whatsapp-stop.md)) or
  opted out of rating messages ([77](77-public-rating-page.md)).
- Two requests for one customer on one day in one business.
- A user without **Manage rating messages** changing the switch.
- The link-derivation key present in the API (it lives in the worker only).
- The customer's full phone number in the logs.

## For an agent

- **Screen:** the rating switch `#rating-requests` on `/alert-rules`
  (`apps/admin/src/settings/alert-rules/ui/rating-requests-switch.tsx`); labels `alertRules.ratingRequestsLabel` and
  `alertRules.ratingRequestsOffNote`.
- **API:** `GET|PUT /v1/businesses/<BUSINESS_ID>/rating-settings` with `manage:rating-requests:business`
  (`apps/api/src/modules/customers/http/rating-settings.controller.ts`).
- **Worker:** `apps/worker/src/modules/customers/` (`customers.module.ts`, `jobs/rating-claims.processor.ts`,
  `jobs/bootstrap-rating-requests.ts`). `apps/worker/src/main.ts` registers the scheduling consumer
  (`createRatingSchedulingConsumer`) and a **closed** claims lifecycle, so step 5 runs and the claim scheduler does
  not. Token keys: `RATING_TOKEN_DERIVATION_KEY`,
  `RATING_TOKEN_DERIVATION_KEY_VERSION`, `RATING_TOKEN_DERIVATION_RETIRED_KEYS` (worker env only; ADR-0057).
- **Rules:** one row per `(company, business, customer, business_date)`; `ratingSchedule`: 1 hour after, capped by
  the branch's closing time, deadline +30 minutes (spec 060 FR-B02, FR-B03).
- **Assertions:** the rating tables have `ENABLE` + `FORCE` RLS (cross-tenant read = 0 rows, write = error); the
  customer's rating opt-out is one-way (#704); no `rating_request` template exists in
  `packages/notifications/src/templates/`.
- **Sources:** `docs/specs/060-ratings-and-staff-app/spec.md` (part B, delivery rows 58-1 … 59b-3),
  `docs/adr/0057-rating-token-codec.md`, `docs/adr/0011-public-rating-link.md`.
