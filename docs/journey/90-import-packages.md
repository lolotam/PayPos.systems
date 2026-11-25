# 90 · Import open packages from Excel — استيراد الباقات المفتوحة من Excel

**Status / الحالة:** shipped across #851 (47-1a), #871 (47-1b), #877 (47-2a), #889 (47-2b), 47-2c (worker commit transport and recovery sweep), and 47-2d + 47-3 (template download, commit request route, and Admin screen `/orders/packages/import`). A manager can use the Admin screen (under Orders / package sales) or the API directly to download the template, upload a workbook, run asynchronous preview validation and commit the packages. The commit time budget is a provisional 10 minutes until measured on staging (`47-2c-Q1`). Both routes and the screen need the `orders` feature, the worker and object storage (`STORAGE_*`).

What it is for: packages sold before PosPay, entered with their used and remaining sessions.

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md) with API, worker, Redis and object storage; the `orders` feature on.
- A manager with **استيراد الباقات** / **Import packages** on the business (the manager roles hold it by default).
- An Excel workbook with synthetic rows: one row per package with the customer's phone, the package name in English
  (Arabic optional), the price paid, the expiry date, an external reference, then up to 20 groups of (service name,
  original sessions, remaining sessions). No real phone numbers.
- The customers of those phones already exist ([10](10-customer-find-or-create.md)).

## العربي

من شاشة الإدارة (`/orders/packages/import`، تحت بيع الباقات) أو عبر الـ API مباشرةً، من تنزيل القالب لحد تثبيت الباقات ومتابعة النتيجة.

0. **نزّل القالب:** المدير ينزّل قالب Excel جاهز: ورقة «packages» بعناوينها (66 عمود) وملاحظة عربي على كل عنوان،
   وورقة «services» فيها كل الخدمات **المفتوحة** في النشاط (الخدمة المقفولة مش بتظهر ومش بتتقبل). نشاط فيه أكتر من
   962 خدمة مفتوحة ← الرد 422 (`IMPORT_TEMPLATE_EXCEEDS_LIMITS`) بدل ملف ناقص.
1. **ارفع الملف:** المدير يرفع ملف Excel زي رفع استيراد الموظفين ([27](27-employee-import.md)) لحد ما الملف يبقى
   جاهز.
2. **اطلب المعاينة:** يبعت طلب معاينة للملف ← الرد 202 ومعاه رقم المعاينة. الشغل بيتم في الخلفية.
3. **تابع:** يسأل عن المعاينة برقمها ← «لسه شغالة»، وبعدها «جاهزة» ومعاها عدد الصفوف المقبولة والمرفوضة وسبب كل
   صف مرفوض.
4. **عميلة مش موجودة:** صف رقمه مش لعميلة في الشركة ← الصف مرفوض.
5. **خدمة مش موجودة:** اسم خدمة مش في النشاط (بالعربي أو الإنجليزي، من غير حساسية لحالة الحروف) ← الصف مرفوض.
6. **تاريخ انتهاء قديم:** تاريخ فات ← مقبول (الباقة بتتسجّل منتهية).
7. **مرجع مكرر:** نفس `external_ref` متكرر جوّه الملف ← الصف مرفوض (`IMPORT_EXTERNAL_REF_DUPLICATE`). تخطّي مرجع
   موجود قبل كده في الشركة بيحصل وقت التثبيت، ولسه مش شغال.
8. **ملف كبير:** أكتر من 500 صف، أو 68 عمود، أو 4 شيتات، أو 2 ميجا ← المعاينة «فشلت».
9. **معاينة حد تاني:** مستخدم تاني، أو نشاط أو شركة تانية، يسأل عن نفس الرقم ← «مش موجودة» (`IMPORT_PREVIEW_NOT_FOUND`)،
   نفس الرد لرقم مش موجود أصلًا.
10. **اطلب التثبيت:** المدير (صاحب المعاينة) يبعت طلب تثبيت برقم المعاينة ومعاه مفتاح تكرار (`Idempotency-Key`) ←
    الرد 202. المعاينة بتبقى «طلب التثبيت اتقبل» والعامل بيعمل الباقات في الخلفية. إعادة نفس الطلب (بنفس المفتاح أو
    بمفتاح جديد) ترجّع نفس الرد من غير تثبيت تاني.
11. **رفض التثبيت:** معاينة فيها أخطاء (`IMPORT_PREVIEW_HAS_ERRORS`)، أو عدّى عليها 24 ساعة
    (`IMPORT_PREVIEW_EXPIRED`)، أو لسه شغالة (`IMPORT_FILE_NOT_READY`)، أو فشلت (`IMPORT_COMMIT_FAILED`) ← رفض
    ومفيش حاجة بتتكتب. معاينة حد تاني ← «مش موجودة».
12. **المتابعة:** يسأل عن المعاينة برقمها ← «طلب التثبيت اتقبل»، وبعدها «اتثبّت» ومعاها عدد الباقات اللي اتعملت
    والمتخطّاة (مرجع مستورد قبل كده)، أو «فشلت» ومعاها السبب. لو خدمة اتقفلت بعد المعاينة ← «فشلت»
    (`IMPORT_SERVICE_NOT_FOUND`) ومفيش باقة اتعملت.

**ممنوع يحصل:**
- باقة تتعمل من المعاينة نفسها: الباقات بتتعمل بعد طلب التثبيت بس.
- طلب التثبيت يتكرر فيكتب حدثين أو يعمل الباقات مرتين.
- رقم عميلة كامل، أو صفوف الملف المخزّنة، يظهروا في رد المعاينة.
- مستخدم يشوف معاينة مستخدم تاني.
- نفس الملف يتعالج مرتين ويطلّع نتيجتين مختلفتين.
- استيراد الموظفين ([27](27-employee-import.md)) يتغيّر سلوكه.

## English

Through the Admin screen (`/orders/packages/import`, child entry under package sales) or directly over the API, from template download through commit tracking.

0. **Download the template:** the manager downloads a ready Excel template: a «packages» sheet with the 66 headers
   and an Arabic note on each, and a «services» sheet listing every **open** service of the business (a closed
   service is neither listed nor accepted). A business with more than 962 open services → 422
   (`IMPORT_TEMPLATE_EXCEEDS_LIMITS`) instead of a truncated file.
1. **Upload the file:** the manager uploads an Excel workbook the same way as the employee import
   ([27](27-employee-import.md)), until the file is ready.
2. **Request the preview:** he posts a preview request for the file → 202 with the preview id. The work runs in the
   background.
3. **Follow it:** he asks for the preview by its id → still running, then ready, with the count of accepted and
   refused rows and the reason of each refused row.
4. **An unknown customer:** a row whose phone belongs to no customer of the company → the row is refused.
5. **An unknown service:** a service name that is not in the business (Arabic or English, case-insensitive) → the
   row is refused.
6. **A past expiry:** a date in the past → accepted (the package is recorded as expired).
7. **A duplicate reference:** the same `external_ref` twice inside the file → the row is refused
   (`IMPORT_EXTERNAL_REF_DUPLICATE`). Skipping a reference that already exists in the company happens at commit.
8. **A big file:** more than 500 rows, 68 columns, 4 sheets or 2 MiB → the preview fails.
9. **Someone else's preview:** another user, business or company asks for the same id → not found
   (`IMPORT_PREVIEW_NOT_FOUND`), the same answer as for an id that never existed.
10. **Request the commit:** the manager who owns the preview posts a commit request with the preview id and an
    `Idempotency-Key` → 202. The preview becomes «commit requested» and the worker creates the packages in the
    background. Repeating the request (same key or a new one) returns the same answer with no second commit.
11. **Refused commit:** a preview with errors (`IMPORT_PREVIEW_HAS_ERRORS`), older than 24 hours
    (`IMPORT_PREVIEW_EXPIRED`), still running (`IMPORT_FILE_NOT_READY`) or failed (`IMPORT_COMMIT_FAILED`) → refused
    and nothing is written. Someone else's preview → not found.
12. **Follow it:** he asks for the preview by its id → «commit requested», then «committed» with the count of
    packages created and skipped (a reference imported before), or «failed» with the reason. A service closed after
    the preview → «failed» (`IMPORT_SERVICE_NOT_FOUND`) and no package is created.

**Must NOT happen:**
- A package created by the preview itself: packages are created only after a commit request.
- A repeated commit request writing two events or creating the packages twice.
- A full customer phone, or the stored candidate rows, in the preview answer.
- A user seeing another user's preview.
- One file processed twice giving two different results.
- The employee import ([27](27-employee-import.md)) changing its behaviour.

## For an agent

- **Screens:** Admin `/orders/packages/import` (`apps/admin/src/orders/pages/package-import-page.tsx`, nav item `import-packages` under `sell-package`, `appMapEntry: false`).
- **API** (`apps/api/src/modules/orders/http/package-import-preview.controller.ts` and
  `package-import-commit.controller.ts`, `import:packages:business` + the `orders` feature):
  `GET /v1/businesses/<BUSINESS_ID>/packages/import/template` · `POST …/packages/import/previews` (accepts an owned,
  ready workbook; 202) · `GET …/previews/<PREVIEW_ID>` (creator-scoped polling: pending, ready, commit_requested,
  committed, failed) · `POST …/packages/import/commits` (202, `Idempotency-Key`, body `{ preview_id }`).
- **Worker:** `apps/worker/src/modules/orders/use-cases/execute-package-preview`; the commit use case
  `commit-package-import` runs after `PackageImportCommitRequested` (47-2c transport, 10-minute stale window).
- **Limits:** 500 rows, 68 columns, 2 MiB, 4 sheets (spec 058 row 47-1b).
- **Row codes** (`apps/worker/src/modules/orders/domain/package-import-row.ts`, `package-import-validation.ts`):
  `IMPORT_CUSTOMER_NOT_FOUND` · `IMPORT_SERVICE_NOT_FOUND` · `IMPORT_SERVICE_AMBIGUOUS` · `IMPORT_PHONE_INVALID` ·
  `IMPORT_NAME_INVALID` · `IMPORT_DATE_INVALID` · `IMPORT_EXTERNAL_REF_INVALID` · `IMPORT_EXTERNAL_REF_DUPLICATE` ·
  `IMPORT_REQUIRED_CELL` · `IMPORT_CELL_INVALID` · `IMPORT_HEADER_INVALID` · `IMPORT_ROW_LIMIT_EXCEEDED`.
- **Rules:** one row = one package; no per-service price column, the price paid is split by session count only; an
  imported package names no package type, no seller and no payment method (spec 058 FR-061 … FR-067).
- **Permission default:** the manager roles (`packages/db/src/role-defaults.ts`).
- **Sources:** `docs/specs/058-packages-sell-redeem/spec.md` (FR-060 … FR-068, rows 47-1 … 47-3),
  `docs/specs/058-packages-sell-redeem/47-1-async-split-plan.md`, `47-2b-brief.md`.
