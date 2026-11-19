# 90 · Import open packages from Excel (preview only) — استيراد الباقات المفتوحة من Excel (المعاينة بس)

**Status / الحالة:** shipped in #851 (47-1a: requesting a preview and reading its status), #871 (47-1b: the worker
that reads the workbook and builds the preview), #877 (47-2a: the proof for splitting the preview rows) and #889
(47-2b: the worker's commit use case), all merged (spec 058 row 47). **Half built, API only:** a manager can upload a
workbook and get a **preview** of what would be imported. **Nothing can be imported yet:** the commit request route
and its activation (rows 47-2c and 47-2d) and the import screen (row 47-3) are not built, so no package is created
from a file. The preview routes are on staging; they need the `orders` feature, the worker and object storage for the
uploaded file (see the README's note on `STORAGE_*`).

What it is for: packages sold before PosPay, entered with their used and remaining sessions.

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md) with API, worker, Redis and object storage; the `orders` feature on.
- A manager with **استيراد الباقات** / **Import packages** on the business (the manager roles hold it by default).
- An Excel workbook with synthetic rows: one row per package with the customer's phone, the package name in English
  (Arabic optional), the price paid, the expiry date, an external reference, then up to 20 groups of (service name,
  original sessions, remaining sessions). No real phone numbers.
- The customers of those phones already exist ([10](10-customer-find-or-create.md)).

## العربي

API بس، والمعاينة بس.

1. **ارفع الملف:** المدير يرفع ملف Excel زي رفع استيراد الموظفين ([27](27-employee-import.md)) لحد ما الملف يبقى
   جاهز.
2. **اطلب المعاينة:** يبعت طلب معاينة للملف ← الرد 202 ومعاه رقم المعاينة. الشغل بيتم في الخلفية.
3. **تابع:** يسأل عن المعاينة برقمها ← «لسه شغالة»، وبعدها «جاهزة» ومعاها عدد الصفوف المقبولة والمرفوضة وسبب كل
   صف مرفوض.
4. **عميلة مش موجودة:** صف رقمه مش لعميلة في الشركة ← الصف مرفوض.
5. **خدمة مش موجودة:** اسم خدمة مش في النشاط (بالعربي أو الإنجليزي، من غير حساسية لحالة الحروف) ← الصف مرفوض.
6. **تاريخ انتهاء قديم:** تاريخ فات ← مقبول (الباقة بتتسجّل منتهية).
7. **مرجع مكرر:** `external_ref` موجود قبل كده في الشركة ← الصف بيتخطّى.
8. **ملف كبير:** أكتر من 500 صف، أو 68 عمود، أو 4 شيتات، أو 2 ميجا ← المعاينة «فشلت».
9. **معاينة حد تاني:** مستخدم تاني، أو نشاط أو شركة تانية، يسأل عن نفس الرقم ← «مش موجودة» (`IMPORT_PREVIEW_NOT_FOUND`)،
   نفس الرد لرقم مش موجود أصلًا.
10. **التثبيت:** لسه مفيش route يثبّت الاستيراد. المعاينة ما بتعملش أي باقة.

**ممنوع يحصل:**
- باقة تتعمل من المعاينة.
- رقم عميلة كامل، أو صفوف الملف المخزّنة، يظهروا في رد المعاينة.
- مستخدم يشوف معاينة مستخدم تاني.
- نفس الملف يتعالج مرتين ويطلّع نتيجتين مختلفتين.
- استيراد الموظفين ([27](27-employee-import.md)) يتغيّر سلوكه.

## English

API only, and the preview only.

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
7. **A duplicate reference:** an `external_ref` that already exists in the company → the row is skipped.
8. **A big file:** more than 500 rows, 68 columns, 4 sheets or 2 MiB → the preview fails.
9. **Someone else's preview:** another user, business or company asks for the same id → not found
   (`IMPORT_PREVIEW_NOT_FOUND`), the same answer as for an id that never existed.
10. **Commit:** no route commits the import yet. A preview creates no package.

**Must NOT happen:**
- A package created by a preview.
- A full customer phone, or the stored candidate rows, in the preview answer.
- A user seeing another user's preview.
- One file processed twice giving two different results.
- The employee import ([27](27-employee-import.md)) changing its behaviour.

## For an agent

- **Screens:** none (row 47-3).
- **API** (`apps/api/src/modules/orders/http/package-import-preview.controller.ts`, `import:packages:business` + the
  `orders` feature): `POST /v1/businesses/<BUSINESS_ID>/packages/import/previews` (accepts an owned, ready workbook;
  202) · `GET …/previews/<PREVIEW_ID>` (creator-scoped polling).
- **Worker:** `apps/worker/src/modules/orders/use-cases/execute-package-preview`; the commit use case
  `commit-package-import` exists but nothing requests it yet.
- **Limits:** 500 rows, 68 columns, 2 MiB, 4 sheets (spec 058 row 47-1b).
- **Rules:** one row = one package; no per-service price column, the price paid is split by session count only; an
  imported package names no package type, no seller and no payment method (spec 058 FR-061 … FR-067).
- **Permission default:** the manager roles (`packages/db/src/role-defaults.ts`).
- **Sources:** `docs/specs/058-packages-sell-redeem/spec.md` (FR-060 … FR-068, rows 47-1 … 47-3),
  `docs/specs/058-packages-sell-redeem/47-1-async-split-plan.md`, `47-2b-brief.md`.
