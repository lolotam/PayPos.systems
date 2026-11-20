# 73 · Service categories — تصنيفات الخدمات

**Status / الحالة:** shipped in #721 (32b-cat-1: managed categories per business), #726 (32b-cat-1p: the owner can
give the category and service permissions to any staff member), #729 (32b-cat-1b: categories owned by a branch) and
#1060 (32b-cat-3a: the admin screen on `/catalog/categories`), all merged. **Runs on staging**
(`https://app.staging.pospay.systems/catalog/categories`); needs the `catalog` feature. The screen creates and renames
**business** categories. **Branch categories are API only:** the screen shows them with their **الظهور** /
**Visibility**, but creating one from a branch, or sharing a branch category with the whole business, has no screen
yet. Closing and reopening is [75](75-close-reopen-categories.md); putting a service in a category is
[74](74-service-duration-category.md).

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md) with the API and the admin; or the staging admin with the demo company
  «صالون الأميرة (تجريبي)». The `catalog` feature on.
- The **Owner**; سارة (Sara), Branch Manager of Salmiya; هبة (Heba), a receptionist with no catalog permission.

## العربي

1. **افتح الشاشة:** من القائمة الجانبية دوس **التصنيفات** ← عنوان **التصنيفات** وتحته «إدارة تصنيفات الخدمات وظهورها
   وحالتها المفتوحة والمقفولة.» وجدول فيه **الظهور** و**الحالة**.
2. **التبويبات:** **مفتوحة**، **مقفولة**، **الكل**. لو مفيش حاجة ← **لا توجد تصنيفات في هذه الصفحة.**
3. **إضافة:** دوس **إضافة تصنيف**، اكتب **الاسم بالإنجليزية** و**الاسم بالعربية**، ودوس **إضافة تصنيف** ← **تمت
   إضافة التصنيف.** والتصنيف في الجدول، ظهوره **كل النشاط** وحالته **مفتوحة**.
4. **اسم ناقص:** اسم واحد بس ← **الاسمين مطلوبين.** اسم أطول من 100 حرف ← **الاسم لازم ما يزيدش عن ١٠٠ حرف.**
5. **اسم مكرر:** نفس الاسم موجود في النشاط ← **يوجد تصنيف بنفس الاسم في هذا النشاط.**
6. **تعديل الاسم:** دوس **فتح** على التصنيف ← **إدارة التصنيف**؛ غيّر الاسم ودوس **حفظ التعديلات** ← **تم تعديل
   التصنيف.**
7. **اتنين بيعدّلوا:** لو مدير تاني عدّل نفس التصنيف قبلك ← **عدّل مدير آخر هذا التصنيف. أعد تحميل أحدث سجل قبل
   الحفظ.** وزرار **إعادة التحميل**.
8. **تصنيف فرع (API):** سارة تضيف تصنيف من فرع السالمية بظهور **الفرع** ← بيظهر للسالمية بس. لو خلّته **كل النشاط**
   ← كل الفروع تشوفه، وما بيرجعش خاص تاني: **التصنيف المشترك لا يعود خاصاً أبداً، والفرع يعدّل تصنيفاته الخاصة به
   وحدها.**
9. **التفويض:** صاحب الشركة يفتح شاشة الصلاحيات ([12](12-permissions-screen.md)) على عضوية هبة ويدّيها **سماح**
   لـ **إدارة تصنيفات خدمات النشاط** ← هبة تقدر تضيف وتعدّل. الصلاحيات دي تتدّي لأي موظف بشري؛ الجهاز المربوط لأ.
10. **من غير صلاحية:** هبة قبل التفويض ← السيرفر بيرفض القراءة (403) ومفيش تصنيفات بتتعرض.

**ممنوع يحصل:**
- تصنيفين بنفس الاسم في نفس النشاط.
- تصنيف نشاط يظهر في نشاط أو شركة تانية.
- تصنيف مشترك يرجع خاص بفرع.
- فرع يعدّل تصنيف خاص بفرع تاني.
- حفظ فوق نسخة أقدم من غير رسالة التعارض.
- جهاز مربوط ياخد صلاحيات التصنيفات.

## English

1. **Open the screen:** in the sidebar click **Categories** → the heading **Categories** with "Manage service
   categories, their visibility and their open state." and a table with **Visibility** and **State**.
2. **Tabs:** **Open**, **Closed**, **All**. With nothing to show → **No categories on this page.**
3. **Add:** click **Add category**, type the **English name** and the **Arabic name**, click **Add category** →
   **Category created.**; the row shows visibility **Whole business** and state **Open**.
4. **A missing name:** only one name → **Both names are required.** A name over 100 characters → **The name must be
   at most 100 characters.**
5. **A duplicate name:** the name already exists in the business → **A category with this name already exists in
   this business.**
6. **Rename:** click **Open** on a category → **Manage category**; change the name and click **Save changes** →
   **Category updated.**
7. **Two editors:** if another manager changed the category first → **Another manager changed this category. Reload
   the latest record before saving.** with a **Reload** button.
8. **A branch category (API):** Sara adds a category from Salmiya with visibility **Branch** → only Salmiya sees it.
   If she makes it **Whole business** → every branch sees it, and it never goes back: **A shared category is never
   made private again, and a branch renames only its own private categories.**
9. **Delegation:** the Owner opens the permissions screen ([12](12-permissions-screen.md)) on Heba's membership and
   gives an **Allow** for **Manage business service categories** → Heba can add and rename. These permissions can go
   to any human staff member, never to a paired device.
10. **No permission:** Heba before the delegation → the server refuses the read (403) and no categories are shown.

**Must NOT happen:**
- Two categories with the same name in one business.
- A business's category visible in another business or company.
- A shared category made branch-private again.
- A branch renaming another branch's private category.
- A save over a stale revision without the conflict message.
- A paired device holding the category permissions.

## For an agent

- **Screen:** `/catalog/categories` (local `http://localhost:3001`, staging `https://app.staging.pospay.systems`);
  page `apps/admin/src/catalog/pages/service-categories-page.tsx`. Text in
  `packages/i18n/src/catalog-service-categories.ts`. The row button is **فتح** / **Open**; the form submits with
  **إضافة تصنيف** / **Add category** or **حفظ التعديلات** / **Save changes**.
- **Business API** (`apps/api/src/modules/catalog/http/service-categories.controller.ts`, the `catalog` feature):
  `POST|GET /v1/businesses/<BUSINESS_ID>/service-categories` · `GET|PATCH …/<CATEGORY_ID>`. Read
  `read:service-categories:business`, write `manage:service-categories:business`. A rename sends
  `expected_revision`.
- **Branch API** (`branch-service-categories.controller.ts`):
  `GET|POST /v1/businesses/<BUSINESS_ID>/branches/<BRANCH_ID>/service-categories` · `PATCH …/<CATEGORY_ID>` ·
  `PUT …/<CATEGORY_ID>/state`. Read `read:service-categories:branch`, write `manage:service-categories:branch`.
- **Delegatable permissions** (`packages/db/src/system-role-policy.ts`): the four `service-categories` permissions,
  `manage:services:business` and `read:services:business`.
- **Errors:** `SERVICE_CATEGORY_NAME_INVALID` · `SERVICE_CATEGORY_NAME_TAKEN` · `SERVICE_CATEGORY_NOT_FOUND` ·
  `SERVICE_CATEGORY_VISIBILITY_FIXED` · `SERVICE_CATEGORY_REVISION_CONFLICT`.
- **Sources:** `docs/specs/072-catalog-services-import/owner-questions.ar.md` (the category questions and the
  delegation answer SI-Q26), `apps/api/src/modules/catalog/domain/service-category.ts`.
