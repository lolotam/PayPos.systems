# 59 · Staff app settings: columns and months back — إعداد تطبيق الموظفات: الأعمدة وعدد الشهور

**Status / الحالة:** shipped in #468 (57c-1: storage, the two routes and `StaffColumnsPort`), #513 (own permission
`manage:staff-app-columns:business`) and #516 (months back: default 2, range 1–12), all merged. **API only, no screen
yet** (the admin settings screen is row 57c-2). **Nothing reads the setting yet:** the staff app's «شغلي» and «حضوري»
reads that will follow it are rows 57-2 and 57b-1, not built, so saving changes no screen today. Since #533 (2026-10-23)
staging runs the admin at `https://app.staging.pospay.systems`, the POS at `https://pos.staging.pospay.systems` and the
API at `https://api.staging.pospay.systems`, demo data only: the two routes are there. Your answers MY-Q2, MY-Q3, MY-Q4,
MY-Q5, MY-Q9, MY-Q10 apply (MY-Q2, MY-Q5, MY-Q9, MY-Q10 as Abu Salem picked them):
[owner-questions.ar.md](../specs/060-ratings-and-staff-app/owner-questions.ar.md).

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md), then `pnpm db:migrate` (0161, 0168) and `pnpm db:seed`; or staging with the demo
  company «صالون الأميرة (تجريبي)».
- Synthetic users: the **Owner**, a **General Manager**, a **Business Manager** (the three hold
  **أعمدة تطبيق الموظفين** / **Manage staff app columns** by default); a user with only
  **عرض إعدادات النشاط** / **Read business settings**; a user with only **إدارة إعدادات النشاط** /
  **Manage business settings**.

## العربي

API بس، لسه مفيش شاشة. ولسه مفيش حاجة في تطبيق الموظفات بتقرا الإعداد ده.

1. **الافتراضي:** صاحب الشركة يقرا الإعداد ← الأعمدة `date`، `time`، `service`، `customer_name`، `share`،
   `estimated_commission`، `tip` (`columns_default: true`). مفيش السعر ولا الخصم ولا الصافي. وعدد الشهور **2** (الشهر
   الحالي واللي قبله، `months_back_default: true`).
2. **حفظ أعمدة:** يحفظ أعمدة من غير `estimated_commission` وعدد الشهور 3 ← بيرجع نفس الأعمدة بالترتيب الرسمي، و3 شهور. سطر
   تدقيق لكل قيمة اتغيرت. نفس الأعمدة بترتيب تاني = مفيش تغيير.
3. **رجوع للافتراضي:** يبعت `null` للأعمدة أو للشهور ← يرجع الافتراضي بتاعه.
4. **أعمدة مش مسموحة:** كود مش معروف، أو مكرر، أو `rating_average` (لسه متأجل لحد ما التقييم يرجع)، أو رقم الزبونة ←
   **الأعمدة دي مش مسموحة.** (422) ومفيش حاجة اتحفظت.
5. **شهور غلط:** 0 أو 13 ← **عدد الشهور لازم يكون رقم صحيح من 1 لـ 12.** (422). كسر زي 1.5 ←
   **البيانات المرسلة غير صحيحة** (400). قيمة 13–24 اتحفظت قبل كده بتتقري 12.
6. **الصلاحية:** اللي معاه **عرض إعدادات النشاط** يقرا بس، والحفظ ← **غير مسموح بهذا الإجراء** (403). اللي معاه
   **إدارة إعدادات النشاط** لوحدها ← 403 في القراية والحفظ. جهاز مربوط أو نشاط تاني ← 403 بنفس الرد. صاحب الشركة
   يدي **سماح** لـ **أعمدة تطبيق الموظفين** من شاشة الصلاحيات ([12](12-permissions-screen.md)) ← يقرا ويحفظ.
7. **إعادة الإرسال:** نفس الحفظ بنفس `Idempotency-Key` ← نفس الرد من غير كتابة تانية.

**ممنوع يحصل:**
- السعر أو الخصم أو الصافي يظهروا افتراضيًا.
- رقم الزبونة أو تعليقات التقييم يبقوا عمود.
- عدد شهور برّه 1–12 يتحفظ، أو يتقري أكتر من 12.
- **إدارة إعدادات النشاط** لوحدها تعدّل، أو جهاز يعدّل.
- تغيير من غير سطر تدقيق.

## English

API only, no screen yet. Nothing in the staff app reads this setting yet.

1. **Defaults:** the Owner reads the setting → columns `date`, `time`, `service`, `customer_name`, `share`,
   `estimated_commission`, `tip` (`columns_default: true`); no `list_price`, `discount` or `net`. Months back **2** (the
   current month and the one before, `months_back_default: true`).
2. **Save columns:** save a set without `estimated_commission` and 3 months → the same codes come back in the canonical
   order, and 3 months. One audit entry per changed value. The same codes in another order is no change.
3. **Back to default:** send `null` for the columns or the months → that value returns to its default.
4. **Columns not allowed:** an unknown code, a duplicate, `rating_average` (postponed until ratings return), or the
   customer phone → **These columns are not allowed.** (422), nothing saved.
5. **Bad months:** 0 or 13 → **Months back must be a whole number from 1 to 12.** (422). A fraction such as 1.5 →
   **The request is not valid** (400). A value of 13–24 saved before is read as 12.
6. **Permission:** a holder of **Read business settings** reads only; saving → **This action is not allowed** (403). A
   holder of **Manage business settings** alone → 403 on read and save. A paired device or another business → the same
   403. The Owner gives an **Allow** for **Manage staff app columns** on the permissions screen
   ([12](12-permissions-screen.md)) → reads and saves.
7. **Replay:** the same save with the same `Idempotency-Key` → the same answer, nothing written again.

**Must NOT happen:**
- Price, discount or net shown by default.
- The customer phone or rating comments ever being a column.
- Months back outside 1–12 saved, or read above 12.
- **Manage business settings** alone editing, or a device editing.
- A change without an audit entry.

## For an agent

- **Screens:** none (row 57c-2). Permission labels on the permissions screen (`http://localhost:3001`, staging
  `https://app.staging.pospay.systems`): `packages/i18n/src/permission-codes-catalog.ts`.
- **API** (base `http://localhost:3000/v1`, staging `https://api.staging.pospay.systems/v1`; session cookie +
  `x-company-id`):
  - `GET /businesses/<B>/settings/staff-columns` — `@RequireAny(['read:settings:business',
    'manage:staff-app-columns:business'], { business })` → `{ business_id, columns, columns_default, months_back,
    months_back_default }`.
  - `PUT /businesses/<B>/settings/staff-columns` — `@Require('manage:staff-app-columns:business')`, needs
    `Idempotency-Key: <UNIQUE_KEY>`:

    ```json
    { "columns": ["date", "time", "service", "customer_name", "share", "tip"], "months_back": 3 }
    ```

- **Errors** (`packages/i18n/src/staff-columns-errors.ts`): `STAFF_COLUMNS_INVALID` 422 (`details.codes`) ·
  `STAFF_MONTHS_BACK_INVALID` 422 · `VALIDATION_FAILED` 400 (a fraction or a non-array) · `FORBIDDEN` 403 · `IDEMPOTENCY_KEY_REQUIRED` 400 · `IDEMPOTENCY_KEY_REUSED` 422 ·
  `NOT_READY` 503.
- **Assertions:** `business_settings.staff_columns` / `staff_months_back`, `NULL` = default; audit actions
  `settings.staff_columns_changed` and `settings.staff_months_back_changed` with before/after; the database `CHECK` is
  still `BETWEEN 1 AND 24` until issue #519 narrows it; the codes `customer_phone` and `rating_comments` do not exist;
  the four `StaffColumnsPort` adapters (orders, commissions, customers, staff) return the effective set with
  `rating_average` stripped and months clamped to 12, but no use case or query calls them yet.
- **Sources:** `docs/specs/060-ratings-and-staff-app/spec.md` (Story A4, §A.5 rows 57c-1, 57c-2),
  `apps/api/src/modules/settings/http/staff-columns.controller.ts`, `apps/api/src/modules/settings/domain/staff-columns.ts`,
  `packages/contracts/src/settings/staff-columns.ts`, `packages/i18n/src/staff-columns-errors.ts`.
