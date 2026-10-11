# 37 · Package types — أنواع الباقات

**Status / الحالة:** shipped in #133 (PR 33, merge commit `27c40e64`). Staging runs `api` and `worker` at commit
`6c220e4` (2026-10-11), so the **API routes are live on staging**; the **admin screens are not deployed** (issue #54),
so the screens run locally and the API can be tried on staging with an HTTP client. This is the menu of bundles the
business sells (for example 10 blow-dry sessions for 25.000 KWD, valid 90 days). **Nothing sells a package yet**:
selling comes in PR 42, and "stop selling a package type" is a later row (33b), so there is **no delete and no
deactivate**. A package type applies to every branch of the business. Editing a type never changes a package a customer
already bought (PT-Q4). Package-sale commission is set per commission plan, not here (PT-Q12). Your decisions of
2026-10-08 (PT-Q1 to PT-Q12) apply: [owner-questions.ar.md](../specs/037-catalog-package-types/owner-questions.ar.md).

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md), then `pnpm db:migrate` (the `package_types` and `package_type_components`
  tables, their RLS and the two permissions) and `pnpm db:seed`. API and admin running. The `catalog` feature enabled
  for the company; without it every route answers like a disabled feature.
- Services to put inside packages ([29](29-services.md)), in one business, for example "Blow-dry" (سشوار) 2.500,
  "Hair wash" (غسيل شعر) 0.000, "Hair-do" 12.000 and "Manicure" 6.000. A service of another business cannot be used.
- Who can use it by default: **Owner**, **General Manager** and **Business Manager**, through
  `manage:package-types:business` ("إدارة أنواع الباقات") and `read:package-types:business`. Any other role needs an
  explicit **Allow** ([12](12-permissions-screen.md)). A paired Device never holds these. A role that manages
  package types also needs the read permission (the service picker and the list use it). Synthetic data only.

## العربي

1. من القائمة الجانبية دوس **أنواع الباقات** ← `/catalog/package-types`. هتشوف **أنواع الباقات** وتحتها **الباقات
   المتاحة في جميع فروع هذا النشاط.** والجدول فيه **الاسم بالإنجليزية** و**السعر (دينار كويتي، ٣ خانات عشرية)** و**الصلاحية
   بالأيام** و**الخدمات** (عددها) وزرار **تعديل**. لو مفيش: **لا توجد أنواع باقات في هذه الصفحة.** القوائم الطويلة بتتقسم
   بـ **الصفحة التالية** و**الصفحة الأولى**.
2. **إضافة باقة:** دوس **إضافة نوع باقة** ← `/catalog/package-types/create`. املأ **الاسم بالإنجليزية** (إلزامي) =
   `Blow-dry x10`، و**الاسم بالعربية (اختياري)** = `١٠ سشوار`، و**السعر** = `25`، و**الصلاحية بالأيام** = `90`. تحت
   الصلاحية هتلاقي الشرح: **صالحة حتى نهاية تاريخ البيع زائد أيام الصلاحية بتوقيت الفرع. البيع يوم ١ أكتوبر بصلاحية ٣٠
   يوماً: الاستخدام حتى نهاية ٣١ أكتوبر.** وكمان **التعديلات تسري على المبيعات الجديدة. العملاء السابقون يحتفظون بجلساتهم
   وقيمها وتاريخ انتهائها.**
3. **خدمات الباقة:** في قسم **خدمات الباقة** دوس **إضافة خدمة**، واختار من **الخدمة** (**اختر خدمة**) سشوار، و**الجلسات** =
   `10`. تقدر تدوس **إضافة خدمة** تاني لحد 20 خدمة. **إزالة الخدمة** بتشيل الصف. لو الخدمات كتير في القائمة،
   **تحميل المزيد من الخدمات**. احفظ ← **تمت إضافة نوع الباقة:** واسمها. السعر بيتحفظ `25.000` وبيظهر في القائمة كده.
4. **باقة مختلطة:** "حفلة عروس": تسريحة ×1 + مكياج ×1 + مانيكير ×2، سعر 60 وصلاحية 30 يوم ← بتتحفظ بنفس ترتيب الخدمات
   اللي دخلته.
5. **خدمة بسعر صفر:** باقة فيها غسيل شعر (0.000) ← مسموح، والشاشة بتحذّر: **جلسات الخدمة ذات السعر 0.000 قيمتها 0.000،
   إلا إذا كانت كل خدمات الباقة مجانية.** سعر الباقة نفسه مسموح يكون 0.000، ومسموح يكون أعلى أو أقل من مجموع أسعار
   الخدمات.
6. **حدود:** الصلاحية من 1 لـ 730 يوم، الجلسات من 1 لـ 365 لكل خدمة (عدد صحيح)، من 1 لـ 20 خدمة مختلفة. أي حاجة برّه كده
   (صلاحية 0 أو 731، جلسات 0 أو 366، من غير خدمات أو 21 خدمة، سعر سالب أو بأقل من 3 خانات عشرية زي `25.5`) ← الشاشة
   بترفض قبل الإرسال وتعرض **راجع الأسماء والسعر بثلاث خانات والصلاحية من ١ إلى ٧٣٠ يوماً، ومن ١ إلى ٢٠ خدمة مختلفة
   لكل منها من ١ إلى ٣٦٥ جلسة.** ولو الطلب اتبعت للـ API مباشرة بيرد برسالة السبب بالاسم (شوف قسم الـ agent).
7. **اسم متكرر:** إضافة باقة اسمها ` blow-dry x10 ` (حروف مختلفة أو مسافات) وفيه باقة بنفس الاسم في النشاط ←
   **يوجد نوع باقة بنفس الاسم في هذا النشاط.** (409). نفس الاسم في نشاط تاني مقبول. نفس الكلام على الاسم العربي لو
   اتكتب، وعلى إعادة التسمية.
8. **التعديل:** في الجدول دوس **تعديل** على باقة ← يظهر **تعديل نوع الباقة** بالقيم الحالية ← غيّر السعر لـ `27.5`
   وضيف غسيل شعر ×2 ← **حفظ التعديلات** ← **تم تعديل نوع الباقة.** الحفظ بيستبدل التعريف كله (الخدمات كمان)، و`revision`
   يزيد. حفظ من غير تغيير ← يرجّع نفس الباقة وما يتكتبش سطر تدقيق.
9. **مديرين في نفس الوقت:** افتح نفس الباقة في تبويبين، واحفظ من الأول، وبعدين من التاني ← **عدّل مدير آخر نوع الباقة.
   أعد التحميل قبل الحفظ.** دوس **إعادة تحميل نوع الباقة** وكمّل. **العودة إلى أنواع الباقات** بتقفل اللوحة.
10. **التدقيق:** كل إضافة وكل تعديل فعلي بيكتب سطر تدقيق في نفس المعاملة، والتعديل فيه قبل وبعد بالخدمات كمان (مين غيّر
    السعر وإمتى ومن إيه لإيه).
11. **النطاق:** باقة نشاط تاني (حتى في نفس الشركة) أو شركة تانية، أو خدمة من نشاط تاني جوه باقة ← نفس الرد زي اللي مش
    موجود: **نوع الباقة غير موجود في هذا النشاط.** للباقة، و**إحدى الخدمات المختارة غير موجودة في هذا النشاط.** للخدمة.
    نشاط برّه صلاحياتك ← رفض الصلاحية الموحّد.
12. **اختيار الخدمات يحتاج صلاحية القراءة:** مدير عنده إدارة أنواع الباقات من غير القراءة ← الشاشة تعرض **لاختيار خدمات
    الباقة، يحتاج دورك إلى الصلاحية read:package-types:business. اطلب من مسؤول الصلاحيات إضافتها.**

**ممنوع يحصل:**
- سعر يتحفظ كرقم عشري تقريبي، أو سعر سالب، أو أكتر من 3 خانات.
- باقة من غير خدمات، أو فيها أكتر من 20، أو نفس الخدمة مرتين، أو جلسات خارج 1 – 365، أو صلاحية خارج 1 – 730.
- باقتين بنفس الاسم في نفس النشاط (من غير اعتبار حروف كبيرة/صغيرة أو المسافات على الأطراف).
- خدمة من نشاط أو شركة تانية تدخل باقة، أو باقة نشاط أو شركة تانية تظهر أو تتعدل، أو رد يفرّق بين "مش موجودة" و"مش
  بتاعتك".
- حفظين متزامنين ينجحوا على نفس النسخة، أو تعديل فعلي من غير سطر تدقيق.
- تعديل باقة يغيّر باقة عميل اشتراها (خدماتها وجلساتها وقيمها وانتهاؤها).
- حذف باقة، أو Device يقرأ أو يعدل الباقات.

## English

1. Sidebar **Package types** (أنواع الباقات) → `/catalog/package-types`. You see **Package types** with "Packages
   available across all branches of this business." The table shows **English name**, **Price (KWD, 3 decimals)**,
   **Validity (days)**, **Services** (the count) and an **Edit** button. With none: "No package types on this page."
   Long lists page with **Next page** and **First page**.
2. **Add:** press **Add package type** → `/catalog/package-types/create`. Fill **English name** (required) =
   `Blow-dry x10`, **Arabic name (optional)** = `١٠ سشوار`, **Price (KWD, 3 decimals)** = `25`, **Validity (days)** =
   `90`. Under validity the help reads "Usable through the end of the sale date + validity days, in branch time. Sold
   on 1 October with 30 days: usable through 31 October." and "Changes apply to future sales. Existing customers keep
   their purchased sessions, values and expiry."
3. **Package services:** in **Package services** press **Add service**, pick Blow-dry from **Service** ("Choose a
   service") and **Sessions** = `10`. Press **Add service** again up to 20 services; **Remove service** drops a row;
   **Load more services** pages a long picker. Save → "Package type created:" with its name. The price is stored as
   `25.000` and shows that way in the list.
4. **A mixed package:** "Bridal": hair-do ×1 + make-up ×1 + manicure ×2, price 60, validity 30 days → saved with the
   services in the order you entered them.
5. **A zero-price service:** a package with hair wash (0.000) is allowed and the form warns "A service priced 0.000 has
   sessions worth 0.000, unless every service in the package is free." The package price itself may be 0.000, and may
   be above or below the sum of its services' prices.
6. **Limits:** validity 1 to 730 days, sessions 1 to 365 per service (whole numbers), 1 to 20 distinct services.
   Anything outside (validity 0 or 731, sessions 0 or 366, no services or 21, a negative price, fewer than 3 decimals
   such as `25.5`) → the form refuses before sending and shows "Check names, price (3 decimals), validity (1–730 days),
   and 1–20 distinct services with 1–365 sessions each." Sent straight to the API, the reason is named (see the agent
   section).
7. **A repeated name:** adding ` blow-dry x10 ` (other case or spaces) when that package exists in the business → "A
   package type with this name already exists in this business." (409). The same name in another business is accepted.
   The same applies to the Arabic name when given, and to renaming.
8. **Edit:** press **Edit** on a row → **Edit package type** opens with the current values → change the price to `27.5`
   and add hair wash ×2 → **Save changes** → "Package type updated." Saving replaces the whole definition (services
   included) and `revision` goes up. Saving with no change returns the same record and writes no audit row.
9. **Two managers at once:** open the same type in two tabs, save in the first, then in the second → "Another manager
   changed this package type. Reload before saving." Press **Reload package type** and continue. **Back to package
   types** closes the panel.
10. **Audit:** every create and every effective edit writes an audit row in the same transaction; an edit holds before
    and after, services included (who changed the price, when, from what to what).
11. **Scope:** a package type of another business (even in the same company) or another company, or a service of
    another business inside a package → the same answer as an unknown one: "The package type does not exist in this
    business." for the package, "A selected service does not exist in this business." for the service. A business
    outside your permissions → the uniform permission refusal.
12. **The picker needs read permission:** a manager with the manage permission but without the read permission sees
    "To choose package services, your role needs read:package-types:business. Ask an administrator to grant it."

**Must NOT happen:**
- A price stored as a floating-point value, a negative price, or more than 3 decimals.
- A package with no services, more than 20, the same service twice, sessions outside 1–365 or validity outside 1–730.
- Two package types with the same name in one business (ignoring case and edge spaces).
- A service of another business or company inside a package, another business's or company's package visible or
  editable, or a response that tells "does not exist" from "not yours".
- Two concurrent saves both succeeding on the same version, or an effective edit with no audit row.
- An edit changing a package a customer already bought.
- A package type being deleted, or a Device reading or editing package types.

## For an agent

- Admin: `http://localhost:3001/catalog/package-types` (list; **Edit** per row opens the edit panel below the table) and
  `http://localhost:3001/catalog/package-types/create`. Field ids `#package-name-en`, `#package-name-ar`,
  `#package-price`, `#package-validity`. Buttons by exact text; the screen text above is quoted from
  `packages/i18n/src/catalog-package-types.ts`.
- API (session cookie + `x-company-id`; feature `catalog`; no `Idempotency-Key`, no event):
  - `POST /v1/businesses/<BUSINESS_ID>/package-types` → **201** `PackageTypeDetail`, body
    `{ name_en, name_ar?, price: "25.000", validity_days: 90, components: [{ service_id, sessions: 10 }] }`
    (`manage:package-types:business`).
  - `GET /v1/businesses/<BUSINESS_ID>/package-types?limit=20&cursor=<CURSOR>` → `{ items, next_cursor }`, `limit` 1–100
    (default 20), cursor by `id`; each item shows names, price, `validity_days`, `component_count`
    (`read:package-types:business`).
  - `GET /v1/businesses/<BUSINESS_ID>/package-types/<PACKAGE_TYPE_ID>` → one type with ordered components and the
    current service names and prices.
  - `GET /v1/businesses/<BUSINESS_ID>/package-types/service-options` → cursor page of service options (id, names,
    KWD price, active), authorized by `read:package-types:business`.
  - `PATCH /v1/businesses/<BUSINESS_ID>/package-types/<PACKAGE_TYPE_ID>` with **all** of `{ expected_revision, name_en,
    name_ar (string or null), price, validity_days, components }` (full replacement; an omitted field is a
    `VALIDATION_FAILED` 400) → 200.
- Errors, each with `message_ar` and `message_en`: `PACKAGE_TYPE_NOT_FOUND` 404 · `PACKAGE_TYPE_INVALID_COMPONENTS` 400
  ("A package must contain 1–20 services.") · `PACKAGE_TYPE_DUPLICATE_SERVICE` 400 · `PACKAGE_TYPE_INVALID_SESSIONS` 400
  · `PACKAGE_TYPE_PRICE_INVALID` 400 · `PACKAGE_TYPE_VALIDITY_INVALID` 400 · `PACKAGE_TYPE_SERVICE_NOT_FOUND` 400
  (unknown, foreign and other-business services give one answer) · `PACKAGE_TYPE_NAME_INVALID` 400 ·
  `PACKAGE_TYPE_NAME_TAKEN` 409 · `PACKAGE_TYPE_REVISION_CONFLICT` 409 · `FORBIDDEN` 403 (no permission, or a Device)
  · `NOT_READY` 503. A unique-index violation on the name maps to `PACKAGE_TYPE_NAME_TAKEN`.
- Assertions: `revision` starts at 1 and increases only on an effective change; one audit row per create and per
  effective update (before and after with components), none for a no-op; components keep their entered order (`position`
  1–20); `pospay_app` has no DELETE on `package_types`, and only the component table has DELETE (the update replaces the
  set); a component pointing at another business's or tenant's service is rejected by the composite FK; RLS hides other
  tenants; another business's id returns the same 404 as an unknown id; the `catalog` feature off answers like a
  disabled feature; a Device token is refused. Sources: `docs/specs/037-catalog-package-types/spec.md`,
  `apps/api/src/modules/catalog/http/package-types.controller.ts`, `apps/admin/src/catalog/**`,
  `packages/contracts/src/catalog/package-type.ts`, `packages/i18n/src/catalog-package-types.ts`.
