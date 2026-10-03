# 17 · Business discount default — حد الخصم الافتراضي للنشاط

**Status / الحالة:** PR 7c (#86), merged into `main`. Admin is not deployed to staging yet (issue #54), so run it locally. Your decisions of 2026-10-03 apply: active owner unlimited, then
personal limit, then business default, then NOT_CONFIGURED; explicit zero is retained; set/change/clear are audited.
PR 35 will enforce NOT_CONFIGURED as 0%, requiring approval for every positive discount.

**Before you start / قبل ما تبدأ:**
- Follow [00 Local setup](00-local-setup.md), apply the PR 7c migration and seed the permission catalog;
  sign in and select a company and business ([01](01-admin-sign-in-and-totp.md), [02](02-admin-workspace-selector.md)).
- Opening [12 The permissions screen](12-permissions-screen.md) needs `read:memberships:company`; reading the default
  needs `read:settings:business`. Saving needs `manage:settings:business` plus effective `manage:discounts:company`
  covering the business and all descendant branches. Prepare explicit grants; PR 7a owns default role bundles.
- Prepare synthetic active memberships covering the business: an owner, a non-owner with a personal limit and one
  without it; also a second business. Prepare/change personal limits through [15](15-discount-limit.md) with its required authority.
  Resolver scenarios are agent checks, not a new sales screen or an effective-limit label on this panel.

## العربي

1. اختار النشاط وافتح **الصلاحيات** ← أعلى قائمة العضويات تظهر **حد الخصم الافتراضي** وبعده اسم
   النشاط، والوصف **يُستخدم عند غياب الحد الشخصي. المالك النشط بلا حد خصم.** لو مفيش نشاط مختار، القسم ده مش بيظهر.
2. في القسم ده راجع **حد الخصم الحالي**؛ لو النشاط لسه ما ضبطش حد، يظهر **لم يُضبط حد افتراضي للنشاط.**
   في **حد الخصم الافتراضي (%)** اكتب `12.34`، وفي **السبب** اكتب سبب التجربة ← **حفظ حد الخصم** ←
   **تم حفظ حد الخصم.** الحالي يبقى `12.34%`؛ افتح الشاشة تاني وتأكد إن القيمة محفوظة كـ `1234` bps.
3. غيّره لـ `5.00` مع سبب جديد ← **حفظ حد الخصم** ← **تم حفظ حد الخصم.**؛ الحالي يبقى `5.00%`.
   التدقيق يحتفظ بقيمة قبل/بعد، النشاط، الفاعل، السبب ووقت القرار. اختار نشاط تاني: حده مستقل وما يتنسخش تلقائيًا.
4. جرّب `0` مع سبب ← `0.00%`، والـ API يرجع `limit_bps: 0`؛ الصفر إعداد صريح مش عدم إعداد.
   `100` مسموح كمان. جرّب `-1` أو `100.01` أو `12.345` أو حفظ/مسح من غير سبب ←
   **أدخل نسبة من 0 إلى 100 بمنزلتين عشريتين كحد أقصى مع السبب.**؛ القيمة والتدقيق ما يتغيروش.
5. اكتب سبب ودوس **مسح حد الخصم** ← **تم حفظ حد الخصم.** ثم **لم يُضبط حد افتراضي للنشاط.**
   القيمة ترجع `null` حسب قالب النشاط، وإزالة الافتراضي ما تمسحش حدود الأشخاص. سجل التدقيق يحتفظ بقرار المسح؛
   حتى حفظ نفس القيمة أو مسحها تاني، مع سبب، بيتسجل كقرار جديد.
6. **فحص الحل الفعلي للـ agent:** جهّز الحالات في الجدول، واقرأ النتيجة من قارئ الحد الفعلي؛ ترتيب الأولوية ثابت.
   الحد الشخصي تابع للعضوية المطلوبة؛ لو هو `0`، يفضل صفر حتى لو افتراضي النشاط أكبر. صاحب الشركة النشط بلا حد،
   حتى لو له عضوية أقل أو قيمة شخصية قديمة. النتيجة دي ما بتديش صلاحية تنفيذ الخصم لوحدها.

   | الحالة | الحد الشخصي | افتراضي النشاط | نتيجة القارئ | المعنى |
   |---|---|---|---|---|
   | صاحب شركة نشط | أي قيمة أو `null` | أي قيمة أو `null` | `UNLIMITED`, `source: OWNER` | بلا حد خصم |
   | شخص غير مالك له حد شخصي | `1234`، أو `0` صريح | `500` | `SET`, `source: PERSON`, `limit_bps: 1234` أو `0` | الشخص له الأولوية؛ `12.34%` أو `0.00%` |
   | شخص غير مالك بلا حد شخصي، والافتراضي مضبوط | `null` | `500` | `SET`, `source: BUSINESS`, `limit_bps: 500` | يستخدم `5.00%` من النشاط |
   | شخص غير مالك، والاتنين مش مضبوطين | `null` | `null` | `NOT_CONFIGURED` | PR 35 هيطبقها كـ `0%`؛ كل خصم موجب يحتاج اعتماد |

7. `NOT_CONFIGURED` تفضل حالة واضحة في القارئ، ما تتحولش لسماح مفتوح. تنفيذ قاعدة `0%` وطلب الاعتماد على البيع
   مش موجودين في PR 7c؛ PR 35 هيطبق قاعدة عدم الإعداد، وتدفق الاعتماد نفسه في PRs 38–41.
   إعداد الحد ما بيحفظش خصم فعلي على فاتورة أو جلسة.
8. بحساب يقدر يدير إعدادات النشاط لكن ما عندوش سلطة الخصومات المطلوبة، جرّب الحفظ ←
   **لا تملك هذه الصلاحية حاليًا على النطاق المطلوب** (`PERMISSION_NOT_HELD`، 403).
   انتهاء الصلاحية أو منع يغطي فرع من فروع النشاط يمنع الحفظ؛ وجود النموذج مش بديل عن فحص السيرفر.
9. راجع كل ضبط أو تغيير أو مسح في التدقيق بقيمة قبل/بعد والسبب. مفيش حفظ جزئي لو التدقيق فشل، والرفض ما يضيفش قرار.
   إعدادات اللغة والتقويم وباقي إعدادات النشاط تفضل زي ما هي؛ شركة تانية ما ينفعش تتقرأ أو تتعدل، وعضوية مفقودة
   أو غير سارية أو خارج النشاط ما ينفعش تاخد حد افتراضي لمجرد إنه مضبوط.

**ممنوع يحصل:**
- افتراض إن البيع أو الاعتمادات اتنفذوا في PR 7c.
- افتراضي النشاط يتغلب على حد شخصي أو صفر صريح، أو المالك النشط يتحط له حد.
- عدم الإعداد يتحول لخصم مفتوح؛ عضو خارج النشاط أو غير ساري يستفيد من افتراضيه.
- ضبط/مسح من غير سبب أو تدقيق؛ تعديل يؤثر على نشاط/شركة تانية أو يغيّر إعدادات أخرى.

## English

1. Select the business and open **Permissions** → above the membership list, find
   **Default discount limit** followed by the business name, with
   "Used when a person has no personal limit. Active owners have no limit." No selected business means no default section.
2. In that section, inspect **Current discount limit**; initially it says "No business default configured."
   Enter `12.34` in **Default discount limit (%)** and a test **Reason** → **Save discount limit** →
   "Discount limit saved." Current becomes `12.34%`; reopen to confirm persistence as `1234` bps.
3. Change to `5.00` with a new reason → **Save discount limit** → "Discount limit saved."; current becomes `5.00%`.
   Audit retains before/after, business, actor, reason and decision time. Select another business: its default remains independent.
4. Save `0` with a reason → `0.00%` and API `limit_bps: 0`; zero is an explicit setting, not unset.
   `100` is valid too. Try `-1`, `100.01`, `12.345`, or save/clear without a reason →
   "Enter a percentage from 0 to 100 with at most two decimals and a reason."; value and audit remain unchanged.
5. Enter a reason → **Clear discount limit** → "Discount limit saved.", then "No business default configured."
   The value returns to the business template's `null`; clearing the default does not remove personal limits.
   Audit retains the clear decision; repeating the same set/clear with a reason is another audited decision.
6. **Agent effective-resolution check:** prepare the table's cases and read the effective-limit capability; precedence is fixed.
   The personal value belongs to the requested membership; an explicit `0` wins even over a higher default.
   An active owner is unlimited, including lower memberships or old stored personal values. Resolution alone grants no discount permission.

   | Scenario | Personal limit | Business default | Reader result | Meaning |
   |---|---|---|---|---|
   | Active owner | Any value or `null` | Any value or `null` | `UNLIMITED`, `source: OWNER` | No discount limit |
   | Non-owner with a personal limit | `1234`, or explicit `0` | `500` | `SET`, `source: PERSON`, `limit_bps: 1234` or `0` | Person wins; `12.34%` or `0.00%` |
   | Non-owner without a personal limit, default set | `null` | `500` | `SET`, `source: BUSINESS`, `limit_bps: 500` | Uses the business's `5.00%` |
   | Non-owner with neither configured | `null` | `null` | `NOT_CONFIGURED` | PR 35 will enforce `0%`; every positive discount needs approval |

7. `NOT_CONFIGURED` remains an explicit reader result; it never implies unlimited authority.
   Sales enforcement of `0%` and requesting approval are absent from PR 7c: PR 35 will enforce the unconfigured rule;
   approval flows belong to PRs 38–41. Configuring a limit does not execute a discount on an invoice/session.
8. With settings-management access but without the required discount authority, save →
   "You do not currently hold this permission over the target scope" (`PERMISSION_NOT_HELD`, 403).
   Expired authority or a DENY covering a descendant branch prevents saving; a visible form does not replace server checks.
9. Inspect every set/change/clear audit with before/after and reason. Audit failure rolls back the setting; refusal adds no decision.
   Language, calendar and other business settings remain unchanged; another company cannot be read/edited.
   Missing, inactive or out-of-business memberships cannot receive a default merely because it is configured.

**Must NOT happen:**
- Presenting sales/approval enforcement as part of PR 7c.
- A default overriding a personal limit/explicit zero, or capping an active owner.
- Unconfigured interpreted as unlimited; inactive/out-of-business members inheriting a default.
- Set/clear without reason/audit; edits affecting another business/company or unrelated settings.

## For an agent

- Admin route: `http://localhost:3001/permissions`. Locate the section by its accessible name
  **Default discount limit** / **حد الخصم الافتراضي**, then find its percentage, **Reason**, save and clear controls.
  IDs are generated with `useId`; do not use the personal form's older fixed IDs. Both forms reuse save/clear labels.
- API in PR 7c (session cookie + `x-company-id`): `GET /v1/businesses/{businessId}/settings` → 200 with `limit_bps`;
  `POST /v1/businesses/{businessId}/settings/discount-limit` with strict
  `{ "limit_bps": 1234, "reason": "<SYNTHETIC_REASON>" }` → 200 `{ "limit_bps": 1234 }`.
  Use `500`, `0`, or `null` for change/zero/clear; reasons are trimmed, required, 1–500 characters. No `Idempotency-Key`.
  Generic settings `PATCH` does not accept `limit_bps`; it must not bypass the audited command.
- Scenario tables describe `resolveEffectiveDiscountLimit` and exported `readEffectiveDiscountLimit` through
  `apps/api/src/modules/settings/index.ts`, not an HTTP resolver endpoint or UI badge. Use synthetic subjects and the
  existing reader harness; missing/inactive/out-of-business subjects return `MEMBERSHIP_NOT_FOUND`, not a default.
- Verify `audit_log` entity `business_discount_limit`, actions `business_discount_limit.set` / `business_discount_limit.cleared`,
  before/after limit and reason/actor/time. `0` remains in the settings response's `overridden` list as `limit_bps`;
  clearing removes that override. Setting the default does not edit membership limits or grant permissions.
- Standard errors: 400 invalid input, 401 no session, 403 insufficient/expired/denied authority;
  `TRANSACTION_RETRY_REQUIRED` (409) reuses the API catalog. No cross-company reads/writes.
- PR 7c sources: `docs/specs/018-settings-business-discount-default/spec.md`,
  `docs/adr/0023-business-discount-default-reads.md`, `apps/admin/src/permissions/ui/business-discount-default.tsx`,
  its API hook/shared form, `apps/api/src/modules/settings`, and `packages/i18n/src/{ar,en}.ts`.
