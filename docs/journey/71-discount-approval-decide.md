# 71 · Approve or reject a discount (PIN on the reception device, or remotely) — الموافقة على الخصم أو رفضه

**Status / الحالة:** shipped in #957 (057-6: remote approve and reject), #1002 (057-7: approve or reject by phone +
PIN on the paired device), #1053 (057-8b-1: the approvals list and the PIN decision on the reception device) and
#1062 (057-8b-2: choosing which membership decides), all merged. This is the approver's half of
[70](70-discount-approval-request.md). **On staging:** the PIN screen is on the POS
(`https://pos.staging.pospay.systems`) once the reception computer is paired as a branch device
([03](03-pos-device-pairing.md)). **The remote decision is API only:** the admin pending list with approve and reject
(part of row 057-8a) has no screen yet.

**Before you start / قبل ما تبدأ:**
- Everything of [70](70-discount-approval-request.md), with a request by هبة (Heba) waiting on Salmiya.
- The reception computer paired and approved as a device of Salmiya.
- سارة (Sara), Branch Manager with **الموافقة على خصم فوق الحد** / **Approve discounts above the limit**, a phone
  number and a PIN ([08](08-staff-login-pos.md)), and a discount limit that covers 25%.
- منى (Mona), who holds the permission but whose limit is 10%.

## العربي

**بالـ PIN على جهاز الريسبشن:**

1. **القائمة:** على جهاز الريسبشن المربوط، قسم **موافقات الخصم** وتحته «راجعي طلبات الخصم المعلقة ووافقي أو ارفضي
   برقم تليفونك والرقم السري.» لو مفيش طلبات ← **مفيش طلبات خصم مستنية موافقة.**
2. **الطلب:** كل طلب فيه اسم الخدمة، و**السعر الأصلي** و**السعر** و**الخصم** و**الصافي** و**نسبة الخصم**، و**طلبتها**
   (الاسم الأول)، و**العميل** (الاسم الأول)، و**الوقت المتبقي** («فاضل … ساعة و… دقيقة»).
3. **وافقي:** سارة تدوس **اختاري** على الطلب، تكتب **رقم التليفون** و**الرقم السري**، وتدوس **موافقة** ← **جاري
   تنفيذ القرار…** وبعدها **اتوافق**، والطلب يختفي من القائمة. عند هبة السطر بقى **اتوافق** و**بـ PIN**.
4. **ارفضي:** نفس الخطوات مع **سبب الرفض (اختياري)** و**رفض** ← **اترفض**.
5. **رقم سري غلط:** ← **رقم التليفون أو الرقم السري غلط.** (نفس الرسالة لرقم مش موجود).
6. **محاولات كتير:** ← **الموافقة بالرقم السري متوقفة 15 دقيقة بعد محاولات غلط كتير. جربي تاني بعدين، أو وافقي من
   تطبيق الإدارة.**
7. **أكتر من عضوية:** لو سارة عندها أكتر من عضوية تقدر تقرر بيها ← **عندك أكتر من عضوية تقدري تاخدي بيها القرار.
   اختاري العضوية اللي هتاخدي بيها القرار.** وتختار (**الشركة** / **النشاط** / **الفرع**).
8. **حدّها أقل:** منى تحاول توافق على 25% وحدّها 10% ← بيترفض (`DISCOUNT_APPROVER_LIMIT_TOO_LOW`)، والطلب يفضل
   مستني.
9. **اللي طلبت ما توافقش:** هبة نفسها تحاول توافق على طلبها ← بيترفض (`DISCOUNT_APPROVER_IS_REQUESTER`).
10. **من غير نت:** ← **الموافقة بالرقم السري محتاجة اتصال بالإنترنت.**

**عن بُعد (API بس):**

11. سارة، بجلسة لوحة الإدارة، تقرا قائمة الطلبات المعلقة للفرع وتوافق أو ترفض من 1 لـ 20 طلب مرة واحدة ← كل طلب
    بيرجع بحالته الجديدة. عند هبة: **اتوافق** و**عن بُعد**.
12. **الطلب اتغيّر:** لو الطلب اتقرر أو اتغيّر قبلها ← 409، ومفيش قرار بيتكتب.

**ممنوع يحصل:**
- الرقم السري أو رقم التليفون يتخزّن على الجهاز، أو يظهر في رد أو في اللوج.
- موافقة بحد أقل من الخصم المطلوب.
- اللي طلبت توافق على طلبها.
- جهاز مربوط ياخد الصلاحية نفسها (القرار دايمًا باسم صاحبة الـ PIN).
- قائمة الجهاز تعرض اسم العميلة الكامل أو رقمها.
- قرارين على نفس الطلب.

## English

**By PIN on the reception device:**

1. **The list:** on the paired reception device, the **Discount approvals** section with "Review pending requests
   and approve or reject with your phone and PIN." With nothing waiting → **No discount requests are waiting for
   approval.**
2. **A request:** each one shows the service name, **List price**, **Price**, **Discount**, **Net**, **Discount %**,
   **Requested by** (first name), **Customer** (first name) and **Time left** ("… h … min left").
3. **Approve:** Sara clicks **Choose** on the request, types her **Phone** and **PIN**, and clicks **Approve** →
   **Deciding…**, then **Approved**, and the request leaves the list. On Heba's screen the line reads **Approved**
   and **via PIN**.
4. **Reject:** the same with **Rejection reason (optional)** and **Reject** → **Rejected**.
5. **A wrong PIN:** → **The phone or PIN is incorrect.** (the same message for an unknown phone).
6. **Too many attempts:** → **PIN approval is paused for 15 minutes after too many wrong attempts. Try again later,
   or approve from the admin app.**
7. **More than one membership:** if Sara holds more than one membership that can decide → **You hold more than one
   membership that can decide this. Choose the one to decide with.** and she picks (**Company** / **Business** /
   **Branch**).
8. **Her limit is lower:** Mona tries to approve 25% with a 10% limit → refused
   (`DISCOUNT_APPROVER_LIMIT_TOO_LOW`); the request stays waiting.
9. **The requester cannot approve:** Heba tries to approve her own request → refused
   (`DISCOUNT_APPROVER_IS_REQUESTER`).
10. **Offline:** → **PIN approval needs an internet connection.**

**Remotely (API only):**

11. Sara, with her admin session, reads the branch's pending list and approves or rejects 1 to 20 requests at once →
    each comes back with its new status. On Heba's screen: **Approved** and **via remote approval**.
12. **The request changed:** if it was decided or changed first → 409, and no decision is written.

**Must NOT happen:**
- The PIN or the phone stored on the device, or shown in an answer or a log.
- An approval by someone whose limit is below the requested discount.
- The requester approving her own request.
- A paired device holding the permission itself (the decision is always in the PIN holder's name).
- The device list showing the customer's full name or phone.
- Two decisions on one request.

## For an agent

- **Screen (PIN):** the POS at `https://pos.staging.pospay.systems` (local `http://localhost:5173`) on a paired
  device; component `apps/pos/src/discount-approval/ui/device-discount-approvals.tsx`, rendered from
  `apps/pos/src/app/reception-body.tsx`. Text in `packages/i18n/src/device-discount-approval-catalog.ts`.
- **Device API** (`apps/api/src/modules/orders/http/device-discount-proposals.controller.ts`, `@Authenticated()`,
  device only): `GET /v1/devices/me/discount-proposals` · `POST …/approve` · `POST …/reject`, body
  `{ proposal_ids (1…20), phone, pin, terms_hashes, approver_membership_id?, reason? }`.
- **Admin API** (`discount-proposals.controller.ts`, `approve:discounts:branch` + the `orders` feature):
  `GET /v1/businesses/<BUSINESS_ID>/branches/<BRANCH_ID>/discount-proposals/pending` · `POST …/approve` ·
  `POST …/reject`.
- **Errors:** `DISCOUNT_PROPOSAL_NOT_PENDING` 409 · `DISCOUNT_PROPOSAL_CHANGED` 409 ·
  `DISCOUNT_APPROVER_LIMIT_TOO_LOW` 403 · `DISCOUNT_APPROVER_IS_REQUESTER` 403 ·
  `DISCOUNT_APPROVER_MEMBERSHIP_REQUIRED` 422 · `DISCOUNT_REJECT_REASON_INVALID` 422 · `PIN_LOCKED` 423.
- **Lockout** (spec 057 D-15): 5 wrong PINs for one holder → 15 minutes; 10 failures across all phones on one device
  within 15 minutes → that device's PIN approval is locked for 15 minutes.
- **Assertions:** an owner's membership approves any discount; another membership approves only up to its own limit
  (FR-013); the audit has `discount_proposal.approved` / `.rejected` with the way it was decided.
- **Sources:** `docs/specs/057-orders-discount-approval/spec.md` (FR-011 … FR-018, D-9, D-15, §7 rows 057-6, 057-7,
  057-8b), `docs/adr/0051-discount-approval-device-pin-and-request-event.md`.
