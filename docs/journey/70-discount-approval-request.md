# 70 · Ask for a discount approval and use it — اطلب موافقة على خصم واستخدمها

**Status / الحالة:** shipped in #560 (057-4b: the request writer and the reads), #595 (057-5b: the database binds a
used approval to its own line), #657 (057-5: a line consumes an approved proposal when the visit is saved), #1015
(057-8a-1: the recording screen carries and always sends the proposal id) and #1022 (057-8a-1b: **اطلب موافقة** /
**Request approval** on the reception screen), all merged. This is the requester's half of
[57](57-discount-approval.md); the approver's half is [71](71-discount-approval-decide.md). **Runs on staging** on
the recording screen `/orders/service-sessions/new` ([47](47-record-visit-reception.md)). **Not built:** asking for
an approval from the **edit** dialog of a saved line (rows 057-9 and 057-9b); an edit above the limit is still
refused as in [49](49-price-discount-edit.md).

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md) with API, worker, Redis and admin; or the staging admin with the demo company
  «صالون الأميرة (تجريبي)». The `orders` and `customers` features on.
- هبة (Heba), a receptionist with **تسجيل جلسات خدمات الفرع** / **Record branch service sessions** on Salmiya and a discount limit of 10%
  ([15](15-discount-limit.md)).
- سارة (Sara), Branch Manager of Salmiya, who holds **الموافقة على خصم فوق الحد** / **Approve discounts above the
  limit**.

## العربي

1. **خصم فوق الحد:** هبة تسجّل زيارة ([47](47-record-visit-reception.md)) لعميلة وتحط خصم 25% على خدمة وتحفظ ← السطر
   بيترفض زي الأول (الخصم أعلى من حدها)، والزيارة ما بتتحفظش للسطر ده.
2. **اطلب موافقة:** تحت السطور المرفوضة قسم **موافقة الخصم** وفيه زرار **اطلب موافقة**. تدوس ← **جاري طلب
   الموافقة…** وبعدها السطر حالته **في انتظار الموافقة**.
3. **لازم عميلة:** لو لسه ما اختارتش عميلة ← **اختاري العميل قبل طلب الموافقة.**
4. **الجرس:** كل اللي معاهم الصلاحية على الفرع (ما عدا هبة) بيوصلهم إشعار واحد للطلب كله: «طلب موافقة على خصم في
   فرع السالمية: …، عدد السطور 1، الخصم حتى 25%.»
5. **اتوافق:** سارة توافق ([71](71-discount-approval-decide.md)) ← الشاشة عند هبة بتتحدّث لوحدها: **اتوافق**،
   و**صاحب القرار** (الدور/الاسم)، و**بـ PIN** أو **عن بُعد**، و**احفظي تاني دلوقتي**.
6. **احفظي تاني:** هبة تدوس حفظ تاني بنفس السعر والخصم ← السطر بيتحفظ، والموافقة حالتها **الموافقة اتستخدمت**.
7. **اترفض:** لو سارة رفضت ← **اترفض** ومعاها **السبب** لو اتكتب. السطر يفضل مرفوض.
8. **غيّرت الشروط:** هبة غيّرت السعر أو الخصم أو اللي عملوا الخدمة بعد الموافقة وحفظت ← الموافقة ما بتنفعش للسطر
   ده (الشروط اتغيرت)، ولازم طلب جديد.
9. **خلص وقته:** عدّى 24 ساعة من وقت **الطلب** ← **طلب الموافقة خلص وقته**. الموافقة ما بتفتحش 24 ساعة جديدة.
10. **فشل الطلب:** لو الطلب نفسه فشل (نت مثلًا) ← زرار **إعادة المحاولة**.

**ممنوع يحصل:**
- موافقة واحدة تتستخدم على سطرين، أو على سطر في فرع أو زيارة أو خدمة تانية.
- سطر يتحفظ بخصم أعلى من اللي اتوافق عليه.
- اسم العميلة الكامل أو رقمها أو اسم اللي طلبت يظهر في الجرس.
- الجرس يوصل لهبة نفسها.
- المهلة تتمد بعد الموافقة.

## English

1. **A discount above the limit:** Heba records a visit ([47](47-record-visit-reception.md)) for a customer with a
   25% discount on one service and saves → the line is refused as before (above her limit) and is not saved.
2. **Request approval:** under the refused lines there is a **Discount approval** section with a **Request
   approval** button. She clicks it → **Requesting approval…**, then the line reads **Waiting for approval**.
3. **A customer is required:** with no customer chosen yet → **Choose a customer before requesting approval.**
4. **The bell:** everyone who holds the permission on the branch (except Heba) gets one notice for the whole request:
   "Discount approval requested at Salmiya: …, 1 line(s), discount up to 25%."
5. **Approved:** Sara approves ([71](71-discount-approval-decide.md)) → Heba's screen updates by itself:
   **Approved**, **Decided by** (role/name), **via PIN** or **via remote approval**, and **Save again now**.
6. **Save again:** Heba saves again with the same price and discount → the line is saved, and the approval reads
   **Approval used**.
7. **Rejected:** if Sara rejects → **Rejected**, with the **Reason** when one was written. The line stays refused.
8. **Changed terms:** Heba changes the price, the discount or the performers after the approval and saves → the
   approval does not fit that line any more (the terms changed); a new request is needed.
9. **Expired:** 24 hours after the **request** → **Approval request expired**. Approving never opens a fresh 24
   hours.
10. **The request failed:** if the request itself failed (no network, for example) → a **Retry** button.

**Must NOT happen:**
- One approval used on two lines, or on a line of another branch, visit or service.
- A line saved with a discount above what was approved.
- The customer's full name or phone, or the requester's name, in the bell.
- The bell reaching Heba herself.
- The expiry moving after an approval.

## For an agent

- **Screen:** `/orders/service-sessions/new` (local `http://localhost:3001`, staging
  `https://app.staging.pospay.systems`); components `apps/admin/src/orders/ui/session-discount-approval.tsx` and
  `session-discount-approval-status.tsx`. The section is found by its label **موافقة الخصم** / **Discount approval**;
  text in `packages/i18n/src/discount-approval-catalog.ts`.
- **API** (`apps/api/src/modules/orders/http/discount-proposals.controller.ts`, prefix
  `/v1/businesses/<BUSINESS_ID>/branches/<BRANCH_ID>/discount-proposals`, the `orders` feature):
  `POST` (request, with `Idempotency-Key`) and `GET` (the requester's status read, polled by the screen), both
  `record:service-sessions:branch`. The saved line carries `discount_proposal: { id }`.
- **Statuses:** `PENDING`, `APPROVED`, `REJECTED`, `EXPIRED`, `CONSUMED`; `decided_via` is `PIN` or remote.
- **Errors** (`packages/i18n/src/discount-approval-errors.ts`): `DISCOUNT_APPROVAL_NOT_NEEDED` 422 (the discount is
  within her limit); line refusal labels `NOT_FOUND`, `NOT_APPROVED`, `EXPIRED`, `CONSUMED`, `TERMS_MISMATCH`.
- **Assertions:** `expires_at` = `requested_at` + 24 h and never changes; a proposal goes
  `PENDING→APPROVED|REJECTED` and `APPROVED→CONSUMED` only; one `DiscountApprovalRequested` event per request.
- **Sources:** `docs/specs/057-orders-discount-approval/spec.md` (FR-005, FR-019 … FR-021, D-21, §7 rows 057-4b,
  057-5, 057-5b, 057-8a), `docs/adr/0051-discount-approval-device-pin-and-request-event.md`.
