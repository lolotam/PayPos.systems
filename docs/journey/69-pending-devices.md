# 69 · List a branch's pending devices — قائمة أجهزة الفرع اللي مستنية موافقة

**Status / الحالة:** shipped in #660 (spec 070: one guarded read route), merged. **API only, no screen:** the admin
pairing and approval screens are still issue #634, so the manager's side of [03](03-pos-device-pairing.md) is still
done through the API. Before this route the id of a waiting device could only be read from the database; now the
manager's client can list the waiting devices and approve one by its id. The route is on staging.

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md) with the API and the POS; or staging with the demo company «صالون الأميرة
  (تجريبي)».
- A manager session with **إدارة أجهزة الفرع** / **Manage branch devices** on Salmiya, and a second user without it.
- A POS device that asked to be paired on Salmiya and is still waiting ([03](03-pos-device-pairing.md), up to the
  waiting screen).

## العربي

API بس، لسه مفيش شاشة.

1. **القائمة:** المدير يطلب أجهزة فرع السالمية اللي مستنية ← قائمة فيها لكل جهاز: الرقم (`id`)، والاسم (`label`)،
   ووقت الطلب (`created_at`)، الأحدث الأول.
2. **الموافقة:** ياخد الـ `id` ويوافق على الجهاز بالـ route بتاع الموافقة ([03](03-pos-device-pairing.md)) ← الجهاز
   يتربط، ويختفي من القائمة.
3. **صفحات:** لو الأجهزة أكتر من الحد (`limit`، الافتراضي 20 وأقصاه 100) ← الرد فيه `next_cursor` للصفحة اللي بعدها.
4. **من غير `status`:** الطلب من غير `status=pending`، أو بقيمة تانية ← **البيانات المرسلة غير صحيحة** (400).
5. **cursor غلط:** cursor بايظ أو من فرع أو شركة تانية ← 400 برضه.
6. **من غير صلاحية:** مستخدم ملوش **إدارة أجهزة الفرع** على الفرع، أو فرع في شركة تانية ← 403، وعمره ما يشوف
   أجهزة شركة تانية.

**ممنوع يحصل:**
- الرد يرجّع هاش الربط، أو هاش التوكن، أو بصمة الجهاز، أو نسخة التطبيق، أو رقم اللي وافق.
- جهاز اتوافق عليه أو اتلغى يظهر في القائمة.
- أجهزة فرع أو شركة تانية تظهر.

## English

API only, no screen yet.

1. **The list:** the manager asks for Salmiya's waiting devices → a list with, per device, its `id`, its `label` and
   when it asked (`created_at`), newest first.
2. **Approve:** he takes the `id` and approves the device with the approve route ([03](03-pos-device-pairing.md)) →
   the device is paired and leaves the list.
3. **Pages:** with more devices than the `limit` (default 20, at most 100) → the answer carries a `next_cursor` for
   the next page.
4. **No `status`:** a request without `status=pending`, or with another value → **The request is not valid** (400).
5. **A bad cursor:** a malformed cursor, or one from another branch or company → 400 as well.
6. **No permission:** a user without **Manage branch devices** on the branch, or a branch of another company → 403,
   and never another tenant's devices.

**Must NOT happen:**
- The answer carrying the claim hash, the token hash, the fingerprint, the app version or any approver id.
- An approved or revoked device in the list.
- Devices of another branch or company shown.

## For an agent

- **Screens:** none (issue #634).
- **API:** `GET /v1/branches/<BRANCH_ID>/devices?status=pending&limit=<N>&cursor=<CURSOR>` with `x-company-id` →
  `{ items: [{ id, label, created_at }], next_cursor }`. Then
  `POST /v1/branches/<BRANCH_ID>/devices/<DEVICE_ID>/approve`.
- **Permission:** `manage:devices:branch` on the branch (the same as approve and the pairing code).
- **Errors:** `VALIDATION_FAILED` 400 · `FORBIDDEN` 403.
- **Code:** `apps/api/src/modules/identity/http/pending-devices.controller.ts`,
  `apps/api/src/modules/identity/queries/pending-devices.query.ts`,
  `packages/contracts/src/identity/pending-devices.ts`.
- **Sources:** `docs/specs/070-identity-pending-devices/spec.md` (FR-001 … FR-005).
