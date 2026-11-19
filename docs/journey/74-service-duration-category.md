# 74 · A service's duration and category — مدة الخدمة وتصنيفها

**Status / الحالة:** shipped in #757 (32b-pre-1: the duration and the category on a service, storage and API) and
#771 (32b-pre-2: both on the services screen), merged. It extends [29](29-services.md): the same screen `/catalog`
and the create and edit forms. **Runs on staging**; needs the `catalog` feature. Categories themselves are
[73](73-service-categories.md).

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md) with the API and the admin; or the staging admin with the demo company
  «صالون الأميرة (تجريبي)» and its 8 services.
- A user who manages the business's services, and at least two open categories ([73](73-service-categories.md)).
- A second user who manages services but cannot read the categories.

## العربي

1. **الأعمدة الجديدة:** افتح **الخدمات** ← الجدول فيه عمود **المدة** وعمود **التصنيف**. خدمة من غير تصنيف مكتوب لها
   **بدون تصنيف**.
2. **إضافة خدمة بمدة وتصنيف:** دوس **إضافة خدمة**، املا الأسماء والسعر ([29](29-services.md))، واكتب **المدة
   (بالدقائق)** = 45، واختار **التصنيف**، واحفظ ← الخدمة في الجدول بمدتها وتصنيفها.
3. **مدة غلط:** 0، أو 601، أو رقم بكسر ← **أدخل عدد دقائق صحيح من 1 إلى 600.**
4. **تعديل:** دوس **تعديل** على خدمة، غيّر التصنيف أو المدة واحفظ ← القيم الجديدة في الجدول.
5. **تصفية:** من **تصفية حسب التصنيف** اختار تصنيف ← الجدول بيعرض خدماته بس. **كل التصنيفات** بترجّع الكل.
6. **تصنيف مقفول:** خدمة تصنيفها مقفول ([75](75-close-reopen-categories.md)) ← جنب اسم التصنيف كلمة **مغلق**. ما
   ينفعش تحط خدمة في تصنيف مقفول: **تصنيف هذه الخدمة مغلق.**
7. **من غير قراءة التصنيفات:** المستخدم التاني يفتح تعديل خدمة ← **قائمة التصنيفات غير متاحة بصلاحيتك؛ سيُحتفظ
   بالتصنيف الحالي.** وفي إضافة خدمة جديدة ← **قائمة التصنيفات غير متاحة بصلاحيتك؛ ستُحفظ الخدمة بدون تصنيف.**

**ممنوع يحصل:**
- مدة برّه 1–600 دقيقة تتحفظ.
- خدمة تتحط في تصنيف نشاط تاني، أو في تصنيف مقفول.
- تصنيف الخدمة يتمسح لما مستخدم من غير قراءة التصنيفات يعدّل الخدمة.
- السعر أو قاعدة العمولة يتغيروا لما تغيّر المدة أو التصنيف بس.

## English

1. **The new columns:** open **Services** → the table has a **Duration** column and a **Category** column. A service
   with no category reads **No category**.
2. **Add a service with both:** click **Add service**, fill the names and the price ([29](29-services.md)), type
   **Duration (minutes)** = 45, pick a **Category**, and save → the service is in the table with its duration and
   category.
3. **A bad duration:** 0, 601, or a fraction → **Enter a whole number of minutes from 1 to 600.**
4. **Edit:** click **Edit** on a service, change the category or the duration and save → the new values are in the
   table.
5. **Filter:** in **Filter by category** pick a category → the table shows only its services. **All categories**
   shows everything again.
6. **A closed category:** a service whose category is closed ([75](75-close-reopen-categories.md)) → the word
   **closed** next to the category name. A service cannot be put in a closed category: **The category of this
   service is closed.**
7. **Without the category read:** the second user opens a service's edit form → **The category list is not
   available with your permission; the current category will be kept.** On a new service → **The category list is
   not available with your permission; the service is saved without a category.**

**Must NOT happen:**
- A duration outside 1–600 minutes saved.
- A service put in another business's category, or in a closed one.
- A service's category wiped when a user without the category read edits the service.
- The price or the commission rule changing when only the duration or the category is edited.

## For an agent

- **Screens:** `/catalog` (list and edit panel) and `/catalog/create` (local `http://localhost:3001`, staging
  `https://app.staging.pospay.systems`); pages `apps/admin/src/catalog/pages/services-page.tsx` and
  `create-service-page.tsx`. Text in `packages/i18n/src/catalog-services.ts` (`duration`, `durationInvalid`,
  `durationColumn`, `category`, `categoryColumn`, `noCategory`, `categoryClosed`, `categoryFilter`, `allCategories`,
  `categoriesUnavailable`, `categoriesUnavailableNew`).
- **API** (`apps/api/src/modules/catalog/http/services.controller.ts`, the `catalog` feature):
  `POST|GET /v1/businesses/<BUSINESS_ID>/services` · `GET|PATCH …/<SERVICE_ID>`; read `read:services:business`,
  write `manage:services:business`.
- **Errors:** `SERVICE_DURATION_INVALID` «المدة لازم تكون عدد دقائق صحيح من 1 إلى 600.» / "The duration must be a
  whole number of minutes from 1 to 600." · `SERVICE_CATEGORY_CLOSED` · `SERVICE_CATEGORY_NOT_FOUND`.
- **Sources:** `docs/specs/072-catalog-services-import/owner-questions.ar.md` (SI-Q5 and the questions that follow
  it), `docs/specs/072-catalog-services-import/plan-32b-pre-2.md`, journey [29](29-services.md).
