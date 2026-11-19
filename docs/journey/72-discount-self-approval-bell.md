# 72 · Owner bell: a discount approved on the approver's own work — جرس المالك: موافقة على خصم على شغل الموافِق

**Status / الحالة:** shipped in #937 (057-3b-1: the bell ledger and the `DISCOUNT_SELF_APPROVED` alert kind), #945
(057-3b-2: the pure rules and ports), #946 (057-3b-3: the worker consumer) and #948 (057-3b-4: the rule variants and
the row on the alerts screen), all merged. An approver **may** approve a discount on a service she performed herself
(owner answer DA-Q3); the system never refuses it, but it tells the owner. **On staging:** the worker consumer and the
alerts-screen row are there; you see the result in the admin bell ([04](04-admin-notifications-bell.md)) after an
approval of [71](71-discount-approval-decide.md).

**Before you start / قبل ما تبدأ:**
- Everything of [70](70-discount-approval-request.md) and [71](71-discount-approval-decide.md), with the worker
  running.
- سارة (Sara), Branch Manager and approver, who is also linked to an employee and is one of the **performers** of the
  service line in the request.
- The **Owner** signed in to the admin on another browser.

## العربي

1. **الطلب:** هبة تطلب موافقة على خصم 25% على خدمة سارة واحدة من اللي عملوها
   ([70](70-discount-approval-request.md)).
2. **سارة توافق:** سارة توافق على الطلب (بالـ PIN أو عن بُعد) ← الموافقة بتتم عادي، من غير أي رفض أو تحذير.
3. **جرس المالك:** صاحب الشركة بيلاقي في الجرس: «وافق {اسم سارة} على خصم حتى 25% على خدمة {اسم الخدمة} نفّذها بنفسه
   في فرع السالمية.»
4. **كل الملاك:** كل مالك نشط مغطي الفرع بيوصله الإشعار، حتى لو هو نفسه اللي وافق.
5. **مرة واحدة:** لو الموافقة شملت كذا سطر في نفس الطلب، أو الـ worker أعاد المحاولة ← إشعار واحد لكل عملية موافقة.
6. **من شاشة التنبيهات:** في **التنبيهات** ([62](62-alert-rules-screen.md)) سطر **موافقة على خصم على شغل
   الموافِق**. اقفل المفتاح بتاعه ← الإشعار ده بيبطل يوصل. افتحه وغيّر الأدوار في **المستلمين** ← اللي يوصلهم
   بيتغيّر (الافتراضي: المالك).
7. **موافِقة مش من اللي عملوا الخدمة:** لو اللي وافقت مش واحدة من منفّذين السطر ← مفيش الجرس ده.

**ممنوع يحصل:**
- الموافقة تترفض لمجرد إن الموافِقة من اللي عملوا الخدمة.
- إشعارين لنفس عملية الموافقة.
- اسم العميلة أو رقمها في الإشعار.
- الجرس ده يوصل لفرع أو شركة تانية.
- جرس **طلب** الموافقة ([57](57-discount-approval.md)) يتقفل من شاشة التنبيهات (ده دايمًا شغال؛ اللي بيتقفل جرس
  المالك ده بس).

## English

1. **The request:** Heba asks for approval of a 25% discount on a service Sara is one of the performers of
   ([70](70-discount-approval-request.md)).
2. **Sara approves:** Sara approves it (by PIN or remotely) → the approval goes through as usual, with no refusal and
   no warning.
3. **The owner's bell:** the Owner finds in the bell: "{Sara's name} approved a discount of up to 25% on {service
   name}, a service they performed, at Salmiya."
4. **Every owner:** every active owner covering the branch is told, the approving owner included.
5. **Once:** if the approval covered several lines of one request, or the worker retried → one notice per approve
   action.
6. **From the alerts screen:** on **Alerts** ([62](62-alert-rules-screen.md)) there is a row **Discount approved on
   the approver's own work**. Turn its switch off → this notice stops arriving. Turn it on and change the roles
   under **Recipients** → who receives it changes (default: the owner).
7. **An approver who did not perform it:** if the approver is not one of the line's performers → no such bell.

**Must NOT happen:**
- An approval refused only because the approver performed the service.
- Two notices for one approve action.
- The customer's name or phone in the notice.
- This bell reaching another branch or company.
- The approval **request** bell ([57](57-discount-approval.md)) switched off from the alerts screen (that one is
  always on; only this owner bell follows the rule).

## For an agent

- **Screens:** the admin bell ([04](04-admin-notifications-bell.md)) and the `DISCOUNT_SELF_APPROVED` row on
  `/alert-rules`, label **موافقة على خصم على شغل الموافِق** / **Discount approved on the approver's own work**
  (`packages/i18n/src/alert-rules-catalog.ts`).
- **Bell text:** `discount_self_approved` in `packages/i18n/src/in-app-catalog.ts`; template
  `packages/notifications/src/templates/discount-self-approved.ts`.
- **Flow:** the approve transaction stores `approver_is_performer` on the proposal and appends one
  `DiscountApprovedByPerformer` event; the worker consumer writes one `discount_self_approval_notices` row per source
  event and requests the notice for the roles of the kind's effective rule (default `owner`).
- **Assertions:** `discount_self_approval_notices` has `ENABLE` + `FORCE` RLS and `UNIQUE (company_id,
  source_event_id)`; the rule off or the master switch off → no notice; the audit entry of the approval records the
  flag.
- **Sources:** `docs/specs/057-orders-discount-approval/spec.md` (FR-014, D-19, §7 row 057-3b), journey
  [58](58-alert-rules.md) (the kind is listed as live there).
