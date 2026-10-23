# 57 · Discount approval (foundation) — الموافقة على خصم فوق الحد (الأساس)

**Status / الحالة:** the foundation shipped in #465 (057-1: contracts, bell template, ADR-0051), #469 (057-2: the
permission and the storage), #498 (057-4a: the pure rules, error codes and refusal labels), #504 (fix: an approval
expires 24 hours after the **request**, and approving never moves that time) and #523 (057-3: the bell consumer), all
merged. **Nobody can request or approve a discount yet:** there is no request route (057-4b), no approve or reject
route (057-6, 057-7), no consumption in the visit writer (057-5) and no screen (057-8a, 057-8b). Nothing emits
`DiscountApprovalRequested`, so **the bell never rings yet**. Since #533 (2026-10-23) staging runs the admin at
`https://app.staging.pospay.systems`, the POS at `https://pos.staging.pospay.systems` and the API + worker at
`https://api.staging.pospay.systems` with demo data only; the foundation is there, and the only thing you can see is the
new permission. Your answers DA-Q1…DA-Q5 apply: [owner-questions.ar.md](../specs/057-orders-discount-approval/owner-questions.ar.md)
(DA-Q4b as Abu Salem picked it: 24 hours from the request, no fresh window; the spec and ADR-0051 now record it).

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md), then `pnpm db:migrate` (migrations 0162–0164, 0166, 0172, 0173) and `pnpm db:seed`;
  or the staging admin with the demo company «صالون الأميرة (تجريبي)» (branches Salmiya and Hawalli).
- The permissions screen ([12](12-permissions-screen.md)) as the Owner, and synthetic members: سارة (Sara), Branch
  Manager of Salmiya; هبة (Heba), a receptionist (Cashier) of Salmiya.

## العربي

لسه مفيش API للطلب أو الموافقة، ولسه مفيش شاشة: الأساس بس.

1. **الصلاحية الجديدة:** افتح شاشة الصلاحيات ([12](12-permissions-screen.md)) على عضوية سارة ← في القائمة صلاحية
   **الموافقة على خصم فوق الحد**، وعندها افتراضيًا لأنها مديرة فرع. نفس الصلاحية افتراضيًا لصاحب الشركة والمدير
   العام ومدير النشاط.
2. **تديها لحد بالاسم:** على عضوية هبة (كاشير) اعمل **سماح** لـ **الموافقة على خصم فوق الحد** على فرع السالمية ←
   يتحفظ. أي دور بشري ينفع ياخدها بالاسم.
3. **الجهاز ما ياخدهاش:** جهاز الكاشير المربوط ما ينفعش ياخد الصلاحية دي أبدًا، حتى بسماح.
4. **لسه مفيش طلب:** مفيش زرار لطلب الموافقة على أي شاشة، ومفيش route للطلب أو الموافقة، والجرس ما بيرنّش.
   لما الطلب يتبني (057-4b)، كل اللي معاه الصلاحية على الفرع (ما عدا اللي طلبت) هيوصله إشعار واحد للطلب كله، بالشكل ده:
   **طلب موافقة على خصم في فرع {{branch_name_ar}}: {{service_name_ar}}، عدد السطور {{line_count}}، الخصم حتى {{max_percent}}%.**
   الجرس ده دايمًا شغال وبرّه قواعد التنبيهات ([58](58-alert-rules.md)).
5. **المهلة:** الموافقة صالحة 24 ساعة من وقت **الطلب**. الموافقة ما بتفتحش مهلة جديدة، والرفض والاستخدام ما بيغيروهاش.

**ممنوع يحصل:**
- جهاز مربوط ياخد **الموافقة على خصم فوق الحد**.
- المهلة تتغير بعد ما الطلب يتسجل (الموافقة بتفتح 24 ساعة جديدة).
- الجرس يوصل للي طلبت، أو لحد عليه منع (DENY) للصلاحية على الفرع (إلا صاحب الشركة)، أو لفرع تاني.
- اسم الزبونة الكامل أو رقمها أو اسم اللي طلبت يظهر في الجرس.

## English

No request or approve API and no screen yet: the foundation only.

1. **The new permission:** open the permissions screen ([12](12-permissions-screen.md)) on Sara's membership → the list
   has **Approve discounts above the limit**, held by default because she is a Branch Manager. The Owner, General
   Manager and Business Manager hold it by default too.
2. **Grant it by name:** on Heba's (Cashier) membership give a personal **Allow** for **Approve discounts above the
   limit** on Salmiya → saved. Any human role can receive it by name.
3. **A device never holds it:** the paired POS device can never hold this permission, even with an Allow.
4. **No request yet:** there is no button to ask for approval on any screen, no request or approve route, and the bell
   does not ring. Once the request is built (057-4b), everyone who holds the permission on the branch (except the requester) gets
   one notice per request, in this shape:
   **Discount approval requested at {{branch_name_en}}: {{service_name_en}}, {{line_count}} line(s), discount up to {{max_percent}}%.**
   This bell is always on and sits outside the alert rules ([58](58-alert-rules.md)).
5. **Validity:** an approval is valid for 24 hours from the **request**. Approving does not open a fresh window;
   rejection and consumption do not change it either.

**Must NOT happen:**
- A paired device holding **Approve discounts above the limit**.
- The expiry moving after the request is written (an approval opening a fresh 24 hours).
- The bell reaching the requester, someone with a DENY on the permission for the branch (the Owner excepted), or another
  branch.
- The customer's full name or phone, or the requester's name, in the bell.

## For an agent

- **Screens:** none for this feature. Permission label on the permissions screen (`http://localhost:3001`, or
  `https://app.staging.pospay.systems`): **الموافقة على خصم فوق الحد** / **Approve discounts above the limit**
  (`packages/i18n/src/permission-codes-catalog.ts`, key `approveDiscountsBranch`). Credentials come from the owner
  privately.
- **API:** no discount-approval route is mounted (`grep` of `apps/api/src/**/http/` finds none). The OpenAPI in
  `packages/contracts/src/orders/discount-approval-openapi.ts` describes the eight future operations; calling them
  today returns 404. Grant: `POST /v1/permissions/memberships/<MEMBERSHIP_ID>/overrides` with
  `{ "permission_code": "approve:discounts:branch", "effect": "ALLOW", "scope_type": "BRANCH", ... }` (journey 12).
- **Permission:** `approve:discounts:branch`, default `owner`, `general_manager`, `business_manager`, `branch_manager`
  (`packages/db/src/role-defaults.ts`); in `deviceForbidden` (`packages/db/src/system-role-policy.ts`).
- **Error codes defined, not reachable yet** (`apps/api/src/shared/errors.ts`, `packages/i18n/src/discount-approval-errors.ts`):
  `DISCOUNT_APPROVAL_NOT_NEEDED` 422 · `DISCOUNT_PROPOSAL_NOT_PENDING` 409 · `DISCOUNT_PROPOSAL_CHANGED` 409 ·
  `DISCOUNT_APPROVER_LIMIT_TOO_LOW` 403 · `DISCOUNT_APPROVER_IS_REQUESTER` 403 ·
  `DISCOUNT_APPROVER_MEMBERSHIP_REQUIRED` 422 · `DISCOUNT_REJECT_REASON_INVALID` 422. Line refusal labels
  (`approval_refusal`): `NOT_FOUND` «مفيش موافقة صالحة» / "No valid approval", `NOT_APPROVED`, `EXPIRED`, `CONSUMED`,
  `TERMS_MISMATCH`.
- **Bell (when 057-4b emits):** worker consumer `orders.discount-approval-notice-v1` on `DiscountApprovalRequested`,
  ledger `discount_approval_notices` (one row per `request_id`), `DiscountApprovalNoticeRequested` in groups of at most
  100, `template_key: "discount_approval_requested"`, rendered by `apps/admin/src/notifications/model/render-notification.ts`
  (Arabic names fall back to English). Not gated by the alert rules or the master switch (DA-Q11).
- **Assertions (DB):** `discount_proposals` and `discount_proposal_performers` have `ENABLE` + `FORCE` RLS (cross-tenant
  read = 0 rows, write = error); a proposal is inserted only as `PENDING`; the trigger
  `discount_proposals_transition_guard` allows only `PENDING→APPROVED|REJECTED` and `APPROVED→CONSUMED`;
  `expires_at` = `requested_at` + 24 h and any update of it is refused (`23514`; `pospay_app` has no `UPDATE (expires_at)`
  after 0166); recipients = active members whose membership covers the branch and grants the permission (role default or
  own ALLOW), minus any DENY covering the branch (an owner's DENY ignored), minus the requester.
- **Sources:** `docs/specs/057-orders-discount-approval/spec.md` (§7 delivery table),
  `docs/adr/0051-discount-approval-device-pin-and-request-event.md`, `packages/contracts/src/orders/discount-approval*.ts`,
  `apps/api/src/modules/orders/domain/discount-approval-rules.ts`, `packages/db/schema/orders-discount-proposals.ts`,
  `apps/worker/src/modules/identity/domain/discount-approver-access.ts`,
  `packages/notifications/src/templates/discount-approval-requested.ts`, `packages/i18n/src/in-app-catalog.ts`.
