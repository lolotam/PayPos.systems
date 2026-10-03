# 15 · Per-person discount limit — حد الخصم للشخص

**Status / الحالة:** shipped in #84 (PR 7b). Local only (admin not deployed, issue #54). Your decisions of 2026-10-03
apply: fractional effective percentages round up to the next 0.01%; an active owner has no limit; every set/change/clear
is audited with a reason. Business defaults (PR 7c) and approval flows (PRs 38–41) are later slices.

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md), `pnpm db:migrate` and `pnpm db:seed` for the nullable limit and permission catalog;
  sign in, choose a company, then follow [12 The permissions screen](12-permissions-screen.md).
- The editor needs `read:memberships:company`, `manage:memberships:company` and an explicit effective
  `manage:discounts:company` grant covering the target membership and its descendants. Default bundles are deferred to PR 7a.
- Prepare an ordinary member with no personal limit, another membership of that same person, your own memberships,
  and an active owner with a lower membership. These must be synthetic fixtures within the selected company.

## العربي

1. من القائمة الجانبية دوس **الصلاحيات** ← **عرض** على العضو العادي. تحت قرارات الصلاحيات هتلاقي
   **حد الخصم الحالي**، ولو لسه متعيّنش: **لم يتم تعيين حد شخصي.** الحد محفوظ لكل عضوية؛ عضوية تانية لنفس الشخص مستقلة.
2. في **حد الخصم (%)** اكتب `12.34`، وفي **السبب** اكتب سبب التجربة ← **حفظ حد الخصم** ← **تم حفظ حد الخصم.**
   **حد الخصم الحالي** يبقى `12.34%`؛ افتح العضوية تاني وتأكد إنه محفوظ. ده `1234` bps، وكل bps = `0.01%`.
3. غيّره لـ `5.00` مع سبب جديد ← **حفظ حد الخصم** ← **تم حفظ حد الخصم.**؛ الحالي يبقى `5.00%`.
   التدقيق يحتفظ بالقديم `1234` والجديد `500` والسبب ومين عدّله ووقت القرار.
4. اكتب سبب، ودوس **مسح حد الخصم** ← **تم حفظ حد الخصم.**، وبعدها **لم يتم تعيين حد شخصي.**
   القيمة تبقى `null`؛ ده إزالة الحد الشخصي عشان قارئ حد النشاط المستقبلي يطبّق إعداداته، مش صفر ولا حد مفتوح تلقائيًا.
5. جرّب تحفظ `0` وبعدين `100` مع سبب لكل مرة ← `0.00%` و`100.00%`؛ الطرفين مسموحين.
   جرّب `-1` أو `100.01` أو `12.345`، أو حفظ/مسح من غير سبب ←
   **أدخل نسبة من 0 إلى 100 بمنزلتين عشريتين كحد أقصى مع السبب.**؛ القيمة المحفوظة ما تتغيرش.
6. افتح عضويتك أنت ← الحقول مقفولة و**لا يمكنك تعديل صلاحيات هذه العضوية.**
   من الـ API، محاولة تعديل عضوية تانية ليك كمان ← **لا يمكنك تعديل صلاحيات عضويتك الشخصية** (`PERMISSION_SELF_EDIT`، 403).
7. على عضوية شخص هو صاحب شركة نشط، حتى عضويته الأقل، جرّب حفظ أو تغيير أو مسح الحد ←
   **صلاحيات صاحب الشركة محمية من هذا التغيير** (`PERMISSION_OWNER_PROTECTED`، 403). صاحب الشركة النشط مالوش حد خصم؛
   اختيار دور صاحب الشركة في سجل الموظف لوحده ما بيعملش عضوية صاحب شركة.
8. لو معاك إدارة العضويات لكن مش معاك إدارة الخصومات على النطاق المطلوب، جرّب تحفظ على عضو عادي ←
   **لا تملك هذه الصلاحية حاليًا على النطاق المطلوب** (`PERMISSION_NOT_HELD`، 403). وجود الحقل على الشاشة مش إذن للحفظ.
9. **فحص حسابي للـ agent، مفيش شاشة بيع في الرحلة دي:** لكل بند، الخصم الفعلي = (سعر القائمة − الصافي) ÷ سعر القائمة.
   تخفيض السعر بيحسب خصم برضه. سعر `10.000` د.ك وصافي `8.766` يبقوا `12.34%`؛ لو النسبة فيها كسر أصغر من `0.01%`
   بتتقرب لفوق، فمثلًا `12.341%` تتقارن كـ `12.35%` وتتجاوز حد `12.34%`. المساواة مسموحة؛ سعر قائمة صفر أو زيادة السعر
   يبقوا خصم صفر. التجاوز هيحتاج اعتماد المدير في الشرائح الجاية؛ PR 7b بيحفظ الحد ويوفر الحساب بس.
10. كل حفظ أو تغيير أو مسح ناجح له تدقيق بسبب إلزامي، حتى تكرار نفس القيمة. الرفض ما يغيرش القيمة ولا يضيف تدقيق قرار.
    تاريخ الحد في سجل التدقيق، مش في **الاستثناءات المنتهية** الخاصة بقرارات سماح/منع الصلاحيات.

**ممنوع يحصل:**
- تعديل حد نفسك أو أي عضوية لصاحب شركة نشط؛ حفظ من غير الصلاحية أو من غير سبب.
- المسح يبقى صفر أو حد مفتوح تلقائيًا؛ قيمة عضوية تتنسخ تلقائيًا لعضوية تانية لنفس الشخص.
- التقريب لتحت يسمح بخصم فوق الحد؛ تخفيض السعر يهرب من حساب الخصم.
- تغيير من غير تدقيق؛ عضوية شركة تانية تتقرأ أو تتعدل؛ عرض اعتماد خصم أو حد نشاط كأنه موجود في PR 7b.

## English

1. Sidebar **Permissions** → **View** on the ordinary member. Below the permission decisions, find
   **Current discount limit** and, initially, "No personal limit set." The value belongs to this membership;
   another membership of the same person is independent.
2. Enter `12.34` in **Discount limit (%)** and a test reason in **Reason** → **Save discount limit** →
   "Discount limit saved." **Current discount limit** becomes `12.34%`; reopen the membership to confirm persistence.
   This is `1234` bps; each bps is `0.01%`.
3. Change to `5.00` with a new reason → **Save discount limit** → "Discount limit saved."; current becomes `5.00%`.
   The audit retains before `1234`, after `500`, reason, editor and decision time.
4. Enter a reason → **Clear discount limit** → "Discount limit saved.", then "No personal limit set."
   The value becomes `null`, removing the personal override for a future business-default reader; it does not
   automatically mean zero or unlimited.
5. Save `0`, then `100`, each with a reason → `0.00%` and `100.00%`; both endpoints are valid.
   Try `-1`, `100.01`, `12.345`, or save/clear without a reason →
   "Enter a percentage from 0 to 100 with at most two decimals and a reason."; the stored value remains unchanged.
6. Open your own membership → disabled controls and "You cannot edit this membership’s permissions."
   Through the API, editing another membership of your own also returns "You cannot edit permissions on your own membership"
   (`PERMISSION_SELF_EDIT`, 403).
7. On any membership of an active owner, including their lower membership, try setting, changing or clearing →
   "Owner permissions are protected from this change" (`PERMISSION_OWNER_PROTECTED`, 403). An active owner has no
   discount limit; selecting the Owner role in an employee HR record alone does not create owner membership.
8. With membership-management authority but without discount-management authority over the target scope, save on an
   ordinary member → "You do not currently hold this permission over the target scope" (`PERMISSION_NOT_HELD`, 403).
   A visible field does not authorize saving.
9. **Agent arithmetic check; there is no sales screen in this journey:** per line, effective discount =
   (list price − net) / list price. Lowering the price also counts. List `10.000` KWD and net `8.766` give `12.34%`;
   fractional `0.01%` units round up, so `12.341%` is compared as `12.35%` and exceeds a `12.34%` limit. Equality is allowed;
   zero list price or a price increase gives zero discount. Above-limit actions will need manager approval in later slices;
   PR 7b stores the limit and supplies the arithmetic only.
10. Every successful set/change/clear has an audit with a required reason, including repeated values. Refusal changes
    neither the value nor decision history. Limit history is in the audit log, not the **Ended overrides** list for
    permission Allow/Deny decisions.

**Must NOT happen:**
- Editing your own limit or an active owner's memberships; saving without authority or a reason.
- Clearing interpreted automatically as zero/unlimited; a membership value copied automatically to another membership.
- Rounding down admitting an above-limit discount; price reductions escaping the calculation.
- Unaudited changes; cross-company membership reads/edits; presenting approvals or business defaults as part of PR 7b.

## For an agent

- Admin at `http://localhost:3001/permissions`. After **View**, use `#discount-percentage` and `#discount-reason`;
  the panel has other **Reason** inputs, so scope by the discount form. Current values display two decimals.
- API (session cookie + `x-company-id`): `POST /v1/permissions/memberships/{membershipId}/discount-limit`
  with strict `{ "limit_bps": 1234, "reason": "<SYNTHETIC_REASON>" }` → 200 `{ "limit_bps": 1234 }`.
  Change to `500`, then clear with `null`; reason is trimmed and required, 1–500 characters.
  `GET /v1/permissions/memberships/{membershipId}` includes `discount_limit: { limit_bps }`.
- Compare audit before/after for the three decisions; there is one current value with immutable history.
  Errors: 400 invalid body, 401 no session, 403 self/owner/not-held/outside-reach, 404 unknown membership,
  409 `TRANSACTION_RETRY_REQUIRED` for a conflicting transaction. Refused changes leave the current value untouched.
- Arithmetic checks use `effectiveDiscountBps` and `isWithinLimit` in
  `apps/api/src/modules/identity/domain/discount-limit.ts`; these are agent checks, not browser actions.
  A future reader distinguishes `SET`, `NOT_SET`, and `MEMBERSHIP_NOT_FOUND`.
- Sources: `docs/specs/016-identity-discount-limit/spec.md`, `apps/admin/src/permissions/ui/discount-limit-fields.tsx`,
  `apps/admin/src/permissions/ui/discount-limit-form.tsx`, `packages/contracts/src/identity/discount-limit.ts`,
  and the `permissions`/`errors` entries in `packages/i18n/src/{ar,en}.ts`.
