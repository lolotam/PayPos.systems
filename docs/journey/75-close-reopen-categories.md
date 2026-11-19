# 75 · Close and reopen a category and its services — قفل وفتح التصنيف وخدماته

**Status / الحالة:** shipped in #996 (32b-cat-2: close and reopen for services and categories, and the category
detail), #1021, #1044 and #1050 (32b-cat-2-worker parts 1–3: large categories are closed and reopened in the
background, with a status read) and #1060 (32b-cat-3a: the close and reopen controls on the category screen), all
merged. **Runs on staging** on `/catalog/categories` ([73](73-service-categories.md)). **API only:** closing or
reopening **one service** by itself has routes but no button; the services table only shows a **مقفولة** / **Closed**
badge on a closed service.

**Before you start / قبل ما تبدأ:**
- Everything of [73](73-service-categories.md), with API, worker and Redis running.
- A user who holds both the read and the manage permission for the business's categories.
- A category «شعر» with 3 open services, one of them already closed by hand before (through the API).

## العربي

1. **افتح التصنيف:** في **التصنيفات** دوس **فتح** على «شعر» ← **إدارة التصنيف** وفيه زرار **قفل التصنيف**.
2. **التأكيد:** دوس **قفل التصنيف** ← **قفل التصنيف ده هيقفل معاه 3 خدمة مفتوحة.** ومعاها **تأكيد** و**إلغاء**.
   **إلغاء** ما بيغيّرش حاجة.
3. **اقفل:** دوس **تأكيد** ← **جاري القفل…** وبعدها **اتقفل التصنيف و3 خدمة**. التصنيف بقى في تبويب **مقفولة**
   وحالته **مقفولة**.
4. **الخدمات اتقفلت معاه:** في **الخدمات** ([74](74-service-duration-category.md)) الخدمات التلاتة عليها **مقفولة**،
   وجنب اسم التصنيف **مغلق**.
5. **العدد اتغيّر:** لو حد أضاف أو قفل خدمة في التصنيف بين التأكيد والتنفيذ ← **الخدمات تحت هذا التصنيف اتغيرت بعد
   تأكيدك؛ أعد التحميل وأكد مرة أخرى.** ومفيش حاجة بتتقفل.
6. **افتحه تاني:** دوس **فتح التصنيف** ← **فتح التصنيف ده هيفتح 3 خدمة اتقفلت معاه.** ← **تأكيد** ← **جاري
   الفتح…** وبعدها **اتفتح التصنيف و3 خدمة**. الخدمة اللي كانت مقفولة باليد قبل قفل التصنيف بتفضل مقفولة.
7. **تصنيف كبير:** تصنيف فيه أكتر من 300 خدمة ← القفل أو الفتح بيتم في الخلفية؛ السطر بيفضل على **جاري القفل…**
   لحد ما يخلص، والشاشة بتسأل عن الحالة لوحدها.
8. **شغال بالفعل:** قفل تاني والأول لسه شغال ← **فيه قفل أو فتح شغّال بالفعل على هذا التصنيف في الخلفية. استنى لحد
   ما يخلص وبعدين حاول تاني.**
9. **فشل أو طوّل:** ← **القفل أو الفتح في الخلفية فشل. مفيش حاجة اتغيّرت؛ حاول تاني.** أو **القفل أو الفتح في
   الخلفية أخد وقت أكتر من اللازم واتوقف. مفيش حاجة اتغيّرت؛ حاول تاني.** وزرار **حاول تاني**.
10. **مقفول بالفعل:** قفل تصنيف مقفول ← **هذا التصنيف مغلق بالفعل.** وفتح تصنيف مفتوح ← **هذا التصنيف غير مغلق.**

**ممنوع يحصل:**
- تصنيف يتقفل وخدمة منه تفضل مفتوحة، أو نص الخدمات بس تتقفل (كله أو لا شيء).
- فتح التصنيف يفتح خدمة كانت مقفولة باليد قبله.
- قفل ينجح والعدد اللي المستخدم أكّد عليه اتغيّر.
- عمليتين قفل أو فتح على نفس التصنيف في نفس الوقت.
- الزيارات والأسعار المحفوظة قبل القفل تتغير.

## English

1. **Open the category:** on **Categories** click **Open** on «شعر» → **Manage category** with a **Close category**
   button.
2. **Confirmation:** click **Close category** → **Closing this category also closes 3 open services.** with
   **Confirm** and **Cancel**. **Cancel** changes nothing.
3. **Close:** click **Confirm** → **Closing…**, then **Category closed with 3 services.** The category is now under
   the **Closed** tab with state **Closed**.
4. **Its services closed with it:** on **Services** ([74](74-service-duration-category.md)) the three services show
   **Closed**, and the category name shows **closed**.
5. **The count changed:** if someone added or closed a service of the category between the confirmation and the
   action → **The services under the category changed after you confirmed; reload and confirm again.** and nothing
   is closed.
6. **Reopen:** click **Reopen category** → **Reopening this category reopens 3 services that were closed with it.**
   → **Confirm** → **Reopening…**, then **Category reopened with 3 services.** The service that was closed by hand
   before the category was closed stays closed.
7. **A large category:** a category with more than 300 services → the close or reopen runs in the background; the
   row stays on **Closing…** until it finishes, and the screen polls the status by itself.
8. **Already running:** a second close while the first still runs → **A close or reopen of this category is already
   running in the background. Wait for it to finish, then try again.**
9. **Failed or too slow:** → **The background close or reopen failed. Nothing changed; try again.** or **The
   background close or reopen took too long and was stopped. Nothing changed; try again.** with a **Try again**
   button.
10. **Already closed:** closing a closed category → **This category is already closed.**; reopening an open one →
    **This category is not closed.**

**Must NOT happen:**
- A category closed with one of its services left open, or only half of them closed (all or nothing).
- Reopening a category reopening a service that was closed by hand before it.
- A close succeeding after the count the user confirmed has changed.
- Two close or reopen actions on one category at the same time.
- Visits and prices saved before the close changing.

## For an agent

- **Screen:** `/catalog/categories`; components `apps/admin/src/catalog/ui/service-category-actions.tsx`,
  `service-category-closing-confirm.tsx`, `service-category-closing-notice.tsx`. Text in
  `packages/i18n/src/catalog-service-categories.ts` (`closeCategory`, `reopenCategory`, `confirmClose`,
  `confirmReopen`, `closing`, `reopening`, `closedWithCount`, `reopenedWithCount`).
- **Category API** (`apps/api/src/modules/catalog/http/service-categories.controller.ts`):
  `POST /v1/businesses/<BUSINESS_ID>/service-categories/<CATEGORY_ID>/close` and `…/reopen`, body with
  `expected_revision` and `expected_service_count`; both need `manage:service-categories:business` **and**
  `read:service-categories:business`. Status of a background run:
  `GET …/service-categories/<CATEGORY_ID>/closings/<CLOSING_ID>` (`service-category-closings.controller.ts`).
- **Service API** (no button yet, `services.controller.ts`):
  `POST /v1/businesses/<BUSINESS_ID>/services/<SERVICE_ID>/close` and `…/reopen`; both need
  `close:services:business` **and** `read:services:business` (**إغلاق خدمات النشاط وإعادة فتحها** / **Close and
  reopen business services**).
- **Threshold:** `SERVICE_CATEGORY_SYNC_CLOSING_LIMIT = 300`
  (`apps/api/src/modules/catalog/domain/service-category-closing-path.ts`); above it the worker does the work.
- **Errors:** `SERVICE_CATEGORY_ALREADY_CLOSED` · `SERVICE_CATEGORY_NOT_CLOSED` · `SERVICE_CATEGORY_COUNT_CHANGED` ·
  `SERVICE_CATEGORY_REVISION_CONFLICT` · `SERVICE_CATEGORY_CLOSING_IN_PROGRESS` ·
  `SERVICE_CATEGORY_CLOSING_NOT_FOUND` · `SERVICE_CATEGORY_CLOSING_EXPIRED` · `SERVICE_CATEGORY_CLOSING_FAILED` ·
  `SERVICE_ALREADY_CLOSED` · `SERVICE_NOT_CLOSED`.
- **Sources:** `docs/specs/072-catalog-services-import/plan-32b-cat-2.md`, `plan-32b-cat-2-worker.md`,
  `plan-32b-cat-3.md` and `owner-questions.ar.md` in the same folder.
